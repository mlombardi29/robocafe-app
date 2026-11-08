import { describe, expect, it } from "vitest";
import { conversionLabel, onHandLabel, positivePerBase, toBaseQty } from "./packEntry";

const sleeves = { id: "p1", name: "sleeves", perBase: 50 };
const box = { id: "p2", name: "box of 1,000", perBase: 20 };

describe("pack entry conversion", () => {
  it("converts packs to base units and shows the conversion line", () => {
    expect(toBaseQty({ kind: "pack", packId: "p1" }, 2, [sleeves])).toBe(100);
    expect(conversionLabel({ kind: "pack", packId: "p1" }, 2, [sleeves], "cups")).toBe(
      "2 sleeves of 50 = 100 cups",
    );
    expect(toBaseQty({ kind: "base" }, 7, [sleeves])).toBe(7);
    expect(conversionLabel({ kind: "base" }, 7, [sleeves], "cups")).toBe("7 cups");
  });

  it("rejects unknown packs and non-positive per_base", () => {
    expect(toBaseQty({ kind: "pack", packId: "missing" }, 1, [sleeves])).toBeNull();
    expect(positivePerBase(0)).toBeNull();
    expect(positivePerBase(-3)).toBeNull();
    expect(conversionLabel({ kind: "pack", packId: "p2" }, 1, [{ ...box, perBase: 0 }], "cups")).toBeNull();
  });

  it("labels on-hand with pack breakdown without inventing terminology", () => {
    expect(onHandLabel(100, "cups", [sleeves])).toBe("100 cups (2 sleeves)");
    expect(onHandLabel(110, "cups", [sleeves])).toBe("110 cups (2 sleeves + 10 cups)");
    expect(onHandLabel(5, "bottle", [])).toBe("5 bottle");
  });
});
