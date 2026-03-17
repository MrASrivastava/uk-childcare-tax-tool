# rules.md — UK Childcare Tax Tool: Canonical Rules Specification

**Version:** 1.0  
**Tax year:** 2025/26 (6 April 2025 – 5 April 2026), with 2026/27 Child Benefit rates noted where confirmed  
**Jurisdiction:** England (primary). Deviations for Scotland, Wales, Northern Ireland noted explicitly.  
**Authority:** ITA 2007, ITEPA 2003, Childcare Act 2016, HMRC guidance, DfE statutory guidance (April 2026)  
**Status:** Source of truth. All calculator logic must implement these rules exactly. Where this document conflicts with code, the document takes precedence unless a versioned amendment is recorded.

---

## PART 1: ADJUSTED NET INCOME (ANI)

### 1.1 Definition

Adjusted Net Income (ANI) is the statutory measure defined in ITA 2007, s.58. It is the single input that controls eligibility for all three childcare support schemes, the personal allowance taper, and the High Income Child Benefit Charge. It is distinct from:

- **Gross salary** — ANI includes non-salary income and excludes salary sacrifice deductions
- **Taxable income** — ANI is calculated before the personal allowance is subtracted
- **Relevant earnings** — the pension contribution limit concept; calculated differently

ANI is assessed **per individual**, not per household. There is no combined household ANI measure in UK tax law.

### 1.2 The Four-Step Calculation (ITA 2007, s.58)

```
ANI = Step1_NetIncome - Step2_GiftAid - Step3_ReliefAtSourcePension + Step4_Addback
```

#### Step 1 — Net Income

Net income = sum of all taxable income sources, less any pension contributions paid **gross** (i.e. without prior tax relief having been applied by a provider, typically under a retirement annuity contract, s.392 ITEPA).

**Taxable income sources that ADD to net income:**

| Source | Amount included | Notes |
|---|---|---|
| Employment salary (PAYE) | Gross amount | Before any salary sacrifice deductions |
| Annual / performance bonus | Gross amount in year of payment | Single-year spike risk |
| Overtime pay | Gross amount | |
| Commission | Gross amount | |
| RSUs — restricted stock units | Market value of shares at vest date | Taxed as employment income via PAYE at vest. See Section 1.3 for detail |
| Benefits in Kind (P11D) — company car (non-EV) | P11D value × BiK% (17–37%) | Added to employment income |
| Benefits in Kind (P11D) — company car (EV) | P11D value × BiK% (3% in 2025/26) | See BiK rate schedule in Section 1.4 |
| Benefits in Kind (P11D) — private medical insurance | Cost of employer premium | Very commonly overlooked |
| Benefits in Kind (P11D) — other cash equivalent benefits | As declared on P11D | |
| Cash allowances (car, phone, etc.) | Full gross value | Both income tax AND NIC apply; different from salary sacrifice |
| Self-employment / trading profit | Net profit after allowable business expenses | Trading losses may offset |
| Rental income | Net rental profit (gross rent minus allowable expenses) | Note: mortgage interest relief restricted since April 2020 — basic rate credit only |
| Savings interest (non-ISA) | Full gross amount | Personal Savings Allowance (£500 at 40% rate; £0 at 45%) reduces tax owed but does NOT reduce ANI |
| Dividends (non-ISA) | Full gross amount | £500 Dividend Allowance reduces tax owed but does NOT reduce ANI |
| Pension income (private, workplace, drawdown) | Full gross amount including lump sums | |
| State Pension | Full gross amount | |
| Income from trusts | Full amount | |
| Foreign income | Full amount | Remittance basis replaced by Foreign Income & Gains regime from 6 April 2025 |
| Tips and gratuities | Full taxable amount | |
| Taxable state benefits | Relevant amounts | |

**Income sources that do NOT add to ANI:**

| Source | Reason |
|---|---|
| ISA interest, dividends, and gains | Excluded by statute |
| Capital gains | Assessed under separate CGT regime; not part of income for ANI |
| Employer pension contributions | Not employment income; does not appear on P60 or in ANI |
| Income within a pension wrapper | Not taxable until drawn |
| Child Benefit received | Not taxable income (though may trigger HICBC charge) |

#### Step 2 — Deduct Gift Aid (grossed up)

Deduct the **grossed-up** value of any charitable donations made under Gift Aid during the tax year.

```
Step 2 deduction = net donation amount ÷ 0.8
```

Example: £800 donated to charity under Gift Aid → ANI reduced by £1,000.

The basic rate tax (20%) is reclaimed by the charity from HMRC. The donor (if a higher-rate taxpayer) claims the additional 20% relief via Self Assessment — but the ANI deduction is the gross amount regardless of the donor's tax rate.

**Constraint:** The Gift Aid donation must be supported by a valid Gift Aid declaration from the taxpayer to the charity.

#### Step 3 — Deduct relief-at-source pension contributions (grossed up)

Deduct the **gross** value of pension contributions where the pension provider claims basic rate tax relief on behalf of the member under s.192 FA 2004 (relief at source arrangements).

```
Step 3 deduction = net contribution paid by member ÷ 0.8
```

Example: Member pays £8,000 net into a personal pension or SIPP → provider claims £2,000 basic rate relief → pension pot receives £10,000 → ANI reduced by £10,000.

**Critical distinction — pension types and their ANI treatment:**

