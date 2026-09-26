/**
 * Threshold boundary cases. Each threshold is tested either side of the line
 * and exactly on it, so an off-by-one in any comparison fails here.
 */
import { describe, expect, it } from "vitest";
import { calculate, calculatePersonalAllowance, computeHICBCCharge, getTaxYearConfig } from "../../index";
import { child, household, parent } from "../fixtures";

const config = getTaxYearConfig("2025/26");

describe("HICBC boundaries", () => {
  const cases: [number, number][] = [
    [59_999, 0],
    [60_000, 0],
    [60_199, 0],
    [60_200, 0.01],
    [79_999, 0.99],
    [80_000, 1],
    [80_001, 1],
  ];
  it.each(cases)("ANI £%i claws back %f", (ani, fraction) => {
    expect(computeHICBCCharge(ani, 1_000, config).retentionFraction).toBe(fraction);
  });
});

describe("personal allowance taper boundaries", () => {
  const cases: [number, number][] = [
    [99_999, 12_570],
    [100_000, 12_570],
    [100_001, 12_570], // £1 over removes nothing: £1 per complete £2
    [100_002, 12_569],
    [125_139, 1],
    [125_140, 0],
    [125_141, 0],
  ];
  it.each(cases)("ANI £%i leaves a personal allowance of £%i", (ani, pa) => {
    expect(calculatePersonalAllowance(ani, config)).toBe(pa);
  });
});

describe("£100,000 childcare cliff", () => {
  const run = (salary: number) =>
    calculate(household({
      parentA: parent(salary),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2023-01-15")],
      estimatedAnnualChildcareSpend: 15_000,
    }));

  it.each([99_999, 100_000])("ANI £%i keeps TFC and 30 hours", (salary) => {
    const r = run(salary);
    expect(r.tfc.eligible.status).not.toBe("not_eligible");
    expect(r.freeHours.children[0].workingParentEligibility.status).not.toBe("not_eligible");
  });

  it("ANI £100,001 loses TFC and 30 hours", () => {
    const r = run(100_001);
    expect(r.tfc.eligible.status).toBe("not_eligible");
    expect(r.freeHours.children[0].workingParentEligibility.status).toBe("not_eligible");
  });
});
