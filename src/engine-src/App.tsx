/**
 * App.tsx — UK Childcare Tax Tool (Phase 4 complete)
 *
 * Tabs: Inputs · Eligibility · Optimise · Marginal rates
 *
 * New in Phase 4:
 *   - ANI waterfall breakdown (all income components + deductions)
 *   - Pension capacity panel (headroom, carry-forward, MPAA warnings)
 *   - At-risk alert banners (from atRiskThresholds on the result)
 *   - Crossover point annotation on the chart
 *   - Parent B chart toggle
 *   - Complete input form: EV salary sacrifice, P11D BiK, cash allowances
 */

import { useState, useCallback, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ComposedChart,
  Bar,
} from "recharts";
import { calculate, createEmptyParentIncome } from "./engine-src/index";
import type {
  HouseholdInputs,
  ParentIncome,
  CalculationResult,
  ChildInfo,
  FreeHoursChildResult,
  OptimisationRecommendation,
  ANIBreakdown,
  PensionCapacity,
} from "./engine-src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "inputs" | "eligibility" | "optimise" | "chart";
type ChartParent = "A" | "B";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & formatters
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const STATUS_COLOUR: Record<string, string> = {
  eligible: "#16a34a",
  at_risk: "#d97706",
  not_eligible: "#dc2626",
};

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
// Default inputs (pre-loaded with a realistic near-cliff scenario)
// ─────────────────────────────────────────────────────────────────────────────

function defaultParentA(): ParentIncome {
  return {
    ...createEmptyParentIncome("Parent A"),
    grossSalary: 95_000,
    bonus: { expectedThisYear: 8_000, isDiscretionary: true },
    savingsInterestNonISA: 2_000,
  };
}

function defaultParentB(): ParentIncome {
  return {
    ...createEmptyParentIncome("Partner B"),
    grossSalary: 38_000,
  };
}

const DEFAULT_INPUTS: HouseholdInputs = {
  taxYear: "2025/26",
  parentA: defaultParentA(),
  parentB: defaultParentB(),
  children: [{ dateOfBirth: "2024-01-15", isDisabled: false }],
  childBenefitRegistered: true,
  childBenefitPaymentsElected: true,
  jurisdiction: "england",
  estimatedAnnualChildcareSpend: 15_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Low-level design primitives
// ─────────────────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 12,
  } as React.CSSProperties,
  sectionTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: "#111827",
    marginBottom: 10,
    marginTop: 4,
  } as React.CSSProperties,
  metricBox: {
    background: "#f3f4f6",
    borderRadius: 8,
    padding: "9px 11px",
  } as React.CSSProperties,
} as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={S.sectionTitle}>{children}</div>;
}

