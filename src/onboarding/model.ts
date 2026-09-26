/**
 * model.ts — the guided setup's logic, kept free of React so it can be tested.
 *
 * The engine's HouseholdInputs stays the single source of truth for every
 * figure. SetupMeta holds only what the engine doesn't need to know: which
 * questions the person has answered, how they prefer to enter salary, which
 * "does this apply to you?" options they ticked, and so on.
 */

import { createEmptyParentIncome, getTaxYearConfig, rsuVestDateForTaxYear } from "../engine-src/index";
import type { CalculationResult, ChildInfo, HouseholdInputs, ParentIncome, TaxYear } from "../engine-src/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Mode = "landing" | "setup" | "review" | "editall" | "results";
export type StepId = "family" | "A" | "B" | "care" | "cb";
export type ParentKey = "A" | "B";
export type Region = "england" | "scotland" | "wales" | "northern_ireland";
export type PensionMethod = "ss" | "net" | "sipp" | "none";
export type ChipId = "rsu" | "car" | "self" | "rent" | "sav" | "gift" | "bik" | "dir" | "leave" | "mpaa";

export interface ParentMeta {
  /** Whether a salary has been typed (so an entered £0 is told apart from blank) */
  salaryEntered: boolean;
  period: "year" | "month";
  pension: PensionMethod | null;
  chips: ChipId[];
}

export interface SetupMeta {
  couple: boolean | null;
  A: ParentMeta;
  B: ParentMeta;
  /** Whether the person knows their nursery's hourly rate */
  rateKnown: boolean | null;
  /** Answer to "Do you get Universal Credit, vouchers or a childcare grant?" */
  exclusionsAnswer: boolean | null;
  /** Answer to "Have you registered for Child Benefit?" (null = not answered) */
  cbRegistered: boolean | null;
  cbReceiving: boolean | null;
}

export const emptyParentMeta = (): ParentMeta => ({ salaryEntered: false, period: "year", pension: null, chips: [] });

export function emptyMeta(): SetupMeta {
  return { couple: null, A: emptyParentMeta(), B: emptyParentMeta(), rateKnown: null, exclusionsAnswer: null, cbRegistered: null, cbReceiving: null };
}

