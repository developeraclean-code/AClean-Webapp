import { describe, it, expect } from "vitest";
import {
  logMeasurements, unitHealth, healthSummary,
  unitMeasurementSeries, unitBorosSignals, borosRanking,
} from "../maintenanceHealth.js";

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

  it("baris materials TEKANAN (autolog psi) TIDAK dihitung freon_added — anti false-flag bocor", () => {
    // Bentuk baris yang ditulis autolog portal.js pasca-fix
    const psiRow = logMeasurements(log({ materials: [{ nama: "Tekanan Freon AC Split 2PK", qty: "150", satuan: "psi" }] }));
    expect(psiRow.freon_added).toBe(false);
    // Guard satuan psi juga berdiri sendiri (nama apa pun)
    const psiSatuan = logMeasurements(log({ materials: [{ nama: "Freon R-32", qty: 110, satuan: "psi" }] }));
    expect(psiSatuan.freon_added).toBe(false);
    // Jasa isi freon (Unit) tetap terhitung sebagai penambahan nyata
    const kuras = logMeasurements(log({ materials: [{ nama: "Kuras Vacum + Isi Freon R32/R410", qty: 1, satuan: "Unit" }] }));
    expect(kuras.freon_added).toBe(true);
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

describe("logMeasurements — psi (tekanan freon)", () => {
  it("dari measurements.freon_psi", () => {
    expect(logMeasurements(log({ measurements: { freon_psi: 110 } })).psi).toBe(110);
  });
  it("fallback log lama: 'Freon +100' di description = psi", () => {
    expect(logMeasurements(log({ description: "Service Cleaning • Freon +100 • Ampere 2,1" })).psi).toBe(100);
  });
});

describe("unitMeasurementSeries", () => {
  it("urut ASC, hanya titik yang punya nilai/penanda", () => {
    const series = unitMeasurementSeries(U, [
      log({ service_date: "2026-07-01", measurements: { ampere: 2.5 } }),
      log({ service_date: "2026-03-01", measurements: { freon_psi: 100 } }),
      log({ service_date: "2026-05-01", description: "Cuci rutin tanpa ukur" }), // di-skip
    ]);
    expect(series.map(p => p.date)).toEqual(["2026-03-01", "2026-07-01"]);
    expect(series[0].psi).toBe(100);
    expect(series[1].ampere).toBe(2.5);
  });

  it("log unit lain tidak ikut", () => {
    expect(unitMeasurementSeries(U, [log({ unit_id: "lain", measurements: { ampere: 2 } })])).toEqual([]);
  });
});

describe("unitBorosSignals / borosRanking", () => {
  const sehat = { measurements: { kondisi_setelah: ["AC Dingin Kembali"] } };

  it("unit sehat tanpa sinyal → level null (tidak masuk daftar)", () => {
    const r = unitBorosSignals(U, [log(sehat)], [], TODAY);
    expect(r.level).toBeNull();
  });

  it("kesehatan BERMASALAH sendirian → minimal PANTAU (skor 40 ≥ 35)", () => {
    const r = unitBorosSignals(U, [log({ measurements: { kondisi_setelah: ["AC Masih Terkendala"] } })], [], TODAY);
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.level).toBe("PANTAU");
  });

  it("perbaikan berulang 12 bln menaikkan skor", () => {
    const logs = [
      log({ service_date: "2026-06-01", service_category: "perbaikan", ...sehat }),
      log({ service_date: "2026-04-01", service_category: "perbaikan" }),
      log({ service_date: "2026-02-01", service_category: "perbaikan" }),
    ];
    const r = unitBorosSignals(U, logs, [], TODAY);
    expect(r.reasons.join(" ")).toContain("3× perbaikan");
    expect(r.score).toBe(36); // cap frekuensi perbaikan
    expect(r.level).toBe("PANTAU");
  });

  it("kombinasi berat → GANTI (≥60)", () => {
    const fr = { materials: [{ nama: "Freon R-32", qty: 0.5 }] };
    const logs = [
      log({ service_date: "2026-06-20", service_category: "perbaikan", measurements: { kondisi_setelah: ["AC Masih Terkendala"] }, ...fr }),
      log({ service_date: "2026-05-01", service_category: "perbaikan", ...fr }),
      log({ service_date: "2026-03-15", service_category: "perbaikan", ...fr }),
    ];
    const r = unitBorosSignals(U, logs, [], TODAY);
    expect(r.level).toBe("GANTI");
  });

  it("follow-up open high-priority menambah skor; biaya & umur jadi bonus bila terisi", () => {
    const fu = [{ unit_id: "u1", status: "open", priority: "high" }];
    const unitTua = { id: "u1", year_installed: 2016 }; // 10 tahun
    const logs = [log({ service_date: "2026-06-01", cost: 1200000, ...sehat })];
    const r = unitBorosSignals(unitTua, logs, fu, TODAY);
    expect(r.reasons.join(" ")).toContain("1 temuan belum tuntas");
    expect(r.reasons.join(" ")).toContain("Umur ±10 tahun");
    expect(r.reasons.join(" ")).toContain("Biaya servis 12 bln");
    expect(r.score).toBe(12 + 20 + 20); // fu 12 + umur 20 + biaya 20
    expect(r.level).toBe("PANTAU");
  });

  it("borosRanking: hanya yang berlevel, urut skor tertinggi", () => {
    const units = [{ id: "u1" }, { id: "u2" }, { id: "u3" }];
    const logs = [
      log({ unit_id: "u1", measurements: { kondisi_setelah: ["AC Masih Terkendala"] } }),
      log({ unit_id: "u2", service_date: "2026-06-01", service_category: "perbaikan", measurements: { kondisi_setelah: ["AC Masih Terkendala"] } }),
      log({ unit_id: "u3", measurements: { kondisi_setelah: ["AC Dingin Kembali"] } }),
    ];
    const rank = borosRanking(units, logs, [], TODAY);
    expect(rank.map(r => r.unit.id)).toEqual(["u2", "u1"]); // u2 = bermasalah + perbaikan
    expect(rank[0].score).toBeGreaterThan(rank[1].score);
  });
});
