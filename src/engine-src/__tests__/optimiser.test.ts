import { describe, expect, it } from "vitest";
import { calculate, computeCrossoverANI, generateMarginalRateChart, getTaxYearConfig } from "../index";
import { calculateCore } from "../engine/calculator";
import { child, household, parent } from "./fixtures";
import type { HouseholdInputs } from "../index";

const disposable = (i: HouseholdInputs) => calculateCore(i).householdSummary.totalHouseholdNetPosition;

describe("HICBC targets (#4)", () => {
  const inputs = household({ parentA: parent(85_000), children: [child("2020-01-01")] });
  const r = calculate(inputs);

  it("never targets £80,000", () => {
    expect(r.optimisationRecommendations.some((x) => x.aniReductionRequired === 5_000 && x.schemesRestored.length === 0)).toBe(false);
    for (const rec of r.optimisationRecommendations) {
      expect(rec.annualBenefitRestored).toBeGreaterThan(0);
    }
  });

  it("targets £60,000 and restores the full Child Benefit", () => {
    const rec = r.optimisationRecommendations.find((x) => x.lever === "salary_sacrifice_pension" && x.aniReductionRequired === 25_000);
    expect(rec).toBeDefined();
    expect(rec!.annualBenefitRestored).toBeCloseTo(r.hicbc.grossChildBenefitAnnual, 2);
  });
});

describe("net gain by recalculation (#5)", () => {
  const inputs = household({
    parentA: parent(105_000),
    parentB: parent(40_000, {}, "Parent B"),
    children: [child("2022-06-15")],
    estimatedAnnualChildcareSpend: 15_000,
  });
  const r = calculate(inputs);
  const cliffRecs = r.optimisationRecommendations.filter((x) => x.parentLabel === "Parent A" && x.aniReductionRequired === 5_000);

  it("prices salary sacrifice as the true change in household cash", () => {
    const rec = cliffRecs.find((x) => x.lever === "salary_sacrifice_pension")!;
    expect(rec.pensionPotIncrease).toBe(5_000);
    // £5,000 sacrifice at 40% tax + 20% PA taper + 2% NIC costs £1,900 of take-home
    expect(rec.netAnnualGain).toBeCloseTo(rec.annualBenefitRestored - 1_900, 2);
    expect(rec.schemesRestored).toEqual(expect.arrayContaining(["Tax-Free Childcare", "30-hour free childcare"]));
    const after = structuredClone(inputs);
    after.parentA.salarySacrifice.pension = 5_000;
    expect(rec.netAnnualGain).toBeCloseTo(disposable(after) - disposable(inputs), 6);
  });

  it("counts the cost of cycle-to-work and EV levers", () => {
    for (const lever of ["cycle_to_work", "ev_salary_sacrifice"] as const) {
      const rec = cliffRecs.find((x) => x.lever === lever)!;
      expect(rec.netAnnualGain).toBeLessThan(rec.annualBenefitRestored);
    }
  });

  it("sorts by net annual gain", () => {
    const gains = r.optimisationRecommendations.filter((x) => x.kind !== "protective").map((x) => x.netAnnualGain);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });

  it("gives the SIPP route the higher-rate relief", () => {
    const low = household({
      parentA: parent(105_000, { contractedHoursPerWeek: 500 }), // forces the SIPP route
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2022-06-15")],
      estimatedAnnualChildcareSpend: 15_000,
    });
    const rec = calculate(low).optimisationRecommendations.find((x) => x.lever === "personal_pension_sipp" && x.aniReductionRequired === 5_000)!;
    // £4,000 net paid; £1,000 back through band extension + £1,000 from the restored PA
    expect(rec.netAnnualGain).toBeCloseTo(rec.annualBenefitRestored - 2_000, 2);
  });
});

describe("joint eligibility (#6)", () => {
  const r = calculate(household({
    parentA: parent(105_000),
    parentB: parent(150_000, {}, "Parent B"),
    children: [child("2022-06-15")],
    estimatedAnnualChildcareSpend: 15_000,
  }));

  it("does not claim childcare is restored by reducing one parent's ANI", () => {
    for (const rec of r.optimisationRecommendations.filter((x) => x.parentLabel === "Parent A")) {
      expect(rec.schemesRestored).not.toContain("Tax-Free Childcare");
      expect(rec.schemesRestored).not.toContain("30-hour free childcare");
    }
    expect(r.inputWarnings.some((w) => w.includes("Both parents must qualify"))).toBe(true);
  });

  it("shows no cliff spike on Parent A's chart", () => {
    expect(Math.max(...r.marginalRateChart.parentA.map((p) => p.childcareBenefitLossRate))).toBe(0);
    expect(r.crossoverANIByParent.parentA).toBeNull();
  });
});

describe("crossover (#20)", () => {
  it("recovers a £6,275 cliff loss at 38p per £1 by £117,000", () => {
    const config = getTaxYearConfig("2025/26");
    const chart = generateMarginalRateChart(parent(0), config, 0, 4_275, 2_000);
    expect(computeCrossoverANI(chart, 4_275, 2_000)).toBe(117_000);
  });
});
