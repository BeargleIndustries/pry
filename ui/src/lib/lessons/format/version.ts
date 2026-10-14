// Lesson format version (plan "Format versioning story"). Format 1 is frozen in
// 0.4.0; changes within it are additive only.

export const LESSON_FORMAT = 1;

/** Compares dotted numeric versions ("0.4.0" vs "0.4.1"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
