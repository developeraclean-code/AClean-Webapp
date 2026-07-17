import { describe, it, expect } from "vitest";
import { tenureMonths, fmtTenure, employmentStatus, PROBATION_MONTHS } from "../employment.js";

// `now` di-inject supaya test tidak bergantung tanggal sistem.
const NOW = new Date("2026-07-17T10:00:00");

describe("tenureMonths", () => {
  it("hitung bulan penuh, belum lewat tanggal → belum genap", () => {
    expect(tenureMonths("2026-04-18", NOW)).toBe(2); // 17 Jul blm lewat tgl 18 → 2 bln
    expect(tenureMonths("2026-04-17", NOW)).toBe(3); // pas tanggalnya → genap 3 bln
  });

  it("tanggal kosong / invalid → null (bukan 0, biar bisa dibedakan)", () => {
    expect(tenureMonths(null, NOW)).toBeNull();
    expect(tenureMonths("", NOW)).toBeNull();
    expect(tenureMonths("bukan-tanggal", NOW)).toBeNull();
  });

  it("tanggal masa depan tidak menghasilkan angka negatif", () => {
    expect(tenureMonths("2026-12-01", NOW)).toBe(0);
  });
});

describe("fmtTenure", () => {
  it("format tahun + bulan", () => {
    expect(fmtTenure("2018-03-20", NOW)).toBe("8 tahun 3 bulan"); // Usaeri
    expect(fmtTenure("2025-09-11", NOW)).toBe("10 bulan");        // Boim
    expect(fmtTenure("2021-01-09", NOW)).toBe("5 tahun 6 bulan"); // Aji
  });

  it("bulan pas kelipatan 12 → hanya tahun", () => {
    expect(fmtTenure("2025-07-17", NOW)).toBe("1 tahun");
  });

  it("baru masuk bulan ini → 'Baru bergabung'", () => {
    expect(fmtTenure("2026-07-13", NOW)).toBe("Baru bergabung");
  });

  it("tanggal kosong → null", () => {
    expect(fmtTenure(null, NOW)).toBeNull();
  });
});

describe("employmentStatus", () => {
  it("di bawah ambang → Masa Percobaan", () => {
    expect(employmentStatus("2026-06-02", NOW).key).toBe("PROBATION"); // Hamdan, 1 bln
    expect(employmentStatus("2026-07-13", NOW).key).toBe("PROBATION"); // baru masuk
  });

  it("tepat di ambang 3 bulan → sudah Karyawan Tetap", () => {
    expect(tenureMonths("2026-04-17", NOW)).toBe(PROBATION_MONTHS);
    expect(employmentStatus("2026-04-17", NOW).key).toBe("PERMANENT");
  });

  it("sehari sebelum genap 3 bulan → masih Masa Percobaan", () => {
    expect(employmentStatus("2026-04-18", NOW).key).toBe("PROBATION");
  });

  it("lama kerja bertahun → Karyawan Tetap", () => {
    expect(employmentStatus("2018-03-20", NOW).key).toBe("PERMANENT"); // Usaeri
    expect(employmentStatus("2021-02-01", NOW).key).toBe("PERMANENT"); // Mulyadi
  });

  it("tanggal kosong → UNKNOWN, jangan ditebak jadi tetap/percobaan", () => {
    expect(employmentStatus(null, NOW).key).toBe("UNKNOWN"); // Ardi
  });
});
