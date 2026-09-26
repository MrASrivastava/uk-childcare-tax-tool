import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import { child, household, parent } from "./fixtures";

const takeHome = (p: ReturnType<typeof parent>) =>
  calculate(household({ parentA: p })).householdSummary.parentANetTakeHome;

const withSIPP = (salary: number, net: number) =>
  parent(salary, { personalPensionContributions: { reliefAtSourceNet: net, netPayArrangementGross: 0 } });

describe("relief-at-source pension and take-home (#1)", () => {
  it("a basic-rate taxpayer's take-home falls by the full net contribution", () => {
    expect(takeHome(parent(40_000)) - takeHome(withSIPP(40_000, 8_000))).toBeCloseTo(8_000, 2);
  });

  it("a higher-rate taxpayer gets 20% back through band extension", () => {
    expect(takeHome(parent(80_000)) - takeHome(withSIPP(80_000, 8_000))).toBeCloseTo(6_000, 2);
  });

  it("caps relievable contributions at relevant UK earnings (min £3,600 gross)", () => {
    const r = calculate(household({
      parentA: parent(0, {
        rentalIncomeNet: 50_000,
        personalPensionContributions: { reliefAtSourceNet: 8_000, netPayArrangementGross: 0 },
      }),
    }));
    expect(r.parentA.ani.step3PensionDeduction).toBe(3_600);
  });
});

describe("net pay arrangement pensions (#2)", () => {
  it("reduce ANI and restore childcare eligibility", () => {
    const r = calculate(household({
      parentA: parent(110_000, {
        personalPensionContributions: { reliefAtSourceNet: 0, netPayArrangementGross: 12_000 },
      }),
      parentB: parent(40_000, {}, "Parent B"),
      children: [child("2023-01-15")],
      estimatedAnnualChildcareSpend: 10_000,
    }));
    expect(r.parentA.ani.adjustedNetIncome).toBe(98_000);
    expect(r.tfc.eligible.status).not.toBe("not_eligible");
  });

  it("do not reduce employee NIC", () => {
    const base = calculate(household({ parentA: parent(60_000) }));
    const np = calculate(household({
      parentA: parent(60_000, { personalPensionContributions: { reliefAtSourceNet: 0, netPayArrangementGross: 5_000 } }),
    }));
    expect(np.parentA.nic.employeeNIC).toBeCloseTo(base.parentA.nic.employeeNIC, 6);
  });
});

describe("employee NIC base (#7)", () => {
  it("excludes benefits in kind", () => {
    const r = calculate(household({
      parentA: parent(40_000, {
        benefitsInKind: {
          companyCarP11DValue: 30_000,
          companyCarBiKRate: 0.25,
          privateMedicalInsurancePremium: 2_000,
          otherBiKCashEquivalent: 2_000,
        },
      }),
    }));
    expect(r.parentA.nic.employeeNIC).toBeCloseTo(2_194.4, 2);
  });
});
