# Changelog

## 0.4.0

### New
- **Lessons.** 19 lessons and a 12-step quick tour, in four stages: what a model is made of, looking inside (attention, the logit lens, DLA, SAE features), testing what's a cause (knockouts, activation patching, steering, two case studies), and why GPT-2 doesn't act like ChatGPT. A lesson opens in a sidebar docked beside the app and runs Pry for you one section at a time. It'll ask for your guess before it shows you a result, and every result has a line under it saying how far you can trust it. Back and forward put the app back the way that section had it, prompt and panels included. Open Lessons from the header; Settings picks which side it docks on. At 1024 pixels wide the app gets tabs so both fit.
- **Write your own lessons.** Lessons are Markdown files in a public format with its own version number, `format: 1`. For 0.4.x that's a preview. Format 1's frozen, so a lesson you write now keeps opening. `AUTHORING.md` walks you from the template to an installed lesson, and a checker reads your file before Pry loads it. When you install someone's lesson, Pry lists anything it does beyond looking at the app (downloading a model, looking things up online, opening links) and asks you once. You can take that back in Settings > Lessons.
- **The quick tour replaces the 38-step tour and the experiment guides.** The old experiments live on as lessons, so nothing's lost. If you'd started the old tour, the lessons it covered show as visited.

### Changed: every number shows where it comes from
- **Predictions.** Each bar's width is its probability on a 0-100% track (a 9% bar is 9% wide), with an "Everything else" row for whatever the top ten leave over. Click a bar to see its logit.
- **Why (DLA).** Pick the answer token, and if you want, a second token to compare it against. A line under the bars gives the bars' total, the model's logit (with a contrast, both logits and their difference), and the gap between them. That gap's the embedding's own direct push plus the attention-output and unembedding biases, which have no bar of their own. Before, the bars could add up to less than the logit and nothing said why.
- **Swap test.** Above the grid you get the target token's logit in all three runs: Original prompt, Changed prompt, and after the swap. Each square's share is worked out beside them: share = (after the swap - Changed) ÷ (Original - Changed). When Original and Changed give nearly the same logit, Pry says a share doesn't mean anything there.
- **Steering.** Four parts, in order: what changed (changed tokens marked), how natural each text reads to the unsteered model (average log-probability per token, both numbers shown), a control run, and the scale. The control steers a different feature of about the same size at the same strength. If it changes the text just as much, the change might not be about your feature. The scale line puts your strength next to how strongly the feature fires on this prompt. A repetitive loop scores as very natural on this measure, so read the two numbers next to the text they're scoring.
- **Embedding reader.** A new view in the lessons puts two token positions side by side and counts how many of their 768 numbers match, with the embedding and the positional embedding as separate rows. Same token at two positions? Identical embedding, different positional embedding.

