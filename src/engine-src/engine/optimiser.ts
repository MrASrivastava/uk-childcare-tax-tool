/**
 * optimiser.ts — Phase 5 complete
 *
 * Computes mitigation recommendations for households near or over eligibility thresholds.
 * Implements rules.md §7 (step 11 — Optimisation) and Part 4 (Mitigation Levers).
 *
 * Phase 5 additions vs Phase 4:
 *   - NIC saving calculation is band-aware (8% below UEL, 2% above)
 *   - ISA benefit restored is calculated from actual threshold crossings
 *   - EV salary sacrifice recommendation builder (rules.md §4.4)
 *   - Cycle-to-work recommendation builder (rules.md §4.5)
 *   - Income redistribution recommendation builder (rules.md §4.8)
 *   - PA restoration benefit uses correct formula (marginal tax rate × PA amount)
 *   - Partial HICBC: pension recommendation in addition to bonus deferral
 *   - Free-hours incremental value correctly ignores age_3_to_4yr universal portion
 *
 * Design principles:
 *   Every recommendation specifies:
 *   1. Exact ANI reduction required to reach the target threshold
 *   2. Action needed in the lever's natural unit
 *   3. Annual benefit restored (£) — computed precisely per rules
 *   4. Net annual gain (benefit − cost, where cost = out-of-pocket cash)
 *   5. Pension pot increase (additional benefit not counted in net gain)
 *   6. All contraindications and warnings from rules.md
 */

import type { ParentIncome } from "../types/income";
import type {
  ANIBreakdown,
  FreeHoursChildResult,
  HICBCResult,
  OptimisationRecommendation,
  TFCResult,
} from "../types/output";
import type { TaxYearConfig } from "../types/constants";
import {
  calculatePensionCarryForward,
  totalPensionContributionsThisYear,
} from "./ani";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NMW_HOURLY = 12.21;
const STANDARD_ANNUAL_HOURS = 1_950; // ~37.5hrs/week × 52

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const r = (n: number) => Math.round(n);

/**
 * True ANI reduction from a gross relief-at-source or net-pay pension contribution.
 * 1:1 — the gross amount reduces ANI by the same amount.
 */
function grossPensionForANIReduction(aniReduction: number): number {
  return aniReduction;
}

/**
 * Net Gift Aid donation required to achieve a given ANI reduction.
 * ANI reduction = net ÷ 0.8 → net = ANI reduction × 0.8
 */
function netGiftAidForANIReduction(aniReduction: number): number {
  return aniReduction * 0.8;
}

/**
 * Calculate NIC saved on an ADDITIONAL salary sacrifice amount, taking into
 * account whether the sacrifice falls above or below the UEL (£50,270).
 *
 * The NIC base for Class 1 purposes is the post-sacrifice salary. We must
 * start from the post-EXISTING-sacrifice salary (not the raw grossSalary),
 * then subtract the new sacrifice to find the band saving.
 *
 * rules.md §5.3 + §4.1.
 */
function nicSavingOnSacrifice(
  parent: ParentIncome,
  additionalSacrificeAmount: number
): number {
  const UEL = 50_270;
  const PT = 12_570;

  // Existing total sacrifice already in place (reduces NIC base before this new sacrifice)
  const existingSacrifice =
    parent.salarySacrifice.pension +
    (parent.salarySacrifice.ev?.annualLeaseCost ?? 0) +
    parent.salarySacrifice.cycleToWork +
    parent.salarySacrifice.other;

  // NIC base = post-existing-sacrifice salary (before the new additional sacrifice)
  const nicBaseBefore = parent.grossSalary - existingSacrifice;
  const nicBaseAfter  = nicBaseBefore - additionalSacrificeAmount;

  // NIC in the 8% band (between PT and UEL)
  const preIn8Pct  = Math.max(Math.min(nicBaseBefore, UEL) - PT, 0);
  const postIn8Pct = Math.max(Math.min(nicBaseAfter,  UEL) - PT, 0);
  const saving8    = (preIn8Pct - postIn8Pct) * 0.08;

  // NIC in the 2% band (above UEL)
  const preAboveUEL  = Math.max(nicBaseBefore - UEL, 0);
  const postAboveUEL = Math.max(nicBaseAfter  - UEL, 0);
  const saving2      = (preAboveUEL - postAboveUEL) * 0.02;

  return Math.max(saving8 + saving2, 0);
}

/**
 * PA taper tax saving from restoring ANI from currentANI down to targetANI.
 * In the taper zone (£100k–£125,140), each £2 of reduction restores £1 of PA,
 * which is taxed at 40% → £0.40 effective saving per £2 = 20% on the reduction.
 *
 * rules.md Part 3.
 */
function paTaperTaxSaving(
  currentANI: number,
  targetANI: number,
  config: TaxYearConfig
): number {
  const taperStart = config.personalAllowanceTaperStart; // £100,000
  const taperEnd = config.personalAllowanceTaperEnd;     // £125,140
  if (currentANI <= taperStart) return 0;

  const effectiveCurrent = Math.min(currentANI, taperEnd);
  const effectiveTarget = Math.min(Math.max(targetANI, taperStart), taperEnd);
  const taperReduction = effectiveCurrent - effectiveTarget;
  // Each £1 reduction in the taper zone saves £0.20 extra tax (0.40 × 0.5)
  return (taperReduction / 2) * 0.40;
}

