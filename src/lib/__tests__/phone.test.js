import { describe, it, expect } from "vitest";
import { normalizePhone, samePhone } from "../phone.js";

describe("normalizePhone", () => {
  it("converts 08 prefix to 628", () => {
    expect(normalizePhone("081234567890")).toBe("6281234567890");
  });
  it("keeps 62 prefix intact", () => {
    expect(normalizePhone("6281234567890")).toBe("6281234567890");
  });
  it("adds 62 to bare 8 prefix", () => {
    expect(normalizePhone("81234567890")).toBe("6281234567890");
  });
  it("strips spaces, dashes, parens, dots, plus", () => {
    expect(normalizePhone("+62 812-3456 (7890)")).toBe("6281234567890");
    expect(normalizePhone("0812.3456.7890")).toBe("6281234567890");
    expect(normalizePhone(" 0812 3456 7890 ")).toBe("6281234567890");
  });
  it("returns empty for falsy input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
  it("accepts numeric input", () => {
    expect(normalizePhone(81234567890)).toBe("6281234567890");
  });
});

describe("samePhone — dedup foundation", () => {
  it("matches across formats", () => {
    expect(samePhone("081234567890", "6281234567890")).toBe(true);
    expect(samePhone("+62 812-3456-7890", "081234567890")).toBe(true);
    expect(samePhone("81234567890", "081234567890")).toBe(true);
  });
  it("returns false for different numbers", () => {
    expect(samePhone("081234567890", "081111111111")).toBe(false);
  });
  it("returns false for falsy input", () => {
    expect(samePhone("", "081234567890")).toBe(false);
    expect(samePhone("081234567890", null)).toBe(false);
    expect(samePhone(null, null)).toBe(false);
  });
});
