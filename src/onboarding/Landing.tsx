/**
 * Landing.tsx — what someone sees first: what the tool does, what they'll
 * need, and two ways in (their own details, or an example family).
 */

import { getTaxYearConfig } from "../engine-src/index";
import type { TaxYear } from "../engine-src/index";

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const NEEDS = [
  { title: "Your salary and any bonus", where: "Contract, offer letter or a recent payslip" },
  { title: "How you pay into a pension", where: "Payslip, or your pension provider’s app" },
  { title: "Your partner’s pay, if you have one", where: "A rough figure is fine" },
  { title: "Your children’s dates of birth", where: "Decides which free hours apply" },
  { title: "Roughly what childcare costs", where: "Nursery invoices or monthly bank payments" },
];

const HOW = [
  { title: "Tell us about your family", body: "a few short steps" },
  { title: "See your position", body: "what you can claim and what you’re losing" },
  { title: "Get options", body: "ranked by how much they save" },
];

function Tick() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="#E6EEF8" />
      <path d="M6.5 11.5l3 3 6-6.5" stroke="#1D4E89" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function Landing({
  taxYear, savedAt, onStart, onExample, onResume, onDiscard,
}: {
  taxYear: TaxYear;
  /** When there are saved answers on this device */
  savedAt: string | null;
  onStart: () => void;
  onExample: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const cfg = getTaxYearConfig(taxYear);
  const cb = cfg.childBenefit.firstChildWeekly * 52;
  const schemes = [
    {
      tag: `Up to ${money(cfg.tfc.maxTopUpPerChildPerYear)} per child a year`, title: "Tax-Free Childcare",
      body: "The government adds £2 for every £8 you pay your nursery, childminder or holiday club.",
      cliff: `Lost entirely if either parent’s income goes over ${money(cfg.freeHours.maximumANIThreshold)}.`,
    },
    {
      tag: "Worth thousands a year", title: "30 hours free childcare",
      body: "Funded hours in term time from 9 months old until your child starts school.",
      cliff: `Lost if either parent goes over ${money(cfg.freeHours.maximumANIThreshold)} — £1 over is enough.`,
    },
    {
      tag: `Up to ${money(cb)} a year for one child`, title: "Child Benefit",
      body: `Paid for every child. The higher earner pays some or all of it back above ${money(cfg.hicbc.startThreshold)}.`,
      cliff: `All paid back once income reaches ${money(cfg.hicbc.fullClawbackThreshold)}.`,
    },
  ];
  const savedDate = savedAt ? new Date(savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "";

  return (
    <main className="ob-page" id="main">
      {savedAt && (
        <section className="ob-resume" aria-label="Saved answers">
          <span><strong>Welcome back.</strong> You have answers saved on this device from {savedDate}.</span>
          <div className="ob-row">
            <button type="button" className="ob-link" onClick={onDiscard}>Delete them</button>
            <button type="button" className="ob-btn ob-btn--primary" onClick={onResume}>Carry on where I left off</button>
          </div>
        </section>
      )}

      <section className="ob-hero">
        <div className="ob-stack" style={{ gap: 20 }}>
          <p className="ob-kicker">For UK parents</p>
          <h1 className="ob-display">Is earning over £100,000 costing your family childcare support?</h1>
          <p className="ob-hero-lede">
            In about five minutes, see what your family can claim, what you might be losing, and the simplest ways to get it back.
          </p>
          <div className="ob-row">
            <button type="button" className="ob-btn ob-btn--primary ob-btn--big" onClick={onStart}>Start with my details</button>
            <button type="button" className="ob-btn ob-btn--big" onClick={onExample}>See an example family</button>
          </div>
          <p className="ob-row ob-hint" style={{ gap: 8, flexWrap: "nowrap" }}>
            <Lock />
            Everything is worked out in your browser. Nothing is sent to or stored on a server.
          </p>
        </div>
        <div className="ob-card ob-stack" style={{ gap: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>What you’ll need</h2>
          <ul className="ob-needs">
            {NEEDS.map((n) => (
              <li key={n.title}>
                <Tick />
                <span><strong>{n.title}</strong><br /><span className="ob-hint">{n.where}</span></span>
              </li>
            ))}
          </ul>
          <p className="ob-note ob-note--info">Don’t have everything to hand? Estimates are fine. You can change any answer later.</p>
        </div>
      </section>

      <section aria-labelledby="schemes-h">
        <h2 id="schemes-h" className="sr-only">The support this tool checks</h2>
        <div className="ob-schemes">
          {schemes.map((s) => (
            <article key={s.title} className="ob-card ob-scheme">
              <span className="ob-kicker" style={{ textTransform: "none", letterSpacing: 0 }}>{s.tag}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <p className="ob-hint">{s.cliff}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="sr-only">How it works</h2>
        <ol className="ob-how">
          {HOW.map((h, i) => (
            <li key={h.title}>
              <span className="ob-how-n" aria-hidden="true">{i + 1}</span>
              <span><strong>{h.title}</strong> — {h.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="ob-fineprint">
        Planning help, not financial advice. Rules are for England; Scottish income tax is supported. Figures use {taxYear} rates.
      </p>
    </main>
  );
}
