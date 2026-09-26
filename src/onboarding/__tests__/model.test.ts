import { describe, expect, it } from "vitest";
import { calculate, createEmptyParentIncome } from "../../engine-src/index";
import type { HouseholdInputs } from "../../engine-src/index";
import {
  CHIPS,
  chipActive,
  childFacts,
  clearChip,
  emptyHousehold,
  emptyMeta,
  formatMoney,
  inferPensionMethod,
  parseMoney,
  plainLever,
  pensionAmount,
  previewStatuses,
  reviewSections,
  stepOrder,
  summarise,
  syncMeta,
  toEngineInputs,
  validateStep,
  withPension,
  withRegion,
} from "../model";

const today = new Date(Date.UTC(2026, 8, 26));
const chip = (id: string) => CHIPS.find((c) => c.id === id)!;

describe("money parsing and formatting", () => {
  it("accepts what people type", () => {
    expect(parseMoney("£45,000")).toBe(45_000);
    expect(parseMoney(" 3750.50 ")).toBe(3_750.5);
    expect(parseMoney("")).toBe(0);
    expect(parseMoney("abc")).toBe(0);
  });
  it("formats with thousands separators and blank for zero", () => {
    expect(formatMoney(45_000)).toBe("45,000");
    expect(formatMoney(11.5)).toBe("11.5");
    expect(formatMoney(0)).toBe("");
  });
});

describe("steps", () => {
  it("skips the partner step for single parents", () => {
    const meta = emptyMeta();
    expect(stepOrder(meta)).toEqual(["family", "A", "B", "care", "cb"]);
    expect(stepOrder({ ...meta, couple: false })).toEqual(["family", "A", "care", "cb"]);
  });
});

describe("child facts", () => {
  it("describes what each age qualifies for", () => {
    expect(childFacts("2024-06-15", today).info).toBe("Aged 2 · up to 30 funded hours if you both work");
    expect(childFacts("2022-06-15", today).info).toBe("Aged 4 · 15 hours for everyone, 30 if you both work");
    expect(childFacts("2026-03-01", today).info).toBe("6 months old · up to 30 funded hours from the term after 9 months");
    expect(childFacts("2018-01-01", today).info).toBe("Aged 8 · Tax-Free Childcare for clubs and holidays");
  });
  it("flags impossible dates", () => {
    expect(childFacts("2027-01-01", today).error).toMatch(/future/);
    expect(childFacts("2005-01-01", today).error).toMatch(/before 18/);
    expect(childFacts("", today).valid).toBe(false);
  });
});

describe("pension question", () => {
  const p = { ...createEmptyParentIncome("Parent A"), grossSalary: 60_000 };
  it("maps each answer onto one engine field and clears the others", () => {
    const ss = withPension(p, "ss", 5_000);
    expect(ss.salarySacrifice.pension).toBe(5_000);
    const net = withPension(ss, "net", 4_000);
    expect(net.salarySacrifice.pension).toBe(0);
    expect(net.personalPensionContributions.netPayArrangementGross).toBe(4_000);
    const sipp = withPension(net, "sipp", 3_000);
    expect(sipp.personalPensionContributions.netPayArrangementGross).toBe(0);
    expect(sipp.personalPensionContributions.reliefAtSourceNet).toBe(3_000);
    expect(pensionAmount(sipp, "sipp")).toBe(3_000);
    expect(withPension(sipp, "none", 0).personalPensionContributions.reliefAtSourceNet).toBe(0);
  });
  it("infers the method from existing figures", () => {
    expect(inferPensionMethod(p)).toBeNull();
    expect(inferPensionMethod(withPension(p, "net", 1))).toBe("net");
  });
});

describe("does any of this apply", () => {
  const p = createEmptyParentIncome("Parent A");
  it("sets and clears each option's figures", () => {
    const withRsu = chip("rsu").fields[0].set(p, 20_000, "2026/27");
    expect(withRsu.rsuVests).toEqual([{ vestDate: "2026-10-01", grossValue: 20_000, employerNICTransferred: false }]);
    expect(chipActive(withRsu, { ...emptyMeta().A }, chip("rsu"))).toBe(true);
    expect(clearChip(withRsu, chip("rsu"), "2026/27").rsuVests).toEqual([]);

    const withCar = chip("car").fields[0].set(p, 6_000, "2026/27");
    expect(withCar.salarySacrifice.ev).toEqual({ vehicleP11DValue: 35_000, co2GramsPerKm: 0, annualLeaseCost: 6_000 });

    const director = chip("dir").flag!.set(p, true);
    expect(chipActive(director, emptyMeta().A, chip("dir"))).toBe(true);
    expect(clearChip(director, chip("dir"), "2026/27").isDirector).toBe(false);
  });
  it("counts a ticked option with no figures yet as active", () => {
    expect(chipActive(p, { ...emptyMeta().A, chips: ["gift"] }, chip("gift"))).toBe(true);
    expect(chipActive(p, emptyMeta().A, chip("gift"))).toBe(false);
  });
});

