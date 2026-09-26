/**
 * LivePreview.tsx — "your position so far", recalculated with the real
 * engine on every answer. A sticky panel on desktop, a bottom sheet on phones.
 */

import { useState } from "react";
import type { CalculationResult, HouseholdInputs } from "../engine-src/index";
import { aniZone, displayName, previewStatuses, summarise } from "./model";
import type { SetupMeta } from "./model";

const SCALE_MAX = 140_000;
const TICKS = [0, 60_000, 80_000, 100_000, 140_000];
const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function LivePreview({ result, inputs, meta }: { result: CalculationResult | null; inputs: HouseholdInputs; meta: SetupMeta }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;

  const parents = [
    { key: "A" as const, ani: result.parentA.ani.adjustedNetIncome },
    ...(result.parentB && meta.couple !== false ? [{ key: "B" as const, ani: result.parentB.ani.adjustedNetIncome }] : []),
  ];
  const statuses = previewStatuses(result);
  const anyIncome = parents.some((p) => p.ani > 0);
  const headline = anyIncome ? summarise(result, inputs).headline : "Add a salary to see where you stand.";

  return (
    <aside className="ob-preview" aria-label="Live preview" data-open={open}>
      <button type="button" className="ob-preview-mobile-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{headline}</span>
        <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      <div className="ob-row" style={{ justifyContent: "space-between" }}>
        <h2>Your position so far</h2>
        <span className="ob-preview-tag">Updates as you type</span>
      </div>
      {parents.map((p) => {
        const name = displayName(inputs, p.key);
        return (
          <div key={p.key} className="ob-stack" style={{ gap: 8 }}>
            <div className="ob-row" style={{ justifyContent: "space-between", fontSize: 15 }}>
              <span>{name === "You" ? "Your income tested" : `${name}: income tested`}</span>
              <strong>{money(p.ani)}</strong>
            </div>
            <div className="ob-track" aria-hidden="true">
              <span style={{ left: `calc(${Math.min(Math.max(p.ani / SCALE_MAX, 0), 1) * 100}% - 2px)` }} />
            </div>
            <div className="ob-ticks" aria-hidden="true">
              {TICKS.map((t) => <span key={t} style={{ left: `${(t / SCALE_MAX) * 100}%` }}>{t === 0 ? "£0" : `£${t / 1000}k`}</span>)}
            </div>
            <span style={{ fontSize: 14, color: "#E9E4D8" }}>{aniZone(p.ani, result.taxYear)}</span>
          </div>
        );
      })}
      <div className="ob-stack" style={{ gap: 8 }} aria-live="polite">
        {statuses.map((s) => (
          <div key={s.label} className="ob-status">
            <span>{s.label}</span>
            <span className={`ob-badge ob-badge--${s.kind}`}>{s.status}</span>
          </div>
        ))}
      </div>
      {anyIncome && <p className="ob-preview-headline">{headline}</p>}
      <p style={{ fontSize: 13, color: "#C9C2B4" }}>
        “Income tested” is adjusted net income: pay and other income, less certain pension contributions and Gift Aid.
      </p>
    </aside>
  );
}