| Pension arrangement | ANI mechanism | NIC saving? |
|---|---|---|
| **Salary sacrifice pension** | Reduces gross salary before Step 1 assessment. Does NOT appear as a Step 3 deduction. Reduces ANI by reducing the baseline income. | Yes — employer and employee NIC both reduced on sacrificed amount |
| **Net pay arrangement** (most workplace schemes) | Contribution deducted from gross pay before PAYE. Reduces gross salary figure → reduces Step 1 net income. No Step 3 deduction applies. | No direct NIC saving |
| **Relief at source** (personal pension, SIPP, some group schemes) | Member pays net; provider grosses up. Deducted at Step 3. | No NIC saving |
| **Retirement annuity contract (pre-1988)** | Contribution paid gross (without prior relief). Deducted at Step 1. | No NIC saving |

**Annual Allowance constraint:** Total pension contributions (employer + employee, all sources) must not exceed the Annual Allowance in any tax year:
- Standard Annual Allowance 2025/26: £60,000
- Money Purchase Annual Allowance (MPAA — triggered if flexible drawdown accessed): £10,000
- Tapered Annual Allowance: applies where both threshold income > £200,000 AND adjusted income > £260,000. Minimum tapered allowance: £10,000.
- Carry forward: up to 3 prior years' unused allowance may be added to current year's limit, subject to rules. Cannot carry forward if the MPAA has been triggered.

**Important:** The tool must warn if a recommended pension contribution would breach the Annual Allowance or MPAA.

#### Step 4 — Add back minor reliefs

Add back any deductions made in Step 1 under s.457 or s.458 (payments to trade unions or police organisations). This is rare for typical employed individuals. Implementation: include the field but default to zero.

### 1.3 RSU (Restricted Stock Unit) Income — Detailed Rules

RSUs are a common and frequently mismodelled income source. The following rules apply:

1. **No tax on grant.** The grant date has no tax consequence.
2. **Income arises at vesting.** The taxable event is the vest date, not the grant date.
3. **Taxable amount = market value of shares on vest date.** This is treated as employment income (not capital gain).
4. **PAYE collection.** The employer withholds income tax and employee NIC via PAYE at vesting ("sell to cover" — shares sold automatically to fund the tax). RSU income appears on the P60.
5. **Employer NIC transfer.** Some employers contractually transfer their 15% employer NIC liability to the employee. Where this occurs:
   - The employer NIC (15% of vest value) is deducted from the RSU value for income tax purposes only.
   - The employer NIC is NOT deducted when calculating employee NIC.
   - Net vest value for income tax = gross vest value − employer NIC transferred to employee
   - This complexity must be a configurable input.
6. **ANI impact.** Vest value (net of any transferred employer NIC, if applicable) is added to ANI in the tax year of vesting. It is employment income — included in Step 1 net income.
7. **CGT on subsequent sale.** If shares are held after vesting and later sold, CGT applies to the gain above the market value at vest (the "base cost"). CGT is not part of ANI. Annual CGT exempt amount: £3,000 (2025/26).
8. **Planning implication.** The tool must allow the user to input expected vest dates and vest values by tax year. A single vest event can push total ANI over a threshold that would otherwise be within bounds. The tool should calculate pension carry-forward capacity to offset the spike.

### 1.4 Benefits in Kind (P11D) — BiK Rates

BiK income is added to employment income for ANI purposes. It is declared on the P11D form (or via payrolled benefits from April 2026 onwards).

**EV company car BiK rates (confirmed):**

| Tax year | BiK rate |
|---|---|
| 2025/26 | 3% |
| 2026/27 | 4% |
| 2027/28 | 5% |
| 2028/29 | 7% |
| 2029/30 | 9% |

**Formula:**
```
Annual BiK income = P11D value of vehicle × BiK%
```
P11D value = list price of the vehicle including factory-fitted options and standard accessories (VAT inclusive). The P11D value is fixed at the start of the arrangement and does not change with depreciation.

**Petrol/diesel company car BiK rates:** Range 17–37% depending on CO₂ emissions (g/km). Add 4% surcharge for diesel vehicles that do not meet RDE2 emission standard. These are not enumerated here due to range complexity — the tool should reference the HMRC published BiK table.

**Private medical insurance BiK:** The employer's premium cost is the BiK value. Added to employment income in full.

**Salary sacrifice car (EV):** Net ANI reduction = annual lease cost in sacrifice − BiK income added. Example: £6,000 annual lease on a £35,000 EV in 2025/26 → BiK = £35,000 × 3% = £1,050 → added to employment income → net ANI reduction from sacrifice = £6,000 − £1,050 = £4,950. Additionally, income tax is paid on the BiK amount at marginal rate.

---

## PART 2: THE THREE CHILDCARE SUPPORT SCHEMES

### 2.1 Shared Eligibility Conditions

All three schemes (free hours, TFC, Child Benefit) share the concept of ANI as the eligibility gate but have different thresholds and mechanisms.

**Per-individual rule:** All income thresholds are assessed against each parent's individual ANI. There is no household income test in any of these schemes. A couple where Partner A earns £99,000 and Partner B earns £99,000 (combined £198,000) qualifies for all schemes. A couple where Partner A earns £101,000 and Partner B earns £30,000 (combined £131,000) loses TFC and 30-hour entitlement for Partner A's purposes — making the household ineligible for both.

**"Partner" definition:** For these purposes, a partner is a person living with the claimant as husband, wife, or civil partner, or as if they were husband, wife, or civil partner. This includes unmarried cohabiting couples.

---

### 2.2 Scheme A: Free Funded Childcare Hours (England, from September 2025)

#### 2.2.1 Eligibility criteria