// ---------------------------------------------------------------------------
// Pension headroom
// ---------------------------------------------------------------------------

function pensionHeadroomAvailable(
  parent: ParentIncome,
  config: TaxYearConfig
): { headroom: number; warnings: string[] } {
  const totalContributions = totalPensionContributionsThisYear(parent);
  const aa = parent.mpaaTriggered
    ? config.pension.mpaaAllowance
    : config.pension.annualAllowance;
  const remainingThisYear = Math.max(aa - totalContributions, 0);
  const carryForward = calculatePensionCarryForward(parent, config);
  const totalHeadroom =
    carryForward !== null
      ? remainingThisYear + carryForward
      : remainingThisYear;

  const warnings: string[] = [];
  if (parent.mpaaTriggered) {
    warnings.push(
      `MPAA applies — DC pension contributions capped at £${config.pension.mpaaAllowance.toLocaleString()}/year. ` +
        "Carry-forward cannot be used to exceed MPAA for money purchase contributions."
    );
  }
  if (carryForward === null) {
    warnings.push(
      "Prior-year contribution data not provided. " +
        "Carry-forward capacity cannot be calculated — recommendations assume current-year headroom only."
    );
  }
  if (totalContributions > aa) {
    warnings.push(
      `Annual Allowance already exceeded this year ` +
        `(£${r(totalContributions).toLocaleString()} contributed vs £${aa.toLocaleString()} AA). ` +
        "An Annual Allowance charge may be due."
    );
  }
  return { headroom: totalHeadroom, warnings };
}

// ---------------------------------------------------------------------------
// NMW check
// ---------------------------------------------------------------------------

function wouldBreachNMW(parent: ParentIncome, additionalSacrifice: number): boolean {
  const currentSacrifice =
    parent.salarySacrifice.pension +
    (parent.salarySacrifice.ev?.annualLeaseCost ?? 0) +
    parent.salarySacrifice.cycleToWork +
    parent.salarySacrifice.other;
  const postSacrifice = parent.grossSalary - currentSacrifice - additionalSacrifice;
  return postSacrifice < NMW_HOURLY * STANDARD_ANNUAL_HOURS;
}

// ---------------------------------------------------------------------------
// ISA benefit calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the annual benefit of moving `nonISAIncome` into an ISA for a parent
 * who is currently at `currentANI`.
 *
 * The benefit = the value of threshold(s) crossed by the ANI reduction.
 * If the ISA migration would bring them below £100,000 → childcare schemes restored.
 * If it would bring them below £80,000 → Child Benefit restored.
 * If it would bring them below £60,000 → HICBC eliminated.
 * Else → pure marginal tax saving (40% on income moved to ISA).
 *
 * rules.md §4.7.
 */
function isaAnnualBenefit(
  currentANI: number,
  nonISAIncome: number,
  tfcMaxTopUp: number,
  freeHoursIncrementalValue: number,
  grossCB: number,
  currentHICBCCharge: number,
  config: TaxYearConfig
): number {
  const targetANI = currentANI - nonISAIncome;
  let benefit = 0;

  // Childcare threshold crossing
  if (
    currentANI > config.freeHours.maximumANIThreshold &&
    targetANI <= config.freeHours.maximumANIThreshold
  ) {
    benefit += tfcMaxTopUp + freeHoursIncrementalValue;
  }

  // HICBC full clawback crossing
  if (
    currentANI > config.hicbc.fullClawbackThreshold &&
    targetANI <= config.hicbc.fullClawbackThreshold
  ) {
    benefit += grossCB; // Full CB restored
  }

  // HICBC partial crossing (into or through the taper band)
  else if (
    currentANI > config.hicbc.startThreshold &&
    targetANI <= config.hicbc.startThreshold
  ) {
    benefit += currentHICBCCharge; // Eliminate all HICBC
  } else if (
    currentANI > config.hicbc.startThreshold &&
    targetANI > config.hicbc.startThreshold
  ) {
    // Partial HICBC reduction
    const hicbcReduction =
      (nonISAIncome / config.hicbc.taperDenominator) * grossCB;
    benefit += hicbcReduction;
  }

  // PA taper saving
  benefit += paTaperTaxSaving(currentANI, targetANI, config);

  // Marginal income tax saving on the income moved to ISA.
  // Only added when no threshold crossings have already been captured.
  // Rate depends on which band the income falls in:
  //   - Basic rate (20%) if ANI ≤ £50,270 after PA
  //   - Higher rate (40%) if ANI > £50,270
  //   - Additional rate (45%) if ANI > £125,140
  // Simplified: use the marginal rate at the current ANI level.
  if (benefit === 0) {
    let marginalRate: number;
    if (currentANI > 125_140) {
      marginalRate = 0.45;
    } else if (currentANI > 50_270) {
      marginalRate = 0.40;
    } else {
      marginalRate = 0.20;
    }
    benefit += nonISAIncome * marginalRate;
  }

  return benefit;
}

// ---------------------------------------------------------------------------
// Pension recommendation builder
// ---------------------------------------------------------------------------

