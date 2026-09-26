/**
 * controls.tsx — the small building blocks of the guided setup: a money input
 * that accepts what people type, a labelled field with tap-to-open help, and
 * the choice cards, pills and chips used instead of bare checkboxes.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { formatMoney, parseMoney } from "./model";

/**
 * A £ text box: takes "45,000" or "£45000", shows thousands separators once
 * you leave it, and never changes value when the page scrolls.
 */
export function MoneyInput({
  id, value, onChange, placeholder, label, describedBy, showZero = false, invalid = false,
}: {
  id?: string;
  value: number;
  /** Called on every keystroke with the parsed number and whether anything was typed */
  onChange: (value: number, typed: boolean) => void;
  placeholder?: string;
  /** aria-label, for inputs without a visible <label for> */
  label?: string;
  describedBy?: string;
  /** Show a typed 0 as "0" rather than blank */
  showZero?: boolean;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (showZero && value === 0 ? "0" : formatMoney(value));
  return (
    <div className="ob-money">
      <span aria-hidden="true">£</span>
      <input
        id={id}
        className="ob-input"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onFocus={() => setDraft(shown)}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(parseMoney(e.target.value), e.target.value.trim() !== "");
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

/** "Where to find this" / "Why we ask": opens on tap, so it works on phones. */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="ob-disclosure">
      <summary>{summary}</summary>
      <p>{children}</p>
    </details>
  );
}

/**
 * A labelled field. The render prop gets the input id and the ids of the hint
 * and error, so the input can point at them with aria-describedby.
 */
export function Field({
  label, hint, where, why, error, aside, children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  where?: ReactNode;
  why?: ReactNode;
  error?: string;
  /** Something to show beside the label, e.g. a per year / per month switch */
  aside?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ob-field">
      <div className="ob-row" style={{ justifyContent: "space-between" }}>
        <label htmlFor={id} className="ob-label">{label}</label>
        {aside}
      </div>
      {children({ id, describedBy, invalid: !!error })}
      {hint && <span id={hintId} className="ob-hint">{hint}</span>}
      {error && <p id={errorId} className="ob-error" role="alert">{error}</p>}
      {where && <Disclosure summary="Where to find this">{where}</Disclosure>}
      {why && <Disclosure summary="Why we ask">{why}</Disclosure>}
    </div>
  );
}

export function ChoiceCard({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) {
  return (
    <button type="button" className="ob-choice" aria-pressed={on} onClick={onClick}>
      <strong>{title}</strong>
      {sub && <span>{sub}</span>}
    </button>
  );
}

export function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ob-pill" aria-pressed={on} onClick={onClick}>{children}</button>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="ob-chip" aria-pressed={on} onClick={onClick}>
      <span aria-hidden="true">{on ? "✓ " : "+ "}</span>{children}
    </button>
  );
}

/** A yes/no question answered with two pills (null = not answered yet). */
export function YesNo({
  question, value, onChange, yes = "Yes", no = "No", hint,
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yes?: string;
  no?: string;
  hint?: ReactNode;
}) {
  return (
    <fieldset className="ob-fieldset">
      <legend>{question}</legend>
      {hint && <p className="ob-hint" style={{ marginTop: -6 }}>{hint}</p>}
      <div className="ob-row">
        <Pill on={value === true} onClick={() => onChange(true)}>{yes}</Pill>
        <Pill on={value === false} onClick={() => onChange(false)}>{no}</Pill>
      </div>
    </fieldset>
  );
}

export function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="ob-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}
