/**
 * constants.ts
 *
 * All UK tax rates, thresholds, and childcare benefit values.
 * Parameterised by tax year so the engine can run against any configured year.
 *
 * Source: HMRC 2025/26 rates, DfE statutory guidance (April 2026),
 *         Child Benefit rates confirmed for 2026/27 (3.8% CPI uprating).
 *
 * IMPORTANT: When adding a new tax year, create a new TaxYearConfig entry.
 * Do not mutate existing entries — historical calculations must remain stable.
 */

export type TaxYear = "2025/26" | "2026/27";

export interface IncomeTaxBand {
  /** Lower bound of taxable income (after personal allowance) */
  from: number;
  /** Upper bound (Infinity for top rate) */
  to: number;
  rate: number;
}

export interface ScottishIncomeTaxBand {
  name: string;
  from: number;
  to: number;
  rate: number;
}

export interface NICBand {
  from: number;
  to: number;
  rate: number;
}

export interface ChildBenefitRates {
  /** Weekly rate for the first/only child */
  firstChildWeekly: number;
  /** Weekly rate for each additional child */
  additionalChildWeekly: number;
}

export interface FreeHoursConfig {
  /** Hours per week for universal 3–4 year old entitlement */
  universalHoursPerWeek: number;
  /** Hours per week for working parent entitlement (all eligible ages) */
  workingParentHoursPerWeek: number;
  /** Minimum number of term weeks per year (statutory floor) */
  minTermWeeksPerYear: number;
  /** Minimum income per parent to qualify (£/year) */
  minimumIncomeThreshold: number;
  /** Maximum ANI per parent — hard cliff edge */
  maximumANIThreshold: number;
}

export interface TFCConfig {
  /** Government top-up rate (currently 20% = basic rate) */
  topUpRate: number;
  /** Maximum government top-up per standard child per year */
  maxTopUpPerChildPerYear: number;
  /** Maximum government top-up per disabled child per year */
  maxTopUpDisabledPerYear: number;
  /** Minimum income threshold (same as free hours) */
  minimumIncomeThreshold: number;
  /** Maximum ANI — hard cliff edge */
  maximumANIThreshold: number;
  /**
   * Birthday after which eligibility ends. A child stays eligible until the
   * 1 September after this birthday (11th for standard children).
   */
  ageLimitBirthday: number;
  /** As ageLimitBirthday, for disabled children (16th birthday) */
  ageLimitBirthdayDisabled: number;
}

export interface HICBCConfig {
  /** ANI at which HICBC begins */
  startThreshold: number;
  /** ANI at which Child Benefit is fully clawed back */
  fullClawbackThreshold: number;
  /** Denominator used in taper calculation */
  taperDenominator: number;
}

export interface PensionConfig {
  /** Standard Annual Allowance */
  annualAllowance: number;
  /** Money Purchase Annual Allowance (triggered by flexible drawdown) */
  mpaaAllowance: number;
  /** Threshold income above which tapered AA consideration begins */
  taperedAA_thresholdIncome: number;
  /** Adjusted income above which tapered AA applies */
  taperedAA_adjustedIncome: number;
  /** Minimum tapered Annual Allowance */
  taperedAA_minimum: number;
}

export interface EVBiKConfig {
  /** Tax year → BIK rate for pure electric vehicles */
  rates: Record<TaxYear, number>;
}

export interface TaxYearConfig {
  taxYear: TaxYear;

  /** Personal Allowance (standard) */
  personalAllowance: number;
  /** ANI at which PA taper begins */
  personalAllowanceTaperStart: number;
  /** ANI at which PA reaches zero */
  personalAllowanceTaperEnd: number;

  /** England/Wales/NI income tax bands (applied to taxable income after PA) */
  incomeTaxBands: IncomeTaxBand[];

  /** Scotland-specific income tax bands */
  scottishIncomeTaxBands: ScottishIncomeTaxBand[];

  /** Employee Class 1 NIC bands */
  employeeNICBands: NICBand[];

