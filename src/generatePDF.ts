/**
 * generatePDF.ts
 *
 * Produces a properly formatted multi-page A4 PDF report.
 * Uses jsPDF primitives (text + rectangles) -- NOT html2canvas/screenshot.
 *
 * ENCODING: jsPDF's built-in helvetica uses WinAnsi (cp1252). Characters
 * outside that range (warning symbols, arrows, emoji etc.) produce garbled
 * output. All text is passed through safe() which replaces non-WinAnsi
 * characters with ASCII equivalents before any pdf.text() call.
 *
 * Pages:
 *   1  Cover -- summary totals + at-risk alerts + scheme-value bar chart
 *   2  ANI Breakdown -- per-parent waterfall + ANI-vs-thresholds ruler
 *   3  Scheme Eligibility -- free hours / TFC / Child Benefit detail
 *   4  Pension Capacity
 *   5+ Optimisation Recommendations
 *   Last  Marginal Rate Table + income-split chart + disclaimer
 */

import jsPDF from "jspdf";
import type { CalculationResult } from "./engine-src/index";
import { getTaxYearConfig } from "./engine-src/index";
import { pdfCoverSubtitle, pdfPageHeader } from "./pdfText";

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const NAVY   = [15,  23,  42 ] as [number,number,number];
const SLATE  = [71,  85,  105] as [number,number,number];
const MUTED  = [100,116,139]  as [number,number,number];
const RED    = [185, 28,  28 ] as [number,number,number];
const GREEN  = [21,  128, 61 ] as [number,number,number];
const AMBER  = [180, 83,  9  ] as [number,number,number];
const PURPLE = [109, 40,  217] as [number,number,number];
const LIGHT  = [248,250,252]  as [number,number,number];
const BORDER = [226,232,240]  as [number,number,number];
const WHITE  = [255,255,255]  as [number,number,number];

const ZONE_GREEN  = [220,252,231] as [number,number,number];
const ZONE_AMBER  = [254,243,199] as [number,number,number];
const ZONE_RED    = [254,226,226] as [number,number,number];
const ZONE_PURPLE = [237,233,254] as [number,number,number];
const ZONE_GRAY   = [241,245,249] as [number,number,number];

const PAGE_W    = 210;
const PAGE_H    = 297;
const ML        = 14;
const CONTENT_W = PAGE_W - ML * 2;

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
const fmtGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number, decimals = 1) => `${(n * 100).toFixed(decimals)}%`;

/**
 * Strip characters outside WinAnsi (latin-1 supplement + printable ASCII).
 * jsPDF helvetica cannot render anything above U+00FF cleanly.
 * The pound sign \xA3 IS in WinAnsi and is safe.
 */
function safe(text: string): string {
  return text.replace(/[^\x20-\xFF]/g, (ch) => {
    const map: Record<string, string> = {
      "\u2019": "'",  "\u2018": "'",
      "\u201C": '"',  "\u201D": '"',
      "\u2014": "--", "\u2013": "-",
      "\u2026": "...","\u00A3": "\xA3",
    };
    return map[ch] ?? "?";
  });
}

const GBP = "\xA3"; // safe pound sign for inline use

const LEVER_NAMES: Record<string, string> = {
  salary_sacrifice_pension: "Salary sacrifice pension",
  personal_pension_sipp:    "Personal pension / SIPP",
  gift_aid:                 "Gift Aid donation",
  ev_salary_sacrifice:      "EV salary sacrifice",
  cycle_to_work:            "Cycle-to-work scheme",
  bonus_deferral:           "Bonus deferral",
  isa_migration:            "Move savings to ISA",
  income_redistribution:    "Redistribute income to partner",
};

// ---------------------------------------------------------------------------
// Doc helper class
// ---------------------------------------------------------------------------
class Doc {
  pdf: jsPDF;
  y: number;
  pageNum: number;
  _pageTitle: string;
  headerText: string;

  constructor(headerText: string) {
    this.headerText = headerText;
    this.pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    this.y = 0;
    this.pageNum = 0;
    this._pageTitle = "";
  }

  newPage(title = "") {
    if (this.pageNum > 0) this.pdf.addPage();
    this.pageNum++;
    this._pageTitle = title;

    // Header band
    this.pdf.setFillColor(...NAVY);
    this.pdf.rect(0, 0, PAGE_W, 10, "F");
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(8);
    this.pdf.setTextColor(...WHITE);
    this.pdf.text(this.headerText, ML, 6.5);
    if (title) this.pdf.text(title, PAGE_W - ML, 6.5, { align: "right" });

    // Footer
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(7);
    this.pdf.setTextColor(...MUTED);
    this.pdf.text(
      "Educational planning tool only. Not financial or tax advice. Always verify with a qualified adviser.",
      ML, PAGE_H - 5
    );
    this.pdf.text(`Page ${this.pageNum}`, PAGE_W - ML, PAGE_H - 5, { align: "right" });
    this.y = 18;
  }

  ensureSpace(mm: number) {
    if (this.y + mm > PAGE_H - 12) this.newPage(this._pageTitle);
  }

  sectionHeading(text: string) {
    this.ensureSpace(12);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(10);
    this.pdf.setTextColor(...NAVY);
    this.pdf.text(safe(text).toUpperCase(), ML, this.y);
    this.pdf.setDrawColor(...NAVY);
    this.pdf.setLineWidth(0.4);
    this.pdf.line(ML, this.y + 1.2, ML + CONTENT_W, this.y + 1.2);
    this.y += 7;
  }

  kvRow(label: string, value: string, valueColor?: [number,number,number], indent = 0) {
    this.ensureSpace(6);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(9);
    this.pdf.setTextColor(...MUTED);
    this.pdf.text(safe(label), ML + indent, this.y);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setTextColor(...(valueColor ?? NAVY));
    this.pdf.text(safe(value), PAGE_W - ML, this.y, { align: "right" });
    this.y += 5.5;
  }

  hr(color: [number,number,number] = BORDER) {
    this.pdf.setDrawColor(...color);
    this.pdf.setLineWidth(0.2);
    this.pdf.line(ML, this.y, ML + CONTENT_W, this.y);
    this.y += 3;
  }

  para(text: string, color: [number,number,number] = MUTED, size = 8.5) {
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(...color);
    const lines = this.pdf.splitTextToSize(safe(text), CONTENT_W);
    this.ensureSpace(lines.length * 4.5 + 2);
    this.pdf.text(lines, ML, this.y);
    this.y += lines.length * 4.5 + 2;
  }

