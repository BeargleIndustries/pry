# Interpretability Tool Survey (April 2026)

## TL;DR — What to Install First

- **TransformerLens** — the default lens for circuits work; most tutorials assume it
- **SAELens** — best SAE training + pretrained SAE loader; pairs with TransformerLens
- **Neuronpedia** — browser-based SAE explorer; zero install, use it for orientation before coding
- **nnsight** — use when you need remote inference on larger models you can't run locally
- **ARENA curriculum** — structured learning path that ties everything together with exercises

---

## Mechanistic / Circuits

### TransformerLens

One-line purpose: Intercept and edit activations inside transformer models with a clean hook API.

- Maturity: Active (Neel Nanda + community, frequent releases)
- 12GB fit: Yes -- designed for GPT-2 scale; works fine up to ~7B with careful batching
- Install difficulty: Easy (`pip install transformer-lens`)
- Best use case: Activation patching, attention head analysis, logit lens, IOI-style circuit tracing
- Try this first: `model = HookedTransformer.from_pretrained("gpt2-small")` then run the induction heads notebook from the TransformerLens docs

Notes: The canonical tool. If a paper does mechanistic interp on a transformer, it almost certainly used this or something wrapping it. The hook system is the whole game.

### nnsight

One-line purpose: Remotely intercept activations on models hosted on NDIF servers (or locally).

- Maturity: Active (NDIF team, MIT)
- 12GB fit: Yes locally for small models; the point is running large models remotely for free
- Install difficulty: Easy (`pip install nnsight`)
- Best use case: When you want to run experiments on Llama-3-70B or larger without the VRAM
- Try this first: Sign up at ndif.us, run their "Hello World" remote tracing example on a large model

Notes: Complementary to TransformerLens, not a replacement. Use TransformerLens locally, nnsight for scale experiments. API is different but the mental model (context managers for intervention) is clean.

### Pyvene

One-line purpose: Declarative intervention framework -- define interventions as configs, apply across model families.

- Maturity: Active (Stanford, Zhengxuan Wu)
- 12GB fit: Yes
- Install difficulty: Medium (more concepts to understand upfront)
- Best use case: Distributed Alignment Search (DAS), causal scrubbing-style analysis, systematic intervention sweeps
- Try this first: Their "Box" tutorial which walks through a simple intervention on a 2-layer model

Notes: More abstract than TransformerLens. Worth learning if you care about causal mediation analysis or want to run structured intervention experiments systematically. Skip it initially -- come back after TransformerLens clicks.

### CircuitsVis

One-line purpose: Drop-in attention and activation visualizations for Jupyter notebooks.

- Maturity: Active (maintained alongside TransformerLens ecosystem)
- 12GB fit: N/A (visualization only)
- Install difficulty: Easy (`pip install circuitsvis`)
- Best use case: Visualizing attention patterns and neuron activations inline in notebooks
- Try this first: `from circuitsvis.attention import attention_heads` after any TransformerLens run

Notes: Not essential, but makes attention pattern analysis much less painful. Use it.

### ARENA Curriculum

One-line purpose: Structured 5-chapter curriculum covering transformers -> circuits -> RL -> fine-tuning with coding exercises.

- Maturity: Active (Callum McDougall + contributors, updated regularly)
- 12GB fit: Yes -- exercises are sized for consumer GPUs
- Install difficulty: Medium (clone repo, set up environment, work through sequentially)
- Best use case: Going from "I know ML" to "I can run circuits experiments" in a structured way
- Try this first: Chapter 1 (transformers from scratch), then skip to Chapter 2 (mechanistic interp)

Notes: This is the best onramp that exists. Don't skip it. The exercises are load-bearing -- just reading won't work.

---

## Sparse Autoencoders

### SAELens

One-line purpose: Train SAEs on transformer residual stream / MLP / attention outputs, plus load pretrained ones.

- Maturity: Active (Joseph Bloom + EleutherAI community)
- 12GB fit: Yes for training on GPT-2 scale; loading pretrained SAEs is trivial
- Install difficulty: Easy (`pip install sae-lens`)
- Best use case: Loading EleutherAI/Anthropic-released pretrained SAEs, training your own on small models
- Try this first: Load a pretrained SAE for GPT-2 small and use it to decompose residual stream activations on a prompt

