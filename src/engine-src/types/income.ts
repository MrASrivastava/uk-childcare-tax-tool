/**
 * income.ts
 *
 * All input types for the UK childcare tax tool.
 * Derived from rules.md Part 8 (Data Inputs Required).
 *
 * Every field has a JSDoc comment explaining its meaning and pointing back
 * to the relevant section of rules.md. This is the source of truth for
 * what data the UI must collect.
 */

import type { MinimumIncomeAgeBand, TaxYear } from "./constants";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * UK jurisdiction. Free-hours rules differ significantly between nations.
 * Income tax also differs in Scotland.
 */
export type Jurisdiction = "england" | "scotland" | "wales" | "northern_ireland";

/**
 * Pension contribution arrangement type.
 * Determines which ANI step the deduction applies at.
 * See rules.md §1.2, Step 3.
 */
export type PensionArrangementType =
  | "salary_sacrifice"         // Step 1 — reduces gross salary before assessment. Also saves NIC.
  | "net_pay"                  // Step 1 — deducted by employer before PAYE, reducing gross income
  | "relief_at_source"         // Step 3 — member pays net; provider grosses up. No NIC saving.
  | "retirement_annuity";      // Step 1 — paid gross; rare pre-1988 arrangement

// ---------------------------------------------------------------------------
// Sub-types — Salary Sacrifice
// ---------------------------------------------------------------------------

export interface EVSalarySacrifice {
  /**
   * Annual gross lease cost deducted from salary via sacrifice.
   * This is the amount that reduces gross income (Step 1 of ANI).
   */
  annualLeaseCost: number;

  /**
   * The vehicle's P11D value (HMRC list price including factory options, VAT-inclusive).
   * Used to calculate the BiK income added back to employment income.
   * The P11D value is fixed at the start of the arrangement; it does not change with depreciation.
   */
  vehicleP11DValue: number;

  /**
   * Override the default BiK rate for this vehicle if it differs from the standard EV rate.
   * If undefined, the tool uses the standard EV BiK rate from TaxYearConfig.
   * Non-EV company car BiK rates range 17–37% — set explicitly for non-EV vehicles.
   */
  biKRateOverride?: number;
}

export interface SalarySacrificeInputs {
  /** Annual pension contribution via salary sacrifice. Reduces gross salary → reduces ANI at Step 1. Also saves employee and employer NIC. */
  pension: number;

  /** EV salary sacrifice details. Set to null if no EV scheme. */
  ev: EVSalarySacrifice | null;

  /**
   * Annual cycle-to-work sacrifice amount.
   * No official limit since 2019 but most schemes cap at £1,000–£5,000.
   * Reduces gross salary → reduces ANI. No BiK charge if used for qualifying journeys.
   */
  cycleToWork: number;

  /**
   * Any other salary sacrifice amounts (e.g. additional holiday purchase, gym).
   * Amounts that reduce gross salary pre-tax and have no BiK charge.
   */
  other: number;
}

// ---------------------------------------------------------------------------
// Sub-types — Bonuses
// ---------------------------------------------------------------------------

export interface BonusInputs {
  /**
   * Expected gross bonus to be received in this tax year.
   * Included in ANI in the year of payment, not the year it was earned.
   */
  expectedThisYear: number;

  /**
   * Whether the bonus is discretionary (as opposed to contractual).
   * Only discretionary bonuses can be deferred. Deferral must be requested
   * before the bonus becomes contractually due.
   * See rules.md §4.6.
   */
  isDiscretionary: boolean;

  /**
   * Expected gross bonus in the next tax year (for forward planning / deferral modelling).
   * Optional — used only when the tool models deferral scenarios.
   */
  expectedNextYear?: number;
}

// ---------------------------------------------------------------------------
// Sub-types — RSU vesting
// ---------------------------------------------------------------------------

export interface RSUVest {
  /**
   * ISO date string (YYYY-MM-DD) of the vest date.
   * The taxable event occurs on this date; the market value on this date
   * is the amount added to employment income (and ANI) in the tax year
   * in which the date falls.
   */
  vestDate: string;

  /**
   * Gross market value of the shares at the vest date.
   * This is before any sell-to-cover deduction for tax or NIC.
   */
  grossValue: number;

