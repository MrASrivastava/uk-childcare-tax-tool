/**
 * App.tsx — UK Childcare Tax Tool
 *
 * Flow: landing page → guided setup (src/onboarding) → check your answers →
 * results. The results keep three tabs: what you can claim (eligibility),
 * ways to improve (optimise) and how each £1 is taxed (marginal-rate chart).
 * "Edit all details" reuses the full forms in src/forms/DetailForms.tsx.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ComposedChart,
  Line,
} from "recharts";
import {
  calculate,
  createEmptyParentIncome,
  rsuVestDateForTaxYear,
  getTaxYearConfig,
  taxYearForDate,
  CONFIGURED_TAX_YEARS,
  LATEST_CONFIGURED_TAX_YEAR,
} from "./engine-src/index";
import { buildTooltips } from "./tooltips";
import { ParentNamesContext, TooltipContext, defaultTaxYear, fmt, useParentNames, useTT } from "./ui/context";
import { Tip } from "./ui/fields";
import { Landing } from "./onboarding/Landing";
import { SetupFlow } from "./onboarding/SetupFlow";
import { EditAll, Review } from "./onboarding/Review";
import { ResultsSummary } from "./onboarding/ResultsSummary";
import { emptyHousehold, emptyMeta, stepOrder, syncMeta, toEngineInputs } from "./onboarding/model";
import type { Mode, SetupMeta, StepId } from "./onboarding/model";
import { clearSession, loadSession, saveSession } from "./onboarding/storage";
import type { SavedSession } from "./onboarding/storage";
import "./onboarding/onboarding.css";
import { generateReport } from "./generatePDF";
import type {
  HouseholdInputs,
  ParentIncome,
  CalculationResult,
  FreeHoursChildResult,
  OptimisationRecommendation,
  ANIBreakdown,
  PensionCapacity,
  TaxYear,
} from "./engine-src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ChartParent = "A" | "B";

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip component + content dictionary
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Constants & formatters
// ─────────────────────────────────────────────────────────────────────────────



const STATUS_ICON: Record<string, string> = {
  eligible: "✓",
  at_risk: "⚠",
  not_eligible: "✗",
};

const LEVER_NAMES: Record<string, string> = {
  salary_sacrifice_pension: "Salary sacrifice pension",
  personal_pension_sipp: "Personal pension / SIPP",
  gift_aid: "Gift Aid donation",
  ev_salary_sacrifice: "EV salary sacrifice",
  cycle_to_work: "Cycle-to-work scheme",
  bonus_deferral: "Defer bonus",
  isa_migration: "Move savings to ISA",
  income_redistribution: "Redistribute income between partners",
};

// ─────────────────────────────────────────────────────────────────────────────
// The example family ("See an example family"): near the £100k limit
// ─────────────────────────────────────────────────────────────────────────────

function exampleHousehold(taxYear: TaxYear): HouseholdInputs {
  return {
    taxYear,
    parentA: {
      ...createEmptyParentIncome("Alex"),
      grossSalary: 95_000,
      bonus: { expectedThisYear: 8_000, isDiscretionary: true, paymentMonth: 12 },
      savingsInterestNonISA: 2_000,
    },
    parentB: { ...createEmptyParentIncome("Sam"), grossSalary: 38_000 },
    children: [{ dateOfBirth: "2024-01-15", isDisabled: false, childcareBill: { annual: 15_000 } }],
    childBenefitRegistered: true,
    childBenefitPaymentsElected: true,
    jurisdiction: "england",
    estimatedAnnualChildcareSpend: 0,
  };
}

const EXAMPLE_META: SetupMeta = {
  ...emptyMeta(),
  couple: true,
  A: { salaryEntered: true, period: "year", pension: "none", chips: ["sav"] },
  B: { salaryEntered: true, period: "year", pension: "none", chips: [] },
  rateKnown: false,
  exclusionsAnswer: false,
  cbRegistered: true,
  cbReceiving: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Low-level design primitives
// ─────────────────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "#fff",
    border: "1px solid #e8eaf0",
    borderRadius: 12,
    padding: "16px 18px",
    marginBottom: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  } as React.CSSProperties,
  sectionTitle: {
    fontWeight: 700,
    fontSize: 12,
    color: "#64748b",
    marginBottom: 10,
    marginTop: 6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  } as React.CSSProperties,
  metricBox: {
    background: "#f8fafc",
    border: "1px solid #e8eaf0",
    borderRadius: 8,
    padding: "10px 12px",
  } as React.CSSProperties,
} as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={S.sectionTitle}>{children}</div>;
}

function Pill({ status, label }: { status: string; label: string }) {
  const palettes: Record<string, { bg: string; text: string; border: string }> = {
    eligible:     { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
    at_risk:      { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
    not_eligible: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
  };
  const p = palettes[status] ?? { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" };
  return (
    <span style={{
      background: p.bg,
      color: p.text,
      border: `1px solid ${p.border}`,
      borderRadius: 20,
      padding: "2px 9px",
      fontSize: 11,
      fontWeight: 700,
      whiteSpace: "nowrap",
      letterSpacing: "0.01em",
    }}>
      {STATUS_ICON[status] ?? "–"} {label}
    </span>
  );
}

function MetricGrid({
  items,
}: {
  items: { label: string; value: string; colour?: string; tooltip?: string }[];
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
      gap: 8,
      marginBottom: 8,
    }}>
      {items.map(({ label, value, colour, tooltip }) => (
        <div key={label} style={{ ...S.metricBox, display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", alignItems: "center" }}>
            {label}{tooltip && <Tip text={tooltip} />}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: colour ?? "#1e293b", lineHeight: 1 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form primitives
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Parent income form — complete with EV sacrifice and P11D fields
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Children form
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Household settings fields (shared by the inputs tab and the sidebar)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// At-risk alert banner
// ─────────────────────────────────────────────────────────────────────────────

function AtRiskBanners({ result }: { result: CalculationResult }) {
  if (result.atRiskThresholds.length === 0) return null;
  return (
    <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {result.atRiskThresholds.map((t, i) => (
        <div key={i} style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderLeft: "4px solid #f59e0b",
          borderRadius: 10,
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ background: "#f59e0b", color: "#fff", borderRadius: 4, width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>!</span>
              {t.thresholdLabel}
            </div>
            <div style={{ fontSize: 11, color: "#b45309", marginTop: 3 }}>
              {t.parentLabel} is only <strong>{fmt(t.currentGap)}</strong> below the threshold.{" "}
              At risk: {t.schemesAtRisk.join(", ")}.
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#b45309", lineHeight: 1 }}>{fmt(t.potentialAnnualLossGBP)}</div>
            <div style={{ fontSize: 10, color: "#d97706", marginTop: 2 }}>at stake / year</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ANI waterfall breakdown
// ─────────────────────────────────────────────────────────────────────────────

function ANIWaterfall({ ani, label }: { ani: ANIBreakdown; label: string }) {
  const TT = useTT();
  const [open, setOpen] = useState(false);

  const addItems = [
    { l: "Base salary (post-sacrifice)", v: ani.postSacrificeSalary },
    { l: "Bonus", v: ani.bonusIncome },
    { l: "RSU vest income", v: ani.rsuIncome },
    { l: "Benefits in kind (P11D)", v: ani.biKIncome },
    { l: "Sacrificed benefits (taxable value)", v: ani.opraTaxableValue },
    { l: "Cash allowances", v: ani.cashAllowances },
    { l: "Self-employment profit", v: ani.selfEmploymentProfit },
    { l: "Net rental income", v: ani.rentalIncomeNet },
    { l: "Non-ISA savings interest", v: ani.savingsInterestNonISA },
    { l: "Non-ISA dividends", v: ani.dividendsNonISA },
    { l: "Pension income", v: ani.pensionIncomeGross },
    { l: "Other taxable income", v: ani.otherTaxableIncome },
  ].filter((x) => x.v !== 0);

  const deductItems = [
    { l: "Salary sacrifice (total)", v: ani.totalSalarySacrifice },
    { l: "Net pay pension contributions", v: ani.netPayPensionContributions },
    { l: "Gift Aid deduction (grossed up)", v: ani.step2GiftAidDeduction },
    { l: "Relief-at-source pension (grossed up)", v: ani.step3PensionDeduction },
  ].filter((x) => x.v !== 0);

  const over = ani.distanceToPATaperStart < 0;
  const gap = Math.abs(ani.distanceToPATaperStart);

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${over ? "#fca5a5" : "#e5e7eb"}`,
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
            {label} — Adjusted Net Income
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: over ? "#dc2626" : "#111827",
            }}
          >
            {fmt(ani.adjustedNetIncome)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 12,
              color: over ? "#dc2626" : "#16a34a",
              fontWeight: 500,
            }}
          >
            {over
              ? `${fmt(gap)} over £100k limit`
              : `${fmt(gap)} below £100k limit`}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {open ? "▲ hide breakdown" : "▼ show breakdown"} <Tip text={TT.ani} />
          </div>
        </div>
      </div>

      {open && (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: "1px solid #f3f4f6",
            background: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "8px 0 4px",
            }}
          >
            Step 1 — income
          </div>
          {addItems.map(({ l, v }) => (
            <div
              key={l}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "3px 0",
                borderBottom: "1px solid #f3f4f6",
                color: "#374151",
              }}
            >
              <span>{l}</span>
              <span style={{ fontWeight: 500, color: "#16a34a" }}>+{fmt(v)}</span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              padding: "4px 0",
              fontWeight: 600,
            }}
          >
            <span>Step 1 net income</span>
            <span>{fmt(ani.step1NetIncome)}</span>
          </div>

          {deductItems.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "8px 0 4px",
                }}
              >
                Steps 2–3 — deductions
              </div>
              {deductItems.map(({ l, v }) => (
                <div
                  key={l}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    padding: "3px 0",
                    borderBottom: "1px solid #f3f4f6",
                    color: "#374151",
                  }}
                >
                  <span>{l}</span>
                  <span style={{ fontWeight: 500, color: "#dc2626" }}>−{fmt(v)}</span>
                </div>
              ))}
            </>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              padding: "8px 0 0",
              fontWeight: 700,
              borderTop: "1px solid #e5e7eb",
              marginTop: 4,
            }}
          >
            <span>Adjusted Net Income</span>
            <span style={{ color: over ? "#dc2626" : "#111827" }}>
              {fmt(ani.adjustedNetIncome)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pension capacity panel
// ─────────────────────────────────────────────────────────────────────────────

function PensionCapacityPanel({
  capacity,
}: {
  capacity: PensionCapacity;
}) {
  const [open, setOpen] = useState(false);
  if (capacity.totalContributionsThisYear === 0 && capacity.remainingHeadroomThisYear === capacity.annualAllowance) {
    return null; // Nothing meaningful to show if no contributions
  }
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
            {capacity.parentLabel} — Pension capacity
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>
            {fmt(capacity.remainingHeadroomThisYear)} remaining this year
            {capacity.carryForwardAvailable !== null &&
              ` · ${fmt(capacity.carryForwardAvailable)} carry-forward available`}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</div>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid #f3f4f6", background: "#f9fafb" }}>
          <MetricGrid
            items={[
              { label: capacity.taperedAAApplies ? "Annual Allowance (tapered)" : "Annual Allowance", value: fmt(capacity.annualAllowance), colour: capacity.mpaaApplies || capacity.taperedAAApplies ? "#dc2626" : undefined },
              { label: "Pension input this year", value: fmt(capacity.totalContributionsThisYear) },
              ...(capacity.annualAllowanceCharge > 0
                ? [{ label: "Annual Allowance charge", value: fmt(capacity.annualAllowanceCharge), colour: "#dc2626" }]
                : []),
              { label: "Remaining headroom", value: fmt(capacity.remainingHeadroomThisYear), colour: "#16a34a" },
              ...(capacity.carryForwardAvailable !== null
                ? [{ label: "Carry-forward (3yr)", value: fmt(capacity.carryForwardAvailable), colour: "#4f46e5" }]
                : []),
              ...(capacity.maxAdditionalContribution !== null
                ? [{ label: "Max additional contribution", value: fmt(capacity.maxAdditionalContribution), colour: "#4f46e5" }]
                : []),
            ]}
          />
          {capacity.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 4, padding: "4px 8px", marginBottom: 4 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Free hours child row
// ─────────────────────────────────────────────────────────────────────────────

function FreeHoursRow({ child }: { child: FreeHoursChildResult }) {
  if (child.ageGroup === "school_age_or_over") return null;
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>
            Child {child.childIndex + 1} — born {child.childDateOfBirth}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
            {child.ageGroup === "under_9_months"
              ? `Not yet eligible — entitlement begins ${child.eligibilityStartDate}`
              : `${child.workingParentHoursPerWeek}hrs/wk working parent · ${child.universalHoursPerWeek}hrs/wk universal`}
          </div>
          {child.ageGroup !== "under_9_months" && child.workingParentEligibility.status !== "eligible" && (
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
              {child.workingParentEligibility.reason.slice(0, 80)}…
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
          <Pill
            status={child.workingParentEligibility.status}
            label={`${child.workingParentHoursPerWeek}hrs/wk`}
          />
          {child.workingParentAnnualValue > 0 && (
            <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>
              {fmt(child.workingParentAnnualValue)}/yr
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible scheme card
// ─────────────────────────────────────────────────────────────────────────────

function SchemeCard({
  title,
  subtitle,
  status,
  value,
  valueLabel,
  children,
}: {
  title: string;
  subtitle: string;
  status: string;
  value: string;
  valueLabel: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const borderAccent = status === "eligible" ? "#16a34a" : status === "at_risk" ? "#f59e0b" : "#ef4444";
  return (
    <div style={{
      border: "1px solid #e8eaf0",
      borderRadius: 12,
      marginBottom: 10,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      borderTop: `3px solid ${borderAccent}`,
    }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "14px 16px", background: "#fff", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{title}</span>
            <Pill status={status} label={status === "eligible" ? "Eligible" : status === "at_risk" ? "At risk" : "Not eligible"} />
          </div>
          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>{subtitle}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>{value}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>{valueLabel}</div>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{open ? "▲ hide" : "▼ details"}</div>
        </div>
      </div>
      {open && children && (
        <div style={{ padding: "12px 16px 14px", background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility panel
// ─────────────────────────────────────────────────────────────────────────────

function EligibilityPanel({ result }: { result: CalculationResult }) {
  const TT = useTT();
  const names = useParentNames();
  const { parentA, parentB, tfc, hicbc, freeHours, householdSummary } = result;

  const freeHoursStatus = freeHours.children.some(
    (c) => c.workingParentEligibility.status === "eligible"
  )
    ? "eligible"
    : freeHours.children.some(
        (c) => c.workingParentEligibility.status === "at_risk"
      )
    ? "at_risk"
    : "not_eligible";

  const cbStatus =
    hicbc.hicbcCharge === 0
      ? "eligible"
      : hicbc.retentionFraction < 1
      ? "at_risk"
      : "not_eligible";

  return (
    <div>
      <AtRiskBanners result={result} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 6 }}>
        <div style={S.sectionTitle as React.CSSProperties}><span style={{ margin: 0 }}>Adjusted Net Income</span></div>
        <Tip text={TT.ani} />
      </div>
      <ANIWaterfall ani={parentA.ani} label={names.A} />
      {parentB && <ANIWaterfall ani={parentB.ani} label={names.B} />}

      <SectionTitle>Scheme Eligibility</SectionTitle>

      <SchemeCard
        title="30-hour Free Childcare"
        subtitle="Working parent entitlement · England · from September 2025"
        status={freeHoursStatus}
        value={fmt(freeHours.totalWorkingParentAnnualValue)}
        valueLabel="estimated annual value"
      >
        {freeHours.children.map((c) => (
          <FreeHoursRow key={c.childIndex} child={c} />
        ))}
      </SchemeCard>

      <SchemeCard
        title="Tax-Free Childcare"
        subtitle="Government adds £2 for every £8 you pay (20% of the bill) · max £2,000/child/year"
        status={tfc.eligible.status}
        value={fmt(tfc.maxPossibleTopUpAnnual)}
        valueLabel="max annual top-up"
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
          {tfc.eligible.reason}
        </div>
        <MetricGrid
          items={[
            { label: "Eligible children", value: `${tfc.eligibleChildCount}` },
            { label: "Max top-up / year", value: fmt(tfc.maxPossibleTopUpAnnual) },
            { label: "Estimated actual top-up", value: fmt(tfc.estimatedActualTopUpAnnual) },
          ]}
        />
        {tfc.atRisk && (
          <div style={{ padding: "6px 10px", background: "#fef3c7", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
            ⚠ Only {fmt(tfc.eligible.thresholdGapGBP)} below the cliff — at risk from bonus or RSU vesting
          </div>
        )}
      </SchemeCard>

      <SchemeCard
        title="Child Benefit"
        subtitle="High Income Child Benefit Charge applies above £60,000 ANI"
        status={cbStatus}
        value={fmt(hicbc.netChildBenefitAnnual)}
        valueLabel="net annual benefit"
      >
        <MetricGrid
          items={[
            { label: "Gross CB", value: fmt(hicbc.grossChildBenefitAnnual), tooltip: TT.childBenefit },
            {
              label: "HICBC charge",
              value: fmt(hicbc.hicbcCharge),
              tooltip: TT.hicbc,
              colour: hicbc.hicbcCharge > 0 ? "#dc2626" : undefined,
            },
            {
              label: "% clawed back",
              value: `${(hicbc.retentionFraction * 100).toFixed(0)}%`,
            },
            { label: "Higher earner ANI", value: fmt(hicbc.higherEarnerANI) },
          ]}
        />
        <div style={{ fontSize: 12, padding: "7px 10px", background: "#fff", borderRadius: 6, color: "#374151", border: "1px solid #e5e7eb" }}>
          {hicbc.recommendationReason}
        </div>
        {hicbc.selfAssessmentRequired && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>
            ⚠ Declare the HICBC on your Self Assessment return
          </div>
        )}
        {hicbc.payeOptionAvailable && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#b45309" }}>
            ⚠ HICBC is payable — you can pay it through your PAYE tax code using HMRC's online service
          </div>
        )}
      </SchemeCard>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 6 }}>
        <div style={{ ...S.sectionTitle }}>Pension Capacity</div>
        <Tip text={TT.pensionCapacity} />
      </div>
      <PensionCapacityPanel capacity={parentA.pensionCapacity} />
      {parentB && <PensionCapacityPanel capacity={parentB.pensionCapacity} />}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 6 }}>
        <div style={{ ...S.sectionTitle }}>Total Household Position</div>
        <Tip text={TT.takeHome} />
      </div>
      <MetricGrid
        items={[
          { label: `${names.A} take-home`, value: fmt(householdSummary.parentANetTakeHome) },
          ...(parentB
            ? [{ label: `${names.B} take-home`, value: fmt(householdSummary.parentBNetTakeHome) }]
            : []),
          { label: "Net Child Benefit", value: fmt(householdSummary.netChildBenefit) },
          { label: "TFC top-up", value: fmt(householdSummary.tfcTopUp) },
          { label: "Free hours value", value: fmt(householdSummary.freeHoursAnnualValue) },
        ]}
      />
      <div style={{ background: "linear-gradient(135deg, #0f172a, #1e3a5f)", borderRadius: 12, padding: "18px 20px", color: "#fff", boxShadow: "0 4px 16px rgba(15,23,42,0.2)" }}>
        <div style={{ fontSize: 11, opacity: 0.5, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 6 }}>Total household net income + benefits</div>
        <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1 }}>
          {fmt(householdSummary.totalHouseholdNetPosition)}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { l: `${names.A} take-home`, v: householdSummary.parentANetTakeHome },
            householdSummary.parentBNetTakeHome > 0 ? { l: `${names.B} take-home`, v: householdSummary.parentBNetTakeHome } : null,
            { l: "Child Benefit (net)", v: householdSummary.netChildBenefit },
            { l: "TFC top-up", v: householdSummary.tfcTopUp },
            { l: "Free hours value", v: householdSummary.freeHoursAnnualValue },
          ].filter(Boolean).map((item) => item && (
            <div key={item.l}>
              <div style={{ fontSize: 10, opacity: 0.5 }}>{item.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>{fmt(item.v)}</div>
            </div>
          ))}
        </div>
      </div>

      {result.inputWarnings.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {result.inputWarnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "5px 10px", marginBottom: 4 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimise panel
// ─────────────────────────────────────────────────────────────────────────────

function RecCard({ rec }: { rec: OptimisationRecommendation }) {
  const TT = useTT();
  const [open, setOpen] = useState(false);
  const priC = rec.priority === "high" ? "#dc2626" : rec.priority === "medium" ? "#d97706" : "#2563eb";
  const priBg = rec.priority === "high" ? "#fef2f2" : rec.priority === "medium" ? "#fffbeb" : "#eff6ff";
  const isProactive = rec.kind === "protective" || rec.aniReductionRequired === 0;

  return (
    <div style={{
      border: "1px solid #e8eaf0",
      borderRadius: 12,
      marginBottom: 10,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
      background: "#fff",
    }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "14px 16px", cursor: "pointer" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Priority + parent label row */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: priC, background: priBg, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
                {rec.priority}
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{rec.parentLabel}</span>
              {rec.schemesRestored.length > 0 && (
                <span style={{ fontSize: 11, color: "#475569", background: "#f1f5f9", borderRadius: 4, padding: "1px 6px" }}>
                  {rec.schemesRestored.slice(0, 2).join(" · ")}
                </span>
              )}
            </div>
            {/* Lever name */}
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
              {LEVER_NAMES[rec.lever] ?? rec.lever}
            </div>
            {/* Action required */}
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
              {isProactive ? "Protect existing eligibility" : (
                <>Contribute <strong>{fmt(rec.actionRequired)}</strong> {rec.actionUnit} · ANI ↓ {fmt(rec.aniReductionRequired)}</>
              )}
            </div>
          </div>

          {/* Net gain */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {!isProactive ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 800, color: rec.netAnnualGain >= 0 ? "#16a34a" : "#dc2626", lineHeight: 1 }}>
                  {rec.netAnnualGain >= 0 ? "+" : ""}{fmt(rec.netAnnualGain)}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>net / year</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#d97706", lineHeight: 1 }}>
                  {fmt(rec.annualBenefitRestored)}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>protected / year</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "0 16px 14px", background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 10, lineHeight: 1.6, paddingTop: 10 }}>
            {rec.leverDescription}
          </div>
          <MetricGrid items={[
            { label: "ANI reduction", value: fmt(rec.aniReductionRequired), tooltip: TT.aniReduction },
            { label: "Action required", value: `${fmt(rec.actionRequired)} ${rec.actionUnit}` },
            { label: isProactive ? "Value protected" : "Benefit restored", value: fmt(rec.annualBenefitRestored), colour: "#16a34a", tooltip: TT.benefitRestored },
            { label: isProactive ? "Cash effect of buffer" : "Net annual gain", value: fmt(rec.netAnnualGain), colour: rec.netAnnualGain >= 0 ? "#16a34a" : "#dc2626", tooltip: TT.netGain },
            ...(rec.pensionPotIncrease ? [{ label: "Added to pension", value: fmt(rec.pensionPotIncrease), colour: "#4f46e5" }] : []),
          ]} />
          {rec.warnings.filter(Boolean).map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", marginTop: 6 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptimisePanel({ result }: { result: CalculationResult }) {
  const recs = result.optimisationRecommendations;
  if (recs.length === 0) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "#6b7280" }}>
        No optimisation opportunities detected. All eligible schemes are being claimed.
      </div>
    );
  }
  const isProtective = (r: OptimisationRecommendation) => r.kind === "protective" || r.aniReductionRequired === 0;
  const proactive = recs.filter(isProtective);
  const restorative = recs.filter((r) => !isProtective(r));

  return (
    <div>
      <AtRiskBanners result={result} />
      {restorative.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 6 }}>
            <div style={{ ...S.sectionTitle }}>Restore lost eligibility</div>
            <Tip text="These recommendations show the actions needed to get your ANI back below a threshold so you regain TFC, free childcare, or stop HICBC clawback. The 'net annual gain' includes the benefit restored minus the cost of the action." />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            Ranked by net annual gain to the household (pension pot growth shown separately). Expand each card for full details, costs, and warnings.
          </div>
          {restorative.slice(0, 6).map((r, i) => <RecCard key={i} rec={r} />)}
        </>
      )}
      {proactive.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 6 }}>
            <div style={{ ...S.sectionTitle }}>Protect existing eligibility</div>
            <Tip text="You are currently eligible but close to a threshold. These recommendations help you stay eligible even if income increases — for example from a bonus, RSU vest, or savings interest." />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            These schemes are currently eligible but at risk — a bonus, RSU vest, or savings interest increase could remove them.
          </div>
          {proactive.map((r, i) => <RecCard key={i} rec={r} />)}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marginal rate chart panel — redesigned for clarity