Notes: The standard. Integrates with TransformerLens. Pretrained SAEs available for GPT-2 small/medium, Pythia family, some Gemma models. Start by loading pretrained before you train anything.

### Neuronpedia

One-line purpose: Web app for browsing SAE features -- see what activates each neuron, run feature steering.

- Maturity: Active (Johnny Lin, ongoing development)
- 12GB fit: N/A (it's a website: neuronpedia.org)
- Install difficulty: None -- browser only
- Best use case: Exploring what a pretrained SAE feature responds to before writing code; getting intuitions fast
- Try this first: Go to neuronpedia.org, pick GPT-2 small layer 6, browse the top features -- spend 20 minutes clicking around

Notes: Don't skip this step. Looking at actual feature dashboards before writing SAE code saves hours of confusion. Also has an API if you want to query it programmatically.

### Goodfire Ember

One-line purpose: Commercial API for SAE-based feature steering on hosted models.

- Maturity: Active (Goodfire, commercial product)
- 12GB fit: N/A (API, models run on their infrastructure)
- Install difficulty: Easy (`pip install goodfire`) but requires API key + waitlist as of early 2026
- Best use case: Feature steering experiments on larger models without local VRAM; fast iteration on steering hypotheses
- Try this first: Their quickstart -- find a feature, steer it, observe behavioral change

Notes: Gated and paid. Not a learning tool -- it's an experimentation tool for when you want to test feature steering ideas on capable models quickly. Fine for targeted experiments; don't rely on it for learning fundamentals.

---

## Probing / Steering

### RepEng / Representation Engineering

One-line purpose: Extract "concept directions" from activation differences, then steer behavior by adding them at inference.

- Maturity: Stable reference implementation (Andy Zou et al., paper + code on GitHub at andyzoujm/representation-engineering)
- 12GB fit: Yes -- works at GPT-2 to 7B scale
- Install difficulty: Medium (clone repo, no pip package, some setup)
- Best use case: Steering model toward/away from concepts (honesty, emotion, topic) without fine-tuning
- Try this first: Run the honesty steering demo from the repo on Llama-2-7B or a similar model

Notes: The paper is from 2023 but the technique is still widely used. No maintained pip package -- you work from the repo. Concepts: generate activations for paired contrastive prompts, PCA to find direction, add scaled direction at inference.

### Activation Steering (generic)

One-line purpose: Add a scaled activation vector at a specific layer/token to shift model behavior.

- Maturity: Technique is standard; no single canonical library -- TransformerLens hooks are the usual implementation surface
- 12GB fit: Yes
- Install difficulty: Easy if you already have TransformerLens
- Best use case: Testing specific hypotheses about what information a layer encodes by forcibly adding/subtracting it
- Try this first: In TransformerLens, use `hook_resid_post` at a target layer to add a mean-diff vector between two concept sets

Notes: Not a separate tool -- it's a pattern you implement with TransformerLens hooks. The Turner et al. "Steering GPT-2-XL" paper (2023) is the reference implementation. Read it, then implement from scratch; that's the actual learning.

---

## Evaluation Harnesses

### Inspect (UK AISI)

One-line purpose: Framework for running LLM evaluations -- tasks, solvers, scorers, dataset management.

- Maturity: Active (UK AISI, actively developed, open source)
- 12GB fit: Yes for local models via ollama or HuggingFace integration; also supports API models
- Install difficulty: Easy (`pip install inspect-ai`)
- Best use case: Running structured evals against a model -- behavioral tests, capability probes, safety evals
- Try this first: Run one of their built-in benchmarks (MMLU subset) against a local model to understand the scaffold

Notes: More relevant once you're evaluating whether an intervention changed behavior, not for the core circuits/SAE work. Worth knowing but not day-one priority.

---

## Small Models That Fit in 12GB

| Model | Params | VRAM fp16 | VRAM fp32 | Pretrained SAEs? | Published Circuits? |
|---|---|---|---|---|---|
| GPT-2 small | 117M | ~0.5GB | ~1GB | Yes (SAELens + Neuronpedia) | Yes (IOI, greater-than, many) |
| GPT-2 medium | 345M | ~1.4GB | ~2.8GB | Yes (SAELens) | Some |
| GPT-2 large | 774M | ~3GB | ~6GB | Limited | Few |
| Pythia 160M | 160M | ~0.6GB | ~1.2GB | Yes (SAELens) | Some |
| Pythia 1.4B | 1.4B | ~2.8GB | OOM | Yes (SAELens) | Few |
| Pythia 6.9B | 6.9B | ~14GB (tight) | OOM | No | No |
| Gemma 2B | 2B | ~4GB | OOM | Yes (some layers) | Emerging |
| Llama-3.2 1B | 1B | ~2GB | ~4GB | No | No |
| Llama-3.2 3B | 3B | ~6GB | OOM | No | No |
| Mistral 7B | 7B | ~14GB (tight) | OOM | No | No |

**Recommendation:** Start with GPT-2 small. The tooling, pretrained SAEs, and published circuits are concentrated there. It's the fruit fly of mechanistic interpretability.

Pythia models are better if you care about training dynamics (they have checkpoints every 512 steps). Use Pythia 160M or 410M for that use case.

---

## Recommended Learning Path

1. **Week 1: Foundations**
   - Install TransformerLens, run GPT-2 small on a few prompts
   - Work through ARENA Chapter 1 (transformer from scratch) -- do the exercises, don't just read
   - Spend an hour on Neuronpedia looking at GPT-2 small features -- get intuitions before touching SAEs

2. **Week 2: Circuits**
   - ARENA Chapter 2 (mechanistic interp) -- induction heads exercise is the core
   - Read the Olsson et al. induction heads paper (2022) after doing the exercise
   - Reproduce induction head detection on GPT-2 small using TransformerLens hooks

3. **Week 3: SAEs**
   - Load a pretrained SAE via SAELens for GPT-2 small
   - Run a prompt through the SAE, inspect which features activate
   - Cross-reference with Neuronpedia feature dashboards for the same model
   - Read the Towards Monosemanticity paper (Anthropic, 2023) -- it's long, skim the methods, read results closely

4. **Week 4: Steering + First Experiment**
   - Implement activation steering using TransformerLens hooks (no library -- from scratch)
   - Pick one published circuit (IOI or greater-than) and reproduce the key result
   - Write up what you found, even just as notes -- forces actual understanding

5. **Week 5+: Own experiments**
   - Run the IOI circuit on a model you choose, compare to the published results
   - Try training a small SAE on a single layer of Pythia 160M
   - If you want scale: set up nnsight account, run one experiment on a larger model remotely

---

## First Reproduction Target

**Induction heads in GPT-2 small** -- Olsson et al. (2022)

This is the right first target: well-documented, small model, tooling exists, and the result is genuinely surprising the first time you see it.

**What you're reproducing:** Two-head circuit (K-composition between heads in layers 0 and 1) that enables in-context learning by copying previous tokens that followed the same pattern.

**Steps:**

```bash
pip install transformer-lens circuitsvis
```

```python
import transformer_lens
model = transformer_lens.HookedTransformer.from_pretrained("gpt2")

# 1. Create repeated token sequences [A B C ... A B C ...]
# 2. Run with cache: logits, cache = model.run_with_cache(tokens)
# 3. Plot per-head induction score (how much each head attends to
#    the token that preceded the current token's previous occurrence)
# 4. Identify the two induction heads (layer 5 heads 1 and 5 in gpt2-small)
# 5. Patch them out and show the loss spike on repeated sequences
```

Full walkthrough: TransformerLens induction heads tutorial at https://neelnanda.io/mechanistic-interpretability/induction-heads

Expected time: 2-4 hours if you do it from scratch. Budget a full afternoon. The actual code is short -- the time goes into understanding what you're looking at.

**After this works:** Read the full Olsson et al. paper. The paper and your experiment will now mean something.
