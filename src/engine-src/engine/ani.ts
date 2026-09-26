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

import type { ParentIncome, RSUVest } from "../types/income";
import type { ANIBreakdown } from "../types/output";
import type { TaxYearConfig } from "../types/constants";

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
  totalSacrifice: number;
  pension: number;
  ev: number;
  evBiKIncome: number;    // BiK income added back for the EV (adds to gross income, not sacrifice)
  cycleToWork: number;
  other: number;
  postSacrificeSalary: number;
}

function calculateSalarySacrifice(
  parent: ParentIncome,
  config: TaxYearConfig
): SalarySacrificeResult {
  const { salarySacrifice, grossSalary } = parent;

  const pension = salarySacrifice.pension;
  const cycleToWork = salarySacrifice.cycleToWork;
  const other = salarySacrifice.other;

  // EV salary sacrifice: the lease cost reduces gross salary, but a BiK is added back
  // rules.md §4.4: net ANI reduction = lease cost − (P11D × BiK rate)
  let evLeaseSacrifice = 0;
  let evBiKIncome = 0;
  if (salarySacrifice.ev !== null) {
    evLeaseSacrifice = salarySacrifice.ev.annualLeaseCost;
    const biKRate = salarySacrifice.ev.biKRateOverride ?? config.evBiKRate;
    evBiKIncome = salarySacrifice.ev.vehicleP11DValue * biKRate;
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
    postSacrificeSalary,
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

  // ---- STEP 1: Net income -----------------------------------------------
  // rules.md §1.2 Step 1:
  // Net income = post-sacrifice salary + all other taxable income
  // BiK income from EV sacrifice is added here (it is employment income
  // even though the lease cost is sacrificed)
  const step1NetIncome =
    sacrifice.postSacrificeSalary +      // Gross salary minus all salary sacrifice
    sacrifice.evBiKIncome +              // EV BiK: added back as employment income
    bik.total +                          // Company car, PMI, other P11D BiK
    parent.bonus.expectedThisYear +      // Bonus
    rsuIncome +                          // RSU vest value (net of transferred employer NIC)
    parent.cashAllowances +              // Taxable cash allowances
    parent.selfEmploymentProfit +        // Self-employment profit
    parent.rentalIncomeNet +             // Net rental income
    parent.savingsInterestNonISA +       // Non-ISA savings interest (full amount)
    parent.dividendsNonISA +             // Non-ISA dividends (full amount)
    parent.pensionIncomeGross +          // Pension / drawdown income
    parent.otherTaxableIncome;           // Other taxable income

  // ---- STEP 2: Gift Aid deduction ----------------------------------------
  // rules.md §1.2 Step 2: deduct grossed-up Gift Aid donations
  // Gross = net donation ÷ 0.8 (= net × 1.25)
  const step2GiftAidDeduction = parent.giftAidDonationsNet / 0.8;

  // ---- STEP 3: Relief-at-source pension deduction -------------------------
  // rules.md §1.2 Step 3:
  // Only applies to relief-at-source arrangements.
  // Net-pay and salary sacrifice pensions are already captured in Step 1 (post-sacrifice salary).
  // Gross = net contribution ÷ 0.8
  const step3PensionDeduction =
    parent.personalPensionContributions.reliefAtSourceNet / 0.8;

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

    bonusIncome: parent.bonus.expectedThisYear,
    rsuIncome,
    biKIncome: bik.total + sacrifice.evBiKIncome,
    biK_companyCar: bik.companyCar,
    biK_pmi: bik.pmi,
    biK_evSacrifice: sacrifice.evBiKIncome,
    biK_other: bik.other,
    cashAllowances: parent.cashAllowances,
    selfEmploymentProfit: parent.selfEmploymentProfit,
    rentalIncomeNet: parent.rentalIncomeNet,
    savingsInterestNonISA: parent.savingsInterestNonISA,
    dividendsNonISA: parent.dividendsNonISA,
    pensionIncomeGross: parent.pensionIncomeGross,
    otherTaxableIncome: parent.otherTaxableIncome,

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

/**
 * calculateEmployeeNIC
 *
 * Calculates employee Class 1 NIC.
 * NIC is charged on post-sacrifice employment income only (not investment income).
 *
 * For RSU vests where employer NIC is transferred:
 *   Employee NIC base = grossRSUValue (NOT net of employer NIC transfer)
 *   See rules.md §6.4.
 *
 * For all other employment income: NIC base = post-sacrifice employment income.
 */
export function calculateEmployeeNIC(
  parent: ParentIncome,
  config: TaxYearConfig
): { employmentIncomeForNIC: number; employeeNIC: number } {
  const sacrifice = calculateSalarySacrifice(parent, config);
  const startYear = taxYearStartYear(config.taxYear);
  const bik = calculateBiK(parent);

  // RSU gross values for NIC (not net of employer NIC transfer — see rules.md §6.4)
  const rsuGrossForNIC = parent.rsuVests
    .filter((v) => isVestInTaxYear(v.vestDate, startYear))
    .reduce((sum, v) => sum + v.grossValue, 0);

  // Employment income for NIC purposes:
  // Post-sacrifice salary + BiK + bonuses + cash allowances + RSU GROSS values
  // (not reduced by transferred employer NIC for NIC purposes)
  // Non-employment income (rental, savings, dividends) is NOT subject to NIC.
  const employmentIncomeForNIC =
    sacrifice.postSacrificeSalary +
    sacrifice.evBiKIncome +
    bik.total +
    parent.bonus.expectedThisYear +
    rsuGrossForNIC +
    parent.cashAllowances;

  let employeeNIC = 0;
  for (const band of config.employeeNICBands) {
    if (employmentIncomeForNIC > band.from) {
      const taxableInBand = Math.min(employmentIncomeForNIC, band.to) - band.from;
      employeeNIC += taxableInBand * band.rate;
    }
  }

  return { employmentIncomeForNIC, employeeNIC };
}

// ---------------------------------------------------------------------------
// Income tax calculation
// ---------------------------------------------------------------------------

/**
 * calculateIncomeTax
 *
 * Calculates income tax on the full ANI less the personal allowance.
 * Applies England/Wales/NI rates unless scotlandResident is true.
 *
 * Note: The personal allowance interacts with the taper; taxable income
 * is ANI minus the effective personal allowance.
 */
export function calculateIncomeTax(
  ani: number,
  effectivePA: number,
  parent: ParentIncome,
  config: TaxYearConfig
): { taxableIncome: number; totalIncomeTax: number; bands: Array<{ bandName: string; taxableIncome: number; rate: number; taxCharged: number }> } {
  const taxableIncome = Math.max(ani - effectivePA, 0);

  const bands = parent.scotlandResident
    ? config.scottishIncomeTaxBands.map((b) => ({ bandName: b.name, from: b.from, to: b.to, rate: b.rate }))
    : config.incomeTaxBands.map((b, i) => ({
        bandName: i === 0 ? "basic" : i === 1 ? "higher" : "additional",
        from: b.from,
        to: b.to,
        rate: b.rate,
      }));

  const taxedBands: Array<{ bandName: string; taxableIncome: number; rate: number; taxCharged: number }> = [];
  let remaining = taxableIncome;
  let totalIncomeTax = 0;

  for (const band of bands) {
    if (remaining <= 0) break;
    const bandWidth = band.to === Infinity ? remaining : Math.min(band.to - band.from, remaining);
    const inBand = Math.min(remaining, bandWidth);
    const charged = inBand * band.rate;
    taxedBands.push({ bandName: band.bandName, taxableIncome: inBand, rate: band.rate, taxCharged: charged });
    totalIncomeTax += charged;
    remaining -= inBand;
  }

  return { taxableIncome, totalIncomeTax, bands: taxedBands };
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

  const { totalContributionsMinus1Year, totalContributionsMinus2Years, totalContributionsMinus3Years } =
    parent.priorYearPensionAllowances;

  // For simplicity, we apply the current Annual Allowance to all prior years.
  // In a production version this would use historical AA values.
  const aa = config.pension.annualAllowance;
  const carry1 = Math.max(aa - totalContributionsMinus1Year, 0);
  const carry2 = Math.max(aa - totalContributionsMinus2Years, 0);
  const carry3 = Math.max(aa - totalContributionsMinus3Years, 0);

  return carry1 + carry2 + carry3;
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