// ─────────────────────────────────────────────────────────────────────────────

// Zone definitions: each band in the ANI range
const RATE_ZONES = [
  { x1: 50, x2: 60,     bg: "rgba(16,185,129,0.07)",  border: "#10b981", label: "Below HICBC",  desc: "All major thresholds clear",          level: "safe" },
  { x1: 60, x2: 80,     bg: "rgba(245,158,11,0.09)",  border: "#f59e0b", label: "HICBC taper",  desc: "HICBC charge: 1% per £200 over £60k",  level: "warn" },
  { x1: 80, x2: 100,    bg: "rgba(239,68,68,0.08)",   border: "#ef4444", label: "Full HICBC",   desc: "HICBC fully charged — no further clawback",  level: "danger" },
  { x1: 100, x2: 125.14, bg: "rgba(124,58,237,0.1)",  border: "#7c3aed", label: "60% Trap",     desc: "TFC + free hours lost, PA shrinking", level: "critical" },
  { x1: 125.14, x2: 135, bg: "rgba(107,114,128,0.07)", border: "#9ca3af", label: "45% band",    desc: "Personal allowance gone",            level: "high" },
];

const ZONE_COLORS = { safe: "#10b981", warn: "#d97706", danger: "#ef4444", critical: "#7c3aed", high: "#6b7280" } as const;

