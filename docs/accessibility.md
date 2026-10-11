# Accessibility in Pry

This page lists Pry's keyboard controls, panel by panel, and what a screen reader should announce. Use it for the keyboard-only and NVDA walkthrough. It was written for T29 (0.3.2).

## Ground rules

- **Tab / Shift+Tab** moves between controls. Every grid of cells is **one Tab stop**. Once you are inside a grid, the arrow keys move between its cells.
- **Inside any grid:**

  | Key | Does |
  | --- | --- |
  | Arrow keys | Move one cell. Movement stops at the edges and does not wrap around. |
  | Home / End | Go to the first or last cell in the row. |
  | Ctrl+Home / Ctrl+End | Go to the first or last cell in the grid. |
  | PageUp / PageDown | Go to the top or bottom row, in the same column. |
  | Enter / Space | Activate the cell, in grids where cells do something. |

  When you Tab back into a grid, focus returns to the last cell you were on. A focused cell has a white ring.
- **Escape** closes dialogs, the Settings drawer, the tutorial menu, the hardware card, and glossary pop-ups.
- **Glossary words** have a dotted underline. Tab to one and its definition appears. A screen reader reads the definition as the word's description.
- **Summaries.** Most panels start with an "In plain words" summary. It is a polite live region, so NVDA reads it when it changes without interrupting you. The panel's chart or grid also uses the summary as its description, so NVDA reads it again when focus enters the grid.
- **Colour.** Positive values are blue and negative values are orange, a pair that stays distinct for common kinds of colour blindness. Colour is never the only cue: every signed value also shows a + or − sign in its text, label, tooltip or cell.

## Header and layout

- **Prompt box:** gets focus once, when the app first opens. Enter runs the prompt.
- **Tutorial button** (?): Enter opens the tour menu, and Escape closes it.
- **Divider between the two halves** (wide window): Tab to it. Left and Right arrows move it 2% at a time, and Home/End move it as far as it goes. NVDA announces the split as a percentage.
- **Tabs** (Attention / Features, and the tabs at the top of each half): Left and Right arrows switch tabs. Only the selected tab is a Tab stop.

## Attention panel (PanelA)

- **Summary:** "In plain words: …" describes where the focused word looks.
- **Token strip:** one button per word. Enter picks the word.
- **Lines view (the default):** there are two word columns. Up and Down arrows (and Home/End) move through the words and pick each one as you go. The drawing has a text description, and the summary is its accessible description.
- **Expert view (layer × head grid):** this is a grid. Each cell reads, for example, "Layer 3, head 7: score 0.412", plus "Knocked out" or "Not knocked out" when ablation is on. Focusing a cell shows the same tooltip as hovering over it.
  - **Enter / Space** opens the head's full attention matrix, and focus moves to its Close button. Closing returns focus to the same cell.
  - **In ablation mode,** Enter / Space knocks the head out or puts it back. Knocked-out cells show a ×.
- **Copying heads view:** the grid is a picture with a text label. The ringed heads are also listed in text under it.

## Logit Lens panel

- This is a grid. The top row is the last layer, and each column is one word. Each cell reads, for example, "Layer 5, word 3 "cat": guesses " the" at 12.0%, matches the final prediction".
- Focusing a cell shows the hover tooltip. The cells don't do anything when activated.
- The panel summary and the legend are the grid's description.

## Direct Logit Attribution panel

- This is a list, largest first, not a grid. Each item reads, for example, "1. Attention layer 9 head 6: +1.204, pushed toward the prediction".
- The bars are blue (+, to the right) or orange (−, to the left). The summary and legend describe the list.

## Key parts panel (CircuitPanel)

- **Threshold box:** has a proper label.
- **The parts:** this is a grid with one row per layer, highest layer at the top. The columns are the parts in that layer, left to right, so rows can have different lengths. Up and Down keep the column when they can.
- Each part reads, for example, "Attention head, layer 9 head 6: importance +1.2040, pushed toward the prediction". Circles are attention heads and squares are MLPs. Fill is blue (+) or orange (−). The node text also shows the sign.
- **Enter / Space** shows the part's details below the drawing.

## Activation Patching panel

- **Patch type buttons:** a labelled group. The selected one is announced as "pressed".
- **Head grid (layer × head) and Residual grid (layer × word):** these are grids. Each cell reads, for example, "Layer 9, head 9: effect +0.412, brings back the original answer" or "… effect −0.105, pushes further from the original". Stronger cells also show + or − inside the square.
- **Enter / Space** (they are native buttons) shows the details box under the grid. The selected cell is announced as "selected".
- **MLP patching** is a list of buttons, one per MLP, each showing its signed effect.

## Compare mode

- **Prompt A / B** have labels. Enter in either box runs both prompts.
- **Next-word table:** the Change column is blue (+) or orange (−) and always shows a sign or "≥ / ≤".
- **Head difference grid:** this is a grid. Each cell reads, for example, "Layer 2, head 5: 34% different". The focused cell's value is also printed under the grid for sighted keyboard users. The cells don't do anything when activated. The comparison summary is part of the grid's description.

## Steering panel

- **Feature picker and Steering strength slider:** both have proper labels. The slider announces its value and whether it suppresses or amplifies.

## Known gaps (for the walkthrough to confirm)

- The expanded attention matrix is a canvas. It has a text label but no cell-by-cell access. Use the Lines view to step through words instead.
- The copying-heads grid can't be navigated cell by cell. Its findings are listed as text below it.
- NVDA behaviour with `aria-describedby` on SVG grids has not been checked by hand yet. The walkthrough should confirm that the summary is read when focus enters each grid.
