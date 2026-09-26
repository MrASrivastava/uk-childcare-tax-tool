/**
 * output.ts
 *
 * All output types produced by the calculation engine.
 * Corresponds to rules.md Part 9 (Output Specification).
 *
 * Every output type includes a human-readable explanation field
 * so the UI can surface plain-English rationale alongside numbers.
 */

import type { TaxYear } from "./constants";

// ---------------------------------------------------------------------------
// Eligibility status
// ---------------------------------------------------------------------------

export type EligibilityStatus =
  | "eligible"
  | "not_eligible"
  | "at_risk";    // Within £5,000 of a threshold — eligible now but vulnerable

export interface EligibilityFlag {
  status: EligibilityStatus;
  /** Human-readable reason for the status */
  reason: string;
  /** Gap to nearest threshold (positive = headroom below, negative = over by this amount) */
  thresholdGapGBP: number;
}

// ---------------------------------------------------------------------------
// ANI breakdown (per parent)
// ---------------------------------------------------------------------------

export interface ANIComponent {
  label: string;
  amount: number;
  /** Whether this component adds to or reduces ANI */
  direction: "adds" | "reduces";
  /** Which ANI calculation step this component applies at */
  step: 1 | 2 | 3 | 4;
}

export interface ANIBreakdown {
  parentLabel: string;

  // ---- Step 1 income components -----------------------------------------
  grossSalary: number;
  totalSalarySacrifice: number;          // Total sacrifice deducted from gross salary
  salarySacrifice_pension: number;
  salarySacrifice_ev: number;
  salarySacrifice_cycleToWork: number;
  salarySacrifice_other: number;
  postSacrificeSalary: number;           // grossSalary − totalSalarySacrifice
  /** Net pay arrangement pension contributions deducted in Step 1 */
  netPayPensionContributions: number;

  bonusIncome: number;
  rsuIncome: number;                     // Sum of vest values in this tax year (net of transferred employer NIC)
  biKIncome: number;                     // Total BiK income added
  biK_companyCar: number;
  biK_pmi: number;
  biK_evSacrifice: number;              // BiK added back for EV salary sacrifice vehicle
  biK_other: number;
  cashAllowances: number;
  selfEmploymentProfit: number;
  rentalIncomeNet: number;
  savingsInterestNonISA: number;
  dividendsNonISA: number;
  pensionIncomeGross: number;
  otherTaxableIncome: number;
  /** Relevant UK earnings: caps the relief-at-source contributions that attract relief */
  relevantUKEarnings: number;

  /** Step 1 net income (sum of all above) */
  step1NetIncome: number;

  // ---- Step 2 --------------------------------------------------------
  /** Gross Gift Aid deduction (net donations ÷ 0.8) */
  step2GiftAidDeduction: number;

  // ---- Step 3 --------------------------------------------------------
  /** Gross relief-at-source pension deduction (net contributions ÷ 0.8) */
  step3PensionDeduction: number;

  // ---- Step 4 --------------------------------------------------------
  /** Add-back of s.457/458 reliefs (usually zero) */
  step4Addback: number;

  // ---- Result --------------------------------------------------------
  /** Final ANI = step1 − step2 − step3 + step4 */
  adjustedNetIncome: number;

  /** Distance to nearest threshold (positive = headroom) */
  distanceToHICBCStart: number;        // ANI − 60,000 (negative = below threshold)
  distanceToHICBCFull: number;         // ANI − 80,000
  distanceToPATaperStart: number;      // ANI − 100,000
  distanceToPATaperEnd: number;        // ANI − 125,140
}

// ---------------------------------------------------------------------------
// Personal Allowance result
// ---------------------------------------------------------------------------

export interface PersonalAllowanceResult {
  parentLabel: string;
  ani: number;
  effectivePersonalAllowance: number;
  amountTapered: number;
  /** TRUE if PA is fully zero */
  paFullyWithdrawn: boolean;
}

// ---------------------------------------------------------------------------
// Income tax and NIC (per parent)
// ---------------------------------------------------------------------------

export interface TaxBandResult {
  bandName: string;
  taxableIncome: number;
  rate: number;
  taxCharged: number;
}

export interface IncomeTaxResult {
  parentLabel: string;
  taxableIncome: number;
  personalAllowance: number;
  bands: TaxBandResult[];
  totalIncomeTax: number;
  /** Whether Scottish rates were applied */
  scottishRatesApplied: boolean;
}

export interface NICResult {
  parentLabel: string;
  grossPayForNIC: number;             // Post-sacrifice cash earnings for Class 1 NIC (excludes BiKs)
  employeeNIC: number;
  /** For information only — employer's NIC saving from any salary sacrifice */
  employerNICSavingFromSacrifice: number;
}

// ---------------------------------------------------------------------------
// HICBC result
// ---------------------------------------------------------------------------