function buildPensionRecommendation(
  parent: ParentIncome,
  aniReductionRequired: number,
  schemesRestored: string[],
  annualBenefitRestored: number,
  config: TaxYearConfig
): OptimisationRecommendation {
  const { headroom, warnings } = pensionHeadroomAvailable(parent, config);
  const grossContributionNeeded = grossPensionForANIReduction(aniReductionRequired);
  const localWarnings = [...warnings];
  let immediatelyActionable = true;

  if (grossContributionNeeded > headroom && headroom > 0) {
    localWarnings.push(
      `Required gross contribution (£${r(grossContributionNeeded).toLocaleString()}) exceeds ` +
        `available Annual Allowance headroom (£${r(headroom).toLocaleString()}). ` +
        "A partial contribution may still partially restore eligibility. " +
        "Check whether prior-year carry-forward data is complete."
    );
    immediatelyActionable = false;
  } else if (grossContributionNeeded > headroom && headroom === 0) {
    localWarnings.push(
      "Annual Allowance headroom is exhausted. No further pension contributions are possible " +
        "this year without triggering an Annual Allowance charge."
    );
    immediatelyActionable = false;
  }

  // Prefer salary sacrifice (also saves NIC) unless NMW would be breached
  const sacrificeBreachesNMW = wouldBreachNMW(parent, grossContributionNeeded);
  const lever: OptimisationRecommendation["lever"] = sacrificeBreachesNMW
    ? "personal_pension_sipp"
    : "salary_sacrifice_pension";

  if (sacrificeBreachesNMW) {
    localWarnings.push(
      "Adding this sacrifice would bring post-sacrifice salary below the National Minimum Wage. " +
        "Use a personal pension / SIPP contribution instead (no NIC saving, but same ANI effect)."
    );
  }

  // Accurate NIC saving: band-aware
  let nicSaving = 0;
  if (lever === "salary_sacrifice_pension") {
    nicSaving = nicSavingOnSacrifice(
      parent,
      grossContributionNeeded
    );
    localWarnings.push(
      "Salary sacrifice also saves employer NIC (15%). Check with your employer that the scheme can accommodate additional contributions."
    );
    localWarnings.push(
      "Salary sacrifice reduces contractual gross salary. This may affect: mortgage affordability assessments, " +
        "statutory maternity/paternity pay, death-in-service calculations. Verify with HR/payroll."
    );
    localWarnings.push(
      "From April 2029, employer NIC relief on salary sacrifice pension contributions will be subject to a government cap. " +
        "This does not affect the income tax or employee NIC efficiency of salary sacrifice in 2025/26 or 2026/27. " +
        "rules.md §4.1."
    );
  }

  // Net cash outlay
  const netContributionPaid =
    lever === "personal_pension_sipp"
      ? grossContributionNeeded * 0.8 // Individual pays net; provider claims 20% relief
      : grossContributionNeeded; // Full amount deducted from gross salary via sacrifice

  const netAnnualGain = annualBenefitRestored - netContributionPaid + nicSaving;

  const leverDescription =
    lever === "salary_sacrifice_pension"
      ? `Increase salary sacrifice pension by £${r(grossContributionNeeded).toLocaleString()} gross/year. ` +
        `Your pension pot grows by £${r(grossContributionNeeded).toLocaleString()} gross. ` +
        `Employee NIC saving: £${r(nicSaving).toLocaleString()}/year (band-accurate). ` +
        `Employer NIC saving of 15% on the sacrifice is an additional benefit to the company.`
      : `Contribute £${r(netContributionPaid).toLocaleString()} net to a personal pension or SIPP. ` +
        `The provider claims £${r(grossContributionNeeded * 0.2).toLocaleString()} basic rate relief, ` +
        `so the pot grows by £${r(grossContributionNeeded).toLocaleString()} gross. ` +
        `Higher-rate relief (additional 20%) can be claimed via Self Assessment.`;

  return {
    parentLabel: parent.label,
    schemesRestored,
    lever,
    leverDescription,
    aniReductionRequired,
    actionRequired:
      lever === "personal_pension_sipp"
        ? netContributionPaid
        : grossContributionNeeded,
    actionUnit:
      lever === "personal_pension_sipp"
        ? "net pension contribution"
        : "gross salary sacrifice pension",
    annualBenefitRestored,
    netAnnualGain,
    pensionPotIncrease: grossContributionNeeded,
    warnings: localWarnings,
    immediatelyActionable,
    priority:
      annualBenefitRestored > 5_000
        ? "high"
        : annualBenefitRestored > 1_000
        ? "medium"
        : "low",
  };
}

// ---------------------------------------------------------------------------
// Gift Aid recommendation builder
// ---------------------------------------------------------------------------

function buildGiftAidRecommendation(
  parent: ParentIncome,
  aniReductionRequired: number,
  schemesRestored: string[],
  annualBenefitRestored: number
): OptimisationRecommendation {
  const netDonationNeeded = netGiftAidForANIReduction(aniReductionRequired);
  const netGain = annualBenefitRestored - netDonationNeeded;

  return {
    parentLabel: parent.label,
    schemesRestored,
    lever: "gift_aid",
    leverDescription:
      `Donate £${r(netDonationNeeded).toLocaleString()} net to charity under Gift Aid. ` +
      `The grossed-up deduction (£${r(aniReductionRequired).toLocaleString()}) reduces ANI by the required amount. ` +
      `Only worthwhile if the giving was already planned, or the benefit substantially exceeds the donation. ` +
      `Gift Aid does not save NIC — less efficient than pension for the same ANI reduction.`,
    aniReductionRequired,
    actionRequired: netDonationNeeded,
    actionUnit: "net Gift Aid donation",
    annualBenefitRestored,
    netAnnualGain: netGain,
    warnings: [
      "Each donation must be backed by a valid Gift Aid declaration to the charity.",
      "The charity reclaims 20% basic rate tax. You claim the additional 20% via Self Assessment.",
      "Gift Aid donations cannot be reversed — ensure benefit exceeds cost before proceeding.",
    ],
    immediatelyActionable: true,
    priority:
      netGain > 5_000 ? "high" : netGain > 0 ? "medium" : "low",
  };
}