  /** Employer Class 1 NIC rate (above secondary threshold) */
  employerNICRate: number;
  /** Employer secondary threshold (annual) */
  employerNICSecondaryThreshold: number;

  /** NMW rate for main rate (used for minimum income threshold calculation) */
  nationalMinimumWageHourly: number;
  /** Hours per week used for minimum income threshold calculation */
  minimumIncomeHoursPerWeek: number;

  childBenefit: ChildBenefitRates;
  hicbc: HICBCConfig;
  freeHours: FreeHoursConfig;
  tfc: TFCConfig;
  pension: PensionConfig;

  /** EV company car BiK rate for this tax year */
  evBiKRate: number;

  /** Annual ISA allowance per person */
  isaAllowance: number;

  /** Personal Savings Allowance by tax band */
  personalSavingsAllowance: {
    basicRate: number;
    higherRate: number;
    additionalRate: number;
  };

  /** Annual dividend allowance */
  dividendAllowance: number;

  /** Dividend tax rates by UK band (dividends always use UK bands, including in Scotland) */
  dividendRates: { basic: number; higher: number; additional: number };

  /** Width of the 0% starting rate band for savings (reduced by taxable non-savings income) */
  startingRateForSavingsBand: number;

  /** Rate of the tax reduction for residential rental finance costs */
  rentalFinanceCostReliefRate: number;

  /** Annual CGT exempt amount */
  cgtAnnualExemptAmount: number;
}

// ---------------------------------------------------------------------------
// 2025/26 Configuration
// ---------------------------------------------------------------------------

const MIN_INCOME_WEEKLY_HOURS = 16;

function deriveMinimumIncome(nmwHourly: number, hoursPerWeek: number): number {
  // 52-week year. HMRC uses a floor (truncation), not rounding.
  // Example: 16 × £12.21 × 52 = £10,158.72 → £10,158 per rules.md §2.2.1.
  return Math.floor(nmwHourly * hoursPerWeek * 52);
}

export const TAX_YEAR_2025_26: TaxYearConfig = {
  taxYear: "2025/26",

  personalAllowance: 12_570,
  personalAllowanceTaperStart: 100_000,
  personalAllowanceTaperEnd: 125_140,

  incomeTaxBands: [
    { from: 0,      to: 37_700,  rate: 0.20 },
    { from: 37_700, to: 125_140, rate: 0.40 },
    { from: 125_140, to: Infinity, rate: 0.45 },
  ],

  scottishIncomeTaxBands: [
    { name: "starter",      from: 0,       to: 2_827,   rate: 0.19 },
    { name: "basic",        from: 2_827,   to: 14_921,  rate: 0.20 },
    { name: "intermediate", from: 14_921,  to: 31_092,  rate: 0.21 },
    { name: "higher",       from: 31_092,  to: 62_430,  rate: 0.42 },
    { name: "advanced",     from: 62_430,  to: 125_140, rate: 0.45 },
    { name: "top",          from: 125_140, to: Infinity, rate: 0.48 },
  ],

  employeeNICBands: [
    { from: 12_570,  to: 50_270,   rate: 0.08 },
    { from: 50_270,  to: Infinity, rate: 0.02 },
  ],

  employerNICRate: 0.15,
  employerNICSecondaryThreshold: 5_000, // Secondary threshold for 2025/26

  nationalMinimumWageHourly: 12.21,
  minimumIncomeHoursPerWeek: MIN_INCOME_WEEKLY_HOURS,

  childBenefit: {
    firstChildWeekly: 25.60,
    additionalChildWeekly: 16.95,
  },

  hicbc: {
    startThreshold: 60_000,
    fullClawbackThreshold: 80_000,
    taperDenominator: 20_000,
  },

  freeHours: {
    universalHoursPerWeek: 15,
    workingParentHoursPerWeek: 30,
    minTermWeeksPerYear: 38,
    minimumIncomeThreshold: deriveMinimumIncome(12.21, MIN_INCOME_WEEKLY_HOURS),
    maximumANIThreshold: 100_000,
  },

  tfc: {
    topUpRate: 0.20,
    maxTopUpPerChildPerYear: 2_000,
    maxTopUpDisabledPerYear: 4_000,
    minimumIncomeThreshold: deriveMinimumIncome(12.21, MIN_INCOME_WEEKLY_HOURS),
    maximumANIThreshold: 100_000,
    ageLimitBirthday: 11,
    ageLimitBirthdayDisabled: 16,
  },

  pension: {
    annualAllowance: 60_000,
    mpaaAllowance: 10_000,
    taperedAA_thresholdIncome: 200_000,
    taperedAA_adjustedIncome: 260_000,
    taperedAA_minimum: 10_000,
  },

  evBiKRate: 0.03,

  isaAllowance: 20_000,

  personalSavingsAllowance: {
    basicRate: 1_000,
    higherRate: 500,
    additionalRate: 0,
  },

  dividendAllowance: 500,
  dividendRates: { basic: 0.0875, higher: 0.3375, additional: 0.3935 },
  startingRateForSavingsBand: 5_000,
  rentalFinanceCostReliefRate: 0.20,
  cgtAnnualExemptAmount: 3_000,
};