const COMPONENTS = [
  { key: "it",    label: "Income tax",   color: "#3b82f6" },
  { key: "ni",    label: "NIC",          color: "#10b981" },
  { key: "pa",    label: "PA taper",     color: "#8b5cf6" },
  { key: "hicbc", label: "HICBC",        color: "#f59e0b" },
  { key: "fh",    label: "Free hours",   color: "#ef4444" },
  { key: "tfc",   label: "TFC loss",     color: "#f97316" },
];

// Custom tooltip for the chart
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number }) {
  if (!active || !payload?.length) return null;
  const total = payload.find((p) => p.name === "Total rate");
  const components = payload.filter((p) => p.name !== "Total rate" && p.value > 0);
  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#f1f5f9", minWidth: 180 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>ANI: £{label}k</div>
      {total && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontWeight: 700, fontSize: 14, color: "#f8fafc", paddingBottom: 6, borderBottom: "1px solid #334155", marginBottom: 6 }}>
          <span>Total effective rate</span>
          <span>{total.value}%</span>
        </div>
      )}
      {components.map((c) => (
        <div key={c.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: "#cbd5e1", marginBottom: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: "inline-block" }} />
            {c.name}
          </span>
          <span style={{ fontWeight: 500 }}>{c.value}%</span>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ result }: { result: CalculationResult }) {
  const TT = useTT();
  const names = useParentNames();
  const [activeParent, setActiveParent] = useState<ChartParent>("A");
  const [showComponents, setShowComponents] = useState(false);

  const chartData = useMemo(() => {
    const points =
      activeParent === "A"
        ? result.marginalRateChart.parentA
        : result.marginalRateChart.parentB ?? result.marginalRateChart.parentA;

    return points.map((d) => ({
      k: d.ani / 1000,
      it:    +(d.incomeTaxMarginalRate * 100).toFixed(1),
      ni:    +(d.nicMarginalRate * 100).toFixed(1),
      pa:    +(d.personalAllowanceTaperEffect * 100).toFixed(1),
      hicbc: +(d.hicbcWithdrawalRate * 100).toFixed(1),
      fh:    +(d.freeHoursBenefitLossRate * 100).toFixed(1),
      tfc:   +(d.tfcBenefitLossRate * 100).toFixed(1),
      total: +(d.totalEffectiveMarginalRate * 100).toFixed(1),
    }));
  }, [result, activeParent]);

  const currentANI =
    activeParent === "A"
      ? result.parentA.ani.adjustedNetIncome
      : result.parentB?.ani.adjustedNetIncome ?? result.parentA.ani.adjustedNetIncome;

  const crossover =
    activeParent === "A" ? result.crossoverANIByParent.parentA : result.crossoverANIByParent.parentB;

  const currentPoint = chartData.find((d) => d.k * 1000 >= currentANI) ?? chartData[chartData.length - 1];

  // Which zone is the user currently in?
  const currentZone = RATE_ZONES.slice().reverse().find((z) => currentANI / 1000 >= z.x1) ?? RATE_ZONES[0];
  type ZoneLevel = keyof typeof ZONE_COLORS;

  // Has a spike > 100% anywhere?
  const hasSpikeAbove100 = chartData.some((d) => d.total > 100);
  // Y-axis max: cap at 90 for readability (spike is annotated separately)
  const yMax = 90;

  return (
    <div style={{ fontFamily: "'Public Sans', system-ui, sans-serif" }}>

      {/* ── Parent toggle ───────────────────────────────────────────── */}
      {result.parentB && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["A", "B"] as ChartParent[]).map((p) => (
            <button
              key={p}
              onClick={() => setActiveParent(p)}
              style={{
                padding: "6px 18px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: activeParent === p ? "none" : "1px solid #e2e8f0",
                background: activeParent === p ? "#1e293b" : "#fff",
                color: activeParent === p ? "#fff" : "#475569",
                transition: "all 0.15s",
              }}
            >
              {p === "A" ? names.A : names.B}
            </button>
          ))}
        </div>
      )}

      {/* ── Zone strip ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {RATE_ZONES.map((z) => {
          const isActive = currentANI / 1000 >= z.x1 && currentANI / 1000 < z.x2;
          const c = ZONE_COLORS[z.level as keyof typeof ZONE_COLORS];
          return (
            <div key={z.label} style={{
              flex: "1 1 auto",
              padding: "8px 10px",
              borderRadius: 7,
              background: isActive ? z.bg.replace("0.07","0.18").replace("0.09","0.2").replace("0.08","0.18").replace("0.1","0.22") : "#f8fafc",
              border: `1.5px solid ${isActive ? ZONE_COLORS[z.level as keyof typeof ZONE_COLORS] : "#e2e8f0"}`,
              transition: "all 0.2s",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? c : "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                {isActive ? "▶ " : ""}{z.label}
              </div>
              <div style={{ fontSize: 10, color: isActive ? "#475569" : "#cbd5e1", lineHeight: 1.3 }}>
                £{z.x1}k – {z.x2 === 135 ? "£135k" : `£${z.x2}k`}
              </div>
              <div style={{ fontSize: 10, color: isActive ? "#475569" : "#c8d0db", lineHeight: 1.3, marginTop: 2, fontStyle: "italic" }}>
                {z.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Current ANI callout ──────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: currentZone.bg.replace("0.07","0.12").replace("0.09","0.14").replace("0.08","0.12").replace("0.1","0.14"),
        border: `1.5px solid ${ZONE_COLORS[currentZone.level as ZoneLevel]}40`,
        borderLeft: `4px solid ${ZONE_COLORS[currentZone.level as ZoneLevel]}`,
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 16,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: ZONE_COLORS[currentZone.level as ZoneLevel], textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Current ANI
          </span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", lineHeight: 1.1 }}>
            {fmt(currentANI)}
          </div>
        </div>
        <div style={{ width: 1, height: 36, background: "#e2e8f0" }} />
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 1 }}>
                {(() => {
                  const h = result.hicbc;
                  const hasChildren = h.grossChildBenefitAnnual > 0;
                  const registered = h.niCreditsPreserved;
                  const receiving = registered && h.hicbcCharge > 0;
                  if (currentANI > 125_140) return "Additional rate taxpayer — no personal allowance remaining";
                  if (currentANI > 100_000) {
                    const parts: string[] = [];
                    if (result.tfc.eligible.status === "not_eligible") parts.push("TFC ineligible");
                    if (result.freeHours.children.some(c => c.workingParentEligibility.status === "not_eligible")) parts.push("free childcare lost");
                    parts.push("60% effective rate in PA taper zone");
                    return parts.join(" · ");
                  }
                  if (currentANI > 80_000) {
                    if (!hasChildren) return "Above full HICBC threshold — no children with CB entitlement";
                    if (!registered) return "Not registered for Child Benefit — register to preserve NI credits";
                    if (receiving) return `Child Benefit fully clawed back — ${fmt(h.hicbcCharge)}/yr HICBC charge`;
                    return "Registered for CB, payments opted out — NI credits preserved, no HICBC";
                  }
                  if (currentANI > 60_000) {
                    if (!hasChildren) return "In HICBC taper zone — no children with CB entitlement";
                    if (!registered) return "In HICBC taper zone — register for CB to preserve NI credits";
                    if (receiving) return `${Math.round(h.retentionFraction * 100)}% of Child Benefit clawed back — ${fmt(h.hicbcCharge)}/yr HICBC`;
                    return "In HICBC taper zone — opted out of payments, NI credits preserved";
                  }
                  return "All major thresholds clear";
                })()}
              </div>
          {currentPoint && (
            <div style={{ fontSize: 18, fontWeight: 800, color: ZONE_COLORS[currentZone.level as ZoneLevel] }}>
              {currentPoint.total > 100 ? "100%+" : `${currentPoint.total}%`} effective rate
            </div>
          )}
        </div>
        {crossover !== null && currentANI > 100_000 && (
          <>
            <div style={{ width: 1, height: 36, background: "#e2e8f0", marginLeft: "auto" }} />
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: "#64748b" }}>Net position recovers at</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#16a34a" }}>{fmt(crossover)}</div>
            </div>
          </>
        )}
      </div>

      {/* ── Chart header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", display: "flex", alignItems: "center", gap: 5 }}>
          Effective marginal rate by ANI <Tip text={TT.effectiveRate} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasSpikeAbove100 && (
            <div style={{ fontSize: 11, color: "#ef4444", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 5, padding: "2px 8px" }}>
              ⚠ spike clipped to 90%
            </div>
          )}
          <button
            onClick={() => setShowComponents((v) => !v)}
            style={{
              fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: showComponents ? "#1e293b" : "#f1f5f9",
              color: showComponents ? "#fff" : "#475569",
              border: "none", borderRadius: 5, padding: "4px 10px",
              transition: "all 0.15s",
            }}
          >
            {showComponents ? "Show total only" : "Show components"}
          </button>
        </div>
      </div>

      {/* ── Main chart ───────────────────────────────────────────────── */}
      <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 8, bottom: 24, left: -10 }}>
            <defs>
              <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1e293b" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#1e293b" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="2 4" stroke="#f1f5f9" vertical={false} />

            {/* Zone backgrounds */}
            {RATE_ZONES.map((z) => (
              <ReferenceArea key={z.label} x1={z.x1} x2={Math.min(z.x2, 135)} fill={z.bg} />
            ))}

            {/* Threshold lines */}
            {[
              { x: 60,     label: "HICBC £60k",  c: "#f59e0b" },
              { x: 80,     label: "CB gone £80k", c: "#ef4444" },
              { x: 100,    label: "Cliff £100k",  c: "#7c3aed" },
              { x: 125.14, label: "PA gone",      c: "#dc2626" },
            ].map(({ x, label, c }) => (
              <ReferenceLine key={x} x={x} stroke={c} strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: label, position: "insideTopRight", fontSize: 9, fill: c, fontWeight: 600 }}
              />
            ))}

            {/* Current ANI marker */}
            <ReferenceLine
              x={currentANI / 1000}
              stroke="#1e293b"
              strokeWidth={2}
              label={{ value: "You", position: "insideTop", fontSize: 10, fill: "#1e293b", fontWeight: 700 }}
            />

            {/* Crossover */}
            {crossover !== null && currentANI > 100_000 && (
              <ReferenceLine x={crossover / 1000} stroke="#16a34a" strokeDasharray="6 3" strokeWidth={2}
                label={{ value: "Crossover", position: "insideTop", fontSize: 9, fill: "#16a34a", fontWeight: 700 }}
              />
            )}

            {/* Component stacked areas (optional) */}
            {showComponents && COMPONENTS.map((c) => (
              <Area
                key={c.key}
                type="monotone"
                dataKey={c.key}
                name={c.label}
                stackId="comp"
                stroke={c.color}
                fill={c.color}
                fillOpacity={0.18}
                strokeWidth={1}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}

            {/* Total rate line — always shown, capped at yMax for display */}
            <Line
              type="monotone"
              dataKey="total"
              name="Total rate"
              stroke="#1e293b"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "#1e293b" }}
              isAnimationActive={false}
              // Clip values above yMax visually by not hiding — recharts clips at domain
            />

            <XAxis
              dataKey="k"
              tickFormatter={(v: number) => `£${v}k`}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              label={{ value: "Adjusted Net Income", position: "insideBottom", offset: -14, fontSize: 11, fill: "#94a3b8" }}
            />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              domain={[0, yMax]}
            />
            <Tooltip content={<ChartTooltip />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Component breakdown bars at current ANI ──────────────────── */}
      {currentPoint && (
        <div style={{ background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0", padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Breakdown at {fmt(currentANI)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ...COMPONENTS.map((c) => {
                const tooltipMap: Record<string, string> = { it: TT.incomeTax, ni: TT.nic, pa: TT.paTaper, hicbc: TT.hicbcRate, fh: TT.freeHoursLoss, tfc: TT.tfcLoss };
                return { ...c, value: (currentPoint as Record<string, number>)[c.key] as number, tipText: tooltipMap[c.key] };
              }).filter((c) => c.value > 0),
              { key: "total", label: "Total effective rate", color: "#1e293b", value: currentPoint.total, tipText: TT.effectiveRate },
            ].map((c) => {
              const isTotal = c.key === "total";
              const pct = Math.min(c.value, 90); // cap bar width
              const tipText = (c as { tipText?: string }).tipText;
              return (
                <div key={c.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: isTotal ? "#1e293b" : "#475569", fontWeight: isTotal ? 700 : 500, display: "flex", alignItems: "center" }}>
                      {c.label}{tipText && <Tip text={tipText} />}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c.color }}>
                      {c.value > 100 ? "100%+" : `${c.value}%`}
                    </span>
                  </div>
                  <div style={{ height: isTotal ? 10 : 7, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      width: `${(pct / 90) * 100}%`,
                      height: "100%",
                      background: c.color,
                      borderRadius: 99,
                      opacity: isTotal ? 1 : 0.75,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Crossover or advice panel ────────────────────────────────── */}
      {crossover !== null && currentANI > 100_000 ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "4px solid #16a34a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#166534" }}>
  <span style={{ display: "flex", alignItems: "center", gap: 4 }}><strong>Crossover at {fmt(crossover)}</strong><Tip text={TT.crossover} /></span> — earning between £100,000 and this level
          leaves the household <em>worse off in total</em> than staying just below £100k, due to
          lost childcare support. Above {fmt(crossover)}, the household recovers.
        </div>
      ) : currentANI > 100_000 ? (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderLeft: "4px solid #d97706", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
          No crossover found within the modelled range (up to £135k). Pension contributions may be able to reduce ANI below £100,000 and restore eligibility.
        </div>
      ) : (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "4px solid #10b981", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#166534" }}>
          {(() => {
          const h = result.hicbc;
          if (currentANI <= 60_000) return "All major thresholds are clear. No HICBC, TFC and free childcare fully accessible.";
          if (currentANI <= 80_000) {
            if (h.grossChildBenefitAnnual === 0) return "In the HICBC taper zone, but no children are registered for Child Benefit.";
            if (!h.niCreditsPreserved) return "In the HICBC taper zone. Register for Child Benefit (even if you opt out of payments) to preserve NI credits.";
            if (h.hicbcCharge > 0) return `In the HICBC taper zone — ${Math.round(h.retentionFraction * 100)}% of Child Benefit is being clawed back. See Optimise tab to model pension contributions.`;
            return "In the HICBC taper zone, but payments are opted out. NI credits are preserved with no HICBC charge.";
          }
          return "ANI is below the childcare cliff. TFC and free childcare remain accessible.";
        })()}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
        <strong>Note:</strong> The spike at £101k is clipped to 90% on this chart. The true effective
        rate at that point can exceed 100% or more, as TFC top-ups and free childcare hours are lost
        in a single step for every £1 earned above £100,000.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Download PDF button
// ─────────────────────────────────────────────────────────────────────────────

function DownloadButton({ result }: { result: CalculationResult }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    // Yield to the browser to show the loading state, then generate
    await new Promise(r => setTimeout(r, 50));
    try {
      generateReport(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" className="ob-btn" onClick={handleClick} disabled={loading} aria-busy={loading}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: loading ? "wait" : "pointer" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      {loading ? "Preparing PDF…" : "Download PDF"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App shell: landing → guided setup → review → results
// ─────────────────────────────────────────────────────────────────────────────

type ResultTab = "eligibility" | "optimise" | "chart";

const RESULT_TABS: { id: ResultTab; label: string }[] = [
  { id: "eligibility", label: "What you can claim" },
  { id: "optimise", label: "Ways to improve" },
  { id: "chart", label: "How each £1 is taxed" },
];

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="8" fill="#1D4E89" />
      <path d="M9 19c2-5 4-8 6-8s4 3 6 8" stroke="#FBFAF7" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="15" cy="9" r="2" fill="#F2A541" />
    </svg>
  );
}

export default function App() {
  const [today] = useState(() => new Date());
  const [outOfDate] = useState(() => defaultTaxYear().outOfDate);
  const [inputs, setInputs] = useState<HouseholdInputs>(() => emptyHousehold(defaultTaxYear().year));
  const [meta, setMeta] = useState<SetupMeta>(emptyMeta);
  const [mode, setMode] = useState<Mode>("landing");
  const [step, setStep] = useState<StepId>("family");
  const [fromReview, setFromReview] = useState(false);
  const [example, setExample] = useState(false);
  const [saved, setSaved] = useState<SavedSession | null>(() => loadSession());
  const [tab, setTab] = useState<ResultTab>("eligibility");
  const tooltips = useMemo(() => buildTooltips(getTaxYearConfig(inputs.taxYear)), [inputs.taxYear]);
  const nameA = inputs.parentA.label;
  const nameB = inputs.parentB?.label ?? "Parent B";
  const names = useMemo(() => ({ A: nameA, B: nameB }), [nameA, nameB]);

  // Changing the tax year re-dates the RSU vests the forms created, which are
  // dated inside the selected year (see rsuVestDateForTaxYear).
  const setTaxYear = useCallback((year: TaxYear) => {
    setInputs((i) => {
      const oldDate = rsuVestDateForTaxYear(i.taxYear);
      const redate = (p: ParentIncome | null) =>
        p && {
          ...p,
          rsuVests: p.rsuVests.map((v) =>
            v.vestDate === oldDate ? { ...v, vestDate: rsuVestDateForTaxYear(year) } : v
          ),
        };
      return { ...i, taxYear: year, parentA: redate(i.parentA)!, parentB: redate(i.parentB) };
    });
  }, []);

  const update = useCallback((f: (i: HouseholdInputs) => HouseholdInputs) => setInputs(f), []);
  const updateMeta = useCallback((f: (m: SetupMeta) => SetupMeta) => setMeta(f), []);

  const result = useMemo<CalculationResult | null>(() => {
    if (mode === "landing") return null;
    try {
      return calculate(toEngineInputs(inputs, meta, today));
    } catch {
      return null;
    }
  }, [inputs, meta, mode, today]);

  // Keep the person's own answers on this device (never the example family).
  useEffect(() => {
    if (example || mode === "landing") return;
    saveSession({ inputs, meta, step, mode });
  }, [inputs, meta, step, mode, example]);

  // Start each page at the top, with focus on its heading.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
  }, [mode]);

  const startFresh = () => {
    clearSession();
    setSaved(null);
    setInputs(emptyHousehold(inputs.taxYear));
    setMeta(emptyMeta());
    setStep("family");
    setFromReview(false);
    setExample(false);
    setMode("setup");
  };
  const showExample = () => {
    setInputs(exampleHousehold(inputs.taxYear));
    setMeta(EXAMPLE_META);
    setExample(true);
    setTab("eligibility");
    setMode("results");
  };
  const resume = () => {
    if (!saved) return;
    setInputs(saved.inputs);
    setMeta(saved.meta);
    setStep(stepOrder(saved.meta).includes(saved.step) ? saved.step : "family");
    setFromReview(false);
    setExample(false);
    setMode(saved.mode);
  };
  const goHome = () => {
    setSaved(loadSession());
    setExample(false);
    setMode("landing");
  };
  const editStep = (s: StepId) => {
    setStep(s);
    setFromReview(true);
    setMode("setup");
  };
  const finishEditAll = () => {
    setMeta((m) => syncMeta(inputs, m));
    setMode("results");
  };

  return (
    <TooltipContext.Provider value={tooltips}>
    <ParentNamesContext.Provider value={names}>
    <div className="ob" style={{ minHeight: "100vh" }}>
      <a href="#main" className="ob-skip">Skip to content</a>
      <header className="ob-header">
        <div className="ob-header-in">
          <button type="button" className="ob-brand" onClick={goHome} aria-label="Childcare Tax Check — home">
            <Logo />
            <span>Childcare Tax Check</span>
          </button>
          <label className="ob-year">
            Tax year
            <select value={inputs.taxYear} onChange={(e) => setTaxYear(e.target.value as TaxYear)}>
              {CONFIGURED_TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {mode !== "landing" && (
            <div className="ob-row ob-header-actions">
              {!example && (
                <span className="ob-saved">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="#0F766E" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
                  Answers saved on this device
                </span>
              )}
              <button type="button" className="ob-link" onClick={goHome}>Back to start</button>
            </div>
          )}
        </div>
      </header>

      {outOfDate && (
        <div role="status" className="ob-banner">
          The current tax year ({taxYearForDate(new Date())}) isn’t configured yet, so this uses {LATEST_CONFIGURED_TAX_YEAR} rates. Results may be out of date.
        </div>
      )}
      {example && mode !== "landing" && (
        <div role="status" className="ob-banner">
          <span>
            <strong>You’re looking at an example family.</strong> Alex earns £95,000 plus an £8,000 bonus, Sam earns £38,000, and they have one toddler.
          </span>
          <button type="button" className="ob-btn" onClick={startFresh}>Start with my details</button>
        </div>
      )}

      {mode === "landing" && (
        <Landing taxYear={inputs.taxYear} savedAt={saved?.savedAt ?? null}
          onStart={startFresh} onExample={showExample} onResume={resume}
          onDiscard={() => { clearSession(); setSaved(null); }} />
      )}

      {mode === "setup" && (
        <SetupFlow inputs={inputs} meta={meta} step={step} fromReview={fromReview} today={today} result={result}
          update={update} updateMeta={updateMeta} onStep={setStep}
          onReview={() => { setFromReview(false); setMode("review"); }}
          onExit={goHome} />
      )}

      {mode === "review" && (
        <Review inputs={inputs} meta={meta} today={today} onChange={editStep}
          onEditAll={() => setMode("editall")} onResults={() => setMode("results")} />
      )}

      {mode === "editall" && (
        <EditAll inputs={inputs} meta={meta} update={update} updateMeta={updateMeta} onDone={finishEditAll} />
      )}

      {mode === "results" && (
        <main className="ob-page" id="main">
          {!result && (
            <div role="alert" className="ob-note ob-note--warn">
              Something in your answers stopped the calculation. Please check them with “Edit details”.
            </div>
          )}
          {result && (
            <ResultsSummary result={result} inputs={inputs}
              onEdit={() => setMode("review")} onEditAll={() => setMode("editall")}
              actions={<DownloadButton result={result} />} />
          )}
          {result && (
            <section aria-label="Detailed results">
              <div className="ob-tabs" role="tablist" aria-label="Detailed results">
                {RESULT_TABS.map(({ id, label }) => (
                  <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id}
                    aria-controls="results-panel" onClick={() => setTab(id)}>
                    {label}
                    {id !== "chart" && result.atRiskThresholds.length > 0 && (
                      <span className="ob-tab-count" aria-label={`${result.atRiskThresholds.length} warnings`}>
                        {result.atRiskThresholds.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div id="results-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="ob-results-panel">
                {tab === "eligibility" && <EligibilityPanel result={result} />}
                {tab === "optimise" && <OptimisePanel result={result} />}
                {tab === "chart" && <ChartPanel result={result} />}
              </div>
            </section>
          )}
          <p className="ob-fineprint" style={{ textAlign: "center" }}>
            Planning help, not financial or tax advice · Tax year {inputs.taxYear}.<br />
            Check important decisions with a qualified financial adviser or accountant.
          </p>
        </main>
      )}
    </div>
    </ParentNamesContext.Provider>
    </TooltipContext.Provider>
  );
}
