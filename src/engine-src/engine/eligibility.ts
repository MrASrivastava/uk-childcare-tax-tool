/**
 * eligibility.ts
 *
 * Determines eligibility for each childcare support scheme.
 * Implements rules.md Part 2 in full.
 *
 * All functions are pure: given ANI(s) and household data, return typed results.
 * No side effects. No mutation of inputs.
 *
 * Phase 3 — complete implementation including:
 *   - Term-date calculations for all age milestones (rules.md §2.2.1)
 *   - Free hours entitlement by age group (rules.md §2.2.2)
 *   - Grace period detection (rules.md §6.3)
 *   - TFC eligibility with child age boundaries and incompatibility flags (rules.md §2.3)
 *   - HICBC calculation with full taper, recommendation, and NI credit guidance (rules.md §2.4)
 *   - Correct treatment when one parent is over £100k for the universal 15hr entitlement
 */

import type { ChildInfo, ParentIncome } from "../types/income";
import type {
  EligibilityFlag,
  EligibilityStatus,
  FreeHoursAgeGroup,
  FreeHoursChildResult,
  HICBCResult,
  TFCResult,
} from "../types/output";
import type { TaxYearConfig } from "../types/constants";
import { minimumIncomeQuarterly } from "../types/constants";

// ---------------------------------------------------------------------------
// Utility: threshold proximity status and flag builder
// ---------------------------------------------------------------------------

/**
 * Distance from the nearest eligibility-ending threshold that triggers "at_risk".
 * Exported so tests can assert against the same constant.
 */
export const AT_RISK_BUFFER = 5_000;

/**
 * Returns "not_eligible" | "at_risk" | "eligible" based on ANI vs an upper threshold.
 * Does NOT handle the lower minimum-income test — that is a separate check.
 */
export function thresholdStatus(ani: number, threshold: number): EligibilityStatus {
  if (ani > threshold) return "not_eligible";
  if (threshold - ani <= AT_RISK_BUFFER) return "at_risk";
  return "eligible";
}

export function mkFlag(
  status: EligibilityStatus,
  reason: string,
  gap: number
): EligibilityFlag {
  return { status, reason, thresholdGapGBP: gap };
}

// ---------------------------------------------------------------------------
// Child age and term calculations
// ---------------------------------------------------------------------------

/**
 * Returns the three UK academic term start dates for a given calendar year.
 * Terms begin: 1 January, 1 April, 1 September.
 */
function termStartDatesForYear(year: number): Date[] {
  // Use Date.UTC to avoid local-timezone offset shifting the date when
  // serialised with .toISOString(). ISO date strings (e.g. "2025-09-01")
  // parse as UTC; all internal Date values must also be UTC.
  return [
    new Date(Date.UTC(year, 0, 1)),
    new Date(Date.UTC(year, 3, 1)),
    new Date(Date.UTC(year, 8, 1)),
  ];
}

/**
 * termAfterAge
 *
 * Returns the first UK academic term start date that falls STRICTLY AFTER
 * the date when a child reaches a given age (in whole months).
 *
 * Implements rules.md §2.2.1:
 *   "Eligibility begins the TERM AFTER the child reaches the relevant age."
 *
 * Examples:
 *   Born 15 Jun 2024 + 9m = 15 Mar 2025 → term after = 1 Apr 2025
 *   Born 01 Sep 2024 + 9m = 01 Jun 2025 → term after = 1 Sep 2025
 *   Born 01 Apr 2025 + 9m = 01 Jan 2026 → term after = 1 Apr 2026 (not 1 Jan itself)
 */
export function termAfterAge(dateOfBirth: string, targetAgeMonths: number): Date {
  // Parse as UTC to match how ISO strings are created by termStartDatesForYear.
  const dob = new Date(dateOfBirth + "T00:00:00Z");

  // Compute exact date the child reaches the target age (UTC arithmetic)
  const milestone = new Date(dob);
  milestone.setUTCMonth(milestone.getUTCMonth() + targetAgeMonths);

  const milestoneYear = milestone.getFullYear();

  // Candidate term starts spanning one year either side of the milestone
  const candidates: Date[] = [
    ...termStartDatesForYear(milestoneYear - 1),
    ...termStartDatesForYear(milestoneYear),
    ...termStartDatesForYear(milestoneYear + 1),
  ];

  // First term start STRICTLY AFTER the milestone
  const result = candidates.find((d) => d > milestone);
  if (!result) {
    throw new Error(
      `termAfterAge: cannot find term start after DOB=${dateOfBirth} + ${targetAgeMonths}m`
    );
  }
  return result;
}

