import { describe, expect, it } from "vitest";
import { calculate, getTaxYearConfig, tfcEligibleUntil } from "../index";
import { child, household, parent } from "./fixtures";

const couple = { parentA: parent(50_000), parentB: parent(40_000, {}, "Parent B") };

describe("TFC top-up (#3)", () => {
  it("is 20% of the bill, not 25%", () => {
    // Child aged 7: no funded hours, so the bill is the full £8,000
    const r = calculate(household({ ...couple, children: [child("2018-05-01")], estimatedAnnualChildcareSpend: 8_000 }));
    expect(r.tfc.estimatedActualTopUpAnnual).toBeCloseTo(1_600, 2);
  });

  it("caps each child separately rather than pooling", () => {
    const r = calculate(household({
      ...couple,
      children: [
        child("2018-05-01", { annualChildcareCost: 20_000 }),
        child("2017-05-01", { annualChildcareCost: 1_000 }),
      ],
    }));
    // £2,000 cap for the first child + 20% × £1,000 for the second
    expect(r.tfc.estimatedActualTopUpAnnual).toBeCloseTo(2_200, 2);
  });

  it("is zero when nothing is spent", () => {
    const r = calculate(household({ ...couple, children: [child("2018-05-01")], estimatedAnnualChildcareSpend: 0 }));
    expect(r.tfc.estimatedActualTopUpAnnual).toBe(0);
  });

  it("uses the bill after funded hours", () => {
    const r = calculate(household({ ...couple, children: [child("2022-01-15")], estimatedAnnualChildcareSpend: 15_000 }));
    const funded = r.freeHours.children[0].workingParentAnnualValue;
    expect(funded).toBeGreaterThan(0);
    expect(r.tfc.estimatedActualTopUpAnnual).toBeCloseTo(Math.min((15_000 - funded) * 0.2, 2_000), 2);
  });
});

describe("TFC age limit (#14)", () => {
  const config = getTaxYearConfig("2026/27");

  it("ends on the 1 September after the 11th birthday", () => {
    expect(tfcEligibleUntil(child("2014-12-01"), config).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(tfcEligibleUntil(child("2014-12-01", { isDisabled: true }), config).toISOString().slice(0, 10)).toBe("2031-09-01");
  });

  it("stops counting a child who has passed the cut-off", () => {
    const r = calculate(household({
      ...couple,
      taxYear: "2026/27",
      asOfDate: "2026-09-26",
      children: [child("2014-12-01")],
      estimatedAnnualChildcareSpend: 10_000,
    }));
    expect(r.tfc.eligibleChildCount).toBe(0);
    // Eligible for the Apr and Jul quarters only
    expect(r.tfc.maxPossibleTopUpAnnual).toBeCloseTo(1_000, 2);
  });
});
