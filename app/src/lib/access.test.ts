import { describe, expect, it } from "vitest";
import { canChangeSubmittedTimes, canReadRow, canWriteSession, inPractice } from "./access";

describe("practice and live isolation", () => {
  it("keeps trainees in practice", () => {
    expect(inPractice("trainee", "live")).toBe(true);
    expect(inPractice("tech", "live")).toBe(false);
    expect(inPractice("tech", "practice")).toBe(true);
  });

  it("hides live rows from a trainee and from a tech in practice", () => {
    expect(
      canReadRow({ active: true, role: "trainee", mode: "live", rowSandbox: false, assigned: true }),
    ).toBe(false);
    expect(
      canWriteSession({ active: true, role: "tech", mode: "practice", siteSandbox: false, assigned: true, self: true }),
    ).toBe(false);
    expect(
      canReadRow({ active: true, role: "tech", mode: "practice", rowSandbox: false, assigned: true }),
    ).toBe(false);
  });

  it("lets a live tech read and write only assigned live sites", () => {
    expect(
      canReadRow({ active: true, role: "tech", mode: "live", rowSandbox: false, assigned: false }),
    ).toBe(false);
    expect(
      canWriteSession({ active: true, role: "tech", mode: "live", siteSandbox: false, assigned: true, self: true }),
    ).toBe(true);
    expect(
      canWriteSession({ active: true, role: "tech", mode: "live", siteSandbox: true, assigned: true, self: true }),
    ).toBe(false);
  });

  it("lets practice mode write the sandbox, including an admin", () => {
    expect(
      canWriteSession({ active: true, role: "tech", mode: "practice", siteSandbox: true, assigned: false, self: true }),
    ).toBe(true);
    expect(
      canWriteSession({ active: true, role: "admin", mode: "practice", siteSandbox: false, assigned: true, self: true }),
    ).toBe(false);
    expect(
      canReadRow({ active: true, role: "admin", mode: "practice", rowSandbox: false, assigned: false }),
    ).toBe(true);
  });

  it("blocks inactive people and visitors from writes", () => {
    expect(
      canWriteSession({ active: false, role: "tech", mode: "live", siteSandbox: false, assigned: true, self: true }),
    ).toBe(false);
    expect(
      canWriteSession({ active: true, role: "visitor", mode: "live", siteSandbox: false, assigned: true, self: true }),
    ).toBe(false);
  });

  it("locks submitted times for techs", () => {
    expect(canChangeSubmittedTimes("tech", true)).toBe(false);
    expect(canChangeSubmittedTimes("trainee", true)).toBe(false);
    expect(canChangeSubmittedTimes("admin", true)).toBe(true);
    expect(canChangeSubmittedTimes("tech", false)).toBe(true);
  });

  it("still lets every active person read checklist content", () => {
    expect(
      canReadRow({
        active: true,
        role: "trainee",
        mode: "practice",
        rowSandbox: false,
        assigned: false,
        contentTable: true,
      }),
    ).toBe(true);
  });
});
