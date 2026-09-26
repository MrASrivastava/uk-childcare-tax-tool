import { describe, expect, it } from "vitest";
import { calculate, getTaxYearConfig, taxYearForDate } from "../index";
import { buildTooltips } from "../../tooltips";
import { pdfCoverSubtitle, pdfPageHeader } from "../../pdfText";
import { child, household } from "./fixtures";

describe("taxYearForDate (N4)", () => {
  it("starts the tax year on 6 April", () => {
    expect(taxYearForDate(new Date(Date.UTC(2026, 3, 5)))).toBe("2025/26");
    expect(taxYearForDate(new Date(Date.UTC(2026, 3, 6)))).toBe("2026/27");
    expect(taxYearForDate(new Date(Date.UTC(2027, 0, 1)))).toBe("2026/27");
    expect(taxYearForDate(new Date(Date.UTC(2099, 11, 31)))).toBe("2099/00");
  });
});

describe("year-aware text (N4)", () => {
  const tt = buildTooltips(getTaxYearConfig("2026/27"));

  it("Child Benefit tooltip uses the selected year's rates", () => {
    expect(tt.childBenefit).toContain("£27.05");
    expect(tt.childBenefit).toContain("£17.90");
    expect(tt.childBenefit).not.toContain("2025/26");
  });

  it("EV tooltips use the selected year's BiK rate", () => {
    expect(tt.evLease).toContain("4%");
    expect(tt.evP11D).toContain("£1,400");
    expect(tt.carBiK).toContain("4% (2026/27)");
  });

  it("PDF header and cover name the result's tax year", () => {
    const r = calculate(household({ taxYear: "2026/27", asOfDate: "2026-10-01" }));
    const text = [pdfPageHeader(r), pdfCoverSubtitle(r)].join("\n");
    expect(text).toContain("2026/27");
    expect(text).not.toContain("2025/26");
    expect(pdfCoverSubtitle({ taxYear: "2026/27", jurisdiction: "scotland" })).toContain("Scotland");
  });
});

describe("reference date (N4)", () => {
  it("uses the middle of the tax year when today is outside it and no date is given", () => {
    // Born Feb 2022: 3–4 all of 2025/26; in reception from September 2026
    const r = calculate(household({ taxYear: "2025/26", asOfDate: undefined, children: [child("2022-02-15")] }));
    expect(r.freeHours.children[0].ageGroup).toBe("age_3_to_4yr");
  });
});