// ---------------------------------------------------------------------------
// 2026/27 Configuration (confirmed rates; childcare thresholds assumed unchanged)
// ---------------------------------------------------------------------------

export const TAX_YEAR_2026_27: TaxYearConfig = {
  ...TAX_YEAR_2025_26,
  taxYear: "2026/27",

  // Child Benefit uprated by 3.8% CPI (September 2025 CPI)
  childBenefit: {
    firstChildWeekly: 27.05,
    additionalChildWeekly: 17.90,
  },

  // EV BiK rises to 4% in 2026/27
  evBiKRate: 0.04,

  // Scottish starter and basic thresholds rose 7.4% (to £16,537 and £29,526
  // gross); higher, advanced and top thresholds are frozen. Bands are
  // expressed as taxable income after the £12,570 personal allowance.
  scottishIncomeTaxBands: [
    { name: "starter",      from: 0,       to: 3_967,   rate: 0.19 },
    { name: "basic",        from: 3_967,   to: 16_956,  rate: 0.20 },
    { name: "intermediate", from: 16_956,  to: 31_092,  rate: 0.21 },
    { name: "higher",       from: 31_092,  to: 62_430,  rate: 0.42 },
    { name: "advanced",     from: 62_430,  to: 125_140, rate: 0.45 },
    { name: "top",          from: 125_140, to: Infinity, rate: 0.48 },
  ],

  // Dividend ordinary and upper rates rise by 2 percentage points from April 2026
  dividendRates: { basic: 0.1075, higher: 0.3575, additional: 0.3935 },

  // NMW expected to rise — update when confirmed. Using 2025/26 as placeholder.
  // freeHours.minimumIncomeThreshold will inherit from spread but override here
  // when NMW for 2026/27 is announced.
  freeHours: {
    ...TAX_YEAR_2025_26.freeHours,
    // Will be updated once 2026/27 NMW confirmed
  },

  tfc: {
    ...TAX_YEAR_2025_26.tfc,
    // Will be updated once 2026/27 NMW confirmed
  },
};

// ---------------------------------------------------------------------------
// Registry — add new tax years here
// ---------------------------------------------------------------------------

export const TAX_YEAR_CONFIGS: Record<TaxYear, TaxYearConfig> = {
  "2025/26": TAX_YEAR_2025_26,
  "2026/27": TAX_YEAR_2026_27,
};

export function getTaxYearConfig(year: TaxYear): TaxYearConfig {
  const config = TAX_YEAR_CONFIGS[year];
  return config;
}

// ---------------------------------------------------------------------------
// National average local authority hourly funding rates (indicative)
// Override with user-provided local rates in HouseholdInputs
// ---------------------------------------------------------------------------

export const DEFAULT_LOCAL_HOURLY_RATES = {
  under2: 11.00,
  age2: 9.00,
  age3to4: 7.50,
} as const;
