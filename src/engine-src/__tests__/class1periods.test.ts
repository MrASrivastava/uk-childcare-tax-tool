import { describe, expect, it } from "vitest";
import { calculate, getTaxYearConfig } from "../index";
import type { ParentIncome } from "../index";
import { household, parent } from "./fixtures";

const nic = (p: ParentIncome) => calculate(household({ parentA: p })).parentA.nic;
const within5 = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(5);

describe("Class 1 NIC per pay period (N5)", () => {
  it("£60k salary paid monthly is within £5 of the annual calculation", () => {
    within5(nic(parent(60_000)).class1Employee, 3_210.6);
  });

  it("£40k + £30k bonus paid in month 9 costs about £2,845", () => {
    const n = nic(parent(40_000, { bonus: { expectedThisYear: 30_000, isDiscretionary: true, paymentMonth: 9 } }));
    within5(n.class1Employee, 2_845.3);
    expect(n.class1ByPeriod).toHaveLength(12);
    expect(n.class1ByPeriod[8]).toBeGreaterThan(n.class1ByPeriod[0]);
  });

  it("a director uses the annual earnings period (about £3,411)", () => {
    const n = nic(parent(40_000, { isDirector: true, bonus: { expectedThisYear: 30_000, isDiscretionary: true, paymentMonth: 9 } }));
    expect(n.class1Employee).toBeCloseTo(3_410.6, 2);
    expect(n.class1ByPeriod).toHaveLength(1);
  });

  it("an RSU vest on 20 June is charged in tax month 3, mostly at 2%", () => {
    const n = nic(parent(45_000, { rsuVests: [{ vestDate: "2025-06-20", grossValue: 20_000, employerNICTransferred: false }] }));
    // Month 3 (6 June–5 July): £3,750 + £20,000; main rate up to £4,189, then 2%
    expect(n.class1ByPeriod[2]).toBeCloseTo((4_189 - 1_048) * 0.08 + (23_750 - 4_189) * 0.02, 2);
    within5(n.class1Employee, 3_020.26);
  });

  it("weekly pay uses the weekly thresholds", () => {
    const n = nic(parent(30_000, { payFrequency: "weekly" }));
    expect(n.class1ByPeriod).toHaveLength(52);
    expect(n.class1ByPeriod[0]).toBeCloseTo((30_000 / 52 - 242) * 0.08, 6);
  });

  it("spreads a bonus with no payment month evenly and warns", () => {
    const r = calculate(household({ parentA: parent(40_000, { bonus: { expectedThisYear: 30_000, isDiscretionary: true } }) }));
    within5(r.parentA.nic.class1Employee, 3_410.6);
    expect(r.inputWarnings.some((w) => w.includes("payment month"))).toBe(true);
  });
});

describe("Class 1 thresholds for multi-week pay periods", () => {
  it("are the weekly figures multiplied by the number of weeks", () => {
    for (const year of ["2025/26", "2026/27"] as const) {
      const p = getTaxYearConfig(year).class1Periods;
      expect(p.fortnightly).toEqual({ primaryThreshold: 2 * p.weekly.primaryThreshold, upperEarningsLimit: 2 * p.weekly.upperEarningsLimit });
      expect(p.four_weekly).toEqual({ primaryThreshold: 4 * p.weekly.primaryThreshold, upperEarningsLimit: 4 * p.weekly.upperEarningsLimit });
    }
  });

  it("charge four-weekly pay on £968 / £3,868", () => {
    const n = nic(parent(30_000, { payFrequency: "four_weekly" }));
    expect(n.class1ByPeriod).toHaveLength(13);
    expect(n.class1ByPeriod[0]).toBeCloseTo((30_000 / 13 - 968) * 0.08, 6);
  });
});