/**
 * compulsorySchoolAgeDate
 *
 * Returns the term that begins on or after the child's 5th birthday.
 * Free funded hours entitlement ends at the start of this term.
 *
 * rules.md §2.2.1.
 */
export function compulsorySchoolAgeDate(dateOfBirth: string): Date {
  return termAfterAge(dateOfBirth, 60); // 60 months = 5 years
}

/**
 * ChildAgeGroupResult — the full output of getChildAgeGroup.
 */
export interface ChildAgeGroupResult {
  ageGroup: FreeHoursAgeGroup;
  /** ISO date string of the term when entitlement first starts (null if already eligible or school age). */
  eligibilityStartDate: string | null;
  /**
   * TRUE if the child is within ~12 weeks of a term boundary (age transition or school start).
   * Signals the grace period risk described in rules.md §6.3.
   */
  inGracePeriodZone: boolean;
}

/**
 * getChildAgeGroup
 *
 * Classifies a child's free-hours age group at a given reference date.
 * The group determines which funded-hours bands apply.
 *
 * rules.md §2.2.2.
 */
export function getChildAgeGroup(
  child: ChildInfo,
  referenceDate: Date
): ChildAgeGroupResult {
  const term9m  = termAfterAge(child.dateOfBirth, 9);
  const term2yr = termAfterAge(child.dateOfBirth, 24);
  const term3yr = termAfterAge(child.dateOfBirth, 36);
  const schoolAge = compulsorySchoolAgeDate(child.dateOfBirth);

  // Grace period zone: within approximately one term (84 days) of any boundary
  const GRACE_ZONE_MS = 84 * 24 * 60 * 60 * 1000;
  const inGracePeriodZone =
    Math.abs(referenceDate.getTime() - schoolAge.getTime()) < GRACE_ZONE_MS ||
    Math.abs(referenceDate.getTime() - term3yr.getTime()) < GRACE_ZONE_MS ||
    Math.abs(referenceDate.getTime() - term2yr.getTime()) < GRACE_ZONE_MS;

  if (referenceDate >= schoolAge) {
    return { ageGroup: "school_age_or_over", eligibilityStartDate: null, inGracePeriodZone: false };
  }

  if (referenceDate < term9m) {
    return {
      ageGroup: "under_9_months",
      eligibilityStartDate: term9m.toISOString().slice(0, 10),
      inGracePeriodZone: false,
    };
  }

  if (referenceDate < term2yr) {
    return {
      ageGroup: "9m_to_2yr",
      eligibilityStartDate: term9m.toISOString().slice(0, 10),
      inGracePeriodZone,
    };
  }

  if (referenceDate < term3yr) {
    return {
      ageGroup: "age_2yr",
      eligibilityStartDate: term2yr.toISOString().slice(0, 10),
      inGracePeriodZone,
    };
  }

  return {
    ageGroup: "age_3_to_4yr",
    eligibilityStartDate: term3yr.toISOString().slice(0, 10),
    inGracePeriodZone,
  };
}

// ---------------------------------------------------------------------------
// Working parent eligibility flag (per parent)
// ---------------------------------------------------------------------------

/**
 * Result of the minimum income test for one parent (rules.md §2.2.1).
 * The test is on expected earnings over the next 3 months, not ANI.
 */
export interface MinimumIncomeTest {
  meets: boolean;
  /** Expected earnings from work over the next 3 months (£) */
  expectedQuarterlyEarnings: number;
  /** Threshold for the parent's age band (£ per 3 months) */
  quarterlyThreshold: number;
  /** Exempt: statutory leave, disability or carer */
  exempt: boolean;
}

/**
 * minimumIncomeTest
 *
 * Expected earnings over the next 3 months must be at least 16 hours/week at
 * the minimum wage for the parent's age × 13 weeks. Only earned income counts
 * (not rent, savings or dividends), and pension contributions do not reduce
 * it. The self-employed can average over the tax year instead.
 */