  badge(text: string, status: string, x: number, y: number): number {
    const pal: Record<string, { bg: [number,number,number]; fg: [number,number,number] }> = {
      eligible:     { bg: ZONE_GREEN,  fg: GREEN  },
      at_risk:      { bg: ZONE_AMBER,  fg: AMBER  },
      not_eligible: { bg: ZONE_RED,    fg: RED    },
    };
    const c = pal[status] ?? { bg: LIGHT, fg: MUTED };
    const w = Math.max(this.pdf.getTextWidth(safe(text)) + 6, 22);
    this.pdf.setFillColor(...c.bg);
    this.pdf.roundedRect(x, y - 3.5, w, 5, 1.5, 1.5, "F");
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(7.5);
    this.pdf.setTextColor(...c.fg);
    this.pdf.text(safe(text), x + w / 2, y, { align: "center" });
    return w;
  }

  card(h: number, color: [number,number,number] = LIGHT) {
    this.pdf.setFillColor(...color);
    this.pdf.roundedRect(ML, this.y - 2, CONTENT_W, h, 2, 2, "F");
  }

  bar(x: number, y: number, w: number, h: number, fill: [number,number,number]) {
    if (w <= 0) return;
    this.pdf.setFillColor(...fill);
    this.pdf.rect(x, y, w, h, "F");
  }

  gap(mm = 4) { this.y += mm; }
}

// ===========================================================================
// Chart 1: ANI vs. Thresholds ruler
// ===========================================================================
/**
 * A colour-banded horizontal ruler (£50k to £135k) showing which zone each
 * parent's ANI falls in relative to the four key thresholds. Instantly
 * communicates "where you sit" in a way a table of numbers cannot.
 */
function drawThresholdRuler(d: Doc, r: CalculationResult) {
  const MIN = 50_000, MAX = 135_000, RANGE = MAX - MIN;
  const BAR_H = 14;

  const toX = (ani: number) =>
    ML + Math.max(0, Math.min(1, (ani - MIN) / RANGE)) * CONTENT_W;

  d.ensureSpace(52);
  d.gap(2);

  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(8.5);
  d.pdf.setTextColor(...NAVY);
  d.pdf.text("WHERE YOU SIT: ANI VS. KEY THRESHOLDS", ML, d.y);
  d.y += 5;

  const startY = d.y;

  // Coloured zone bands
  const zones: [number, number, [number,number,number]][] = [
    [50_000,  60_000,  ZONE_GREEN ],
    [60_000,  80_000,  ZONE_AMBER ],
    [80_000,  100_000, ZONE_RED   ],
    [100_000, 125_140, ZONE_PURPLE],
    [125_140, 135_000, ZONE_GRAY  ],
  ];
  for (const [from, to, col] of zones) {
    d.bar(toX(from), startY, toX(to) - toX(from), BAR_H, col);
  }

  // Zone label text
  const zoneLabels: [number, number, string, [number,number,number]][] = [
    [50_000,  60_000,  "Clear",      GREEN ],
    [60_000,  80_000,  "HICBC",      AMBER ],
    [80_000,  100_000, "Full HICBC", RED   ],
    [100_000, 125_140, "60% trap",   PURPLE],
    [125_140, 135_000, "45% band",   MUTED ],
  ];
  d.pdf.setFontSize(6.5);
  for (const [from, to, lbl, col] of zoneLabels) {
    const cx = (toX(from) + toX(to)) / 2;
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setTextColor(...col);
    d.pdf.text(lbl, cx, startY + BAR_H / 2 + 2, { align: "center" });
  }

  // Threshold tick marks and labels
  const thresholds: [number, string][] = [
    [60_000,  `${GBP}60k`  ],
    [80_000,  `${GBP}80k`  ],
    [100_000, `${GBP}100k` ],
    [125_140, `${GBP}125k` ],
  ];
  d.pdf.setDrawColor(...SLATE);
  d.pdf.setLineWidth(0.5);
  for (const [ani, lbl] of thresholds) {
    const x = toX(ani);
    d.pdf.line(x, startY, x, startY + BAR_H + 1);
    d.pdf.setFont("helvetica", "normal");
    d.pdf.setFontSize(6.5);
    d.pdf.setTextColor(...SLATE);
    d.pdf.text(lbl, x, startY + BAR_H + 5.5, { align: "center" });
  }

  // Axis end labels
  d.pdf.setFontSize(6.5);
  d.pdf.setTextColor(...MUTED);
  d.pdf.text(`${GBP}50k`, ML, startY + BAR_H + 5.5);
  d.pdf.text(`${GBP}135k`, ML + CONTENT_W, startY + BAR_H + 5.5, { align: "right" });

  // Parent ANI markers
  const parents: { label: string; ani: number; row: number }[] = [
    { label: "Parent A", ani: r.parentA.ani.adjustedNetIncome, row: 0 },
    ...(r.parentB ? [{ label: "Partner B", ani: r.parentB.ani.adjustedNetIncome, row: 1 }] : []),
  ];

  for (const { label, ani, row } of parents) {
    if (ani < MIN || ani > MAX) continue;
    const x  = toX(ani);
    const yO = row * -8; // offset so two markers don't overlap

    // Vertical stem
    d.pdf.setDrawColor(...NAVY);
    d.pdf.setLineWidth(0.9);
    d.pdf.line(x, startY + yO, x, startY + BAR_H);

    // Horizontal tick at top of stem
    d.pdf.setLineWidth(1.5);
    d.pdf.line(x - 2, startY + yO, x + 2, startY + yO);

    // Label
    const atRight = x > ML + CONTENT_W * 0.72;
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(7.5);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(
      `${label}: ${GBP}${Math.round(ani / 1000)}k`,
      atRight ? x - 3 : x + 3,
      startY + yO - 1.5,
      { align: atRight ? "right" : "left" }
    );
  }

  d.y = startY + BAR_H + 10;
}

// ===========================================================================
// Chart 2: Scheme value comparison bars
// ===========================================================================
/**
 * Horizontal bar chart showing the annual value of each childcare scheme —
 * split into "receiving" (green) vs "lost/clawed-back" (light red).
 * Makes the financial impact of ineligibility immediately visual.
 */