// ---------------------------------------------------------------------------
// EV salary sacrifice recommendation builder — rules.md §4.4
// ---------------------------------------------------------------------------

function buildEVRecommendation(
  parent: ParentIncome,
  aniReductionRequired: number,
  schemesRestored: string[],
  annualBenefitRestored: number,
  config: TaxYearConfig
): OptimisationRecommendation | null {
  // EV sacrifice only makes sense if the parent has a salary-paying employer
  // and the employer offers an EV scheme. We can't validate this, but we can
  // check that the parent has no existing EV sacrifice at the required level.
  const existingEVSacrifice = parent.salarySacrifice.ev?.annualLeaseCost ?? 0;

  // Estimate the lease cost needed to achieve the target ANI reduction.
  //
  // Net ANI reduction = lease_cost − (P11D × BiK_rate)
  //   → aniReductionRequired = lease_cost − (P11D × evBiKRate)
  //
  // We don't know the exact P11D, so we use a typical EV: £35,000.
  // This gives:
  //   lease_cost = aniReductionRequired + (35_000 × evBiKRate)
  //   [solving: aniReduction = lease − biK, biK = P11D × rate]
  //
  // This formula is config-year-aware (uses evBiKRate from the config, not a
  // hardcoded 2025/26 multiplier). In 2026/27 where evBiKRate=0.04, the BiK
  // addback is larger, so a bigger lease is needed for the same ANI reduction.
  const TYPICAL_EV_P11D = 35_000;
  const estimatedBiK = TYPICAL_EV_P11D * config.evBiKRate;
  // BiK addback per year is fixed regardless of lease cost (it's % of list price)
  // ANI reduction = lease − biK → lease = aniReduction + biK (per-year biK cost)
  // Approximation: biK cost per year ≈ estimated annual BiK income = P11D × rate
  const estimatedLeaseNeeded = aniReductionRequired + estimatedBiK;

  if (wouldBreachNMW(parent, estimatedLeaseNeeded - existingEVSacrifice)) {
    return null; // NMW would be breached — don't recommend
  }

  const nicSaving = nicSavingOnSacrifice(parent, estimatedLeaseNeeded);
  // BiK adds back to ANI and creates a small income tax liability
  const biKTaxCost = estimatedBiK * 0.40; // At higher rate

  const netAnnualGain = annualBenefitRestored + nicSaving - biKTaxCost;

  return {
    parentLabel: parent.label,
    schemesRestored,
    lever: "ev_salary_sacrifice",
    leverDescription:
      `An EV salary sacrifice lease costing approximately £${r(estimatedLeaseNeeded).toLocaleString()}/year ` +
      `would reduce ANI by the required amount after accounting for the small BiK income ` +
      `(${(config.evBiKRate * 100).toFixed(0)}% of P11D = ~£${r(estimatedBiK).toLocaleString()}/year). ` +
      `This also saves employee NIC (~£${r(nicSaving).toLocaleString()}/year) and provides a vehicle. ` +
      `BiK rates rise 1%/year: 4% in 2026/27, 5% in 2027/28. ` +
      `Requires employer to offer an EV salary sacrifice scheme.`,
    aniReductionRequired,
    actionRequired: estimatedLeaseNeeded,
    actionUnit: "annual EV lease cost via salary sacrifice",
    annualBenefitRestored,
    netAnnualGain,
    warnings: [
      "Employer must offer an EV salary sacrifice scheme — not all employers do.",
      "Sacrifice reduces contractual gross salary — may affect mortgage assessments and statutory pay.",
      `EV BiK rate rises from ${(config.evBiKRate * 100).toFixed(0)}% to 9% by 2029/30 — model future year costs.`,
      "Cannot reduce post-sacrifice salary below National Minimum Wage.",
    ],
    immediatelyActionable: true,
    priority: netAnnualGain > 3_000 ? "high" : "medium",
  };
}

// ---------------------------------------------------------------------------
// Cycle-to-work recommendation builder — rules.md §4.5
// ---------------------------------------------------------------------------