**Minimum income requirement (per working parent):**
- Must earn at least the equivalent of 16 hours per week at the National Minimum Wage (NMW)
- April 2025 NMW rate: £12.21/hour → minimum = 16 × £12.21 × 52 = **£10,158/year**
- This threshold updates each April when NMW changes. The tool must parameterise this value.
- Exception: a parent is exempt from the minimum income requirement if they are in receipt of certain disability benefits, or if the other parent is working and the non-working parent provides care

**Maximum income requirement (per parent individually):**
- ANI must not exceed **£100,000** for either parent
- This is a **hard cliff edge**: £1 over the threshold = complete loss of the working parent entitlement
- There is no taper — it is binary: eligible or not eligible

**Working requirement:**
- Both parents in a couple must individually meet the minimum income threshold (or be exempt)
- For single parents: the single parent must meet the minimum income threshold (or be exempt)

**UK residency:** Child must be ordinarily resident in England. Parent or carer must have a right to reside and be ordinarily resident in the UK.

**Child's age and term of eligibility:**
- Eligible from the **term after** the child reaches the relevant age
- The relevant ages and their start dates are:

| Child's date of birth | Age milestone | Entitlement begins |
|---|---|---|
| 1 January – 31 March | 9 months | 1 April of that year |
| 1 April – 31 August | 9 months | 1 September of that year |
| 1 September – 31 December | 9 months | 1 January of the following year |

The same term-start rule applies for the 2-year-old and 3-year-old milestones.

**Entitlement ends:** The term before the child reaches compulsory school age (the beginning of the term following their fifth birthday).

#### 2.2.2 Hours entitlement by age (England, from September 2025)

| Child's age | All families (disadvantaged only for 2yr) | Working parent eligible families |
|---|---|---|
| 9 months – 2 years (i.e. under 2) | 0 hours | **30 hours/week (term-time)** |
| 2 years (exactly) | 15 hours/week (disadvantaged only) | **30 hours/week (term-time)** |
| 3 years – school age | **15 hours/week (universal, all families)** | **30 hours/week (term-time)** |

**Term-time definition:** 38 weeks per year minimum; maximum 52 weeks depending on provider. The statutory entitlement is **570 hours per year** (30 hours × 38 weeks = 1,140 hours capped at 570 for the base universal entitlement, 1,140 for the full working parent entitlement). Providers may stretch the hours across more weeks at fewer hours per week.

**Provider top-up charges:** Providers may charge additional fees above the government-funded rate for meals, consumables, and extra hours. They may not charge for the funded hours themselves. The tool should note this when displaying monetary value of entitlement.

#### 2.2.3 Application and reconfirmation

- Apply via HMRC's Childcare Service (online) or by phone
- Successful application generates an eligibility code (starts '50' for digitally issued codes)
- Temporary/manually issued codes start '11'; foster parent codes start '40'
- **Reconfirmation every 3 months** is mandatory. Failure to reconfirm = loss of eligibility code
- If a parent becomes ineligible at reconfirmation (e.g. income has risen over £100k), a **grace period** applies while the child already has a place. The local authority continues to fund the place for a limited period (usually until the next term boundary). The tool must flag this transition state.
- Application deadlines: to start from September term — apply by 31 August; January term — by 31 December; April term — by 31 March.

#### 2.2.4 Monetary value estimation

```
Annual value = funded_hours_per_week × term_weeks × local_hourly_rate
```

The government sets national funding rates paid to local authorities. Local authorities set provider rates. Average national rates (2025/26 guidance):
- Under 2s: ~£11.00/hour
- 2-year-olds: ~£9.00/hour
- 3–4-year-olds: ~£7.50/hour

These figures are indicative. The tool should use configurable regional rates. Inner London rates are significantly higher.

**Default calculation for the tool (national average):**
```
30-hour entitlement value per child per year:
  Under 2: 30 × 38 × £11.00 = £12,540
  Age 2:   30 × 38 × £9.00  = £10,260
  Age 3-4: 30 × 38 × £7.50  = £8,550
  
  (compared to universal 15hr value for age 3-4: 15 × 38 × £7.50 = £4,275)
  Incremental value of working parent entitlement for age 3-4: £8,550 − £4,275 = £4,275
```

---

### 2.3 Scheme B: Tax-Free Childcare (TFC)

#### 2.3.1 How the scheme works

- Parent opens a TFC account via HMRC's Childcare Service
- For every £8 paid in by the parent, the government tops up by £2 (= 20% basic rate tax relief)
- Maximum government top-up: **£500 per child per quarter** (£2,000 per child per year)
- To receive the maximum annual top-up, the parent must pay in £8,000 per child per year
- For disabled children: maximum government top-up is £1,000 per quarter (£4,000/year); parent must pay in £16,000/year to receive maximum
- Funds can only be used with approved childcare providers (nurseries, childminders, after-school clubs, holiday clubs)

#### 2.3.2 Eligibility criteria

**Per-parent income test:**
- Each parent must have ANI of at least £10,158/year (minimum income threshold — same as free hours)
- Each parent must have ANI of no more than £100,000
- If either parent's ANI exceeds £100,000: the **entire family is disqualified** from TFC
- This is a hard binary cliff edge. There is NO taper.

**Exception — one parent not working:**
- The non-working parent's income threshold (minimum) is waived if they are:
  - On maternity, paternity, adoption, or shared parental leave
  - Unable to work due to disability
  - A carer

**Child's age:** The child must be under 12 years old (under 17 for disabled children).