function drawSchemeValueChart(d: Doc, r: CalculationResult) {
  const fhStatus = r.freeHours.children.some(c => c.workingParentEligibility.status === "eligible")
    ? "eligible" : r.freeHours.children.some(c => c.workingParentEligibility.status === "at_risk")
    ? "at_risk" : "not_eligible";
  const cbStatus = r.hicbc.hicbcCharge === 0 ? "eligible"
    : r.hicbc.retentionFraction < 1 ? "at_risk" : "not_eligible";

  const items = [
    {
      label: "30-hr free childcare",
      received: r.freeHours.totalWorkingParentAnnualValue,
      lost: Math.max(0,
        r.freeHours.children.reduce((s, c) => s + c.incrementalWorkingParentValue, 0) -
        r.freeHours.totalWorkingParentAnnualValue),
      status: fhStatus,
    },
    {
      label: "Tax-Free Childcare",
      received: r.tfc.estimatedActualTopUpAnnual,
      lost: Math.max(0, r.tfc.maxPossibleTopUpAnnual - r.tfc.estimatedActualTopUpAnnual),
      status: r.tfc.eligible.status,
    },
    {
      label: `Child Benefit (net)`,
      received: r.hicbc.netChildBenefitAnnual,
      lost: Math.max(0, r.hicbc.grossChildBenefitAnnual - r.hicbc.netChildBenefitAnnual),
      status: cbStatus,
    },
  ];

  const maxVal = Math.max(...items.map(i => i.received + i.lost), 1);
  const BAR_H   = 9;
  const GAP     = 5;
  const LABEL_W = 48;
  const barArea = CONTENT_W - LABEL_W;

  d.ensureSpace(items.length * (BAR_H + GAP) + 22);
  d.gap(2);

  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(8.5);
  d.pdf.setTextColor(...NAVY);
  d.pdf.text("ANNUAL CHILDCARE SUPPORT VALUE", ML, d.y);
  d.y += 4;

  // Legend
  const legendItems: [string, [number,number,number]][] = [
    ["Receiving", GREEN],
    ["Lost / clawed back", [220, 38, 38]],
  ];
  let lx = ML;
  d.pdf.setFontSize(7);
  d.pdf.setFont("helvetica", "normal");
  for (const [lbl, col] of legendItems) {
    d.pdf.setFillColor(...col);
    d.pdf.rect(lx, d.y - 2.5, 7, 3, "F");
    d.pdf.setTextColor(...MUTED);
    d.pdf.text(lbl, lx + 9, d.y);
    lx += 9 + d.pdf.getTextWidth(lbl) + 8;
  }
  d.y += 5;

  for (const item of items) {
    const bx = ML + LABEL_W;

    // Row label + status badge
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(8.5);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(safe(item.label), ML, d.y + BAR_H / 2 + 1.5, { baseline: "middle" });
    const stLbl = item.status === "eligible" ? "OK" : item.status === "at_risk" ? "At risk" : "Lost";
    d.badge(stLbl, item.status, ML + LABEL_W - 16, d.y + BAR_H / 2);

    // Track background
    d.pdf.setFillColor(...LIGHT);
    d.pdf.rect(bx, d.y, barArea, BAR_H, "F");

    // Received portion
    if (item.received > 0) {
      const w = (item.received / maxVal) * barArea;
      const col: [number,number,number] =
        item.status === "eligible" ? GREEN :
        item.status === "at_risk"  ? [180, 83, 9] : GREEN;
      d.bar(bx, d.y, w, BAR_H, col);
      if (w > 14) {
        d.pdf.setFont("helvetica", "bold");
        d.pdf.setFontSize(6.5);
        d.pdf.setTextColor(...WHITE);
        d.pdf.text(fmtGBP(item.received), bx + w / 2, d.y + BAR_H / 2 + 1.5, { align: "center", baseline: "middle" });
      }
    }

    // Lost portion
    if (item.lost > 0) {
      const receivedW = (item.received / maxVal) * barArea;
      const lostW     = (item.lost / maxVal) * barArea;
      d.bar(bx + receivedW, d.y, lostW, BAR_H, [252, 165, 165]);
      if (lostW > 14) {
        d.pdf.setFont("helvetica", "bold");
        d.pdf.setFontSize(6.5);
        d.pdf.setTextColor(...RED);
        d.pdf.text(`-${fmtGBP(item.lost)}`, bx + receivedW + lostW / 2, d.y + BAR_H / 2 + 1.5, { align: "center", baseline: "middle" });
      }
    }

    // Bar border
    d.pdf.setDrawColor(...BORDER);
    d.pdf.setLineWidth(0.2);
    d.pdf.rect(bx, d.y, barArea, BAR_H);

    d.y += BAR_H + GAP;
  }
}

// ===========================================================================
// Chart 3: Income split (gross salary allocation)
// ===========================================================================
/**
 * Stacked horizontal bar per parent showing how gross salary is allocated:
 * sacrifice | income tax | NIC | take-home.
 * Gives an immediate visual sense of the overall tax burden.
 */
function drawIncomeSplitChart(d: Doc, r: CalculationResult) {
  type Parent = { label: string; a: typeof r.parentA; th: number };
  const parents: Parent[] = [
    { label: "Parent A", a: r.parentA, th: r.householdSummary.parentANetTakeHome },
    ...(r.parentB ? [{ label: "Partner B", a: r.parentB, th: r.householdSummary.parentBNetTakeHome }] : []),
  ];

  d.ensureSpace(parents.length * 26 + 22);
  d.gap(2);

  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(8.5);
  d.pdf.setTextColor(...NAVY);
  d.pdf.text("INCOME ALLOCATION (GROSS SALARY)", ML, d.y);
  d.y += 4;

  // Legend
  const legendDef: [string, [number,number,number]][] = [
    ["Sacrifice / pension", [147, 197, 253]],
    ["Income tax",          RED             ],
    ["NIC",                 [251, 146, 60]  ],
    ["Take-home",           GREEN           ],
  ];
  let lx = ML;
  d.pdf.setFontSize(7);
  d.pdf.setFont("helvetica", "normal");
  for (const [lbl, col] of legendDef) {
    d.pdf.setFillColor(...col);
    d.pdf.rect(lx, d.y - 2.5, 7, 3, "F");
    d.pdf.setTextColor(...MUTED);
    d.pdf.text(lbl, lx + 9, d.y);
    lx += 9 + d.pdf.getTextWidth(lbl) + 6;
  }
  d.y += 5;

  const BAR_H = 12;

  for (const { label, a, th } of parents) {
    const gross = a.ani.grossSalary;
    if (gross <= 0) continue;

    const sacrifice = a.ani.totalSalarySacrifice;
    const tax       = a.incomeTax.totalIncomeTax;
    const nic       = a.nic.totalEmployeeNIC;
    const takeHome  = Math.max(0, th);
    const total     = sacrifice + tax + nic + takeHome;

    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(8.5);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(safe(`${label}  (gross ${fmtGBP(gross)})`), ML, d.y);
    d.y += 4;

    const segs: [number, [number,number,number], string][] = [
      [sacrifice, [147, 197, 253], "Sacrifice"],
      [tax,       RED,             "Tax"      ],
      [nic,       [251, 146, 60],  "NIC"      ],
      [takeHome,  GREEN,           "Take-home"],
    ];

    let bx = ML;
    for (const [val, col] of segs) {
      if (val <= 0) continue;
      const w = (val / total) * CONTENT_W;
      d.bar(bx, d.y, w, BAR_H, col);
      if (w > 16) {
        const pct = Math.round((val / total) * 100);
        d.pdf.setFont("helvetica", "bold");
        d.pdf.setFontSize(6.5);
        d.pdf.setTextColor(...WHITE);
        d.pdf.text(`${pct}%`, bx + w / 2, d.y + BAR_H / 2 + 1.5, { align: "center", baseline: "middle" });
      }
      bx += w;
    }

    // Bar border
    d.pdf.setDrawColor(...BORDER);
    d.pdf.setLineWidth(0.2);
    d.pdf.rect(ML, d.y, CONTENT_W, BAR_H);
    d.y += BAR_H + 2;

    // Value annotations
    bx = ML;
    for (const [val, , segLabel] of segs) {
      if (val <= 0) continue;
      const w = (val / total) * CONTENT_W;
      if (w > 14) {
        d.pdf.setFont("helvetica", "normal");
        d.pdf.setFontSize(7);
        d.pdf.setTextColor(...SLATE);
        d.pdf.text(safe(`${segLabel}: ${fmtGBP(val)}`), bx + w / 2, d.y, { align: "center" });
      }
      bx += w;
    }
    d.y += 8;
  }
}

