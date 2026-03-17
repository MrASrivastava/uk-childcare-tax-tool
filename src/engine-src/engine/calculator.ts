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
  MarginalRateDataPoint,
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
  computeFreeHoursForChild,
  computeTFCEligibility,
  computeHICBC,
} from "./eligibility";
import { computeOptimisationRecommendations } from "./optimiser";

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
  const ani = totalContributions; // Approximation
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
  parent: import("../types/income").ParentIncome,
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
 * Finds the ANI at which the parent's total net position (after income tax, NIC,
 * and all benefit losses) recovers to match the level just before the £100k cliff.
 *
 * This is the "breakeven" point — earning more than this ANI genuinely improves
 * the household's net position above where it was at £99k.
 *
 * Returns null if no crossover is found within the chart range.
 *
 * rules.md §9.5 — "crossover point".
 */
export function computeCrossoverANI(
  chartPoints: import("../types/output").MarginalRateDataPoint[],
  freeHoursIncrementalValue: number,
  potentialTFCMaxTopUp: number
): number | null {
  const CLIFF = 100_000;
  const STEP = 1_000;

  // Find the total net deductions at the pre-cliff point (£99k)
  // Net position at £99k ≈ take-home net of tax/NIC (no childcare loss)
  // We track cumulative benefit position relative to the £99k baseline
  let preCliffNetRate = 0;
  const preCliffPoint = chartPoints.find(p => p.ani === 99_000);
  if (preCliffPoint) {
    preCliffNetRate = preCliffPoint.totalEffectiveMarginalRate;
  }

  // Total benefits lost at the cliff
  const totalCliffLoss = freeHoursIncrementalValue + potentialTFCMaxTopUp;
  if (totalCliffLoss === 0) return null;

  // Cumulate the "extra burden" vs the pre-cliff baseline.
  // Start just above the cliff. As ANI increases, the PA taper adds burden
  // but the income earned (minus 60%+ effective rate) also accumulates.
  // Find where cumulative extra income earned > cumulative extra burden.
  let cumulativeExtraBurden = totalCliffLoss;
  let cumulativeExtraIncome = 0;

  for (const point of chartPoints) {
    if (point.ani <= CLIFF) continue;

    // Extra income earned at this step vs what the 40% band would have cost pre-cliff
    const baselineRate = 0.42; // 40% IT + 2% NIC above UEL at pre-cliff
    const actualRate = point.incomeTaxMarginalRate + point.nicMarginalRate + point.personalAllowanceTaperEffect;
    const extraBurdenThisStep = Math.max(actualRate - baselineRate, 0) * STEP;
    cumulativeExtraBurden += extraBurdenThisStep;

    // Gross income step
    cumulativeExtraIncome += STEP * (1 - actualRate);

    // Once cumulative income recovered exceeds cumulative burden, we've crossed
    if (cumulativeExtraIncome >= totalCliffLoss + (cumulativeExtraBurden - totalCliffLoss)) {
      return point.ani;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

/**
 * calculate
 *
 * The single entry point for all calculations.
 * Implements rules.md §7 (Calculation Sequence for the Tool) exactly.
 */
export function calculate(inputs: HouseholdInputs): CalculationResult {
  const config = getTaxYearConfig(inputs.taxYear);
  const localRates = inputs.localHourlyRates ?? DEFAULT_LOCAL_HOURLY_RATES;
  const referenceDate = new Date(); // Today — determines child age groups

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
  const parentAITCalc = calculateIncomeTax(parentAANI, parentAPA, inputs.parentA, config);
  const parentANICCalc = calculateEmployeeNIC(inputs.parentA, config);

  const parentAITResult: IncomeTaxResult = {
    parentLabel: inputs.parentA.label,
    taxableIncome: parentAITCalc.taxableIncome,
    personalAllowance: parentAPA,
    bands: parentAITCalc.bands,
    totalIncomeTax: parentAITCalc.totalIncomeTax,
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
        const calc = calculateIncomeTax(parentBANI, parentBPA, inputs.parentB, config);
        return {
          parentLabel: inputs.parentB.label,
          taxableIncome: calc.taxableIncome,
          personalAllowance: parentBPA,
          bands: calc.bands,
          totalIncomeTax: calc.totalIncomeTax,
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
  const parentAWorkingEligible =
    parentWorkingEligibilityFlag(
      parentAANI,
      inputs.parentA.exemptFromMinimumIncome,
      inputs.parentA.onStatutoryLeave,
      config
    ).status !== "not_eligible";

  const parentBWorkingEligible = inputs.parentB
    ? parentWorkingEligibilityFlag(
        parentBANI!,
        inputs.parentB.exemptFromMinimumIncome,
        inputs.parentB.onStatutoryLeave,
        config
      ).status !== "not_eligible"
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
  const tfc = computeTFCEligibility(
    parentAANI,
    parentBANI,
    inputs.parentA.exemptFromMinimumIncome,
    inputs.parentA.onStatutoryLeave,
    inputs.parentB?.exemptFromMinimumIncome ?? false,
    inputs.parentB?.onStatutoryLeave ?? false,
    inputs.children,
    inputs.estimatedAnnualChildcareSpend,
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
    config
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
  // INCOME TAX: computed on ANI (which correctly incorporates all Step 2/3 deductions),
  //   so tax is properly reduced by the grossed-up pension and Gift Aid amounts.
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

  // Compute potential TFC max top-up (what would be restored if eligible)
  // This differs from tfc.maxPossibleTopUpAnnual which is 0 when currently ineligible
  const potentialTFCMaxTopUp = inputs.children.reduce((sum, child) => {
    const dob = new Date(child.dateOfBirth);
    const maxAge = child.isDisabled ? config.tfc.maxChildAgeDisabledYears : config.tfc.maxChildAgeYears;
    const ageYears = (referenceDate.getFullYear() - dob.getFullYear()) + (referenceDate.getMonth() - dob.getMonth()) / 12;
    if (ageYears < maxAge) {
      return sum + (child.isDisabled ? config.tfc.maxTopUpDisabledPerYear : config.tfc.maxTopUpPerChildPerYear);
    }
    return sum;
  }, 0);

  // ---- Step 10: Optimisation recommendations ------------------------------
  const optimisationRecommendations = computeOptimisationRecommendations(
    { parent: inputs.parentA, ani: parentAANIBreakdown },
    inputs.parentB && parentBANIBreakdown
      ? { parent: inputs.parentB, ani: parentBANIBreakdown }
      : null,
    tfc,
    freeHoursChildren,
    hicbc,
    config,
    totalIncrementalFreeHoursValue,
    potentialTFCMaxTopUp
  );

  // ---- Marginal rate charts -----------------------------------------------
  const hasFreeHoursEligibleChild = freeHoursChildren.some(
    (c) => c.ageGroup !== "school_age_or_over" && c.ageGroup !== "under_9_months"
  );

  const parentAMarginalChart = generateMarginalRateChart(
    inputs.parentA,
    config,
    hicbc.grossChildBenefitAnnual,
    totalIncrementalFreeHoursValue,
    potentialTFCMaxTopUp
  );

  const parentBMarginalChart = inputs.parentB
    ? generateMarginalRateChart(
        inputs.parentB,
        config,
        hicbc.grossChildBenefitAnnual,
        totalIncrementalFreeHoursValue,
        potentialTFCMaxTopUp
      )
    : null;

  // ---- Crossover point -------------------------------------------------------
  const crossoverANI = computeCrossoverANI(
    parentAMarginalChart,
    totalIncrementalFreeHoursValue,
    potentialTFCMaxTopUp
  );

  // ---- At-risk thresholds ---------------------------------------------------
  const AT_RISK_BUFFER_LOCAL = 5_000;
  const atRiskThresholds: AtRiskThreshold[] = [];

  for (const { parentData, parentANI, parentLbl } of [
    { parentData: inputs.parentA, parentANI: parentAANI, parentLbl: "Parent A" },
    ...(inputs.parentB ? [{ parentData: inputs.parentB, parentANI: parentBANI!, parentLbl: "Parent B" }] : []),
  ]) {
    const distToChildcareCliff = config.freeHours.maximumANIThreshold - parentANI;
    if (distToChildcareCliff > 0 && distToChildcareCliff <= AT_RISK_BUFFER_LOCAL) {
      const atRiskValue = potentialTFCMaxTopUp + totalIncrementalFreeHoursValue;
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
    optimisationRecommendations,
    marginalRateChart: {
      parentA: parentAMarginalChart,
      parentB: parentBMarginalChart,
    },
    inputWarnings: warnings,
    crossoverANI,
    atRiskThresholds,
  };
}