  /**
   * Whether the employer has contractually transferred their Class 1 NIC
   * liability to the employee on this vest.
   *
   * If TRUE:
   *   - employerNIC = grossValue × employerNICRate (15% in 2025/26)
   *   - Income tax base = grossValue − employerNIC
   *   - Employee NIC base = grossValue (NOT reduced)
   *   - ANI addition = grossValue − employerNIC
   *
   * If FALSE:
   *   - All of grossValue is employment income for all purposes
   *   - ANI addition = grossValue
   *
   * See rules.md §6.4.
   */
  employerNICTransferred: boolean;
}

// ---------------------------------------------------------------------------
// Sub-types — Benefits in Kind (P11D)
// ---------------------------------------------------------------------------

export interface BenefitsInKindInputs {
  /**
   * P11D value of any company car (£). Set to 0 if no company car.
   * Used in conjunction with companyCarBiKRate to calculate BiK income.
   * Do NOT include EV salary sacrifice car here — that is in SalarySacrificeInputs.
   * This section covers company-provided cars (not sacrifice arrangements).
   */
  companyCarP11DValue: number;

  /**
   * BiK rate for the company car as a decimal (e.g. 0.03 for EV, 0.25 for a typical petrol).
   * For EVs: use TaxYearConfig.evBiKRate (3% in 2025/26).
   * For petrol/diesel: see HMRC published BiK tables (17–37%).
   * Diesel non-RDE2: add 4% surcharge (cap at 37%).
   */
  companyCarBiKRate: number;

  /**
   * Annual cost of the employer's private medical insurance premium for this employee.
   * Added to employment income in full.
   */
  privateMedicalInsurancePremium: number;

  /**
   * All other P11D benefits (gym membership, loans, etc.) at their cash equivalent value.
   */
  otherBiKCashEquivalent: number;
}

// ---------------------------------------------------------------------------
// Sub-types — Pension contributions outside salary sacrifice
// ---------------------------------------------------------------------------

export interface PersonalPensionContributions {
  /**
   * Net amount paid by the individual into a personal pension / SIPP
   * under a relief-at-source arrangement.
   * The provider claims basic-rate (20%) relief and adds it to the pot.
   * The ANI deduction is the GROSS amount: net ÷ 0.8
   * See rules.md §4.2.
   */
  reliefAtSourceNet: number;

  /**
   * Gross employee contributions to a net pay arrangement workplace pension
   * (e.g. the NHS scheme and many DB schemes), separate from salary sacrifice.
   * The employer deducts these before PAYE, so the engine subtracts them from
   * employment income in Step 1. They do not reduce NIC.
   * grossSalary should still be the contractual salary before this deduction.
   */
  netPayArrangementGross: number;
}

// ---------------------------------------------------------------------------
// Sub-types — Prior year pension allowances (for carry-forward)
// ---------------------------------------------------------------------------

export interface PriorYearPensionAllowances {
  /**
   * Total pension contributions made in each of the three prior tax years.
   * Used to calculate carry-forward unused Annual Allowance.
   * Leave as 0 if unknown — the tool will flag that carry-forward is unavailable to calculate.
   */
  totalContributionsMinus1Year: number;
  totalContributionsMinus2Years: number;
  totalContributionsMinus3Years: number;

  /**
   * Whether the individual was a member of a registered pension scheme in each
   * prior year. Carry-forward is only available from years of membership.
   * Default true.
   */
  schemeMemberMinus1Year?: boolean;
  schemeMemberMinus2Years?: boolean;
  schemeMemberMinus3Years?: boolean;
}

// ---------------------------------------------------------------------------
// Main parent income interface
// ---------------------------------------------------------------------------

/**
 * ParentIncome
 *
 * All income, deduction, and configuration inputs for a single parent/individual.
 * Corresponds to rules.md §8.1.
 *
 * All monetary values are annual (£/year) unless explicitly noted.
 * All values should be gross (before tax) unless explicitly noted as net.
 */
export interface ParentIncome {
  /** Human-readable label for display purposes (e.g. "Parent A", "Partner") */
  label: string;

  // ---- Employment income ------------------------------------------------

  /**
   * Annual gross salary before any salary sacrifice deductions.
   * This is the figure on the employment contract.
   * Salary sacrifice amounts are entered separately and subtracted by the engine.
   */
  grossSalary: number;

  /** Salary sacrifice arrangements. */
  salarySacrifice: SalarySacrificeInputs;

  /** Bonus inputs. */
  bonus: BonusInputs;

  /**
   * All RSU vesting events in the current tax year.
   * The engine will sum vest values that fall within the tax year being calculated.
   */
  rsuVests: RSUVest[];

  /** Benefits in kind (company car, PMI, etc.) reported on P11D. */
  benefitsInKind: BenefitsInKindInputs;

