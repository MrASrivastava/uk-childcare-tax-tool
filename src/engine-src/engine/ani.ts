/**
 * ani.ts
 *
 * Adjusted Net Income (ANI) calculation engine.
 *
 * Implements the 4-step statutory calculation defined in ITA 2007, s.58
 * as specified in rules.md Part 1.
 *
 * IMPORTANT: This module must be kept in strict alignment with rules.md.
 * Every formula references the relevant section. Any change to tax rules
 * must be reflected in rules.md first, then updated here.
 *
 * All monetary values are in GBP, annual, floating-point.
 * The calling layer is responsible for rounding for display purposes.
 * Internally, we preserve full precision to avoid compounding rounding errors.
 */

import type { OtherSacrifice, ParentIncome, RSUVest } from "../types/income";
import type { ANIBreakdown } from "../types/output";
import type { PayFrequency, TaxYearConfig } from "../types/constants";

/** Gross personal contributions always relievable, even with no earnings. */
const RELIEVABLE_CONTRIBUTION_FLOOR = 3_600;

// ---------------------------------------------------------------------------
// RSU helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether an RSU vest date falls within a given UK tax year.
 * UK tax year: 6 April of startYear to 5 April of (startYear + 1).
 *
 * rules.md §1.3: "The taxable event is the vest date... in the tax year of vesting."
 */
function isVestInTaxYear(vestDateISO: string, taxYearStartYear: number): boolean {
  // ISO date strings parse as UTC midnight. Construct boundaries with Date.UTC
  // so comparisons are timezone-safe on any host (including UTC+1 UK servers).
  const vestDate = new Date(vestDateISO + "T00:00:00Z");
  const taxYearStart = new Date(Date.UTC(taxYearStartYear, 3, 6));      // 6 April (UTC)
  const taxYearEnd   = new Date(Date.UTC(taxYearStartYear + 1, 3, 5));  // 5 April next year (UTC)
  return vestDate >= taxYearStart && vestDate <= taxYearEnd;
}

/**
 * Extract the start year of a tax year string (e.g. "2025/26" → 2025).
 */
function taxYearStartYear(taxYear: string): number {
  const year = parseInt(taxYear.slice(0, 4), 10);
  if (isNaN(year)) throw new Error(`Invalid tax year format: ${taxYear}`);
  return year;
}

/**
 * A representative vest date inside a tax year (1 October of its start year),
 * for inputs that record an RSU value without a real vest date. Any date
 * between 6 April and 5 April would do; mid-year keeps well clear of both ends.
 */
export function rsuVestDateForTaxYear(taxYear: string): string {
  return `${taxYearStartYear(taxYear)}-10-01`;
}

/**
 * Calculates the ANI-relevant income from a single RSU vest.
 *
 * rules.md §1.3 and §6.4:
 * - If employerNICTransferred = false: ANI addition = grossValue
 * - If employerNICTransferred = true: ANI addition = grossValue − (grossValue × employerNICRate)
 *   i.e. grossValue × (1 − employerNICRate)
 *
 * Note: Employee NIC is NOT reduced when employer NIC is transferred.
 * This function returns the income-tax-and-ANI-relevant amount only.
 */
export function calculateRSUANIAmount(vest: RSUVest, employerNICRate: number): number {
  if (!vest.employerNICTransferred) {
    return vest.grossValue;
  }
  // Employer NIC transferred: deduct employer NIC from taxable employment income
  const employerNIC = vest.grossValue * employerNICRate;
  return vest.grossValue - employerNIC;
}

// ---------------------------------------------------------------------------
// Salary sacrifice sub-calculation
// ---------------------------------------------------------------------------

interface SalarySacrificeResult {
  /** Total salary given up: reduces cash pay and the Class 1 NIC base */
  totalSacrifice: number;
  pension: number;
  ev: number;
  /** Taxable value of the EV added back to employment income (BiK, or the OpRA value) */
  evBiKIncome: number;
  cycleToWork: number;
  /** Salary given up under "other" sacrifices (all kinds, including legacy `other`) */
  other: number;
  /** Taxable value of OpRA benefits added back to employment income */
  opraTaxableValue: number;
  /** Sacrifice on which the employer saves Class 1 NIC (excludes OpRA items) */
  employerNICSavingBase: number;
  postSacrificeSalary: number;
  warnings: string[];
}

