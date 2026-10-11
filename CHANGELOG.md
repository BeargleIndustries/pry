# Changelog

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