  /**
   * Cash allowances paid as taxable income (car allowance, phone allowance, etc.).
   * These are NOT salary sacrifice — they are added to gross pay and are fully
   * taxable for both income tax and NIC.
   */
  cashAllowances: number;

  // ---- Non-employment income --------------------------------------------

  /** Net self-employment / trading profit after allowable business expenses. */
  selfEmploymentProfit: number;

  /**
   * Rental profit: gross rent minus allowable expenses, BEFORE mortgage interest
   * and other finance costs. Since April 2020 none of the finance cost on
   * residential property is deductible from rental income, so it does not
   * reduce ANI. Enter finance costs separately in rentalFinanceCosts.
   */
  rentalIncomeNet: number;

  /**
   * Residential mortgage interest and other finance costs on let property.
   * Not deducted from income or ANI; gives a 20% tax reduction instead.
   */
  rentalFinanceCosts?: number;

  /**
   * Non-ISA savings interest (gross amount).
   * The Personal Savings Allowance (£500 at higher rate; £0 at additional rate)
   * reduces tax owed but does NOT reduce ANI. The full gross amount is included.
   */
  savingsInterestNonISA: number;

  /**
   * Non-ISA dividend income (gross amount).
   * The £500 Dividend Allowance reduces tax owed but does NOT reduce ANI.
   */
  dividendsNonISA: number;

  /**
   * Gross pension income including: private pension drawdown, annuity income,
   * defined benefit pension, and State Pension.
   */
  pensionIncomeGross: number;

  /**
   * Any other taxable income not captured above
   * (trust income, foreign income, taxable state benefits, etc.).
   */
  otherTaxableIncome: number;

  // ---- ANI Deductions ---------------------------------------------------

  /** Personal pension contributions outside salary sacrifice. */
  personalPensionContributions: PersonalPensionContributions;

  /**
   * Net charitable donations made under Gift Aid during the tax year.
   * ANI deduction = net amount ÷ 0.8 (grossed up at basic rate).
   */
  giftAidDonationsNet: number;

  // ---- Pension status ---------------------------------------------------

  /**
   * TRUE if the individual has ever flexibly accessed a money purchase pension
   * (e.g. taken an UFPLS, or entered flexi-access drawdown).
   * If true, the Money Purchase Annual Allowance (£10,000) applies to DC contributions.
   * Carry-forward cannot be used to exceed MPAA for money purchase contributions.
   * See rules.md §6.6.
   */
  mpaaTriggered: boolean;

  /**
   * Prior year pension contribution history — used to calculate carry-forward.
   * If not provided, the tool will note carry-forward capacity is unknown.
   */
  priorYearPensionAllowances: PriorYearPensionAllowances | null;

  // ---- Location & personal flags ----------------------------------------

  /**
   * TRUE if the individual's main residence is in Scotland.
   * Scottish income tax rates apply. Childcare scheme thresholds are UK-wide
   * but free hours structures differ.
   */
  scotlandResident: boolean;

  /**
   * TRUE if this parent is currently on statutory leave (maternity, paternity,
   * adoption, shared parental leave). Exempts them from the minimum income
   * requirement for free hours and TFC eligibility.
   */
  onStatutoryLeave: boolean;

  /**
   * TRUE if this parent is unable to work due to disability or is a registered carer.
   * Exempts them from the minimum income requirement.
   */
  exemptFromMinimumIncome: boolean;

  /**
   * Expected earnings from work (employment and self-employment) over the next
   * 3 months, for the childcare minimum income test. If omitted, the engine
   * uses a quarter of annual cash earnings (salary after sacrifice, bonus,
   * cash allowances and self-employment profit). Rental, savings and
   * dividend income do not count.
   */
  expectedEarningsNext3Months?: number;

  /** Age band for the minimum income test. Defaults to 21 and over. */
  ageBand?: MinimumIncomeAgeBand;

  /**
   * TRUE if self-employed. A self-employed parent who won't earn enough in the
   * next 3 months can average expected earnings over the tax year instead.
   */
  selfEmployed?: boolean;

  /**
   * Contracted hours per week. Used to check that salary sacrifice does not
   * take pay below the National Minimum Wage. Defaults to 37.5.
   */
  contractedHoursPerWeek?: number;
}

// ---------------------------------------------------------------------------
// Child information
// ---------------------------------------------------------------------------

export interface ChildInfo {
  /**
   * ISO date string (YYYY-MM-DD) of the child's date of birth.
   * Used to calculate age at each term start, determining which free-hours
   * entitlement applies and when.
   */
  dateOfBirth: string;