/** CO2 at or below which a car is excluded from the OpRA rules (g/km) */
const OPRA_CAR_CO2_LIMIT = 75;

/**
 * Salary sacrifice for one parent, applying the optional remuneration (OpRA)
 * rules (ITEPA 2003 s.69A): a sacrifice only reduces taxable pay and ANI
 * where the rules allow it. Exported for the minimum income test, NMW check
 * and employer NIC saving, which all need the same figures.
 */
export function calculateSalarySacrifice(
  parent: ParentIncome,
  config: TaxYearConfig
): SalarySacrificeResult {
  const { salarySacrifice, grossSalary } = parent;
  const warnings: string[] = [];

  const pension = salarySacrifice.pension;
  const cycleToWork = salarySacrifice.cycleToWork;

  // EV salary sacrifice: the lease cost reduces gross salary, and the car's
  // taxable value is added back. For a car at 75g/km or less that is the BiK
  // (rules.md §4.4). Above 75g/km OpRA applies: the higher of lease and BiK.
  let evLeaseSacrifice = 0;
  let evBiKIncome = 0;
  let evExempt = true;
  if (salarySacrifice.ev !== null) {
    evLeaseSacrifice = salarySacrifice.ev.annualLeaseCost;
    const biKRate = salarySacrifice.ev.biKRateOverride ?? config.evBiKRate;
    const bik = salarySacrifice.ev.vehicleP11DValue * biKRate;
    evExempt = (salarySacrifice.ev.co2GramsPerKm ?? 0) <= OPRA_CAR_CO2_LIMIT;
    evBiKIncome = evExempt ? bik : Math.max(evLeaseSacrifice, bik);
    if (!evExempt) {
      warnings.push(
        `${parent.label}'s car emits more than ${OPRA_CAR_CO2_LIMIT}g/km CO2, so the optional remuneration rules apply: ` +
        "its taxable value is the higher of the salary given up and the benefit in kind, and the sacrifice does not reduce ANI."
      );
    }
  }

  // Other sacrifices, typed by their OpRA treatment. A legacy bare `other`
  // amount is treated as an OpRA benefit worth the salary given up, so it
  // can't wrongly reduce ANI.
  const items: OtherSacrifice[] = [...(salarySacrifice.otherItems ?? [])];
  if (salarySacrifice.other > 0) {
    items.push({ kind: "opra_benefit", label: "Other (legacy)", salaryForgone: salarySacrifice.other, normalBenefitValue: salarySacrifice.other });
    warnings.push(
      `${parent.label}: salarySacrifice.other is deprecated. It has been treated as a benefit worth the salary given up, ` +
      "so it does not reduce ANI. Use salarySacrifice.otherItems to say whether it is a pay reduction or a benefit."
    );
  }
  let other = 0;
  let opraTaxableValue = 0;
  let employerNICOther = 0;
  for (const item of items) {
    if (item.kind === "opra_benefit") {
      other += item.salaryForgone;
      opraTaxableValue += Math.max(item.salaryForgone, item.normalBenefitValue);
    } else {
      other += item.amount;
      employerNICOther += item.amount;
    }
  }

  const totalSacrifice = pension + evLeaseSacrifice + cycleToWork + other;
  const postSacrificeSalary = grossSalary - totalSacrifice;

  return {
    totalSacrifice,
    pension,
    ev: evLeaseSacrifice,
    evBiKIncome,
    cycleToWork,
    other,
    opraTaxableValue,
    employerNICSavingBase: pension + cycleToWork + employerNICOther + (evExempt ? evLeaseSacrifice : 0),
    postSacrificeSalary,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Benefits in Kind sub-calculation
// ---------------------------------------------------------------------------

interface BiKResult {
  companyCar: number;
  pmi: number;
  other: number;
  total: number;
}

function calculateBiK(parent: ParentIncome): BiKResult {
  const { benefitsInKind } = parent;

  // Company car: P11D value × BiK%
  // rules.md §1.4: for company car (non-sacrifice) provided by employer
  const companyCar =
    benefitsInKind.companyCarP11DValue * benefitsInKind.companyCarBiKRate;

  const pmi = benefitsInKind.privateMedicalInsurancePremium;
  const other = benefitsInKind.otherBiKCashEquivalent;

  return {
    companyCar,
    pmi,
    other,
    total: companyCar + pmi + other,
  };
}

// ---------------------------------------------------------------------------
// RSU total for tax year
// ---------------------------------------------------------------------------

function calculateRSUTotal(parent: ParentIncome, config: TaxYearConfig): number {
  const startYear = taxYearStartYear(config.taxYear);
  return parent.rsuVests
    .filter((vest) => isVestInTaxYear(vest.vestDate, startYear))
    .reduce(
      (sum, vest) => sum + calculateRSUANIAmount(vest, config.employerNICRate),
      0
    );
}

// ---------------------------------------------------------------------------
// Main ANI calculation
// ---------------------------------------------------------------------------

/**
 * calculateANI
 *
 * Computes the full ANI breakdown for a single parent.
 * Implements rules.md §1.2 (The Four-Step Calculation) exactly.
 *
 * Returns an ANIBreakdown object containing every component and the final ANI.
 */
export function calculateANI(
  parent: ParentIncome,
  config: TaxYearConfig
): ANIBreakdown {
  // ---- Salary sacrifice ------------------------------------------------
  const sacrifice = calculateSalarySacrifice(parent, config);

  // ---- Benefits in kind ------------------------------------------------
  const bik = calculateBiK(parent);

  // ---- RSU income ------------------------------------------------------
  const rsuIncome = calculateRSUTotal(parent, config);

  // Net pay arrangement contributions are taken from pay before PAYE, so they
  // reduce employment income in Step 1 (rules.md §1.2 Step 1).
  const netPayPension = parent.personalPensionContributions.netPayArrangementGross;

  // ---- STEP 1: Net income -----------------------------------------------
  // rules.md §1.2 Step 1:
  // Net income = post-sacrifice salary + all other taxable income
  // BiK income from EV sacrifice is added here (it is employment income
  // even though the lease cost is sacrificed)
  const step1NetIncome =
    sacrifice.postSacrificeSalary +      // Gross salary minus all salary sacrifice
    sacrifice.evBiKIncome +              // EV BiK (or OpRA value): added back as employment income
    sacrifice.opraTaxableValue +         // OpRA benefits: taxable value added back
    bik.total +                          // Company car, PMI, other P11D BiK
    parent.bonus.expectedThisYear +      // Bonus
    rsuIncome +                          // RSU vest value (net of transferred employer NIC)
    parent.cashAllowances +              // Taxable cash allowances
    parent.selfEmploymentProfit +        // Self-employment profit
    parent.rentalIncomeNet +             // Net rental income
    parent.savingsInterestNonISA +       // Non-ISA savings interest (full amount)
    parent.dividendsNonISA +             // Non-ISA dividends (full amount)
    parent.pensionIncomeGross +          // Pension / drawdown income
    parent.otherTaxableIncome -          // Other taxable income
    netPayPension;                       // Net pay pension: deducted by payroll before PAYE

  // ---- STEP 2: Gift Aid deduction ----------------------------------------
  // rules.md §1.2 Step 2: deduct grossed-up Gift Aid donations
  // Gross = net donation ÷ 0.8 (= net × 1.25)
  const step2GiftAidDeduction = parent.giftAidDonationsNet / 0.8;

  // ---- STEP 3: Relief-at-source pension deduction -------------------------
  // rules.md §1.2 Step 3:
  // Only applies to relief-at-source arrangements.
  // Net-pay and salary sacrifice pensions are already captured in Step 1.
  // Gross = net contribution ÷ 0.8, limited to the contributions that attract
  // relief: the higher of £3,600 and relevant UK earnings (rules.md §4.2).
  const relevantUKEarnings =
    sacrifice.postSacrificeSalary + sacrifice.evBiKIncome + sacrifice.opraTaxableValue + bik.total +
    parent.bonus.expectedThisYear + rsuIncome + parent.cashAllowances +
    parent.selfEmploymentProfit - netPayPension;
  const step3PensionDeduction = Math.min(
    parent.personalPensionContributions.reliefAtSourceNet / 0.8,
    Math.max(RELIEVABLE_CONTRIBUTION_FLOOR, relevantUKEarnings)
  );

  // ---- STEP 4: Add-back (s.457/458) ---------------------------------------
  // rules.md §1.2 Step 4: add back trade union / police organisation payments
  // Almost always zero for typical employed individuals.
  const step4Addback = 0;

  // ---- RESULT -------------------------------------------------------------
  const adjustedNetIncome =
    step1NetIncome - step2GiftAidDeduction - step3PensionDeduction + step4Addback;

  // ---- Distance to key thresholds -----------------------------------------
  const HICBC_START = config.hicbc.startThreshold;           // 60,000
  const HICBC_FULL = config.hicbc.fullClawbackThreshold;     // 80,000
  const PA_TAPER_START = config.personalAllowanceTaperStart; // 100,000
  const PA_TAPER_END = config.personalAllowanceTaperEnd;     // 125,140

  return {
    parentLabel: parent.label,

    grossSalary: parent.grossSalary,
    totalSalarySacrifice: sacrifice.totalSacrifice,
    salarySacrifice_pension: sacrifice.pension,
    salarySacrifice_ev: sacrifice.ev,
    salarySacrifice_cycleToWork: sacrifice.cycleToWork,
    salarySacrifice_other: sacrifice.other,
    postSacrificeSalary: sacrifice.postSacrificeSalary,
    netPayPensionContributions: netPayPension,

    bonusIncome: parent.bonus.expectedThisYear,
    rsuIncome,
    biKIncome: bik.total + sacrifice.evBiKIncome,
    biK_companyCar: bik.companyCar,
    biK_pmi: bik.pmi,
    biK_evSacrifice: sacrifice.evBiKIncome,
    opraTaxableValue: sacrifice.opraTaxableValue,
    biK_other: bik.other,
    cashAllowances: parent.cashAllowances,
    selfEmploymentProfit: parent.selfEmploymentProfit,
    rentalIncomeNet: parent.rentalIncomeNet,
    savingsInterestNonISA: parent.savingsInterestNonISA,
    dividendsNonISA: parent.dividendsNonISA,
    pensionIncomeGross: parent.pensionIncomeGross,
    otherTaxableIncome: parent.otherTaxableIncome,
    relevantUKEarnings,

    step1NetIncome,
    step2GiftAidDeduction,
    step3PensionDeduction,
    step4Addback,
    adjustedNetIncome,

    distanceToHICBCStart: HICBC_START - adjustedNetIncome,
    distanceToHICBCFull: HICBC_FULL - adjustedNetIncome,
    distanceToPATaperStart: PA_TAPER_START - adjustedNetIncome,
    distanceToPATaperEnd: PA_TAPER_END - adjustedNetIncome,
  };
}

// ---------------------------------------------------------------------------
// Personal Allowance (derived from ANI)
// ---------------------------------------------------------------------------

/**
 * calculatePersonalAllowance
 *
 * Applies the PA taper defined in rules.md Part 3.
 *
 * Formula: PA = max(12570 − max(ANI − 100000, 0) ÷ 2, 0)
 *
 * PA is £12,570 for ANI ≤ £100,000.
 * PA reduces by £1 for every £2 of ANI above £100,000.
 * PA is zero for ANI ≥ £125,140.
 */
export function calculatePersonalAllowance(
  ani: number,
  config: TaxYearConfig
): number {
  const taper = Math.max(ani - config.personalAllowanceTaperStart, 0);
  return Math.max(config.personalAllowance - Math.floor(taper / 2), 0);
}

// ---------------------------------------------------------------------------
// NIC calculation for the employee
// ---------------------------------------------------------------------------

const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  four_weekly: 13,
  monthly: 12,
};
const DAYS_PER_PERIOD: Record<Exclude<PayFrequency, "monthly">, number> = {
  weekly: 7,
  fortnightly: 14,
  four_weekly: 28,
};

/** Tax month (0 = 6 April–5 May … 11 = 6 March–5 April) containing a date. */
function taxMonthIndex(date: Date, taxYearStart: number): number {
  const months = (date.getUTCFullYear() - taxYearStart) * 12 + date.getUTCMonth() - 3;
  return Math.min(Math.max(date.getUTCDate() >= 6 ? months : months - 1, 0), 11);
}

/** Pay period index containing a date, for a given pay frequency. */
function periodIndex(date: Date, taxYearStart: number, frequency: PayFrequency): number {
  if (frequency === "monthly") return taxMonthIndex(date, taxYearStart);
  const days = Math.floor((date.getTime() - Date.UTC(taxYearStart, 3, 6)) / 86_400_000);
  return Math.min(Math.max(Math.floor(days / DAYS_PER_PERIOD[frequency]), 0), PERIODS_PER_YEAR[frequency] - 1);
}

/** Employee Class 1 on one period's earnings, given that period's thresholds. */
function class1OnPeriod(earnings: number, pt: number, uel: number, config: TaxYearConfig): number {
  const [main, additional] = config.employeeNICBands;
  return Math.max(Math.min(earnings, uel) - pt, 0) * main.rate + Math.max(earnings - uel, 0) * additional.rate;
}

/**
 * calculateEmployeeNIC
 *
 * Employee Class 1 NIC, worked out per earnings period as payroll does.
 * NIC is charged on post-sacrifice employment earnings only (not investment
 * income, and not benefits in kind, which attract employer-only Class 1A).
 *
 *   - Base pay (salary after sacrifice + cash allowances) is spread evenly
 *     over the pay periods.
 *   - A bonus is added to the period it is paid in (bonus.paymentMonth), or
 *     spread evenly if that is unknown (with a warning).
 *   - Each RSU vest's GROSS value (not reduced by any transferred employer
 *     NIC — rules.md §6.4) is added to the period containing the vest date.
 *   - Each period is charged using that period's published thresholds.
 *   - Directors use an annual earnings period and the annual thresholds.
 *
 * Mid-year pay changes and HMRC's exact-percentage v table methods are not
 * modelled, so payroll may differ by a few pounds.
 */
export function calculateEmployeeNIC(
  parent: ParentIncome,
  config: TaxYearConfig
): { employmentIncomeForNIC: number; employeeNIC: number; byPeriod: number[]; warnings: string[] } {
  const sacrifice = calculateSalarySacrifice(parent, config);
  const startYear = taxYearStartYear(config.taxYear);
  const warnings: string[] = [];

  const vests = parent.rsuVests.filter((v) => isVestInTaxYear(v.vestDate, startYear));
  const basePay = Math.max(sacrifice.postSacrificeSalary + parent.cashAllowances, 0);
  const bonus = parent.bonus.expectedThisYear;
  const employmentIncomeForNIC = basePay + bonus + vests.reduce((sum, v) => sum + v.grossValue, 0);

  // Directors: annual earnings period
  if (parent.isDirector) {
    const [main] = config.employeeNICBands;
    const nic = class1OnPeriod(employmentIncomeForNIC, main.from, main.to, config);
    return { employmentIncomeForNIC, employeeNIC: nic, byPeriod: [nic], warnings };
  }

  const frequency = parent.payFrequency ?? "monthly";
  const n = PERIODS_PER_YEAR[frequency];
  const earnings = new Array<number>(n).fill(basePay / n);

  if (bonus > 0) {
    const month = parent.bonus.paymentMonth;
    if (month && month >= 1 && month <= 12) {
      const paid = new Date(Date.UTC(startYear, 3 + month - 1, 6));
      earnings[periodIndex(paid, startYear, frequency)] += bonus;
    } else {
      for (let i = 0; i < n; i++) earnings[i] += bonus / n;
      warnings.push(
        `${parent.label}'s bonus payment month isn't set, so it has been spread evenly for National Insurance. ` +
        "A bonus paid in one month usually costs less NIC; set the month for a more accurate figure."
      );
    }
  }

  for (const vest of vests) {
    earnings[periodIndex(new Date(vest.vestDate + "T00:00:00Z"), startYear, frequency)] += vest.grossValue;
  }

  const { primaryThreshold, upperEarningsLimit } = config.class1Periods[frequency];
  const byPeriod = earnings.map((e) => class1OnPeriod(e, primaryThreshold, upperEarningsLimit, config));
  const employeeNIC = byPeriod.reduce((sum, x) => sum + x, 0);

  return { employmentIncomeForNIC, employeeNIC, byPeriod, warnings };
}

/**
 * calculateClass4NIC
 *
 * Class 4 NIC on self-employed profits for the tax year: the main rate between
 * the lower and upper profits limits, the additional rate above. Worked out
 * independently of any Class 1 on employment. Not payable by someone over
 * State Pension age at the start of the tax year. Class 2 is no longer payable
 * (from April 2024 the self-employed get an NI credit above the small profits
 * threshold without paying it).
 */
export function calculateClass4NIC(parent: ParentIncome, config: TaxYearConfig): number {
  if (parent.statePensionAgeReached) return 0;
  const { lowerProfitsLimit, upperProfitsLimit, mainRate, additionalRate } = config.class4NIC;
  const profit = Math.max(parent.selfEmploymentProfit, 0);
  const main = Math.max(Math.min(profit, upperProfitsLimit) - lowerProfitsLimit, 0) * mainRate;
  const additional = Math.max(profit - upperProfitsLimit, 0) * additionalRate;
  return main + additional;
}

// ---------------------------------------------------------------------------
// Income tax calculation
// ---------------------------------------------------------------------------

type TaxBandRow = { bandName: string; taxableIncome: number; rate: number; taxCharged: number };

/**
 * calculateIncomeTax
 *
 * Calculates income tax on Step 1 net income less the personal allowance.
 * The personal allowance itself is derived from ANI (the taper).
 *
 * Relief for relief-at-source pension contributions and Gift Aid is NOT given
 * by deducting them from taxable income. The payer already receives basic-rate
 * relief (the pension scheme / charity reclaims 20%). Any higher-rate relief
 * is given by extending the band thresholds above the basic rate by the gross
 * contribution. rules.md §4.2 and §4.3.
 *
 * Income is taxed in the statutory order (rules.md §5.4):
 *   1. Non-savings income — Scottish bands if scotlandResident, else UK bands
 *   2. Savings interest   — UK bands, starting rate for savings, Personal Savings Allowance
 *   3. Dividends          — UK bands at dividend rates, after the Dividend Allowance
 * The personal allowance is set against non-savings income first.
 * Savings and dividends use the UK bands even for Scottish taxpayers.
 *
 * Rental finance costs (mortgage interest) are not deductible; they give a
 * basic-rate tax reduction instead (rules.md §1.2 Step 1).
 */
export function calculateIncomeTax(
  aniBreakdown: ANIBreakdown,
  effectivePA: number,
  parent: ParentIncome,
  config: TaxYearConfig
): { taxableIncome: number; totalIncomeTax: number; bands: TaxBandRow[]; taxReductions: number } {
  const bandExtension = aniBreakdown.step2GiftAidDeduction + aniBreakdown.step3PensionDeduction;

  const savings = Math.max(parent.savingsInterestNonISA, 0);
  const dividends = Math.max(parent.dividendsNonISA, 0);
  const nonSavings = aniBreakdown.step1NetIncome - savings - dividends;

  // Personal allowance: non-savings first, then savings, then dividends
  let paLeft = effectivePA;
  const taxableNonSavings = Math.max(nonSavings - paLeft, 0);
  paLeft = Math.max(paLeft - nonSavings, 0);
  const taxableSavings = Math.max(savings - paLeft, 0);
  paLeft = Math.max(paLeft - savings, 0);
  const taxableDividends = Math.max(dividends - paLeft, 0);
  const taxableIncome = taxableNonSavings + taxableSavings + taxableDividends;

  const ukBands = extendBands(
    config.incomeTaxBands.map((b, i) => ({
      bandName: i === 0 ? "basic" : i === 1 ? "higher" : "additional",
      from: b.from,
      to: b.to,
      rate: b.rate,
    })),
    bandExtension,
    0
  );
  const nonSavingsBands = parent.scotlandResident
    ? extendBands(
        config.scottishIncomeTaxBands.map((b) => ({ bandName: b.name, from: b.from, to: b.to, rate: b.rate })),
        bandExtension,
        1
      )
    : ukBands;

  const rows: TaxBandRow[] = [];

  // Charge `amount` of income stacked from `start` against `bands`, using
  // `rateFor(bandIndex)` for the rate.
  const charge = (
    start: number,
    amount: number,
    prefix: string,
    bands: typeof ukBands,
    rateFor: (i: number) => number
  ) => {
    const end = start + amount;
    bands.forEach((band, i) => {
      const inBand = Math.max(Math.min(end, band.to) - Math.max(start, band.from), 0);
      if (inBand <= 0) return;
      const rate = rateFor(i);
      rows.push({ bandName: prefix + band.bandName, taxableIncome: inBand, rate, taxCharged: inBand * rate });
    });
  };
  const nilRate = (amount: number, bandName: string) => {
    if (amount > 0) rows.push({ bandName, taxableIncome: amount, rate: 0, taxCharged: 0 });
  };

  // 1. Non-savings income
  charge(0, taxableNonSavings, "", nonSavingsBands, (i) => nonSavingsBands[i].rate);
  let position = taxableNonSavings;

  // 2. Savings income
  const basicRateLimit = ukBands[0].to;
  const additionalRateThreshold = ukBands[ukBands.length - 1].from;
  const psa =
    taxableIncome > additionalRateThreshold
      ? config.personalSavingsAllowance.additionalRate
      : taxableIncome > basicRateLimit
      ? config.personalSavingsAllowance.higherRate
      : config.personalSavingsAllowance.basicRate;

  let savingsLeft = taxableSavings;
  const startingRate = Math.min(Math.max(config.startingRateForSavingsBand - position, 0), savingsLeft);
  nilRate(startingRate, "savings starting rate");
  position += startingRate;
  savingsLeft -= startingRate;
  const psaUsed = Math.min(psa, savingsLeft);
  nilRate(psaUsed, "personal savings allowance");
  position += psaUsed;
  savingsLeft -= psaUsed;
  charge(position, savingsLeft, "savings ", ukBands, (i) => ukBands[i].rate);
  position += savingsLeft;

  // 3. Dividend income
  const dividendAllowanceUsed = Math.min(config.dividendAllowance, taxableDividends);
  nilRate(dividendAllowanceUsed, "dividend allowance");
  position += dividendAllowanceUsed;
  const dividendRates = [config.dividendRates.basic, config.dividendRates.higher, config.dividendRates.additional];
  charge(position, taxableDividends - dividendAllowanceUsed, "dividend ", ukBands, (i) => dividendRates[i]);

  const grossTax = rows.reduce((sum, r) => sum + r.taxCharged, 0);

  // Rental finance cost reducer: 20% of the lower of finance costs and rental profit
  const financeCosts = Math.max(parent.rentalFinanceCosts ?? 0, 0);
  const taxReductions = Math.min(
    config.rentalFinanceCostReliefRate *
      Math.min(financeCosts, Math.max(parent.rentalIncomeNet, 0)),
    grossTax
  );

  return { taxableIncome, totalIncomeTax: grossTax - taxReductions, bands: rows, taxReductions };
}

/**
 * Raises every band boundary from the upper limit of band `firstExtended`
 * onwards by `extension`. For UK bands that is the basic-rate limit and
 * above; for Scottish bands the starter band is left alone and the basic-rate
 * limit and above are raised.
 */
function extendBands<T extends { from: number; to: number }>(
  bands: T[],
  extension: number,
  firstExtended: number
): T[] {
  if (extension <= 0) return bands;
  return bands.map((b, i) => ({
    ...b,
    from: i > firstExtended ? b.from + extension : b.from,
    to: i >= firstExtended && b.to !== Infinity ? b.to + extension : b.to,
  }));
}

// ---------------------------------------------------------------------------
// Pension carry-forward calculation
// ---------------------------------------------------------------------------

/**
 * calculatePensionCarryForward
 *
 * Computes the carry-forward available from the prior 3 tax years.
 * Returns null if prior year data was not provided.
 *
 * rules.md §4.2 and §6.6.
 */
export function calculatePensionCarryForward(
  parent: ParentIncome,
  config: TaxYearConfig
): number | null {
  if (parent.priorYearPensionAllowances === null) return null;
  if (parent.mpaaTriggered) return null; // Carry-forward cannot extend beyond MPAA for DC

  const prior = parent.priorYearPensionAllowances;
  const [aa1, aa2, aa3] = config.pension.priorYearAnnualAllowances;

  // Unused allowance from each year, capped at that year's own Annual
  // Allowance, and only for years in which the person was a scheme member.
  // The current year's allowance is used first: callers add this on top of
  // the remaining current-year headroom.
  const unused = (aa: number, used: number, member: boolean | undefined) =>
    member === false ? 0 : Math.max(aa - used, 0);

  return (
    unused(aa1, prior.totalContributionsMinus1Year, prior.schemeMemberMinus1Year) +
    unused(aa2, prior.totalContributionsMinus2Years, prior.schemeMemberMinus2Years) +
    unused(aa3, prior.totalContributionsMinus3Years, prior.schemeMemberMinus3Years)
  );
}

/**
 * Sums all pension contributions made by a parent across all arrangement types
 * in the current tax year (for Annual Allowance checking).
 *
 * Employer contributions are not included here — they are included in the
 * Annual Allowance but are typically an input from the employer scheme documentation.
 */
export function totalPensionContributionsThisYear(parent: ParentIncome): number {
  return (
    parent.salarySacrifice.pension +                                    // Salary sacrifice
    parent.personalPensionContributions.reliefAtSourceNet / 0.8 +       // Gross relief-at-source
    parent.personalPensionContributions.netPayArrangementGross           // Net pay arrangement
  );
}
