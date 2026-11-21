export type ButtonTone = "primary" | "quiet" | "danger" | "start" | "complete" | "neutral" | "neutralOn";

const toneClass: Record<ButtonTone, string> = {
  primary: "bg-[var(--accent)] text-white",
  quiet: "bg-white text-stone-800 ring-1 ring-stone-200",
  danger: "bg-red-700 text-white",
  start: "bg-green-700 text-white",
  complete: "bg-green-50 text-green-900 ring-2 ring-green-700",
  neutral: "bg-stone-200 text-stone-900",
  neutralOn: "bg-stone-300 text-stone-950 ring-2 ring-stone-700",
};

export function composeButtonClass(tone: ButtonTone, extra = ""): string {
  return `min-h-12 rounded-2xl px-4 text-base font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${toneClass[tone]} ${extra}`.trim();
}

/**
 * Tailwind emits .text-white after .text-stone-900, so a class list that
 * contains both bg-white and text-white paints white text on white.
 */
export function hasWhiteOnWhite(className: string): boolean {
  const parts = className.split(/\s+/).filter(Boolean);
  return parts.includes("bg-white") && parts.includes("text-white");
}

export const TIMER_DONE_LABEL = "Mark cleaning done";

export function timerDoneButtonClass(): string {
  return composeButtonClass("quiet", "mt-3");
}