// ===========================================================================
// Page builders
// ===========================================================================

function drawCover(d: Doc, r: CalculationResult) {
  d.newPage("Summary");

  // Hero
  d.pdf.setFillColor(...NAVY);
  d.pdf.rect(0, 14, PAGE_W, 34, "F");
  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(18);
  d.pdf.setTextColor(...WHITE);
  d.pdf.text("UK Childcare Tax Tool", ML, 30);
  d.pdf.setFont("helvetica", "normal");
  d.pdf.setFontSize(10);
  d.pdf.setTextColor(148, 163, 184);
  d.pdf.text(pdfCoverSubtitle(r), ML, 38);
  d.pdf.setFontSize(8);
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  d.pdf.text(`Generated: ${today}`, PAGE_W - ML, 38, { align: "right" });
  d.y = 58;

  // At-risk alerts
  if (r.atRiskThresholds.length > 0) {
    d.sectionHeading("(!!) AT-RISK ALERTS");
    for (const t of r.atRiskThresholds) {
      d.ensureSpace(20);
      d.card(19, ZONE_AMBER);
      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(9);
      d.pdf.setTextColor(...AMBER);
      d.pdf.text(safe(`${t.thresholdLabel}  --  ${t.parentLabel}`), ML + 3, d.y + 4.5);
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(8);
      d.pdf.setTextColor(...NAVY);
      d.pdf.text(safe(`Only ${fmtGBP(t.currentGap)} below threshold. At risk: ${t.schemesAtRisk.join(", ")}.`), ML + 3, d.y + 10.5);
      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(13);
      d.pdf.setTextColor(...RED);
      d.pdf.text(fmtGBP(t.potentialAnnualLossGBP), PAGE_W - ML - 3, d.y + 9, { align: "right" });
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(7);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text("potential annual loss", PAGE_W - ML - 3, d.y + 14.5, { align: "right" });
      d.y += 22;
    }
    d.gap(2);
  }

  // Total summary
  d.sectionHeading("Household Financial Summary");
  const s = r.householdSummary;

  d.card(22, NAVY);
  d.pdf.setFont("helvetica", "normal");
  d.pdf.setFontSize(8);
  d.pdf.setTextColor(148, 163, 184);
  d.pdf.text("TOTAL HOUSEHOLD NET INCOME + BENEFITS", ML + 4, d.y + 4.5);
  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(20);
  d.pdf.setTextColor(...WHITE);
  d.pdf.text(fmtGBP(s.totalHouseholdNetPosition), ML + 4, d.y + 16);
  d.y += 26;

  const rows: [string, number][] = [
    ["Parent A net take-home", s.parentANetTakeHome],
    ...(s.parentBNetTakeHome > 0 ? [["Partner B net take-home", s.parentBNetTakeHome] as [string, number]] : []),
    ["Net Child Benefit", s.netChildBenefit],
    ["Tax-Free Childcare top-up", s.tfcTopUp],
    ["30-hour free childcare value", s.freeHoursAnnualValue],
  ];
  const half = (CONTENT_W - 4) / 2;
  for (let i = 0; i < rows.length; i++) {
    const [lbl, val] = rows[i];
    const col = i % 2, row = Math.floor(i / 2);
    const bx = ML + col * (half + 4), by = d.y + row * 13;
    d.pdf.setFillColor(...LIGHT);
    d.pdf.roundedRect(bx, by - 2, half, 12, 1.5, 1.5, "F");
    d.pdf.setFont("helvetica", "normal");
    d.pdf.setFontSize(7.5);
    d.pdf.setTextColor(...MUTED);
    d.pdf.text(safe(lbl), bx + 4, by + 2);
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(10);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(fmtGBP(val), bx + 4, by + 9);
  }
  d.y += Math.ceil(rows.length / 2) * 14 + 4;

  // Scheme status
  d.gap(2);
  d.sectionHeading("Scheme Eligibility at a Glance");
  const fhStatus = r.freeHours.children.some(c => c.workingParentEligibility.status === "eligible")
    ? "eligible" : r.freeHours.children.some(c => c.workingParentEligibility.status === "at_risk")
    ? "at_risk" : "not_eligible";
  const cbStatus = r.hicbc.hicbcCharge === 0 ? "eligible"
    : r.hicbc.retentionFraction < 1 ? "at_risk" : "not_eligible";

  for (const sc of [
    { name: "30-hour Free Childcare", status: fhStatus,              value: fmtGBP(r.freeHours.totalWorkingParentAnnualValue), unit: "est. annual value" },
    { name: "Tax-Free Childcare",      status: r.tfc.eligible.status, value: fmtGBP(r.tfc.maxPossibleTopUpAnnual),             unit: "max top-up/year" },
    { name: "Child Benefit (net)",     status: cbStatus,              value: fmtGBP(r.hicbc.netChildBenefitAnnual),            unit: "net annual" },
  ]) {
    d.ensureSpace(14);
    d.pdf.setFillColor(...LIGHT);
    d.pdf.roundedRect(ML, d.y - 2, CONTENT_W, 13, 2, 2, "F");
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(9.5);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(safe(sc.name), ML + 4, d.y + 4.5);
    d.badge(sc.status === "eligible" ? "Eligible" : sc.status === "at_risk" ? "At risk" : "Not eligible",
      sc.status, ML + 4, d.y + 10.5);
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(11);
    d.pdf.setTextColor(...NAVY);
    d.pdf.text(sc.value, PAGE_W - ML - 4, d.y + 4, { align: "right" });
    d.pdf.setFont("helvetica", "normal");
    d.pdf.setFontSize(7.5);
    d.pdf.setTextColor(...MUTED);
    d.pdf.text(sc.unit, PAGE_W - ML - 4, d.y + 9, { align: "right" });
    d.y += 15;
  }

  // Chart: Scheme value bars
  d.gap(4);
  drawSchemeValueChart(d, r);
}

