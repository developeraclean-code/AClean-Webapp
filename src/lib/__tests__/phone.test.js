import { describe, it, expect } from "vitest";
import { normalizePhone, samePhone, formatPhone, cleanPhoneInput } from "../phone.js";

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

describe("normalizePhone — internasional (+)", () => {
  it("nomor + internasional literal, tanpa prefix 62", () => {
    expect(normalizePhone("+49 176 123 4567")).toBe("491761234567");
    expect(normalizePhone("+60 10-892-6655")).toBe("60108926655");
    expect(normalizePhone("+971 54 474 3743")).toBe("971544743743");
  });
  it("kode negara berawalan 8 (Jepang/China) tidak jadi 628 saat pakai +", () => {
    expect(normalizePhone("+81 90 1234 5678")).toBe("819012345678");
    expect(normalizePhone("+86 138 0000 0000")).toBe("8613800000000");
  });
  it("+62 tetap jadi 628 (Indonesia)", () => {
    expect(normalizePhone("+62 812-3456-7890")).toBe("6281234567890");
  });
  it("tanpa + perilaku lama tetap (8 → 628)", () => {
    expect(normalizePhone("81234567890")).toBe("6281234567890");
  });
});

describe("cleanPhoneInput — jaga + saat mengetik", () => {
  it("mempertahankan + di awal, buang karakter lain", () => {
    expect(cleanPhoneInput("+49 176-123")).toBe("+49176123");
    expect(cleanPhoneInput("+81 90")).toBe("+8190");
  });
  it("tanpa + hanya digit", () => {
    expect(cleanPhoneInput("0812 3456")).toBe("08123456");
    expect(cleanPhoneInput("(0812) 3456")).toBe("08123456");
  });
  it("kosong / falsy aman", () => {
    expect(cleanPhoneInput("")).toBe("");
    expect(cleanPhoneInput(null)).toBe("");
    expect(cleanPhoneInput("+")).toBe("+");
  });
});

describe("formatPhone — tampilan seragam internasional", () => {
  it("Indonesia → +62 dengan pengelompokan", () => {
    expect(formatPhone("6281234567890")).toBe("+62 812-3456-7890");
    expect(formatPhone("081234567890")).toBe("+62 812-3456-7890");
  });
  it("luar negeri → + kode negara", () => {
    expect(formatPhone("491761234567")).toBe("+49 176-1234-567");
    expect(formatPhone("971544743743")).toBe("+971 544-7437-43");
  });
  it("falsy → string kosong", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
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
