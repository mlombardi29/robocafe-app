import { describe, expect, it } from "vitest";
import { offboardingTitles } from "./offboarding";

describe("offboarding task titles", () => {
  it("names what to return and which label to change, without a code", () => {
    const titles = offboardingTitles({
      personName: "Alex",
      assets: [{ siteName: "Sinai", kind: "key_card" }],
      codeLabels: [{ siteName: "UofT", label: "After-hours lock box" }],
    });
    expect(titles).toEqual([
      "Return the key card for Sinai.",
      "Change the After-hours lock box at UofT.",
    ]);
    expect(titles.join(" ")).not.toMatch(/\d{2,}|combo|password/i);
  });

  it("asks for a check when the person holds nothing", () => {
    expect(offboardingTitles({ personName: "Alex", assets: [], codeLabels: [] })).toEqual([
      "Confirm Alex has nothing to return.",
    ]);
  });
});
