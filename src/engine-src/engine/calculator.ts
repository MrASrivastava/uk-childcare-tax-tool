/**
 * calculator.ts
 *
 * Top-level orchestrator. Runs all engines in the sequence defined in
 * rules.md Part 7, and assembles a complete CalculationResult.
 *
 * This is the single public API of the engine layer.
 * The UI and tests import only this module.
 */

import type { HouseholdInputs } from "../types/income";
import type {
  CalculationResult,
  HouseholdSummary,
  IncomeTaxResult,
  NICResult,
  PersonalAllowanceResult,
  PensionCapacity,
  AtRiskThreshold,
} from "../types/output";
import { getTaxYearConfig, DEFAULT_LOCAL_HOURLY_RATES } from "../types/constants";
import {
  calculateANI,
  calculatePersonalAllowance,
  calculateIncomeTax,
  calculateEmployeeNIC,
  calculatePensionCarryForward,
  totalPensionContributionsThisYear,
} from "./ani";
import {
  parentWorkingEligibilityFlag,
  minimumIncomeTest,
  computeFreeHoursForChild,
  computeTFCEligibility,
  computeHICBC,
  isTFCEligibleChild,
  tfcQuarterStarts,
  tfcTopUpValue,
} from "./eligibility";
import { computeOptimisationRecommendations } from "./optimiser";

/**
 * Whether a parent has income that requires a Self Assessment return anyway
 * (self-employment or property income). Such parents declare HICBC there;
 * others can pay it through PAYE.
 */
function filesSelfAssessment(parent: import("../types/income").ParentIncome): boolean {
  return parent.selfEmploymentProfit > 0 || parent.rentalIncomeNet > 0;
}

// ---------------------------------------------------------------------------
// Pension capacity helper
// ---------------------------------------------------------------------------

