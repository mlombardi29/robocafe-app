import { describe, expect, it } from "vitest";
import { composeButtonClass } from "./buttonStyles";
import {
  actionButtonClass,
  checklistCardsClass,
  classTokens,
  disclosureClass,
  noteFieldClass,
  stepCardClass,
} from "./checklistLayout";

describe("compact checklist layout", () => {
  it("uses a short card and keeps the scroll clearance for the fixed bars", () => {
    const tokens = classTokens(stepCardClass());
    expect(tokens).toContain("px-3");
    expect(tokens).toContain("py-2.5");
    expect(tokens).toContain("scroll-mt-4");
    expect(tokens).toContain("scroll-mb-40");
    expect(tokens).not.toContain("p-4");
    expect(tokens).not.toContain("rounded-3xl");
  });

  it("highlights the focused step without dropping the scroll margin", () => {
    const tokens = classTokens(stepCardClass(true, true));
    expect(tokens).toContain("ring-amber-500");
    expect(tokens).toContain("scroll-mb-40");
  });

  it("keeps an overdue card outlined when it is not the focused step", () => {
    expect(classTokens(stepCardClass(false, true))).toContain("ring-red-300");
  });

  it("opens a note into a short field, not a tall blank box", () => {
    const tokens = classTokens(noteFieldClass);
    expect(tokens).toContain("min-h-11");
    expect(tokens).toContain("text-base");
    expect(tokens).not.toContain("min-h-24");
    expect(tokens).not.toContain("min-h-12");
  });

  it("keeps Note and Details at least 44px with full-size text", () => {
    const tokens = classTokens(disclosureClass);
    expect(tokens).toContain("min-h-11");
    expect(tokens).toContain("text-base");
    expect(tokens).not.toContain("text-sm");
    expect(tokens).not.toContain("text-xs");
  });

  it("keeps Done and Not needed on a wrapping row at the 48px button height", () => {
    const button = classTokens(composeButtonClass("quiet", actionButtonClass));
    expect(button).toContain("min-h-12");
    expect(button).toContain("text-base");
    expect(button).toContain("min-w-[7.5rem]");
    expect(classTokens(checklistCardsClass)).toContain("gap-2");
  });
});
