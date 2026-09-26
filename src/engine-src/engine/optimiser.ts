/**
 * optimiser.ts
 *
 * Computes mitigation recommendations for households near or over eligibility thresholds.
 * Implements rules.md §7 (step 11 — Optimisation) and Part 4 (Mitigation Levers).
 *
 * Every lever is priced the same way: apply the action to a copy of the
 * household inputs, re-run the core calculation, and take the difference.
 *   - netAnnualGain         = change in household disposable cash
 *                             (take-home + net Child Benefit + TFC + free-hours value)
 *   - annualBenefitRestored = change in net Child Benefit + TFC + free-hours value
 *   - pensionPotIncrease    = gross amount added to the pension (reported separately)
 *
 * Re-running the calculation captures every interaction the hand-written
 * formulas used to miss: income tax actually saved, NIC by band, the PA taper,
 * stepwise HICBC, the joint-eligibility requirement for TFC and free hours
 * (both parents must qualify), and changes in who the higher earner is.
 */

import type { HouseholdInputs, ParentIncome } from "../types/income";
import type { CalculationResult, OptimisationRecommendation } from "../types/output";
import type { TaxYearConfig } from "../types/constants";
import { getTaxYearConfig } from "../types/constants";
import { calculateSalarySacrifice } from "./ani";

type ParentKey = "parentA" | "parentB";
type CoreFn = (inputs: HouseholdInputs) => CalculationResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Assumed contracted hours when checking the National Minimum Wage floor */
const DEFAULT_CONTRACTED_HOURS_PER_WEEK = 37.5;
/** Assumed P11D value of an EV when sizing an EV salary sacrifice lease */
const TYPICAL_EV_P11D = 35_000;
/** Typical upper limit of employer cycle-to-work schemes */
const MAX_CYCLE_TO_WORK = 5_000;
/** Distance below the £100k cliff at which a protective buffer is suggested */
const AT_RISK = 5_000;
/** Safety margin added by the protective buffer contribution */
const BUFFER_MARGIN = 2_000;

const r = (n: number) => Math.round(n);
const fmt = (n: number) => `£${r(n).toLocaleString()}`;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function disposable(res: CalculationResult): number {
  return res.householdSummary.totalHouseholdNetPosition;
}

function supportValue(res: CalculationResult): number {
  const h = res.householdSummary;
  return h.netChildBenefit + h.tfcTopUp + h.freeHoursAnnualValue;
}

function aniOf(res: CalculationResult, key: ParentKey): number {
  return key === "parentA" ? res.parentA.ani.adjustedNetIncome : res.parentB!.ani.adjustedNetIncome;
}

function paOf(res: CalculationResult, key: ParentKey): number {
  return key === "parentA"
    ? res.parentA.personalAllowance.effectivePersonalAllowance
    : res.parentB!.personalAllowance.effectivePersonalAllowance;
}

interface Simulation {
  after: CalculationResult;
  netAnnualGain: number;
  benefitDelta: number;
}

function simulate(
  inputs: HouseholdInputs,
  base: CalculationResult,
  core: CoreFn,
  mutate: (draft: HouseholdInputs) => void
): Simulation {
  const draft = structuredClone(inputs);
  mutate(draft);
  const after = core(draft);
  return {
    after,
    netAnnualGain: disposable(after) - disposable(base),
    benefitDelta: supportValue(after) - supportValue(base),
  };
}

/**
 * Names of the schemes whose value rises in `after` versus `base`, plus the
 * personal allowance if it was restored for this parent.
 */
function schemesRestored(base: CalculationResult, after: CalculationResult, key: ParentKey): string[] {
  const out: string[] = [];
  const b = base.householdSummary;
  const a = after.householdSummary;
  if (a.tfcTopUp > b.tfcTopUp + 0.5) out.push("Tax-Free Childcare");
  if (a.freeHoursAnnualValue > b.freeHoursAnnualValue + 0.5) out.push("30-hour free childcare");
  if (a.netChildBenefit > b.netChildBenefit + 0.5) {
    out.push(after.hicbc.hicbcCharge === 0 ? "Full Child Benefit (no HICBC)" : "Partial Child Benefit recovery");
  }
  if (paOf(after, key) > paOf(base, key)) out.push("Personal allowance restoration");
  return out;
}

