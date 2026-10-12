# Changelog

## 0.3.4

### New
- **Gemma 2 2B** is available, with Google's Gemma Scope features (Neuronpedia labels included). It loads in a compact number format (bfloat16, about 6.5 GB of graphics memory) so it fits 12 GB cards; it needs a GPU. Google requires two steps first, and Pry walks you through them: accept the Gemma license on Hugging Face in your own browser, and save a Hugging Face token in Pry. If a load is refused, Pry says which step is missing. Gemma hasn't been tried end to end on a real machine yet, since that needs an account with the license accepted.
- **Add your own models from Hugging Face.** Type a model name and Pry checks it's a kind TransformerLens supports, estimates its size, and gives the same "fits / tight / too big" verdict as the built-in models. Added models are remembered. Most panels work on them: attention, copying heads, predictions, logit lens, Why (DLA), knockouts, Swap & Compare, Key parts, Compare and Watch it write. Features and Steering need a trained feature dictionary that Pry only has for the built-in models, and those panels say so.

### Fixed
- Loading any model that needs a Hugging Face login failed with an error inside Pry. The token was passed twice to one loader and in a form another loader doesn't accept.

## 0.3.3

### New
- **Key parts now draws real connections.** Lines between parts show one precisely defined kind of link, the *direct value path*: how much one part's output, read by a later attention head, pushes the predicted word up (blue, +) or down (orange, −). Other ways parts affect each other (like changing where a head looks, or effects routed through later layers) aren't drawn, and the panel says so. On the Mary/John sentence it picks out the heads researchers call name movers.
- **Why (DLA) and Key parts now show numbers in logits.** Each part's score is its direct push on the predicted word's score, measured after the model's final normalization step, the same way research tools compute it. The numbers are smaller than before (the old ones skipped that step) and can now be compared with the connection lines.
- **Lab notebook.** Save a run with your own note, come back to it later, and export one entry or the whole notebook as a single web page you can share. The page works offline and loads nothing from the internet. Everything stays on your computer.

## 0.3.2

### New
- **Attention as lines.** The Attention panel now opens on a lines view: each word on the left, the words it looks at on the right, joined by lines that are darker where attention is stronger. Click a word to follow its lines. The layer × head grid is still there as "Expert view".
- **Glossary hovers.** Terms like *attention head*, *logit*, *feature* and *steering* have a dotted underline. Hover or tab to one for a one-line definition.
- **New first-time tips** for Experiments, Compare, Watch it write, Find a concept and the copying-heads view.

### Accessibility
- Every grid works from the keyboard: one Tab stop per grid, arrow keys to move, Enter to open. Each square says what it is and its value.
- Screen readers get each chart's plain-language summary as its description.
- Positive and negative now use a colorblind-safe blue and orange (instead of red and green), and strong squares carry a + or − mark.
- No accessibility warnings left in the build. Keyboard controls are listed in `docs/accessibility.md`.

## 0.3.1

### New
- **Find and steer any concept.** In Steering, type a concept like "the ocean" and Pry finds features whose labels match it, then lets you push the model toward one of them. The search text goes to Neuronpedia (neuronpedia.org), and the panel says so before you search. When Neuronpedia can't be reached, search switches off with a plain message.
- **Compare two prompts.** Compare mode runs two prompts side by side ("The doctor said that" vs "The nurse said that") and shows which next words gained or lost, which features appear in only one, and which attention heads behave most differently. It says plainly that these differences go along with the prompt change and don't prove what causes what.
- **Watch it write.** In Predictions, replay the model writing one word at a time, with the chance of the word it picked and the runner-up at each step. A temperature slider shows how sampling changes the output, and "reuse the same random draws" makes a run repeatable.

## 0.3.0

### New
- **Find the copying heads.** A new view in Attention runs a repeated random word sequence through the model and rings the heads that copy "what came next last time" (induction heads) and the ones that look at the previous word. On GPT-2 small it finds the heads researchers have reported (5.1, 5.5, 6.9, 7.2, 7.10). The setup screen offers it as a first stop.
- **Plain-language readouts.** Predictions, Logit Lens, Why (DLA), Attention and Features each open with a sentence or two saying what the chart shows, like "The model's top guess is ' Paris' (62%)." Screen readers announce them.
- **Experiments.** A gallery of eight short guided experiments (name-swapping, knocking out heads, the logit lens, fact recall, "greater than", he/she, features and steering). Each sets everything up, says what to look for, and links the research it comes from.

### Fixed
- Swap & Compare's **Residual** view showed 100% at every layer, which said nothing. It now swaps one layer at one word at a time and shows a layer × word grid, so you can see where in the sentence the deciding information sits at each depth.
- The Attention readout follows the From/To toggle.

## 0.2.0

### New
- **Computers without a graphics card can use Pry.** GPT-2 small and Pythia-70M now run on the CPU (slower, but they work). The model picker says "Works on your computer (slower)" instead of locking you out.
- **Engine status and restart.** A chip in the header shows whether the engine is on the GPU or CPU, which model and layer are loaded, and has a Restart button. If the engine stops, a banner says so within a couple of seconds and offers to restart it.
- **Real download progress.** First-time model downloads show megabytes, not a frozen bar.
- **Save results to a file.** Export now opens a normal Save dialog.
- **Swap & Compare starts with a working example** (the "Mary and John" sentence pair) and shows live word counts for both prompts, so it's clear when they don't match.
- Steering now shows only the words the model added, with the changes highlighted word by word.
- Pythia-70M is now offered during setup, and every model's Neuronpedia links point to the right place.
- **Newer GPU engine (PyTorch 2.7, CUDA 12.8).** New installs on NVIDIA drivers 572.30 or newer get it; this is the engine RTX 50-series cards need. Results are identical to the old engine (checked number for number on CPU and on an RTX 4070 SUPER). RTX 50-series support hasn't been tested on one yet. Existing GPU installs keep their current engine and aren't asked to re-download, except on RTX 50-series cards, which can't run it. CPU-only installs get a one-time ~420 MB engine update.

### Fixed
- The guided tour could get stuck after a failed run. It now offers Try again or Skip, and always uses GPT-2 small.
- "Why (DLA)" didn't refresh when you clicked a different word.
- The feature history chart showed "not in the top 5" the same as zero. It's now shown as a hatched bar.
- Models that aren't available yet say "Coming soon" instead of "Not enough memory".
- A saved Hugging Face token now actually reaches the engine.
- Upgrading no longer sends existing users back through the welcome screens; Pry shows a short "Updating Pry…" step instead.
- Error messages are plain language, with details available.

### Under the hood
- The engine only accepts requests that carry Pry's key (a fresh one each launch), so web pages and other apps on your computer can't drive it.
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