export interface HICBCResult {
  /** ANI of the higher-earning partner */
  higherEarnerANI: number;
  higherEarnerLabel: string;
  /** Gross Child Benefit received (before any HICBC) */
  grossChildBenefitAnnual: number;
  /** HICBC charge due */
  hicbcCharge: number;
  /** Net Child Benefit after HICBC */
  netChildBenefitAnnual: number;
  /**
   * Fraction of Child Benefit clawed back by HICBC (0 = none clawed back, 1 = fully clawed back).
   * Note: at £60,000 this is 0 (no clawback); at £80,000+ this is 1 (full clawback).
   * rules.md §2.4.3.
   */
  retentionFraction: number;
  /** Whether the higher earner must file Self Assessment due to HICBC */
  selfAssessmentRequired: boolean;
  /**
   * Whether NI credits are preserved.
   * True when registered (even if opted out of payments) — registration alone preserves credits.
   * False when not registered at all.
   * rules.md §2.4.5.
   */
  niCreditsPreserved: boolean;
  /**
   * Recommendation regarding Child Benefit registration.
   * "keep_payments" / "opt_out_payments" / "register_opt_out"
   */
  recommendation: "keep_payments" | "opt_out_payments" | "register_opt_out";
  recommendationReason: string;
}

// ---------------------------------------------------------------------------
// Free hours eligibility (per child)
// ---------------------------------------------------------------------------

export type FreeHoursAgeGroup =
  | "under_9_months"          // Not yet eligible — show when eligible
  | "9m_to_2yr"               // Working parent entitlement: 30 hrs
  | "age_2yr"                 // Working: 30 hrs; Universal (disadvantaged): 15 hrs
  | "age_3_to_4yr"            // Working: 30 hrs; Universal: 15 hrs
  | "school_age_or_over";     // No longer eligible

export interface FreeHoursChildResult {
  childIndex: number;
  childDateOfBirth: string;
  ageGroup: FreeHoursAgeGroup;

  /** Term date from which the child becomes eligible */
  eligibilityStartDate: string | null;

  /** Hours per week under the working parent entitlement (0 if ineligible or not applicable) */
  workingParentHoursPerWeek: number;
  /** Hours per week under the universal entitlement */
  universalHoursPerWeek: number;

  workingParentEligibility: EligibilityFlag;
  universalEligibility: EligibilityFlag;

  /** Incremental hours gained from working parent entitlement (vs universal) */
  incrementalWorkingParentHours: number;

  /** Estimated annual monetary value of working parent entitlement */
  workingParentAnnualValue: number;
  /** Estimated annual monetary value of universal entitlement */
  universalAnnualValue: number;
  /** Incremental annual value of working parent entitlement vs universal */
  incrementalWorkingParentValue: number;
}

// ---------------------------------------------------------------------------
// TFC eligibility
// ---------------------------------------------------------------------------

export interface TFCResult {
  eligible: EligibilityFlag;

  /** Number of eligible children */
  eligibleChildCount: number;

  /**
   * Maximum possible annual government top-up (if spending ≥ max).
   * Based on eligible children only.
   */
  maxPossibleTopUpAnnual: number;

  /**
   * Estimated actual top-up based on the household's estimated childcare spend.
   * Capped at maxPossibleTopUpAnnual.
   */
  estimatedActualTopUpAnnual: number;

  /**
   * Whether either parent's ANI is within £5,000 of the £100,000 cliff edge.
   * Triggers prominent warning in UI.
   */
  atRisk: boolean;
}

// ---------------------------------------------------------------------------
// Household summary
// ---------------------------------------------------------------------------

export interface HouseholdSummary {
  /** Total net take-home for Parent A */
  parentANetTakeHome: number;
  /** Total net take-home for Parent B (0 if no Parent B) */
  parentBNetTakeHome: number;
  /** Net Child Benefit (after HICBC) */
  netChildBenefit: number;
  /** TFC top-up (estimated) */
  tfcTopUp: number;
  /**
   * Estimated annual value of free hours (working parent entitlement,
   * summed across all eligible children)
   */
  freeHoursAnnualValue: number;
  /**
   * Total household net income + benefits
   */
  totalHouseholdNetPosition: number;
}

// ---------------------------------------------------------------------------
// Pension capacity (carry-forward and headroom)
// ---------------------------------------------------------------------------

export interface PensionCapacity {
  parentLabel: string;
  /** Annual Allowance for this tax year (standard or tapered) */
  annualAllowance: number;
  /** Total contributions made this year across all arrangements */
  totalContributionsThisYear: number;
  /** Remaining headroom in this year's Annual Allowance */
  remainingHeadroomThisYear: number;
  /** Carry-forward available from prior 3 years (null if data not provided) */
  carryForwardAvailable: number | null;
  /** Maximum additional contribution possible this year (headroom + carry-forward) */
  maxAdditionalContribution: number | null;
  /** Whether MPAA applies */
  mpaaApplies: boolean;
  /** Whether tapered AA applies */
  taperedAAApplies: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Optimisation recommendation
// ---------------------------------------------------------------------------

export type MitigationLever =
  | "salary_sacrifice_pension"
  | "personal_pension_sipp"
  | "gift_aid"
  | "ev_salary_sacrifice"
  | "cycle_to_work"
  | "bonus_deferral"
  | "isa_migration"
  | "income_redistribution";

export interface OptimisationRecommendation {
  /** Which parent this recommendation applies to */
  parentLabel: string;