function priorityFor(gain: number): OptimisationRecommendation["priority"] {
  return gain > 3_000 ? "high" : gain > 0 ? "medium" : "low";
}

function totalSacrifice(parent: ParentIncome, config: TaxYearConfig): number {
  return calculateSalarySacrifice(parent, config).totalSacrifice;
}

// ---------------------------------------------------------------------------
// Pension headroom
// ---------------------------------------------------------------------------

/**
 * Pension headroom from the base calculation's Annual Allowance test, which
 * counts employer contributions and DB accrual, applies the taper and MPAA,
 * and adds carry-forward.
 */
function pensionHeadroomAvailable(ctx: LeverContext): { headroom: number; warnings: string[] } {
  const capacity = ctx.key === "parentA" ? ctx.base.parentA.pensionCapacity : ctx.base.parentB!.pensionCapacity;
  const headroom = capacity.maxAdditionalContribution ?? capacity.remainingHeadroomThisYear;
  const warnings: string[] = [];
  if (capacity.mpaaApplies) {
    warnings.push(
      `MPAA applies — money purchase contributions above ${fmt(ctx.config.pension.mpaaAllowance)}/year are charged, ` +
        "and carry-forward cannot be used for them."
    );
  }
  if (capacity.carryForwardAvailable === null && !capacity.mpaaApplies) {
    warnings.push(
      "Prior-year pension inputs not provided. " +
        "Carry-forward capacity cannot be calculated — recommendations assume current-year headroom only."
    );
  }
  return { headroom, warnings };
}

// ---------------------------------------------------------------------------
// NMW check
// ---------------------------------------------------------------------------

/**
 * Salary sacrifice cannot take cash pay below the National Minimum Wage for
 * the hours actually worked.
 */
function wouldBreachNMW(parent: ParentIncome, additionalSacrifice: number, config: TaxYearConfig): boolean {
  const hours = parent.contractedHoursPerWeek ?? DEFAULT_CONTRACTED_HOURS_PER_WEEK;
  const postSacrifice = parent.grossSalary - totalSacrifice(parent, config) - additionalSacrifice;
  return postSacrifice < config.nationalMinimumWageHourly * hours * 52;
}

// ---------------------------------------------------------------------------
// Lever builders — each returns null when the lever does not apply
// ---------------------------------------------------------------------------

interface LeverContext {
  inputs: HouseholdInputs;
  base: CalculationResult;
  core: CoreFn;
  config: TaxYearConfig;
  key: ParentKey;
  parent: ParentIncome;
}

