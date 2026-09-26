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

import { useState, useCallback, useMemo, useContext, createContext } from "react";
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
  isConfiguredTaxYear,
  CONFIGURED_TAX_YEARS,
  LATEST_CONFIGURED_TAX_YEAR,
} from "./engine-src/index";
import { buildTooltips, type Tooltips } from "./tooltips";
import { generateReport } from "./generatePDF";
import type {
  HouseholdInputs,
  ParentIncome,
  CalculationResult,
  ChildInfo,
  FreeHoursChildResult,
  OptimisationRecommendation,
  ANIBreakdown,
  PensionCapacity,
  MinimumIncomeAgeBand,
  TaxYear,
} from "./engine-src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "inputs" | "eligibility" | "optimise" | "chart";
type ChartParent = "A" | "B";

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip component + content dictionary
// ─────────────────────────────────────────────────────────────────────────────

function Tip({ text, children }: { text: string; children?: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const handleMouseMove = (e: React.MouseEvent<HTMLSpanElement>) => {
    setPos({ x: e.clientX, y: e.clientY });
  };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={handleMouseMove}
    >
      {children ?? (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, borderRadius: "50%",
          background: "#e2e8f0", color: "#64748b",
          fontSize: 9, fontWeight: 800, cursor: "help",
          flexShrink: 0, marginLeft: 4, lineHeight: 1,
          border: "1px solid #cbd5e1",
        }}>?</span>
      )}
      {visible && (
        <div style={{
          position: "fixed",
          left: Math.min(pos.x + 12, window.innerWidth - 280),
          top: pos.y - 8,
          transform: "translateY(-100%)",
          zIndex: 9999,
          background: "#1e293b",
          color: "#f1f5f9",
          borderRadius: 8,
          padding: "10px 13px",
          fontSize: 12,
          lineHeight: 1.55,
          maxWidth: 260,
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          pointerEvents: "none",
          whiteSpace: "pre-line",
        }}>
          {text}
          <div style={{
            position: "absolute", bottom: -5, left: 16,
            width: 10, height: 10,
            background: "#1e293b",
            transform: "rotate(45deg)",
            borderRadius: 2,
          }} />
        </div>
      )}
    </span>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Constants & formatters
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

// Tooltips for the selected tax year, provided by App
const TooltipContext = createContext<Tooltips>(buildTooltips(getTaxYearConfig(LATEST_CONFIGURED_TAX_YEAR)));
const useTT = () => useContext(TooltipContext);

/** Today's tax year if configured, otherwise the latest configured year. */
function defaultTaxYear(): { year: TaxYear; outOfDate: boolean } {
  const current = taxYearForDate(new Date());
  return isConfiguredTaxYear(current)
    ? { year: current, outOfDate: false }
    : { year: LATEST_CONFIGURED_TAX_YEAR, outOfDate: true };
}

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
  taxYear: defaultTaxYear().year,
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

