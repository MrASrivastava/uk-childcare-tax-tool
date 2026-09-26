/**
 * Worked examples for findings N1–N7 that are not fixed yet.
 *
 * Each is marked it.fails: it passes while the bug is present, and the commit
 * that fixes a finding flips its cases to it() so they must then pass.
 * Inputs for fields that don't exist yet are passed through loosely typed
 * objects so this file compiles before the fields are added.
 */
import { describe, expect, it } from "vitest";
import * as engine from "../../index";
import { calculate } from "../../index";
import type { HouseholdInputs, ParentIncome } from "../../index";
import { child, household, parent } from "../fixtures";

/** Build a parent with fields that may not exist in the type yet. */
const looseParent = (salary: number, extra: Record<string, unknown>): ParentIncome =>
  ({ ...parent(salary), ...extra }) as unknown as ParentIncome;

/** Read a nested field that may not exist in the type yet. */
const read = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

describe("N1 — Class 4 NIC", () => {
  it("charges £2,245.80 Class 4 on £50,000 profit", () => {
    const r = calculate(household({ parentA: parent(0, { selfEmploymentProfit: 50_000 }) }));
    expect(read(r.parentA.nic, "class4")).toBeCloseTo(2_245.8, 2);
  });
});

describe("N3 — OpRA-aware salary sacrifice", () => {
  it("a legacy £6,000 'other' sacrifice does not reduce ANI", () => {
    // Treated as an OpRA benefit worth the salary forgone: no ANI reduction
    const r = calculate(household({
      parentA: parent(105_000, { salarySacrifice: { pension: 0, ev: null, cycleToWork: 0, other: 6_000 } }),
    }));
    expect(r.parentA.ani.adjustedNetIncome).toBe(105_000);
  });
});

describe("N4 — multi-year", () => {
  it("taxYearForDate treats 6 April as the start of the tax year", () => {
    const fn = read(engine, "taxYearForDate") as (d: Date) => string;
    expect(fn(new Date(Date.UTC(2026, 3, 6)))).toBe("2026/27");
  });
});

describe("N5 — Class 1 NIC per pay period", () => {
  it("£40k salary + £30k bonus in month 9 gives about £2,845", () => {
    const r = calculate(household({
      parentA: parent(40_000, { bonus: { expectedThisYear: 30_000, isDiscretionary: true, paymentMonth: 9 } as ParentIncome["bonus"] }),
    }));
    expect(r.parentA.nic.employeeNIC).toBeCloseTo(2_845.3, 0);
  });
});

describe("N2 — Annual Allowance", () => {
  it("counts employer contributions against the allowance", () => {
    const r = calculate(household({
      parentA: looseParent(80_000, {
        salarySacrifice: { pension: 10_000, ev: null, cycleToWork: 0, other: 0 },
        employerPensionContributions: 8_000,
      }),
    }));
    expect(r.parentA.pensionCapacity.remainingHeadroomThisYear).toBe(42_000);
  });
});

describe("N6 — 2-year-olds with extra support", () => {
  it("a 2-year-old on DLA keeps 15 hours above the cliff", () => {
    const inputs = household({
      parentA: parent(105_000),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2023-06-15", { isDisabled: true, twoYearOldExtraSupport: "dla" } as Partial<HouseholdInputs["children"][number]>)],
    });
    const fh = calculate(inputs).freeHours.children[0];
    expect(fh.ageGroup).toBe("age_2yr");
    expect(fh.universalHoursPerWeek).toBe(15);
  });
});

describe("N7 — TFC exclusions and quarterly bills", () => {
  it.fails("Universal Credit makes the household ineligible", () => {
    const inputs = {
      ...household({
        parentA: parent(30_000),
        parentB: parent(20_000, {}, "Parent B"),
        children: [child("2018-05-01")],
        estimatedAnnualChildcareSpend: 8_000,
      }),
      tfcExclusions: {
        receivesUniversalCredit: true,
        eitherParentReceivesChildcareVouchers: false,
        receivesChildcareBursaryOrGrant: false,
        residenceConditionsConfirmed: true,
      },
    } as HouseholdInputs;
    expect(calculate(inputs).tfc.eligible.status).toBe("not_eligible");
  });

  it.fails("£6,000 spent in one quarter earns £500, not £1,200", () => {
    const inputs = household({
      parentA: parent(50_000),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2018-05-01", { childcareBill: { quarterly: [6_000, 0, 0, 0] } } as Partial<HouseholdInputs["children"][number]>)],
    });
    expect(calculate(inputs).tfc.estimatedActualTopUpAnnual).toBeCloseTo(500, 2);
  });
});
