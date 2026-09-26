/**
 * pensions.ts
 *
 * Annual Allowance: pension inputs, threshold and adjusted income, the
 * tapered allowance, the MPAA, carry-forward and the Annual Allowance charge.
 *
 * Follows the structure of HMRC's Pensions Tax Manual (PTM051000 for the
 * Annual Allowance, PTM055100 for carry-forward, PTM056000 for the MPAA and
 * PTM057100 onwards for the taper). rules.md §4.2 and §6.5–6.6.
 *
 * Simplifications, stated so they can be revisited:
 *   - Salary sacrifice pension and employer contributions are treated as
 *     money purchase (DC) inputs.
 *   - A DB pension input amount, when given, is taken to already include any
 *     net pay member contributions (they go to the DB scheme); otherwise net
 *     pay contributions are money purchase inputs.
 *   - Threshold income adds back salary sacrifice pension on the basis that
 *     the arrangement was set up after 8 July 2015 (almost all are).
 */

import type { ParentIncome, PriorYearPensionInput } from "../types/income";
import type { ANIBreakdown, PensionCapacity } from "../types/output";
import type { TaxYearConfig } from "../types/constants";

/** Pension input amounts for the current tax year */
export interface PensionInputs {
  moneyPurchase: number;
  definedBenefit: number;
  total: number;
}

export function pensionInputs(parent: ParentIncome, aniBreakdown: ANIBreakdown): PensionInputs {
  const db = parent.dbPensionInputAmount ?? null;
  const netPay = parent.personalPensionContributions.netPayArrangementGross;
  const moneyPurchase =
    parent.salarySacrifice.pension +
    aniBreakdown.step3PensionDeduction +            // gross relief-at-source (relievable part)
    (parent.employerPensionContributions ?? 0) +
    (db === null ? netPay : 0);
  const definedBenefit = db ?? 0;
  return { moneyPurchase, definedBenefit, total: moneyPurchase + definedBenefit };
}

/**
 * Threshold income (PTM057100): net income, less gross relief-at-source
 * contributions, plus pension salary sacrifice set up after 8 July 2015.
 * Net income here is Step 1 net income (Gift Aid is given by band extension
 * and is not deducted).
 */
export function thresholdIncome(parent: ParentIncome, aniBreakdown: ANIBreakdown): number {
  return aniBreakdown.step1NetIncome - aniBreakdown.step3PensionDeduction + parent.salarySacrifice.pension;
}

/**
 * Adjusted income (PTM057100): net income plus net pay member contributions
 * and employer pension inputs (including salary sacrifice, which is legally an
 * employer contribution). For a DB scheme the employer input is the pension
 * input amount less member contributions; with net pay contributions added
 * back that is the full DB input amount.
 */
export function adjustedIncome(parent: ParentIncome, aniBreakdown: ANIBreakdown): number {
  const db = parent.dbPensionInputAmount ?? null;
  const netPay = parent.personalPensionContributions.netPayArrangementGross;
  return (
    aniBreakdown.step1NetIncome +
    (db === null ? netPay : Math.max(db, netPay)) +
    (parent.employerPensionContributions ?? 0) +
    parent.salarySacrifice.pension
  );
}

/** Annual Allowance figures for a tax year, from the config's history table. */
export function annualAllowanceFor(taxYear: string, config: TaxYearConfig) {
  const entry = config.pension.annualAllowanceHistory[taxYear];
  if (!entry) throw new Error(`No Annual Allowance history for ${taxYear}`);
  return entry;
}

/**
 * The year's Annual Allowance after the taper: reduced by £1 for every £2 of
 * adjusted income over the taper limit, only if threshold income exceeds the
 * threshold, and never below the minimum.
 */