function buildPensionRecommendation(
  ctx: LeverContext,
  grossContribution: number,
  kind: "restore" | "protective" = "restore"
): OptimisationRecommendation {
  const { parent, config, key } = ctx;
  const { headroom, warnings } = pensionHeadroomAvailable(ctx);
  const localWarnings = [...warnings];
  let immediatelyActionable = true;

  // Prefer salary sacrifice (also saves NIC) unless NMW would be breached
  const useSIPP = wouldBreachNMW(parent, grossContribution, config);
  const lever: OptimisationRecommendation["lever"] = useSIPP ? "personal_pension_sipp" : "salary_sacrifice_pension";
  const netPaid = grossContribution * 0.8;

  const sim = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    const p = d[key]!;
    if (useSIPP) p.personalPensionContributions.reliefAtSourceNet += netPaid;
    else p.salarySacrifice.pension += grossContribution;
  });

  // A contribution above the available headroom triggers an Annual Allowance
  // charge. The re-run household already includes it in income tax, so the
  // net gain reflects it; flag it so the user can see why.
  if (grossContribution > headroom) {
    const chargeOf = (r: CalculationResult) =>
      key === "parentA" ? r.parentA.pensionCapacity.annualAllowanceCharge : r.parentB!.pensionCapacity.annualAllowanceCharge;
    const extraCharge = chargeOf(sim.after) - chargeOf(ctx.base);
    localWarnings.unshift(
      `This contribution (${fmt(grossContribution)} gross) is more than your Annual Allowance headroom ` +
        `(${fmt(headroom)}), so it would trigger an Annual Allowance charge of about ${fmt(extraCharge)}. ` +
        "The net gain shown includes that charge. Check that prior-year carry-forward data is complete."
    );
    immediatelyActionable = false;
  }

  if (useSIPP) {
    localWarnings.push(
      "Adding this as salary sacrifice would bring cash pay below the National Minimum Wage for your hours. " +
        "Use a personal pension / SIPP contribution instead (no NIC saving, same ANI effect)."
    );
    const expectedANI = aniOf(ctx.base, key) - grossContribution;
    if (aniOf(sim.after, key) > expectedANI + 1) {
      localWarnings.push(
        "Personal contributions only attract relief (and only reduce ANI) up to your relevant UK earnings " +
          "(minimum £3,600 gross). Part of this contribution would not reduce ANI."
      );
    }
    localWarnings.push(
      "Relief above the basic rate is given by extending your basic-rate band; claim it through " +
        "Self Assessment or by asking HMRC to adjust your tax code."
    );
  } else {
    localWarnings.push(
      "Salary sacrifice also saves employer NIC (15%). Check with your employer that the scheme can accommodate additional contributions."
    );
    localWarnings.push(
      "Salary sacrifice reduces contractual gross salary. This may affect: mortgage affordability assessments, " +
        "statutory maternity/paternity pay, death-in-service calculations. Verify with HR/payroll."
    );
    localWarnings.push(
      "From April 2029, salary sacrifice pension contributions above £2,000 a year will be subject to both " +
        "employee and employer NICs. The NIC saving shown only applies before April 2029. rules.md §4.1."
    );
  }

  const taxAndNICSaved = sim.netAnnualGain - sim.benefitDelta + (useSIPP ? netPaid : grossContribution);
  const leverDescription = useSIPP
    ? `Contribute ${fmt(netPaid)} net to a personal pension or SIPP. The provider claims ` +
      `${fmt(grossContribution * 0.2)} basic-rate relief, so the pot grows by ${fmt(grossContribution)} gross. ` +
      `Your tax bill falls by a further ${fmt(taxAndNICSaved)} through the band extension and PA taper.`
    : `Increase salary sacrifice pension by ${fmt(grossContribution)} gross/year. ` +
      `Your pension pot grows by ${fmt(grossContribution)}; income tax and employee NIC fall by ` +
      `${fmt(taxAndNICSaved)}, so take-home pay drops by only ${fmt(grossContribution - taxAndNICSaved)}.`;

  const restored = schemesRestored(ctx.base, sim.after, key);
  return {
    parentLabel: parent.label,
    schemesRestored: restored,
    lever,
    leverDescription,
    aniReductionRequired: grossContribution,
    actionRequired: useSIPP ? netPaid : grossContribution,
    actionUnit: useSIPP ? "net pension contribution" : "gross salary sacrifice pension",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: sim.netAnnualGain,
    pensionPotIncrease: grossContribution,
    warnings: localWarnings,
    immediatelyActionable,
    priority: priorityFor(sim.netAnnualGain),
    kind,
  };
}

function buildGiftAidRecommendation(ctx: LeverContext, aniReduction: number): OptimisationRecommendation {
  const netDonation = aniReduction * 0.8;
  const sim = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    d[ctx.key]!.giftAidDonationsNet += netDonation;
  });
  return {
    parentLabel: ctx.parent.label,
    schemesRestored: schemesRestored(ctx.base, sim.after, ctx.key),
    lever: "gift_aid",
    leverDescription:
      `Donate ${fmt(netDonation)} net to charity under Gift Aid. ` +
      `The grossed-up donation (${fmt(aniReduction)}) reduces ANI by the required amount. ` +
      `Only worthwhile if the giving was already planned, or the benefit substantially exceeds the donation. ` +
      `Gift Aid does not save NIC — less efficient than pension for the same ANI reduction.`,
    aniReductionRequired: aniReduction,
    actionRequired: netDonation,
    actionUnit: "net Gift Aid donation",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: sim.netAnnualGain,
    warnings: [
      "Each donation must be backed by a valid Gift Aid declaration to the charity.",
      "The charity reclaims 20% basic rate tax. You claim the additional relief via Self Assessment.",
      "Gift Aid donations cannot be reversed — ensure benefit exceeds cost before proceeding.",
    ],
    immediatelyActionable: true,
    priority: priorityFor(sim.netAnnualGain),
    kind: "restore",
  };
}

