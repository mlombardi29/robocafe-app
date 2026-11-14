import { describe, expect, it } from "vitest";
import { CONFIG_KEY_SPECS, isEditableConfigKey } from "./configKeys";

describe("configKeys", () => {
  it("never exposes notification or secret-looking keys", () => {
    const keys = CONFIG_KEY_SPECS.map((row) => row.key).join(" ");
    expect(keys).not.toMatch(/email|recipient|secret|token|drive|relay|password/i);
  });

  it("allows editing the soft-policy toggles but not migration stamps", () => {
    expect(isEditableConfigKey("uoft_before_opening")).toBe(true);
    expect(isEditableConfigKey("dupont_espresso_float_bags")).toBe(true);
    expect(isEditableConfigKey("reimbursement_approval_limit")).toBe(true);
    expect(isEditableConfigKey("coverage_charges_migration")).toBe(false);
    expect(isEditableConfigKey("coverage_pay_rule")).toBe(false);
  });
});