export function minimumIncomeTest(parent: ParentIncome, config: TaxYearConfig): MinimumIncomeTest {
  const sacrifice =
    parent.salarySacrifice.pension +
    (parent.salarySacrifice.ev?.annualLeaseCost ?? 0) +
    parent.salarySacrifice.cycleToWork +
    parent.salarySacrifice.other;
  const annualEarnings =
    parent.grossSalary - sacrifice + parent.bonus.expectedThisYear +
    parent.cashAllowances + parent.selfEmploymentProfit;
  const averaged = Math.max(annualEarnings, 0) / 4;
  let expected = parent.expectedEarningsNext3Months ?? averaged;
  if (parent.selfEmployed) expected = Math.max(expected, averaged);

  const quarterlyThreshold = minimumIncomeQuarterly(config, parent.ageBand ?? "21_plus");
  const exempt = parent.exemptFromMinimumIncome || parent.onStatutoryLeave;
  return {
    meets: exempt || expected >= quarterlyThreshold,
    expectedQuarterlyEarnings: expected,
    quarterlyThreshold,
    exempt,
  };
}

const gbp = (n: number) => `£${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * parentWorkingEligibilityFlag
 *
 * Checks whether a single parent meets the working-parent income requirements:
 *   (a) expected earnings over the next 3 months >= minimum income threshold
 *       (or exempt via statutory leave/disability/carer)
 *   (b) ANI <= £100,000 — hard cliff, no taper
 *
 * rules.md §2.2.1.
 */
export function parentWorkingEligibilityFlag(
  ani: number,
  minIncome: MinimumIncomeTest,
  config: TaxYearConfig
): EligibilityFlag {
  const max = config.freeHours.maximumANIThreshold;

  if (!minIncome.meets) {
    return mkFlag(
      "not_eligible",
      `Expected earnings over the next 3 months (${gbp(Math.round(minIncome.expectedQuarterlyEarnings))}) are below ` +
      `the minimum of ${gbp(minIncome.quarterlyThreshold)} (16 hours/week at the minimum wage for your age). ` +
      `Parents on statutory leave, with qualifying disabilities, or acting as registered carers are exempt.`,
      minIncome.quarterlyThreshold - minIncome.expectedQuarterlyEarnings
    );
  }

  if (ani > max) {
    return mkFlag(
      "not_eligible",
      `Adjusted Net Income (£${Math.round(ani).toLocaleString()}) exceeds £${max.toLocaleString()}. ` +
      `This is a hard cliff edge — £1 over the limit immediately removes all working-parent entitlement.`,
      max - ani  // negative value = "over by this amount"
    );
  }

  const gap = max - ani;
  const status: EligibilityStatus = gap <= AT_RISK_BUFFER ? "at_risk" : "eligible";

  return mkFlag(
    status,
    status === "at_risk"
      ? `Eligible, but only £${Math.round(gap).toLocaleString()} below the £${max.toLocaleString()} limit. ` +
        `A bonus, RSU vest, savings interest, or P11D benefit could push income over the threshold.`
      : `Eligible. Adjusted Net Income (£${Math.round(ani).toLocaleString()}) is ` +
        `£${Math.round(gap).toLocaleString()} below the £${max.toLocaleString()} limit.`,
    gap
  );
}

// ---------------------------------------------------------------------------
// Scheme A: Free Funded Childcare Hours
// ---------------------------------------------------------------------------

/**
 * computeFreeHoursForChild
 *
 * Determines the free-hours entitlement for a single child, given working
 * eligibility of both parents and the child's age group at the reference date.
 *
 * KEY RULES (rules.md §2.2):
 * 1. Working parent entitlement (30 hrs/wk):
 *    Couple: BOTH parents must individually qualify (min AND max ANI).
 *    Single parent: only parentA must qualify.
 *
 * 2. Universal 15 hours (3–4 year olds only):
 *    Available to ALL 3–4 year olds regardless of income — cannot be lost.
 *    A household where one parent exceeds £100k still keeps the universal 15 hours.
 *    Only the additional 15 working-parent hours are lost.
 *
 * 3. Children under 3 (9m–2yr): NO universal entitlement.
 *    If working parent conditions not met → 0 funded hours.
 */
export function computeFreeHoursForChild(
  child: ChildInfo,
  childIndex: number,
  parentAWorkingEligible: boolean,
  parentBWorkingEligible: boolean | null,
  config: TaxYearConfig,
  localRates: { under2: number; age2: number; age3to4: number },
  referenceDate: Date
): FreeHoursChildResult {
  const { ageGroup, eligibilityStartDate, inGracePeriodZone } =
    getChildAgeGroup(child, referenceDate);

  const workingHrs = config.freeHours.workingParentHoursPerWeek; // 30
  const universalHrs = config.freeHours.universalHoursPerWeek;   // 15
  const termWeeks = config.freeHours.minTermWeeksPerYear;         // 38

  // Household-level working parent eligibility
  const householdWorkingEligible =
    parentBWorkingEligible === null
      ? parentAWorkingEligible
      : parentAWorkingEligible && parentBWorkingEligible;

  let workingParentHoursPerWeek = 0;
  let universalHoursPerWeek = 0;
  let workingEligibilityFlag: EligibilityFlag;
  let universalEligibilityFlag: EligibilityFlag;
  let hourlyRate = 0;

  switch (ageGroup) {
    case "under_9_months":
      hourlyRate = 0;
      workingEligibilityFlag = mkFlag(
        "not_eligible",
        `Not yet eligible. Working parent entitlement begins ${eligibilityStartDate}.`,
        0
      );
      universalEligibilityFlag = mkFlag(
        "not_eligible",
        "No funded hours for children under 9 months.",
        0
      );
      break;

    case "9m_to_2yr":
      hourlyRate = localRates.under2;
      universalEligibilityFlag = mkFlag(
        "not_eligible",
        "No universal entitlement for children aged 9 months to 2 years. " +
        "Only the 30-hour working parent scheme applies.",
        0
      );
      if (householdWorkingEligible) {
        workingParentHoursPerWeek = workingHrs;
        workingEligibilityFlag = mkFlag(
          "eligible",
          `${workingHrs} hours/week working parent entitlement.` +
          (inGracePeriodZone ? " Approaching a term boundary — reconfirm eligibility." : ""),
          0
        );
      } else {
        workingEligibilityFlag = mkFlag(
          "not_eligible",
          "Working parent conditions not met. Both parents must meet the minimum income test " +
          `and have ANI of no more than £${config.freeHours.maximumANIThreshold.toLocaleString()}. ` +
          "No funded hours for this child.",
          0
        );
      }
      break;

    case "age_2yr":
      hourlyRate = localRates.age2;
      universalEligibilityFlag = mkFlag(
        "not_eligible",
        "The 15-hour universal entitlement for 2-year-olds applies only to disadvantaged " +
        "families (those receiving qualifying benefits). Not modelled in this tool.",
        0
      );
      if (householdWorkingEligible) {
        workingParentHoursPerWeek = workingHrs;
        workingEligibilityFlag = mkFlag(
          "eligible",
          `${workingHrs} hours/week working parent entitlement.`,
          0
        );
      } else {
        workingEligibilityFlag = mkFlag(
          "not_eligible",
          "Working parent conditions not met. No funded hours for this 2-year-old.",
          0
        );
      }
      break;

    case "age_3_to_4yr":
      hourlyRate = localRates.age3to4;
      // Universal 15 hrs: always available regardless of income — cannot be lost
      universalHoursPerWeek = universalHrs;
      universalEligibilityFlag = mkFlag(
        "eligible",
        `${universalHrs} hours/week universal entitlement — available to all 3–4 year olds ` +
        "regardless of parental income.",
        0
      );

      if (householdWorkingEligible) {
        workingParentHoursPerWeek = workingHrs; // Full 30 hrs
        workingEligibilityFlag = mkFlag(
          "eligible",
          `${workingHrs} hours/week working parent entitlement ` +
          `(${universalHrs} universal + ${workingHrs - universalHrs} additional working-parent hours).` +
          (inGracePeriodZone
            ? " Approaching school age — check when entitlement ends."
            : ""),
          0
        );
      } else {
        // Not working-parent eligible: universal 15 hrs only
        // Set workingParentHoursPerWeek = universalHrs so the value calculation
        // correctly captures what the household will actually receive
        workingParentHoursPerWeek = universalHrs;
        workingEligibilityFlag = mkFlag(
          "not_eligible",
          `Working parent conditions not met. Only the ${universalHrs}-hour universal entitlement ` +
          `applies. The additional ${workingHrs - universalHrs} working-parent hours are not available.`,
          0
        );
      }
      break;

    case "school_age_or_over":
      hourlyRate = 0;
      workingEligibilityFlag = mkFlag(
        "not_eligible",
        "Child has reached compulsory school age. Free funded hours entitlement has ended.",
        0
      );
      universalEligibilityFlag = mkFlag(
        "not_eligible",
        "Child has reached compulsory school age.",
        0
      );
      break;
  }

  // ---- Monetary values -------------------------------------------------------

  const workingParentAnnualValue = workingParentHoursPerWeek * termWeeks * hourlyRate;
  const universalAnnualValue = universalHoursPerWeek * termWeeks * hourlyRate;

  // incrementalWorkingParentValue represents the value GAINED by having working
  // parent eligibility — equivalently, the value LOST when eligibility is removed.
  //
  // This is computed as the POTENTIAL increment, not the CURRENT received hours.
  // It is the same whether the family is currently eligible or not, so that:
  //   - The marginal rate chart correctly spikes at the £100k cliff
  //   - The optimiser correctly values the benefit of restoring eligibility
  //
  // rules.md §2.2.4 and §9.5.
  let incrementalWorkingParentHours: number;

  if (ageGroup === "age_3_to_4yr") {
    // Always 15 additional hours above the universal baseline.
    // The child gets 15 universal hours regardless of working parent eligibility.
    // The ADDITIONAL value from working parent status is the extra 15 hours.
    incrementalWorkingParentHours = workingHrs - universalHrs; // Always 15
  } else {
    // For 9m_to_2yr and age_2yr: no universal baseline, so all working hours are incremental.
    // Always 30 hours — this is the potential value regardless of current eligibility.
    incrementalWorkingParentHours = workingHrs;
  }

  const incrementalWorkingParentValue =
    ageGroup === "under_9_months" || ageGroup === "school_age_or_over"
      ? 0  // No incremental value for age groups outside the working parent scheme
      : incrementalWorkingParentHours * termWeeks * hourlyRate;

  return {
    childIndex,
    childDateOfBirth: child.dateOfBirth,
    ageGroup,
    eligibilityStartDate,
    workingParentHoursPerWeek,
    universalHoursPerWeek,
    workingParentEligibility: workingEligibilityFlag!,
    universalEligibility: universalEligibilityFlag!,
    incrementalWorkingParentHours,
    workingParentAnnualValue,
    universalAnnualValue,
    incrementalWorkingParentValue,
  };
}

// ---------------------------------------------------------------------------
// Scheme B: Tax-Free Childcare
// ---------------------------------------------------------------------------

/**
 * computeChildAgeYears
 *
 * Returns a child's age in decimal years at the reference date.
 * For display only; TFC eligibility uses tfcEligibleUntil.
 */
export function computeChildAgeYears(dob: string, referenceDate: Date): number {
  const dobDate = new Date(dob + "T00:00:00Z");
  return (
    (referenceDate.getUTCFullYear() - dobDate.getUTCFullYear()) * 12 +
    (referenceDate.getUTCMonth() - dobDate.getUTCMonth())
  ) / 12;
}

/**
 * tfcEligibleUntil
 *
 * A child stops being eligible for Tax-Free Childcare on the 1 September after
 * their 11th birthday (16th if disabled). Returns that 1 September (UTC).
 *
 * rules.md §2.3.2.
 */
export function tfcEligibleUntil(child: ChildInfo, config: TaxYearConfig): Date {
  const dob = new Date(child.dateOfBirth + "T00:00:00Z");
  const limit = child.isDisabled ? config.tfc.ageLimitBirthdayDisabled : config.tfc.ageLimitBirthday;
  const birthday = new Date(Date.UTC(dob.getUTCFullYear() + limit, dob.getUTCMonth(), dob.getUTCDate()));
  const sept = new Date(Date.UTC(birthday.getUTCFullYear(), 8, 1));
  return birthday < sept ? sept : new Date(Date.UTC(birthday.getUTCFullYear() + 1, 8, 1));
}

/** TFC eligibility of one child on a given date (from birth to tfcEligibleUntil). */
export function isTFCEligibleChild(child: ChildInfo, date: Date, config: TaxYearConfig): boolean {
  const dob = new Date(child.dateOfBirth + "T00:00:00Z");
  return date >= dob && date < tfcEligibleUntil(child, config);
}

/**
 * Start dates of the four 3-month TFC periods in a tax year
 * (6 Apr, 6 Jul, 6 Oct, 6 Jan). Parents reconfirm every 3 months, and the
 * cap applies per period, so the annual value is built up quarter by quarter.
 */
export function tfcQuarterStarts(config: TaxYearConfig): Date[] {
  const y = parseInt(config.taxYear.slice(0, 4), 10);
  return [
    new Date(Date.UTC(y, 3, 6)),
    new Date(Date.UTC(y, 6, 6)),
    new Date(Date.UTC(y, 9, 6)),
    new Date(Date.UTC(y + 1, 0, 6)),
  ];
}

/**
 * tfcTopUpValue
 *
 * Household TFC value ignoring parental eligibility. For each child:
 *   top-up per quarter = min(20% × bill for the quarter, cap ÷ 4)
 * summed over the quarters in which the child is eligible.
 *
 * `childBills` is what the parents pay each provider per year, per child,
 * AFTER funded hours. The government pays £2 for every £8 the parent pays in,
 * which is 20% of the provider's bill. The cap is per child account; it is
 * not pooled across children.
 *
 * rules.md §2.3.4.
 */
export function tfcTopUpValue(
  children: ChildInfo[],
  childBills: number[],
  config: TaxYearConfig
): { maxTopUp: number; estimatedTopUp: number } {
  const quarters = tfcQuarterStarts(config);
  let maxTopUp = 0;
  let estimatedTopUp = 0;
  children.forEach((child, i) => {
    const cap = child.isDisabled ? config.tfc.maxTopUpDisabledPerYear : config.tfc.maxTopUpPerChildPerYear;
    const bill = Math.max(childBills[i] ?? 0, 0);
    for (const q of quarters) {
      if (!isTFCEligibleChild(child, q, config)) continue;
      maxTopUp += cap / 4;
      estimatedTopUp += Math.min((bill / 4) * config.tfc.topUpRate, cap / 4);
    }
  });
  return { maxTopUp, estimatedTopUp };
}

/**
 * computeTFCEligibility
 *
 * Determines TFC eligibility and estimated benefit for the household.
 *
 * rules.md §2.3.
 *
 * KEY RULES:
 * 1. If EITHER parent ANI > £100,000 → household loses TFC entirely (hard cliff).
 * 2. BOTH parents must meet the minimum income test (unless exempt).
 * 3. TFC is incompatible with Universal Credit and legacy Tax Credits.
 * 4. Child is eligible until the 1 September after their 11th birthday (16th if disabled).
 * 5. Government pays £2 for every £8 the parent pays in = 20% of the childcare bill.
 * 6. Maximum top-up: £500 per child per 3-month period (£1,000 if disabled).
 */
export function computeTFCEligibility(
  parentAANI: number,
  parentBANI: number | null,
  parentAMinIncome: MinimumIncomeTest,
  parentBMinIncome: MinimumIncomeTest | null,
  children: ChildInfo[],
  childBills: number[],
  config: TaxYearConfig,
  referenceDate: Date
): TFCResult {
  const max = config.tfc.maximumANIThreshold;

  // ---- Check 1: Maximum income (hard cliff) --------------------------------
  const parentAOverMax = parentAANI > max;
  const parentBOverMax = parentBANI !== null && parentBANI > max;

  if (parentAOverMax || parentBOverMax) {
    const overParent = parentAOverMax ? "Parent A" : "Parent B";
    const overANI = parentAOverMax ? parentAANI : parentBANI!;
    return {
      eligible: mkFlag(
        "not_eligible",
        `${overParent}'s Adjusted Net Income (£${Math.round(overANI).toLocaleString()}) ` +
        `exceeds the £${max.toLocaleString()} limit by ` +
        `£${Math.round(overANI - max).toLocaleString()}. ` +
        `This is a hard cliff — the household loses Tax-Free Childcare entirely, with no taper.`,
        max - overANI   // negative: how far over
      ),
      eligibleChildCount: 0,
      maxPossibleTopUpAnnual: 0,
      estimatedActualTopUpAnnual: 0,
      atRisk: false,
    };
  }

  // ---- Check 2: Minimum income (expected earnings, next 3 months) ----------
  const failing = !parentAMinIncome.meets
    ? { label: "Parent A", test: parentAMinIncome }
    : parentBMinIncome && !parentBMinIncome.meets
    ? { label: "Parent B", test: parentBMinIncome }
    : null;

  if (failing) {
    return {
      eligible: mkFlag(
        "not_eligible",
        `${failing.label}'s expected earnings over the next 3 months ` +
        `(${gbp(Math.round(failing.test.expectedQuarterlyEarnings))}) are below the minimum of ` +
        `${gbp(failing.test.quarterlyThreshold)}. ` +
        `Parents on statutory leave, with qualifying disabilities, or acting as carers are exempt.`,
        failing.test.quarterlyThreshold - failing.test.expectedQuarterlyEarnings
      ),
      eligibleChildCount: 0,
      maxPossibleTopUpAnnual: 0,
      estimatedActualTopUpAnnual: 0,
      atRisk: false,
    };
  }

  // ---- Eligible children and value -------------------------------------------
  const eligibleChildCount = children.filter((c) => isTFCEligibleChild(c, referenceDate, config)).length;
  const { maxTopUp, estimatedTopUp } = tfcTopUpValue(children, childBills, config);

  // ---- At-risk proximity check ---------------------------------------------
  const gapA = max - parentAANI;
  const gapB = parentBANI !== null ? max - parentBANI : Infinity;
  const smallestGap = Math.min(gapA, gapB);
  const atRisk = smallestGap <= AT_RISK_BUFFER;
  const status: EligibilityStatus = atRisk ? "at_risk" : "eligible";

  return {
    eligible: mkFlag(
      status,
      status === "at_risk"
        ? `Eligible, but only £${Math.round(smallestGap).toLocaleString()} below the ` +
          `£${max.toLocaleString()} cliff edge. A bonus, RSU vest, or savings interest ` +
          `increase could remove eligibility entirely.`
        : `Eligible. Both parents meet income requirements.`,
      smallestGap
    ),
    eligibleChildCount,
    maxPossibleTopUpAnnual: maxTopUp,
    estimatedActualTopUpAnnual: estimatedTopUp,
    atRisk,
  };
}

