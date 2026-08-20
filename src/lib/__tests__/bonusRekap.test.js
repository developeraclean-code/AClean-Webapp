import { describe, it, expect } from "vitest";
import { buildBonusRekap, bonusRekapToCSV, bonusRekapToPrintHTML } from "../bonusRekap.js";
import { DEFAULT_BONUS_CATEGORIES } from "../../constants/bonus.js";

const CATS = DEFAULT_BONUS_CATEGORIES;

// Tanggal jauh di masa lalu → status PENDING otomatis jadi ELIGIBLE (>30 hari).
const OLD = "2020-01-10";

const orders = [
  { id: "J1", date: OLD, customer: "Budi", service: "Service", units: 2,
    teknisi: "Mulyadi", teknisi2: "Rian", helper: "Albana", invoice_id: "INV1" },
  { id: "J2", date: OLD, customer: "Siti", service: "Service", units: 1,
    teknisi: "Boim", helper: "Hamdan", invoice_id: "INV2" },
  { id: "J3", date: OLD, customer: "Toko Jaya", service: "Cuci AC", units: 1,
    teknisi: "Mulyadi", invoice_id: "INV3" },
  { id: "J4", date: OLD, customer: "Andi", service: "Service", units: 1,
    teknisi: "Boim", invoice_id: "INV4" },
];

const invMap = {
  INV1: { id: "INV1", total: 1500000, materials_detail: JSON.stringify([{ nama: "Kuras Vacum + Isi Freon R32" }, { nama: "Kapasitor AC 25uF" }]) },
  INV2: { id: "INV2", total: 250000,  materials_detail: JSON.stringify([{ nama: "Kapasitor AC 15uF" }]) },
  INV3: { id: "INV3", total: 150000,  materials_detail: "[]" },
  INV4: { id: "INV4", total: 300000,  materials_detail: JSON.stringify([{ nama: "Kuras Vacum + Isi Freon R22" }]) },
};

const bonuses = [
  { id: "b1", order_id: "J1", order_date: OLD, bonus_type: "freon",     total_amount: 25000, amount_per_person: 12500, member_count: 2, team_members: ["Mulyadi", "Rian"], status: "PENDING" },
  { id: "b2", order_id: "J1", order_date: OLD, bonus_type: "kapasitor", total_amount: 35000, amount_per_person: 17500, member_count: 2, team_members: ["Mulyadi", "Rian"], status: "PENDING" },
  { id: "b3", order_id: "J2", order_date: OLD, bonus_type: "kapasitor", total_amount: 35000, amount_per_person: 35000, member_count: 1, team_members: ["Boim"], status: "PAID", paid_by: "Owner" },
  // J3 ditandai tidak dapat bonus (sentinel dismissed)
  { id: "b4", order_id: "J3", order_date: OLD, bonus_type: "dismissed", total_amount: 0, amount_per_person: 0, member_count: 0, team_members: [], status: "VOID", void_reason: "Complain customer" },
];

const build = () => buildBonusRekap({ month: "2020-01", bonuses, orders, invMap, bonusCategories: CATS });

describe("buildBonusRekap", () => {
  it("mengelompokkan multi-kategori bonus jadi satu baris per job", () => {
    const r = build();
    const j1 = r.included.find(x => x.orderId === "J1");
    expect(j1.freon).toBe(25000);
    expect(j1.kapasitor).toBe(35000);
    expect(j1.totalBonus).toBe(60000);
    expect(j1.teknisi).toBe("Mulyadi, Rian");
    expect(j1.helper).toBe("Albana");
    expect(j1.nilai).toBe(1500000);
  });

  it("PENDING >30 hari dihitung sebagai Siap Cair", () => {
    const r = build();
    const j1 = r.included.find(x => x.orderId === "J1");
    expect(j1.statuses).toEqual(["ELIGIBLE"]);
    expect(r.summary.totalSiapCair).toBe(60000);
    expect(r.summary.totalDibayar).toBe(35000);
  });

  it("job dismissed & belum di-input masuk daftar TIDAK termasuk dengan alasannya", () => {
    const r = build();
    const j3 = r.excluded.find(x => x.orderId === "J3");
    expect(j3.kategori).toBe("DISMISSED");
    expect(j3.alasan).toContain("Complain");

    const j4 = r.excluded.find(x => x.orderId === "J4");
    expect(j4.kategori).toBe("BELUM_INPUT"); // ada freon → layak, tapi belum diinput
    expect(j4.alasan).toContain("freon");
  });

  it("job tanpa kriteria bonus diberi label NO_CRITERIA", () => {
    const r = buildBonusRekap({
      month: "2020-01", bonuses: [], bonusCategories: CATS,
      orders: [orders[2]], invMap: { INV3: invMap.INV3 },
    });
    expect(r.excluded[0].kategori).toBe("NO_CRITERIA");
    expect(r.included).toHaveLength(0);
  });

  it("rekap per orang membagi bonus sesuai amount_per_person", () => {
    const r = build();
    const mul = r.perPerson.find(p => p.nama === "Mulyadi");
    expect(mul.jobCount).toBe(1);
    expect(mul.total).toBe(30000);   // 12500 freon + 17500 kapasitor
    expect(mul.eligible).toBe(30000);
    const boim = r.perPerson.find(p => p.nama === "Boim");
    expect(boim.paid).toBe(35000);
  });

  it("ringkasan menjumlahkan freon/kapasitor/total & mencatat job tanpa bonus", () => {
    const r = build();
    expect(r.summary.totalJobSelesai).toBe(4);
    expect(r.summary.totalJobBonus).toBe(2);
    expect(r.summary.totalFreon).toBe(25000);
    expect(r.summary.totalKapasitor).toBe(70000);
    expect(r.summary.totalBonus).toBe(95000);
    expect(r.summary.excludedCount).toBe(2);
  });

  it("bonus VOID tidak dihitung tapi tetap tercatat untuk audit", () => {
    const r = buildBonusRekap({
      month: "2020-01", bonusCategories: CATS, orders: [orders[1]], invMap,
      bonuses: [{ ...bonuses[2], status: "VOID", void_reason: "Salah input" }],
    });
    expect(r.summary.totalBonus).toBe(0);
    expect(r.excluded.find(e => e.kategori === "VOID").alasan).toContain("Salah input");
  });
});

describe("exporter", () => {
  it("CSV memuat semua section + angka mentah untuk di-SUM", () => {
    const csv = bonusRekapToCSV(build());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("=== TERMASUK BONUS (2 job) ===");
    expect(csv).toContain("=== TIDAK TERMASUK BONUS (2 job) ===");
    expect(csv).toContain("=== REKAP PER ORANG");
    expect(csv).toContain("=== REKAP PER KATEGORI BONUS ===");
    expect(csv).toContain(",60000,"); // total bonus J1 sebagai angka
  });

  it("HTML cetak berisi tabel & auto-print", () => {
    const html = bonusRekapToPrintHTML(build());
    expect(html).toContain("REKAP BONUS KARYAWAN");
    expect(html).toContain("A. TERMASUK BONUS (2 job)");
    expect(html).toContain("B. TIDAK TERMASUK BONUS (2 job)");
    expect(html).toContain("window.print()");
    expect(bonusRekapToPrintHTML(build(), { autoPrint: false })).not.toContain("window.print()");
  });
});
