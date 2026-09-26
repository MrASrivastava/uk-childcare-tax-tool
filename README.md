# 🧮 UK Childcare Tax Tool

> **Free, open-source calculator for UK parents navigating the £100,000 childcare cliff edge, Tax-Free Childcare, 30-hour free childcare, and the High Income Child Benefit Charge.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tax Year](https://img.shields.io/badge/Tax%20Year-2025%2F26-orange)](#tax-year-coverage)

---

## What this tool does

The UK childcare support system contains some of the sharpest financial cliff edges in the tax code. A parent earning £100,001 can be **thousands of pounds worse off per year** than one earning £99,999 — purely because of how eligibility thresholds interact. This tool makes those interactions visible, calculable, and actionable.

**It calculates, in one place:**

- Your **Adjusted Net Income (ANI)** — the statutory figure (ITA 2007 s.58) that controls all childcare thresholds and the personal allowance taper, which is distinct from your salary
- Eligibility for **30-hour free childcare** (working parent entitlement, England, from September 2025) — worth up to ~£8,550/year per qualifying child aged 9 months to 4 years
- Eligibility for **Tax-Free Childcare (TFC)** — the government's 25% top-up scheme, up to £2,000/child/year (£4,000 for disabled children)
- **High Income Child Benefit Charge (HICBC)** — the clawback that starts at £60,000 ANI and reaches 100% at £80,000
- **Effective marginal rates** across £50k–£135k ANI, including the spike that can exceed 100% at the £100,001 cliff edge
- **Ranked optimisation recommendations** — pension contributions, Gift Aid, EV salary sacrifice, and more — with precise net-gain calculations
- A **downloadable PDF report** of the full household assessment

---

## Quick start

**Requirements:** Node.js 18+ and npm.

```bash
# 1. Clone
git clone https://github.com/MrASrivastava/uk-childcare-tax-tool.git
cd uk-childcare-tax-tool

# 2. Install
npm install

# 3. Run
npm run dev
```

Open **http://localhost:5173** in your browser. The tool runs entirely client-side — no data leaves your device.

```bash
# Production build
npm run build        # outputs to dist/
npm run preview      # preview the built output locally
```

---

## Features

### Inputs tab
Enter income details for one or two parents: gross salary, bonus, RSU vests, pension contributions (salary sacrifice and personal), Gift Aid, savings interest, dividends, rental income, EV salary sacrifice, company car P11D, private medical insurance, and more. Every field has a plain-English tooltip explaining what to enter and how it affects ANI.

### Eligibility tab
Per-child breakdown of free childcare eligibility with annual monetary values, TFC eligibility with estimated actual top-up, and a detailed HICBC calculation including net Child Benefit, NI credits status, and Self Assessment obligation.

### Optimise tab
Ranked recommendations for actions that restore lost eligibility or protect existing eligibility, with net annual gain calculations, Annual Allowance checks, NMW breach detection, and plain-English explanations.

### Marginal rates tab
An interactive chart showing the effective marginal rate at every £1,000 of ANI from £50k to £135k, with the ability to toggle individual components (income tax, NIC, PA taper, HICBC, free hours loss, TFC loss) and a breakdown at your current ANI.

### PDF download
A six-page formatted report — cover summary, ANI waterfall, scheme eligibility detail, pension capacity, optimisation recommendations, and a marginal rate table — suitable for sharing with a financial adviser or for your own records.

---

## Project structure

```
uk-childcare-tax-tool/
├── src/
│   ├── App.tsx               # React UI — inputs, eligibility, optimise, chart tabs
│   ├── generatePDF.ts        # PDF report generator (jsPDF, pure primitives)
│   ├── index.css             # Global styles
│   ├── main.tsx              # Entry point
│   └── engine-src/           # Pure TypeScript calculation engine (zero UI deps)
│       ├── index.ts          # Public API
│       ├── engine/
│       │   ├── ani.ts        # ANI calculation — ITA 2007 s.58, four steps
│       │   ├── calculator.ts # Main orchestrator + marginal rate chart data
│       │   ├── eligibility.ts# Free hours, TFC, HICBC eligibility
│       │   └── optimiser.ts  # Eight optimisation levers
│       └── types/
│           ├── constants.ts  # Tax year configs (2025/26 and 2026/27)
│           ├── income.ts     # Input types
│           └── output.ts     # Output types
├── index.html
├── package.json
└── vite.config.ts
```

---

## Using the engine in your own project

The calculation engine is a self-contained, dependency-free TypeScript module. Import it directly:

```typescript
import { calculate } from './engine-src/index';
import type { HouseholdInputs } from './engine-src/index';

const inputs: HouseholdInputs = {
  taxYear: '2025/26',
  parentA: {
    label: 'Parent A',
    grossSalary: 105_000,
    salarySacrifice: { pension: 0, ev: null, cycleToWork: 0 },
    personalPensionContributions: { reliefAtSourceNet: 0 },
    giftAidDonationsNet: 0,
    bonus: { expectedThisYear: 0 },
    rsuVests: [],
    savingsInterestNonISA: 0,
    dividendsNonISA: 0,
    rentalIncomeNet: 0,
    selfEmploymentProfit: 0,
    pensionIncomeGross: 0,
    cashAllowances: 0,
    benefitsInKind: {
      companyCarP11DValue: 0,
      companyCarBiKRate: 0,
      privateMedicalInsurancePremium: 0,
    },
    mpaaTriggered: false,
    onStatutoryLeave: false,
    scotlandResident: false,
    priorYearPensionContributions: null,
  },
  parentB: null,
  children: [
    { dateOfBirth: '2022-06-15', isDisabled: false }
  ],
  childBenefitRegistered: true,
  childBenefitPaymentsElected: true,
  estimatedAnnualChildcareSpend: 15_000,
  jurisdiction: 'england',
};

const result = calculate(inputs);

console.log('Parent A ANI:', result.parentA.ani.adjustedNetIncome);
// → 105000

console.log('TFC eligible:', result.tfc.eligible.status);
// → 'not_eligible' (ANI > £100k)

console.log('Free hours lost annual value:', result.freeHours.totalWorkingParentAnnualValue);
// → 0 (ineligible)

console.log('Top recommendation:', result.optimisationRecommendations[0]?.lever);
// → 'salary_sacrifice_pension'

console.log('Net gain from top recommendation:',
  result.optimisationRecommendations[0]?.netAnnualGain);
// → e.g. £8,430 net gain from restoring TFC + free hours
```

---

## Testing

There is no automated test suite yet, and `npm test` is not configured. The only automated checks are the type-check and linter:

```bash
npm run build   # type-checks (tsc -b) and builds
npm run lint    # ESLint
```

Both currently report errors, mostly unused variables in the engine. Don't add new ones. Check calculation changes by hand against the rules in [`rules.md`](rules.md). Adding a test suite for the engine in `src/engine-src/` (Vitest fits the existing Vite setup) is a welcome contribution.

---

## Tax year coverage

| Feature | 2025/26 | 2026/27 |
|---|---|---|
| Income tax bands — England/Wales | ✅ | ✅ |
| Income tax bands — Scotland (6 bands) | ✅ | ✅ |
| Employee NIC (Class 1) | ✅ | ✅ |
| Personal Allowance taper (£100k–£125,140) | ✅ | ✅ |
| HICBC taper (£60k–£80k) | ✅ | ✅ |
| 30-hour free childcare — England | ✅ | ✅ |
| Tax-Free Childcare top-up | ✅ | ✅ |
| EV salary sacrifice BiK rate | 3% | 5% |
| Pension Annual Allowance (£60,000) | ✅ | ✅ |
| Money Purchase Annual Allowance (£10,000) | ✅ | ✅ |
| Carry-forward (3-year lookback) | ✅ | ✅ |

**Known limitations** — the following are not currently modelled:

- Scotland, Wales, and Northern Ireland free childcare entitlements (different schemes and rules)
- Tapered Annual Allowance (requires employer contribution inputs not yet in the UI)
- IR35, director dividends, or complex ownership structures
- Universal Credit childcare element
- Mortgage interest restriction (workaround: enter net rental profit directly)
- Salary sacrifice schemes beyond pension, EV, and cycle-to-work

---

## How ANI is calculated

This tool implements the four-step Adjusted Net Income calculation defined in ITA 2007 s.58:

| Step | What happens |
|---|---|
| **Step 1** | Sum all income: post-sacrifice salary, bonus, RSU vests, BiK (P11D value × BiK rate), cash allowances, non-ISA savings interest, non-ISA dividends, net rental income, self-employment profit, pension income |
| **Step 2** | Deduct Gift Aid donations, grossed up ÷ 0.8 |
| **Step 3** | Deduct personal pension / SIPP contributions, grossed up ÷ 0.8 |
| **Result** | ANI — the figure tested against all childcare thresholds and the personal allowance taper |

> **Key insight:** Salary sacrifice, EV salary sacrifice, and cycle-to-work reduce gross salary *before* Step 1 — they reduce ANI by the full sacrifice amount and also save National Insurance, making them the most efficient way to reduce ANI.

---

## Contributing

Contributions are very welcome, particularly:

- **Scotland / Wales / NI childcare entitlement rules** — the engine flags these jurisdictions but doesn't calculate them
- **2026/27 and later tax year configurations** — add to `src/engine-src/types/constants.ts`
- **Tapered Annual Allowance** — requires employer contribution inputs
- **Bug reports** — especially cases where the tool's output differs from HMRC's own calculators
- **Automated tests** — a test suite for the calculation engine, especially eligibility boundary conditions

**How to contribute:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/scotland-free-hours`
3. Make your changes without adding new `npm run build` or `npm run lint` errors
4. Check any new calculation logic against `rules.md`
5. Open a pull request with a clear description of the change

---

## Licence

[MIT](LICENSE) — free to use, modify, and distribute. See the disclaimer below.

---

## ⚠️ Disclaimer

**This tool is provided for educational and planning purposes only.**

- It is **not** financial advice, tax advice, or legal advice of any kind
- It does **not** constitute a regulated financial service
- Outputs are **estimates** based on the information you enter and simplified tax modelling — they may not capture every aspect of your personal tax position
- Tax law, rates, thresholds, and eligibility criteria **change each year** — always verify current rules directly with HMRC
- The tool uses the 2025/26 tax year configuration by default; results for other tax years may be inaccurate
- Residents of **Scotland, Wales, and Northern Ireland** may face different income tax rates and childcare entitlement structures — check devolved government guidance
- The authors and contributors accept **no liability** whatsoever for financial decisions made on the basis of this tool's output
- **Do your own research.** Always verify figures with HMRC's official tools and/or a qualified financial adviser or accountant before making any financial decision

**Useful HMRC resources:**
- [Check Tax-Free Childcare eligibility](https://www.gov.uk/tax-free-childcare)
- [Check 30 hours free childcare eligibility](https://www.gov.uk/30-hours-free-childcare)
- [High Income Child Benefit Charge](https://www.gov.uk/child-benefit-tax-charge)
- [Income Tax rates and Personal Allowance](https://www.gov.uk/income-tax-rates)
- [Pension Annual Allowance](https://www.gov.uk/tax-on-your-private-pension/annual-allowance)

---

*Built with [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Recharts](https://recharts.org/), and [jsPDF](https://github.com/parallax/jsPDF).*