// ---------------------------------------------------------------------------
// Scheme C: Child Benefit and HICBC
// ---------------------------------------------------------------------------

/**
 * grossAnnualChildBenefit
 *
 * Calculates gross annual Child Benefit for a given number of children.
 * Uses weekly rate × 52 (HMRC uses exact week counts; this is the standard approximation).
 *
 * rules.md §2.4.1.
 */
export function grossAnnualChildBenefit(
  childCount: number,
  config: TaxYearConfig
): number {
  if (childCount === 0) return 0;
  return (
    config.childBenefit.firstChildWeekly +
    Math.max(childCount - 1, 0) * config.childBenefit.additionalChildWeekly
  ) * 52;
}

/**
 * computeHICBCCharge
 *
 * Calculates the HICBC charge and clawback fraction for a given higher-earner ANI.
 *
 * Formula (rules.md §2.4.3, ITEPA 2003 s.681C):
 *   1% of Child Benefit for every complete £200 of ANI above £60,000
 *   retentionFraction = min(floor((ANI − 60,000) / 200), 100) / 100
 *   charge = grossChildBenefit × retentionFraction
 *
 * Taper: £60,000 = 0% clawback; £80,000+ = 100% clawback.
 * Above £80,000 the charge is capped at 100% of Child Benefit.
 */