**Incompatible with:**
- Universal Credit
- Tax Credits (Working Tax Credit or Child Tax Credit)
- Childcare vouchers (legacy scheme, closed to new entrants October 2018; existing voucher holders continue separately)
- Employer-supported childcare vouchers

**Compatible with (can be used simultaneously):**
- Free funded childcare hours (Schemes A/B can be used together)

#### 2.3.3 Penalty for over-claiming

If a parent's ANI exceeds £100,000 in a tax year and they continue to claim TFC:
- They must repay all government top-ups received since the point of ineligibility
- HMRC may impose a penalty of up to 50% of the top-up amounts incorrectly claimed
- The tool must prominently warn users who are near the £100,000 threshold

#### 2.3.4 Monetary value

```
Annual TFC benefit per child = min(childcare_spend ÷ 4, 2000)
```

Maximum value = £2,000/year/child (£4,000 for disabled children).

If a family has two eligible children and spends ≥ £16,000/year on childcare, maximum TFC value = £4,000/year.

---

### 2.4 Scheme C: Child Benefit and the High Income Child Benefit Charge (HICBC)

#### 2.4.1 Child Benefit rates

| Period | First/only child | Each additional child |
|---|---|---|
| 2025/26 | £25.60/week (£1,331/year) | £16.95/week (£881/year) |
| 2026/27 (confirmed) | £27.05/week (~£1,407/year) | £17.90/week (~£931/year) |

Payments made every 4 weeks. Pro-rated for partial year claims.

#### 2.4.2 Eligibility for Child Benefit

Child Benefit is a universal benefit — anyone responsible for a child under 16 (or under 20 in approved education or training) may claim. There is no income test on eligibility to claim. The income test applies only to whether the HICBC claws it back.

**Important:** Even if a family is liable to repay 100% of Child Benefit via HICBC, they should still register to claim. Registration preserves:
1. **National Insurance credits** for the person receiving Child Benefit, if they are not working or earning below the Lower Earnings Limit (£6,396 in 2025/26). These are Class 3 NI credits counting toward the State Pension.
2. **Automatic NI number issuance** for the child before their 16th birthday.

The correct strategy for a family where HICBC will fully claw back the payment: register for Child Benefit but **elect not to receive the payment**. This preserves NI credits without any tax filing obligation.

From April 2026, HMRC will allow individuals to claim NI credits retrospectively for years since 2013 in which they did not claim Child Benefit — but this is complex and the tool should still recommend registering.

#### 2.4.3 The High Income Child Benefit Charge (HICBC)

**Trigger:** The HICBC applies when the **higher-earning** partner in a household has ANI exceeding **£60,000** in a tax year.

**Who pays:** The higher earner must pay the charge, regardless of which partner receives the Child Benefit payment.

**Taper (from April 2024 onwards):**
```
HICBC = total_child_benefit_received × min((ANI − 60000) ÷ 20000, 1.0)
```

This equates to: 1% of Child Benefit for every £200 of ANI above £60,000.

| Higher earner's ANI | % of Child Benefit clawed back |
|---|---|
| ≤ £60,000 | 0% |
| £62,000 | 10% |
| £65,000 | 25% |
| £70,000 | 50% |
| £75,000 | 75% |
| £80,000 | 100% |
| > £80,000 | 100% (no further increase) |

**Worked example:**
```
Family: 2 children, higher earner ANI = £76,000
Annual Child Benefit = £1,331 + £881 = £2,212
Excess over £60,000 = £16,000
HICBC = £2,212 × (£16,000 / £20,000) = £2,212 × 0.8 = £1,770
Net Child Benefit retained = £2,212 − £1,770 = £442/year
```

**Pre-April 2024 taper (for reference, do not apply to current years):**
- Previously: 1% per £100 over £50,000; fully clawed back at £60,000.

#### 2.4.4 Self Assessment obligation

If either partner's ANI exceeds £60,000 AND Child Benefit was received in the year, the higher earner must register for and complete Self Assessment. They must:
- File a return by 31 January following the tax year
- Declare and pay the HICBC via Self Assessment
- Alternatively, if HICBC ≤ £3,000, may elect to have it collected via PAYE tax code (requires online return filed by 30 December)

Failure to register or file = late filing penalties + interest on unpaid tax.

#### 2.4.5 Opting out of Child Benefit payments

A person may register to claim Child Benefit but elect not to receive the cash payment. This:
- Eliminates the HICBC liability (no payment = no charge)
- Eliminates the Self Assessment filing obligation arising from HICBC
- Preserves NI credits
- Preserves automatic NI number for the child

**The tool must recommend this strategy** for any household where the higher earner's ANI is projected to be ≥ £80,000 and the family is not planning to reduce ANI below that level.

---

## PART 3: PERSONAL ALLOWANCE TAPER

### 3.1 The Taper Rule

The personal allowance (PA) is reduced where ANI exceeds £100,000:

```
Effective personal allowance = max(12570 − max(ANI − 100000, 0) ÷ 2, 0)
```

| ANI | Personal Allowance |
|---|---|
| ≤ £100,000 | £12,570 |
| £110,000 | £7,570 |
| £120,000 | £2,570 |
| £125,140 | £0 |
| > £125,140 | £0 |

### 3.2 The 60% Effective Marginal Rate

Within the taper zone (£100,000 – £125,140), each £2 of additional income results in:
- £1 of taxable income (direct income)
- £1 of previously tax-free personal allowance now becoming taxable

Net effect: 40% on the direct income + 40% on the recovered allowance = **effective marginal rate of 60%** on income in this band.

