# 🧮 UK Childcare Tax Tool

> **Free, open-source calculator for UK parents navigating the £100,000 childcare cliff edge, Tax-Free Childcare, 30-hour free childcare, and the High Income Child Benefit Charge.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tax Year](https://img.shields.io/badge/Tax%20Years-2025%2F26%20%7C%202026%2F27-orange)](#tax-year-coverage)

**▶ Try it now: https://mrasrivastava.github.io/uk-childcare-tax-tool/** — no install needed, runs entirely in your browser.

---

## What this tool does

The UK childcare support system contains some of the sharpest financial cliff edges in the tax code. A parent earning £100,001 can be **thousands of pounds worse off per year** than one earning £99,999 — purely because of how eligibility thresholds interact. This tool makes those interactions visible, calculable, and actionable.

**It calculates, in one place:**

- Your **Adjusted Net Income (ANI)** — the statutory figure (ITA 2007 s.58) that controls all childcare thresholds and the personal allowance taper, which is distinct from your salary
- Eligibility for **30-hour free childcare** (working parent entitlement, England, from September 2025) — worth up to ~£8,550/year per qualifying child aged 9 months to 4 years
- Eligibility for **Tax-Free Childcare (TFC)** — the government adds £2 for every £8 you pay (20% of the childcare bill), up to £2,000/child/year (£4,000 for disabled children)
- **High Income Child Benefit Charge (HICBC)** — the clawback that starts at £60,000 ANI and reaches 100% at £80,000
- **Effective marginal rates** across £50k–£135k ANI, including the spike that can exceed 100% at the £100,001 cliff edge
- **Ranked optimisation recommendations** — pension contributions, Gift Aid, EV salary sacrifice, and more — with precise net-gain calculations
- A **downloadable PDF report** of the full household assessment

---

## Quick start

**Requirements:** Node.js 22.12+ (22 LTS recommended) and npm. The repo's `.nvmrc` pins Node 22, and `npm install` refuses older versions.

```bash
# 1. Clone
git clone https://github.com/MrASrivastava/uk-childcare-tax-tool.git
cd uk-childcare-tax-tool

# 2. Use the pinned Node version (if you use nvm)
nvm use

# 3. Install
npm install

# 4. Run
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
Per-child breakdown of free childcare eligibility with annual monetary values, TFC eligibility with estimated actual top-up, and a detailed HICBC calculation including net Child Benefit, NI credits status, and whether the charge can be paid through PAYE or must go on a Self Assessment return.

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
import { calculate, createEmptyParentIncome } from './engine-src/index';
import type { HouseholdInputs } from './engine-src/index';

const inputs: HouseholdInputs = {
  taxYear: '2025/26',
  parentA: { ...createEmptyParentIncome('Parent A'), grossSalary: 105_000 },
  parentB: { ...createEmptyParentIncome('Parent B'), grossSalary: 40_000 },
  children: [{ dateOfBirth: '2022-06-15', isDisabled: false }],
  childBenefitRegistered: true,
  childBenefitPaymentsElected: true,
  estimatedAnnualChildcareSpend: 15_000, // fees before funded hours
  providerHourlyRates: { under2: 14, age2: 12, age3to4: 11 }, // optional: your nursery's rates
  jurisdiction: 'england',
};

const result = calculate(inputs);

console.log('Parent A ANI:', result.parentA.ani.adjustedNetIncome);
// → 105000

console.log('TFC eligible:', result.tfc.eligible.status);
// → 'not_eligible' (ANI > £100k)

const top = result.optimisationRecommendations[0];
console.log(top?.lever, top?.netAnnualGain, top?.pensionPotIncrease);
// Each recommendation is priced by re-running the whole household with the
// action applied: netAnnualGain is the change in household disposable cash,
// pensionPotIncrease is reported separately.
```

---

## Testing

The calculation engine has a Vitest suite in `src/engine-src/__tests__/`. Each test pins a household scenario to a known correct figure. `golden/` holds the boundary cases and the worked examples from the audits.

```bash
npm test                  # Vitest
npm test -- --coverage    # with coverage (80% line floor on src/engine-src)
npx tsc -b                # type-check
npm run lint              # ESLint
npm run build             # production build
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request on Node 22 and 24. The GitHub Pages deploy also runs lint and tests before building. Add a test for any new calculation logic and check it against [`rules.md`](rules.md).

**Maintainers:** turn on branch protection for `main` and require the `CI` check, so a pull request that breaks a golden example can't merge. This is a repository setting, not something the code can do.

---

## Tax year coverage

| Feature | 2025/26 | 2026/27 |
|---|---|---|
| Income tax bands — England/Wales | ✅ | ✅ |
| Income tax bands — Scotland (6 bands) | ✅ | ✅ |
| Employee NIC (Class 1) | ✅ | ✅ |
| Personal Allowance taper (£100k–£125,140) | ✅ | ✅ |
| HICBC taper (£60k–£80k, 1% per £200) | ✅ | ✅ |
| 30-hour free childcare — England | ✅ | ✅ |
| Tax-Free Childcare top-up | ✅ | ✅ |
| EV salary sacrifice BiK rate | 3% | 4% |
| Pension Annual Allowance (£60,000) | ✅ | ✅ |
| Money Purchase Annual Allowance (£10,000) | ✅ | ✅ |
| Carry-forward (3-year lookback, each year's own allowance) | ✅ | ✅ |
| Savings and dividend tax (PSA, starting rate, dividend rates) | ✅ | ✅ |
| Minimum income test (3-month earnings by age band) | ✅ | ✅ |

**Known limitations** — the following are not currently modelled:

- Scotland, Wales, and Northern Ireland free childcare entitlements (different schemes and rules)
- Tapered Annual Allowance (requires employer contribution inputs not yet in the UI)
- IR35, director dividends, or complex ownership structures
- Universal Credit childcare element
- Salary sacrifice schemes beyond pension, EV, and cycle-to-work

---

## How ANI is calculated

This tool implements the four-step Adjusted Net Income calculation defined in ITA 2007 s.58:

| Step | What happens |
|---|---|
| **Step 1** | Sum all income: post-sacrifice salary, bonus, RSU vests, BiK (P11D value × BiK rate), cash allowances, non-ISA savings interest, non-ISA dividends, rental profit (before mortgage interest), self-employment profit, pension income; less net pay pension contributions |
| **Step 2** | Deduct Gift Aid donations, grossed up ÷ 0.8 |
| **Step 3** | Deduct personal pension / SIPP contributions, grossed up ÷ 0.8 (up to the higher of £3,600 and relevant UK earnings) |
| **Result** | ANI — the figure tested against all childcare thresholds and the personal allowance taper |

> **Key insight:** Salary sacrifice, EV salary sacrifice, and cycle-to-work reduce gross salary *before* Step 1 — they reduce ANI by the full sacrifice amount and also save National Insurance, making them the most efficient way to reduce ANI.

---

## Contributing

Contributions are very welcome, particularly:

- **Scotland / Wales / NI childcare entitlement rules** — the engine flags these jurisdictions but doesn't calculate them
- **2026/27 and later tax year configurations** — add to `src/engine-src/types/constants.ts`
- **Tapered Annual Allowance** — requires employer contribution inputs
- **Bug reports** — especially cases where the tool's output differs from HMRC's own calculators
- **More tests** — especially eligibility boundary conditions and cross-checks against HMRC's calculators

**How to contribute:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/scotland-free-hours`
3. Make your changes and make sure `npm test`, `npm run build` and `npm run lint` all pass
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