/**
 * EV salary sacrifice — rules.md §4.4.
 * ANI reduction = lease cost − (P11D × BiK rate), so lease = reduction + BiK.
 * The lease is a real cost; the car itself is a non-cash benefit.
 */
function buildEVRecommendation(ctx: LeverContext, aniReduction: number): OptimisationRecommendation | null {
  const { parent, config } = ctx;
  if (parent.salarySacrifice.ev !== null) return null; // Already has an EV scheme

  const estimatedBiK = TYPICAL_EV_P11D * config.evBiKRate;
  const lease = aniReduction + estimatedBiK;
  if (wouldBreachNMW(parent, lease, config)) return null;

  const sim = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    d[ctx.key]!.salarySacrifice.ev = { annualLeaseCost: lease, vehicleP11DValue: TYPICAL_EV_P11D, co2GramsPerKm: 0 };
  });

  return {
    parentLabel: parent.label,
    schemesRestored: schemesRestored(ctx.base, sim.after, ctx.key),
    lever: "ev_salary_sacrifice",
    leverDescription:
      `An EV salary sacrifice lease costing about ${fmt(lease)}/year would reduce ANI by the required amount ` +
      `after the BiK added back (${(config.evBiKRate * 100).toFixed(0)}% of an assumed ${fmt(TYPICAL_EV_P11D)} ` +
      `P11D = ${fmt(estimatedBiK)}/year). The net gain shown counts the lease as a cost; in return you get ` +
      `the use of a car, which is not included. Requires employer to offer an EV salary sacrifice scheme.`,
    aniReductionRequired: aniReduction,
    actionRequired: lease,
    actionUnit: "annual EV lease cost via salary sacrifice",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: sim.netAnnualGain,
    warnings: [
      "Employer must offer an EV salary sacrifice scheme — not all employers do.",
      "Only worthwhile if you would otherwise pay for a car: the lease cost is real spending.",
      "Sacrifice reduces contractual gross salary — may affect mortgage assessments and statutory pay.",
      `EV BiK rate rises from ${(config.evBiKRate * 100).toFixed(0)}% to 9% in the tax year starting April 2029 — model future year costs.`,
    ],
    immediatelyActionable: true,
    priority: priorityFor(sim.netAnnualGain),
    kind: "restore",
  };
}

/** Cycle-to-work — rules.md §4.5. The sacrifice funds a bicycle; it is not free. */
function buildCycleToWorkRecommendation(ctx: LeverContext, aniReduction: number): OptimisationRecommendation | null {
  if (aniReduction > MAX_CYCLE_TO_WORK) return null;
  if (wouldBreachNMW(ctx.parent, aniReduction, ctx.config)) return null;

  const sim = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    d[ctx.key]!.salarySacrifice.cycleToWork += aniReduction;
  });

  return {
    parentLabel: ctx.parent.label,
    schemesRestored: schemesRestored(ctx.base, sim.after, ctx.key),
    lever: "cycle_to_work",
    leverDescription:
      `A cycle-to-work sacrifice of ${fmt(aniReduction)}/year reduces ANI by the required amount. ` +
      `The net gain shown counts the sacrifice (less tax and NIC saved) as a cost; in return you get a bicycle ` +
      `and equipment, which is not included. Most employer schemes cap at £1,000–£5,000.`,
    aniReductionRequired: aniReduction,
    actionRequired: aniReduction,
    actionUnit: "annual cycle-to-work sacrifice",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: sim.netAnnualGain,
    warnings: [
      "Employer scheme cap — check your employer's maximum (often £1,000–£5,000).",
      "Only worthwhile if you want the bike: the sacrifice is real spending.",
      "Must be used mainly for qualifying journeys to avoid a BiK charge.",
      "Reduces contractual gross salary.",
    ],
    immediatelyActionable: true,
    priority: priorityFor(sim.netAnnualGain),
    kind: "restore",
  };
}

/**
 * Bonus deferral — rules.md §4.6. The bonus is received next year, so the net
 * effect is this year's change plus next year's change from adding the bonus
 * to next year's income (modelled with the same tax year's rules).
 */