For additional rate (45%) taxpayers above £125,140: effective marginal rate returns to 45%.

### 3.3 Interaction with Childcare Cliff Edge

At exactly £100,001:
1. Personal allowance taper begins (effective 60% marginal rate on next £25,140)
2. TFC eligibility lost (hard cliff)
3. 30-hour working parent entitlement lost for children under 3
4. This stacks with HICBC loss (already lost at £80,000)

The combined effect for a family with two young children: earning £1 above £100,000 can cost **£25,000–£32,000** in annual support and tax efficiency. The marginal "cost" of that £1 is not 60p in tax — it is potentially several thousand pounds in lost benefits.

---

## PART 4: MITIGATION LEVERS — PRECISE RULES

### 4.1 Salary Sacrifice Pension

**ANI mechanism:** Salary sacrifice reduces contractual gross salary. The reduction appears before Step 1 — it reduces the gross income that enters the ANI calculation. It is NOT a Step 3 deduction.

**NIC saving:** Employee NIC saved at:
- 8% on sacrificed amounts between £12,570 and £50,270
- 2% on sacrificed amounts above £50,270
- Employer NIC also saved at 15% (2025/26) on sacrificed amount

**Annual Allowance constraint:** All pension contributions (salary sacrifice + any other pension) must not exceed the Annual Allowance in the tax year. The tool must sum all pension contributions before recommending additional sacrifice.

**Side effects:**
- Reduces gross contractual salary → may reduce mortgage affordability assessment
- May reduce Statutory Maternity/Paternity Pay (SMP/SPP) if employer uses post-sacrifice salary as the basis
- May reduce death-in-service and other salary-linked benefits
- May reduce employer pension contributions if calculated as % of post-sacrifice salary (check employer policy)
- Cannot reduce cash pay below National Minimum Wage (£12.21/hour × contracted hours in 2025/26)

**2029 change warning:** From April 2029, employer NIC relief on salary sacrifice pension contributions will be subject to a cap. This does NOT affect the income tax or employee NIC efficiency of salary sacrifice. The tool must note this horizon where relevant but should not devalue salary sacrifice recommendations for the current period.

### 4.2 Relief-at-Source Personal Pension / SIPP

**ANI mechanism:** Step 3 deduction. Gross contribution (net paid + 20% basic rate relief) is deducted from ANI.

```
ANI reduction = net_contribution_paid ÷ 0.8
```

**NIC saving:** None. This is the key disadvantage vs salary sacrifice.

**Higher-rate relief:** The Step 3 deduction adjusts the taxpayer's tax bands, effectively restoring higher-rate relief automatically. No additional claim is needed for the ANI effect. (A separate higher-rate relief claim via Self Assessment may be needed to receive a rebate on the marginal rate difference, but this is a tax calculation matter, not an ANI matter.)

**Annual Allowance constraint:** Same as salary sacrifice — total contributions across all pensions must not exceed the Annual Allowance.

**Carry forward:**
- Unused Annual Allowance from up to 3 prior tax years may be carried forward
- Must have been a member of a registered pension scheme in those years
- Cannot carry forward if the MPAA has been triggered
- Carry forward calculation: (prior year AA − prior year total contributions) × 3 years maximum
- This enables large one-off contributions in RSU vesting years or bonus years

### 4.3 Gift Aid

**ANI mechanism:** Step 2 deduction. Grossed-up donation deducted from ANI.

```
ANI reduction = net_donation ÷ 0.8
```

**Efficiency note:** For every £80 donated, ANI falls by £100. The "cost" of a £100 ANI reduction via Gift Aid is £80 cash out of pocket. Compare to pension contribution: £80 net into pension = £100 gross ANI reduction, but the pension contribution also builds retirement savings. Gift Aid is therefore less efficient than pension unless the charitable giving was planned regardless.

**Timing:** Donations must be made in the relevant tax year, or within a limited window to be carried back to the prior year (election must be made on the Self Assessment return).

### 4.4 Salary Sacrifice EV (Electric Vehicle)

**ANI mechanism:** Lease cost sacrificed reduces gross salary → reduces ANI (Step 1). BiK income is added back (P11D BiK value added to employment income via payroll).

```
Net ANI reduction = annual_lease_cost_sacrificed − (P11D_value × BiK_rate)
```

**Example (2025/26):**
```
Annual lease sacrificed: £6,000
P11D value of EV: £35,000
BiK rate: 3%
BiK income added: £35,000 × 3% = £1,050
Net ANI reduction: £6,000 − £1,050 = £4,950
Extra income tax on BiK (40% taxpayer): £1,050 × 40% = £420
Net cash impact: lease is effectively funded at £6,000 − 40% tax saving − 2% NIC saving − £420 BiK tax
```

**Note:** The BiK tax payable on the EV reduces but does not eliminate the ANI benefit. At 3% BiK the EV scheme is very attractive for ANI management.

**2029 BiK rate trajectory:** 7% in 2028/29, 9% in 2029/30. The tool should model future years where relevant.

**Confirmed protection:** EV salary sacrifice is not subject to the 2029 pension NIC changes. The government has explicitly confirmed EV scheme tax treatment is unaffected.

### 4.5 Salary Sacrifice Cycle-to-Work

**ANI mechanism:** Same as EV — sacrifice reduces gross salary → reduces ANI.

**No upper official limit** since 2019, but most employer schemes cap at £1,000–£5,000 per year. Input as a configurable field.

**No BiK:** Provided the bike is used primarily for qualifying journeys (commuting), there is no P11D BiK charge.

