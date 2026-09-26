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

/** Age band for the childcare minimum income test (apprentices use the lowest rate). */
export type MinimumIncomeAgeBand = "21_plus" | "18_to_20" | "under_18_or_apprentice";

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
  /**
   * Minimum income per parent to qualify (£/year) for someone aged 21 or over,
   * for display. The test itself is on expected earnings over the next
   * 3 months: see minimumIncomeQuarterly().
   */
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
  /** Minimum income threshold for 21 and over, £/year (same as free hours; display only) */
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
  /** Denominator used in taper calculation (1% of CB per complete £200 = 100% over £20,000) */
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
  /**
   * Annual Allowance in each of the three prior tax years, most recent first.
   * Carry-forward from a year is limited to that year's allowance.
   */
  priorYearAnnualAllowances: [number, number, number];
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

  /** National Living Wage (21 and over) — used for the salary sacrifice NMW floor */
  nationalMinimumWageHourly: number;
  /** Hourly minimum wage by age band — drives the childcare minimum income test */
  minimumWageByAgeBand: Record<MinimumIncomeAgeBand, number>;
  /** Hours per week used for minimum income threshold calculation (16) */
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
  // Annual equivalent: 16 hours × NLW × 52 weeks, to the penny (no rounding).
  // Example: 16 × £12.71 × 52 = £10,574.72 (2026/27).
  return Math.round(nmwHourly * hoursPerWeek * 52 * 100) / 100;
}

/**
 * minimumIncomeQuarterly
 *
 * The childcare minimum income test: expected earnings over the next 3 months
 * must be at least 16 hours a week at the minimum wage for the parent's age,
 * over 13 weeks. Example: 16 × £12.71 × 13 = £2,643.68 (21 and over, 2026/27).
 *
 * rules.md §2.2.1.
 */
export function minimumIncomeQuarterly(config: TaxYearConfig, band: MinimumIncomeAgeBand): number {
  return Math.round(config.minimumWageByAgeBand[band] * config.minimumIncomeHoursPerWeek * 13 * 100) / 100;
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
  minimumWageByAgeBand: { "21_plus": 12.21, "18_to_20": 10.00, "under_18_or_apprentice": 7.55 },
  minimumIncomeHoursPerWeek: MIN_INCOME_WEEKLY_HOURS,

  childBenefit: {
    firstChildWeekly: 26.05,
    additionalChildWeekly: 17.25,
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
    // 2024/25, 2023/24, 2022/23 (the AA was £40,000 until 2022/23)
    priorYearAnnualAllowances: [60_000, 60_000, 40_000],
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

  // Minimum wage from April 2026: £12.71 (21+), £10.85 (18–20), £8.00 (under 18 / apprentice)
  nationalMinimumWageHourly: 12.71,
  minimumWageByAgeBand: { "21_plus": 12.71, "18_to_20": 10.85, "under_18_or_apprentice": 8.00 },

  freeHours: {
    ...TAX_YEAR_2025_26.freeHours,
    minimumIncomeThreshold: deriveMinimumIncome(12.71, MIN_INCOME_WEEKLY_HOURS),
  },

  tfc: {
    ...TAX_YEAR_2025_26.tfc,
    minimumIncomeThreshold: deriveMinimumIncome(12.71, MIN_INCOME_WEEKLY_HOURS),
  },

  pension: {
    ...TAX_YEAR_2025_26.pension,
    // 2025/26, 2024/25, 2023/24
    priorYearAnnualAllowances: [60_000, 60_000, 60_000],
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
// Fallback hourly value of funded childcare
// ---------------------------------------------------------------------------
//
// What a funded hour saves a family is the price their provider would
// otherwise charge, which is often well above what the council pays the
// provider. Users should enter their nursery's hourly rate
// (HouseholdInputs.providerHourlyRates). When they don't, the engine falls
// back to the 2026/27 national average funding rates below, which will
// usually UNDERSTATE the value, especially in London.

export const DEFAULT_LOCAL_HOURLY_RATES = {
  under2: 12.04,
  age2: 8.90,
  age3to4: 6.42,
} as const;