describe("validation", () => {
  const base = emptyHousehold("2026/27");
  it("asks for household type and a child on the first step", () => {
    const e = validateStep("family", base, emptyMeta(), today);
    expect(e.couple).toBeTruthy();
    expect(e.kids).toMatch(/at least one child/);
    const ok = validateStep("family", { ...base, children: [{ dateOfBirth: "2024-01-15", isDisabled: false }] }, { ...emptyMeta(), couple: true }, today);
    expect(ok).toEqual({});
  });
  it("asks for a salary (0 is fine) and catches a pension bigger than the salary", () => {
    const meta = emptyMeta();
    expect(validateStep("A", base, meta, today).salary).toBeTruthy();
    const entered = { ...meta, A: { ...meta.A, salaryEntered: true, pension: "ss" as const } };
    const inputs = { ...base, parentA: withPension({ ...base.parentA, grossSalary: 30_000 }, "ss", 40_000) };
    expect(validateStep("A", inputs, entered, today).pension).toMatch(/more than the salary/);
    expect(validateStep("A", { ...inputs, parentA: withPension(inputs.parentA, "ss", 3_000) }, entered, today)).toEqual({});
  });
});

describe("household mapping", () => {
  it("sets jurisdiction and Scottish rates for both parents", () => {
    const h = withRegion(emptyHousehold("2026/27"), "scotland");
    expect(h.jurisdiction).toBe("scotland");
    expect(h.parentA.scotlandResident && h.parentB!.scotlandResident).toBe(true);
  });
  it("drops blank child rows and the partner for single parents", () => {
    const h = { ...emptyHousehold("2026/27"), children: [{ dateOfBirth: "2024-01-15", isDisabled: false }, { dateOfBirth: "", isDisabled: false }] };
    const engine = toEngineInputs(h, { ...emptyMeta(), couple: false }, today);
    expect(engine.children).toHaveLength(1);
    expect(engine.parentB).toBeNull();
  });
});

describe("preview and summary use the real engine", () => {
  const household = (salaryA: number): HouseholdInputs => ({
    ...emptyHousehold("2026/27"),
    asOfDate: "2026-09-26",
    parentA: { ...createEmptyParentIncome("Alex"), grossSalary: salaryA },
    parentB: { ...createEmptyParentIncome("Parent B"), grossSalary: 40_000 },
    children: [{ dateOfBirth: "2024-06-15", isDisabled: false, childcareBill: { annual: 15_000 } }],
  });

  it("marks childcare support lost over £100k and names the parent", () => {
    const inputs = household(105_000);
    const r = calculate(inputs);
    const statuses = previewStatuses(r);
    expect(statuses.map((s) => s.kind)).toEqual(["lost", "lost", "lost"]);
    const { headline, lines } = summarise(r, inputs);
    expect(headline).toBe("Alex is £5,000 over the £100,000 limit.");
    expect(lines[0]).toMatch(/^That costs your family about £[\d,]+ a year/);
    expect(lines[1]).toMatch(/^The most effective fix: /);
  });

  it("says support is available below the limit", () => {
    const inputs = household(60_000);
    const r = calculate(inputs);
    expect(previewStatuses(r)[0].kind).toBe("ok");
    expect(summarise(r, inputs).headline).toMatch(/^Your family can get about £[\d,]+ a year of support\.$/);
  });

  it("builds review cards with the partner's name", () => {
    const inputs = { ...household(60_000), parentB: { ...createEmptyParentIncome("Sam"), grossSalary: 40_000 } };
    const sections = reviewSections(inputs, { ...emptyMeta(), couple: true }, today);
    expect(sections.map((s) => s.title)).toEqual(["Family", "Alex’s income", "Sam’s income", "Childcare and Child Benefit"]);
    expect(sections[3].rows[0]).toEqual({ k: "Child 1 fees", v: "£15,000 a year" });
  });
});

describe("syncMeta after Edit all details", () => {
  it("follows the pension field that has an amount and the household answers", () => {
    const base = emptyHousehold("2026/27");
    const meta = { ...emptyMeta(), couple: true, A: { ...emptyMeta().A, pension: "ss" as const } };
    const inputs: HouseholdInputs = {
      ...base,
      parentA: withPension({ ...base.parentA, grossSalary: 50_000 }, "sipp", 2_000),
      providerHourlyRates: { under2: 12, age2: 12, age3to4: 12 },
      childBenefitPaymentsElected: false,
    };
    const synced = syncMeta(inputs, meta);
    expect(synced.A.pension).toBe("sipp");
    expect(synced.A.salaryEntered).toBe(true);
    expect(synced.rateKnown).toBe(true);
    expect(synced.cbRegistered).toBe(true);
    expect(synced.cbReceiving).toBe(false);
  });
  it("keeps a chosen method while its amount is set, and 'none' when nothing is set", () => {
    const base = emptyHousehold("2026/27");
    const meta = { ...emptyMeta(), A: { ...emptyMeta().A, pension: "none" as const } };
    expect(syncMeta(base, meta).A.pension).toBe("none");
    expect(syncMeta({ ...base, parentA: withPension(base.parentA, "net", 1_000) }, meta).A.pension).toBe("net");
    const ss = { ...base, parentA: withPension(base.parentA, "ss", 3_000) };
    expect(syncMeta(ss, { ...emptyMeta(), A: { ...emptyMeta().A, pension: "ss" } }).A.pension).toBe("ss");
    expect(syncMeta(base, { ...emptyMeta(), A: { ...emptyMeta().A, pension: "ss" } }).A.pension).toBe("none");
  });
});

describe("plainLever", () => {
  it("keeps the first sentence and drops workings and jargon", () => {
    expect(plainLever("An EV lease costing about £9,900/year would reduce ANI by the required amount after the BiK added back (4% of an assumed £35,000 P11D = £1,400/year). More text."))
      .toBe("An EV lease costing about £9,900/year would reduce the income tested by the required amount after the taxable car benefit added back");
  });
});
