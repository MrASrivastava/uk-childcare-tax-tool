/**
 * steps.tsx — the questions on each setup step. Every answer is written
 * straight into HouseholdInputs through the helpers in model.ts.
 */

import { createEmptyParentIncome } from "../engine-src/index";
import type { ChildInfo, HouseholdInputs, ParentIncome } from "../engine-src/index";
import { ChoiceCard, Chip, Disclosure, Field, MoneyInput, Pill, Segmented, YesNo } from "./controls";
import {
  CHIPS, PENSION_OPTIONS, chipActive, childFacts, childFees, clearChip, displayName,
  pensionAmount, withPension, withRegion,
} from "./model";
import type { ChipDef, ParentKey, PensionMethod, Region, SetupMeta, StepErrors } from "./model";

export interface StepProps {
  inputs: HouseholdInputs;
  meta: SetupMeta;
  update: (f: (i: HouseholdInputs) => HouseholdInputs) => void;
  updateMeta: (f: (m: SetupMeta) => SetupMeta) => void;
  errors: StepErrors;
  today: Date;
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const TAX_MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];

function StepIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ob-stack" style={{ gap: 8 }}>
      <h1 className="ob-h1" tabIndex={-1} data-step-heading>{title}</h1>
      <p className="ob-lede">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: family
// ---------------------------------------------------------------------------