function Pill({ status, label }: { status: string; label: string }) {
  const c = STATUS_COLOUR[status] ?? "#6b7280";
  return (
    <span
      style={{
        background: c,
        color: "#fff",
        borderRadius: 4,
        padding: "2px 7px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {STATUS_ICON[status] ?? "–"} {label}
    </span>
  );
}

function MetricGrid({
  items,
}: {
  items: { label: string; value: string; colour?: string }[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
        gap: 8,
        marginBottom: 8,
      }}
    >
      {items.map(({ label, value, colour }) => (
        <div key={label} style={S.metricBox}>
          <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: colour ?? "#111827",
              marginTop: 2,
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form primitives
// ─────────────────────────────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  hint,
  step = 1000,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "#374151",
          marginBottom: 3,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex" }}>
        <span
          style={{
            background: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRight: "none",
            padding: "4px 7px",
            borderRadius: "5px 0 0 5px",
            fontSize: 12,
            color: "#9ca3af",
          }}
        >
          £
        </span>
        <input
          type="number"
          value={value}
          step={step}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            padding: "4px 7px",
            border: "1px solid #d1d5db",
            borderRadius: "0 5px 5px 0",
            fontSize: 12,
            outline: "none",
            minWidth: 0,
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 9,
        cursor: "pointer",
      }}
      onClick={() => onChange(!value)}
    >
      <div
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          background: value ? "#4f46e5" : "#d1d5db",
          position: "relative",
          transition: "background 0.18s",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: value ? 14 : 2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: "#fff",
            transition: "left 0.18s",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#374151", userSelect: "none" }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent income form — complete with EV sacrifice and P11D fields
// ─────────────────────────────────────────────────────────────────────────────

function ParentForm({
  parent,
  onChange,
  label,
}: {
  parent: ParentIncome;
  onChange: (p: ParentIncome) => void;
  label: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = useCallback(
    (patch: Partial<ParentIncome>) => onChange({ ...parent, ...patch }),
    [parent, onChange]
  );

  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#1f2937" }}
      >
        {label}
      </div>

      {/* Core employment income */}
      <NumField
        label="Gross salary (before sacrifice)"
        value={parent.grossSalary}
        onChange={(v) => set({ grossSalary: v })}
        hint="Annual gross, before any salary sacrifice"
      />
      <NumField
        label="Expected bonus this tax year"
        value={parent.bonus.expectedThisYear}
        onChange={(v) => set({ bonus: { ...parent.bonus, expectedThisYear: v } })}
      />
      <NumField
        label="RSU vesting value this tax year"
        step={5000}
        value={parent.rsuVests.reduce((s, r) => s + r.grossValue, 0)}
        onChange={(v) =>
          set({
            rsuVests:
              v > 0
                ? [{ vestDate: "2025-10-01", grossValue: v, employerNICTransferred: false }]
                : [],
          })
        }
        hint="Market value of shares at vest date"
      />

      {/* ANI deductions */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
          marginTop: 4,
        }}
      >
        ANI deductions
      </div>
      <NumField
        label="Salary sacrifice pension (annual gross)"
        value={parent.salarySacrifice.pension}
        onChange={(v) =>
          set({ salarySacrifice: { ...parent.salarySacrifice, pension: v } })
        }
        hint="Reduces ANI at Step 1 + saves NIC"
      />
      <NumField
        label="Personal pension / SIPP (net paid)"
        value={parent.personalPensionContributions.reliefAtSourceNet}
        onChange={(v) =>
          set({
            personalPensionContributions: {
              ...parent.personalPensionContributions,
              reliefAtSourceNet: v,
            },
          })
        }
        hint="Grossed up ÷ 0.8 → ANI deduction at Step 3"
      />
      <NumField
        label="Gift Aid donations (net)"
        step={100}
        value={parent.giftAidDonationsNet}
        onChange={(v) => set({ giftAidDonationsNet: v })}
        hint="÷ 0.8 → ANI deduction at Step 2"
      />

      {/* Investment/other income */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
          marginTop: 4,
        }}
      >
        Other income (adds to ANI)
      </div>
      <NumField
        label="Non-ISA savings interest"
        step={500}
        value={parent.savingsInterestNonISA}
        onChange={(v) => set({ savingsInterestNonISA: v })}
        hint="PSA reduces tax but NOT ANI — full amount counts"
      />
      <NumField
        label="Non-ISA dividends"
        step={500}
        value={parent.dividendsNonISA}
        onChange={(v) => set({ dividendsNonISA: v })}
        hint="Dividend allowance reduces tax but NOT ANI"
      />
      <NumField
        label="Net rental income"
        step={500}
        value={parent.rentalIncomeNet}
        onChange={(v) => set({ rentalIncomeNet: v })}
        hint="After allowable expenses"
      />

      {/* Advanced: EV sacrifice, P11D, cash allowances */}
      <button
        onClick={() => setShowAdvanced((x) => !x)}
        style={{
          fontSize: 12,
          color: "#4f46e5",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 0",
          marginBottom: showAdvanced ? 8 : 0,
        }}
      >
        {showAdvanced ? "▲ Hide" : "▼ Show"} EV sacrifice, P11D &amp; other
      </button>

      {showAdvanced && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            EV salary sacrifice
          </div>
          <NumField
            label="Annual EV lease cost sacrificed"
            step={500}
            value={parent.salarySacrifice.ev?.annualLeaseCost ?? 0}
            onChange={(v) =>
              set({
                salarySacrifice: {
                  ...parent.salarySacrifice,
                  ev:
                    v > 0
                      ? {
                          annualLeaseCost: v,
                          vehicleP11DValue:
                            parent.salarySacrifice.ev?.vehicleP11DValue ?? 35_000,
                        }
                      : null,
                },
              })
            }
            hint="Reduces gross salary → reduces ANI + saves NIC"
          />
          {(parent.salarySacrifice.ev?.annualLeaseCost ?? 0) > 0 && (
            <NumField
              label="EV vehicle P11D value"
              step={1000}
              value={parent.salarySacrifice.ev?.vehicleP11DValue ?? 35_000}
              onChange={(v) =>
                set({
                  salarySacrifice: {
                    ...parent.salarySacrifice,
                    ev: {
                      annualLeaseCost:
                        parent.salarySacrifice.ev?.annualLeaseCost ?? 0,
                      vehicleP11DValue: v,
                    },
                  },
                })
              }
              hint="List price — BiK = P11D × 3% (2025/26) adds back to ANI"
            />
          )}
          <NumField
            label="Cycle-to-work sacrifice (annual)"
            step={100}
            value={parent.salarySacrifice.cycleToWork}
            onChange={(v) =>
              set({ salarySacrifice: { ...parent.salarySacrifice, cycleToWork: v } })
            }
          />

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
              marginTop: 4,
            }}
          >
            Benefits in kind (P11D)
          </div>
          <NumField
            label="Company car P11D value"
            step={1000}
            value={parent.benefitsInKind.companyCarP11DValue}
            onChange={(v) =>
              set({
                benefitsInKind: { ...parent.benefitsInKind, companyCarP11DValue: v },
              })
            }
            hint="Use 0 if EV via salary sacrifice (entered above)"
          />
          {parent.benefitsInKind.companyCarP11DValue > 0 && (
            <div style={{ marginBottom: 11 }}>
              <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 3, fontWeight: 500 }}>
                Car BiK rate (%)
              </label>
              <input
                type="number"
                value={Math.round(parent.benefitsInKind.companyCarBiKRate * 100)}
                step={1}
                min={0}
                max={37}
                onChange={(e) =>
                  set({
                    benefitsInKind: {
                      ...parent.benefitsInKind,
                      companyCarBiKRate: Number(e.target.value) / 100,
                    },
                  })
                }
                style={{ width: "100%", padding: "4px 7px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12 }}
              />
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>EV = 3% · Petrol/diesel = 17–37%</div>
            </div>
          )}
          <NumField
            label="Private medical insurance (annual premium)"
            step={500}
            value={parent.benefitsInKind.privateMedicalInsurancePremium}
            onChange={(v) =>
              set({
                benefitsInKind: {
                  ...parent.benefitsInKind,
                  privateMedicalInsurancePremium: v,
                },
              })
            }
            hint="Employer's premium cost — adds to ANI in full"
          />
          <NumField
            label="Cash allowances (car/phone/etc.)"
            step={500}
            value={parent.cashAllowances}
            onChange={(v) => set({ cashAllowances: v })}
            hint="Fully taxable for income tax AND NIC"
          />
          <NumField
            label="Self-employment profit (net)"
            step={500}
            value={parent.selfEmploymentProfit}
            onChange={(v) => set({ selfEmploymentProfit: v })}
          />
          <NumField
            label="Pension income / drawdown"
            step={500}
            value={parent.pensionIncomeGross}
            onChange={(v) => set({ pensionIncomeGross: v })}
          />

          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
              marginTop: 4,
            }}
          >
            Pension status
          </div>
          <Toggle
            label="MPAA triggered (flexibly accessed pension)"
            value={parent.mpaaTriggered}
            onChange={(v) => set({ mpaaTriggered: v })}
          />
        </>
      )}

      <div style={{ marginTop: 4 }}>
        <Toggle
          label="On statutory leave (maternity/paternity)"
          value={parent.onStatutoryLeave}
          onChange={(v) => set({ onStatutoryLeave: v })}
        />
        <Toggle
          label="Scotland resident"
          value={parent.scotlandResident}
          onChange={(v) => set({ scotlandResident: v })}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Children form
