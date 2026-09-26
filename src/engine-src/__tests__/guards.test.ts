/**
 * Guards that keep year-specific figures in constants.ts and keep each tax
 * year's config complete and sourced.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TAX_YEAR_CONFIGS, taxYearForDate } from "../index";
import type { TaxYearConfig } from "../index";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Source text with comments removed: only code and user-visible strings are checked. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

describe("no year-specific figures outside constants.ts", () => {
  const forbidden: [string, RegExp][] = [
    ["a tax year like 2025/26", /20\d\d\/\d\d/],
    ["the 2024/25 Child Benefit rate £25.60", /25\.60/],
    ["the 2025/26 annual minimum income £10,158", /10,158/],
    ["the 2025/26 minimum wage £12.21", /12\.21/],
  ];
  const files = sourceFiles(SRC).filter((f) => !f.endsWith("constants.ts"));

  it.each(forbidden)("no %s", (_label, pattern) => {
    const offenders = files.flatMap((file) =>
      codeOnly(readFileSync(file, "utf8"))
        .split("\n")
        .flatMap((line, i) => (pattern.test(line) ? [`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`] : []))
    );
    expect(offenders).toEqual([]);
  });
});

describe("tax year configs", () => {
  const years = Object.values(TAX_YEAR_CONFIGS);
  const reference = years[0];

  /** Maps keyed by tax year, whose keys legitimately differ between years. */
  const YEAR_KEYED = new Set(["pension.annualAllowanceHistory"]);

  /** Every key path in `shape`, e.g. "tfc.maxTopUpPerChildPerYear". */
  function keyPaths(shape: object, prefix = ""): string[] {
    return Object.entries(shape).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) && !YEAR_KEYED.has(`${prefix}${k}`)
        ? keyPaths(v as object, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    );
  }

  it.each(years.map((c) => [c.taxYear, c] as const))("%s defines every field", (_year, config) => {
    for (const path of keyPaths(reference)) {
      const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], config);
      expect(value, path).not.toBeUndefined();
    }
  });

  it.each(years.map((c) => [c.taxYear, c] as const))("%s has Annual Allowance figures for itself and the three prior years", (year, config) => {
    const start = parseInt(year.slice(0, 4), 10);
    for (let n = 0; n <= 3; n++) {
      const key = `${start - n}/${String((start - n + 1) % 100).padStart(2, "0")}`;
      expect(config.pension.annualAllowanceHistory[key], key).toBeDefined();
    }
  });

  it("no year's config shares objects with another (no spreads from last year)", () => {
    for (const a of years) {
      for (const b of years) {
        if (a === b) continue;
        for (const [key, value] of Object.entries(a)) {
          if (value && typeof value === "object") {
            expect(value, `${a.taxYear}.${key} is the same object as ${b.taxYear}.${key}`).not.toBe(
              (b as unknown as Record<string, unknown>)[key]
            );
          }
        }
      }
    }
  });

  it("every source is recent enough, and unverified ones are listed", () => {
    const now = new Date();
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, now.getUTCDate()));
    const stale: string[] = [];
    const unverified: string[] = [];
    for (const config of years as TaxYearConfig[]) {
      for (const source of config.sources) {
        if (source.verifiedOn === null) unverified.push(`${config.taxYear} ${source.field}`);
        else if (new Date(source.verifiedOn) < cutoff) stale.push(`${config.taxYear} ${source.field} (${source.verifiedOn})`);
      }
    }
    if (unverified.length > 0) {
      console.info(`${unverified.length} config sources not yet verified:\n  ${unverified.join("\n  ")}`);
    }
    expect(stale).toEqual([]);
  });

  it("every verifiedOn is a real ISO date, not in the future, with a note saying how it was checked", () => {
    for (const config of years) {
      for (const source of config.sources) {
        if (source.verifiedOn === null) continue;
        expect(source.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(source.verifiedOn))).toBe(false);
        expect(new Date(source.verifiedOn).getTime()).toBeLessThanOrEqual(Date.now());
        expect(source.note, `${config.taxYear} ${source.field}`).toBeTruthy();
      }
    }
  });

  it("each source URL is an official GOV.UK or gov.scot page", () => {
    for (const config of years) {
      for (const source of config.sources) expect(source.url).toMatch(/^https:\/\/www\.gov\.(uk|scot)\//);
    }
  });

  it("no year's sources point at another year's dated page, unless a note explains why", () => {
    for (const config of years) {
      const start = parseInt(config.taxYear.slice(0, 4), 10);
      const ownYear = `${start}-to-${start + 1}`;
      for (const source of config.sources) {
        const dated = source.url.match(/(20\d\d)-to-(20\d\d)/g) ?? [];
        const foreign = dated.filter((d) => d !== ownYear && !source.url.includes(ownYear));
        if (foreign.length > 0) expect(source.note, `${config.taxYear} ${source.field}: ${source.url}`).toBeTruthy();
      }
    }
  });

  it("taxYearForDate is consistent with the configured years", () => {
    for (const config of years) {
      const start = parseInt(config.taxYear.slice(0, 4), 10);
      expect(taxYearForDate(new Date(Date.UTC(start, 3, 6)))).toBe(config.taxYear);
    }
  });
});
