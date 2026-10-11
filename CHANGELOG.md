# Changelog

## 0.2.0

### New
- **Computers without a graphics card can use Pry.** GPT-2 small and Pythia-70M now run on the CPU (slower, but they work). The model picker says "Works on your computer (slower)" instead of locking you out.
- **Engine status and restart.** A chip in the header shows whether the engine is on the GPU or CPU, which model and layer are loaded, and has a Restart button. If the engine stops, a banner says so within a couple of seconds and offers to restart it.
- **Real download progress.** First-time model downloads show megabytes, not a frozen bar.
- **Save results to a file.** Export now opens a normal Save dialog.
- **Swap & Compare starts with a working example** (the "Mary and John" sentence pair) and shows live word counts for both prompts, so it's clear when they don't match.
- Steering now shows only the words the model added, with the changes highlighted word by word.
- Pythia-70M is now offered during setup, and every model's Neuronpedia links point to the right place.

### Fixed
- The guided tour could get stuck after a failed run. It now offers Try again or Skip, and always uses GPT-2 small.
- "Why (DLA)" didn't refresh when you clicked a different word.
- The feature history chart showed "not in the top 5" the same as zero. It's now shown as a hatched bar.
- Models that aren't available yet say "Coming soon" instead of "Not enough memory".
- A saved Hugging Face token now actually reaches the engine.
- Upgrading no longer sends existing users back through the welcome screens; Pry shows a short "Updating Pry…" step instead.
- Error messages are plain language, with details available.

### Under the hood
- The engine only accepts requests from Pry itself (a fresh key each launch), so other programs and web pages on your computer can't drive it.
- If the GPU runs out of memory loading a model, Pry falls back to the CPU instead of failing.
- Custom models are hidden until they're ready.

## 0.1.2

### Fixed
- **GPU machines were running on the CPU.** The first-run installer let a later install step swap the GPU build of PyTorch for the CPU-only one. Every install step is now pinned, and the installer checks it got the right build. Existing installs on NVIDIA machines will offer a one-time engine update (about 2.7 GB).
- **Engine updates can't break a working install.** A new engine is built next to the current one and only switched over once it checks out. If it fails to start, Pry switches back.
- The "Mean" attention view showed the same value for every head. The attention views are now Strongest look, Spread, Looks back, and Previous word.
- Pythia's feature view was reading the wrong layer. All 6 Pythia layers are now available.
- Analysis tabs could show results for an edited prompt you hadn't run yet. They now always match the words in the token strip.
- The Circuit Map drew connections that weren't real. It's now "Key parts" and says plainly that it doesn't show how parts connect.
- "Confidence" on feature labels measured label length, not confidence. It's now shown as label detail.
- Error messages now say what went wrong instead of "HTTP 400".
- Lots of outdated or inaccurate text in tooltips, the tutorial, and setup.

### Notes
- Running 0.1.1 after 0.1.2 makes the old app re-download its engine. Stay on 0.1.2 or newer.
