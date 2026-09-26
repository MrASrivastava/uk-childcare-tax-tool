/**
 * SetupFlow.tsx — the guided steps: progress, one short page of questions at
 * a time, Back / Continue with gentle validation, and the live preview.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CalculationResult, HouseholdInputs } from "../engine-src/index";
import { LivePreview } from "./LivePreview";
import { stepOrder, stepTitle, validateStep } from "./model";
import type { SetupMeta, StepErrors, StepId } from "./model";
import { CareStep, ChildBenefitStep, FamilyStep, IncomeStep } from "./steps";
import type { StepProps } from "./steps";

const SHORT_NAME: Record<StepId, string> = { family: "Family", A: "Income", B: "Partner", care: "Childcare", cb: "Child Benefit" };

export function SetupFlow({
  inputs, meta, step, fromReview, today, result, update, updateMeta, onStep, onReview, onExit,
}: {
  inputs: HouseholdInputs;
  meta: SetupMeta;
  step: StepId;
  fromReview: boolean;
  today: Date;
  result: CalculationResult | null;
  update: StepProps["update"];
  updateMeta: StepProps["updateMeta"];
  onStep: (s: StepId) => void;
  onReview: () => void;
  onExit: () => void;
}) {
  const [errors, setErrors] = useState<StepErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const order = stepOrder(meta);
  const idx = Math.max(order.indexOf(step), 0);
  const remaining = order.length - idx;

  // Errors appear once Continue is pressed, then update as the person fixes things.
  const liveErrors = Object.keys(errors).length ? validateStep(step, inputs, meta, today) : {};

  // Move focus to the new step's heading so keyboard and screen reader users start at the top.
  useEffect(() => {
    const h = formRef.current?.querySelector<HTMLElement>("[data-step-heading]");
    h?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  const go = (s: StepId) => { setErrors({}); onStep(s); };

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    const found = validateStep(step, inputs, meta, today);
    if (Object.keys(found).length) {
      setErrors(found);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView({ block: "center" }));
      return;
    }
    setErrors({});
    if (fromReview || idx === order.length - 1) onReview();
    else go(order[idx + 1]);
  };
  const back = () => {
    if (fromReview) onReview();
    else if (idx === 0) onExit();
    else go(order[idx - 1]);
  };

  const props: StepProps = { inputs, meta, update, updateMeta, errors: liveErrors, today };

  return (
    <main className="ob-page" id="main">
      <div className="ob-progress">
        <div className="ob-progress-top">
          <strong>Step {idx + 1} of {order.length} · {stepTitle(inputs, step)}</strong>
          <span className="ob-hint">{remaining <= 1 ? "Last step" : `About ${remaining} minutes left`}</span>
        </div>
        <div className="ob-bar" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={order.length} aria-valuenow={idx + 1}>
          <div style={{ width: `${((idx + 1) / order.length) * 100}%` }} />
        </div>
        <ol className="ob-steps" aria-label="Steps">
          {order.map((s, i) => (
            <li key={s} data-state={i < idx ? "done" : i === idx ? "current" : "todo"} aria-current={i === idx ? "step" : undefined}>
              {i < idx && <span aria-hidden="true">✓ </span>}{s === "B" && meta.couple ? SHORT_NAME.B : SHORT_NAME[s]}
            </li>
          ))}
        </ol>
      </div>

      <div className="ob-setup">
        <form ref={formRef} className="ob-card ob-stack" style={{ gap: 28 }} onSubmit={next} noValidate>
          {step === "family" && <FamilyStep {...props} />}
          {step === "A" && <IncomeStep key="A" {...props} parent="A" />}
          {step === "B" && <IncomeStep key="B" {...props} parent="B" />}
          {step === "care" && <CareStep {...props} />}
          {step === "cb" && <ChildBenefitStep {...props} />}
          <div className="ob-nav">
            <button type="button" className="ob-btn" onClick={back}>Back</button>
            <button type="submit" className="ob-btn ob-btn--primary">
              {fromReview ? "Save and go back to review" : idx === order.length - 1 ? "Check your answers" : "Continue"}
            </button>
          </div>
        </form>
        <LivePreview result={result} inputs={inputs} meta={meta} />
      </div>
    </main>
  );
}
