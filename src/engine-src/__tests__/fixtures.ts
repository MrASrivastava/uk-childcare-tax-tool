import { createEmptyParentIncome } from "../types/income";
import type { ChildInfo, HouseholdInputs, ParentIncome } from "../types/income";
import type { TaxYear } from "../types/constants";

/** A parent earning `salary` with every other field zeroed, plus overrides. */
export function parent(
  salary: number,
  overrides: Partial<ParentIncome> = {},
  label = "Parent A"
): ParentIncome {
  return { ...createEmptyParentIncome(label), grossSalary: salary, ...overrides };
}

export function child(dateOfBirth: string, overrides: Partial<ChildInfo> = {}): ChildInfo {
  return { dateOfBirth, isDisabled: false, ...overrides };
}

/** A household with sensible defaults, evaluated at a fixed date. */
export function household(overrides: Partial<HouseholdInputs> = {}): HouseholdInputs {
  return {
    taxYear: "2025/26" as TaxYear,
    parentA: parent(50_000),
    parentB: null,
    children: [],
    childBenefitRegistered: true,
    childBenefitPaymentsElected: true,
    jurisdiction: "england",
    estimatedAnnualChildcareSpend: 0,
    asOfDate: "2025-10-01",
    ...overrides,
  };
}