function buildCycleToWorkRecommendation(
  parent: ParentIncome,
  aniReductionRequired: number,
  schemesRestored: string[],
  annualBenefitRestored: number
): OptimisationRecommendation | null {
  // Cycle-to-work maximum is employer-scheme-dependent; typical max £5,000
  const MAX_CYCLE = 5_000;
  if (aniReductionRequired > MAX_CYCLE) return null; // Too small a lever

  if (wouldBreachNMW(parent, aniReductionRequired)) return null;

  const nicSaving = nicSavingOnSacrifice(parent, aniReductionRequired);
  const netAnnualGain = annualBenefitRestored + nicSaving; // Cycle reduces salary — actual cost is 0

  return {
    parentLabel: parent.label,
    schemesRestored,
    lever: "cycle_to_work",
    leverDescription:
      `A cycle-to-work sacrifice of £${r(aniReductionRequired).toLocaleString()}/year reduces ANI ` +
      `by the required amount, saves NIC (~£${r(nicSaving).toLocaleString()}/year), and funds a bicycle. ` +
      `No official cap since 2019 but most employer schemes cap at £1,000–£5,000. ` +
      `No BiK charge if used primarily for qualifying journeys (commuting).`,
    aniReductionRequired,
    actionRequired: aniReductionRequired,
    actionUnit: "annual cycle-to-work sacrifice",
    annualBenefitRestored,
    netAnnualGain,
    warnings: [
      `Employer scheme cap — check your employer's maximum (often £1,000–£5,000).`,
      "Must be used primarily for qualifying journeys to avoid BiK.",
      "Reduces contractual gross salary.",
    ],
    immediatelyActionable: true,
    priority: "medium",
  };
}

// ---------------------------------------------------------------------------
// ISA migration recommendation builder — rules.md §4.7
// ---------------------------------------------------------------------------

function buildISARecommendation(
  parent: ParentIncome,
  nonISAIncome: number,
  currentANI: number,
  computedBenefit: number,
  config: TaxYearConfig
): OptimisationRecommendation {
  const annualISAAllowance = config.isaAllowance; // £20,000

  // How many years to fully migrate this income stream?
  // Approximate: income ÷ (income × yield) — but we don't know the principal.
  // Flag that migration is gradual without assuming principal size.

  const thresholdsCrossed: string[] = [];
  const targetANI = currentANI - nonISAIncome;
  if (
    currentANI > config.freeHours.maximumANIThreshold &&
    targetANI <= config.freeHours.maximumANIThreshold
  ) {
    thresholdsCrossed.push("£100,000 childcare cliff");
  }
  if (
    currentANI > config.hicbc.fullClawbackThreshold &&
    targetANI <= config.hicbc.fullClawbackThreshold
  ) {
    thresholdsCrossed.push("£80,000 HICBC full clawback");
  }
  if (
    currentANI > config.hicbc.startThreshold &&
    targetANI <= config.hicbc.startThreshold
  ) {
    thresholdsCrossed.push("£60,000 HICBC start");
  }

  return {
    parentLabel: parent.label,
    schemesRestored:
      thresholdsCrossed.length > 0
        ? thresholdsCrossed
        : ["Marginal tax saving on investment income"],
    lever: "isa_migration",
    leverDescription:
      `${parent.label} has £${r(nonISAIncome).toLocaleString()}/year of non-ISA savings/dividend ` +
      `income that adds to ANI in full. ` +
      `Moving savings and investments into an ISA eliminates this income from ANI entirely — ` +
      `ISA income is excluded from ANI by statute. ` +
      `ISA allowance: £${annualISAAllowance.toLocaleString()}/person/year. ` +
      (thresholdsCrossed.length > 0
        ? `Migrating this income would cross: ${thresholdsCrossed.join(", ")}.`
        : `No threshold crossing, but tax at 40% on £${r(nonISAIncome).toLocaleString()} = £${r(nonISAIncome * 0.4).toLocaleString()}/year saving.`),
    aniReductionRequired: nonISAIncome,
    actionRequired: annualISAAllowance,
    actionUnit: "ISA contribution per year (max)",
    annualBenefitRestored: computedBenefit,
    netAnnualGain: computedBenefit, // ISA contributions are from existing capital — no cash out
    warnings: [
      "ISA migration is gradual — existing assets can only be ISA-ified at £20,000/year.",
      "Income generated inside the ISA is immediately invisible to HMRC for ANI purposes.",
      "Consider using both partners' ISA allowances (£40,000/year combined).",
      "Unrealised capital gains may be crystallised when moving from non-ISA to ISA — check CGT position.",
    ],
    immediatelyActionable: true,
    priority: computedBenefit > 5_000 ? "high" : computedBenefit > 1_000 ? "medium" : "low",
  };
}

// ---------------------------------------------------------------------------
// Income redistribution recommendation builder — rules.md §4.8
// ---------------------------------------------------------------------------

function buildRedistributionRecommendation(
  higherParent: ParentIncome,
  lowerParentLabel: string,
  nonEmploymentIncome: number,
  _currentHigherANI: number,
  benefitIfMoved: number
): OptimisationRecommendation {
  return {
    parentLabel: higherParent.label,
    schemesRestored: ["ANI reduction via income redistribution to partner"],
    lever: "income_redistribution",
    leverDescription:
      `${higherParent.label} has £${r(nonEmploymentIncome).toLocaleString()}/year of investment ` +
      `or rental income contributing to ANI. Transferring the underlying assets to ${lowerParentLabel} ` +
      `would move this income to the lower earner's ANI, potentially restoring eligibility. ` +
      `Each partner's ANI is tested individually — the household threshold is not combined. ` +
      `This requires a genuine, unconditional transfer of ownership (not just income assignment).`,
    aniReductionRequired: nonEmploymentIncome,
    actionRequired: 0, // No direct cost — transfer of existing assets
    actionUnit: "transfer of income-producing assets to partner",
    annualBenefitRestored: benefitIfMoved,
    netAnnualGain: benefitIfMoved, // No immediate cash cost
    warnings: [
      "Must be a genuine unconditional gift of capital — HMRC's settlements legislation " +
        "(ITTOIA 2005, Part 5) can apply to artificial income-redirecting arrangements.",
      "Transferring capital assets may trigger Capital Gains Tax on unrealised gains — check CGT position first.",
      "Cannot split or transfer employment income, salary, or bonuses.",
      "Appropriate for savings accounts, investment portfolios, and rental property only.",
      "Seek legal and tax advice before transferring property or significant investment assets.",
    ],
    immediatelyActionable: false,
    priority: benefitIfMoved > 5_000 ? "high" : "medium",
  };
}