export function computeHICBCCharge(
  higherEarnerANI: number,
  grossChildBenefit: number,
  config: TaxYearConfig
): { charge: number; retentionFraction: number } {
  const excess = Math.max(
    higherEarnerANI - config.hicbc.startThreshold,
    0
  );
  const stepSize = config.hicbc.taperDenominator / 100; // £200
  const retentionFraction = Math.min(Math.floor(excess / stepSize), 100) / 100;
  // Round to pence to avoid floating-point display artifacts
  const charge = Math.round(grossChildBenefit * retentionFraction * 100) / 100;
  return { charge, retentionFraction };
}

/**
 * computeHICBC
 *
 * Full HICBC result: gross Child Benefit, charge, net benefit, self-assessment
 * obligation, and strategic recommendation.
 *
 * rules.md §2.4.
 *
 * KEY STRATEGIC RULES:
 * - Always register for Child Benefit — even if opting out of cash payments.
 *   Registration preserves NI credits (→ State Pension) and child's NI number at 16.
 * - If higher earner ANI >= £80,000: opt out of payments (100% clawback; no benefit to receiving).
 * - If ANI is £60,000–£80,000: keep payments and pay the HICBC, either through
 *   the PAYE tax code (HMRC's online HICBC service) or through Self Assessment
 *   if the higher earner already files a return.
 * - The HIGHER earner pays the charge, regardless of who receives the payments.
 */
