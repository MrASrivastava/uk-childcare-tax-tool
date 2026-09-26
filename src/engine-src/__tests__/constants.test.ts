import { describe, expect, it } from "vitest";
import {
  calculate,
  calculatePensionCarryForward,
  getTaxYearConfig,
  minimumIncomeQuarterly,
  minimumIncomeTest,
} from "../index";
import { child, household, parent } from "./fixtures";

describe("minimum income threshold (#9)", () => {
  it("uses the 2026/27 minimum wage", () => {
    const c = getTaxYearConfig("2026/27");
    expect(minimumIncomeQuarterly(c, "21_plus")).toBeCloseTo(2_643.68, 2);
    expect(c.freeHours.minimumIncomeThreshold).toBeCloseTo(10_574.72, 2);
  });
  it("uses the 2025/26 age-band rates", () => {
    const c = getTaxYearConfig("2025/26");
    expect(minimumIncomeQuarterly(c, "21_plus")).toBeCloseTo(2_539.68, 2);
    expect(minimumIncomeQuarterly(c, "18_to_20")).toBeCloseTo(2_080, 2);
    expect(minimumIncomeQuarterly(c, "under_18_or_apprentice")).toBeCloseTo(1_570.4, 2);
  });
});

describe("minimum income test on earnings (#15)", () => {
  const c = getTaxYearConfig("2025/26");
  it("fails a parent whose income is rent, not work", () => {
    expect(minimumIncomeTest(parent(0, { rentalIncomeNet: 20_000 }), c).meets).toBe(false);
  });
  it("passes a working parent even with a large SIPP contribution", () => {
    const p = parent(30_000, { personalPensionContributions: { reliefAtSourceNet: 16_000, netPayArrangementGross: 0 } });
    expect(minimumIncomeTest(p, c).meets).toBe(true);
  });
  it("uses the explicit next-3-months figure and the age band", () => {
    expect(minimumIncomeTest(parent(40_000, { expectedEarningsNext3Months: 2_100 }), c).meets).toBe(false);
    expect(minimumIncomeTest(parent(40_000, { expectedEarningsNext3Months: 2_100, ageBand: "18_to_20" }), c).meets).toBe(true);
  });
  it("lets the self-employed average over the year", () => {
    expect(minimumIncomeTest(parent(0, { selfEmploymentProfit: 20_000, expectedEarningsNext3Months: 500, selfEmployed: true }), c).meets).toBe(true);
  });
  it("feeds TFC eligibility", () => {
    const r = calculate(household({
      parentA: parent(50_000),
      parentB: parent(0, { rentalIncomeNet: 20_000 }, "Parent B"),
      children: [child("2018-05-01")],
      estimatedAnnualChildcareSpend: 5_000,
    }));
    expect(r.tfc.eligible.status).toBe("not_eligible");
  });
});

describe("carry-forward (#12)", () => {
  const prior = { totalContributionsMinus1Year: 0, totalContributionsMinus2Years: 0, totalContributionsMinus3Years: 0 };
  it("uses each prior year's own Annual Allowance", () => {
    expect(calculatePensionCarryForward(parent(50_000, { priorYearPensionAllowances: prior }), getTaxYearConfig("2025/26"))).toBe(160_000);
    expect(calculatePensionCarryForward(parent(50_000, { priorYearPensionAllowances: prior }), getTaxYearConfig("2026/27"))).toBe(180_000);
  });
  it("excludes years without scheme membership", () => {
    const p = parent(50_000, { priorYearPensionAllowances: { ...prior, schemeMemberMinus3Years: false } });
    expect(calculatePensionCarryForward(p, getTaxYearConfig("2025/26"))).toBe(120_000);
  });
});

describe("free hours valued at the provider's rate (#13)", () => {
  const base = {
    parentA: parent(50_000),
    parentB: parent(40_000, {}, "Parent B"),
    children: [child("2021-06-15")], // aged 3–4 through 2025/26
  };
  it("uses providerHourlyRates when given", () => {
    const r = calculate(household({ ...base, providerHourlyRates: { under2: 15, age2: 12, age3to4: 10 } }));
    expect(r.freeHours.children[0].workingParentAnnualValue).toBeCloseTo(30 * 38 * 10, 2);
  });
  it("falls back to the national average funding rate", () => {
    const r = calculate(household(base));
    expect(r.freeHours.children[0].workingParentAnnualValue).toBeCloseTo(30 * 38 * 6.42, 2);
  });
});
