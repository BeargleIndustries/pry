// Row constants (plan:297, :299): the authored values lessons cite as
// `$row.<id>.<field>` (action arguments, overlays, check values) and
// `{row: <id>.<field>}` (slots). `npm run lessons:compile -- --rows` derives
// them from each row's recorded values by the row's `constants:` block in
// verified-rows.yaml and writes them to rows.json `rows[].constants`.

import rowsJson from '../../lessons/__generated__/rows.json';

/** How a constant renders; the slot formats plus `head` (an integer), `list` and `record` ({layer, head}). */
export const ROW_UNITS = ['layer', 'head', 'position', 'probability', 'logit', 'count', 'number', 'string', 'list', 'record'] as const;
export type RowUnit = (typeof ROW_UNITS)[number];

export interface RowConstant {
  value: unknown;
  unit: RowUnit;
  /** A list's element unit. */
  of?: RowUnit;
}
export type RowConstants = Record<string, RowConstant>;

type RowsDoc = { rows: { id: number; constants?: RowConstants }[] };

/** Row id -> its constants, from a rows.json document. */
export function constantsByRow(doc: unknown): Record<string, RowConstants> {
  const out: Record<string, RowConstants> = {};
  for (const r of (doc as RowsDoc).rows ?? []) if (r.constants) out[String(r.id)] = r.constants;
  return out;
}

const BUNDLED = constantsByRow(rowsJson);

/** A bundled lesson's row constant (undefined when the row or field has none). */
export function rowConstant(id: string, field: string): RowConstant | undefined {
  return BUNDLED[id]?.[field];
}

/** The value `$row.<id>.<field>` resolves to at run time. */
export function rowValue(id: string, field: string): unknown {
  return rowConstant(id, field)?.value;
}