function NumField({
  label,
  value,
  onChange,
  hint,
  step = 1000,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
  tooltip?: string;
}) {
  return (
    <div style={{ marginBottom: 11 }}>
      <label style={{
        display: "block",
        fontSize: 11,
        color: "#64748b",
        marginBottom: 3,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
      }}>
        {label}{tooltip && <Tip text={tooltip} />}
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
  tooltip,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
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
      <span style={{ fontSize: 12, color: "#374151", userSelect: "none" }}>{label}{tooltip && <Tip text={tooltip} />}</span>
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
  taxYear,
}: {
  parent: ParentIncome;
  onChange: (p: ParentIncome) => void;
  label: string;
  taxYear: TaxYear;
}) {
  const TT = useTT();
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
        tooltip={TT.grossSalary}
      />
      <NumField
        label="Expected bonus this tax year"
        value={parent.bonus.expectedThisYear}
        onChange={(v) => set({ bonus: { ...parent.bonus, expectedThisYear: v } })}
        tooltip={TT.bonus}
      />
      <NumField
        label="RSU vesting value this tax year"
        step={5000}
        tooltip={TT.rsuVests}
        value={parent.rsuVests.reduce((s, r) => s + r.grossValue, 0)}
        onChange={(v) =>
          set({
            rsuVests:
              v > 0
                ? [{ vestDate: rsuVestDateForTaxYear(taxYear), grossValue: v, employerNICTransferred: false }]
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
        tooltip={TT.salarySacrifice}
        onChange={(v) =>
          set({ salarySacrifice: { ...parent.salarySacrifice, pension: v } })
        }
        hint="Reduces ANI at Step 1 + saves NIC"
      />
      <NumField
        label="Personal pension / SIPP (net paid)"
        value={parent.personalPensionContributions.reliefAtSourceNet}
        tooltip={TT.personalPension}
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
        label="Net pay workplace pension (annual)"
        value={parent.personalPensionContributions.netPayArrangementGross}
        tooltip={TT.netPayPension}
        onChange={(v) =>
          set({
            personalPensionContributions: {
              ...parent.personalPensionContributions,
              netPayArrangementGross: v,
            },
          })
        }
        hint="Deducted before tax, not salary sacrifice (e.g. NHS)"
      />
      <NumField
        label="Gift Aid donations (net)"
        step={100}
        tooltip={TT.giftAid}
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
        tooltip={TT.savingsInterest}
        onChange={(v) => set({ savingsInterestNonISA: v })}
        hint="PSA reduces tax but NOT ANI — full amount counts"
      />
      <NumField
        label="Non-ISA dividends"
        step={500}
        value={parent.dividendsNonISA}
        tooltip={TT.dividends}
        onChange={(v) => set({ dividendsNonISA: v })}
        hint="Dividend allowance reduces tax but NOT ANI"
      />
      <NumField
        label="Rental profit (before mortgage interest)"
        step={500}
        value={parent.rentalIncomeNet}
        tooltip={TT.rentalIncome}
        onChange={(v) => set({ rentalIncomeNet: v })}
        hint="Rent minus allowable expenses, before finance costs"
      />
      {parent.rentalIncomeNet > 0 && (
        <NumField
          label="Rental mortgage interest / finance costs"
          step={500}
          value={parent.rentalFinanceCosts ?? 0}
          tooltip={TT.rentalFinanceCosts}
          onChange={(v) => set({ rentalFinanceCosts: v })}
          hint="Not deducted from ANI — 20% tax reduction"
        />
      )}

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
            tooltip={TT.evLease}
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
              tooltip={TT.evP11D}
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
              hint={`List price — BiK = P11D × ${+(getTaxYearConfig(taxYear).evBiKRate * 100).toFixed(2)}% (${taxYear}) adds back to ANI`}
            />
          )}
          <NumField
            label="Cycle-to-work sacrifice (annual)"
            step={100}
            tooltip={TT.cycleToWork}
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
            tooltip={TT.companyCarP11D}
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
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Car BiK rate (%) <Tip text={TT.carBiK} />
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
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>EV = {+(getTaxYearConfig(taxYear).evBiKRate * 100).toFixed(2)}% ({taxYear}) · Petrol/diesel = 17–37%</div>
            </div>
          )}
          <NumField
            label="Private medical insurance (annual premium)"
            step={500}
            tooltip={TT.pmi}
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
            tooltip={TT.cashAllowances}
            value={parent.cashAllowances}
            onChange={(v) => set({ cashAllowances: v })}
            hint="Fully taxable for income tax AND NIC"
          />
          <NumField
            label="Self-employment profit (net)"
            step={500}
            tooltip={TT.selfEmployment}
            value={parent.selfEmploymentProfit}
            onChange={(v) => set({ selfEmploymentProfit: v })}
          />
          <NumField
            label="Pension income / drawdown"
            step={500}
            tooltip={TT.pensionIncome}
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
            Childcare minimum income test
          </div>
          <NumField
            label="Expected earnings, next 3 months"
            step={500}
            tooltip={TT.expectedEarnings}
            value={parent.expectedEarningsNext3Months ?? 0}
            onChange={(v) => set({ expectedEarningsNext3Months: v > 0 ? v : undefined })}
            hint="0 = a quarter of annual pay, bonus and self-employment profit"
          />
          <div style={{ marginBottom: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Age band <Tip text={TT.ageBand} />
            </label>
            <select
              value={parent.ageBand ?? "21_plus"}
              onChange={(e) => set({ ageBand: e.target.value as MinimumIncomeAgeBand })}
              style={{ width: "100%", padding: "4px 7px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12 }}
            >
              <option value="21_plus">21 or over</option>
              <option value="18_to_20">18 to 20</option>
              <option value="under_18_or_apprentice">Under 18 or apprentice</option>
            </select>
          </div>
          <Toggle
            label="Self-employed"
            value={parent.selfEmployed ?? false}
            tooltip={TT.selfEmployed}
            onChange={(v) => set({ selfEmployed: v })}
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
            tooltip={TT.mpaa}
            onChange={(v) => set({ mpaaTriggered: v })}
          />
        </>
      )}

      <div style={{ marginTop: 4 }}>
        <Toggle
          label="On statutory leave (maternity/paternity)"
          value={parent.onStatutoryLeave}
          tooltip={TT.statutoryLeave}
          onChange={(v) => set({ onStatutoryLeave: v })}
        />
        {parent.selfEmploymentProfit > 0 && (
          <Toggle
            label="Over State Pension age (no Class 4 NIC)"
            value={parent.statePensionAgeReached ?? false}
            tooltip={TT.statePensionAge}
            onChange={(v) => set({ statePensionAgeReached: v })}
          />
        )}
        <Toggle
          label="Scotland resident"
          value={parent.scotlandResident}
          tooltip={TT.scotlandResident}
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
  const TT = useTT();
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
            tooltip={TT.childDisabled}
            onChange={(v) => {
              const n = [...children];
              n[i] = { ...child, isDisabled: v };
              onChange(n);
            }}
          />
          <Toggle
            label="Reception deferred"
            value={child.deferredReception ?? false}
            tooltip={TT.deferredReception}
            onChange={(v) => {
              const n = [...children];
              n[i] = { ...child, deferredReception: v };
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
// Household settings fields (shared by the inputs tab and the sidebar)
// ─────────────────────────────────────────────────────────────────────────────

function HouseholdSettingsFields({
  inputs,
  onHousehold,
}: {
  inputs: HouseholdInputs;
  onHousehold: (patch: Partial<HouseholdInputs>) => void;
}) {
  const TT = useTT();
  const nurseryRate = inputs.providerHourlyRates?.age3to4 ?? 0;
  return (
    <>
      <div style={{ marginBottom: 11 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Assessment date (optional) <Tip text={TT.assessmentDate} />
        </label>
        <input
          type="date"
          value={inputs.asOfDate ?? ""}
          onChange={(e) => onHousehold({ asOfDate: e.target.value || undefined })}
          style={{ width: "100%", padding: "4px 7px", border: "1px solid #d1d5db", borderRadius: 5, fontSize: 12 }}
        />
      </div>
      <NumField
        label="Annual childcare fees (before funded hours)"
        step={1000}
        value={inputs.estimatedAnnualChildcareSpend}
        tooltip={TT.childcareSpend}
        onChange={(v) => onHousehold({ estimatedAnnualChildcareSpend: v })}
        hint="Funded hours are subtracted; TFC adds 20% of what you pay"
      />
      <NumField
        label="Nursery hourly rate"
        step={0.5}
        value={nurseryRate}
        tooltip={TT.nurseryRate}
        onChange={(v) =>
          onHousehold({
            providerHourlyRates: v > 0 ? { under2: v, age2: v, age3to4: v } : undefined,
          })
        }
        hint="0 = national average funding rate (usually understates)"
      />
      <Toggle
        label="Child Benefit registered"
        value={inputs.childBenefitRegistered}
        onChange={(v) => onHousehold({ childBenefitRegistered: v })}
        tooltip={TT.childBenefitRegistered}
      />
      <Toggle
        label="Receiving Child Benefit payments"
        value={inputs.childBenefitPaymentsElected}
        onChange={(v) => onHousehold({ childBenefitPaymentsElected: v })}
        tooltip={TT.cbPayments}
      />
    </>
  );
}

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
          { label: "Parent A take-home", value: fmt(householdSummary.parentANetTakeHome) },
          ...(parentB
            ? [{ label: "Partner B take-home", value: fmt(householdSummary.parentBNetTakeHome) }]
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
            { l: "Parent A take-home", v: householdSummary.parentANetTakeHome },
            householdSummary.parentBNetTakeHome > 0 ? { l: "Partner B take-home", v: householdSummary.parentBNetTakeHome } : null,
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
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

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
              {p === "A" ? "Parent A" : "Partner B"}
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
      <ParentForm parent={inputs.parentA} onChange={onParentA} label="Parent A" taxYear={inputs.taxYear} />
      <Toggle label="Has a partner / second parent" value={hasB} onChange={onHasB} />
      {hasB && inputs.parentB && (
        <ParentForm parent={inputs.parentB} onChange={onParentB} label="Partner B" taxYear={inputs.taxYear} />
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
        <HouseholdSettingsFields inputs={inputs} onHousehold={onHousehold} />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Download PDF button
// ─────────────────────────────────────────────────────────────────────────────

function DownloadButton({ result }: { result: CalculationResult }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    // Yield to browser to show loading state, then generate
    await new Promise(r => setTimeout(r, 50));
    try {
      generateReport(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
        background: loading ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
        border: "1.5px solid rgba(255,255,255,0.25)",
        borderRadius: 8,
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        cursor: loading ? "wait" : "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        backdropFilter: "blur(4px)",
      }}
      onMouseEnter={e => {
        if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.2)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = loading ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)";
      }}
      title="Download a formatted PDF report of your full assessment"
    >
      {loading ? (
        <>
          <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          Generating…
        </>
      ) : (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download PDF
        </>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App shell
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [inputs, setInputs] = useState<HouseholdInputs>(DEFAULT_INPUTS);
  const [outOfDate] = useState(() => defaultTaxYear().outOfDate);
  const tooltips = useMemo(() => buildTooltips(getTaxYearConfig(inputs.taxYear)), [inputs.taxYear]);

  // Changing the tax year re-dates the RSU vests the form created, which are
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
    <TooltipContext.Provider value={tooltips}>
    <div style={{
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      minHeight: "100vh",
      background: "#f0f2f7",
    }}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1e3a5f 100%)",
        color: "#fff",
        padding: "14px 20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "linear-gradient(135deg, #3b82f6, #7c3aed)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 900, color: "#fff",
              }}>£</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>UK Childcare Tax Tool</div>
                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 1 }}>
                  £100k cliff · TFC · 30-hour entitlement · HICBC
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, fontSize: 11, opacity: 0.9 }}>
                Tax year
                <select
                  aria-label="Tax year"
                  value={inputs.taxYear}
                  onChange={(e) => setTaxYear(e.target.value as TaxYear)}
                  style={{ background: "#1e293b", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "3px 6px", fontSize: 12, fontWeight: 700 }}
                >
                  {CONFIGURED_TAX_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <div>
              </div>
            </div>
          </div>
          {result && (
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {[
                { label: "Parent A ANI", val: fmt(result.parentA.ani.adjustedNetIncome), warn: result.parentA.ani.adjustedNetIncome > 100_000 },
                { label: "Household total", val: fmt(result.householdSummary.totalHouseholdNetPosition), warn: false },
              ].map(({ label, val, warn }) => (
                <div key={label} style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, opacity: 0.5, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: warn ? "#fca5a5" : "#fff" }}>{val}</div>
                </div>
              ))}
              <DownloadButton result={result} />
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 56px" }}>
        {outOfDate && (
          <div role="status" style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12 }}>
            The current tax year ({taxYearForDate(new Date())}) isn't configured yet, so this uses {LATEST_CONFIGURED_TAX_YEAR} rates.
            Results may be out of date.
          </div>
        )}
        {/* ── Tab bar ──────────────────────────────────────────────── */}
        <div style={{
          display: "flex",
          gap: 2,
          marginBottom: 16,
          background: "#fff",
          borderRadius: 10,
          padding: 4,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid #e8eaf0",
        }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1,
                padding: "7px 4px",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: tab === id ? 700 : 500,
                background: tab === id ? "#1e293b" : "transparent",
                color: tab === id ? "#fff" : "#64748b",
                boxShadow: tab === id ? "0 2px 6px rgba(0,0,0,0.15)" : "none",
                transition: "all 0.14s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              {label}
              {(id === "eligibility" || id === "optimise") &&
                result &&
                result.atRiskThresholds.length > 0 && (
                  <span style={{
                    background: tab === id ? "#f59e0b" : "#ef4444",
                    color: "#fff",
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "0 5px",
                    lineHeight: "16px",
                  }}>
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
              <ParentForm parent={inputs.parentA} onChange={setA} label="Parent A" taxYear={inputs.taxYear} />
              <Toggle
                label="Has a partner / second parent"
                value={hasB}
                onChange={handleHasB}
              />
              {hasB && inputs.parentB && (
                <ParentForm parent={inputs.parentB} onChange={setB} label="Partner B" taxYear={inputs.taxYear} />
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
                <HouseholdSettingsFields inputs={inputs} onHousehold={patchHH} />
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
            <div style={{
                position: "sticky",
                top: 12,
                maxHeight: "calc(100vh - 80px)",
                overflowY: "auto",
                scrollbarWidth: "thin",
              }}>
              {inputsPanel}
            </div>

            {/* Results */}
            <div>
              {!result && (
                <div style={{
                  padding: 32,
                  textAlign: "center",
                  color: "#dc2626",
                  background: "#fff",
                  borderRadius: 12,
                  border: "1px solid #fecaca",
                  fontWeight: 600,
                  fontSize: 14,
                }}>
                  ⚠ Calculation error — please check your inputs
                </div>
              )}
              {result && tab === "eligibility" && <EligibilityPanel result={result} />}
              {result && tab === "optimise" && <OptimisePanel result={result} />}
              {result && tab === "chart" && <ChartPanel result={result} />}
            </div>
          </div>
        )}

        <div style={{ marginTop: 28, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.7 }}>
          Educational planning tool only · Not financial or tax advice · Tax year {inputs.taxYear} · England<br />
          Always verify figures with a qualified financial adviser or accountant
        </div>
      </div>
    </div>
    </TooltipContext.Provider>
  );
}