function buildPensionCapacity(
  parent: { label: string } & import("../types/income").ParentIncome,
  config: import("../types/constants").TaxYearConfig
): PensionCapacity {
  const aa = parent.mpaaTriggered ? config.pension.mpaaAllowance : config.pension.annualAllowance;
  const totalContributions = totalPensionContributionsThisYear(parent);
  const remainingHeadroom = Math.max(aa - totalContributions, 0);
  const carryForward = calculatePensionCarryForward(parent, config);
  const maxAdditional = carryForward !== null ? remainingHeadroom + carryForward : null;

  const warnings: string[] = [];
  if (parent.mpaaTriggered) {
    warnings.push(`MPAA applies: DC pension contributions capped at £${config.pension.mpaaAllowance.toLocaleString()}/year.`);
  }
  if (totalContributions > aa) {
    warnings.push(`Total pension contributions (£${Math.round(totalContributions).toLocaleString()}) exceed Annual Allowance (£${aa.toLocaleString()}). An AA charge may be due.`);
  }
  if (carryForward === null) {
    warnings.push("Prior-year contribution data not provided — carry-forward cannot be calculated.");
  }

  // Check tapered AA (simplified — full check requires employer contributions)
  const taperedAAApplies = false; // Would require employer contribution data to compute accurately

  return {
    parentLabel: parent.label,
    annualAllowance: aa,
    totalContributionsThisYear: totalContributions,
    remainingHeadroomThisYear: remainingHeadroom,
    carryForwardAvailable: carryForward,
    maxAdditionalContribution: maxAdditional,
    mpaaApplies: parent.mpaaTriggered,
    taperedAAApplies,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Marginal rate chart generation
// ---------------------------------------------------------------------------

/**
 * generateMarginalRateChart
 *
 * Computes per-£1k-ANI effective marginal rates across £50k–£135k.
 * Each rate component is separated so the UI can show a stacked area chart.
 *
 * Exported for direct testing.
 *
 * rules.md §9.5.
 *
 * Components:
 *   incomeTaxMarginalRate       — 20% / 40% / 45% by band
 *   nicMarginalRate             — 8% below UEL, 2% above (employment income proxy)
 *   personalAllowanceTaperEffect — extra 20% effective rate in taper zone (£100k–£125,140)
 *   hicbcWithdrawalRate         — grossCB / £20,000 per £1 in £60k–£80k range
 *   freeHoursBenefitLossRate    — free-hours annual value ÷ step size, only at the cliff point
 *   tfcBenefitLossRate          — TFC annual value ÷ step size, only at the cliff point
 *   childcareBenefitLossRate    — sum of the two childcare rates above
 *
 * Note: The cliff spike (at the £100k+£1k step) converts a one-off annual
 * benefit loss into a rate by dividing by the step size. This correctly
 * represents the marginal "cost" of crossing the threshold.
 */
export function generateMarginalRateChart(
  _parent: import("../types/income").ParentIncome,
  config: import("../types/constants").TaxYearConfig,
  grossChildBenefit: number,
  freeHoursIncrementalValue: number,
  potentialTFCMaxTopUp: number
): import("../types/output").MarginalRateDataPoint[] {
  const points: import("../types/output").MarginalRateDataPoint[] = [];
  const STEP = 1_000;
  const CLIFF = config.freeHours.maximumANIThreshold; // £100,000

  for (let ani = 50_000; ani <= 135_000; ani += STEP) {
    const pa     = calculatePersonalAllowance(ani, config);
    const prevPA = calculatePersonalAllowance(ani - STEP, config);

    // ---- Income tax marginal rate -------------------------------------------
    // Based on ANI (not taxable income) for chart purposes — an approximation
    // that is accurate once personal allowance has been accounted for in the
    // taper effect component.
    let itRate: number;
    if (ani > 125_140)    itRate = 0.45;
    else if (ani > 50_270) itRate = 0.40;
    else if (ani > 12_570) itRate = 0.20;
    else                   itRate = 0.00;

    // ---- NIC marginal rate --------------------------------------------------
    // Class 1 employee NIC on employment income. ANI used as proxy.
    // UEL = £50,270: above = 2%, between PT and UEL = 8%.
    const nicRate = ani < 50_270 ? 0.08 : 0.02;

    // ---- PA taper effect ----------------------------------------------------
    // In the taper zone each £2 of income removes £1 of PA, which itself was
    // shielding £1 from tax at 40%. Net: additional 20% effective rate.
    // Outside the zone prevPA === pa so this is zero.
    const paTaperEffect = (prevPA - pa) / STEP * 0.40;

    // ---- HICBC withdrawal rate ----------------------------------------------
    // 1% of grossCB per £200 income in the £60k–£80k range
    // = grossCB / taperDenominator per £1
    let hicbcRate = 0;
    if (ani > config.hicbc.startThreshold && ani <= config.hicbc.fullClawbackThreshold) {
      hicbcRate = grossChildBenefit / config.hicbc.taperDenominator;
    }

    // ---- Childcare cliff spike ----------------------------------------------
    // Both free hours AND TFC are lost at the £100k threshold.
    // We model this as a spike at the first step above the cliff (ani = £101k).
    // Rate = total annual value lost ÷ step size.
    let freeHoursLossRate = 0;
    let tfcLossRate = 0;
    if (ani === CLIFF + STEP) {
      if (freeHoursIncrementalValue > 0) {
        freeHoursLossRate = freeHoursIncrementalValue / STEP;
      }
      if (potentialTFCMaxTopUp > 0) {
        tfcLossRate = potentialTFCMaxTopUp / STEP;
      }
    }
    const childcareLossRate = freeHoursLossRate + tfcLossRate;

    const total =
      itRate + nicRate + paTaperEffect + hicbcRate + childcareLossRate;

    points.push({
      ani,
      incomeTaxMarginalRate:      itRate,
      nicMarginalRate:            nicRate,
      personalAllowanceTaperEffect: paTaperEffect,
      hicbcWithdrawalRate:        hicbcRate,
      freeHoursBenefitLossRate:   freeHoursLossRate,
      tfcBenefitLossRate:         tfcLossRate,
      childcareBenefitLossRate:   childcareLossRate,
      totalEffectiveMarginalRate: total,
    });
  }

  return points;
}

/**
 * computeCrossoverANI
 *
 * Finds the ANI at which the parent's net position (after income tax, NIC,
 * the PA taper and the childcare support lost at the cliff) recovers to the
 * level it was at just below the cliff.
 *
 * Above the cliff each extra £1 of ANI keeps (1 − marginal rate), where the
 * marginal rate already includes the PA taper. The crossover is the first
 * point where the cumulative amount kept covers the one-off cliff loss.
 *
 * Pass only the loss the household can actually realise (zero when the other
 * parent is ineligible anyway). Returns null if there is no loss or no
 * crossover within the chart range.
 *
 * rules.md §9.5 — "crossover point".
 */
export function computeCrossoverANI(
  chartPoints: import("../types/output").MarginalRateDataPoint[],
  freeHoursIncrementalValue: number,
  potentialTFCMaxTopUp: number,
  cliff = 100_000
): number | null {
  const totalCliffLoss = freeHoursIncrementalValue + potentialTFCMaxTopUp;
  if (totalCliffLoss <= 0) return null;

  let recovered = 0;
  let previousANI = cliff;
  for (const point of chartPoints) {
    if (point.ani <= cliff) continue;
    const step = point.ani - previousANI;
    previousANI = point.ani;
    const rate = point.incomeTaxMarginalRate + point.nicMarginalRate + point.personalAllowanceTaperEffect;
    recovered += step * (1 - rate);
    if (recovered >= totalCliffLoss) return point.ani;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

/**
 * calculateCore
 *
 * The full household calculation except optimisation recommendations
 * (returned empty). Implements rules.md §7 (Calculation Sequence for the Tool).
 * The optimiser calls this on modified inputs to price each lever.
 */
export function calculateCore(inputs: HouseholdInputs): CalculationResult {
  const config = getTaxYearConfig(inputs.taxYear);
  const localRates = inputs.providerHourlyRates ?? inputs.localHourlyRates ?? DEFAULT_LOCAL_HOURLY_RATES;
  const referenceDate = inputs.asOfDate
    ? new Date(inputs.asOfDate + "T00:00:00Z")
    : new Date(); // Today — determines child age groups

  const warnings: string[] = [];

  // ---- Steps 1–4: ANI per parent -----------------------------------------
  const parentAANIBreakdown = calculateANI(inputs.parentA, config);
  const parentBANIBreakdown = inputs.parentB
    ? calculateANI(inputs.parentB, config)
    : null;

  const parentAANI = parentAANIBreakdown.adjustedNetIncome;
  const parentBANI = parentBANIBreakdown?.adjustedNetIncome ?? null;

  // ---- Step 5a: Personal Allowance ----------------------------------------
  const parentAPA = calculatePersonalAllowance(parentAANI, config);
  const parentBPA = parentBANI !== null ? calculatePersonalAllowance(parentBANI, config) : null;

  const parentAPAResult: PersonalAllowanceResult = {
    parentLabel: inputs.parentA.label,
    ani: parentAANI,
    effectivePersonalAllowance: parentAPA,
    amountTapered: config.personalAllowance - parentAPA,
    paFullyWithdrawn: parentAPA === 0,
  };

  const parentBPAResult: PersonalAllowanceResult | null = inputs.parentB && parentBPA !== null
    ? {
        parentLabel: inputs.parentB.label,
        ani: parentBANI!,
        effectivePersonalAllowance: parentBPA,
        amountTapered: config.personalAllowance - parentBPA,
        paFullyWithdrawn: parentBPA === 0,
      }
    : null;

  // ---- Steps 5b–5c: Income tax and NIC per parent --------------------------
  const parentAITCalc = calculateIncomeTax(parentAANIBreakdown, parentAPA, inputs.parentA, config);
  const parentANICCalc = calculateEmployeeNIC(inputs.parentA, config);

  const parentAITResult: IncomeTaxResult = {
    parentLabel: inputs.parentA.label,
    taxableIncome: parentAITCalc.taxableIncome,
    personalAllowance: parentAPA,
    bands: parentAITCalc.bands,
    totalIncomeTax: parentAITCalc.totalIncomeTax,
    taxReductions: parentAITCalc.taxReductions,
    scottishRatesApplied: inputs.parentA.scotlandResident,
  };

  // Employer NIC is saved on ALL salary sacrifice, not just pension.
  // rules.md §4.1: employer NIC saved at 15% on all sacrificed amounts.
  const parentATotalSacrifice =
    inputs.parentA.salarySacrifice.pension +
    (inputs.parentA.salarySacrifice.ev?.annualLeaseCost ?? 0) +
    inputs.parentA.salarySacrifice.cycleToWork +
    inputs.parentA.salarySacrifice.other;

  const parentANICResult: NICResult = {
    parentLabel: inputs.parentA.label,
    grossPayForNIC: parentANICCalc.employmentIncomeForNIC,
    employeeNIC: parentANICCalc.employeeNIC,
    employerNICSavingFromSacrifice: parentATotalSacrifice * config.employerNICRate,
  };

  const parentBITResult: IncomeTaxResult | null = inputs.parentB && parentBANI !== null && parentBPA !== null
    ? (() => {
        const calc = calculateIncomeTax(parentBANIBreakdown!, parentBPA, inputs.parentB, config);
        return {
          parentLabel: inputs.parentB.label,
          taxableIncome: calc.taxableIncome,
          personalAllowance: parentBPA,
          bands: calc.bands,
          totalIncomeTax: calc.totalIncomeTax,
          taxReductions: calc.taxReductions,
          scottishRatesApplied: inputs.parentB.scotlandResident,
        };
      })()
    : null;

  const parentBNICResult: NICResult | null = inputs.parentB
    ? (() => {
        const calc = calculateEmployeeNIC(inputs.parentB, config);
        return {
          parentLabel: inputs.parentB.label,
          grossPayForNIC: calc.employmentIncomeForNIC,
          employeeNIC: calc.employeeNIC,
          employerNICSavingFromSacrifice: (
            inputs.parentB.salarySacrifice.pension +
            (inputs.parentB.salarySacrifice.ev?.annualLeaseCost ?? 0) +
            inputs.parentB.salarySacrifice.cycleToWork +
            inputs.parentB.salarySacrifice.other
          ) * config.employerNICRate,
        };
      })()
    : null;

  // ---- Pension capacity ---------------------------------------------------
  const parentAPensionCapacity = buildPensionCapacity(inputs.parentA, config);
  const parentBPensionCapacity = inputs.parentB
    ? buildPensionCapacity(inputs.parentB, config)
    : null;

  // ---- Step 5d: Working parent eligibility flags --------------------------
  const parentAMinIncome = minimumIncomeTest(inputs.parentA, config);
  const parentBMinIncome = inputs.parentB ? minimumIncomeTest(inputs.parentB, config) : null;

  const parentAWorkingEligible =
    parentWorkingEligibilityFlag(parentAANI, parentAMinIncome, config).status !== "not_eligible";

  const parentBWorkingEligible = inputs.parentB && parentBMinIncome
    ? parentWorkingEligibilityFlag(parentBANI!, parentBMinIncome, config).status !== "not_eligible"
    : null;

  // ---- Step 6: Free hours per child ----------------------------------------
  const freeHoursChildren = inputs.children.map((child, i) =>
    computeFreeHoursForChild(
      child,
      i,
      parentAWorkingEligible,
      parentBWorkingEligible,
      config,
      localRates,
      referenceDate
    )
  );

  const totalWorkingParentFreeHoursValue = freeHoursChildren.reduce(
    (sum, c) => sum + c.workingParentAnnualValue,
    0
  );

  const totalIncrementalFreeHoursValue = freeHoursChildren.reduce(
    (sum, c) => sum + c.incrementalWorkingParentValue,
    0
  );

  // ---- Step 7: TFC eligibility --------------------------------------------
  // Each child's childcare cost before funded hours: the per-child figure if
  // given, otherwise the household figure split across TFC-eligible children.
  const quarterStarts = tfcQuarterStarts(config);
  const tfcAgeChildren = inputs.children.filter(
    (c) => c.annualChildcareCost === undefined && quarterStarts.some((q) => isTFCEligibleChild(c, q, config))
  );
  const explicitCosts = inputs.children.reduce((sum, c) => sum + (c.annualChildcareCost ?? 0), 0);
  const sharedCost = tfcAgeChildren.length > 0
    ? Math.max(inputs.estimatedAnnualChildcareSpend - explicitCosts, 0) / tfcAgeChildren.length
    : 0;
  const childCosts = inputs.children.map((c) =>
    c.annualChildcareCost ?? (tfcAgeChildren.includes(c) ? sharedCost : 0)
  );
  // TFC pays 20% of what the parents pay, i.e. the bill after funded hours
  const childBills = childCosts.map((cost, i) =>
    Math.max(cost - freeHoursChildren[i].workingParentAnnualValue, 0)
  );

  const tfc = computeTFCEligibility(
    parentAANI,
    parentBANI,
    parentAMinIncome,
    parentBMinIncome,
    inputs.children,
    childBills,
    config,
    referenceDate
  );

  // ---- Step 8: Child Benefit / HICBC --------------------------------------
  const hicbc = computeHICBC(
    inputs.children,
    parentAANI,
    parentBANI,
    inputs.childBenefitRegistered,
    inputs.childBenefitPaymentsElected,
    config,
    {
      parentA: filesSelfAssessment(inputs.parentA),
      parentB: inputs.parentB ? filesSelfAssessment(inputs.parentB) : false,
    }
  );

  // ---- Step 9: Net take-home per parent -----------------------------------
  //
  // CORRECT FORMULA: take-home = step1NetIncome - income_tax - NIC - reliefAtSourcePensionNet - giftAidNet
  //
  // Base = step1NetIncome (gross income before Steps 2 & 3 ANI deductions), NOT ANI.
  //
  // WHY step1NetIncome, not ANI:
  //   ANI = step1NetIncome - giftAidGross - pensionGross (already has deductions baked in).
  //   If we used ANI as the base and then also subtracted giftAidNet and pensionNet,
  //   we would be double-counting those cash flows:
  //     - Gift Aid: ANI already reduced by (net/0.8), then we'd subtract net again
  //     - Pension:  ANI already reduced by (net/0.8), then we'd subtract net again
  //
  // SALARY SACRIFICE: already reflected in step1NetIncome (sacrifice reduces gross salary
  //   before Step 1). Not deducted again — the person never received the sacrificed amount
  //   in their bank account; it went directly to pension/lease provider.
  //
  // RELIEF-AT-SOURCE PENSION: the person physically paid `reliefAtSourceNet` into the
  //   pension pot. The provider claims 20% basic rate relief. Only the net paid is a
  //   real bank outflow for the individual.
  //
  // GIFT AID: the person physically donated `giftAidDonationsNet`. The charity reclaims
  //   the 20% tax relief. Only the net donated is a real bank outflow.
  //
  // INCOME TAX: computed on step1NetIncome less the ANI-derived personal allowance,
  //   with the higher-rate thresholds extended by the grossed-up pension and Gift Aid.
  //   The basic-rate relief goes to the pension pot / charity, not to the pay packet.
  //
  // rules.md Part 1 (ANI calculation steps) and §9.3 (Output Specification).

  const parentANetTakeHome =
    parentAANIBreakdown.step1NetIncome -
    parentAITResult.totalIncomeTax -
    parentANICResult.employeeNIC -
    inputs.parentA.personalPensionContributions.reliefAtSourceNet -
    inputs.parentA.giftAidDonationsNet;

  const parentBNetTakeHome = inputs.parentB && parentBITResult && parentBNICResult && parentBANIBreakdown
    ? parentBANIBreakdown.step1NetIncome -
      parentBITResult.totalIncomeTax -
      parentBNICResult.employeeNIC -
      inputs.parentB.personalPensionContributions.reliefAtSourceNet -
      inputs.parentB.giftAidDonationsNet
    : 0;

  const householdSummary: HouseholdSummary = {
    parentANetTakeHome,
    parentBNetTakeHome,
    netChildBenefit: hicbc.netChildBenefitAnnual,
    tfcTopUp: tfc.estimatedActualTopUpAnnual,
    freeHoursAnnualValue: totalWorkingParentFreeHoursValue,
    totalHouseholdNetPosition:
      parentANetTakeHome +
      parentBNetTakeHome +
      hicbc.netChildBenefitAnnual +
      tfc.estimatedActualTopUpAnnual +
      totalWorkingParentFreeHoursValue,
  };

  // Potential TFC top-up if the household were eligible (the value at stake at
  // the cliff edge). Bills are net of the funded hours the household would get
  // with working-parent entitlement.
  const potentialTFCMaxTopUp = tfcTopUpValue(
    inputs.children,
    childCosts.map((cost, i) =>
      Math.max(cost - freeHoursChildren[i].universalAnnualValue - freeHoursChildren[i].incrementalWorkingParentValue, 0)
    ),
    config
  ).estimatedTopUp;

  // ---- Cliff-edge value each parent controls --------------------------------
  // Crossing £100k only costs (or restores) childcare support if the OTHER
  // parent passes both working-parent tests. Otherwise the household is
  // ineligible either way and nothing turns on this parent's ANI.
  const cliffLoss = totalIncrementalFreeHoursValue + potentialTFCMaxTopUp;
  const cliffLossForA = parentBWorkingEligible === false ? 0 : cliffLoss;
  const cliffLossForB = parentAWorkingEligible ? cliffLoss : 0;
  const cliffFH = (loss: number) => (loss > 0 ? totalIncrementalFreeHoursValue : 0);
  const cliffTFC = (loss: number) => (loss > 0 ? potentialTFCMaxTopUp : 0);

  if (cliffLoss > 0) {
    const over = (ani: number | null) => ani !== null && ani > config.freeHours.maximumANIThreshold;
    const blocked = [
      over(parentAANI) && cliffLossForA === 0 ? inputs.parentA.label : null,
      inputs.parentB && over(parentBANI) && cliffLossForB === 0 ? inputs.parentB.label : null,
    ].filter(Boolean);
    if (blocked.length > 0) {
      warnings.push(
        `Reducing ${blocked.join(" or ")}'s ANI below £${config.freeHours.maximumANIThreshold.toLocaleString()} ` +
        "would not restore Tax-Free Childcare or working-parent free hours on its own, because the other parent " +
        "does not currently meet the working-parent income tests. Both parents must qualify."
      );
    }
  }

  // ---- Marginal rate charts -----------------------------------------------
  const parentAMarginalChart = generateMarginalRateChart(
    inputs.parentA,
    config,
    hicbc.grossChildBenefitAnnual,
    cliffFH(cliffLossForA),
    cliffTFC(cliffLossForA)
  );

  const parentBMarginalChart = inputs.parentB
    ? generateMarginalRateChart(
        inputs.parentB,
        config,
        hicbc.grossChildBenefitAnnual,
        cliffFH(cliffLossForB),
        cliffTFC(cliffLossForB)
      )
    : null;

  // ---- Crossover point -------------------------------------------------------
  const crossoverANIParentA = computeCrossoverANI(
    parentAMarginalChart,
    cliffFH(cliffLossForA),
    cliffTFC(cliffLossForA),
    config.freeHours.maximumANIThreshold
  );
  const crossoverANIParentB = parentBMarginalChart
    ? computeCrossoverANI(
        parentBMarginalChart,
        cliffFH(cliffLossForB),
        cliffTFC(cliffLossForB),
        config.freeHours.maximumANIThreshold
      )
    : null;

  // ---- At-risk thresholds ---------------------------------------------------
  const AT_RISK_BUFFER_LOCAL = 5_000;
  const atRiskThresholds: AtRiskThreshold[] = [];

  for (const { parentANI, parentLbl } of [
    { parentData: inputs.parentA, parentANI: parentAANI, parentLbl: "Parent A" },
    ...(inputs.parentB ? [{ parentData: inputs.parentB, parentANI: parentBANI!, parentLbl: "Parent B" }] : []),
  ]) {
    const distToChildcareCliff = config.freeHours.maximumANIThreshold - parentANI;
    if (distToChildcareCliff > 0 && distToChildcareCliff <= AT_RISK_BUFFER_LOCAL) {
      const atRiskValue = parentLbl === "Parent A" ? cliffLossForA : cliffLossForB;
      atRiskThresholds.push({
        thresholdLabel: "£100,000 childcare cliff edge (TFC + free hours)",
        parentLabel: parentLbl,
        currentGap: distToChildcareCliff,
        potentialAnnualLossGBP: atRiskValue,
        schemesAtRisk: ["Tax-Free Childcare", "30-hour free childcare"],
      });
    }
    const distToHICBCStart = config.hicbc.startThreshold - parentANI;
    if (distToHICBCStart > 0 && distToHICBCStart <= AT_RISK_BUFFER_LOCAL) {
      atRiskThresholds.push({
        thresholdLabel: "£60,000 HICBC threshold",
        parentLabel: parentLbl,
        currentGap: distToHICBCStart,
        potentialAnnualLossGBP: hicbc.grossChildBenefitAnnual,
        schemesAtRisk: ["Child Benefit (HICBC begins)"],
      });
    }
    const distToHICBCFull = config.hicbc.fullClawbackThreshold - parentANI;
    if (distToHICBCFull > 0 && distToHICBCFull <= AT_RISK_BUFFER_LOCAL) {
      atRiskThresholds.push({
        thresholdLabel: "£80,000 HICBC full clawback",
        parentLabel: parentLbl,
        currentGap: distToHICBCFull,
        potentialAnnualLossGBP: hicbc.netChildBenefitAnnual,
        schemesAtRisk: ["Child Benefit (fully lost)"],
      });
    }
  }

  // ---- Input warnings -----------------------------------------------------
  if (inputs.jurisdiction !== "england") {
    warnings.push(
      `Jurisdiction set to ${inputs.jurisdiction}. Free-hours calculations are based on England rules. ` +
      "Scotland, Wales, and Northern Ireland have different childcare entitlement structures — results may not be accurate."
    );
  }

  if (!inputs.childBenefitRegistered && inputs.children.length > 0) {
    warnings.push(
      "Child Benefit is not registered. Even if HICBC would claw it back entirely, " +
      "registering and opting out of payments preserves National Insurance credits for State Pension purposes."
    );
  }

  return {
    taxYear: inputs.taxYear,
    calculatedAt: new Date().toISOString(),

    parentA: {
      ani: parentAANIBreakdown,
      personalAllowance: parentAPAResult,
      incomeTax: parentAITResult,
      nic: parentANICResult,
      pensionCapacity: parentAPensionCapacity,
    },

    parentB:
      inputs.parentB && parentBANIBreakdown && parentBPAResult && parentBITResult && parentBNICResult && parentBPensionCapacity
        ? {
            ani: parentBANIBreakdown,
            personalAllowance: parentBPAResult,
            incomeTax: parentBITResult,
            nic: parentBNICResult,
            pensionCapacity: parentBPensionCapacity,
          }
        : null,

    hicbc,
    tfc,
    freeHours: {
      children: freeHoursChildren,
      totalWorkingParentAnnualValue: totalWorkingParentFreeHoursValue,
    },
    householdSummary,
    optimisationRecommendations: [],
    marginalRateChart: {
      parentA: parentAMarginalChart,
      parentB: parentBMarginalChart,
    },
    inputWarnings: warnings,
    crossoverANI: crossoverANIParentA,
    crossoverANIByParent: { parentA: crossoverANIParentA, parentB: crossoverANIParentB },
    atRiskThresholds,
  };
}

/**
 * calculate
 *
 * The single entry point for all calculations.
 * Runs the core household calculation, then the optimiser, which prices each
 * recommendation by re-running the core calculation with the action applied.
 */
export function calculate(inputs: HouseholdInputs): CalculationResult {
  const core = calculateCore(inputs);
  return {
    ...core,
    optimisationRecommendations: computeOptimisationRecommendations(inputs, core, calculateCore),
  };
}
