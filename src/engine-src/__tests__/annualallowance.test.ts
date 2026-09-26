import { describe, expect, it } from "vitest";
import { calculate, getTaxYearConfig } from "../index";
import type { ParentIncome } from "../index";
import { carryForward, effectiveAnnualAllowance } from "../engine/pensions";
import { child, household, parent } from "./fixtures";

const cfg = getTaxYearConfig("2025/26");
const capacity = (p: ParentIncome) => calculate(household({ parentA: p })).parentA.pensionCapacity;
const member = (taxYear: string, totalPensionInput = 0, wasMember = true) => ({ taxYear, totalPensionInput, wasMember });

describe("pension inputs (N2)", () => {
  it("counts salary sacrifice and employer contributions: £10k + £8k leaves £42k headroom", () => {
    const c = capacity(parent(80_000, {
      salarySacrifice: { pension: 10_000, ev: null, cycleToWork: 0, other: 0 },
      employerPensionContributions: 8_000,
    }));
    expect(c.totalContributionsThisYear).toBe(18_000);
    expect(c.remainingHeadroomThisYear).toBe(42_000);
  });

  it("counts a DB pension input amount", () => {
    const c = capacity(parent(80_000, { dbPensionInputAmount: 25_000, employerPensionContributions: 0 }));
    expect(c.definedBenefitInput).toBe(25_000);
    expect(c.remainingHeadroomThisYear).toBe(35_000);
  });
});

describe("carry-forward (N2)", () => {
  it("2025/26 with no prior inputs, member every year: £160k (2022/23's allowance was £40k)", () => {
    expect(carryForward([member("2024/25"), member("2023/24"), member("2022/23")], "2025/26", cfg)).toBe(160_000);
  });

  it("a year without scheme membership contributes nothing", () => {
    expect(carryForward([member("2024/25"), member("2023/24", 0, false), member("2022/23")], "2025/26", cfg)).toBe(100_000);
  });

  it("uses a prior year's tapered allowance where given", () => {
    const prior = [member("2024/25"), { ...member("2023/24", 5_000), taperedAA: 20_000 }, member("2022/23")];
    expect(carryForward(prior, "2025/26", cfg)).toBe(60_000 + 15_000 + 40_000);
  });
});

describe("tapered Annual Allowance (N2)", () => {
  it.each([
    [250_000, 300_000, 40_000, true],
    [250_000, 360_000, 10_000, true],
    [250_000, 400_000, 10_000, true],
    [190_000, 300_000, 60_000, false],
    [250_000, 260_000, 60_000, false],
  ])("threshold £%i, adjusted £%i → allowance £%i", (threshold, adjusted, aa, tapered) => {
    expect(effectiveAnnualAllowance(threshold, adjusted, cfg)).toEqual({ annualAllowance: aa, tapered });
  });

  it("works out threshold and adjusted income from the household", () => {
    const c = capacity(parent(300_000, {
      salarySacrifice: { pension: 20_000, ev: null, cycleToWork: 0, other: 0 },
      employerPensionContributions: 20_000,
    }));
    // Threshold: £280k net + £20k sacrifice added back = £300k
    expect(c.thresholdIncome).toBe(300_000);
    // Adjusted: £280k + £20k sacrifice + £20k employer = £320k → taper £30k
    expect(c.adjustedIncome).toBe(320_000);
    expect(c.annualAllowance).toBe(30_000);
    expect(c.taperedAAApplies).toBe(true);
  });
});

describe("MPAA (N2)", () => {
  it("money purchase inputs of £12k give a £2k chargeable excess, with no carry-forward", () => {
    const c = capacity(parent(60_000, {
      mpaaTriggered: true,
      salarySacrifice: { pension: 12_000, ev: null, cycleToWork: 0, other: 0 },
      employerPensionContributions: 0,
      priorYears: [member("2024/25"), member("2023/24"), member("2022/23")],
    }));
    expect(c.annualAllowanceExcess).toBe(2_000);
  });

  it("with money purchase inputs within the MPAA, the normal allowance applies to everything", () => {
    // MP £8k + DB £55k = £63k against £60k: excess £3k (the alternative £50k
    // allowance applies only when money purchase inputs exceed the MPAA)
    const c = capacity(parent(60_000, {
      mpaaTriggered: true,
      salarySacrifice: { pension: 8_000, ev: null, cycleToWork: 0, other: 0 },
      dbPensionInputAmount: 55_000,
    }));
    expect(c.annualAllowanceExcess).toBe(3_000);
  });

  it("above the MPAA, DB inputs are tested against the £50k alternative allowance", () => {
    const c = capacity(parent(60_000, {
      mpaaTriggered: true,
      salarySacrifice: { pension: 12_000, ev: null, cycleToWork: 0, other: 0 },
      dbPensionInputAmount: 55_000,
    }));
    expect(c.annualAllowanceExcess).toBe(2_000 + 5_000);
  });
});

describe("Annual Allowance charge (N2)", () => {
  it("taxes the excess at the parent's marginal rate and reduces take-home", () => {
    const within = calculate(household({ parentA: parent(100_000, { employerPensionContributions: 60_000 }) }));
    const over = calculate(household({ parentA: parent(100_000, { employerPensionContributions: 70_000 }) }));
    expect(over.parentA.pensionCapacity.annualAllowanceExcess).toBe(10_000);
    // ANI is £100k (the charge does not affect ANI); the £10k excess is the top slice, at 40%
    expect(over.parentA.incomeTax.annualAllowanceCharge).toBeCloseTo(4_000, 2);
    expect(within.householdSummary.parentANetTakeHome - over.householdSummary.parentANetTakeHome).toBeCloseTo(4_000, 2);
  });
});

describe("optimiser and the Annual Allowance (N2)", () => {
  it("flags a recommendation above the headroom and includes the charge in its net gain", () => {
    const inputs = household({
      parentA: parent(130_000, { employerPensionContributions: 40_000 }),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2023-01-15")],
      estimatedAnnualChildcareSpend: 15_000,
    });
    const r = calculate(inputs);
    expect(r.parentA.pensionCapacity.remainingHeadroomThisYear).toBe(20_000);
    const rec = r.optimisationRecommendations.find((x) => x.lever === "salary_sacrifice_pension" && x.aniReductionRequired === 30_000)!;
    expect(rec).toBeDefined();
    expect(rec.immediatelyActionable).toBe(false);
    expect(rec.warnings[0]).toMatch(/Annual Allowance charge of about £4,000/);

    const after = structuredClone(inputs);
    after.parentA.salarySacrifice.pension = 30_000;
    expect(calculate(after).parentA.incomeTax.annualAllowanceCharge).toBeCloseTo(4_000, 2);
  });
});