/** A blank household for someone starting from scratch. */
export function emptyHousehold(taxYear: TaxYear): HouseholdInputs {
  return {
    taxYear,
    parentA: createEmptyParentIncome("Parent A"),
    parentB: createEmptyParentIncome("Parent B"),
    children: [{ dateOfBirth: "", isDisabled: false }],
    childBenefitRegistered: true,
    childBenefitPaymentsElected: true,
    jurisdiction: "england",
    estimatedAnnualChildcareSpend: 0,
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Parse what someone typed ("£45,000", "3750.50") into a number; blank or junk is 0. */
export function parseMoney(text: string): number {
  const n = parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Format for display in an input: "45,000" (pence kept only when present). */
export function formatMoney(n: number): string {
  if (!n) return "";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function stepOrder(meta: SetupMeta): StepId[] {
  return meta.couple === false ? ["family", "A", "care", "cb"] : ["family", "A", "B", "care", "cb"];
}

export function displayName(inputs: HouseholdInputs, key: ParentKey): string {
  const label = (key === "A" ? inputs.parentA : inputs.parentB)?.label ?? "";
  if (label && label !== "Parent A" && label !== "Parent B") return label;
  return key === "A" ? "You" : "Your partner";
}

/** "Your income" / "Sam's income" */
export function incomeTitle(inputs: HouseholdInputs, key: ParentKey): string {
  const name = displayName(inputs, key);
  return name === "You" ? "Your income" : `${name}’s income`;
}

export function stepTitle(inputs: HouseholdInputs, step: StepId): string {
  switch (step) {
    case "family": return "Your family";
    case "A": return incomeTitle(inputs, "A");
    case "B": return incomeTitle(inputs, "B");
    case "care": return "Childcare";
    case "cb": return "Child Benefit";
  }
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export interface ChildFacts {
  valid: boolean;
  error: string;
  /** e.g. "Aged 2 · up to 30 funded hours if you both work" */
  info: string;
  ageLabel: string;
  months: number;
  years: number;
}

export function childFacts(dateOfBirth: string, today: Date): ChildFacts {
  const none: ChildFacts = { valid: false, error: "", info: "", ageLabel: "", months: 0, years: 0 };
  if (!dateOfBirth) return none;
  const dob = new Date(dateOfBirth + "T00:00:00Z");
  if (Number.isNaN(dob.getTime())) return none;
  if (dob > today) {
    return { ...none, error: "That date is in the future. For a baby on the way, add them once they’re born." };
  }
  const months =
    (today.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    today.getUTCMonth() - dob.getUTCMonth() -
    (today.getUTCDate() < dob.getUTCDate() ? 1 : 0);
  const years = Math.floor(months / 12);
  if (years >= 18) {
    return { ...none, error: "Childcare support and Child Benefit stop before 18, so you can leave this child out." };
  }
  const ageLabel = years === 0 ? `${months} month${months === 1 ? "" : "s"} old` : `Aged ${years}`;
  let info: string;
  if (months < 9) info = `${ageLabel} · up to 30 funded hours from the term after 9 months`;
  else if (years < 3) info = `${ageLabel} · up to 30 funded hours if you both work`;
  else if (years < 5) info = `${ageLabel} · 15 hours for everyone, 30 if you both work`;
  else if (years < 12) info = `${ageLabel} · Tax-Free Childcare for clubs and holidays`;
  else info = `${ageLabel} · Child Benefit`;
  return { valid: true, error: "", info, ageLabel, months, years };
}

// ---------------------------------------------------------------------------
// Pensions: one plain question mapped onto the engine's three fields
// ---------------------------------------------------------------------------

export const PENSION_OPTIONS: { id: PensionMethod; title: string; sub: string; tip: string; amountLabel: string; amountHint: string }[] = [
  {
    id: "ss", title: "Taken from my salary before tax", sub: "Salary sacrifice",
    tip: "Your gross pay is lower than your contract salary, and there’s a line like “Pension (SS)” or “Smart pension” above your taxable pay.",
    amountLabel: "How much do you give up a year?",
    amountHint: "Monthly amount × 12. This comes off the income the government tests, pound for pound.",
  },
  {
    id: "net", title: "Taken by my employer from my pay", sub: "Net pay — common in the NHS, teaching and the civil service",
    tip: "A “Pension” deduction appears before tax is worked out, but your gross pay still shows your full salary.",
    amountLabel: "How much is taken a year?",
    amountHint: "Monthly amount × 12. Also comes off the tested income.",
  },
  {
    id: "sipp", title: "I pay into a personal pension or SIPP", sub: "From my own bank account",
    tip: "You pay a provider (such as Vanguard, AJ Bell or PensionBee) yourself, and they add 25% tax relief.",
    amountLabel: "How much do you pay in a year?",
    amountHint: "What leaves your bank account. We add the 25% your provider claims.",
  },
  {
    id: "none", title: "None, or not sure", sub: "You can add it later",
    tip: "Most employees are auto-enrolled. Look for any line with “pension” on your payslip — you can come back to this.",
    amountLabel: "", amountHint: "",
  },
];

export function pensionAmount(p: ParentIncome, method: PensionMethod | null): number {
  switch (method) {
    case "ss": return p.salarySacrifice.pension;
    case "net": return p.personalPensionContributions.netPayArrangementGross;
    case "sipp": return p.personalPensionContributions.reliefAtSourceNet;
    default: return 0;
  }
}

/** Set the amount for the chosen method and clear the other two. */
export function withPension(p: ParentIncome, method: PensionMethod, amount: number): ParentIncome {
  return {
    ...p,
    salarySacrifice: { ...p.salarySacrifice, pension: method === "ss" ? amount : 0 },
    personalPensionContributions: {
      ...p.personalPensionContributions,
      netPayArrangementGross: method === "net" ? amount : 0,
      reliefAtSourceNet: method === "sipp" ? amount : 0,
    },
  };
}

/** Best guess at the method from existing figures (for data entered via Edit all details). */
export function inferPensionMethod(p: ParentIncome): PensionMethod | null {
  if (p.salarySacrifice.pension > 0) return "ss";
  if (p.personalPensionContributions.netPayArrangementGross > 0) return "net";
  if (p.personalPensionContributions.reliefAtSourceNet > 0) return "sipp";
  return null;
}

// ---------------------------------------------------------------------------
// "Does any of this apply to you?"
// ---------------------------------------------------------------------------

export interface ChipField {
  key: string;
  label: string;
  placeholder: string;
  where: string;
  get: (p: ParentIncome) => number;
  set: (p: ParentIncome, value: number, taxYear: TaxYear) => ParentIncome;
}

export interface ChipDef {
  id: ChipId;
  label: string;
  fields: ChipField[];
  note?: string;
  /** Yes/no options with no amount set a flag instead */
  flag?: { get: (p: ParentIncome) => boolean; set: (p: ParentIncome, on: boolean) => ParentIncome };
}

const rsuTotal = (p: ParentIncome) => p.rsuVests.reduce((s, v) => s + v.grossValue, 0);

export const CHIPS: ChipDef[] = [
  {
    id: "rsu", label: "Shares that vest (RSUs)",
    fields: [{
      key: "rsu", label: "Value of shares vesting this tax year", placeholder: "e.g. 20,000",
      where: "Your share plan portal lists each vest date and value. Add up the vests between 6 April and 5 April.",
      get: rsuTotal,
      set: (p, v, taxYear) => ({ ...p, rsuVests: v > 0 ? [{ vestDate: rsuVestDateForTaxYear(taxYear), grossValue: v, employerNICTransferred: false }] : [] }),
    }],
  },
  {
    id: "car", label: "EV or car salary sacrifice",
    fields: [{
      key: "car", label: "Yearly lease cost you give up", placeholder: "e.g. 6,000",
      where: "Your car scheme agreement, or the monthly “EV sacrifice” line on your payslip × 12. The car’s list price and CO2 are in Edit all details.",
      get: (p) => p.salarySacrifice.ev?.annualLeaseCost ?? 0,
      set: (p, v) => ({
        ...p,
        salarySacrifice: {
          ...p.salarySacrifice,
          ev: v > 0 ? { vehicleP11DValue: 35_000, co2GramsPerKm: 0, ...p.salarySacrifice.ev, annualLeaseCost: v } : null,
        },
      }),
    }],
  },
  {
    id: "self", label: "Self-employed or freelance income",
    fields: [{
      key: "self", label: "Profit this year, after expenses", placeholder: "e.g. 12,000",
      where: "Your Self Assessment figures or bookkeeping: income minus allowable expenses.",
      get: (p) => p.selfEmploymentProfit,
      set: (p, v) => ({ ...p, selfEmploymentProfit: v, selfEmployed: v > 0 }),
    }],
  },
  {
    id: "rent", label: "Rental income",
    fields: [
      {
        key: "rent", label: "Rent minus expenses, before mortgage interest", placeholder: "e.g. 9,000",
        where: "Your letting agent’s annual statement. Don’t take off mortgage interest — enter it below.",
        get: (p) => p.rentalIncomeNet,
        set: (p, v) => ({ ...p, rentalIncomeNet: v }),
      },
      {
        key: "rentFinance", label: "Mortgage interest on the let property", placeholder: "e.g. 4,000",
        where: "Your mortgage lender’s annual statement. It gets a 20% tax credit rather than being deducted.",
        get: (p) => p.rentalFinanceCosts ?? 0,
        set: (p, v) => ({ ...p, rentalFinanceCosts: v }),
      },
    ],
  },
  {
    id: "sav", label: "Savings or dividends outside an ISA",
    fields: [
      {
        key: "interest", label: "Savings interest this year", placeholder: "e.g. 1,500",
        where: "Your bank’s annual interest statement. ISA interest doesn’t count, so leave it out.",
        get: (p) => p.savingsInterestNonISA,
        set: (p, v) => ({ ...p, savingsInterestNonISA: v }),
      },
      {
        key: "dividends", label: "Dividends this year", placeholder: "e.g. 800",
        where: "Your broker’s annual tax statement. ISA dividends don’t count.",
        get: (p) => p.dividendsNonISA,
        set: (p, v) => ({ ...p, dividendsNonISA: v }),
      },
    ],
  },
  {
    id: "gift", label: "Gift Aid donations",
    fields: [{
      key: "gift", label: "What you gave (not the tax the charity claims)", placeholder: "e.g. 800",
      where: "Your donation receipts or charity account. We add the 25% the charity claims back for you.",
      get: (p) => p.giftAidDonationsNet,
      set: (p, v) => ({ ...p, giftAidDonationsNet: v }),
    }],
  },
  {
    id: "bik", label: "Private medical cover or other work perks",
    fields: [
      {
        key: "pmi", label: "Private medical insurance (yearly premium)", placeholder: "e.g. 1,200",
        where: "Your P11D form, or a “Medical” benefit line on your payslip.",
        get: (p) => p.benefitsInKind.privateMedicalInsurancePremium,
        set: (p, v) => ({ ...p, benefitsInKind: { ...p.benefitsInKind, privateMedicalInsurancePremium: v } }),
      },
      {
        key: "otherBik", label: "Other taxable perks", placeholder: "e.g. 500",
        where: "The cash equivalents on your P11D form, or a “BIK” line on your payslip.",
        get: (p) => p.benefitsInKind.otherBiKCashEquivalent,
        set: (p, v) => ({ ...p, benefitsInKind: { ...p.benefitsInKind, otherBiKCashEquivalent: v } }),
      },
    ],
  },
  {
    id: "dir", label: "Company director", fields: [],
    note: "Directors’ National Insurance is worked out on the whole year — we’ll handle that for you.",
    flag: { get: (p) => !!p.isDirector, set: (p, on) => ({ ...p, isDirector: on }) },
  },
  {
    id: "leave", label: "On maternity, paternity or adoption leave", fields: [],
    note: "You still count as working for 30 hours and Tax-Free Childcare while on leave.",
    flag: { get: (p) => p.onStatutoryLeave, set: (p, on) => ({ ...p, onStatutoryLeave: on }) },
  },
  {
    id: "mpaa", label: "Taken money flexibly from a pension", fields: [],
    note: "This lowers how much you can pay into pensions each year (the Money Purchase Annual Allowance). Suggestions will respect that limit.",
    flag: { get: (p) => p.mpaaTriggered, set: (p, on) => ({ ...p, mpaaTriggered: on }) },
  },
];

/** An option counts as ticked if the person ticked it or its figures are already set. */
export function chipActive(p: ParentIncome, meta: ParentMeta, chip: ChipDef): boolean {
  return meta.chips.includes(chip.id) || (chip.flag?.get(p) ?? false) || chip.fields.some((f) => f.get(p) > 0);
}

/** Untick an option: clear its figures so hidden answers never count. */
export function clearChip(p: ParentIncome, chip: ChipDef, taxYear: TaxYear): ParentIncome {
  let next = chip.flag ? chip.flag.set(p, false) : p;
  for (const f of chip.fields) next = f.set(next, 0, taxYear);
  return next;
}

// ---------------------------------------------------------------------------
// Household-level answers
// ---------------------------------------------------------------------------

export function withRegion(inputs: HouseholdInputs, region: Region): HouseholdInputs {
  const scot = region === "scotland";
  return {
    ...inputs,
    jurisdiction: region,
    parentA: { ...inputs.parentA, scotlandResident: scot },
    parentB: inputs.parentB ? { ...inputs.parentB, scotlandResident: scot } : null,
  };
}

/** A child's yearly fees before funded hours (0 if not given). */
export function childFees(child: ChildInfo): number {
  const bill = child.childcareBill;
  if (!bill) return child.annualChildcareCost ?? 0;
  return "annual" in bill ? bill.annual : bill.quarterly.reduce((a, b) => a + b, 0);
}

/** Inputs for the engine: drops blank child rows and the partner for single parents. */
export function toEngineInputs(inputs: HouseholdInputs, meta: SetupMeta, today: Date): HouseholdInputs {
  const children = inputs.children.filter((c) => childFacts(c.dateOfBirth, today).valid);
  return { ...inputs, children, parentB: meta.couple === false ? null : inputs.parentB };
}

// ---------------------------------------------------------------------------
// Validation: gentle, per step, saying exactly what's missing
// ---------------------------------------------------------------------------

export type StepErrors = Partial<Record<"couple" | "kids" | "salary" | "pension", string>>;

export function validateStep(step: StepId, inputs: HouseholdInputs, meta: SetupMeta, today: Date): StepErrors {
  const errors: StepErrors = {};
  if (step === "family") {
    if (meta.couple === null) errors.couple = "Choose one to continue.";
    const facts = inputs.children.map((c) => childFacts(c.dateOfBirth, today));
    if (!facts.some((f) => f.valid)) errors.kids = "Add at least one child’s date of birth — this tool is about support for children.";
    else if (facts.some((f) => f.error)) errors.kids = "Fix or remove the child marked below.";
  }
  if (step === "A" || step === "B") {
    const p = step === "A" ? inputs.parentA : inputs.parentB!;
    if (step === "A" && !meta.A.salaryEntered) errors.salary = "Enter your salary, or 0 if you’re not working at the moment.";
    const method = meta[step].pension;
    if ((method === "ss" || method === "net") && p.grossSalary > 0 && pensionAmount(p, method) > p.grossSalary) {
      errors.pension = "That’s more than the salary above — check it’s a yearly figure.";
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Live preview and results summary (from the real engine result)
// ---------------------------------------------------------------------------

export function aniZone(ani: number, taxYear: TaxYear): string {
  const c = getTaxYearConfig(taxYear);
  if (ani <= 0) return "Enter a salary to see where you are.";
  if (ani <= c.hicbc.startThreshold) return "Below £60,000: full Child Benefit and all childcare support.";
  if (ani <= c.hicbc.fullClawbackThreshold) return "£60,000–£80,000: part of Child Benefit is paid back.";
  if (ani <= c.freeHours.maximumANIThreshold) return "£80,000–£100,000: Child Benefit fully paid back; childcare support kept.";
  if (ani <= c.personalAllowanceTaperEnd) return "Over £100,000: Tax-Free Childcare and 30 hours lost; tax-free allowance shrinking.";
  return "Over £125,140: tax-free allowance gone; childcare support lost.";
}

export type StatusKind = "ok" | "risk" | "lost" | "na";

export interface PreviewStatus { label: string; status: string; kind: StatusKind }

export function previewStatuses(result: CalculationResult): PreviewStatus[] {
  const tfc = result.tfc;
  const tfcStatus: PreviewStatus =
    tfc.maxPossibleTopUpAnnual === 0 && tfc.eligible.status !== "not_eligible"
      ? { label: "Tax-Free Childcare", status: "Not yet", kind: "na" }
      : tfc.eligible.status === "not_eligible"
      ? { label: "Tax-Free Childcare", status: "Not eligible", kind: "lost" }
      : tfc.eligible.status === "at_risk"
      ? { label: "Tax-Free Childcare", status: "At risk", kind: "risk" }
      : { label: "Tax-Free Childcare", status: "On track", kind: "ok" };

  const relevant = result.freeHours.children.filter((c) => c.ageGroup !== "school_age_or_over" && c.ageGroup !== "under_9_months");
  const fhStatus: PreviewStatus = relevant.length === 0
    ? { label: "30 hours free childcare", status: "Not yet", kind: "na" }
    : relevant.some((c) => c.workingParentEligibility.status === "not_eligible")
    ? { label: "30 hours free childcare", status: "Not eligible", kind: "lost" }
    : relevant.some((c) => c.workingParentEligibility.status === "at_risk")
    ? { label: "30 hours free childcare", status: "At risk", kind: "risk" }
    : { label: "30 hours free childcare", status: "On track", kind: "ok" };

  const h = result.hicbc;
  const pct = Math.round(h.retentionFraction * 100);
  const cbStatus: PreviewStatus = h.grossChildBenefitAnnual === 0
    ? { label: "Child Benefit", status: "Not yet", kind: "na" }
    : pct === 0
    ? { label: "Child Benefit", status: "Full amount", kind: "ok" }
    : pct < 100
    ? { label: "Child Benefit", status: `${pct}% paid back`, kind: "risk" }
    : { label: "Child Benefit", status: "All paid back", kind: "lost" };

  return [tfcStatus, fhStatus, cbStatus];
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/** The first sentence of an engine recommendation, without jargon or workings in brackets. */
export function plainLever(description: string): string {
  return description
    .split(". ")[0]
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\bANI\b/g, "the income tested")
    .replace(/\bBiK\b/g, "taxable car benefit")
    .replace(/\.$/, "");
}

/**
 * The results headline and 2–3 plain sentences: who is over the limit, what
 * it costs, and the most effective fix (the engine's top recommendation).
 */
export function summarise(result: CalculationResult, inputs: HouseholdInputs): { headline: string; lines: string[] } {
  const cfg = getTaxYearConfig(result.taxYear);
  const cliff = cfg.freeHours.maximumANIThreshold;
  const parents: { key: ParentKey; ani: number }[] = [
    { key: "A", ani: result.parentA.ani.adjustedNetIncome },
    ...(result.parentB ? [{ key: "B" as const, ani: result.parentB.ani.adjustedNetIncome }] : []),
  ];
  const over = parents.filter((p) => p.ani > cliff);
  const near = parents.filter((p) => p.ani <= cliff && cliff - p.ani <= 5_000);
  const lines: string[] = [];
  let headline: string;

  const subject = (key: ParentKey) => {
    const name = displayName(inputs, key);
    return name === "You" ? "You are" : name === "Your partner" ? "Your partner is" : `${name} is`;
  };
  const restore = result.optimisationRecommendations.find((r) => r.kind !== "protective" && r.schemesRestored.some((s) => s === "Tax-Free Childcare" || s === "30-hour free childcare"));

  if (over.length > 0) {
    const first = over[0];
    headline = `${subject(first.key)} ${money(first.ani - cliff)} over the £100,000 limit.`;
    if (restore) {
      lines.push(`That costs your family about ${money(restore.annualBenefitRestored)} a year in Tax-Free Childcare and free hours.`);
      const potLine = restore.pensionPotIncrease ? `, and ${money(restore.pensionPotIncrease)} goes into the pension` : "";
      const action = plainLever(restore.leverDescription);
      lines.push(`The most effective fix: ${action.charAt(0).toLowerCase()}${action.slice(1)}. Overall your household would be ${money(Math.abs(restore.netAnnualGain))} a year ${restore.netAnnualGain >= 0 ? "better" : "worse"} off in cash${potLine}.`);
    } else {
      lines.push("Reducing one parent’s income alone wouldn’t restore childcare support, because the other parent doesn’t qualify either. See the details below.");
    }
  } else if (near.length > 0) {
    headline = "You’re close to the £100,000 limit.";
    lines.push(`${subject(near[0].key)} ${money(cliff - near[0].ani)} below it. A pay rise, bonus or share vest could push the household over and cost its childcare support; a small extra pension contribution keeps a safety margin.`);
  } else {
    const support = result.tfc.estimatedActualTopUpAnnual + result.freeHours.totalWorkingParentAnnualValue + result.hicbc.netChildBenefitAnnual;
    headline = support > 0 ? `Your family can get about ${money(support)} a year of support.` : "Your results";
    if (result.tfc.eligible.status !== "not_eligible") lines.push("You’re under £100,000, so Tax-Free Childcare and the working-parent free hours are open to you.");
    else lines.push(result.tfc.eligible.reason);
  }

  const h = result.hicbc;
  if (h.grossChildBenefitAnnual > 0) {
    const pct = Math.round(h.retentionFraction * 100);
    if (pct === 0) lines.push(`You keep all ${money(h.grossChildBenefitAnnual)} of Child Benefit.`);
    else if (pct < 100) lines.push(`${pct}% of your ${money(h.grossChildBenefitAnnual)} Child Benefit is paid back through the High Income Child Benefit Charge.`);
    else lines.push(`All ${money(h.grossChildBenefitAnnual)} of Child Benefit is paid back. You can stop the payments and keep the State Pension credits.`);
  }
  return { headline, lines };
}

// ---------------------------------------------------------------------------
// Review cards
// ---------------------------------------------------------------------------

export interface ReviewSection { step: StepId; title: string; rows: { k: string; v: string }[] }

export function reviewSections(inputs: HouseholdInputs, meta: SetupMeta, today: Date): ReviewSection[] {
  const regionName: Record<string, string> = { england: "England", scotland: "Scotland", wales: "Wales", northern_ireland: "Northern Ireland" };
  const kids = inputs.children.map((c) => childFacts(c.dateOfBirth, today));
  const family: ReviewSection = {
    step: "family", title: "Family",
    rows: [
      { k: "Household", v: meta.couple === false ? "Single parent" : "Couple" },
      { k: "Lives in", v: regionName[inputs.jurisdiction] },
      ...kids.map((f, i) => ({ k: `Child ${i + 1}`, v: f.valid ? f.ageLabel : "Not given" })),
    ],
  };
  const income = (key: ParentKey): ReviewSection => {
    const p = key === "A" ? inputs.parentA : inputs.parentB!;
    const m = meta[key];
    const rows = [{ k: "Salary", v: `${money(p.grossSalary)} a year` }];
    if (p.bonus.expectedThisYear > 0) rows.push({ k: "Bonus", v: money(p.bonus.expectedThisYear) });
    const method = m.pension ?? inferPensionMethod(p);
    const opt = PENSION_OPTIONS.find((o) => o.id === method);
    rows.push({ k: "Pension", v: opt ? (opt.id === "none" ? "None or not sure" : `${opt.sub.split(" — ")[0]}, ${money(pensionAmount(p, opt.id))} a year`) : "Not answered" });
    for (const chip of CHIPS) {
      if (!chipActive(p, m, chip)) continue;
      const total = chip.fields.reduce((s, f) => s + f.get(p), 0);
      rows.push({ k: chip.label, v: chip.fields.length ? money(total) : "Yes" });
    }
    return { step: key, title: incomeTitle(inputs, key), rows };
  };
  const care: ReviewSection = {
    step: "care", title: "Childcare and Child Benefit",
    rows: [
      ...inputs.children.map((c, i) => ({ k: `Child ${i + 1} fees`, v: childFees(c) > 0 ? `${money(childFees(c))} a year` : "Not given" })),
      { k: "Nursery hourly rate", v: inputs.providerHourlyRates ? `£${inputs.providerHourlyRates.age3to4.toFixed(2)}` : "National average" },
      { k: "Universal Credit, vouchers or grant", v: meta.exclusionsAnswer ? "Yes" : "No" },
      { k: "Child Benefit", v: !inputs.childBenefitRegistered ? "Not registered" : inputs.childBenefitPaymentsElected ? "Registered and paid" : "Registered, payments stopped" },
    ],
  };
  return [family, income("A"), ...(meta.couple === false ? [] : [income("B")]), care];
}

// ---------------------------------------------------------------------------
// Keeping the setup answers in step with figures changed in Edit all details
// ---------------------------------------------------------------------------

/**
 * After Edit all details, bring the guided-setup answers back in line with the
 * figures: the pension method follows whichever field has an amount, and
 * yes/no answers follow the household fields they control.
 */
export function syncMeta(inputs: HouseholdInputs, meta: SetupMeta): SetupMeta {
  const parent = (p: ParentIncome | null, m: ParentMeta): ParentMeta => {
    if (!p) return m;
    const stillTrue = m.pension === "none" ? inferPensionMethod(p) === null : m.pension !== null && pensionAmount(p, m.pension) > 0;
    const pension = stillTrue ? m.pension : inferPensionMethod(p) ?? (m.pension ? "none" : null);
    return { ...m, salaryEntered: m.salaryEntered || p.grossSalary > 0, pension };
  };
  const ex = inputs.tfcExclusions;
  const excluded = !!ex && (ex.receivesUniversalCredit || ex.eitherParentReceivesChildcareVouchers || ex.receivesChildcareBursaryOrGrant);
  return {
    ...meta,
    A: parent(inputs.parentA, meta.A),
    B: parent(inputs.parentB, meta.B),
    rateKnown: inputs.providerHourlyRates ? true : meta.rateKnown === true ? false : meta.rateKnown,
    exclusionsAnswer: excluded ? true : meta.exclusionsAnswer === true ? false : meta.exclusionsAnswer,
    cbRegistered: inputs.childBenefitRegistered,
    cbReceiving: inputs.childBenefitRegistered ? inputs.childBenefitPaymentsElected : meta.cbReceiving,
  };
}
