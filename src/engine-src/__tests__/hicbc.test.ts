import { describe, expect, it } from "vitest";
import { calculate, computeHICBCCharge, getTaxYearConfig } from "../index";
import { child, household, parent } from "./fixtures";

describe("Child Benefit rates (#8)", () => {
  it("uses £26.05 for one child in 2025/26", () => {
    const r = calculate(household({ children: [child("2020-01-01")] }));
    expect(r.hicbc.grossChildBenefitAnnual).toBeCloseTo(1_354.6, 2);
  });
  it("uses £27.05 in 2026/27", () => {
    const r = calculate(household({ taxYear: "2026/27", children: [child("2020-01-01")] }));
    expect(r.hicbc.grossChildBenefitAnnual).toBeCloseTo(27.05 * 52, 2);
  });
});

describe("HICBC steps (#21)", () => {
  const config = getTaxYearConfig("2025/26");
  it("charges 1% per complete £200", () => {
    expect(computeHICBCCharge(60_399, 1_000, config).retentionFraction).toBe(0.01);
    expect(computeHICBCCharge(60_400, 1_000, config).retentionFraction).toBe(0.02);
    expect(computeHICBCCharge(79_999, 1_000, config).retentionFraction).toBe(0.99);
    expect(computeHICBCCharge(95_000, 1_000, config).retentionFraction).toBe(1);
  });
});

describe("HICBC admin (#18)", () => {
  it("offers PAYE for employees with no other reason to file", () => {
    const r = calculate(household({ parentA: parent(70_000), children: [child("2020-01-01")] }));
    expect(r.hicbc.payeOptionAvailable).toBe(true);
    expect(r.hicbc.selfAssessmentRequired).toBe(false);
  });
  it("requires Self Assessment when the higher earner has rental income", () => {
    const r = calculate(household({ parentA: parent(65_000, { rentalIncomeNet: 5_000 }), children: [child("2020-01-01")] }));
    expect(r.hicbc.selfAssessmentRequired).toBe(true);
    expect(r.hicbc.payeOptionAvailable).toBe(false);
  });
});
