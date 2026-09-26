/**
 * DetailForms.tsx — the full, field-by-field input forms. Used by
 * "Edit all details"; the guided setup covers the common cases.
 */
import { useCallback, useState } from "react";
import { getTaxYearConfig, rsuVestDateForTaxYear } from "../engine-src/index";
import type { ChildInfo, HouseholdInputs, MinimumIncomeAgeBand, ParentIncome, PayFrequency, TaxYear } from "../engine-src/index";
import { useTT } from "../ui/context";
import { NumField, SelectField, Tip, Toggle } from "../ui/fields";

export function ParentForm({
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
      {parent.bonus.expectedThisYear > 0 && (
        <SelectField
          label="Bonus paid in"
          tooltip={TT.bonusMonth}
          value={String(parent.bonus.paymentMonth ?? "")}
          onChange={(v) => set({ bonus: { ...parent.bonus, paymentMonth: v ? Number(v) : null } })}
          options={[["", "Not sure (spread over the year)"], ...BONUS_MONTHS]}
        />
      )}
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
            Payroll
          </div>
          <SelectField
            label="Paid"
            tooltip={TT.payFrequency}
            value={parent.payFrequency ?? "monthly"}
            onChange={(v) => set({ payFrequency: v as PayFrequency })}
            options={[["monthly", "Monthly"], ["four_weekly", "Every 4 weeks"], ["fortnightly", "Fortnightly"], ["weekly", "Weekly"]]}
          />
          <Toggle
            label="Company director"
            value={parent.isDirector ?? false}
            tooltip={TT.director}
            onChange={(v) => set({ isDirector: v })}
          />
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: -4, marginBottom: 10 }}>
            NIC estimated per pay period; payroll may differ by a few pounds.
          </div>

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
          <NumField
            label="Employer pension contributions"
            step={500}
            tooltip={TT.employerPension}
            value={parent.employerPensionContributions ?? 0}
            onChange={(v) => set({ employerPensionContributions: v })}
            hint="Not including your salary sacrifice (entered above)"
          />
          <NumField
            label="Defined benefit pension input amount"
            step={1000}
            tooltip={TT.dbPensionInput}
            value={parent.dbPensionInputAmount ?? 0}
            onChange={(v) => set({ dbPensionInputAmount: v > 0 ? v : null })}
            hint="From your scheme's pension savings statement; 0 if none"
          />
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

/** A child's own childcare bill (optional) and whether they live with the parents. */
function ChildBillFields({ child, onChange }: { child: ChildInfo; onChange: (c: ChildInfo) => void }) {
  const TT = useTT();
  const bill = child.childcareBill;
  const quarterly = bill && "quarterly" in bill ? bill.quarterly : null;
  const annual = bill ? ("annual" in bill ? bill.annual : bill.quarterly.reduce((a, b) => a + b, 0)) : 0;
  const QUARTERS = ["Apr–Jul", "Jul–Oct", "Oct–Jan", "Jan–Apr"];
  return (
    <div style={{ marginBottom: 6 }}>
      <NumField
        label="This child's fees (before free hours)"
        step={500}
        tooltip={TT.childBill}
        value={annual}
        onChange={(v) => onChange({ ...child, childcareBill: v > 0 ? { annual: v } : undefined })}
        hint="0 = share of the household figure below"
      />
      {annual > 0 && (
        <Toggle
          label="Uneven through the year"
          value={quarterly !== null}
          onChange={(on) =>
            onChange({
              ...child,
              childcareBill: on ? { quarterly: [annual / 4, annual / 4, annual / 4, annual / 4] } : { annual },
            })
          }
        />
      )}
      {quarterly && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {quarterly.map((q, n) => (
            <NumField
              key={n}
              label={QUARTERS[n]}
              step={250}
              value={q}
              onChange={(v) => {
                const next = [...quarterly] as [number, number, number, number];
                next[n] = v;
                onChange({ ...child, childcareBill: { quarterly: next } });
              }}
            />
          ))}
        </div>
      )}
      <Toggle
        label="Usually lives with you"
        value={child.usuallyLivesWithYou ?? true}
        tooltip={TT.livesWithYou}
        onChange={(v) => onChange({ ...child, usuallyLivesWithYou: v })}
      />
    </div>
  );
}

/** Tax months for the bonus payment selector: 1 = 6 April–5 May. */
const BONUS_MONTHS: [string, string][] = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March",
].map((m, i) => [String(i + 1), `${m} payroll`]);

export function ChildrenForm({
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
        <div key={i}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
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
        <ChildBillFields child={child} onChange={(c) => {
          const n = [...children];
          n[i] = c;
          onChange(n);
        }} />
        <div style={{ marginTop: -2, marginBottom: 10 }}>
          <SelectField
            label="Extra support at age 2"
            tooltip={TT.twoYearOldExtraSupport}
            value={child.twoYearOldExtraSupport ?? ""}
            onChange={(v) => {
              const n = [...children];
              n[i] = { ...child, twoYearOldExtraSupport: (v || null) as ChildInfo["twoYearOldExtraSupport"] };
              onChange(n);
            }}
            options={[
              ["", "None"],
              ["dla", "Gets Disability Living Allowance"],
              ["ehc_plan", "Has an EHC plan"],
              ["looked_after_or_left_care", "Looked after, or left care"],
              ["benefits_route", "Family gets qualifying benefits"],
            ]}
          />
          {child.isDisabled && !child.twoYearOldExtraSupport && (
            <div style={{ fontSize: 11, color: "#b45309", marginTop: -6 }}>
              Does your child get DLA or have an EHC plan? They may qualify for 15 funded hours at age 2 regardless of income.
            </div>
          )}
        </div>
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

export function HouseholdSettingsFields({
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
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", margin: "8px 0 6px" }}>
        Tax-Free Childcare exclusions
      </div>
      {([
        ["receivesUniversalCredit", "Getting Universal Credit", TT.tfcUC, false],
        ["eitherParentReceivesChildcareVouchers", "Either parent gets childcare vouchers", TT.tfcVouchers, false],
        ["receivesChildcareBursaryOrGrant", "Getting a childcare bursary or grant", TT.tfcBursary, false],
        ["residenceConditionsConfirmed", "UK residence conditions met", TT.tfcResidence, true],
      ] as const).map(([key, label, tip, fallback]) => (
        <Toggle
          key={key}
          label={label}
          tooltip={tip}
          value={inputs.tfcExclusions?.[key] ?? fallback}
          onChange={(v) =>
            onHousehold({
              tfcExclusions: {
                receivesUniversalCredit: false,
                eitherParentReceivesChildcareVouchers: false,
                receivesChildcareBursaryOrGrant: false,
                residenceConditionsConfirmed: true,
                ...inputs.tfcExclusions,
                [key]: v,
              },
            })
          }
        />
      ))}
    </>
  );
}
