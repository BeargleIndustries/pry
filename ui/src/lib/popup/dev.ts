// Dev-only switches for the popup audit. `POPUP_AUDIT` is a build-time
// constant: true in `vite dev`, or in a build made with VITE_POPUP_AUDIT=1
// (the harness build). In normal release builds it's false and everything
// guarded by it is dropped.

export const POPUP_AUDIT: boolean = import.meta.env.DEV || import.meta.env.VITE_POPUP_AUDIT === '1';

/** What a forced tip reports back to the audit. */
export interface ForcedTipReport {
  id: string;
  shown: boolean;
  /** Not shown because its target is covered (e.g. by the experiment guide). */
  waiting: boolean;
  /** Not shown because the tip only shows while Lessons is closed (TipDef.whileLessonsClosed). */
  heldByLessons?: boolean;
  reason?: string;
}

/** Hooks components install for the audit (only when POPUP_AUDIT). */
export const popupDevHooks: {
  forceTip?: (id: string) => Promise<ForcedTipReport>;
  clearForcedTip?: () => void;
} = {};
