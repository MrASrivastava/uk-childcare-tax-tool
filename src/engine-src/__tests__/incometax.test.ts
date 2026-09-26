import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import { household, parent } from "./fixtures";
import type { ParentIncome } from "../index";

const tax = (p: ParentIncome, taxYear: "2025/26" | "2026/27" = "2025/26") =>
  calculate(household({ parentA: p, taxYear })).parentA.incomeTax.totalIncomeTax;

describe("savings and dividends (#11)", () => {
  it("apply the PSA, dividend allowance and dividend rates", () => {
    const extra = tax(parent(70_000, { dividendsNonISA: 5_000, savingsInterestNonISA: 500 })) - tax(parent(70_000));
    // £500 interest covered by the higher-rate PSA; £4,500 of dividends at 33.75%
    expect(extra).toBeCloseTo(1_518.75, 2);
  });

  it("use the 2026/27 dividend higher rate of 35.75%", () => {
    const extra = tax(parent(70_000, { dividendsNonISA: 1_500 }), "2026/27") - tax(parent(70_000), "2026/27");
    expect(extra).toBeCloseTo(1_000 * 0.3575, 2);
  });

  it("apply the starting rate for savings when other income is low", () => {
    // £14,570 salary: £2,000 taxable non-savings leaves £3,000 of the £5,000 starting band
    const extra = tax(parent(14_570, { savingsInterestNonISA: 4_500 })) - tax(parent(14_570));
    // £3,000 at 0% starting rate, £1,000 PSA, £500 at 20%
    expect(extra).toBeCloseTo(100, 2);
  });

  it("tax savings and dividends on UK bands for Scottish taxpayers", () => {
    const scot = (d: number) => parent(40_000, { scotlandResident: true, dividendsNonISA: d });
    // £40k Scottish non-savings leaves £27,430 taxable, inside the UK basic band
    expect(tax(scot(1_500)) - tax(scot(0))).toBeCloseTo(1_000 * 0.0875, 2);
  });
});

describe("Scottish 2026/27 bands (#10)", () => {
  it("use the uprated starter and basic thresholds", () => {
    // £29,526 gross = £16,956 taxable: 3,967 at 19% + 12,989 at 20%
    expect(tax(parent(29_526, { scotlandResident: true }), "2026/27")).toBeCloseTo(3_967 * 0.19 + 12_989 * 0.20, 2);
  });
});

describe("rental finance costs (#17)", () => {
  it("give a 20% tax reduction without reducing ANI", () => {
    const r = calculate(household({ parentA: parent(50_000, { rentalIncomeNet: 10_000, rentalFinanceCosts: 6_000 }) }));
    expect(r.parentA.ani.adjustedNetIncome).toBe(60_000);
    expect(r.parentA.incomeTax.taxReductions).toBeCloseTo(1_200, 2);
  });
});