function drawANI(d: Doc, r: CalculationResult) {
  d.newPage("ANI Breakdown");
  d.sectionHeading("Adjusted Net Income (ANI) Calculation");
  d.para(
    `Adjusted Net Income (ANI) is defined in ITA 2007 s.58. It controls eligibility for all childcare ` +
    `schemes and the personal allowance taper. It is NOT the same as your salary: it includes all income ` +
    `sources and subtracts qualifying pension contributions and Gift Aid donations.`,
    MUTED
  );
  d.gap(3);

  // Chart: threshold ruler
  drawThresholdRuler(d, r);
  d.gap(4);

  const parents: { label: string; a: typeof r.parentA; th: number }[] = [
    { label: "Parent A", a: r.parentA, th: r.householdSummary.parentANetTakeHome },
    ...(r.parentB ? [{ label: "Partner B", a: r.parentB, th: r.householdSummary.parentBNetTakeHome }] : []),
  ];

  for (const { label, a, th } of parents) {
    const ani = a.ani;
    d.ensureSpace(12);
    d.pdf.setFillColor(...NAVY);
    d.pdf.roundedRect(ML, d.y - 2, CONTENT_W, 8, 2, 2, "F");
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(10);
    d.pdf.setTextColor(...WHITE);
    d.pdf.text(safe(label), ML + 4, d.y + 3.5);
    d.y += 10;

    const incomeRows: [string, number][] = [
      ["Base salary (post-sacrifice)", ani.postSacrificeSalary],
      ...(ani.bonusIncome > 0       ? [["Bonus",                  ani.bonusIncome]       as [string,number]] : []),
      ...(ani.rsuIncome > 0         ? [["RSU vests",              ani.rsuIncome]         as [string,number]] : []),
      ...(ani.biKIncome > 0         ? [["Benefits in kind (P11D)",ani.biKIncome]         as [string,number]] : []),
      ...(ani.opraTaxableValue > 0  ? [["Sacrificed benefits (taxable value)", ani.opraTaxableValue] as [string,number]] : []),
      ...(ani.cashAllowances > 0    ? [["Cash allowances",        ani.cashAllowances]    as [string,number]] : []),
      ...(ani.savingsInterestNonISA > 0 ? [["Non-ISA savings interest",ani.savingsInterestNonISA] as [string,number]] : []),
      ...(ani.dividendsNonISA > 0   ? [["Non-ISA dividends",      ani.dividendsNonISA]   as [string,number]] : []),
      ...(ani.rentalIncomeNet > 0   ? [["Net rental income",      ani.rentalIncomeNet]   as [string,number]] : []),
      ...(ani.selfEmploymentProfit > 0 ? [["Self-employment profit",ani.selfEmploymentProfit] as [string,number]] : []),
      ...(ani.pensionIncomeGross > 0 ? [["Pension income",        ani.pensionIncomeGross] as [string,number]] : []),
    ];
    for (const [lbl, val] of incomeRows) d.kvRow(safe(lbl), `+ ${fmtGBP(val)}`, GREEN, 2);
    if (ani.netPayPensionContributions > 0) d.kvRow("Net pay pension contributions", `- ${fmtGBP(ani.netPayPensionContributions)}`, RED, 2);

    d.hr();
    d.kvRow("Step 1: Net income", fmtGBP(ani.step1NetIncome), NAVY);
    if (ani.step2GiftAidDeduction > 0) d.kvRow("Step 2: Gift Aid deduction (grossed up)", `- ${fmtGBP(ani.step2GiftAidDeduction)}`, RED, 2);
    if (ani.step3PensionDeduction > 0) d.kvRow("Step 3: Pension deduction (grossed up)", `- ${fmtGBP(ani.step3PensionDeduction)}`, RED, 2);
    d.hr(NAVY);

    const over = ani.adjustedNetIncome > 100_000;
    d.card(10, over ? ZONE_RED : ZONE_GREEN);
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(10);
    d.pdf.setTextColor(...(over ? RED : GREEN));
    d.pdf.text("Adjusted Net Income (ANI)", ML + 4, d.y + 7);
    d.pdf.setFontSize(14);
    d.pdf.text(fmtGBP(ani.adjustedNetIncome), PAGE_W - ML - 4, d.y + 7.5, { align: "right" });
    d.y += 14;

    // Distances to thresholds
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(7.5);
    d.pdf.setTextColor(...MUTED);
    d.pdf.text("DISTANCE TO KEY THRESHOLDS", ML + 2, d.y);
    d.y += 4;

    for (const [lbl, gap] of [
      [`to HICBC start (${GBP}60k)`,      ani.distanceToHICBCStart],
      [`to full HICBC (${GBP}80k)`,        ani.distanceToHICBCFull],
      [`to childcare cliff (${GBP}100k)`,  ani.distanceToPATaperStart],
      [`to PA taper end (${GBP}125k)`,     ani.distanceToPATaperEnd],
    ] as [string, number][]) {
      const prefix = gap > 0 ? `${fmtGBP(gap)} below` : `${fmtGBP(Math.abs(gap))} OVER`;
      d.kvRow(safe(lbl), prefix, gap > 0 ? GREEN : RED, 2);
    }

    d.hr();
    d.kvRow("Income tax", fmtGBP(a.incomeTax.totalIncomeTax), RED);
    d.kvRow("National Insurance (Class 1)", fmtGBP(a.nic.class1Employee), RED);
    if (a.nic.class4 > 0) d.kvRow("National Insurance (Class 4)", fmtGBP(a.nic.class4), RED);
    d.kvRow("Net take-home", fmtGBP(th), GREEN);
    d.gap(6);
  }
}