  /**
   * TRUE if the child is disabled (for TFC higher top-up limit and extended age limit).
   * Disabled = entitled to Disability Living Allowance or Personal Independence Payment.
   */
  isDisabled: boolean;

  /**
   * Optional annual childcare cost for this child BEFORE funded hours
   * (what the provider would charge with no government funding).
   * If omitted, HouseholdInputs.estimatedAnnualChildcareSpend is split
   * evenly across children of Tax-Free Childcare age.
   */
  annualChildcareCost?: number;
}

// ---------------------------------------------------------------------------
// Local authority hourly funding rates
// ---------------------------------------------------------------------------

export interface LocalHourlyRates {
  /** Hourly rate for under-2s */
  under2: number;
  /** Hourly rate for 2-year-olds */
  age2: number;
  /** Hourly rate for 3–4-year-olds */
  age3to4: number;
}

// ---------------------------------------------------------------------------
// Household (top-level input)
// ---------------------------------------------------------------------------

/**
 * HouseholdInputs
 *
 * The complete input for a single household calculation.
 * Corresponds to rules.md §8.2.
 */
export interface HouseholdInputs {
  /** Tax year being modelled. */
  taxYear: TaxYear;

  /** Primary earner / only parent. Always required. */
  parentA: ParentIncome;

  /**
   * Second parent / partner. Set to null for single-parent households.
   * If present, both parents' ANI is checked against all eligibility thresholds.
   */
  parentB: ParentIncome | null;

  /** All children in the household. */
  children: ChildInfo[];

  /**
   * Whether Child Benefit has been claimed (registered with HMRC).
   * Even if opting out of payments, registration preserves NI credits.
   */
  childBenefitRegistered: boolean;

  /**
   * Whether the family is actually receiving Child Benefit payments.
   * FALSE means: registered but elected not to receive payments.
   * When FALSE: no HICBC liability arises; NI credits are still preserved.
   * See rules.md §2.4.2.
   */
  childBenefitPaymentsElected: boolean;

  /** England / Scotland / Wales / Northern Ireland */
  jurisdiction: Jurisdiction;

  /**
   * The family's nursery / provider hourly rate for each age band. A funded
   * hour saves the family what the provider would otherwise charge, so this
   * is what free hours are valued at. If not provided, the tool falls back to
   * DEFAULT_LOCAL_HOURLY_RATES (national average funding rates), which usually
   * understates the value.
   */
  providerHourlyRates?: LocalHourlyRates;

  /** @deprecated Use providerHourlyRates. Still honoured if providerHourlyRates is absent. */
  localHourlyRates?: LocalHourlyRates;

  /**
   * Total annual nursery / childcare fees BEFORE funded hours, across all
   * children without their own annualChildcareCost. The engine subtracts the
   * value of funded hours to get the bill the parents pay, and TFC adds 20%
   * of that bill (capped per child).
   */
  estimatedAnnualChildcareSpend: number;

  /**
   * Optional ISO date (YYYY-MM-DD) to evaluate child ages and eligibility at.
   * Defaults to today. Used by tests for deterministic results.
   */
  asOfDate?: string;
}

// ---------------------------------------------------------------------------
// Helper: create a zeroed-out ParentIncome (useful for UI defaults)
// ---------------------------------------------------------------------------

export function createEmptyParentIncome(label: string): ParentIncome {
  return {
    label,
    grossSalary: 0,
    salarySacrifice: {
      pension: 0,
      ev: null,
      cycleToWork: 0,
      other: 0,
    },
    bonus: {
      expectedThisYear: 0,
      isDiscretionary: true,
    },
    rsuVests: [],
    benefitsInKind: {
      companyCarP11DValue: 0,
      companyCarBiKRate: 0,
      privateMedicalInsurancePremium: 0,
      otherBiKCashEquivalent: 0,
    },
    cashAllowances: 0,
    selfEmploymentProfit: 0,
    rentalIncomeNet: 0,
    rentalFinanceCosts: 0,
    savingsInterestNonISA: 0,
    dividendsNonISA: 0,
    pensionIncomeGross: 0,
    otherTaxableIncome: 0,
    personalPensionContributions: {
      reliefAtSourceNet: 0,
      netPayArrangementGross: 0,
    },
    giftAidDonationsNet: 0,
    mpaaTriggered: false,
    priorYearPensionAllowances: null,
    scotlandResident: false,
    onStatutoryLeave: false,
    exemptFromMinimumIncome: false,
  };
}