// ─────────────────────────────────────────────────────────────────────────────

function ChildrenForm({
  children,
  onChange,
}: {
  children: ChildInfo[];
  onChange: (c: ChildInfo[]) => void;
}) {
  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#1f2937" }}>
        Children
      </div>
      {children.map((child, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}
        >
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 2 }}>
              Child {i + 1} — date of birth
            </label>
            <input
              type="date"
              value={child.dateOfBirth}
              onChange={(e) => {
                const n = [...children];
                n[i] = { ...child, dateOfBirth: e.target.value };
                onChange(n);
              }}
              style={{
                width: "100%",
                padding: "4px 7px",
                border: "1px solid #d1d5db",
                borderRadius: 5,
                fontSize: 12,
              }}
            />
          </div>
          <Toggle
            label="Disabled"
            value={child.isDisabled}
            onChange={(v) => {
              const n = [...children];
              n[i] = { ...child, isDisabled: v };
              onChange(n);
            }}
          />
          <button
            onClick={() => onChange(children.filter((_, j) => j !== i))}
            style={{
              background: "none",
              border: "none",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 16,
              paddingBottom: 8,
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([...children, { dateOfBirth: "2024-06-01", isDisabled: false }])
        }
        style={{
          fontSize: 12,
          color: "#4f46e5",
          background: "none",
          border: "1px solid #c7d2fe",
          borderRadius: 5,
          padding: "3px 10px",
          cursor: "pointer",
        }}
      >
        + Add child
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// At-risk alert banner
// ─────────────────────────────────────────────────────────────────────────────

function AtRiskBanners({ result }: { result: CalculationResult }) {
  if (result.atRiskThresholds.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      {result.atRiskThresholds.map((t, i) => (
        <div
          key={i}
          style={{
            background: "#fef3c7",
            border: "1px solid #fbbf24",
            borderRadius: 8,
            padding: "9px 12px",
            marginBottom: 6,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>
              ⚠ At risk — {t.thresholdLabel}
            </div>
            <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
              {t.parentLabel} is only {fmt(t.currentGap)} below the threshold.
              Schemes at risk: {t.schemesAtRisk.join(", ")}.
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#92400e" }}>
              {fmt(t.potentialAnnualLossGBP)}
            </div>
            <div style={{ fontSize: 10, color: "#b45309" }}>potential annual loss</div>
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
  const [open, setOpen] = useState(false);

  const addItems = [
    { l: "Base salary (post-sacrifice)", v: ani.postSacrificeSalary },
    { l: "Bonus", v: ani.bonusIncome },
    { l: "RSU vest income", v: ani.rsuIncome },
    { l: "Benefits in kind (P11D)", v: ani.biKIncome },
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
            {open ? "▲ hide breakdown" : "▼ show breakdown"}
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
              { label: "Annual Allowance", value: fmt(capacity.annualAllowance), colour: capacity.mpaaApplies ? "#dc2626" : undefined },
              { label: "Contributions this year", value: fmt(capacity.totalContributionsThisYear) },
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
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "12px 14px", background: "#fff", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{title}</span>
            <Pill status={status} label={status === "eligible" ? "Eligible" : status === "at_risk" ? "At risk" : "Not eligible"} />
          </div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>{subtitle}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>{value}</div>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>{valueLabel}</div>
        </div>
      </div>
      {open && children && (
        <div style={{ padding: "10px 14px 14px", background: "#f9fafb", borderTop: "1px solid #f3f4f6" }}>
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

      <SectionTitle>Adjusted Net Income</SectionTitle>
      <ANIWaterfall ani={parentA.ani} label="Parent A" />
      {parentB && <ANIWaterfall ani={parentB.ani} label="Partner B" />}

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
        subtitle="Government tops up 25% of childcare spend · max £2,000/child/year"
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
            { label: "Gross CB", value: fmt(hicbc.grossChildBenefitAnnual) },
            {
              label: "HICBC charge",
              value: fmt(hicbc.hicbcCharge),
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
            ⚠ Self Assessment required to declare HICBC
          </div>
        )}
      </SchemeCard>

      <SectionTitle>Pension Capacity</SectionTitle>
      <PensionCapacityPanel capacity={parentA.pensionCapacity} />
      {parentB && <PensionCapacityPanel capacity={parentB.pensionCapacity} />}

      <SectionTitle>Total Household Position</SectionTitle>
      <MetricGrid
        items={[
          { label: "Parent A take-home", value: fmt(householdSummary.parentANetTakeHome) },
          ...(parentB
            ? [{ label: "Partner B take-home", value: fmt(householdSummary.parentBNetTakeHome) }]
            : []),
          { label: "Net Child Benefit", value: fmt(householdSummary.netChildBenefit) },
          { label: "TFC top-up", value: fmt(householdSummary.tfcTopUp) },
          { label: "Free hours value", value: fmt(householdSummary.freeHoursAnnualValue) },
        ]}
      />
      <div style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", borderRadius: 10, padding: "14px 16px", color: "#fff" }}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Total household net income + benefits</div>
        <div style={{ fontSize: 30, fontWeight: 700 }}>
          {fmt(householdSummary.totalHouseholdNetPosition)}
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
  const [open, setOpen] = useState(false);
  const priC =
    rec.priority === "high"
      ? "#dc2626"
      : rec.priority === "medium"
      ? "#d97706"
      : "#6b7280";

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "12px 14px", background: "#fff", cursor: "pointer" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: priC, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {rec.priority}
              </span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                {rec.parentLabel}
                {rec.aniReductionRequired === 0 && " · at-risk protection"}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
              {LEVER_NAMES[rec.lever] ?? rec.lever}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>
              {rec.schemesRestored.join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
            {rec.netAnnualGain !== 0 && (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: rec.netAnnualGain >= 0 ? "#16a34a" : "#dc2626" }}>
                  {rec.netAnnualGain >= 0 ? "+" : ""}
                  {fmt(rec.netAnnualGain)}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>net annual gain</div>
              </>
            )}
            {rec.annualBenefitRestored > 0 && rec.netAnnualGain === 0 && (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#d97706" }}>
                  {fmt(rec.annualBenefitRestored)}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af" }}>at risk</div>
              </>
            )}
            {rec.pensionPotIncrease && rec.pensionPotIncrease > 0 && (
              <div style={{ fontSize: 11, color: "#4f46e5", marginTop: 1 }}>
                +{fmt(rec.pensionPotIncrease)} to pension pot
              </div>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div style={{ padding: "12px 14px 14px", background: "#f9fafb", borderTop: "1px solid #f3f4f6" }}>
          <div style={{ fontSize: 12, color: "#374151", marginBottom: 10, lineHeight: 1.55 }}>
            {rec.leverDescription}
          </div>
          <MetricGrid
            items={[
              ...(rec.aniReductionRequired > 0
                ? [{ label: "ANI reduction needed", value: fmt(rec.aniReductionRequired) }]
                : []),
              { label: "Action required", value: `${fmt(rec.actionRequired)} ${rec.actionUnit.replace("gross ", "").replace("net ", "")}` },
              { label: "Benefit restored / protected", value: fmt(rec.annualBenefitRestored) },
            ]}
          />
          {rec.warnings.filter(Boolean).map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", borderRadius: 4, padding: "4px 8px", marginBottom: 4 }}>
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
  const proactive = recs.filter((r) => r.aniReductionRequired === 0);
  const restorative = recs.filter((r) => r.aniReductionRequired > 0);

  return (
    <div>
      <AtRiskBanners result={result} />
      {restorative.length > 0 && (
        <>
          <SectionTitle>Restore lost eligibility</SectionTitle>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            Ranked by annual benefit restored. Expand each card for full details, costs, and warnings.
          </div>
          {restorative.slice(0, 6).map((r, i) => <RecCard key={i} rec={r} />)}
        </>
      )}
      {proactive.length > 0 && (
        <>
          <SectionTitle>Protect existing eligibility</SectionTitle>
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
// Marginal rate chart panel — Phase 4 complete
// ─────────────────────────────────────────────────────────────────────────────

const THRESHOLD_LINES = [
  { x: 60, label: "HICBC", colour: "#f59e0b" },
  { x: 80, label: "CB lost", colour: "#ef4444" },
  { x: 100, label: "Cliff edge", colour: "#7c3aed" },
  { x: 125.14, label: "PA gone", colour: "#dc2626" },
];

function ChartPanel({ result }: { result: CalculationResult }) {
  const [activeParent, setActiveParent] = useState<ChartParent>("A");

  const chartData = useMemo(() => {
    const points =
      activeParent === "A"
        ? result.marginalRateChart.parentA
        : result.marginalRateChart.parentB ?? result.marginalRateChart.parentA;

    return points.map((d) => ({
      k: d.ani / 1000,
      it: Math.round(d.incomeTaxMarginalRate * 100 * 10) / 10,
      ni: Math.round(d.nicMarginalRate * 100 * 10) / 10,
      pa: Math.round(d.personalAllowanceTaperEffect * 100 * 10) / 10,
      hicbc: Math.round(d.hicbcWithdrawalRate * 1000) / 10,
      fh: Math.round(d.freeHoursBenefitLossRate * 1000) / 10,
      tfc: Math.round(d.tfcBenefitLossRate * 1000) / 10,
      total: Math.round(d.totalEffectiveMarginalRate * 100 * 10) / 10,
    }));
  }, [result, activeParent]);

  const currentANI =
    activeParent === "A"
      ? result.parentA.ani.adjustedNetIncome
      : result.parentB?.ani.adjustedNetIncome ?? result.parentA.ani.adjustedNetIncome;

  const crossover = result.crossoverANI;

  const currentPoint = chartData.find((d) => d.k * 1000 >= currentANI) ?? chartData[chartData.length - 1];

  return (
    <div>
      {/* Parent toggle */}
      {result.parentB && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["A", "B"] as ChartParent[]).map((p) => (
            <button
              key={p}
              onClick={() => setActiveParent(p)}
              style={{
                padding: "5px 14px",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                background: activeParent === p ? "#4f46e5" : "#fff",
                color: activeParent === p ? "#fff" : "#374151",
                transition: "all 0.15s",
              }}
            >
              {p === "A" ? "Parent A" : "Partner B"}
            </button>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>
        Effective marginal rate across £50k–£135k ANI. Each stacked band shows one component.
        The 60%+ zone between £100k and £125k is the main danger area — for every £2 earned there,
        less than £0.80 reaches the household after tax and benefit losses.
      </div>

      {/* Current ANI context */}
      <div
        style={{
          background: currentANI > 100_000 ? "#fef2f2" : currentANI > 80_000 ? "#fef3c7" : "#f0fdf4",
          border: `1px solid ${currentANI > 100_000 ? "#fca5a5" : currentANI > 80_000 ? "#fbbf24" : "#86efac"}`,
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 12,
          marginBottom: 14,
          color: currentANI > 100_000 ? "#991b1b" : currentANI > 80_000 ? "#92400e" : "#166534",
        }}
      >
        Current ANI: <strong>{fmt(currentANI)}</strong>
        {currentANI > 125_140 && " — above PA taper zone, 45% rate"}
        {currentANI > 100_000 && currentANI <= 125_140 && " — inside 60% zone, TFC and free hours lost"}
        {currentANI > 80_000 && currentANI <= 100_000 && " — Child Benefit fully clawed back"}
        {currentANI > 60_000 && currentANI <= 80_000 && " — partial HICBC clawback in progress"}
        {currentANI <= 60_000 && " — below all major thresholds"}
        {crossover !== null && currentANI > 100_000 && (
          <span style={{ marginLeft: 8, fontWeight: 600 }}>
            · Net position recovers at approx. {fmt(crossover)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="k"
            tickFormatter={(v) => `£${v}k`}
            tick={{ fontSize: 10 }}
            label={{ value: "Adjusted Net Income", position: "insideBottom", offset: -12, fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 10 }}
            domain={[0, 80]}
          />
          <Tooltip
            formatter={((v: unknown) => [`${String(v)}%`]) as never}
            labelFormatter={(l) => `ANI: £${l}k`}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />

          {THRESHOLD_LINES.map(({ x, label, colour }) => (
            <ReferenceLine
              key={x}
              x={x}
              stroke={colour}
              strokeDasharray="4 3"
              label={{ value: label, position: "insideTopRight", fontSize: 9, fill: colour }}
            />
          ))}

          {/* Current ANI marker */}
          <ReferenceLine
            x={currentANI / 1000}
            stroke="#111827"
            strokeWidth={2}
            label={{ value: "You", position: "insideTop", fontSize: 10, fill: "#111827" }}
          />

          {/* Crossover marker */}
          {crossover !== null && currentANI > 100_000 && (
            <ReferenceLine
              x={crossover / 1000}
              stroke="#16a34a"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: "Crossover", position: "insideTopLeft", fontSize: 9, fill: "#16a34a" }}
            />
          )}

          <Area type="monotone" dataKey="it" name="Income tax" stackId="1" stroke="#3b82f6" fill="#dbeafe" strokeWidth={1.5} />
          <Area type="monotone" dataKey="ni" name="NIC" stackId="1" stroke="#10b981" fill="#d1fae5" strokeWidth={1.5} />
          <Area type="monotone" dataKey="pa" name="PA taper" stackId="1" stroke="#8b5cf6" fill="#ede9fe" strokeWidth={1.5} />
          <Area type="monotone" dataKey="hicbc" name="HICBC" stackId="1" stroke="#f59e0b" fill="#fef3c7" strokeWidth={1.5} />
          <Area type="monotone" dataKey="fh" name="Free hours loss" stackId="1" stroke="#ef4444" fill="#fee2e2" strokeWidth={1.5} />
          <Area type="monotone" dataKey="tfc" name="TFC loss" stackId="1" stroke="#f97316" fill="#ffedd5" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Breakdown at current ANI */}
      <SectionTitle>Breakdown at current ANI ({fmt(currentANI)})</SectionTitle>
      {currentPoint && (
        <MetricGrid
          items={[
            { label: "Income tax", value: `${currentPoint.it}%`, colour: "#3b82f6" },
            { label: "NIC", value: `${currentPoint.ni}%`, colour: "#10b981" },
            { label: "PA taper effect", value: `${currentPoint.pa}%`, colour: "#8b5cf6" },
            { label: "HICBC rate", value: `${currentPoint.hicbc}%`, colour: "#f59e0b" },
            { label: "Free hours loss", value: `${currentPoint.fh}%`, colour: "#ef4444" },
            { label: "TFC loss", value: `${currentPoint.tfc}%`, colour: "#f97316" },
            { label: "Total effective", value: `${currentPoint.total}%`, colour: "#111827" },
          ]}
        />
      )}

      {/* Crossover explanation */}
      {crossover !== null ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#f0fdf4",
            borderRadius: 8,
            fontSize: 12,
            color: "#166534",
            border: "1px solid #86efac",
          }}
        >
          <strong>Crossover point: {fmt(crossover)}</strong> — This is the ANI at which the household's
          total net position (income + benefits) recovers to match what it was at £99,999, before the
          childcare cliff. Earning between £100,000 and this point makes the household worse off in
          total than staying below £100,000.
        </div>
      ) : currentANI > 100_000 ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#fef3c7",
            borderRadius: 8,
            fontSize: 12,
            color: "#92400e",
          }}
        >
          No crossover point found within the modelled range (up to £135,000). Consider whether pension
          contributions could restore eligibility and create a better overall net position.
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", lineHeight: 1.5 }}>
        <strong>Note:</strong> The childcare cliff spike at £101k represents the total annual value of
        TFC and free hours lost, divided by £1,000 (one chart step), to show the equivalent marginal
        rate on that £1k of income.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs panel
// ─────────────────────────────────────────────────────────────────────────────

function InputsPanel({
  inputs,
  hasB,
  onParentA,
  onParentB,
  onChildren,
  onHasB,
  onHousehold,
}: {
  inputs: HouseholdInputs;
  hasB: boolean;
  onParentA: (p: ParentIncome) => void;
  onParentB: (p: ParentIncome) => void;
  onChildren: (c: ChildInfo[]) => void;
  onHasB: (v: boolean) => void;
  onHousehold: (patch: Partial<HouseholdInputs>) => void;
}) {
  return (
    <>
      <ParentForm parent={inputs.parentA} onChange={onParentA} label="Parent A" />
      <Toggle label="Has a partner / second parent" value={hasB} onChange={onHasB} />
      {hasB && inputs.parentB && (
        <ParentForm parent={inputs.parentB} onChange={onParentB} label="Partner B" />
      )}
      <ChildrenForm children={inputs.children} onChange={onChildren} />
      <div
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#1f2937" }}>
          Household settings
        </div>
        <NumField
          label="Estimated annual childcare spend"
          step={1000}
          value={inputs.estimatedAnnualChildcareSpend}
          onChange={(v) => onHousehold({ estimatedAnnualChildcareSpend: v })}
          hint="Used to calculate TFC top-up actually receivable"
        />
        <Toggle
          label="Child Benefit registered"
          value={inputs.childBenefitRegistered}
          onChange={(v) => onHousehold({ childBenefitRegistered: v })}
        />
        <Toggle
          label="Receiving Child Benefit payments"
          value={inputs.childBenefitPaymentsElected}
          onChange={(v) => onHousehold({ childBenefitPaymentsElected: v })}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App shell
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [inputs, setInputs] = useState<HouseholdInputs>(DEFAULT_INPUTS);
  const [hasB, setHasB] = useState(true);
  const [tab, setTab] = useState<Tab>("eligibility");

  const setA = useCallback((p: ParentIncome) => setInputs((i) => ({ ...i, parentA: p })), []);
  const setB = useCallback((p: ParentIncome) => setInputs((i) => ({ ...i, parentB: p })), []);
  const setKids = useCallback((c: ChildInfo[]) => setInputs((i) => ({ ...i, children: c })), []);
  const patchHH = useCallback(
    (patch: Partial<HouseholdInputs>) => setInputs((i) => ({ ...i, ...patch })),
    []
  );
  const handleHasB = useCallback(
    (v: boolean) => {
      setHasB(v);
      if (v && !inputs.parentB) {
        setInputs((i) => ({ ...i, parentB: defaultParentB() }));
      }
    },
    [inputs.parentB]
  );

  const result = useMemo<CalculationResult | null>(() => {
    try {
      return calculate({ ...inputs, parentB: hasB ? inputs.parentB : null });
    } catch {
      return null;
    }
  }, [inputs, hasB]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "inputs", label: "Inputs" },
    { id: "eligibility", label: "Eligibility" },
    { id: "optimise", label: "Optimise" },
    { id: "chart", label: "Marginal rates" },
  ];

  const inputsPanel = (
    <InputsPanel
      inputs={inputs}
      hasB={hasB}
      onParentA={setA}
      onParentB={setB}
      onChildren={setKids}
      onHasB={handleHasB}
      onHousehold={patchHH}
    />
  );

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        minHeight: "100vh",
        background: "#f3f4f6",
      }}
    >
      {/* Header */}
      <div style={{ background: "#1e1b4b", color: "#fff", padding: "13px 20px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>UK Childcare Tax Tool</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 1 }}>
            £100k cliff edge · TFC · 30-hour entitlement · HICBC · Tax year 2025/26
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "12px 14px 48px" }}>
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 14,
            background: "#e5e7eb",
            borderRadius: 8,
            padding: 3,
          }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: "6px 2px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                background: tab === id ? "#fff" : "transparent",
                color: tab === id ? "#1e1b4b" : "#6b7280",
                boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.14s",
              }}
            >
              {label}
              {/* Badge: at-risk count on Eligibility and Optimise tabs */}
              {(id === "eligibility" || id === "optimise") &&
                result &&
                result.atRiskThresholds.length > 0 && (
                  <span
                    style={{
                      marginLeft: 5,
                      background: "#f59e0b",
                      color: "#fff",
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "0 5px",
                    }}
                  >
                    {result.atRiskThresholds.length}
                  </span>
                )}
            </button>
          ))}
        </div>

        {/* Full-width inputs tab */}
        {tab === "inputs" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <ParentForm parent={inputs.parentA} onChange={setA} label="Parent A" />
              <Toggle
                label="Has a partner / second parent"
                value={hasB}
                onChange={handleHasB}
              />
              {hasB && inputs.parentB && (
                <ParentForm parent={inputs.parentB} onChange={setB} label="Partner B" />
              )}
            </div>
            <div>
              <ChildrenForm children={inputs.children} onChange={setKids} />
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "#1f2937" }}>
                  Household settings
                </div>
                <NumField
                  label="Estimated annual childcare spend"
                  step={1000}
                  value={inputs.estimatedAnnualChildcareSpend}
                  onChange={(v) => patchHH({ estimatedAnnualChildcareSpend: v })}
                />
                <Toggle
                  label="Child Benefit registered"
                  value={inputs.childBenefitRegistered}
                  onChange={(v) => patchHH({ childBenefitRegistered: v })}
                />
                <Toggle
                  label="Receiving Child Benefit payments"
                  value={inputs.childBenefitPaymentsElected}
                  onChange={(v) => patchHH({ childBenefitPaymentsElected: v })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Two-column layout for result tabs */}
        {tab !== "inputs" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "280px 1fr",
              gap: 14,
              alignItems: "start",
            }}
          >
            {/* Sticky inputs sidebar */}
            <div
              style={{
                position: "sticky",
                top: 12,
                maxHeight: "calc(100vh - 80px)",
                overflowY: "auto",
              }}
            >
              {inputsPanel}
            </div>

            {/* Results */}
            <div>
              {!result && (
                <div
                  style={{
                    padding: 24,
                    textAlign: "center",
                    color: "#dc2626",
                    background: "#fff",
                    borderRadius: 10,
                  }}
                >
                  Calculation error — check inputs
                </div>
              )}
              {result && tab === "eligibility" && <EligibilityPanel result={result} />}
              {result && tab === "optimise" && <OptimisePanel result={result} />}
              {result && tab === "chart" && <ChartPanel result={result} />}
            </div>
          </div>
        )}

        <div style={{ marginTop: 24, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
          For educational planning purposes only · Not financial advice · Tax year 2025/26 (England) · Always verify with a qualified financial adviser
        </div>
      </div>
    </div>
  );
}
