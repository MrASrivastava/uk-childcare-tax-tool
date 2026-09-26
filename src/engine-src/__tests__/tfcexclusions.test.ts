import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import type { HouseholdInputs, TFCExclusions } from "../index";
import { child, household, parent } from "./fixtures";

// School-age children (no funded hours) so the bill is the whole cost
const couple = { parentA: parent(50_000), parentB: parent(40_000, {}, "Parent B") };
const none: TFCExclusions = {
  receivesUniversalCredit: false,
  eitherParentReceivesChildcareVouchers: false,
  receivesChildcareBursaryOrGrant: false,
  residenceConditionsConfirmed: true,
};
const tfc = (overrides: Partial<HouseholdInputs>) => calculate(household({ ...couple, ...overrides })).tfc;

describe("TFC per child and per quarter (N7)", () => {
  it("two children with bills of £12k and £4k spread evenly: £2,000 + £800", () => {
    const r = tfc({
      children: [
        child("2018-05-01", { childcareBill: { annual: 12_000 } }),
        child("2017-05-01", { childcareBill: { annual: 4_000 } }),
      ],
    });
    expect(r.estimatedActualTopUpAnnual).toBeCloseTo(2_800, 2);
  });

  it("£6,000 all in one quarter earns £500, not £1,200", () => {
    const r = tfc({ children: [child("2018-05-01", { childcareBill: { quarterly: [6_000, 0, 0, 0] } })] });
    expect(r.estimatedActualTopUpAnnual).toBeCloseTo(500, 2);
  });

  it("a disabled child with a £24k bill spread evenly: £4,000", () => {
    const r = tfc({ children: [child("2018-05-01", { isDisabled: true, childcareBill: { annual: 24_000 } })] });
    expect(r.estimatedActualTopUpAnnual).toBeCloseTo(4_000, 2);
  });

  it("splits the household figure across children with a warning", () => {
    const r = calculate(household({ ...couple, children: [child("2018-05-01"), child("2017-05-01")], estimatedAnnualChildcareSpend: 16_000 }));
    expect(r.tfc.estimatedActualTopUpAnnual).toBeCloseTo(3_200, 2);
    expect(r.inputWarnings.some((w) => w.includes("split evenly"))).toBe(true);
  });
});

describe("TFC exclusions (N7)", () => {
  const kids = { children: [child("2018-05-01", { childcareBill: { annual: 8_000 } })] };

  it("Universal Credit rules TFC out and the reason names it", () => {
    const r = tfc({ ...kids, tfcExclusions: { ...none, receivesUniversalCredit: true } });
    expect(r.eligible.status).toBe("not_eligible");
    expect(r.estimatedActualTopUpAnnual).toBe(0);
    expect(r.eligible.reason).toContain("Universal Credit");
  });

  it("childcare vouchers rule TFC out", () => {
    const r = tfc({ ...kids, tfcExclusions: { ...none, eitherParentReceivesChildcareVouchers: true } });
    expect(r.eligible.status).toBe("not_eligible");
    expect(r.eligible.reason).toContain("vouchers");
  });

  it("a child who doesn't usually live with the parent is left out", () => {
    const r = tfc({
      children: [
        child("2018-05-01", { childcareBill: { annual: 8_000 } }),
        child("2017-05-01", { childcareBill: { annual: 8_000 }, usuallyLivesWithYou: false }),
      ],
    });
    expect(r.eligibleChildCount).toBe(1);
    expect(r.estimatedActualTopUpAnnual).toBeCloseTo(1_600, 2);
  });

  it("says which conditions it checked", () => {
    expect(tfc({ ...kids, tfcExclusions: none }).eligible.reason).toContain("income and age tests this tool checks");
  });
});