export function computeHICBC(
  children: ChildInfo[],
  parentAANI: number,
  parentBANI: number | null,
  childBenefitRegistered: boolean,
  childBenefitPaymentsElected: boolean,
  config: TaxYearConfig,
  higherEarnerFilesSelfAssessment: { parentA: boolean; parentB: boolean } = { parentA: false, parentB: false }
): HICBCResult {
  const childCount = children.length;
  const grossAnnual = grossAnnualChildBenefit(childCount, config);

  // Identify the higher earner
  const higherEarnerANI =
    parentBANI !== null ? Math.max(parentAANI, parentBANI) : parentAANI;
  const higherEarnerLabel =
    parentBANI !== null && parentBANI > parentAANI ? "Parent B" : "Parent A";

  // HICBC applies only when payments are received
  const { charge: hicbcCharge, retentionFraction } = childBenefitPaymentsElected
    ? computeHICBCCharge(higherEarnerANI, grossAnnual, config)
    : { charge: 0, retentionFraction: 0 };

  const netChildBenefitAnnual = childBenefitPaymentsElected
    ? Math.round((grossAnnual - hicbcCharge) * 100) / 100
    : 0;

  // HICBC is payable when payments are received and ANI > £60,000.
  // Employees with no other reason to file can pay it through their PAYE tax
  // code using HMRC's online service instead of registering for Self
  // Assessment. Those with self-employment or property income still file a
  // return and declare it there. rules.md §2.4.4.
  const hicbcPayable = hicbcCharge > 0;
  const filesSA =
    higherEarnerLabel === "Parent B"
      ? higherEarnerFilesSelfAssessment.parentB
      : higherEarnerFilesSelfAssessment.parentA;
  const selfAssessmentRequired = hicbcPayable && filesSA;
  const payeOptionAvailable = hicbcPayable && !filesSA;

  // ---- Recommendation (rules.md §2.4.5) ------------------------------------
  let recommendation: HICBCResult["recommendation"];
  let recommendationReason: string;

  if (!childBenefitRegistered) {
    recommendation = "register_opt_out";
    recommendationReason =
      "Register for Child Benefit immediately — even if HICBC would claw back 100% of payments. " +
      "Registration preserves NI credits for the non-working or lower-earning parent " +
      "(each credit counts toward the State Pension) and ensures the child automatically " +
      "receives a National Insurance number before age 16. Elect not to receive cash " +
      "payments to avoid the HICBC charge and any Self Assessment obligation.";
  } else if (
    childBenefitPaymentsElected &&
    higherEarnerANI >= config.hicbc.fullClawbackThreshold
  ) {
    recommendation = "opt_out_payments";
    recommendationReason =
      `Child Benefit is being fully clawed back by HICBC ` +
      `(100% withdrawal at ANI >= £${config.hicbc.fullClawbackThreshold.toLocaleString()}). ` +
      "There is no financial benefit to continuing payments. Elect to stop receiving them " +
      "to eliminate the HICBC liability and the need to report and pay it. " +
      "NI credits are preserved by the existing registration alone.";
  } else {
    // Either below HICBC threshold, partially affected, or already opted out
    const hicbcDescription =
      hicbcCharge > 0
        ? `HICBC claws back ${Math.round(retentionFraction * 100)}% ` +
          `(£${Math.round(hicbcCharge).toLocaleString()}/year). ` +
          `Net annual Child Benefit: £${Math.round(netChildBenefitAnnual).toLocaleString()}.`
        : childBenefitPaymentsElected
        ? "No HICBC applies. Full Child Benefit is retained."
        : "Payments are not being received. NI credits are preserved via registration.";

    recommendation = "keep_payments";
    recommendationReason =
      hicbcDescription +
      (selfAssessmentRequired
        ? " Declare and pay the HICBC on your Self Assessment return."
        : payeOptionAvailable
        ? " You can pay the HICBC through your PAYE tax code using HMRC's online " +
          "HICBC service, without registering for Self Assessment."
        : "");
  }

  // NI credits are preserved by registration alone — opt-out of payments is fine.
  // Only truly lost if the family never registered at all.
  // rules.md §2.4.5.
  const niCreditsPreserved = childBenefitRegistered;

  return {
    higherEarnerANI,
    higherEarnerLabel,
    grossChildBenefitAnnual: grossAnnual,
    hicbcCharge,
    netChildBenefitAnnual,
    retentionFraction,
    selfAssessmentRequired,
    payeOptionAvailable,
    niCreditsPreserved,
    recommendation,
    recommendationReason,
  };
}
