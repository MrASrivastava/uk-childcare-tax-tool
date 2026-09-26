import { describe, expect, it } from "vitest";
import { calculate, fundedHoursEndDate, receptionStartDate } from "../index";
import { child, household, parent } from "./fixtures";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const couple = { parentA: parent(50_000), parentB: parent(40_000, {}, "Parent B") };
const rates = { providerHourlyRates: { under2: 10, age2: 10, age3to4: 10 } };

describe("free hours end at reception (#16)", () => {
  it("starts reception in the September after the 4th birthday", () => {
    expect(iso(receptionStartDate("2021-08-31"))).toBe("2025-09-01");
    expect(iso(receptionStartDate("2021-09-01"))).toBe("2026-09-01");
  });

  it("ends funded hours at reception unless deferred", () => {
    expect(iso(fundedHoursEndDate(child("2021-03-10")))).toBe("2025-09-01");
    // Deferred: compulsory school age, the term after the 5th birthday
    expect(iso(fundedHoursEndDate(child("2021-03-10", { deferredReception: true })))).toBe("2026-04-01");
  });

  it("values only the terms before reception", () => {
    // Born March 2021: 3–4 in the summer term 2025, in reception from September 2025
    const r = calculate(household({ ...couple, ...rates, children: [child("2021-03-10")] }));
    expect(r.freeHours.children[0].workingParentAnnualValue).toBeCloseTo((30 * 38 * 10) / 3, 2);
  });
});

describe("tax-year dates and term pro-rating (#23)", () => {
  it("uses the selected tax year, not today's date", () => {
    // Born Feb 2022: in reception by September 2026, but pre-school throughout 2025/26
    const kids = [child("2022-02-15")];
    const past = calculate(household({ ...couple, ...rates, taxYear: "2025/26", asOfDate: "2026-09-26", children: kids }));
    expect(past.freeHours.children[0].ageGroup).toBe("age_3_to_4yr");
    expect(past.freeHours.children[0].workingParentAnnualValue).toBeCloseTo(30 * 38 * 10, 2);
    const current = calculate(household({ ...couple, ...rates, taxYear: "2026/27", asOfDate: "2026-09-26", children: kids }));
    expect(current.freeHours.children[0].ageGroup).toBe("school_age_or_over");
  });

  it("values each term at the age group on the term start date", () => {
    // Born 10 May 2023: 9m–2yr for the summer term 2025, age 2 from 1 Sep 2025
    const r = calculate(household({
      ...couple,
      providerHourlyRates: { under2: 12, age2: 9, age3to4: 6 },
      children: [child("2023-05-10")],
    }));
    const weeks = 38 / 3;
    expect(r.freeHours.children[0].workingParentAnnualValue).toBeCloseTo(30 * weeks * (12 + 9 + 9), 2);
  });
});