### 4.6 Bonus Deferral

**Mechanism:** If ANI is projected to exceed a threshold in the current tax year due to a discretionary bonus, the employer may be asked to defer the bonus payment to the following tax year.

**Rules:**
- Must be requested **before the bonus becomes contractually due** (before it is "earned" in the HMRC sense)
- Discretionary bonuses can be deferred; contractual bonuses typically cannot
- Creates a one-year shift in ANI — moves income from a spike year to the following year
- Has no effect on total lifetime income; affects only the year of receipt for ANI purposes

**Tool implementation:** Flag when projected bonus + salary will exceed a threshold. Prompt: "Would you like to model deferring part of this bonus to next tax year?"

### 4.7 ISA Contribution

**ANI mechanism:** Income generated within an ISA (interest, dividends, capital gains) is excluded from ANI by statute.

**Annual ISA allowance:** £20,000 per person per tax year (2025/26).

**Use case:** A person earning £92,000 with £200,000 in a non-ISA savings account generating 5% interest = £10,000 interest income → ANI = £102,000. Moving savings to ISA eliminates the £10,000 ANI addition. Over time, maximising ISA contributions prevents future income from pushing over thresholds.

**Limitation:** ISA contributions are annual; existing non-ISA savings cannot all be ISA-ified in one year.

### 4.8 Income Redistribution Between Partners

**Mechanism:** Transfer income-generating assets (savings, investments, rental property) to the lower-earning partner. Income from those assets then becomes the lower earner's income, reducing the higher earner's ANI.

**Legal constraints:**
- HMRC's settlements legislation (ITTOIA 2005, Part 5) can apply where income from assets is redirected to a spouse/civil partner as part of an arrangement. However, outright gifts of capital are generally protected from this.
- Transfer of assets must be genuine and unconditional
- Not available for salary or employment income (cannot split employment income with a partner)

**Limitation:** Does not reduce total household tax burden in all cases. Reduces one individual's ANI — which is the objective for childcare threshold management.

---

## PART 5: INCOME TAX BANDS AND NIC — REFERENCE

### 5.1 Income Tax Bands (England/Wales/NI, 2025/26)

| Band | Taxable income range (after PA) | Rate |
|---|---|---|
| Personal Allowance | £0 – £12,570 | 0% |
| Basic rate | £12,571 – £50,270 | 20% |
| Higher rate | £50,271 – £125,140 | 40% |
| Additional rate | Over £125,140 | 45% |

Note: PA tapers from £100,000 ANI; fully withdrawn at £125,140 ANI.

### 5.2 Scotland — Income Tax

Scotland has its own income tax bands (administered by Revenue Scotland). Key differences in 2025/26:

| Scottish band | Rate | Threshold |
|---|---|---|
| Starter rate | 19% | £12,571 – £15,397 |
| Basic rate | 20% | £15,398 – £27,491 |
| Intermediate rate | 21% | £27,492 – £43,662 |
| Higher rate | 42% | £43,663 – £75,000 |
| Advanced rate | 45% | £75,001 – £125,140 |
| Top rate | 48% | Over £125,140 |

**Scotland and childcare:** Scotland has its own childcare entitlement scheme (1,140 hours/year = 30 hours/week for 38 weeks, from age 3). Different funding rates and administration. The £100,000 ANI threshold for TFC applies UK-wide. The free hours threshold: the Scottish scheme has slightly different eligibility rules — the tool must clearly flag jurisdiction.

### 5.3 National Insurance Contributions (Class 1 Employee, 2025/26)

| Band | Rate |
|---|---|
| Up to £12,570 (Primary Threshold) | 0% |
| £12,571 – £50,270 (Upper Earnings Limit) | 8% |
| Above £50,270 | 2% |

**Impact of salary sacrifice on NIC:** NIC is calculated on post-sacrifice gross pay. All salary sacrifice arrangements reduce NIC at the applicable rate on the sacrificed amount.

---

## PART 6: EDGE CASES AND INTERACTION EFFECTS

### 6.1 Variable Income — Year-End Projection

The tool must allow users to project full-year ANI based on:
- Year-to-date income received
- Remaining expected income (salary months remaining, expected bonus, vest dates)

If projected ANI is near a threshold (within £5,000), the tool should trigger a warning and calculate the mitigation required.

### 6.2 Mid-Year Threshold Crossing

**Child Benefit / HICBC:** Assessed on full-year ANI. If a parent earns over £60,000 in a tax year, the HICBC applies to all Child Benefit received that year. There is no partial-year apportionment.

**TFC:** If a parent's ANI exceeds £100,000 at any point in a 3-month reconfirmation period, they must report this to HMRC and cease making new claims. Top-ups received after ineligibility must be repaid.

**Free hours:** Assessed at each 3-month reconfirmation. If income rises above £100,000 and the parent fails to reconfirm eligibility correctly, overpayments may be reclaimed.

### 6.3 Grace Period (Free Hours)

When a parent ceases to be eligible upon reconfirmation (e.g. income has risen above £100,000), but the child is already receiving funded childcare:
- The local authority continues to fund the place for a **grace period**
- Grace period typically runs to the end of the current term or a fixed period after ineligibility is confirmed
- The grace period end date is encoded in HMRC's Eligibility Checking System (ECS)
- Parents must be told of the grace period end date by their provider

**Tool implementation:** Flag when eligibility is borderline and note that a grace period applies if the child is already in a funded place.

### 6.4 Employer NIC on RSUs — Calculation Sequence

