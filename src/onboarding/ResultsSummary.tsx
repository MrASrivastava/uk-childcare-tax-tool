/**
 * ResultsSummary.tsx — two or three plain sentences above the detailed
 * results: who is over the limit, what it costs, and the most effective fix.
 */

import type { ReactNode } from "react";
import type { CalculationResult, HouseholdInputs } from "../engine-src/index";
import { summarise } from "./model";

export function ResultsSummary({
  result, inputs, onEdit, onEditAll, actions,
}: {
  result: CalculationResult;
  inputs: HouseholdInputs;
  onEdit: () => void;
  onEditAll: () => void;
  actions?: ReactNode;
}) {
  const { headline, lines } = summarise(result, inputs);
  return (
    <section className="ob-card ob-summary" aria-labelledby="summary-h">
      <div className="ob-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div className="ob-stack" style={{ gap: 6, flex: "1 1 420px" }}>
          <p className="ob-kicker">Your summary</p>
          <h1 id="summary-h" className="ob-h1" tabIndex={-1} data-page-heading>{headline}</h1>
        </div>
        <div className="ob-row">
          <button type="button" className="ob-btn" onClick={onEdit}>Edit details</button>
          <button type="button" className="ob-link" onClick={onEditAll}>Edit all details</button>
          {actions}
        </div>
      </div>
      {lines.map((l) => <p key={l}>{l}</p>)}
    </section>
  );
}
