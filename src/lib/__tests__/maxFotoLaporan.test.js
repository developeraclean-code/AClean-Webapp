// Guard: batas foto per laporan. Maintenance B2B butuh dokumentasi lebih banyak (50),
// customer reguler tetap 20. Sumber tunggal ini dipakai enforcement (fotoUpload.js)
// DAN gerbang UI (LaporanTeknisiModal) — kalau salah satu drift, teknisi bisa terblok
// atau kirim melebihi kapasitas PDF tanpa peringatan.
import { describe, it, expect } from "vitest";
import { maxFotoLaporan, MAX_FOTO_REGULAR, MAX_FOTO_MAINTENANCE } from "../laporanConstants.js";

describe("maxFotoLaporan", () => {
  it("job maintenance (punya maintenance_client_id) → 50", () => {
    expect(maxFotoLaporan({ maintenance_client_id: "c123" })).toBe(50);
    expect(MAX_FOTO_MAINTENANCE).toBe(50);
  });

  it("customer reguler (tanpa maintenance_client_id) → 20", () => {
    expect(maxFotoLaporan({ id: "JOB-1" })).toBe(20);
    expect(maxFotoLaporan({ maintenance_client_id: null })).toBe(20);
    expect(MAX_FOTO_REGULAR).toBe(20);
  });

  it("null-safe: laporanModal undefined/null → default reguler 20 (tak crash)", () => {
    expect(maxFotoLaporan(undefined)).toBe(20);
    expect(maxFotoLaporan(null)).toBe(20);
  });
});
