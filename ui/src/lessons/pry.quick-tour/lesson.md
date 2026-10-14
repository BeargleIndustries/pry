---
format: 1
id: pry.quick-tour
title: "What's on Pry's screen?"
tool: pry
summary: "Five minutes on where everything sits on Pry's screen. The tour doesn't run anything, and Lessons explain what you see."
minutes: 5
presentation: overlay
prerequisites: []
---

## Welcome {id=step-1 outline=quick-tour.md#3.1}

:::explain
Pry runs GPT-2 small, a small AI model that continues text, right here on your computer, and it lets you peek inside. This tour points out where things are, and Lessons explain them.
:::

## The prompt box and Run {id=step-2 outline=quick-tour.md#3.2}

:::explain
Type any text in :look{at=[prompt-input, run-button]}[the box]. There's an example in it already, and you can keep it or replace it. Press Run to send it through the model. Your text doesn't leave your computer.
:::

## The token strip {id=step-3 outline=quick-tour.md#3.3}

:::explain
After a run, your text shows up in :look{at=token-strip}[the strip] labelled "Words (tokens)", cut into the pieces the model reads. Click one to pick it, and the other panels follow the piece you picked. After you press Run, this fills in.
:::

## Predictions {id=step-4 outline=quick-tour.md#3.4}

:::enter
open_panel: predictions
:::

:::explain
:look{at=[right-tab-strip, predictions-panel]}["Predictions"] lists the model's top guesses for the next piece, each one with a bar. After you press Run, this fills in.
:::

## Watch it write {id=step-5 outline=quick-tour.md#3.5}

:::explain
:look{at=watch-it-write}["Watch it write"] keeps going where the prompt stops. It adds one piece at a time, so you can watch the text appear. After you press Run, this fills in.
:::

## Attention {id=step-6 outline=quick-tour.md#3.6}

:::enter
open_panel: attention
:::

:::explain
:look{at=[left-tab-strip, panel-a-lines]}["Attention"] draws lines between the pieces of your text. Hover over a line or a piece and you'll get the detail. After you press Run, this fills in.
:::

## The other left tabs {id=step-7 outline=quick-tour.md#3.7}

:::explain
The other tabs :look{at=left-tab-strip}[up here], "Logit Lens", "Why (DLA)", "Swap test" and "Key parts", are more views of the same run. Each one's got its own lesson. After you press Run, this fills in.
:::

## Features {id=step-8 outline=quick-tour.md#3.8}

:::enter
open_panel: features
:::

:::explain
:look{at=[tab-features, panel-b-features-list]}["Features"] lists patterns a separate tool found for the piece you picked, each with a label. "Steering", right next to it, lets you change one and run again, and there's a lesson that'll walk you through it. After you press Run, this fills in.
:::

## Compare, Notebook and export {id=step-9 outline=quick-tour.md#3.9}

:::explain
:look{at=[compare-button, notebook-button, export-button]}["Compare"] puts two prompts side by side. "Notebook" saves a run you'd like to come back to, and export saves it as a file.
:::

## The model menu {id=step-10 outline=quick-tour.md#3.10}

:::explain
This :look{at=model-switcher}[menu] switches models, and each one's got a badge for how well it'll fit your computer. Lessons use GPT-2 small.
:::

## The engine chip {id=step-11 outline=quick-tour.md#3.11}

:::explain
This :look{at=engine-chip}[chip] shows the engine: whether it's running on your graphics card or your main processor, and which model's loaded. Click it for details and a Restart button.
:::

## Lessons, Help and Settings {id=step-12 outline=quick-tour.md#3.12}

:::explain
Want to know what all this means? Open :look{at=[lessons-toggle, header-help, settings-button]}[Lessons]: short lessons that use these same panels, starting with "Is there a database in there?". A word with a dotted underline has a glossary entry. The Help menu replays this tour, and Settings holds everything else you can change.
:::