### Notebook
- The notebook moves to schemaVersion 2, which keeps your lesson answers and where each run came from (the model's revision and the feature dictionary). **Pry 0.3.8 can't open a version 2 notebook.** Before its first save, 0.4.0 copies your old file, byte for byte, to `notebook.v1.json` in the same folder. To go back to 0.3.8, rename `notebook.v1.json` to `notebook.json`... anything you saved in 0.4.0 won't be in it, so export that first.

## 0.3.8

### New
- **Experiment guides tell the whole story.** Each guide now keeps the experiment's goal and its prompt in view, says why it matters, shows what researchers found without a click, and ends with what to try next. Back to normal turns off the experiment's knockouts and copying-heads view and closes the guide, and it leaves your prompt alone. While the tour is open, the guide shrinks to its header so the two never overlap.
- **Popups sit next to what they're about.** Tour cards, tips, glossary words and grid hovers all find a spot beside their target, with a short arrow, instead of covering it. On a big panel the card sits inside the panel, next to the part it means. Every tour step also says where to look.
- **Clearer tour and tips.** Every step says what to press when it's asking you to do something, and the tips got another plain-words pass. Swap & Compare's now called Swap test (that's the name the guides use).
- A tip whose target is hidden behind an experiment guide waits until you close the guide, instead of popping up somewhere else.

### Fixed
- Switching the Features layer could leave the engine with no feature dictionary at all if the switch failed. Now Pry keeps the old layer, shows an error, puts the layer menu back, and Run still works.
- If you ran a new prompt while an analysis was still working, its results could land on the new prompt. Pry now drops results that belong to an older run.
- In the attention grid's TO view, each score counted the word's attention to itself. It now counts only the later words that look back at it.
- Why (DLA) and Key parts gave Gemma 2 2B's heads the wrong size, because they skipped a normalization step that Gemma has and GPT-2 doesn't.
- The Logit Lens on Gemma 2 2B now caps scores the same way the model does before turning them into chances.
- After an engine update, Pry reloads your model instead of sitting on an empty engine.
- Pry won't load two models at once. The model menu's off while a model loads, so a second load can't start on top of the first.

## 0.3.7

### New
- **Updates from inside Pry.** When Pry starts, it checks for a newer version while your model loads. If there is one, a click downloads it, installs it and reopens Pry, and your models, notebook and settings are kept. Every update is signed, and Pry won't install one whose signature doesn't match. You can turn the check off, or run it yourself, in Settings. After this one, new versions come through Pry itself, so you won't have to download them by hand.

### Fixed
- First-time tips wait until loading is done, instead of popping up while the loading screen is still showing.

## 0.3.6

### New
- **Loading screen.** Loading a model can take a minute, mostly while Pry starts up its math libraries (the first load after a restart is the slow one). Pry now shows which step it's on, how long it's been, and about how long is left, going by how long that model took last time. While you wait, you can flip through tips, experiments to try once it's ready, and glossary words.
- **New guided tour.** One path through the whole app in nine short chapters, from the basics to models and the engine. Jump to any chapter, pick up where you left off, or start over from the ? button or Settings. The tour runs each example for you and draws an arrow to whatever it's talking about.
- **Tips point at what they mean.** Each first-time tip names the thing it's about, with an arrow and a ring around it. Tips wait until that thing is on screen and usable, so you won't get one next to a greyed-out button anymore.

### Fixed
- The progress bar could sit at 40% for over a minute and then jump. It now keeps moving and never goes backwards.
- The Features layer menu was missing after the first Run on a new install.
- The Logit Lens summary could say a chance grows "from 42% to 42%". It now says when the chance peaks partway up the layers.
- Tips and experiment guides got a rewrite, with plainer words, and they describe the panels as they work now.

## 0.3.5

### Fixed
- The model menu in the header got cut off on the left, so you saw the fit badges but not the model names.
- Pry no longer reopens on a custom model you've removed.

## 0.3.4

### New
- **Gemma 2 2B** is available, with Google's Gemma Scope features (Neuronpedia labels included). It loads in a compact number format (bfloat16, about 6.5 GB of graphics memory) so it fits 12 GB cards; it needs a GPU. Google requires two steps first, and Pry walks you through them: accept the Gemma license on Hugging Face in your own browser, and save a Hugging Face token in Pry. If a load is refused, Pry says which step is missing. Gemma hasn't been tried end to end on a real machine yet, since that needs an account with the license accepted.
- **Add your own models from Hugging Face.** Type a model name and Pry checks it's a kind TransformerLens supports, estimates its size, and gives the same "fits / tight / too big" verdict as the built-in models. Added models are remembered. Most panels work on them: attention, copying heads, predictions, logit lens, Why (DLA), knockouts, Swap & Compare, Key parts, Compare and Watch it write. Features and Steering need a trained feature dictionary that Pry only has for the built-in models, and those panels say so.

### Fixed
- The model picker's memory check counted the operating system twice when it had a live reading of graphics memory, and also counted the model Pry already had loaded (which a switch unloads first). Models now get the verdict their real free memory supports.
- Loading any model that needs a Hugging Face login failed with an error inside Pry. The token was passed twice to one loader and in a form another loader doesn't accept.
- If you build Pry yourself on Windows, it no longer offers a 3.5 GB engine download you don't need. Windows-style line endings changed the fingerprint of one bundled file, so Pry thought its engine was out of date.

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
