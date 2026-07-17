import { describe, it, expect } from "vitest";
import { logMeasurements, unitHealth, healthSummary } from "../maintenanceHealth.js";

const TODAY = "2026-07-17";
const U = { id: "u1", next_service_date: null };
const log = (over = {}) => ({ unit_id: "u1", service_date: "2026-07-01", description: "", materials: [], measurements: null, ...over });

describe("logMeasurements — log baru (measurements terstruktur)", () => {
  it("baca kondisi & ampere dari measurements", () => {
    const m = logMeasurements(log({ measurements: { kondisi_setelah: ["AC Dingin Kembali"], ampere: 2.1, freon_psi: 100 } }));
    expect(m.kondisi_setelah).toEqual(["AC Dingin Kembali"]);
    expect(m.ampere).toBe(2.1);
  });

  it("freon_added dari materials, BUKAN dari freon_psi (psi = tekanan)", () => {
    const tanpaMat = logMeasurements(log({ measurements: { freon_psi: 120 } }));
    expect(tanpaMat.freon_added).toBe(false);
    const dgnMat = logMeasurements(log({ materials: [{ nama: "Freon R-32", qty: 0.5, satuan: "kg" }] }));
    expect(dgnMat.freon_added).toBe(true);
  });
});

describe("logMeasurements — fallback log lama (parse description produksi)", () => {
  it("parse format autolog lama persis", () => {
    const m = logMeasurements(log({
      description: "Service Cleaning, Cleaning Indoor dan Outdoor • Kondisi: AC Dingin Kembali, Semua Fungsi Normal • Ampere 2,4",
    }));
    expect(m.kondisi_setelah).toEqual(["AC Dingin Kembali", "Semua Fungsi Normal"]);
    expect(m.ampere).toBe(2.4);
  });

  it("description tanpa kondisi/ampere → kosong tanpa error", () => {
    const m = logMeasurements(log({ description: "Cuci & service rutin." }));
    expect(m.kondisi_setelah).toEqual([]);
    expect(m.ampere).toBeNull();
  });
});

describe("unitHealth", () => {
  it("tanpa log → NO_DATA", () => {
    expect(unitHealth(U, [], TODAY).key).toBe("NO_DATA");
    expect(unitHealth(U, [log({ unit_id: "unit-lain" })], TODAY).key).toBe("NO_DATA");
  });

  it("kondisi terakhir baik → SEHAT", () => {
    const h = unitHealth(U, [log({ measurements: { kondisi_setelah: ["AC Dingin Kembali"] } })], TODAY);
    expect(h.key).toBe("SEHAT");
  });

  it("kondisi merah (AC Masih Terkendala) → BERMASALAH", () => {
    const h = unitHealth(U, [log({ measurements: { kondisi_setelah: ["AC Masih Terkendala"] } })], TODAY);
    expect(h.key).toBe("BERMASALAH");
  });

  it("kondisi warning (Perlu Service Besar) → PERHATIAN", () => {
    const h = unitHealth(U, [log({ measurements: { kondisi_setelah: ["Perlu Service Besar"] } })], TODAY);
    expect(h.key).toBe("PERHATIAN");
  });

  it("yang dinilai kondisi log TERBARU, bukan lama", () => {
    const h = unitHealth(U, [
      log({ service_date: "2026-01-10", measurements: { kondisi_setelah: ["AC Masih Terkendala"] } }),
      log({ service_date: "2026-07-01", measurements: { kondisi_setelah: ["AC Dingin Kembali"] } }),
    ], TODAY);
    expect(h.key).toBe("SEHAT");
  });

  it("tambah freon 2× dlm 6 bln → PERHATIAN (indikasi bocor)", () => {
    const fr = { materials: [{ nama: "Freon R-32", qty: 0.4 }], measurements: { kondisi_setelah: ["AC Dingin Kembali"] } };
    const h = unitHealth(U, [
      log({ service_date: "2026-06-20", ...fr }),
      log({ service_date: "2026-03-15", ...fr }),
    ], TODAY);
    expect(h.key).toBe("PERHATIAN");
    expect(h.reasons.join(" ")).toContain("indikasi bocor");
  });

  it("tambah freon 3× dlm 6 bln → BERMASALAH; di luar 6 bln tidak dihitung", () => {
    const fr = { materials: [{ nama: "Freon R-410A", qty: 0.5 }], measurements: { kondisi_setelah: ["AC Dingin Kembali"] } };
    const dalam = [
      log({ service_date: "2026-06-20", ...fr }),
      log({ service_date: "2026-05-01", ...fr }),
      log({ service_date: "2026-03-15", ...fr }),
    ];
    expect(unitHealth(U, dalam, TODAY).key).toBe("BERMASALAH");
    const luar = [
      log({ service_date: "2026-06-20", ...fr }),
      log({ service_date: "2025-09-01", ...fr }), // > 6 bln lalu
      log({ service_date: "2025-08-01", ...fr }),
    ];
    expect(unitHealth(U, luar, TODAY).key).toBe("SEHAT");
  });

  it("ampere naik >15% dari pengukuran sebelumnya → PERHATIAN", () => {
    const h = unitHealth(U, [
      log({ service_date: "2026-07-01", measurements: { ampere: 3.0, kondisi_setelah: ["AC Dingin Kembali"] } }),
      log({ service_date: "2026-04-01", measurements: { ampere: 2.4 } }),
    ], TODAY);
    expect(h.key).toBe("PERHATIAN");
    expect(h.reasons.join(" ")).toContain("Ampere naik");
  });

  it("ampere stabil → tetap SEHAT", () => {
    const h = unitHealth(U, [
      log({ service_date: "2026-07-01", measurements: { ampere: 2.5, kondisi_setelah: ["AC Dingin Kembali"] } }),
      log({ service_date: "2026-04-01", measurements: { ampere: 2.4 } }),
    ], TODAY);
    expect(h.key).toBe("SEHAT");
  });

  it("jadwal terlewat → PERHATIAN walau kondisi baik", () => {
    const u = { id: "u1", next_service_date: "2026-06-01" };
    const h = unitHealth(u, [log({ measurements: { kondisi_setelah: ["AC Dingin Kembali"] } })], TODAY);
    expect(h.key).toBe("PERHATIAN");
    expect(h.reasons.join(" ")).toContain("terlewat");
  });

  it("log lama (description) tetap bisa memicu BERMASALAH — retroaktif", () => {
    const h = unitHealth(U, [log({ description: "Cuci • Kondisi: AC Masih Terkendala" })], TODAY);
    expect(h.key).toBe("BERMASALAH");
  });
});

describe("healthSummary", () => {
  it("hitung ringkasan per klien", () => {
    const units = [{ id: "u1" }, { id: "u2" }, { id: "u3" }];
    const logs = [
      log({ unit_id: "u1", measurements: { kondisi_setelah: ["AC Dingin Kembali"] } }),
      log({ unit_id: "u2", measurements: { kondisi_setelah: ["AC Masih Terkendala"] } }),
    ];
    const s = healthSummary(units, logs, TODAY);
    expect(s).toEqual({ SEHAT: 1, PERHATIAN: 0, BERMASALAH: 1, NO_DATA: 1 });
  });
});