function buildBonusDeferralRecommendation(ctx: LeverContext): OptimisationRecommendation | null {
  const { parent, key } = ctx;
  const bonus = parent.bonus.expectedThisYear;
  if (bonus <= 0) return null;
  const nextYearBonus = parent.bonus.expectedNextYear ?? 0;

  const thisYear = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    d[key]!.bonus.expectedThisYear = 0;
  });
  const withBonus = (amount: number) => {
    const d = structuredClone(ctx.inputs);
    d[key]!.bonus.expectedThisYear = amount;
    return ctx.core(d);
  };
  const nextYearDelta = disposable(withBonus(nextYearBonus + bonus)) - disposable(withBonus(nextYearBonus));
  const netGain = thisYear.netAnnualGain + nextYearDelta;
  if (thisYear.benefitDelta <= 0 && netGain <= 0) return null;

  return {
    parentLabel: parent.label,
    schemesRestored: schemesRestored(ctx.base, thisYear.after, key),
    lever: "bonus_deferral",
    leverDescription: parent.bonus.isDiscretionary
      ? `Deferring ${parent.label}'s bonus of ${fmt(bonus)} to next tax year reduces this year's ANI by the same ` +
        `amount and restores ${fmt(thisYear.benefitDelta)} of support this year. Net of the tax and benefits on ` +
        `the bonus when it is paid next year (assuming next year's other income is unchanged), the household ` +
        `is ${fmt(netGain)} ${netGain >= 0 ? "better" : "worse"} off over the two years. ` +
        "Must be requested before the bonus becomes contractually due."
      : "Bonus deferral applies to discretionary bonuses only. Contractual bonuses cannot be deferred.",
    aniReductionRequired: bonus,
    actionRequired: bonus,
    actionUnit: "gross bonus deferred to next tax year",
    annualBenefitRestored: thisYear.benefitDelta,
    netAnnualGain: netGain,
    warnings: [
      "Must be requested before the bonus is contractually due.",
      "The deferred bonus will be received and taxed in the following tax year.",
      !parent.bonus.isDiscretionary ? "This bonus is marked as contractual — deferral may not be possible." : "",
    ].filter(Boolean),
    immediatelyActionable: parent.bonus.isDiscretionary,
    priority: priorityFor(netGain),
    kind: "restore",
  };
}

/**
 * ISA migration — rules.md §4.7. The income is still received, but tax-free
 * and outside ANI, so it is added back to the simulated disposable cash.
 */
function buildISARecommendation(ctx: LeverContext): OptimisationRecommendation | null {
  const { parent, config, key } = ctx;
  const nonISAIncome = parent.savingsInterestNonISA + parent.dividendsNonISA;
  if (nonISAIncome <= 0) return null;

  const sim = simulate(ctx.inputs, ctx.base, ctx.core, (d) => {
    d[key]!.savingsInterestNonISA = 0;
    d[key]!.dividendsNonISA = 0;
  });
  const netGain = sim.netAnnualGain + nonISAIncome;
  if (netGain <= 0.5) return null;
  const restored = schemesRestored(ctx.base, sim.after, key);

  return {
    parentLabel: parent.label,
    schemesRestored: restored.length > 0 ? restored : ["Tax saving on investment income"],
    lever: "isa_migration",
    leverDescription:
      `${parent.label} has ${fmt(nonISAIncome)}/year of non-ISA savings/dividend income that counts in full ` +
      `towards ANI. Income inside an ISA is tax-free and excluded from ANI. Moving the underlying savings ` +
      `into ISAs over time would save ${fmt(netGain)}/year in tax and lost support. ` +
      `ISA allowance: ${fmt(config.isaAllowance)}/person/year.`,
    aniReductionRequired: nonISAIncome,
    actionRequired: config.isaAllowance,
    actionUnit: "ISA contribution per year (max)",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: netGain,
    warnings: [
      `ISA migration is gradual — existing assets can only be moved in at ${fmt(config.isaAllowance)}/year.`,
      "Consider using both partners' ISA allowances.",
      "Selling investments to rebuy inside an ISA is a disposal for CGT — check any unrealised gains first.",
    ],
    immediatelyActionable: true,
    priority: priorityFor(netGain),
    kind: "restore",
  };
}

/**
 * Income redistribution — rules.md §4.8. Moves savings, dividends and rental
 * income to the partner and re-runs the household, so any HICBC the partner
 * picks up, or a change in who is the higher earner, is counted.
 */