function drawSchemes(d: Doc, r: CalculationResult) {
  d.newPage("Scheme Eligibility");
  d.sectionHeading("30-Hour Free Childcare");
  d.para(
    `Working parents can receive up to 30 hours/week of funded childcare during term time (38 weeks/year). ` +
    `Both parents must each expect to earn at least 16 hours/week at the minimum wage over the next 3 months, and neither can have ANI over ${GBP}100,000. Losing this entitlement ` +
    `because one parent earns ${GBP}1 over ${GBP}100k is one of the most costly tax cliff edges in the UK.`,
    MUTED
  );
  d.gap(2);

  if (r.freeHours.children.length === 0) {
    d.para("No children registered.", MUTED);
  } else {
    for (const ch of r.freeHours.children) {
      d.ensureSpace(30);
      d.card(28, LIGHT);
      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(9.5);
      d.pdf.setTextColor(...NAVY);
      d.pdf.text(safe(`Child ${ch.childIndex + 1}  --  born ${ch.childDateOfBirth}  (${ch.ageGroup.replace(/_/g, " ")})`), ML + 4, d.y + 5);
      const stLbl = ch.workingParentEligibility.status === "eligible" ? "Eligible"
        : ch.workingParentEligibility.status === "at_risk" ? "At risk" : "Not eligible";
      d.badge(stLbl, ch.workingParentEligibility.status, ML + 4, d.y + 12);
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(8);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text(safe(`${ch.workingParentHoursPerWeek}hrs/wk working parent  |  ${ch.universalHoursPerWeek}hrs/wk universal`), ML + 4, d.y + 20);
      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(11);
      d.pdf.setTextColor(...NAVY);
      d.pdf.text(fmtGBP(ch.workingParentAnnualValue), PAGE_W - ML - 4, d.y + 10, { align: "right" });
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(7.5);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text("est. annual value", PAGE_W - ML - 4, d.y + 16, { align: "right" });
      if (ch.incrementalWorkingParentValue > 0) {
        d.pdf.text(safe(`(${fmtGBP(ch.incrementalWorkingParentValue)} incremental)`), PAGE_W - ML - 4, d.y + 22, { align: "right" });
      }
      if (ch.workingParentEligibility.status !== "eligible" && ch.workingParentEligibility.reason) {
        d.pdf.setFont("helvetica", "italic");
        d.pdf.setFontSize(7.5);
        d.pdf.setTextColor(...RED);
        const reason = d.pdf.splitTextToSize(safe(ch.workingParentEligibility.reason.slice(0, 140)), CONTENT_W - 10);
        d.pdf.text(reason, ML + 4, d.y + 27);
        d.y += reason.length > 1 ? 4 : 0;
      }
      d.y += 32;
    }
  }

  d.gap(2);
  d.sectionHeading("Tax-Free Childcare (TFC)");
  d.para(
    `For every ${GBP}8 you pay in, the government adds ${GBP}2 -- 20% of the childcare bill. Maximum ${GBP}2,000/child/year ` +
    `(${GBP}4,000 for disabled children). TFC is disqualified entirely if EITHER parent's ANI exceeds ${GBP}100,000 -- ` +
    `there is no taper. Reconfirm eligibility every 3 months.`,
    MUTED
  );
  d.gap(2);

  const tfc = r.tfc;
  d.kvRow("Status",
    tfc.eligible.status === "eligible" ? "Eligible" : tfc.eligible.status === "at_risk" ? "At risk" : "Not eligible",
    tfc.eligible.status === "eligible" ? GREEN : tfc.eligible.status === "at_risk" ? AMBER : RED);
  d.kvRow("Eligible children", `${tfc.eligibleChildCount}`);
  d.kvRow(`Maximum annual top-up`, fmtGBP(tfc.maxPossibleTopUpAnnual), GREEN);
  d.kvRow("Estimated actual top-up", fmtGBP(tfc.estimatedActualTopUpAnnual), GREEN);
  if (tfc.eligible.reason) { d.gap(1); d.para(safe(tfc.eligible.reason), MUTED); }

  d.gap(4);
  d.sectionHeading("Child Benefit & HICBC");
  const cb = getTaxYearConfig(r.taxYear).childBenefit;
  d.para(
    `Child Benefit (${GBP}${cb.firstChildWeekly.toFixed(2)}/wk eldest child, ${GBP}${cb.additionalChildWeekly.toFixed(2)}/wk each additional, ${r.taxYear}) is universal but ` +
    `clawed back via HICBC when the higher earner's ANI exceeds ${GBP}60,000. The charge is ` +
    `1% of Child Benefit per ${GBP}200 of ANI above ${GBP}60,000. It reaches 100% at ${GBP}80,000.`,
    MUTED
  );
  d.gap(2);
  const h = r.hicbc;
  d.kvRow("Higher earner", safe(h.higherEarnerLabel));
  d.kvRow("Higher earner ANI", fmtGBP(h.higherEarnerANI), h.higherEarnerANI > 80_000 ? RED : h.higherEarnerANI > 60_000 ? AMBER : GREEN);
  d.kvRow("Gross annual Child Benefit", fmtGBP(h.grossChildBenefitAnnual));
  d.kvRow("HICBC charge", fmtGBP(h.hicbcCharge), h.hicbcCharge > 0 ? RED : GREEN);
  d.kvRow("Percentage clawed back", `${(h.retentionFraction * 100).toFixed(0)}%`, h.retentionFraction > 0 ? RED : GREEN);
  d.kvRow("Net Child Benefit received", fmtGBP(h.netChildBenefitAnnual), GREEN);
  d.gap(2);
  d.kvRow("NI credits preserved",
    h.niCreditsPreserved ? "Yes -- registered for CB" : "No -- register to protect State Pension credits",
    h.niCreditsPreserved ? GREEN : AMBER);
  if (h.selfAssessmentRequired || h.payeOptionAvailable) {
    d.gap(1);
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(8);
    d.pdf.setTextColor(...RED);
    d.pdf.text(
      h.selfAssessmentRequired
        ? "Declare and pay the HICBC on your Self Assessment return."
        : "HICBC is payable -- it can be paid via your PAYE tax code (HMRC online HICBC service).",
      ML, d.y);
    d.y += 5;
  }
  d.gap(2);
  d.para(safe(h.recommendationReason), MUTED);
}

