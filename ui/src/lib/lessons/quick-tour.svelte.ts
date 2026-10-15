// Whether the quick tour is up, and on which step. The page writes it from
// the Lessons runner (the tour is an overlay lesson, `pry.quick-tour`); the
// first-time tips read it so a tip never shows over the tour card.

export const quickTour = $state({ open: false, step: null as string | null });
