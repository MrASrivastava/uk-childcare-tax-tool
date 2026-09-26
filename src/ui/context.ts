/**
 * context.ts — app-wide helpers shared by the setup flow, the forms and the
 * results: currency formatting, the year-aware tooltip context and the
 * default tax year.
 */
import { createContext, useContext } from "react";
import {
  getTaxYearConfig,
  isConfiguredTaxYear,
  LATEST_CONFIGURED_TAX_YEAR,
  taxYearForDate,
} from "../engine-src/index";
import type { TaxYear } from "../engine-src/index";
import { buildTooltips, type Tooltips } from "../tooltips";

export const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

// Tooltips for the selected tax year, provided by App
export const TooltipContext = createContext<Tooltips>(buildTooltips(getTaxYearConfig(LATEST_CONFIGURED_TAX_YEAR)));
export const useTT = () => useContext(TooltipContext);

/** Today's tax year if configured, otherwise the latest configured year. */
export function defaultTaxYear(): { year: TaxYear; outOfDate: boolean } {
  const current = taxYearForDate(new Date());
  return isConfiguredTaxYear(current)
    ? { year: current, outOfDate: false }
    : { year: LATEST_CONFIGURED_TAX_YEAR, outOfDate: true };
}