export function effectiveAnnualAllowance(
  threshold: number,
  adjusted: number,
  config: TaxYearConfig,
  taxYear: string = config.taxYear
): { annualAllowance: number; tapered: boolean } {
  const { aa, taperAdjusted, taperThreshold, taperMin } = annualAllowanceFor(taxYear, config);
  if (threshold <= taperThreshold || adjusted <= taperAdjusted) return { annualAllowance: aa, tapered: false };
  const reduction = Math.floor((adjusted - taperAdjusted) / 2);
  return { annualAllowance: Math.max(aa - reduction, taperMin), tapered: true };
}

/** The tax year `n` years before `taxYear`, e.g. ("2025/26", 3) → "2022/23". */
export function previousTaxYear(taxYear: string, n: number): string {
  const start = parseInt(taxYear.slice(0, 4), 10) - n;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Prior-year inputs, from priorYears or the legacy priorYearPensionAllowances.
 * Returns null when neither is given (carry-forward unknown).
 */
export function priorYearInputs(parent: ParentIncome, taxYear: string): PriorYearPensionInput[] | null {
  if (parent.priorYears) return parent.priorYears;
  const legacy = parent.priorYearPensionAllowances;
  if (!legacy) return null;
  return [
    { taxYear: previousTaxYear(taxYear, 1), totalPensionInput: legacy.totalContributionsMinus1Year, wasMember: legacy.schemeMemberMinus1Year ?? true },
    { taxYear: previousTaxYear(taxYear, 2), totalPensionInput: legacy.totalContributionsMinus2Years, wasMember: legacy.schemeMemberMinus2Years ?? true },
    { taxYear: previousTaxYear(taxYear, 3), totalPensionInput: legacy.totalContributionsMinus3Years, wasMember: legacy.schemeMemberMinus3Years ?? true },
  ];
}

/**
 * Unused allowance available to carry forward from the three prior years,
 * oldest first. A year contributes only if the person was a scheme member,
 * and only up to that year's own (possibly tapered) allowance. The current
 * year's allowance is always used first; carry-forward covers any excess.
 */
export function carryForward(prior: PriorYearPensionInput[], taxYear: string, config: TaxYearConfig): number {
  let total = 0;
  for (let n = 3; n >= 1; n--) {
    const year = previousTaxYear(taxYear, n);
    const entry = prior.find((p) => p.taxYear === year);
    if (!entry || !entry.wasMember) continue;
    const allowance = entry.taperedAA ?? annualAllowanceFor(year, config).aa;
    total += Math.max(allowance - entry.totalPensionInput, 0);
  }
  return total;
}

export interface AnnualAllowanceResult {
  inputs: PensionInputs;
  thresholdIncome: number;
  adjustedIncome: number;
  /** The year's allowance after any taper (before the MPAA) */
  annualAllowance: number;
  tapered: boolean;
  mpaaApplies: boolean;
  /** Carry-forward available (null if prior-year data wasn't given) */
  carryForward: number | null;
  /** Pension input above the allowances, taxed as the Annual Allowance charge */
  excess: number;
  /** Further pension input possible this year without a charge (null if carry-forward unknown and inputs already use this year's allowance) */
  headroomThisYear: number;
  maxAdditional: number | null;
}

/**
 * annualAllowanceTest
 *
 * Tests the year's pension inputs against the Annual Allowance.
 *
 * Without the MPAA: excess = total inputs − (allowance + carry-forward).
 * With the MPAA triggered and money purchase inputs above it: the money
 * purchase excess over the MPAA is chargeable with no carry-forward, and
 * other (DB) inputs are tested against the alternative allowance
 * (allowance − MPAA) plus carry-forward. If money purchase inputs are within
 * the MPAA, the normal test applies to all inputs. PTM056000.
 */
export function annualAllowanceTest(
  parent: ParentIncome,
  aniBreakdown: ANIBreakdown,
  config: TaxYearConfig
): AnnualAllowanceResult {
  const inputs = pensionInputs(parent, aniBreakdown);
  const threshold = thresholdIncome(parent, aniBreakdown);
  const adjusted = adjustedIncome(parent, aniBreakdown);
  const { annualAllowance, tapered } = effectiveAnnualAllowance(threshold, adjusted, config);
  const prior = priorYearInputs(parent, config.taxYear);
  const cf = prior ? carryForward(prior, config.taxYear, config) : null;
  const cfOrZero = cf ?? 0;
  const mpaa = config.pension.mpaaAllowance;

  const mpaaBites = parent.mpaaTriggered && inputs.moneyPurchase > mpaa;
  let excess: number;
  let headroomThisYear: number;
  if (mpaaBites) {
    const alternative = Math.max(annualAllowance - mpaa, 0);
    excess = inputs.moneyPurchase - mpaa + Math.max(inputs.definedBenefit - alternative - cfOrZero, 0);
    headroomThisYear = 0;
  } else {
    excess = Math.max(inputs.total - annualAllowance - cfOrZero, 0);
    headroomThisYear = Math.max(annualAllowance - inputs.total, 0);
    if (parent.mpaaTriggered) headroomThisYear = Math.min(headroomThisYear, mpaa - inputs.moneyPurchase);
  }

  // Further money purchase contributions possible without a charge
  const maxAdditional = parent.mpaaTriggered
    ? Math.max(mpaa - inputs.moneyPurchase, 0)
    : cf === null
    ? null
    : Math.max(annualAllowance + cf - inputs.total, 0);

  return {
    inputs,
    thresholdIncome: threshold,
    adjustedIncome: adjusted,
    annualAllowance,
    tapered,
    mpaaApplies: parent.mpaaTriggered,
    carryForward: cf,
    excess,
    headroomThisYear,
    maxAdditional,
  };
}

/** PensionCapacity output from an Annual Allowance test. */
export function buildPensionCapacity(
  parent: ParentIncome,
  aa: AnnualAllowanceResult,
  annualAllowanceCharge: number,
  config: TaxYearConfig
): PensionCapacity {
  const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const warnings: string[] = [];
  if (aa.mpaaApplies) {
    warnings.push(
      `MPAA applies: money purchase contributions above ${fmt(config.pension.mpaaAllowance)} a year are charged, with no carry-forward.`
    );
  }
  if (aa.tapered) {
    warnings.push(
      `Tapered Annual Allowance: adjusted income of ${fmt(aa.adjustedIncome)} and threshold income of ` +
      `${fmt(aa.thresholdIncome)} reduce this year's allowance to ${fmt(aa.annualAllowance)}.`
    );
  }
  if (aa.excess > 0) {
    warnings.push(
      `Pension input of ${fmt(aa.inputs.total)} exceeds the available allowance by ${fmt(aa.excess)}. ` +
      `An Annual Allowance charge of about ${fmt(annualAllowanceCharge)} is included in the income tax figures.`
    );
  }
  if (aa.carryForward === null) {
    warnings.push("Prior-year pension inputs not provided — carry-forward cannot be calculated.");
  }
  if (parent.employerPensionContributions === undefined && parent.dbPensionInputAmount == null) {
    warnings.push(
      "Employer pension contributions not entered. They count towards the Annual Allowance, so headroom may be overstated."
    );
  }

  return {
    parentLabel: parent.label,
    annualAllowance: aa.annualAllowance,
    totalContributionsThisYear: aa.inputs.total,
    moneyPurchaseInput: aa.inputs.moneyPurchase,
    definedBenefitInput: aa.inputs.definedBenefit,
    thresholdIncome: aa.thresholdIncome,
    adjustedIncome: aa.adjustedIncome,
    remainingHeadroomThisYear: aa.headroomThisYear,
    carryForwardAvailable: aa.carryForward,
    maxAdditionalContribution: aa.maxAdditional,
    annualAllowanceExcess: aa.excess,
    annualAllowanceCharge,
    mpaaApplies: aa.mpaaApplies,
    taperedAAApplies: aa.tapered,
    warnings,
  };
}
