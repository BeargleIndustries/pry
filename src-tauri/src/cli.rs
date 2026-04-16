// pry-cli binary — Phase 2 real implementation
// Usage: pry-cli run <preset> "<prompt>" [--layer N] [--max-tokens N]
//
// Spawns the Python sidecar, loads the preset (streaming SSE progress to stderr),
// then POSTs /generate and prints the JSON response to stdout.
// Non-zero exit on any HTTP error.

mod sidecar;
pub mod hardware;

// Stub modules so sidecar.rs compiles in the pry-cli binary context.
// The real implementations live in lib.rs (the Tauri app).
mod bootstrap {
    use std::path::PathBuf;
    pub fn is_runtime_ready() -> bool { false }
    pub fn runtime_dir() -> anyhow::Result<PathBuf> {
        anyhow::bail!("bootstrap not available in pry-cli")
    }
}
mod crash {
    pub fn record_line(_line: impl Into<String>) {}
}

use anyhow::Context;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "pry-cli", version, about = "Pry CLI — sidecar-only interpretability runner")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Run a preset model on a prompt and print top features as JSON.
    Run {
        /// Preset id (e.g. "gpt2-small", "pythia-410m")
        preset: String,
        /// Prompt to run
        prompt: String,
        /// Layer index to extract features from (preset default if omitted)
        #[arg(long)]
        layer: Option<u32>,
        /// Max tokens to generate after the prompt
        #[arg(long, default_value = "0")]
        max_tokens: u32,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("pry=info".parse().unwrap()),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Run { preset, prompt, layer, max_tokens } => {
            run_command(preset, prompt, layer, max_tokens).await
        }
    }
}

async fn run_command(
    preset: String,
    prompt: String,
    layer: Option<u32>,
    max_tokens: u32,
) -> anyhow::Result<()> {
    // Launch sidecar
    eprintln!("[pry-cli] launching sidecar...");
    let mut handle = sidecar::launch()
        .await
        .context("failed to launch sidecar")?;

    let base_url = handle.base_url.clone();
    let client = reqwest::Client::new();

    // Load preset — SSE stream, print progress to stderr
    eprintln!("[pry-cli] loading preset '{preset}'...");
    let load_url = format!("{base_url}/load");
    let load_body = serde_json::json!({ "preset_id": preset });

    let load_resp = client
        .post(&load_url)
        .json(&load_body)
        .send()
        .await
        .context("POST /load failed")?;

    if !load_resp.status().is_success() {
        let status = load_resp.status();
        let body = load_resp.text().await.unwrap_or_default();
        handle.shutdown().await.ok();
        return Err(anyhow::anyhow!("POST /load returned {status}: {body}"));
    }

    // Drain SSE stream from /load
    drain_sse_to_stderr(load_resp, "load").await?;

    // Generate
    eprintln!("[pry-cli] running /generate...");
    let generate_url = format!("{base_url}/generate");
    let mut gen_body = serde_json::json!({
        "prompt": prompt,
    });
    if let Some(l) = layer {
        gen_body["layer"] = serde_json::json!(l);
    }
    if max_tokens > 0 {
        gen_body["max_tokens"] = serde_json::json!(max_tokens);
    }

    let gen_resp = client
        .post(&generate_url)
        .json(&gen_body)
        .send()
        .await
        .context("POST /generate failed")?;

    if !gen_resp.status().is_success() {
        let status = gen_resp.status();
        let body = gen_resp.text().await.unwrap_or_default();
        handle.shutdown().await.ok();
        return Err(anyhow::anyhow!("POST /generate returned {status}: {body}"));
    }

    let response_text = gen_resp.text().await.context("reading /generate response")?;

    // Print raw JSON to stdout
    println!("{response_text}");

    handle.shutdown().await.ok();
    Ok(())
}

/// Reads an SSE response stream and prints `[load] stage=...` lines to stderr.
/// Handles both `data: {...}` SSE format and plain newline-delimited JSON.
async fn drain_sse_to_stderr(
    resp: reqwest::Response,
    prefix: &str,
) -> anyhow::Result<()> {
    use futures_util::StreamExt;

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("SSE stream error")?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process complete lines (SSE events are delimited by \n\n, but we handle \n too)
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer.drain(..=newline_pos);

            if line.is_empty() {
                continue;
            }

            // Strip "data: " prefix if present
            let data = if let Some(stripped) = line.strip_prefix("data: ") {
                stripped
            } else {
                &line
            };

            // Try to parse as JSON and extract a "stage" or "message" field
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                let stage = val
                    .get("stage")
                    .or_else(|| val.get("message"))
                    .or_else(|| val.get("status"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(data);
                eprintln!("[{prefix}] stage={stage}");
            } else {
                eprintln!("[{prefix}] {data}");
            }
        }
    }

    Ok(())
}