function drawPension(d: Doc, r: CalculationResult) {
  d.newPage("Pension Capacity");
  d.sectionHeading("Pension Annual Allowance");
  d.para(
    `The Annual Allowance (AA) is the maximum total pension input (employer + employee) per tax year. ` +
    `Standard limit: ${GBP}60,000. Unused AA from the previous 3 years can be carried forward. ` +
    `If you have flexibly accessed a pension, the Money Purchase AA (${GBP}10,000) applies instead and carry-forward is unavailable.`,
    MUTED
  );
  d.gap(4);

  for (const { label, cap } of [
    { label: "Parent A", cap: r.parentA.pensionCapacity },
    ...(r.parentB ? [{ label: "Partner B", cap: r.parentB.pensionCapacity }] : []),
  ]) {
    d.ensureSpace(12);
    d.pdf.setFillColor(...NAVY);
    d.pdf.roundedRect(ML, d.y - 2, CONTENT_W, 8, 2, 2, "F");
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(10);
    d.pdf.setTextColor(...WHITE);
    d.pdf.text(safe(label), ML + 4, d.y + 3.5);
    d.y += 10;

    d.kvRow("Annual Allowance", fmtGBP(cap.annualAllowance), cap.mpaaApplies ? RED : NAVY);
    d.kvRow("Pension input this year", fmtGBP(cap.totalContributionsThisYear));
    if (cap.annualAllowanceCharge > 0) d.kvRow("Annual Allowance charge", fmtGBP(cap.annualAllowanceCharge), RED);
    d.kvRow("Remaining headroom", fmtGBP(cap.remainingHeadroomThisYear), cap.remainingHeadroomThisYear > 0 ? GREEN : RED);
    if (cap.carryForwardAvailable != null) d.kvRow("Carry-forward available (3yr)", fmtGBP(cap.carryForwardAvailable), PURPLE);
    if (cap.maxAdditionalContribution != null && cap.maxAdditionalContribution > 0) {
      d.kvRow("Max additional contribution", fmtGBP(cap.maxAdditionalContribution), PURPLE);
    }
    d.kvRow("MPAA applies", cap.mpaaApplies ? `Yes -- ${GBP}10,000 limit` : "No", cap.mpaaApplies ? RED : GREEN);
    d.kvRow("Tapered AA applies", cap.taperedAAApplies ? "Yes" : "No", cap.taperedAAApplies ? AMBER : GREEN);

    if (cap.warnings.length > 0) {
      d.gap(2);
      for (const w of cap.warnings) {
        d.ensureSpace(10);
        const wLines = d.pdf.splitTextToSize(safe(`Note: ${w}`), CONTENT_W - 8);
        d.pdf.setFillColor(...ZONE_AMBER);
        d.pdf.roundedRect(ML, d.y - 1.5, CONTENT_W, wLines.length * 4.5 + 4, 1.5, 1.5, "F");
        d.pdf.setFont("helvetica", "normal");
        d.pdf.setFontSize(8);
        d.pdf.setTextColor(...AMBER);
        d.pdf.text(wLines, ML + 4, d.y + 3);
        d.y += wLines.length * 4.5 + 6;
      }
    }
    d.gap(6);
  }
}

function drawOptimise(d: Doc, r: CalculationResult) {
  d.newPage("Optimise");
  d.sectionHeading("Optimisation Recommendations");
  d.para(
    "Recommendations are ranked by annual net gain. Restorative recommendations restore lost scheme " +
    "eligibility. Proactive recommendations protect eligibility you currently have.",
    MUTED
  );
  d.gap(4);

  const recs = r.optimisationRecommendations;
  if (recs.length === 0) {
    d.para("No recommendations -- all schemes are fully accessible and no at-risk thresholds detected.", GREEN);
    return;
  }

  const isProtective = (r: (typeof recs)[number]) => r.kind === "protective" || r.aniReductionRequired === 0;
  const restorative = recs.filter(r => !isProtective(r));
  const proactive   = recs.filter(isProtective);

  const drawGroup = (group: typeof recs, heading: string) => {
    if (group.length === 0) return;
    d.ensureSpace(10);
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(9);
    d.pdf.setTextColor(...SLATE);
    d.pdf.text(safe(heading), ML, d.y);
    d.y += 6;

    for (const rec of group) {
      d.ensureSpace(44);
      const priC: [number,number,number] = rec.priority === "high" ? RED : rec.priority === "medium" ? AMBER : PURPLE;

      d.pdf.setFillColor(...LIGHT);
      d.pdf.roundedRect(ML, d.y - 1, CONTENT_W, 38, 2, 2, "F");
      d.pdf.setFillColor(...priC);
      d.pdf.roundedRect(ML, d.y - 1, 2.5, 38, 1, 1, "F");

      const priLabel = rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1);
      d.badge(priLabel,
        rec.priority === "high" ? "not_eligible" : rec.priority === "medium" ? "at_risk" : "eligible",
        ML + 6, d.y + 5);

      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(7.5);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text(safe(rec.parentLabel), ML + 30, d.y + 5);

      if (rec.schemesRestored.length > 0) {
        d.pdf.setFillColor(241, 245, 249);
        const tagTxt = safe(rec.schemesRestored.slice(0, 2).join(" | "));
        const tw = Math.min(d.pdf.getTextWidth(tagTxt) + 6, 85);
        d.pdf.roundedRect(ML + 52, d.y + 1.5, tw, 5, 1.5, 1.5, "F");
        d.pdf.setFontSize(7);
        d.pdf.setTextColor(...NAVY);
        d.pdf.text(tagTxt, ML + 55, d.y + 5.2);
      }

      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(10);
      d.pdf.setTextColor(...NAVY);
      d.pdf.text(safe(LEVER_NAMES[rec.lever] ?? rec.lever), ML + 6, d.y + 14);

      const actionTxt = !isProtective(rec)
        ? safe(`Contribute ${fmtGBP(rec.actionRequired)} ${rec.actionUnit}  |  ANI reduces by ${fmtGBP(rec.aniReductionRequired)}`)
        : "Protect existing eligibility";
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(8);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text(actionTxt, ML + 6, d.y + 20);

      const descLines = d.pdf.splitTextToSize(safe(rec.leverDescription.slice(0, 220)), CONTENT_W - 50);
      d.pdf.setFontSize(7.5);
      d.pdf.text(descLines.slice(0, 2), ML + 6, d.y + 26);

      d.pdf.setFont("helvetica", "bold");
      d.pdf.setFontSize(14);
      const gainColor: [number,number,number] = rec.netAnnualGain >= 0 ? GREEN : RED;
      d.pdf.setTextColor(...gainColor);
      const gainTxt = !isProtective(rec)
        ? (rec.netAnnualGain >= 0 ? "+" : "") + fmtGBP(rec.netAnnualGain)
        : fmtGBP(rec.annualBenefitRestored);
      d.pdf.text(gainTxt, PAGE_W - ML - 4, d.y + 13, { align: "right" });
      d.pdf.setFont("helvetica", "normal");
      d.pdf.setFontSize(7);
      d.pdf.setTextColor(...MUTED);
      d.pdf.text(!isProtective(rec) ? "net / year" : "protected / year", PAGE_W - ML - 4, d.y + 19, { align: "right" });

      d.y += 42;

      // Warnings — use safe() to strip all non-WinAnsi characters
      for (const w of rec.warnings.filter(Boolean)) {
        d.ensureSpace(10);
        const wLines = d.pdf.splitTextToSize(safe(`Note: ${w}`), CONTENT_W - 8);
        d.pdf.setFillColor(...ZONE_AMBER);
        d.pdf.roundedRect(ML, d.y - 1.5, CONTENT_W, wLines.length * 4.5 + 4, 1.5, 1.5, "F");
        d.pdf.setFont("helvetica", "normal");
        d.pdf.setFontSize(7.5);
        d.pdf.setTextColor(...AMBER);
        d.pdf.text(wLines, ML + 4, d.y + 3);
        d.y += wLines.length * 4.5 + 6;
      }
      d.gap(3);
    }
  };

  drawGroup(restorative, "RESTORE LOST ELIGIBILITY");
  d.gap(2);
  drawGroup(proactive, "PROTECT EXISTING ELIGIBILITY");
}

