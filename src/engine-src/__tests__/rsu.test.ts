import { describe, expect, it } from "vitest";
import { calculate, rsuVestDateForTaxYear } from "../index";
import { household, parent } from "./fixtures";

describe("RSU vest dates", () => {
  it("builds a vest date inside the selected tax year", () => {
    expect(rsuVestDateForTaxYear("2025/26")).toBe("2025-10-01");
    expect(rsuVestDateForTaxYear("2026/27")).toBe("2026-10-01");
  });

  it("counts a vest inside 2026/27 towards ANI", () => {
    const r = calculate(household({
      taxYear: "2026/27",
      asOfDate: "2026-10-15",
      parentA: parent(60_000, {
        rsuVests: [{ vestDate: rsuVestDateForTaxYear("2026/27"), grossValue: 30_000, employerNICTransferred: false }],
      }),
    }));
    expect(r.parentA.ani.rsuIncome).toBe(30_000);
    expect(r.parentA.ani.adjustedNetIncome).toBe(90_000);
  });

  it("ignores a vest dated in a different tax year", () => {
    const r = calculate(household({
      taxYear: "2026/27",
      parentA: parent(60_000, {
        rsuVests: [{ vestDate: "2025-10-01", grossValue: 30_000, employerNICTransferred: false }],
      }),
    }));
    expect(r.parentA.ani.rsuIncome).toBe(0);
  });
});
