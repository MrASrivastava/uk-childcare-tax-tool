/**
 * index.ts — public API of the UK childcare tax tool engine
 *
 * Import { calculate } and the input/output types from here.
 * Do not import directly from engine/* or types/* in consuming code.
 */

// Main calculator
export { calculate } from "./engine/calculator";

// Input types
export type {
  HouseholdInputs,
  ParentIncome,
  ChildInfo,
  LocalHourlyRates,
  SalarySacrificeInputs,
  EVSalarySacrifice,
  BonusInputs,
  RSUVest,
  BenefitsInKindInputs,
  PersonalPensionContributions,
  PriorYearPensionAllowances,
  Jurisdiction,
  PensionArrangementType,
} from "./types/income";

// Output types
export type {
  CalculationResult,
  ANIBreakdown,
  PersonalAllowanceResult,
  IncomeTaxResult,
  NICResult,
  HICBCResult,
  TFCResult,
  FreeHoursChildResult,
  HouseholdSummary,
  OptimisationRecommendation,
  MarginalRateDataPoint,
  PensionCapacity,
  EligibilityFlag,
  EligibilityStatus,
  FreeHoursAgeGroup,
  MitigationLever,
} from "./types/output";

// Constants (for UI display and overrides)
export {
  getTaxYearConfig,
  DEFAULT_LOCAL_HOURLY_RATES,
  TAX_YEAR_2025_26,
  TAX_YEAR_2026_27,
  minimumIncomeQuarterly,
} from "./types/constants";

export type { TaxYear, TaxYearConfig, MinimumIncomeAgeBand } from "./types/constants";

// Utility: empty parent template for UI forms
export { createEmptyParentIncome } from "./types/income";

// Low-level helpers exposed for testing
export {
  calculateANI,
  calculatePersonalAllowance,
  calculateEmployeeNIC,
  calculatePensionCarryForward,
  totalPensionContributionsThisYear,
  calculateRSUANIAmount,
} from "./engine/ani";

export {
  termAfterAge,
  compulsorySchoolAgeDate,
  getChildAgeGroup,
  parentWorkingEligibilityFlag,
  minimumIncomeTest,
  computeHICBC,
  computeTFCEligibility,
} from "./engine/eligibility";

export {
  computeHICBCCharge,
  grossAnnualChildBenefit,
  computeChildAgeYears,
  tfcEligibleUntil,
  isTFCEligibleChild,
  tfcTopUpValue,
  thresholdStatus,
  AT_RISK_BUFFER,
  mkFlag,
} from "./engine/eligibility";

export type { ChildAgeGroupResult, MinimumIncomeTest } from "./engine/eligibility";

export { computeFreeHoursForChild } from "./engine/eligibility";

export { generateMarginalRateChart, computeCrossoverANI } from "./engine/calculator";
export type { AtRiskThreshold } from "./types/output";
