import { describe, it, expect } from "vitest";
import {
  localDateStr, getMondayOf, getSaturdayOf, addWeeks,
  fullWeekBonusAmt, computeGross, kasbonOwed, kasbonSisa,
} from "../payroll.js";

describe("period helpers", () => {
  it("localDateStr pakai komponen local (tidak geser ke UTC)", () => {
    // 1 Jun 2026 jam 00:00 local
    expect(localDateStr(new Date(2026, 5, 1))).toBe("2026-06-01");
  });

  it("getMondayOf: Senin → Senin itu sendiri", () => {
    // 2026-06-01 adalah Senin
    expect(getMondayOf("2026-06-01")).toBe("2026-06-01");
  });

  it("getMondayOf: tengah minggu → Senin sebelumnya", () => {
    // 2026-06-03 (Rabu) → Senin 2026-06-01
    expect(getMondayOf("2026-06-03")).toBe("2026-06-01");
  });

  it("getMondayOf: Minggu → Senin minggu sebelumnya (bukan besok)", () => {
    // 2026-06-07 (Minggu) → Senin 2026-06-01
    expect(getMondayOf("2026-06-07")).toBe("2026-06-01");
  });

  it("getSaturdayOf: Senin + 5 hari", () => {
    expect(getSaturdayOf("2026-06-01")).toBe("2026-06-06");
  });

  it("addWeeks: maju & mundur seminggu", () => {
    expect(addWeeks("2026-06-01", 1)).toBe("2026-06-08");
    expect(addWeeks("2026-06-01", -1)).toBe("2026-05-25");
  });

  it("addWeeks lintas bulan tetap benar", () => {
    expect(addWeeks("2026-06-29", 1)).toBe("2026-07-06");
  });
});

describe("bonus & gross", () => {
  it("fullWeekBonusAmt beda Teknisi vs Helper", () => {
    expect(fullWeekBonusAmt("Teknisi")).toBe(100000);
    expect(fullWeekBonusAmt("Helper")).toBe(75000);
  });

  it("computeGross: gaji pokok murni", () => {
    const row = { days_worked: 6, daily_rate: 100000 };
    expect(computeGross(row)).toBe(600000);
  });

  it("computeGross: full week bonus + telat + kasbon + manual bonus", () => {
    const row = {
      role: "Teknisi", days_worked: 6, daily_rate: 100000,
      full_week_bonus: true,        // +100.000
      late_days: 1,                 // -10.000
      kasbon_deduct: 50000,         // -50.000
      manual_bonus: 25000,          // +25.000
    };
    // 600.000 +100.000 -10.000 -50.000 +25.000 = 665.000
    expect(computeGross(row)).toBe(665000);
  });

  it("computeGross: nilai null/undefined diperlakukan 0", () => {
    expect(computeGross({})).toBe(0);
  });
});

describe("kasbon carryover", () => {
  it("kasbonOwed = kasbon minggu ini + carryover minggu lalu", () => {
    // Kasus user: 800rb minggu ini + 200rb sisa minggu lalu = 1.000.000
    expect(kasbonOwed({ kasbon_total: 800000, kasbon_carryover: 200000 })).toBe(1000000);
  });

  it("kasbonSisa: owed dikurangi yang dipotong", () => {
    const row = { kasbon_total: 800000, kasbon_carryover: 200000, kasbon_deduct: 300000 };
    // owed 1.000.000 - dipotong 300.000 = sisa 700.000
    expect(kasbonSisa(row)).toBe(700000);
  });

  it("kasbonSisa tidak pernah negatif walau over-deduct", () => {
    const row = { kasbon_total: 100000, kasbon_carryover: 0, kasbon_deduct: 500000 };
    expect(kasbonSisa(row)).toBe(0);
  });

  it("kasbonSisa: potong penuh → sisa 0", () => {
    const row = { kasbon_total: 800000, kasbon_carryover: 200000, kasbon_deduct: 1000000 };
    expect(kasbonSisa(row)).toBe(0);
  });
});