// ---------------------------------------------------------------------------
// Main recommendation function
// ---------------------------------------------------------------------------

/**
 * computeOptimisationRecommendations
 *
 * For each parent that is over or near a threshold:
 * 1. Calculates the minimum ANI reduction to restore each lost scheme
 * 2. Generates ranked recommendations for all available levers
 * 3. Adds at-risk proactive warnings for households within £5k of a threshold
 *
 * rules.md §7 (step 11) and Part 4.
 */
export function computeOptimisationRecommendations(
  parentAData: { parent: ParentIncome; ani: ANIBreakdown },
  parentBData: { parent: ParentIncome; ani: ANIBreakdown } | null,
  tfc: TFCResult,
  freeHoursChildren: FreeHoursChildResult[],
  hicbc: HICBCResult,
  config: TaxYearConfig,
  freeHoursTotalIncrementalValue: number,
  tfcMaxTopUp: number
): OptimisationRecommendation[] {
  const recommendations: OptimisationRecommendation[] = [];

  const PA_TAPER = config.personalAllowanceTaperStart;       // £100,000
  const HICBC_START = config.hicbc.startThreshold;           // £60,000
  const HICBC_FULL = config.hicbc.fullClawbackThreshold;     // £80,000
  const AT_RISK = 5_000;

  // The incremental free-hours value = value that is ACTUALLY LOST when over £100k.
  // For age_3_to_4yr, only the additional 15hr working-parent portion is lost,
  // not the universal 15hrs which persists. `incrementalWorkingParentValue` on
  // FreeHoursChildResult captures exactly this.
  const lostFreeHoursValue = freeHoursChildren
    .filter(
      (c) =>
        c.ageGroup !== "school_age_or_over" &&
        c.ageGroup !== "under_9_months" &&
        c.workingParentEligibility.status === "not_eligible"
    )
    .reduce((sum, c) => sum + c.incrementalWorkingParentValue, 0);

  const parents = [
    { parent: parentAData.parent, ani: parentAData.ani },
    ...(parentBData
      ? [{ parent: parentBData.parent, ani: parentBData.ani }]
      : []),
  ];

  for (const { parent, ani } of parents) {
    const currentANI = ani.adjustedNetIncome;
    const nonISAIncome = parent.savingsInterestNonISA + parent.dividendsNonISA;
    const redistribableIncome = nonISAIncome + parent.rentalIncomeNet;

    // ======================================================================
    // 1. Restore TFC + free hours + PA taper (£100,000 threshold)
    // ======================================================================
    if (currentANI > PA_TAPER) {
      const aniReductionRequired = currentANI - PA_TAPER;
      const schemesRestored: string[] = [];
      let annualBenefitRestored = 0;

      if (tfc.eligible.status === "not_eligible" && tfcMaxTopUp > 0) {
        schemesRestored.push("Tax-Free Childcare");
        annualBenefitRestored += tfcMaxTopUp;
      }
      if (lostFreeHoursValue > 0) {
        schemesRestored.push("30-hour free childcare");
        annualBenefitRestored += lostFreeHoursValue;
      }

      // PA taper saving — restore PA from current tapered level to full £12,570
      const paSaving = paTaperTaxSaving(currentANI, PA_TAPER, config);
      if (paSaving > 0) {
        schemesRestored.push("Personal allowance restoration");
        annualBenefitRestored += paSaving;
      }

      if (schemesRestored.length > 0 && annualBenefitRestored > 0) {
        recommendations.push(
          buildPensionRecommendation(parent, aniReductionRequired, schemesRestored, annualBenefitRestored, config)
        );
        recommendations.push(
          buildGiftAidRecommendation(parent, aniReductionRequired, schemesRestored, annualBenefitRestored)
        );

        // EV sacrifice as alternative (if applicable)
        const evRec = buildEVRecommendation(parent, aniReductionRequired, schemesRestored, annualBenefitRestored, config);
        if (evRec) recommendations.push(evRec);

        // Cycle-to-work if gap is small enough
        const cycleRec = buildCycleToWorkRecommendation(parent, aniReductionRequired, schemesRestored, annualBenefitRestored);
        if (cycleRec) recommendations.push(cycleRec);
      }
    }

    // ======================================================================
    // 2. Restore full Child Benefit (£80,000 threshold)
    // ======================================================================
    if (currentANI > HICBC_FULL && hicbc.grossChildBenefitAnnual > 0) {
      const aniReductionRequired = currentANI - HICBC_FULL;
      const cbRestored = hicbc.grossChildBenefitAnnual;

      recommendations.push(
        buildPensionRecommendation(
          parent,
          aniReductionRequired,
          ["Full Child Benefit (eliminate HICBC)"],
          cbRestored,
          config
        )
      );
    }

    // ======================================================================
    // 3. Eliminate HICBC entirely (£60,000 threshold)
    // ======================================================================
    if (
      currentANI > HICBC_START &&
      currentANI <= HICBC_FULL &&
      hicbc.hicbcCharge > 0
    ) {
      const aniReductionRequired = currentANI - HICBC_START;
      recommendations.push(
        buildPensionRecommendation(
          parent,
          aniReductionRequired,
          ["Full Child Benefit — eliminate HICBC entirely"],
          hicbc.hicbcCharge,
          config
        )
      );
      recommendations.push(
        buildGiftAidRecommendation(
          parent,
          aniReductionRequired,
          ["Full Child Benefit — eliminate HICBC entirely"],
          hicbc.hicbcCharge
        )
      );
    }

    // ======================================================================
    // 4. Partial HICBC reduction (bonus deferral + partial pension)
    // ======================================================================
    if (currentANI > HICBC_START && hicbc.hicbcCharge > 0) {
      const valuePerANIReduction =
        hicbc.grossChildBenefitAnnual / config.hicbc.taperDenominator;

      // Bonus deferral
      if (parent.bonus.expectedThisYear > 0) {
        const bonusANIImpact = parent.bonus.expectedThisYear;
        const cbSavingIfDeferred = Math.min(
          bonusANIImpact * valuePerANIReduction,
          hicbc.grossChildBenefitAnnual
        );
        recommendations.push({
          parentLabel: parent.label,
          schemesRestored: ["Partial Child Benefit recovery (bonus year)"],
          lever: "bonus_deferral",
          leverDescription: parent.bonus.isDiscretionary
            ? `Deferring ${parent.label}'s bonus of £${r(parent.bonus.expectedThisYear).toLocaleString()} to next tax year ` +
              `would reduce this year's ANI by the same amount, recovering £${r(cbSavingIfDeferred).toLocaleString()}/year of Child Benefit ` +
              `(${((cbSavingIfDeferred / hicbc.grossChildBenefitAnnual) * 100).toFixed(0)}% of total). ` +
              "Must be requested before the bonus becomes contractually due."
            : "Bonus deferral applies to discretionary bonuses only. Contractual bonuses cannot be deferred.",
          aniReductionRequired: bonusANIImpact,
          actionRequired: parent.bonus.expectedThisYear,
          actionUnit: "gross bonus deferred to next tax year",
          annualBenefitRestored: cbSavingIfDeferred,
          netAnnualGain: 0, // Income deferred, not lost — timing benefit only
          warnings: [
            "Must be requested before the bonus is contractually due.",
            "The deferred bonus will be received and taxed in the following tax year.",
            !parent.bonus.isDiscretionary
              ? "This bonus is marked as contractual — deferral may not be possible."
              : "",
          ].filter(Boolean),
          immediatelyActionable: parent.bonus.isDiscretionary,
          priority: cbSavingIfDeferred > 500 ? "medium" : "low",
        });
      }

      // Partial pension reduction (even if can't reach £60k)
      const smallReduction = Math.min(currentANI - HICBC_START, 5_000);
      if (smallReduction > 0 && currentANI > HICBC_FULL) {
        // Already covered by "restore full CB" recommendation above
      } else if (smallReduction > 0 && currentANI <= HICBC_FULL) {
        const partialCBSaving = smallReduction * valuePerANIReduction;
        recommendations.push(
          buildPensionRecommendation(
            parent,
            smallReduction,
            ["Partial Child Benefit recovery"],
            partialCBSaving,
            config
          )
        );
      }
    }

    // ======================================================================
    // 5. ISA migration
    // ======================================================================
    if (nonISAIncome > 0) {
      const benefit = isaAnnualBenefit(
        currentANI,
        nonISAIncome,
        tfcMaxTopUp,
        freeHoursTotalIncrementalValue,
        hicbc.grossChildBenefitAnnual,
        hicbc.hicbcCharge,
        config
      );
      recommendations.push(
        buildISARecommendation(parent, nonISAIncome, currentANI, benefit, config)
      );
    }

    // ======================================================================
    // 6. Income redistribution (if higher earner has non-employment income
    //    and there is a lower-earning partner)
    // ======================================================================
    if (redistribableIncome > 0 && parentBData !== null) {
      const lowerParentData =
        parent.label === "Parent A" ? parentBData : parentAData;
      const lowerANI = lowerParentData.ani.adjustedNetIncome;
      const lowerParentLabel = lowerParentData.parent.label;

      // Only recommend if the lower earner is well below any relevant threshold
      if (lowerANI < PA_TAPER - redistribableIncome) {
        const benefit = isaAnnualBenefit(
          currentANI,
          redistribableIncome,
          tfcMaxTopUp,
          freeHoursTotalIncrementalValue,
          hicbc.grossChildBenefitAnnual,
          hicbc.hicbcCharge,
          config
        );
        if (benefit > 0) {
          recommendations.push(
            buildRedistributionRecommendation(
              parent,
              lowerParentLabel,
              redistribableIncome,
              currentANI,
              benefit
            )
          );
        }
      }
    }

    // ======================================================================
    // 7. At-risk proactive warnings (within AT_RISK_BUFFER of a threshold)
    // ======================================================================

    // Approaching £100k childcare cliff
    const gapToCliff = PA_TAPER - currentANI;
    if (gapToCliff > 0 && gapToCliff <= AT_RISK) {
      const potentialLoss = tfcMaxTopUp + freeHoursTotalIncrementalValue;
      if (potentialLoss > 0) {
        recommendations.push({
          parentLabel: parent.label,
          schemesRestored: ["Tax-Free Childcare", "30-hour free childcare"],
          lever: "salary_sacrifice_pension",
          leverDescription:
            `${parent.label}'s ANI (£${r(currentANI).toLocaleString()}) is only £${r(gapToCliff).toLocaleString()} ` +
            `below the £${PA_TAPER.toLocaleString()} childcare cliff edge. ` +
            `A bonus, RSU vest, or savings interest increase could push income over the threshold. ` +
            `Consider increasing pension contributions now to create a buffer. ` +
            `An additional £${r(gapToCliff + 2_000).toLocaleString()} gross pension contribution ` +
            `would provide a £2,000 safety margin.`,
          aniReductionRequired: 0,
          actionRequired: gapToCliff + 2_000,
          actionUnit: "additional pension contribution (gross) — recommended buffer",
          annualBenefitRestored: potentialLoss,
          netAnnualGain: potentialLoss,
          warnings: [
            `Only £${r(gapToCliff).toLocaleString()} of headroom. Any variable income could trigger the cliff.`,
            "Consider locking in protection before the tax year end.",
          ],
          immediatelyActionable: true,
          priority: gapToCliff < 2_000 ? "high" : "medium",
        });
      }
    }

    // Approaching £80k full HICBC clawback
    const gapToHICBCFull = HICBC_FULL - currentANI;
    if (
      gapToHICBCFull > 0 &&
      gapToHICBCFull <= AT_RISK &&
      hicbc.grossChildBenefitAnnual > 0
    ) {
      recommendations.push({
        parentLabel: parent.label,
        schemesRestored: ["Child Benefit (prevent full clawback)"],
        lever: "personal_pension_sipp",
        leverDescription:
          `${parent.label}'s ANI (£${r(currentANI).toLocaleString()}) is only £${r(gapToHICBCFull).toLocaleString()} ` +
          `below £${HICBC_FULL.toLocaleString()} where Child Benefit is fully clawed back. ` +
          `Increasing pension contributions would preserve partial Child Benefit. ` +
          `Net annual benefit currently: £${r(hicbc.netChildBenefitAnnual).toLocaleString()}/year.`,
        aniReductionRequired: 0,
        actionRequired: gapToHICBCFull + 1_000,
        actionUnit: "pension contribution (gross) to create buffer",
        annualBenefitRestored: hicbc.netChildBenefitAnnual,
        netAnnualGain: hicbc.netChildBenefitAnnual * 0.5,
        warnings: [`Within £${r(gapToHICBCFull).toLocaleString()} of total Child Benefit loss.`],
        immediatelyActionable: true,
        priority: "medium",
      });
    }

    // Approaching £60k HICBC start
    const gapToHICBCStart = HICBC_START - currentANI;
    if (
      gapToHICBCStart > 0 &&
      gapToHICBCStart <= AT_RISK &&
      hicbc.grossChildBenefitAnnual > 0
    ) {
      recommendations.push({
        parentLabel: parent.label,
        schemesRestored: ["Child Benefit (prevent HICBC)"],
        lever: "personal_pension_sipp",
        leverDescription:
          `${parent.label}'s ANI (£${r(currentANI).toLocaleString()}) is only £${r(gapToHICBCStart).toLocaleString()} ` +
          `below £${HICBC_START.toLocaleString()} where the High Income Child Benefit Charge begins. ` +
          `Staying below £60,000 preserves the full ` +
          `£${r(hicbc.grossChildBenefitAnnual).toLocaleString()}/year Child Benefit ` +
          `and avoids a Self Assessment filing obligation.`,
        aniReductionRequired: 0,
        actionRequired: gapToHICBCStart + 1_000,
        actionUnit: "pension contribution (gross) to create buffer",
        annualBenefitRestored: hicbc.grossChildBenefitAnnual,
        netAnnualGain: hicbc.grossChildBenefitAnnual,
        warnings: [
          `Only £${r(gapToHICBCStart).toLocaleString()} of headroom before HICBC begins.`,
          "Self Assessment registration required once ANI > £60,000 and CB payments are received.",
        ],
        immediatelyActionable: true,
        priority: gapToHICBCStart < 2_000 ? "high" : "medium",
      });
    }
  }

  // Deduplicate recommendations.
  // Key = parentLabel + lever + round(aniReductionRequired) + first scheme label.
  // The scheme label differentiates at-risk warnings for different thresholds
  // that share the same lever and aniReductionRequired=0 (e.g., the £80k and
  // £60k HICBC at-risk recs both use personal_pension_sipp with aniReduction=0).
  const seen = new Set<string>();
  return recommendations
    .filter((rec) => {
      const schemeTag = rec.schemesRestored[0] ?? "";
      const key = `${rec.parentLabel}:${rec.lever}:${r(rec.aniReductionRequired)}:${schemeTag}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.annualBenefitRestored - a.annualBenefitRestored);
}