export function FamilyStep({ inputs, meta, update, updateMeta, errors, today }: StepProps) {
  const setCouple = (couple: boolean) => {
    updateMeta((m) => ({ ...m, couple }));
    if (couple) {
      update((i) => i.parentB ? i : {
        ...i,
        parentB: { ...createEmptyParentIncome("Parent B"), scotlandResident: i.jurisdiction === "scotland" },
      });
    }
  };
  const setName = (key: ParentKey, v: string) => update((i) => {
    const fallback = key === "A" ? "Parent A" : "Parent B";
    const label = v.trim() ? v : fallback;
    return key === "A" ? { ...i, parentA: { ...i.parentA, label } } : { ...i, parentB: i.parentB && { ...i.parentB, label } };
  });
  const nameValue = (p: ParentIncome | null, fallback: string) => (p && p.label !== fallback ? p.label : "");
  const setChildren = (f: (c: ChildInfo[]) => ChildInfo[]) => update((i) => ({ ...i, children: f(i.children) }));

  return (
    <>
      <StepIntro title="Tell us about your family">
        Who’s in the household decides which rules apply. Childcare support looks at each parent separately.
      </StepIntro>

      <fieldset className="ob-fieldset">
        <legend>Are you a single parent or a couple?</legend>
        <div className="ob-grid2">
          <ChoiceCard on={meta.couple === false} onClick={() => setCouple(false)} title="Single parent" sub="Just me looking after the children" />
          <ChoiceCard on={meta.couple === true} onClick={() => setCouple(true)} title="Couple" sub="Married, civil partners or living together" />
        </div>
        {errors.couple && <p className="ob-error" role="alert">{errors.couple}</p>}
      </fieldset>

      <div className="ob-grid2" style={{ gap: 16 }}>
        <Field label="Your first name" hint="Optional — we’ll use it to label your answers">
          {({ id, describedBy }) => (
            <input id={id} className="ob-input" aria-describedby={describedBy} autoComplete="given-name"
              value={nameValue(inputs.parentA, "Parent A")} placeholder="e.g. Alex"
              onChange={(e) => setName("A", e.target.value)} />
          )}
        </Field>
        {meta.couple === true && (
          <Field label="Your partner’s first name" hint="Optional">
            {({ id, describedBy }) => (
              <input id={id} className="ob-input" aria-describedby={describedBy} autoComplete="off"
                value={nameValue(inputs.parentB, "Parent B")} placeholder="e.g. Sam"
                onChange={(e) => setName("B", e.target.value)} />
            )}
          </Field>
        )}
      </div>

      <Field
        label="Where do you live?"
        hint={inputs.jurisdiction !== "england"
          ? "Free-hours rules differ outside England, so those figures are estimates. Tax-Free Childcare and Child Benefit work the same across the UK."
          : undefined}
      >
        {({ id, describedBy }) => (
          <select id={id} className="ob-select" style={{ maxWidth: 380 }} aria-describedby={describedBy}
            value={inputs.jurisdiction} onChange={(e) => update((i) => withRegion(i, e.target.value as Region))}>
            <option value="england">England</option>
            <option value="scotland">Scotland</option>
            <option value="wales">Wales</option>
            <option value="northern_ireland">Northern Ireland</option>
          </select>
        )}
      </Field>

      <fieldset className="ob-fieldset">
        <legend>Your children’s dates of birth</legend>
        {inputs.children.map((c, idx) => {
          const facts = childFacts(c.dateOfBirth, today);
          const inputId = `child-dob-${idx}`;
          return (
            <div key={idx} className="ob-kid">
              <div className="ob-kid-row">
                <label htmlFor={inputId} className="ob-label ob-label--sm">Child {idx + 1}</label>
                <input id={inputId} type="date" className="ob-input" style={{ width: 190 }}
                  value={c.dateOfBirth}
                  aria-invalid={!!facts.error || undefined}
                  aria-describedby={facts.error ? `${inputId}-err` : facts.info ? `${inputId}-info` : undefined}
                  onChange={(e) => setChildren((cs) => cs.map((x, j) => (j === idx ? { ...x, dateOfBirth: e.target.value } : x)))} />
                <span id={`${inputId}-info`} className="ob-kid-info">{facts.info}</span>
                {inputs.children.length > 1 && (
                  <button type="button" className="ob-link" aria-label={`Remove child ${idx + 1}`}
                    onClick={() => setChildren((cs) => cs.filter((_, j) => j !== idx))}>Remove</button>
                )}
              </div>
              {facts.error && <p id={`${inputId}-err`} className="ob-error" role="alert">{facts.error}</p>}
            </div>
          );
        })}
        <div>
          <button type="button" className="ob-btn ob-btn--dashed"
            onClick={() => setChildren((cs) => [...cs, { dateOfBirth: "", isDisabled: false }])}>
            + Add another child
          </button>
        </div>
        {errors.kids && <p className="ob-error" role="alert">{errors.kids}</p>}
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------
// Steps 2 and 3: each parent's income
// ---------------------------------------------------------------------------

export function IncomeStep({ inputs, meta, update, updateMeta, errors, parent }: StepProps & { parent: ParentKey }) {
  const p = (parent === "A" ? inputs.parentA : inputs.parentB) ?? createEmptyParentIncome("Parent B");
  const m = meta[parent];
  const name = displayName(inputs, parent);
  const you = name === "You" || name === "Your partner" ? (parent === "A" ? "you" : "your partner") : name;
  const title = name === "You" ? "Your income" : `${name}’s income`;

  const setP = (f: (x: ParentIncome) => ParentIncome) =>
    update((i) => (parent === "A" ? { ...i, parentA: f(i.parentA) } : { ...i, parentB: f(i.parentB ?? createEmptyParentIncome("Parent B")) }));
  const setM = (patch: Partial<SetupMeta["A"]>) => updateMeta((x) => ({ ...x, [parent]: { ...x[parent], ...patch } }));

  const perMonth = m.period === "month";
  const salaryShown = perMonth ? Math.round((p.grossSalary / 12) * 100) / 100 : p.grossSalary;
  const salaryHint = p.grossSalary > 0
    ? perMonth ? `That’s ${money(p.grossSalary)} a year.` : `That’s about ${money(p.grossSalary / 12)} a month.`
    : "Before tax, National Insurance and any pension. Include regular overtime and commission.";

  const method = m.pension;
  const option = PENSION_OPTIONS.find((o) => o.id === method);
  const pickPension = (id: PensionMethod) => {
    setM({ pension: id });
    setP((x) => withPension(x, id, id === "none" ? 0 : pensionAmount(x, method) || pensionAmount(x, id)));
  };

  const toggleChip = (chip: ChipDef) => {
    if (chipActive(p, m, chip)) {
      setM({ chips: m.chips.filter((c) => c !== chip.id) });
      setP((x) => clearChip(x, chip, inputs.taxYear));
    } else {
      setM({ chips: [...m.chips, chip.id] });
      if (chip.flag) setP((x) => chip.flag!.set(x, true));
    }
  };
  const activeChips = CHIPS.filter((c) => chipActive(p, m, c));
  const notWorking = m.salaryEntered && p.grossSalary === 0 && p.selfEmploymentProfit === 0 && !p.onStatutoryLeave;

  return (
    <>
      <StepIntro title={title}>
        Start with the essentials. We’ll only ask about extras that apply to {you}.
      </StepIntro>

      <Field
        label="Salary before tax"
        aside={<Segmented label="Salary period" value={m.period} onChange={(period) => setM({ period })}
          options={[{ id: "year", label: "Per year" }, { id: "month", label: "Per month" }]} />}
        hint={salaryHint}
        error={errors.salary}
        where="Your contract or offer letter, or the “Gross pay” on a payslip before any pension or salary sacrifice. Leave out one-off bonuses — they go below."
      >
        {({ id, describedBy, invalid }) => (
          <MoneyInput id={id} describedBy={describedBy} invalid={invalid} showZero={m.salaryEntered}
            value={salaryShown} placeholder={perMonth ? "e.g. 3,750" : "e.g. 45,000"}
            onChange={(v, typed) => {
              setM({ salaryEntered: typed });
              setP((x) => ({ ...x, grossSalary: perMonth ? Math.round(v * 12 * 100) / 100 : v }));
            }} />
        )}
      </Field>

      {notWorking && (
        <div className="ob-note ob-note--warn ob-stack" style={{ gap: 10 }}>
          <span>
            {parent === "A" ? "Are you" : `Is ${you}`} on parental leave, a carer or unable to work? Free hours and
            Tax-Free Childcare usually need {meta.couple === false ? "you to be" : "both parents"} working, with some exceptions.
          </span>
          <div className="ob-row">
            <Pill on={p.exemptFromMinimumIncome} onClick={() => setP((x) => ({ ...x, exemptFromMinimumIncome: !x.exemptFromMinimumIncome }))}>
              {p.exemptFromMinimumIncome ? "✓ Carer or unable to work" : "Carer or unable to work"}
            </Pill>
            <Pill on={false} onClick={() => { setM({ chips: [...m.chips, "leave"] }); setP((x) => ({ ...x, onStatutoryLeave: true })); }}>
              On parental leave
            </Pill>
          </div>
        </div>
      )}

      <Field label={<>Bonus you expect this tax year <span className="ob-hint">— leave blank if none</span></>}>
        {({ id, describedBy }) => (
          <MoneyInput id={id} describedBy={describedBy} value={p.bonus.expectedThisYear} placeholder="e.g. 8,000"
            onChange={(v) => setP((x) => ({ ...x, bonus: { ...x.bonus, expectedThisYear: v, paymentMonth: v > 0 ? x.bonus.paymentMonth : null } }))} />
        )}
      </Field>
      {p.bonus.expectedThisYear > 0 && (
        <Field label="Which month’s pay will it be in?" hint="A bonus paid in one month usually costs less National Insurance than one spread over the year.">
          {({ id, describedBy }) => (
            <select id={id} className="ob-select" style={{ maxWidth: 380 }} aria-describedby={describedBy}
              value={p.bonus.paymentMonth ?? ""}
              onChange={(e) => setP((x) => ({ ...x, bonus: { ...x.bonus, paymentMonth: e.target.value ? Number(e.target.value) : null } }))}>
              <option value="">Not sure yet</option>
              {TAX_MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn} payroll</option>)}
            </select>
          )}
        </Field>
      )}

      <fieldset className="ob-fieldset">
        <legend>How {parent === "A" && name === "You" ? "do you" : `does ${you}`} pay into a pension?</legend>
        <p className="ob-hint" style={{ marginTop: -6 }}>This matters a lot: the right kind of pension contribution lowers the income the government tests.</p>
        <div className="ob-grid2">
          {PENSION_OPTIONS.map((o) => (
            <ChoiceCard key={o.id} on={method === o.id} onClick={() => pickPension(o.id)} title={o.title} sub={o.sub} />
          ))}
        </div>
        {option && (
          <div className="ob-panel">
            <p className="ob-hint" style={{ color: "var(--ob-text)" }}><strong>How to tell from your payslip:</strong> {option.tip}</p>
            {option.id !== "none" && (
              <Field label={option.amountLabel} hint={option.amountHint} error={errors.pension}>
                {({ id, describedBy, invalid }) => (
                  <MoneyInput id={id} describedBy={describedBy} invalid={invalid} value={pensionAmount(p, option.id)}
                    placeholder="e.g. 5,000 a year" onChange={(v) => setP((x) => withPension(x, option.id, v))} />
                )}
              </Field>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="ob-fieldset">
        <legend>Does any of this apply to {you}?</legend>
        <p className="ob-hint" style={{ marginTop: -6 }}>Tick all that apply. Each one adds a single question — most families tick none or one.</p>
        <div className="ob-row" style={{ gap: 8 }}>
          {CHIPS.map((c) => <Chip key={c.id} on={chipActive(p, m, c)} onClick={() => toggleChip(c)}>{c.label}</Chip>)}
        </div>
        {activeChips.map((c) => (
          <div key={c.id} className="ob-panel ob-panel--outline">
            <strong style={{ fontSize: 15 }}>{c.label}</strong>
            {c.fields.map((f) => (
              <Field key={f.key} label={<span className="ob-label--sm">{f.label}</span>} where={f.where}>
                {({ id, describedBy }) => (
                  <MoneyInput id={id} describedBy={describedBy} value={f.get(p)} placeholder={f.placeholder}
                    onChange={(v) => setP((x) => f.set(x, v, inputs.taxYear))} />
                )}
              </Field>
            ))}
            {c.note && <p className="ob-hint">{c.note}</p>}
          </div>
        ))}
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4: childcare
// ---------------------------------------------------------------------------

const QUARTERS = ["April–June", "July–September", "October–December", "January–March"];

export function CareStep({ inputs, meta, update, updateMeta, today }: StepProps) {
  const setChild = (idx: number, f: (c: ChildInfo) => ChildInfo) =>
    update((i) => ({ ...i, children: i.children.map((c, j) => (j === idx ? f(c) : c)) }));
  const rate = inputs.providerHourlyRates?.age3to4 ?? 0;
  const ex = inputs.tfcExclusions;
  const setEx = (patch: Partial<NonNullable<HouseholdInputs["tfcExclusions"]>>) =>
    update((i) => ({
      ...i,
      tfcExclusions: {
        receivesUniversalCredit: false, eitherParentReceivesChildcareVouchers: false, receivesChildcareBursaryOrGrant: false,
        residenceConditionsConfirmed: true, ...i.tfcExclusions, ...patch,
      },
    }));

  return (
    <>
      <StepIntro title="Your childcare costs">
        Tax-Free Childcare adds £2 for every £8 you pay, up to £500 per child every three months. Rough figures are fine.
      </StepIntro>

      {inputs.children.map((c, idx) => {
        const facts = childFacts(c.dateOfBirth, today);
        if (!facts.valid) return null;
        const bill = c.childcareBill;
        const seasonal = !!bill && "quarterly" in bill;
        const nearlyTwo = facts.months >= 18 && facts.months < 36;
        return (
          <section key={idx} className="ob-panel ob-panel--outline" aria-label={`Child ${idx + 1}`}>
            <div className="ob-row" style={{ justifyContent: "space-between" }}>
              <strong>Child {idx + 1}</strong>
              <span className="ob-kid-info" style={{ flexGrow: 0 }}>{facts.info}</span>
            </div>
            {!seasonal ? (
              <Field label={<span className="ob-label--sm">What do you pay the nursery, childminder or clubs a year, before any free hours?</span>}
                hint="Monthly bill × 12 is fine. We take off the value of any free hours for you.">
                {({ id, describedBy }) => (
                  <MoneyInput id={id} describedBy={describedBy} value={childFees(c)} placeholder="e.g. 15,000"
                    onChange={(v) => setChild(idx, (x) => ({ ...x, childcareBill: { annual: v }, annualChildcareCost: undefined }))} />
                )}
              </Field>
            ) : (
              <fieldset className="ob-fieldset">
                <legend className="ob-label--sm">What do you pay in each three-month period, before any free hours?</legend>
                <div className="ob-grid2">
                  {QUARTERS.map((q, qi) => (
                    <div key={q} className="ob-field">
                      <span className="ob-hint">{q}</span>
                      <MoneyInput label={`Child ${idx + 1} fees ${q}`} value={bill.quarterly[qi]} placeholder="e.g. 3,000"
                        onChange={(v) => setChild(idx, (x) => {
                          const qs = [...(x.childcareBill && "quarterly" in x.childcareBill ? x.childcareBill.quarterly : [0, 0, 0, 0])] as [number, number, number, number];
                          qs[qi] = v;
                          return { ...x, childcareBill: { quarterly: qs } };
                        })} />
                    </div>
                  ))}
                </div>
                <p className="ob-hint">The £500 limit applies to each period and unused amounts don’t roll over, so holiday-heavy bills can lose some top-up.</p>
              </fieldset>
            )}
            <Segmented label="How the cost is spread" value={seasonal ? "seasonal" : "even"}
              options={[{ id: "even", label: "About the same all year" }, { id: "seasonal", label: "Higher in holidays" }]}
              onChange={(v) => setChild(idx, (x) => {
                const total = childFees(x);
                return v === "seasonal"
                  ? { ...x, childcareBill: { quarterly: [0, 1, 2, 3].map(() => Math.round(total / 4)) as [number, number, number, number] } }
                  : { ...x, childcareBill: { annual: total } };
              })} />
            <div className="ob-row">
              <Chip on={c.isDisabled} onClick={() => setChild(idx, (x) => ({ ...x, isDisabled: !x.isDisabled }))}>
                Gets Disability Living Allowance or PIP
              </Chip>
            </div>
            {nearlyTwo && (
              <Field label={<span className="ob-label--sm">Does this child get any extra support?</span>}
                hint="2-year-olds with extra support get 15 funded hours whatever you earn.">
                {({ id, describedBy }) => (
                  <select id={id} className="ob-select" style={{ maxWidth: 420 }} aria-describedby={describedBy}
                    value={c.twoYearOldExtraSupport ?? ""}
                    onChange={(e) => setChild(idx, (x) => ({ ...x, twoYearOldExtraSupport: (e.target.value || null) as ChildInfo["twoYearOldExtraSupport"] }))}>
                    <option value="">No</option>
                    <option value="dla">Disability Living Allowance</option>
                    <option value="ehc_plan">An EHC plan</option>
                    <option value="looked_after_or_left_care">Looked after, or left care</option>
                    <option value="benefits_route">We get Universal Credit on a low income</option>
                  </select>
                )}
              </Field>
            )}
          </section>
        );
      })}

      <div className="ob-stack" style={{ gap: 12 }}>
        <YesNo question="Do you know your nursery’s hourly rate?" value={meta.rateKnown}
          yes="Yes" no="No — use the national average"
          onChange={(known) => {
            updateMeta((x) => ({ ...x, rateKnown: known }));
            if (!known) update((i) => ({ ...i, providerHourlyRates: undefined }));
          }} />
        {meta.rateKnown && (
          <Field label={<span className="ob-label--sm">Hourly rate</span>}>
            {({ id }) => (
              <MoneyInput id={id} value={rate} placeholder="e.g. 11.50"
                onChange={(v) => update((i) => ({ ...i, providerHourlyRates: v > 0 ? { under2: v, age2: v, age3to4: v } : undefined }))} />
            )}
          </Field>
        )}
        <Disclosure summary="Why we ask">
          Free hours save you what the nursery would otherwise charge. The national average funding rate is usually lower, so knowing yours gives a truer figure.
        </Disclosure>
      </div>

      <div className="ob-stack" style={{ gap: 12 }}>
        <YesNo question="Do you get Universal Credit, employer childcare vouchers or a childcare grant?"
          value={meta.exclusionsAnswer} no="No" yes="Yes, one of these"
          onChange={(yes) => {
            updateMeta((x) => ({ ...x, exclusionsAnswer: yes }));
            if (!yes) update((i) => ({ ...i, tfcExclusions: undefined }));
          }} />
        {meta.exclusionsAnswer && (
          <div className="ob-panel">
            <p className="ob-hint" style={{ color: "var(--ob-text)" }}>
              You can’t use Tax-Free Childcare at the same time as these. Tick the ones that apply and we’ll show where you stand.
            </p>
            <div className="ob-row" style={{ gap: 8 }}>
              <Chip on={!!ex?.receivesUniversalCredit} onClick={() => setEx({ receivesUniversalCredit: !ex?.receivesUniversalCredit })}>Universal Credit</Chip>
              <Chip on={!!ex?.eitherParentReceivesChildcareVouchers} onClick={() => setEx({ eitherParentReceivesChildcareVouchers: !ex?.eitherParentReceivesChildcareVouchers })}>Childcare vouchers</Chip>
              <Chip on={!!ex?.receivesChildcareBursaryOrGrant} onClick={() => setEx({ receivesChildcareBursaryOrGrant: !ex?.receivesChildcareBursaryOrGrant })}>Childcare grant or bursary</Chip>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Child Benefit
// ---------------------------------------------------------------------------

export function ChildBenefitStep({ meta, update, updateMeta }: StepProps) {
  return (
    <>
      <StepIntro title="Child Benefit">
        Two quick questions. Registering matters even if you’d pay it all back: it protects National Insurance credits towards the State Pension.
      </StepIntro>
      <YesNo question="Have you registered for Child Benefit?" value={meta.cbRegistered}
        onChange={(reg) => {
          updateMeta((x) => ({ ...x, cbRegistered: reg }));
          update((i) => ({ ...i, childBenefitRegistered: reg, childBenefitPaymentsElected: reg && meta.cbReceiving !== false }));
        }} />
      {meta.cbRegistered === true && (
        <YesNo question="Are you receiving the payments?" value={meta.cbReceiving} yes="Yes" no="No — I opted out"
          onChange={(rcv) => {
            updateMeta((x) => ({ ...x, cbReceiving: rcv }));
            update((i) => ({ ...i, childBenefitPaymentsElected: rcv }));
          }} />
      )}
      {meta.cbRegistered === false && (
        <p className="ob-note ob-note--info">
          Worth registering anyway: you can opt out of the payments and keep the State Pension credits. We’ll include this in your results.
        </p>
      )}
    </>
  );
}
