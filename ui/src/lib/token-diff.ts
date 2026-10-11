// Token-level LCS diff for the steering side-by-side view.
//
// Text is split into whitespace-preserving word tokens (words and the runs of
// whitespace between them are separate tokens), so joining a side's tokens
// gives back the original string exactly. Tokens that are in the longest
// common subsequence are unchanged; the rest are marked changed: deletions on
// the left side, insertions on the right.

export interface DiffToken {
  text: string;
  changed: boolean;
}

export interface TokenDiff {
  left: DiffToken[];
  right: DiffToken[];
}

/** Split into word and whitespace tokens; `tokens.join('') === text`. */
export function wordTokens(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

export function diffTokens(leftText: string, rightText: string): TokenDiff {
  const a = wordTokens(leftText);
  const b = wordTokens(rightText);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const left: DiffToken[] = [];
  const right: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      left.push({ text: a[i], changed: false });
      right.push({ text: b[j], changed: false });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      left.push({ text: a[i++], changed: true });
    } else {
      right.push({ text: b[j++], changed: true });
    }
  }
  while (i < n) left.push({ text: a[i++], changed: true });
  while (j < m) right.push({ text: b[j++], changed: true });
  return { left, right };
}