Where an employer transfers their Class 1 NIC liability to the employee on an RSU vest:

```
Gross RSU vest value: V
Employer NIC rate: 15% (2025/26)
Employer NIC transferred: T = V × 0.15

For income tax calculation:
  Taxable employment income = V − T = V × 0.85

For employee NIC calculation:
  Employee NIC base = V (NOT V − T)
  
For ANI:
  ANI addition = V − T (net of transferred employer NIC)
```

### 6.5 Pension Annual Allowance — Tapered Allowance

Tapered Annual Allowance applies where:
- **Threshold income** > £200,000 AND
- **Adjusted income** > £260,000

Threshold income = net income (Step 1 of ANI calculation) excluding pension contributions made under net pay arrangements.
Adjusted income = threshold income + employer pension contributions.

Where tapered allowance applies:
```
Tapered AA = max(60000 − (adjusted_income − 260000) ÷ 2, 10000)
```

The tool must check both threshold income AND adjusted income before recommending pension contributions near these levels.

### 6.6 MPAA (Money Purchase Annual Allowance)

Once a person has flexibly accessed a money purchase pension (e.g. drawn down a lump sum from a SIPP), the MPAA is triggered. From that point:
- The allowance for money purchase (defined contribution) contributions = **£10,000** (not £60,000)
- Carry forward rules do **not** apply to money purchase contributions after MPAA is triggered
- The remaining £50,000 of the standard AA may be used for defined benefit pension accrual only

**Tool implementation:** Include a flag "Have you ever flexibly accessed a pension?" If yes, apply MPAA rules and warn before recommending large pension contributions.

### 6.7 Jurisdictional Differences Summary

| Scheme | England | Scotland | Wales | Northern Ireland |
|---|---|---|---|---|
| Free funded hours (working parent) | 30 hrs, 9m+, ANI £10,158–£100k | 1,140 hrs/year from age 3 (different structure) | 30 hrs from age 3 for eligible working parents | Not available; NICSS subsidy scheme instead |
| Universal free hours | 15 hrs age 3–4 | 1,140 hrs/year from age 3 (universal) | 10 hrs age 3–4 (Moving to 30 hrs by 2027) | 12.5 hrs age 3–4 |
| Tax-Free Childcare | UK-wide: same rules | Same | Same | Same |
| Child Benefit / HICBC | UK-wide: same rules | Same (but Scottish income tax applies) | Same | Same |
| Income tax | Standard UK bands | Scottish bands (higher rates) | Standard UK bands | Standard UK bands |

---

## PART 7: CALCULATION SEQUENCE FOR THE TOOL

When a user provides their inputs, the tool must compute in the following sequence:

```
1. Compute gross income for each parent:
   a. Salary (post-salary-sacrifice if applicable)
   b. Add: bonus (if in current year)
   c. Add: RSU vest value (net of transferred employer NIC if applicable)
   d. Add: P11D BiK values (company car, PMI, other)
   e. Add: cash allowances
   f. Add: self-employment profit
   g. Add: rental income (net)
   h. Add: savings interest (non-ISA)
   i. Add: dividends (non-ISA)
   j. Add: pension income / drawdown
   k. Add: other taxable income
   = Step 1 Net Income

2. Apply Step 2 deduction: − grossed-up Gift Aid
3. Apply Step 3 deduction: − grossed-up relief-at-source pension contributions
4. Apply Step 4 add-back: + s.457/458 reliefs (usually zero)
   = ANI for each parent individually

5. Apply eligibility tests per parent:
   a. Is ANI ≥ £10,158? (minimum income — working parent schemes)
   b. Is ANI ≤ £100,000? (maximum income — TFC and free hours)
   c. Is ANI ≤ £60,000 / £80,000? (HICBC thresholds)

6. Determine household eligibility:
   a. Free hours: both parents must meet conditions a and b
   b. TFC: EITHER parent exceeding £100k = disqualified
   c. Child Benefit: universal; HICBC applied to higher earner's ANI

7. Compute annual value of entitlements:
   a. Free hours monetary value (by child age, local rate)
   b. TFC maximum top-up (by number of eligible children)
   c. Child Benefit gross (by number of children)
   d. HICBC deduction (applied to higher earner's ANI)
   e. Net Child Benefit value

8. Compute personal allowance (per parent):
   PA = max(12570 − max(ANI − 100000, 0) ÷ 2, 0)

9. Compute income tax (per parent) applying PA and tax bands

10. Compute total family position:
    a. Parent A net take-home
    b. Parent B net take-home
    c. Net Child Benefit value
    d. TFC top-up value
    e. Free hours value (net of top-up fees where applicable)
    f. Total household net income + benefits

11. Run optimisation:
    a. For each scheme that is lost: compute minimum ANI reduction required to restore
    b. For each mitigation lever available: compute ANI reduction per £ of action
    c. Rank by: (benefit_restored − cost_of_action) for each scenario
    d. Flag Annual Allowance headroom and carry-forward capacity
    e. Flag NMW constraint on salary sacrifice
    f. Flag mortgage / statutory pay implications of salary sacrifice
```

---

## PART 8: DATA INPUTS REQUIRED

### 8.1 Per-parent inputs