function drawRateTable(d: Doc, r: CalculationResult) {
  d.newPage("Marginal Rates");
  d.sectionHeading("Effective Marginal Rate -- Key Income Points");
  d.para(
    `The effective marginal rate is the combined % of each extra ${GBP}1 earned that is lost to tax ` +
    `and benefit reductions. The 60%+ zone (${GBP}100k--${GBP}125k) and the cliff spike at ${GBP}101k are highlighted.`,
    MUTED
  );
  d.gap(3);

  const curANI = r.parentA.ani.adjustedNetIncome;
  d.pdf.setFillColor(...(curANI > 100_000 ? ZONE_RED : ZONE_GREEN));
  d.pdf.roundedRect(ML, d.y - 2, CONTENT_W, 9, 2, 2, "F");
  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(9);
  d.pdf.setTextColor(...(curANI > 100_000 ? RED : GREEN));
  d.pdf.text(safe(`Parent A current ANI: ${fmtGBP(curANI)}`), ML + 4, d.y + 4.5);
  d.y += 13;

  if (r.crossoverANI !== null && curANI > 100_000) {
    d.pdf.setFillColor(240, 253, 244);
    d.pdf.roundedRect(ML, d.y - 2, CONTENT_W, 9, 2, 2, "F");
    d.pdf.setFont("helvetica", "bold");
    d.pdf.setFontSize(9);
    d.pdf.setTextColor(...GREEN);
    d.pdf.text(safe(`Crossover point: ${fmtGBP(r.crossoverANI)}  -- above this ANI the household net position recovers`), ML + 4, d.y + 4.5);
    d.y += 13;
  }
  d.gap(2);

  // Table
  const cols = ["ANI",  "Inc. Tax", "NIC",  "PA Taper", "HICBC", "Free Hrs", "TFC",  "TOTAL"];
  const cw   = [22,     21,          13,     16,          16,      16,          16,     18    ];
  d.pdf.setFillColor(...NAVY);
  d.pdf.rect(ML, d.y - 2, CONTENT_W, 7, "F");
  d.pdf.setFont("helvetica", "bold");
  d.pdf.setFontSize(7.5);
  d.pdf.setTextColor(...WHITE);
  let cx = ML;
  for (let i = 0; i < cols.length; i++) { d.pdf.text(cols[i], cx + 1, d.y + 2.5); cx += cw[i]; }
  d.y += 7;

  const pts = r.marginalRateChart.parentA;
  const keyANIs = [50, 55, 60, 62, 65, 70, 75, 80, 85, 90, 95, 99, 100, 101, 105, 110, 115, 120, 125, 130, 135];
  const selected = pts.filter(p => keyANIs.some(k => Math.abs(p.ani / 1000 - k) < 0.6));

  for (let ri = 0; ri < selected.length; ri++) {
    const pt = selected[ri];
    d.ensureSpace(6);
    const inTrap    = pt.ani >= 100_000 && pt.ani <= 125_140;
    const isCurrent = Math.abs(pt.ani - curANI) < 500;

    if (isCurrent) {
      d.pdf.setFillColor(219, 234, 254);
    } else if (inTrap) {
      d.pdf.setFillColor(250, 245, 255);
    } else if (ri % 2 === 0) {
      d.pdf.setFillColor(...LIGHT);
    } else {
      d.pdf.setFillColor(...WHITE);
    }
    d.pdf.rect(ML, d.y - 1, CONTENT_W, 5.5, "F");

    // Use ASCII ">" marker instead of Unicode arrow
    const vals = [
      `${GBP}${(pt.ani / 1000).toFixed(0)}k${isCurrent ? " >" : ""}`,
      fmtPct(pt.incomeTaxMarginalRate),
      fmtPct(pt.nicMarginalRate),
      fmtPct(pt.personalAllowanceTaperEffect),
      fmtPct(pt.hicbcWithdrawalRate),
      fmtPct(pt.freeHoursBenefitLossRate),
      fmtPct(pt.tfcBenefitLossRate),
      fmtPct(pt.totalEffectiveMarginalRate),
    ];
    const total = pt.totalEffectiveMarginalRate;
    cx = ML;
    d.pdf.setFont("helvetica", isCurrent ? "bold" : "normal");
    d.pdf.setFontSize(7.5);
    for (let ci = 0; ci < vals.length; ci++) {
      d.pdf.setTextColor(...(
        isCurrent               ? NAVY  :
        ci === 7 && total > 0.6 ? RED   :
        ci === 7 && total > 0.4 ? AMBER :
        SLATE
      ));
      d.pdf.text(safe(vals[ci]), cx + 1, d.y + 3);
      cx += cw[ci];
    }
    d.y += 5.5;
  }

  // Income split chart
  d.gap(8);
  drawIncomeSplitChart(d, r);

  // Disclaimer
  d.gap(6);
  d.pdf.setDrawColor(...BORDER);
  d.pdf.setLineWidth(0.3);
  d.pdf.line(ML, d.y, ML + CONTENT_W, d.y);
  d.y += 5;
  d.para(
    "DISCLAIMER: This report is for educational and planning purposes only. It is not financial, tax, " +
    "or legal advice. Figures are estimates based on the information provided and may not reflect every " +
    "aspect of your personal tax situation. Tax rules change annually. Always verify with a qualified " +
    "financial adviser or accountant before making decisions. This tool covers England -- Scottish, Welsh " +
    "and Northern Irish residents may face different income tax rates or childcare entitlements.",
    MUTED, 8
  );
}

// ===========================================================================
// Main export
// ===========================================================================
export function generateReport(result: CalculationResult): void {
  const d = new Doc(pdfPageHeader(result));
  drawCover(d, result);
  drawANI(d, result);
  drawSchemes(d, result);
  drawPension(d, result);
  drawOptimise(d, result);
  drawRateTable(d, result);

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  d.pdf.save(`childcare-tax-assessment-${stamp}.pdf`);
}
