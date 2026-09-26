import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import type { OtherSacrifice, ParentIncome } from "../index";
import { household, parent } from "./fixtures";

const withOther = (salary: number, otherItems: OtherSacrifice[], other = 0): ParentIncome =>
  parent(salary, { salarySacrifice: { pension: 0, ev: null, cycleToWork: 0, other, otherItems } });

const run = (p: ParentIncome) => calculate(household({ parentA: p }));

describe("OpRA-aware salary sacrifice (N3)", () => {
  it("a £6,000 gym sacrifice (OpRA, benefit £6,000) leaves ANI at £105,000", () => {
    const r = run(withOther(105_000, [{ kind: "opra_benefit", label: "Gym", salaryForgone: 6_000, normalBenefitValue: 6_000 }]));
    expect(r.parentA.ani.adjustedNetIncome).toBe(105_000);
    // Class 1 is still saved on the salary given up, but not employer NIC
    expect(r.parentA.nic.grossPayForNIC).toBe(99_000);
    expect(r.parentA.nic.employerNICSavingFromSacrifice).toBe(0);
  });

  it("a £3,000 holiday purchase (pay reduction) takes £101,500 to £98,500", () => {
    const r = calculate(household({
      parentA: withOther(101_500, [{ kind: "pay_reduction", label: "Holiday", amount: 3_000 }]),
      parentB: parent(40_000, {}, "Parent B"),
    }));
    expect(r.parentA.ani.adjustedNetIncome).toBe(98_500);
    expect(r.parentA.nic.employerNICSavingFromSacrifice).toBeCloseTo(450, 6);
  });

  it("an OpRA benefit worth more than the salary given up raises ANI by the difference", () => {
    const r = run(withOther(50_000, [{ kind: "opra_benefit", label: "Tech", salaryForgone: 800, normalBenefitValue: 1_000 }]));
    expect(r.parentA.ani.adjustedNetIncome).toBe(50_200);
  });

  it("excluded benefits keep the full ANI reduction", () => {
    const r = run(withOther(50_000, [{ kind: "excluded_benefit", label: "Nursery", amount: 5_000, category: "workplace_childcare" }]));
    expect(r.parentA.ani.adjustedNetIncome).toBe(45_000);
  });

  it("treats a legacy bare `other` amount conservatively, with a warning", () => {
    const r = run(withOther(105_000, [], 6_000));
    expect(r.parentA.ani.adjustedNetIncome).toBe(105_000);
    expect(r.inputWarnings.some((w) => w.includes("deprecated"))).toBe(true);
  });

  it("a car above 75g/km is taxed at the higher of lease and BiK, so the sacrifice doesn't reduce ANI", () => {
    const hybrid = parent(100_000, {
      salarySacrifice: {
        pension: 0, cycleToWork: 0, other: 0,
        ev: { annualLeaseCost: 6_000, vehicleP11DValue: 30_000, biKRateOverride: 0.12, co2GramsPerKm: 90 },
      },
    });
    const r = run(hybrid);
    expect(r.parentA.ani.biK_evSacrifice).toBe(6_000);
    expect(r.parentA.ani.adjustedNetIncome).toBe(100_000);
    expect(r.inputWarnings.some((w) => w.includes("75g/km"))).toBe(true);
  });

  it("a pure EV keeps the salary sacrifice advantage", () => {
    const ev = parent(100_000, {
      salarySacrifice: { pension: 0, cycleToWork: 0, other: 0, ev: { annualLeaseCost: 6_000, vehicleP11DValue: 40_000 } },
    });
    expect(run(ev).parentA.ani.adjustedNetIncome).toBe(100_000 - 6_000 + 40_000 * 0.03);
  });
});
