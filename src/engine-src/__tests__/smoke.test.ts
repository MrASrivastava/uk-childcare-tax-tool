import { describe, expect, it } from "vitest";
import { calculate } from "../index";
import { household } from "./fixtures";

describe("calculate", () => {
  it("runs for a single-parent household", () => {
    const result = calculate(household());
    expect(result.parentA.ani.adjustedNetIncome).toBe(50_000);
  });
});
