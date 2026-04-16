import { describe, it, expect } from "vitest";
import {
  validateEmail, validatePhone, validateTime, validateDate,
  validatePositiveNumber, validateAddressLength, validateNameLength,
  validateFileSize, validationError, validationOk,
} from "../validators.js";

describe("validateEmail", () => {
  it("accepts valid emails", () => {
    expect(validateEmail("user@example.com")).toBe(true);
    expect(validateEmail("a.b@c.co")).toBe(true);
  });
  it("rejects invalid emails", () => {
    expect(validateEmail("")).toBe(false);
    expect(validateEmail("noatsign")).toBe(false);
    expect(validateEmail("@no-local.com")).toBe(false);
    expect(validateEmail(null)).toBe(false);
  });
});

describe("validatePhone", () => {
  it("accepts Indonesian phone formats", () => {
    expect(validatePhone("081234567890")).toBe(true);
    expect(validatePhone("6281234567890")).toBe(true);
    expect(validatePhone("08123456789")).toBe(true);
  });
  it("rejects short/invalid numbers", () => {
    expect(validatePhone("0812")).toBe(false);
    expect(validatePhone("")).toBe(false);
    expect(validatePhone(null)).toBe(false);
  });
});

describe("validateTime", () => {
  it("accepts HH:MM", () => {
    expect(validateTime("08:30")).toBe(true);
    expect(validateTime("23:59")).toBe(true);
    expect(validateTime("0:00")).toBe(true);
  });
  it("rejects invalid times", () => {
    expect(validateTime("25:00")).toBe(false);
    expect(validateTime("12:60")).toBe(false);
    expect(validateTime("")).toBe(false);
  });
});

describe("validateDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(validateDate("2026-04-15")).toBe(true);
  });
  it("rejects bad formats", () => {
    expect(validateDate("15-04-2026")).toBe(false);
    expect(validateDate("not-a-date")).toBe(false);
    expect(validateDate("")).toBe(false);
  });
});

describe("validatePositiveNumber", () => {
  it("accepts positive numbers", () => {
    expect(validatePositiveNumber(1)).toBe(true);
    expect(validatePositiveNumber(0.5)).toBe(true);
    expect(validatePositiveNumber("100")).toBe(true);
  });
  it("rejects zero/negative/NaN", () => {
    expect(validatePositiveNumber(0)).toBe(false);
    expect(validatePositiveNumber(-1)).toBe(false);
    expect(validatePositiveNumber("abc")).toBe(false);
  });
});

describe("validateAddressLength", () => {
  it("accepts 5-255 chars", () => {
    expect(validateAddressLength("Jl. Raya")).toBe(true);
  });
  it("rejects too short/long", () => {
    expect(validateAddressLength("ab")).toBe(false);
    expect(validateAddressLength("x".repeat(256))).toBe(false);
    expect(validateAddressLength("")).toBe(false);
  });
});

describe("validateNameLength", () => {
  it("accepts 2-100 chars", () => {
    expect(validateNameLength("Dedy")).toBe(true);
  });
  it("rejects too short/long", () => {
    expect(validateNameLength("D")).toBe(false);
    expect(validateNameLength("x".repeat(101))).toBe(false);
  });
});

describe("validateFileSize", () => {
  it("accepts within limit", () => {
    expect(validateFileSize(1024 * 1024)).toBe(true);
    expect(validateFileSize(5 * 1024 * 1024)).toBe(true);
  });
  it("rejects over limit", () => {
    expect(validateFileSize(6 * 1024 * 1024)).toBe(false);
  });
  it("respects custom maxMB", () => {
    expect(validateFileSize(2 * 1024 * 1024, 1)).toBe(false);
    expect(validateFileSize(9 * 1024 * 1024, 10)).toBe(true);
  });
});

describe("validationError / validationOk", () => {
  it("returns structured result", () => {
    expect(validationOk()).toEqual({ ok: true });
    expect(validationError("phone", "wajib diisi")).toEqual({ ok: false, field: "phone", message: "wajib diisi" });
  });
});