function buildRedistributionRecommendation(ctx: LeverContext): OptimisationRecommendation | null {
  const { parent, key, inputs } = ctx;
  if (inputs.parentB === null) return null;
  const otherKey: ParentKey = key === "parentA" ? "parentB" : "parentA";
  const other = inputs[otherKey]!;
  const movable = parent.savingsInterestNonISA + parent.dividendsNonISA + parent.rentalIncomeNet;
  if (movable <= 0) return null;

  const sim = simulate(inputs, ctx.base, ctx.core, (d) => {
    const from = d[key]!;
    const to = d[otherKey]!;
    to.savingsInterestNonISA += from.savingsInterestNonISA;
    to.dividendsNonISA += from.dividendsNonISA;
    to.rentalIncomeNet += from.rentalIncomeNet;
    to.rentalFinanceCosts = (to.rentalFinanceCosts ?? 0) + (from.rentalFinanceCosts ?? 0);
    from.savingsInterestNonISA = 0;
    from.dividendsNonISA = 0;
    from.rentalIncomeNet = 0;
    from.rentalFinanceCosts = 0;
  });
  if (sim.netAnnualGain <= 0.5) return null;

  const warnings = [
    "Must be a genuine unconditional gift of the underlying assets — HMRC's settlements legislation " +
      "(ITTOIA 2005, Part 5) can apply to arrangements that only redirect income.",
    "CGT: transfers between spouses or civil partners living together are no-gain/no-loss. Transfers between " +
      "unmarried partners are disposals at market value and can trigger Capital Gains Tax.",
    "Cannot split or transfer employment income, salary, or bonuses.",
    "For jointly owned property held by spouses, income is split 50:50 unless a Form 17 declaration is made.",
    "Seek legal and tax advice before transferring property or significant investment assets.",
  ];
  if (sim.after.hicbc.hicbcCharge > 0 && sim.after.hicbc.higherEarnerLabel !== ctx.base.hicbc.higherEarnerLabel) {
    warnings.unshift(`After the transfer ${other.label} becomes the higher earner for HICBC purposes.`);
  }

  return {
    parentLabel: parent.label,
    schemesRestored: schemesRestored(ctx.base, sim.after, key).concat("ANI reduction via income redistribution to partner"),
    lever: "income_redistribution",
    leverDescription:
      `${parent.label} has ${fmt(movable)}/year of investment or rental income contributing to ANI. ` +
      `Transferring the underlying assets to ${other.label} would move this income to their ANI. ` +
      `Re-running the household with the income moved, the household is ${fmt(sim.netAnnualGain)}/year better off ` +
      `(including any tax or HICBC effect on ${other.label}).`,
    aniReductionRequired: movable,
    actionRequired: 0,
    actionUnit: "transfer of income-producing assets to partner",
    annualBenefitRestored: sim.benefitDelta,
    netAnnualGain: sim.netAnnualGain,
    warnings,
    immediatelyActionable: false,
    priority: priorityFor(sim.netAnnualGain),
    kind: "restore",
  };
}

// ---------------------------------------------------------------------------
// Main recommendation function
// ---------------------------------------------------------------------------

/**
 * computeOptimisationRecommendations
 *
 * For each parent that is over or near a threshold:
 * 1. Calculates the ANI reduction needed to reach each threshold that matters
 *    (£100k childcare cliff and PA taper; £60k where HICBC ends)
 * 2. Prices each available lever by re-running the household calculation
 * 3. Adds a protective buffer recommendation when within £5k of the £100k cliff
 *
 * Recommendations that restore nothing are dropped. Results are sorted by
 * net annual gain, with protective recommendations last.
 *
 * rules.md §7 (step 11) and Part 4.
 */
