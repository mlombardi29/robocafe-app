/** Visual classes for the service checklist. Layout only. */

export function stepCardClass(highlighted = false, overdue = false): string {
  const ring = highlighted ? "ring-2 ring-amber-500 ring-offset-2" : overdue ? "ring-red-300" : "ring-black/5";
  return `scroll-mt-4 scroll-mb-40 rounded-2xl bg-white px-3 py-2.5 shadow-sm outline-none ring-1 ${ring}`;
}

/** Closed by default. Two lines when opened, not a tall empty box. */
export const noteFieldClass =
  "mt-1 min-h-11 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-base leading-snug outline-none focus:border-[var(--accent)]";

/** 2.75rem is 44px. Labels stay at text-base. */
export const disclosureClass =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-base font-semibold text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export const actionRowClass = "mt-2 flex flex-wrap gap-2";

export const actionButtonClass = "min-w-[7.5rem] flex-1 !px-3";

export const checklistStackClass = "mt-4 grid gap-3";

export const checklistCardsClass = "grid gap-2";

export function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}
