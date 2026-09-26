import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import type { ChildInfo } from "../index";
import { child, household, parent } from "./fixtures";

// Born 15 June 2023: aged 2 for the autumn and spring terms of 2025/26
const rates = { providerHourlyRates: { under2: 10, age2: 10, age3to4: 10 } };
const twoYearOld = (extra: ChildInfo["twoYearOldExtraSupport"]) =>
  child("2023-06-15", { isDisabled: extra === "dla", twoYearOldExtraSupport: extra });
const run = (salaryA: number, c: ChildInfo) =>
  calculate(household({ ...rates, parentA: parent(salaryA), parentB: parent(40_000, {}, "Parent B"), children: [c] }));

describe("2-year-olds with extra support (N6)", () => {
  it("a 2-year-old on DLA keeps 15 hours when a parent is over £100k", () => {
    const fh = run(105_000, twoYearOld("dla")).freeHours.children[0];
    expect(fh.ageGroup).toBe("age_2yr");
    expect(fh.universalHoursPerWeek).toBe(15);
    expect(fh.workingParentHoursPerWeek).toBe(15);
    expect(fh.incrementalWorkingParentHours).toBe(15);
    // Summer term aged under 2 (30 incremental hours), then two terms aged 2 with extra support (15)
    const weeks = 38 / 3;
    expect(fh.incrementalWorkingParentValue).toBeCloseTo(30 * weeks * 10 + 2 * 15 * weeks * 10, 2);
  });

  it("with both parents eligible, the hours combine to 30, not 45", () => {
    const fh = run(60_000, twoYearOld("ehc_plan")).freeHours.children[0];
    expect(fh.workingParentHoursPerWeek).toBe(30);
  });

  it("without extra support, a 2-year-old gets nothing over the cliff", () => {
    const fh = run(105_000, twoYearOld(null)).freeHours.children[0];
    expect(fh.universalHoursPerWeek).toBe(0);
    expect(fh.workingParentHoursPerWeek).toBe(0);
  });

  it("ignores the benefits route for a household earning well above its limit, with a warning", () => {
    const r = run(80_000, twoYearOld("benefits_route"));
    expect(r.freeHours.children[0].universalHoursPerWeek).toBe(0);
    expect(r.inputWarnings.some((w) => w.includes("benefits route"))).toBe(true);
  });

  it("the extra-support flag is irrelevant from age 3", () => {
    const r = calculate(household({
      ...rates,
      parentA: parent(105_000),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2022-02-15", { twoYearOldExtraSupport: "dla" })],
    }));
    const fh = r.freeHours.children[0];
    expect(fh.ageGroup).toBe("age_3_to_4yr");
    expect(fh.universalHoursPerWeek).toBe(15);
    expect(fh.incrementalWorkingParentHours).toBe(15);
  });

  it("shows a 15-hour (not 30-hour) cliff for a qualifying 2-year-old in the optimiser", () => {
    const withDLA = run(105_000, twoYearOld("dla"));
    const without = run(105_000, twoYearOld(null));
    const restored = (r: ReturnType<typeof run>) =>
      r.optimisationRecommendations.find((x) => x.lever === "salary_sacrifice_pension" && x.aniReductionRequired === 5_000)!.annualBenefitRestored;
    expect(restored(withDLA)).toBeLessThan(restored(without));
  });
});

describe("benefits route income limit", () => {
  const benefitsRoute = (salaryA: number, salaryB: number | null) =>
    calculate(household({
      parentA: parent(salaryA),
      parentB: salaryB === null ? null : parent(salaryB, {}, "Parent B"),
      children: [twoYearOld("benefits_route")],
    }));

  it("is tested on income after tax: £16,400 gross is about £15,327 after tax, so it qualifies", () => {
    const r = benefitsRoute(16_400, null);
    const afterTax = r.parentA.ani.step1NetIncome - r.parentA.incomeTax.totalIncomeTax - r.parentA.nic.totalEmployeeNIC;
    expect(afterTax).toBeLessThanOrEqual(15_400);
    expect(r.freeHours.children[0].universalHoursPerWeek).toBe(15);
    expect(r.inputWarnings.some((w) => w.includes("benefits route"))).toBe(false);
  });

  it("is ignored above the limit, and the warning gives the after-tax figure", () => {
    const r = benefitsRoute(14_000, 10_000);
    expect(r.freeHours.children[0].universalHoursPerWeek).toBe(0);
    expect(r.inputWarnings.find((w) => w.includes("benefits route"))).toMatch(/after tax/);
  });
});
