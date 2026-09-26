/**
 * Review.tsx — "Check your answers" (cards with Change links) and "Edit all
 * details" (every field, grouped into sections that open on demand).
 */

import { createEmptyParentIncome } from "../engine-src/index";
import type { ChildInfo, HouseholdInputs, ParentIncome } from "../engine-src/index";
import { ChildrenForm, HouseholdSettingsFields, ParentForm } from "../forms/DetailForms";
import { ChoiceCard, Field } from "./controls";
import { displayName, incomeTitle, reviewSections, withRegion } from "./model";
import type { Region, SetupMeta, StepId } from "./model";

export function Review({
  inputs, meta, today, onChange, onEditAll, onResults,
}: {
  inputs: HouseholdInputs;
  meta: SetupMeta;
  today: Date;
  onChange: (step: StepId) => void;
  onEditAll: () => void;
  onResults: () => void;
}) {
  const sections = reviewSections(inputs, meta, today);
  return (
    <main className="ob-page" id="main">
      <div className="ob-row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div className="ob-stack" style={{ gap: 8 }}>
          <h1 className="ob-h1" tabIndex={-1} data-page-heading>Check your answers</h1>
          <p className="ob-lede">Change anything that doesn’t look right, then see your results.</p>
        </div>
        <div className="ob-row">
          <button type="button" className="ob-btn" onClick={onEditAll}>Edit all details</button>
          <button type="button" className="ob-btn ob-btn--primary ob-btn--big" onClick={onResults}>Show my results</button>
        </div>
      </div>
      <div className="ob-review">
        {sections.map((s) => (
          <section key={s.step + s.title} className="ob-card ob-stack" style={{ gap: 14, padding: 22 }}>
            <div className="ob-row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>{s.title}</h2>
              <button type="button" className="ob-link" onClick={() => onChange(s.step)}>
                Change<span className="sr-only"> {s.title}</span>
              </button>
            </div>
            <dl>
              {s.rows.map((r) => (
                <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </main>
  );
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

function parentSummary(p: ParentIncome) {
  const extras = [p.bonus.expectedThisYear > 0 && "bonus", p.rsuVests.length > 0 && "shares", p.rentalIncomeNet > 0 && "rental",
    (p.savingsInterestNonISA > 0 || p.dividendsNonISA > 0) && "savings"].filter(Boolean);
  return `${money(p.grossSalary)} salary${extras.length ? ` · ${extras.join(", ")}` : ""}`;
}

export function EditAll({
  inputs, meta, update, updateMeta, onDone,
}: {
  inputs: HouseholdInputs;
  meta: SetupMeta;
  update: (f: (i: HouseholdInputs) => HouseholdInputs) => void;
  updateMeta: (f: (m: SetupMeta) => SetupMeta) => void;
  onDone: () => void;
}) {
  const setA = (p: ParentIncome) => update((i) => ({ ...i, parentA: p }));
  const setB = (p: ParentIncome) => update((i) => ({ ...i, parentB: p }));
  const setKids = (c: ChildInfo[]) => update((i) => ({ ...i, children: c }));
  const patch = (x: Partial<HouseholdInputs>) => update((i) => ({ ...i, ...x }));
  const setCouple = (couple: boolean) => {
    updateMeta((m) => ({ ...m, couple }));
    if (couple) update((i) => (i.parentB ? i : { ...i, parentB: createEmptyParentIncome("Parent B") }));
  };
  const couple = meta.couple !== false && !!inputs.parentB;

  return (
    <main className="ob-page" id="main" style={{ maxWidth: 960 }}>
      <div className="ob-row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div className="ob-stack" style={{ gap: 8 }}>
          <h1 className="ob-h1" tabIndex={-1} data-page-heading>Edit all details</h1>
          <p className="ob-lede">Every question on one page, grouped. Open a section to change it — hover or tap the ? marks for help.</p>
        </div>
        <button type="button" className="ob-btn ob-btn--primary ob-btn--big" onClick={onDone}>Update results</button>
      </div>

      <details className="ob-section" open>
        <summary>Family <span>{couple ? "Couple" : "Single parent"} · {inputs.children.length} {inputs.children.length === 1 ? "child" : "children"}</span></summary>
        <div className="ob-stack" style={{ gap: 16 }}>
          <div className="ob-grid2">
            <ChoiceCard on={!couple} onClick={() => setCouple(false)} title="Single parent" />
            <ChoiceCard on={couple} onClick={() => setCouple(true)} title="Couple" />
          </div>
          <Field label="Where do you live?">
            {({ id }) => (
              <select id={id} className="ob-select" style={{ maxWidth: 380 }} value={inputs.jurisdiction}
                onChange={(e) => update((i) => withRegion(i, e.target.value as Region))}>
                <option value="england">England</option>
                <option value="scotland">Scotland</option>
                <option value="wales">Wales</option>
                <option value="northern_ireland">Northern Ireland</option>
              </select>
            )}
          </Field>
          <ChildrenForm children={inputs.children} onChange={setKids} />
        </div>
      </details>

      <details className="ob-section" open>
        <summary>{incomeTitle(inputs, "A")} <span>{parentSummary(inputs.parentA)}</span></summary>
        <div><ParentForm parent={inputs.parentA} onChange={setA} label={displayName(inputs, "A")} taxYear={inputs.taxYear} /></div>
      </details>

      {couple && inputs.parentB && (
        <details className="ob-section">
          <summary>{incomeTitle(inputs, "B")} <span>{parentSummary(inputs.parentB)}</span></summary>
          <div><ParentForm parent={inputs.parentB} onChange={setB} label={displayName(inputs, "B")} taxYear={inputs.taxYear} /></div>
        </details>
      )}

      <details className="ob-section">
        <summary>Childcare and Child Benefit <span>Fees, nursery rate, exclusions, Child Benefit</span></summary>
        <div><HouseholdSettingsFields inputs={inputs} onHousehold={patch} /></div>
      </details>

      <div className="ob-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ob-btn ob-btn--primary ob-btn--big" onClick={onDone}>Update results</button>
      </div>
    </main>
  );
}