```typescript
interface ParentIncome {
  // Employment
  grossSalary: number;                    // Annual gross salary (pre-sacrifice)
  
  salarysacrifice: {
    pension: number;                      // Annual salary sacrifice to pension
    ev: {
      annualLeaseCost: number;            // Annual lease cost sacrificed
      vehicleP11DValue: number;           // List price for BiK calculation
    };
    cycleToWork: number;                  // Annual cycle-to-work sacrifice
    other: number;                        // Any other salary sacrifice arrangements
  };
  
  bonus: {
    expected: number;                     // Expected bonus this tax year (gross)
    isDiscretionary: boolean;             // Whether deferral is possible
  };
  
  rsuVests: Array<{
    vestDate: Date;                       // Date of vesting
    grossValue: number;                   // Market value at vest
    employerNICTransferred: boolean;      // Whether employer NIC is transferred to employee
  }>;
  
  benefitsInKind: {
    companyCarP11DValue: number;          // 0 if no company car
    companyCarBiKRate: number;            // % rate (e.g. 0.03 for EV, 0.25 for typical petrol)
    privateMedicalInsurance: number;      // Annual employer premium cost
    other: number;                        // Other P11D benefits
  };
  
  cashAllowances: number;                 // Car allowance, phone allowance, etc.
  
  // Non-employment income
  selfEmploymentProfit: number;           // Net trading profit
  rentalIncome: number;                   // Net rental profit (after allowable expenses)
  savingsInterestNonISA: number;          // Non-ISA savings interest
  dividendsNonISA: number;               // Non-ISA dividend income
  pensionIncome: number;                  // Any pension income / drawdown
  otherTaxableIncome: number;             // Any other taxable income
  
  // Deductions
  personalPensionContributions: number;   // Net contributions to personal pension / SIPP
  giftAidDonations: number;               // Net charitable donations under Gift Aid
  
  // Pension status
  pensionMPAATriggered: boolean;          // Has flexible drawdown been accessed?
  unusedPensionAllowance: {
    yearMinus1: number;
    yearMinus2: number;
    yearMinus3: number;
  };
  
  // Location
  scotlandResident: boolean;
}
```

### 8.2 Household / family inputs

```typescript
interface HouseholdInputs {
  parentA: ParentIncome;
  parentB: ParentIncome | null;           // null for single-parent household
  
  children: Array<{
    dateOfBirth: Date;
    isDisabled: boolean;
  }>;
  
  childBenefitClaimed: boolean;
  childBenefitPaymentElected: boolean;    // false = registered but opted out of payments
  
  jurisdiction: 'england' | 'scotland' | 'wales' | 'northern_ireland';
  
  localHourlyRate: {
    under2: number;                       // Local authority funded rate, £/hr
    age2: number;
    age3to4: number;
  };
}
```

---

## PART 9: OUTPUT SPECIFICATION

The tool must produce the following outputs clearly labelled:

### 9.1 ANI summary (per parent)

- Gross income components (itemised)
- Salary sacrifice reductions
- Step 2 Gift Aid deduction
- Step 3 pension deduction
- **Calculated ANI**
- Distance to nearest threshold (e.g. "£3,240 below £100,000 threshold")

### 9.2 Eligibility status

For each scheme, per child:
- Status: ELIGIBLE / NOT ELIGIBLE / AT RISK (within £5,000 of threshold)
- Reason for ineligibility (where applicable)
- Annual monetary value (where eligible)
- Annual monetary value lost (where ineligible)

### 9.3 Total family position

- Parent A net take-home after tax and NIC
- Parent B net take-home after tax and NIC
- Child Benefit net (gross less HICBC)
- TFC annual top-up
- Free hours annual value
- **Total household net income + benefits**

### 9.4 Optimisation recommendations

For each threshold breach:
- Minimum action required to restore eligibility
- Available levers (ranked by cost-effectiveness)
- For each lever: cost to implement / ANI reduction / benefit restored / net gain
- Annual Allowance remaining headroom
- Any contraindications (MPAA, NMW risk, mortgage impact)

### 9.5 Marginal rate chart

Plot effective marginal rate for each parent across £50,000 – £135,000 ANI range, incorporating:
- Income tax marginal rate
- NIC marginal rate
- Personal allowance taper effect
- HICBC withdrawal rate
- Childcare benefit loss (annualised, as an effective marginal "charge" on the pound crossing the threshold)

---

## PART 10: KNOWN LIMITATIONS AND DISCLAIMERS

1. **Not financial advice.** This tool provides estimates for educational and planning purposes only. Users should consult a qualified financial adviser or accountant before making decisions.

2. **Tax year scope.** Rules are specified for 2025/26. Rates and thresholds are updated annually by HMRC. The tool must flag when rules may have changed.

3. **Employer scheme variability.** Salary sacrifice rules depend on employer policy. Pension contribution calculations, NMW buffers, and statutory pay impacts vary by employer. The tool provides general rules; users must verify with their employer's HR/payroll.

4. **Self-employment complexity.** This tool models simple self-employment profit. Complex situations (IR35, company director dividends, partnership income) require additional logic not fully captured here.

5. **Rental income allowable expenses.** The tool uses net rental profit as an input. Calculating net rental profit (especially under the mortgage interest restriction rules) requires separate detailed inputs not modelled here.

6. **Scotland jurisdiction.** Scottish income tax band calculations use Scottish rates but the ANI framework and childcare thresholds apply in the same way. Free hours entitlement in Scotland follows a different structure and is not fully modelled in v1.

7. **Child Benefit for children in education over 16.** Child Benefit continues to age 20 for approved education/training. This tool models the primary use case of children under 16.

8. **Universal Credit interaction.** Families on Universal Credit cannot use Tax-Free Childcare simultaneously. The tool does not model Universal Credit calculations. Users should separately assess which is more beneficial.

---

*End of rules.md v1.0*
