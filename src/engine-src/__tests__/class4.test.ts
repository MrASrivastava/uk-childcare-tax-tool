import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import { household, parent } from "./fixtures";

const nic = (p: ReturnType<typeof parent>) => calculate(household({ parentA: p }));

describe("Class 4 NIC (N1)", () => {
  it.each([
    [10_000, 0],
    [50_000, 2_245.8],
    [60_000, 2_456.6],
  ])("profit £%i gives Class 4 of £%f", (profit, expected) => {
    expect(nic(parent(0, { selfEmploymentProfit: profit })).parentA.nic.class4).toBeCloseTo(expected, 2);
  });

  it("works out Class 1 and Class 4 independently, without a warning below the UEL", () => {
    const r = nic(parent(30_000, { selfEmploymentProfit: 30_000 }));
    // Class 1 is per pay period (monthly thresholds), so within £5 of the annual £1,394.40
    expect(Math.abs(r.parentA.nic.class1Employee - 1_394.4)).toBeLessThan(5);
    expect(r.parentA.nic.class4).toBeCloseTo(1_045.8, 2);
    expect(r.parentA.nic.totalEmployeeNIC).toBeCloseTo(r.parentA.nic.class1Employee + 1_045.8, 2);
    expect(r.inputWarnings.some((w) => w.includes("annual maximum"))).toBe(false);
  });

  it("warns about the annual maximum when employment earnings alone exceed the UEL", () => {
    const r = nic(parent(60_000, { selfEmploymentProfit: 30_000 }));
    expect(r.inputWarnings.some((w) => w.includes("annual maximum"))).toBe(true);
  });

  it("is not charged over State Pension age", () => {
    expect(nic(parent(0, { selfEmploymentProfit: 50_000, statePensionAgeReached: true })).parentA.nic.class4).toBe(0);
  });

  it("reduces take-home by the Class 4 due", () => {
    const withProfit = nic(parent(0, { selfEmploymentProfit: 50_000 }));
    const s = withProfit.householdSummary.parentANetTakeHome;
    const expected = 50_000 - withProfit.parentA.incomeTax.totalIncomeTax - 2_245.8;
    expect(s).toBeCloseTo(expected, 2);
    expect(withProfit.parentA.nic.employeeNIC).toBe(withProfit.parentA.nic.totalEmployeeNIC);
  });

  it("uses Class 4 rates on the marginal rate chart for a mainly self-employed parent", () => {
    const r = nic(parent(0, { selfEmploymentProfit: 70_000 }));
    const at = (ani: number) => r.marginalRateChart.parentA.find((p) => p.ani === ani)!;
    expect(at(50_000).nicMarginalRate).toBe(0.06);
    expect(at(60_000).nicMarginalRate).toBe(0.02);
    const employee = nic(parent(70_000));
    expect(employee.marginalRateChart.parentA.find((p) => p.ani === 50_000)!.nicMarginalRate).toBe(0.08);
  });
});