export function computeOptimisationRecommendations(
  inputs: HouseholdInputs,
  base: CalculationResult,
  core: CoreFn
): OptimisationRecommendation[] {
  const config = getTaxYearConfig(inputs.taxYear);
  const CLIFF = config.freeHours.maximumANIThreshold;   // £100,000
  const HICBC_START = config.hicbc.startThreshold;      // £60,000

  const recommendations: OptimisationRecommendation[] = [];
  const keys: ParentKey[] = inputs.parentB ? ["parentA", "parentB"] : ["parentA"];

  // A threshold recommendation is only worth showing if it restores support
  // or the personal allowance.
  const restoresSomething = (rec: OptimisationRecommendation) =>
    rec.annualBenefitRestored > 0.5 || rec.schemesRestored.includes("Personal allowance restoration");
  const push = (rec: OptimisationRecommendation | null) => {
    if (rec && restoresSomething(rec)) recommendations.push(rec);
  };

  for (const key of keys) {
    const parent = inputs[key]!;
    const ctx: LeverContext = { inputs, base, core, config, key, parent };
    const currentANI = aniOf(base, key);

    // ---- 1. £100,000: childcare cliff and PA taper ---------------------------
    if (currentANI > CLIFF) {
      const reduction = currentANI - CLIFF;
      push(buildPensionRecommendation(ctx, reduction));
      push(buildGiftAidRecommendation(ctx, reduction));
      push(buildEVRecommendation(ctx, reduction));
      push(buildCycleToWorkRecommendation(ctx, reduction));
    }

    // ---- 2. £60,000: eliminate HICBC ------------------------------------------
    // Full Child Benefit is only restored below £60,000; at £80,000 the charge
    // is still 100%, so £80,000 is not a useful target.
    const isHigherEarner = base.hicbc.higherEarnerLabel === (key === "parentA" ? "Parent A" : "Parent B");
    if (currentANI > HICBC_START && base.hicbc.hicbcCharge > 0 && isHigherEarner) {
      const reduction = currentANI - HICBC_START;
      push(buildPensionRecommendation(ctx, reduction));
      push(buildGiftAidRecommendation(ctx, reduction));

      // Partial step for large gaps: a £5k reduction still recovers 25% of CB
      // if it lands inside the £60k–£80k taper.
      const partial = 5_000;
      if (reduction > partial && currentANI - partial < config.hicbc.fullClawbackThreshold) {
        push(buildPensionRecommendation(ctx, partial));
      }
    }

    // ---- 3. Bonus deferral, ISA migration, redistribution -----------------
    push(buildBonusDeferralRecommendation(ctx));
    const isa = buildISARecommendation(ctx);
    if (isa) recommendations.push(isa);
    const redistribution = buildRedistributionRecommendation(ctx);
    if (redistribution) recommendations.push(redistribution);

    // ---- 4. Protective buffer near the £100k cliff ----------------------------
    const gapToCliff = CLIFF - currentANI;
    if (gapToCliff > 0 && gapToCliff <= AT_RISK) {
      // Value at risk: what the household would lose if this parent's ANI
      // went £1 over the cliff (zero if the other parent is ineligible anyway).
      const overCliff = simulate(inputs, base, core, (d) => {
        d[key]!.otherTaxableIncome += gapToCliff + 1;
      });
      const valueAtRisk = -overCliff.benefitDelta;
      if (valueAtRisk > 0.5) {
        const buffer = gapToCliff + BUFFER_MARGIN;
        const rec = buildPensionRecommendation(ctx, buffer, "protective");
        recommendations.push({
          ...rec,
          schemesRestored: ["Tax-Free Childcare", "30-hour free childcare"],
          leverDescription:
            `${parent.label}'s ANI (${fmt(currentANI)}) is only ${fmt(gapToCliff)} below the ` +
            `${fmt(CLIFF)} childcare cliff edge, where the household would lose ${fmt(valueAtRisk)}/year of ` +
            `support. A bonus, RSU vest, or savings interest increase could push income over. ` +
            `An extra ${fmt(buffer)} gross pension contribution would restore a ${fmt(BUFFER_MARGIN)} ` +
            `margin. ` + rec.leverDescription,
          aniReductionRequired: 0,
          annualBenefitRestored: valueAtRisk,
          warnings: [
            `Only ${fmt(gapToCliff)} of headroom. Any variable income could trigger the cliff.`,
            "Consider locking in protection before the tax year end.",
            ...rec.warnings,
          ],
          priority: gapToCliff < 2_000 ? "high" : "medium",
        });
      }
    }
  }

  // Deduplicate: same parent, lever, action size and scheme set.
  const seen = new Set<string>();
  return recommendations
    .filter((rec) => {
      const key = `${rec.parentLabel}:${rec.lever}:${r(rec.aniReductionRequired)}:${rec.kind}:${rec.schemesRestored.join("|")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const pa = a.kind === "protective" ? 1 : 0;
      const pb = b.kind === "protective" ? 1 : 0;
      return pa - pb || b.netAnnualGain - a.netAnnualGain;
    });
}