  /** Which scheme(s) would be restored by this action */
  schemesRestored: string[];

  lever: MitigationLever;
  leverDescription: string;

  /**
   * The ANI reduction required to reach the target threshold
   */
  aniReductionRequired: number;

  /**
   * Amount of action needed (e.g. pension contribution of £X, Gift Aid of £Y)
   * This is the "cost" expressed in the lever's natural unit.
   */
  actionRequired: number;
  actionUnit: string;          // "pension contribution (gross)" | "net donation" | etc.

  /**
   * Annual benefit restored by taking this action (£)
   * = value of schemes restored + income tax saving on marginal income
   */
  annualBenefitRestored: number;

  /**
   * Net annual gain = annualBenefitRestored − actionRequired
   * Negative means the action costs more than it recovers (should not be recommended).
   */
  netAnnualGain: number;

  /**
   * For pension contributions: the underlying pension pot growth (not counted
   * as immediate net gain but a significant additional benefit to communicate)
   */
  pensionPotIncrease?: number;

  /**
   * Contraindications or warnings for this recommendation
   */
  warnings: string[];

  /** Whether this lever is immediately actionable by the user */
  immediatelyActionable: boolean;

  priority: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Marginal rate chart data
// ---------------------------------------------------------------------------

export interface MarginalRateDataPoint {
  ani: number;
  incomeTaxMarginalRate: number;
  nicMarginalRate: number;
  personalAllowanceTaperEffect: number;   // Additional effective rate from PA withdrawal
  hicbcWithdrawalRate: number;            // HICBC expressed as effective marginal rate
  /** Free-hours benefit loss expressed as effective marginal rate at the £100k cliff */
  freeHoursBenefitLossRate: number;
  /** TFC benefit loss expressed as effective marginal rate at the £100k cliff */
  tfcBenefitLossRate: number;
  /** Sum of freeHoursBenefitLossRate + tfcBenefitLossRate */
  childcareBenefitLossRate: number;
  /** Total effective marginal rate (sum of all above) */
  totalEffectiveMarginalRate: number;
}

// ---------------------------------------------------------------------------
// Top-level calculation result
// ---------------------------------------------------------------------------

export interface CalculationResult {
  taxYear: TaxYear;
  calculatedAt: string;                  // ISO timestamp

  parentA: {
    ani: ANIBreakdown;
    personalAllowance: PersonalAllowanceResult;
    incomeTax: IncomeTaxResult;
    nic: NICResult;
    pensionCapacity: PensionCapacity;
  };

  parentB: {
    ani: ANIBreakdown;
    personalAllowance: PersonalAllowanceResult;
    incomeTax: IncomeTaxResult;
    nic: NICResult;
    pensionCapacity: PensionCapacity;
  } | null;

  hicbc: HICBCResult;

  tfc: TFCResult;

  freeHours: {
    children: FreeHoursChildResult[];
    totalWorkingParentAnnualValue: number;
  };

  householdSummary: HouseholdSummary;

  optimisationRecommendations: OptimisationRecommendation[];

  marginalRateChart: {
    parentA: MarginalRateDataPoint[];
    parentB: MarginalRateDataPoint[] | null;
  };

  /** Any validation warnings about the inputs */
  inputWarnings: string[];

  /**
   * The ANI at which the household's total net position recovers to match the level
   * it had just before the £100,000 childcare cliff edge.
   * Null if the ANI never reaches above the cliff in the chart range, or if always below.
   * rules.md §9.5 — "crossover point".
   */
  crossoverANI: number | null;

  /**
   * Thresholds the household is approaching (within AT_RISK_BUFFER) but has not yet breached.
   * Surfaced as proactive warnings in the UI.
   */
  atRiskThresholds: AtRiskThreshold[];
}

// ---------------------------------------------------------------------------
// Phase 4 additions — crossover and at-risk signals
// ---------------------------------------------------------------------------

/**
 * AtRiskThreshold — a threshold the household is approaching but has not yet crossed.
 * Used to surface proactive warnings in the UI.
 */
export interface AtRiskThreshold {
  /** Human-readable label e.g. "£100,000 childcare cliff edge" */
  thresholdLabel: string;
  /** Which parent is approaching this threshold */
  parentLabel: string;
  /** How many £ of headroom remain before the threshold is breached */
  currentGap: number;
  /** Estimated annual benefit value at risk if threshold is breached */
  potentialAnnualLossGBP: number;
  /** The specific schemes that would be lost */
  schemesAtRisk: string[];
}
