/**
 * pdfText.ts — text for the PDF report's header and cover, kept separate from
 * jsPDF so it can be unit-tested. Everything year-specific comes from the
 * calculation result.
 */
import type { CalculationResult } from "./engine-src/index";

const JURISDICTION_NAMES: Record<CalculationResult["jurisdiction"], string> = {
  england: "England",
  scotland: "Scotland",
  wales: "Wales",
  northern_ireland: "Northern Ireland",
};

export function pdfPageHeader(r: Pick<CalculationResult, "taxYear">): string {
  return `UK Childcare Tax Tool  ${r.taxYear}`;
}

export function pdfCoverSubtitle(r: Pick<CalculationResult, "taxYear" | "jurisdiction">): string {
  return `Personal Assessment  |  Tax Year ${r.taxYear}  |  ${JURISDICTION_NAMES[r.jurisdiction]}`;
}
