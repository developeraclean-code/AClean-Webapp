// Rekap bonus/komisi karyawan per BULAN — builder murni + exporter (CSV & HTML cetak).
//
// Tujuan: Owner/Admin bisa unduh & cetak untuk cek manual — terlihat jelas job mana yang
// TERMASUK bonus (beserta rincian Freon/Kapasitor/lainnya) dan job mana yang TIDAK termasuk
// beserta alasannya (ditandai tidak dapat bonus, belum di-review, atau tak memenuhi kriteria).
//
// buildBonusRekap() murni (tanpa DOM/Supabase) → bisa di-unit-test.
// downloadBonusRekapCSV() / printBonusRekap() punya side-effect (buat file / buka window).

import { detectBonusFromInvoice, bonusCandidateInfo, orderTeknisi, orderHelper, effBonusStatus } from "./bonus.js";

export const REKAP_STATUS_LABELS = {
  PENDING:  "Dalam Warranty",
  ELIGIBLE: "Siap Cair",
  PAID:     "Sudah Dibayar",
  VOID:     "Void",
};

export const EXCLUDE_LABELS = {
  DISMISSED:  "Ditandai tidak dapat bonus",
  BELUM_INPUT:"Layak bonus — BELUM di-input",
  NO_CRITERIA:"Tidak memenuhi kriteria bonus",
  VOID:       "Bonus di-void",
};

export function fmtMonthLabel(ym) {
  const [y, m] = String(ym || "").split("-");
  if (!y || !m) return String(ym || "-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
function fmtDateShort(d) {
  if (!d) return "-";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function rp(n) { return "Rp " + Number(n || 0).toLocaleString("id-ID"); }

/**
 * Bangun struktur rekap bulanan.
 * @param {object} p
 * @param {string} p.month            "2026-08"
 * @param {Array}  p.bonuses          baris order_bonuses periode itu (termasuk sentinel 'dismissed')
 * @param {Array}  p.orders           orders SELESAI di periode itu (sumber nama teknisi/helper)
 * @param {object} p.invMap           { invoiceId: { id, total, materials_detail } }
 * @param {Array}  p.bonusCategories  kategori bonus aktif (untuk label + deteksi material)
 */
export function buildBonusRekap({ month, bonuses = [], orders = [], invMap = {}, bonusCategories = [] }) {
  const labels = Object.fromEntries(bonusCategories.map(c => [c.id, c.label]));
  const orderMap = Object.fromEntries(orders.map(o => [o.id, o]));

  const invOf   = (o) => (o && o.invoice_id ? invMap[o.invoice_id] : null) || null;
  const totalOf = (o) => Number(invOf(o)?.total || 0);

  // ── Kelompokkan bonus per order ──
  const byOrder = {};
  const dismissedMap = {};
  for (const b of bonuses) {
    const key = b.order_id || `(tanpa-order)-${b.id}`;
    if (b.bonus_type === "dismissed") { dismissedMap[b.order_id] = b; continue; }
    (byOrder[key] = byOrder[key] || []).push(b);
  }

  const included = [];
  const excluded = [];
  const perPersonMap = {};
  const byCategoryMap = {};

  const addPerson = (nama, bonus, est) => {
    if (!nama) return;
    const p = perPersonMap[nama] = perPersonMap[nama] || {
      nama, jobIds: new Set(), total: 0, paid: 0, eligible: 0, pending: 0,
    };
    const amt = Number(bonus.amount_per_person || 0);
    p.jobIds.add(bonus.order_id || bonus.id);
    p.total += amt;
    if (est === "PAID") p.paid += amt;
    else if (est === "ELIGIBLE") p.eligible += amt;
    else if (est === "PENDING") p.pending += amt;
  };

  for (const [orderId, rows] of Object.entries(byOrder)) {
    const o = orderMap[orderId] || null;
    const aktif = rows.filter(b => effBonusStatus(b) !== "VOID");
    const voided = rows.filter(b => effBonusStatus(b) === "VOID");

    // Baris VOID → masuk daftar TIDAK termasuk (audit), tidak dihitung di total.
    for (const b of voided) {
      excluded.push({
        orderId:   b.order_id || "-",
        date:      b.order_date,
        customer:  o?.customer || "-",
        service:   o?.service || "-",
        units:     o?.units ?? "-",
        teknisi:   orderTeknisi(o).join(", ") || (b.team_members || []).join(", ") || "-",
        helper:    orderHelper(o).join(", ") || "-",
        nilai:     o ? totalOf(o) : Number(b.gross_revenue || 0),
        kategori:  "VOID",
        alasan:    `${labels[b.bonus_type] || b.bonus_type} — ${b.void_reason || "tanpa alasan"}`,
        nilaiBonusBatal: Number(b.total_amount || 0),
      });
    }
    if (aktif.length === 0) continue;

    let freon = 0, kapasitor = 0, lain = 0;
    const lainDetail = [];
    const statuses = new Set();
    let totalBonus = 0, perOrang = 0, memberCount = 0;
    const team = new Set();

    for (const b of aktif) {
      const est = effBonusStatus(b);
      const amt = Number(b.total_amount || 0);
      statuses.add(est);
      totalBonus += amt;
      perOrang = Math.max(perOrang, Number(b.amount_per_person || 0));
      memberCount = Math.max(memberCount, Number(b.member_count || (b.team_members || []).length || 0));
      (b.team_members || []).forEach(m => { team.add(m); addPerson(m, b, est); });

      if (b.bonus_type === "freon") freon += amt;
      else if (b.bonus_type === "kapasitor") kapasitor += amt;
      else { lain += amt; lainDetail.push(`${labels[b.bonus_type] || b.bonus_type} ${rp(amt)}`); }

      const c = byCategoryMap[b.bonus_type] = byCategoryMap[b.bonus_type] ||
        { id: b.bonus_type, label: labels[b.bonus_type] || b.bonus_type, count: 0, amount: 0 };
      c.count += 1;
      c.amount += amt;
    }

    const nilai = o ? totalOf(o) : Number(aktif[0]?.gross_revenue || 0);
    included.push({
      orderId:  orderId.startsWith("(tanpa-order)") ? "-" : orderId,
      date:     aktif[0]?.order_date || o?.date || null,
      customer: o?.customer || "-",
      service:  o?.service || "-",
      units:    o?.units ?? "-",
      teknisi:  orderTeknisi(o).join(", ") || [...team].join(", ") || "-",
      helper:   orderHelper(o).join(", ") || "-",
      tim:      [...team].join(", ") || "-",
      memberCount,
      nilai,
      freon, kapasitor, lain,
      lainDetail: lainDetail.join(" + "),
      totalBonus,
      perOrang: memberCount > 0 ? totalBonus / memberCount : totalBonus,
      statusLabel: [...statuses].map(s => REKAP_STATUS_LABELS[s] || s).join(" / "),
      statuses: [...statuses],
      catatan: aktif.map(b => b.note).filter(Boolean).join(" · "),
    });
  }

  // ── Job SELESAI yang tidak punya bonus aktif → kenapa tidak termasuk ──
  const orderIdsWithBonus = new Set(Object.keys(byOrder).filter(k => byOrder[k].some(b => effBonusStatus(b) !== "VOID")));
  for (const o of orders) {
    if (orderIdsWithBonus.has(o.id)) continue;
    const inv  = invOf(o);
    const det  = detectBonusFromInvoice(inv?.materials_detail, o.service, bonusCategories);
    const cand = bonusCandidateInfo(o, Number(inv?.total || 0), det.detected);
    const dis  = dismissedMap[o.id];
    // Sudah tercatat lewat baris VOID di atas? (dismissed sentinel ditangani terpisah)
    if (excluded.some(e => e.orderId === o.id && e.kategori === "VOID")) continue;

    excluded.push({
      orderId:  o.id,
      date:     o.date,
      customer: o.customer || "-",
      service:  o.service || "-",
      units:    o.units ?? "-",
      teknisi:  orderTeknisi(o).join(", ") || "-",
      helper:   orderHelper(o).join(", ") || "-",
      nilai:    Number(inv?.total || 0),
      kategori: dis ? "DISMISSED" : (cand.eligible ? "BELUM_INPUT" : "NO_CRITERIA"),
      alasan:   dis
        ? (dis.void_reason || dis.note || "Ditandai manual tidak dapat bonus")
        : (cand.eligible
            ? "Memenuhi: " + cand.reasons.join(", ") + " — belum diinput admin"
            : "Omset " + rp(inv?.total || 0) + (o.service === "Install" ? ` · Install ${o.units || 0} unit` : "") + " · tanpa material bonus"),
      nilaiBonusBatal: 0,
    });
  }

  included.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.orderId).localeCompare(String(b.orderId)));
  excluded.sort((a, b) => String(a.kategori).localeCompare(String(b.kategori)) || String(a.date || "").localeCompare(String(b.date || "")));

  const perPerson = Object.values(perPersonMap)
    .map(p => ({ nama: p.nama, jobCount: p.jobIds.size, total: p.total, paid: p.paid, eligible: p.eligible, pending: p.pending }))
    .sort((a, b) => b.total - a.total);

  const sumBy = (pred) => included.filter(pred).reduce((s, r) => s + r.totalBonus, 0);

  return {
    month,
    monthLabel: fmtMonthLabel(month),
    generatedAt: new Date(),
    included,
    excluded,
    perPerson,
    summary: {
      totalJobBonus:  included.length,
      totalBonus:     included.reduce((s, r) => s + r.totalBonus, 0),
      totalFreon:     included.reduce((s, r) => s + r.freon, 0),
      totalKapasitor: included.reduce((s, r) => s + r.kapasitor, 0),
      totalLain:      included.reduce((s, r) => s + r.lain, 0),
      totalNilaiTrx:  included.reduce((s, r) => s + r.nilai, 0),
      totalDibayar:   sumBy(r => r.statuses.includes("PAID")),
      totalSiapCair:  sumBy(r => r.statuses.includes("ELIGIBLE")),
      totalWarranty:  sumBy(r => r.statuses.includes("PENDING")),
      byCategory:     Object.values(byCategoryMap).sort((a, b) => b.amount - a.amount),
      excludedCount:  excluded.length,
      excludedByKategori: excluded.reduce((acc, e) => { acc[e.kategori] = (acc[e.kategori] || 0) + 1; return acc; }, {}),
      totalJobSelesai: orders.length,
    },
  };
}

// ── CSV (Excel-friendly, BOM + angka mentah supaya bisa di-SUM) ──
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function bonusRekapToCSV(rekap) {
  const rows = [];
  rows.push(q("REKAP BONUS KARYAWAN — ACLEAN SERVICE AC"));
  rows.push(q("Periode: " + rekap.monthLabel));
  rows.push(q("Digenerate: " + rekap.generatedAt.toLocaleString("id-ID")));
  rows.push("");

  const s = rekap.summary;
  rows.push(q("=== RINGKASAN ==="));
  rows.push([q("Job selesai bulan ini"), s.totalJobSelesai].join(","));
  rows.push([q("Job DAPAT bonus"), s.totalJobBonus].join(","));
  rows.push([q("Job TIDAK dapat bonus"), s.excludedCount].join(","));
  rows.push([q("Total nilai transaksi (job berbonus)"), s.totalNilaiTrx].join(","));
  rows.push([q("Total bonus Freon"), s.totalFreon].join(","));
  rows.push([q("Total bonus Kapasitor"), s.totalKapasitor].join(","));
  rows.push([q("Total bonus lain-lain"), s.totalLain].join(","));
  rows.push([q("TOTAL BONUS"), s.totalBonus].join(","));
  rows.push([q("— Sudah dibayar"), s.totalDibayar].join(","));
  rows.push([q("— Siap cair"), s.totalSiapCair].join(","));
  rows.push([q("— Dalam warranty"), s.totalWarranty].join(","));
  rows.push("");

  rows.push(q(`=== TERMASUK BONUS (${rekap.included.length} job) ===`));
  rows.push(["No","Tanggal","Job ID","Nama Job (Customer)","Layanan","Unit","Teknisi","Helper",
    "Nilai Transaksi","Freon","Kapasitor","Bonus Lain","Rincian Bonus Lain","Jumlah Bonus",
    "Jml Tim","Bonus/Orang","Status","Catatan"].map(q).join(","));
  rekap.included.forEach((r, i) => {
    rows.push([
      i + 1, q(fmtDateShort(r.date)), q(r.orderId), q(r.customer), q(r.service), q(r.units),
      q(r.teknisi), q(r.helper), r.nilai, r.freon, r.kapasitor, r.lain, q(r.lainDetail),
      r.totalBonus, r.memberCount || "", Math.round(r.perOrang), q(r.statusLabel), q(r.catatan),
    ].join(","));
  });
  rows.push(["", "", "", "", "", "", "", q("TOTAL"),
    rekap.summary.totalNilaiTrx, rekap.summary.totalFreon, rekap.summary.totalKapasitor,
    rekap.summary.totalLain, "", rekap.summary.totalBonus, "", "", "", ""].join(","));
  rows.push("");

  rows.push(q(`=== TIDAK TERMASUK BONUS (${rekap.excluded.length} job) ===`));
  rows.push(["No","Tanggal","Job ID","Nama Job (Customer)","Layanan","Unit","Teknisi","Helper",
    "Nilai Transaksi","Kategori","Alasan"].map(q).join(","));
  rekap.excluded.forEach((r, i) => {
    rows.push([
      i + 1, q(fmtDateShort(r.date)), q(r.orderId), q(r.customer), q(r.service), q(r.units),
      q(r.teknisi), q(r.helper), r.nilai, q(EXCLUDE_LABELS[r.kategori] || r.kategori), q(r.alasan),
    ].join(","));
  });
  rows.push("");

  rows.push(q(`=== REKAP PER ORANG (${rekap.perPerson.length} karyawan) ===`));
  rows.push(["No","Nama","Jumlah Job","Total Bagian Bonus","Sudah Dibayar","Siap Cair","Dalam Warranty"].map(q).join(","));
  rekap.perPerson.forEach((p, i) => {
    rows.push([i + 1, q(p.nama), p.jobCount, Math.round(p.total), Math.round(p.paid), Math.round(p.eligible), Math.round(p.pending)].join(","));
  });
  rows.push("");

  rows.push(q("=== REKAP PER KATEGORI BONUS ==="));
  rows.push(["No","Kategori","Jumlah Entri","Total Bonus"].map(q).join(","));
  rekap.summary.byCategory.forEach((c, i) => {
    rows.push([i + 1, q(c.label), c.count, c.amount].join(","));
  });

  return "﻿" + rows.join("\n");
}

// Slug nama file per kategori — dipakai unduhan tersaring (mis. hanya "layak bonus").
const KATEGORI_SLUG = {
  BELUM_INPUT: "Layak_Belum_Diinput",
  DISMISSED:   "Ditandai_Tanpa_Bonus",
  NO_CRITERIA: "Tidak_Memenuhi_Kriteria",
  VOID:        "Bonus_Void",
};

// CSV berisi HANYA job "tidak termasuk bonus" pada satu kategori (atau semua bila
// kategori null). Dipakai Owner untuk daftar kerja: mis. 48 job layak bonus yang
// masih perlu di-input, tanpa harus menyaring 388 baris di file rekap penuh.
export function bonusExcludedToCSV(rekap, kategori = null) {
  const rows_ = kategori ? rekap.excluded.filter(r => r.kategori === kategori) : rekap.excluded;
  const label = kategori ? (EXCLUDE_LABELS[kategori] || kategori) : "Semua kategori";
  const rows = [];
  rows.push(q("DAFTAR JOB TIDAK TERMASUK BONUS — ACLEAN SERVICE AC"));
  rows.push(q("Periode: " + rekap.monthLabel));
  rows.push(q("Kategori: " + label));
  rows.push(q("Jumlah job: " + rows_.length));
  rows.push(q("Digenerate: " + rekap.generatedAt.toLocaleString("id-ID")));
  rows.push("");
  rows.push(["No","Tanggal","Job ID","Nama Job (Customer)","Layanan","Unit","Teknisi","Helper",
    "Nilai Transaksi","Kategori","Alasan"].map(q).join(","));
  rows_.forEach((r, i) => {
    rows.push([
      i + 1, q(fmtDateShort(r.date)), q(r.orderId), q(r.customer), q(r.service), q(r.units),
      q(r.teknisi), q(r.helper), r.nilai, q(EXCLUDE_LABELS[r.kategori] || r.kategori), q(r.alasan),
    ].join(","));
  });
  rows.push(["", "", "", "", "", "", "", q("TOTAL NILAI"),
    rows_.reduce((s, r) => s + Number(r.nilai || 0), 0), "", ""].join(","));
  return "\ufeff" + rows.join("\n");
}

export function downloadBonusExcludedCSV(rekap, kategori = null) {
  const blob = new Blob([bonusExcludedToCSV(rekap, kategori)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Bonus_${KATEGORI_SLUG[kategori] || "Tanpa_Bonus"}_${rekap.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return a.download;
}

export function downloadBonusRekapCSV(rekap) {
  const blob = new Blob([bonusRekapToCSV(rekap)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Rekap_Bonus_AClean_${rekap.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return a.download;
}

// ── HTML siap cetak (A4 landscape) ──
const esc = (v) => String(v ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function bonusRekapToPrintHTML(rekap, { autoPrint = true } = {}) {
  const s = rekap.summary;
  const money = (n) => Number(n || 0).toLocaleString("id-ID");

  const incRows = rekap.included.map((r, i) => `<tr>
    <td class="c">${i + 1}</td><td class="nw">${esc(fmtDateShort(r.date))}</td><td class="mono">${esc(r.orderId)}</td>
    <td>${esc(r.customer)}</td><td>${esc(r.service)}</td><td class="c">${esc(r.units)}</td>
    <td>${esc(r.teknisi)}</td><td>${esc(r.helper)}</td>
    <td class="r">${money(r.nilai)}</td>
    <td class="r">${r.freon ? money(r.freon) : "-"}</td>
    <td class="r">${r.kapasitor ? money(r.kapasitor) : "-"}</td>
    <td class="r">${r.lain ? money(r.lain) : "-"}${r.lainDetail ? `<div class="sub">${esc(r.lainDetail)}</div>` : ""}</td>
    <td class="r b">${money(r.totalBonus)}</td>
    <td class="c nw">${esc(r.statusLabel)}</td>
    <td class="chk">&#9744;</td>
  </tr>`).join("");

  const excRows = rekap.excluded.map((r, i) => `<tr>
    <td class="c">${i + 1}</td><td class="nw">${esc(fmtDateShort(r.date))}</td><td class="mono">${esc(r.orderId)}</td>
    <td>${esc(r.customer)}</td><td>${esc(r.service)}</td><td class="c">${esc(r.units)}</td>
    <td>${esc(r.teknisi)}</td><td>${esc(r.helper)}</td>
    <td class="r">${money(r.nilai)}</td>
    <td class="nw">${esc(EXCLUDE_LABELS[r.kategori] || r.kategori)}</td>
    <td>${esc(r.alasan)}</td>
    <td class="chk">&#9744;</td>
  </tr>`).join("");

  const personRows = rekap.perPerson.map((p, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(p.nama)}</td><td class="c">${p.jobCount}</td>
    <td class="r b">${money(Math.round(p.total))}</td>
    <td class="r">${money(Math.round(p.paid))}</td>
    <td class="r">${money(Math.round(p.eligible))}</td>
    <td class="r">${money(Math.round(p.pending))}</td>
    <td class="chk">&#9744;</td>
  </tr>`).join("");

  const catRows = rekap.summary.byCategory.map(c => `<tr>
    <td>${esc(c.label)}</td><td class="c">${c.count}</td><td class="r">${money(c.amount)}</td>
  </tr>`).join("");

  return `<meta charset="utf-8"><title>Rekap Bonus ${esc(rekap.monthLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; padding: 4px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 14px 0 5px; padding-bottom: 3px; border-bottom: 2px solid #111; }
  .meta { font-size: 10px; color: #555; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th, td { border: 1px solid #999; padding: 3px 4px; vertical-align: top; }
  th { background: #eee; font-size: 9.5px; text-align: left; }
  td.c, th.c { text-align: center; }
  td.r { text-align: right; white-space: nowrap; }
  td.b { font-weight: bold; }
  td.nw { white-space: nowrap; }
  td.mono { font-family: "Courier New", monospace; }
  td.chk { width: 26px; text-align: center; font-size: 13px; }
  .sub { font-size: 8.5px; color: #555; }
  tfoot td { background: #f3f3f3; font-weight: bold; }
  .cards { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .card { border: 1px solid #999; border-radius: 4px; padding: 5px 9px; min-width: 120px; }
  .card .l { font-size: 8.5px; color: #555; text-transform: uppercase; }
  .card .v { font-size: 13px; font-weight: bold; }
  .note { font-size: 9px; color: #555; margin: 4px 0 10px; }
  .sign { margin-top: 18px; display: flex; gap: 60px; }
  .sign div { text-align: center; font-size: 10px; }
  .sign .line { margin-top: 42px; border-top: 1px solid #111; width: 150px; }
  section { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
</style>
<h1>REKAP BONUS KARYAWAN — ACLEAN SERVICE AC</h1>
<div class="meta">Periode <strong>${esc(rekap.monthLabel)}</strong> · dicetak ${esc(rekap.generatedAt.toLocaleString("id-ID"))}</div>

<div class="cards">
  <div class="card"><div class="l">Job Selesai</div><div class="v">${s.totalJobSelesai}</div></div>
  <div class="card"><div class="l">Dapat Bonus</div><div class="v">${s.totalJobBonus}</div></div>
  <div class="card"><div class="l">Tanpa Bonus</div><div class="v">${s.excludedCount}</div></div>
  <div class="card"><div class="l">Nilai Transaksi</div><div class="v">${money(s.totalNilaiTrx)}</div></div>
  <div class="card"><div class="l">Freon</div><div class="v">${money(s.totalFreon)}</div></div>
  <div class="card"><div class="l">Kapasitor</div><div class="v">${money(s.totalKapasitor)}</div></div>
  <div class="card"><div class="l">Total Bonus</div><div class="v">${money(s.totalBonus)}</div></div>
</div>
<div class="note">Status komisi: Dalam Warranty (&lt;30 hari) → Siap Cair (≥30 hari) → Sudah Dibayar. Kolom ☐ paling kanan untuk centang manual saat verifikasi.</div>

<section>
<h2>A. TERMASUK BONUS (${rekap.included.length} job)</h2>
<table>
  <thead><tr>
    <th class="c">No</th><th>Tanggal</th><th>Job ID</th><th>Nama Job (Customer)</th><th>Layanan</th><th class="c">Unit</th>
    <th>Teknisi</th><th>Helper</th><th>Nilai Transaksi</th><th>Freon</th><th>Kapasitor</th><th>Bonus Lain</th>
    <th>Jumlah Bonus</th><th>Status</th><th>✓</th>
  </tr></thead>
  <tbody>${incRows || `<tr><td colspan="15" class="c">Tidak ada job berbonus di periode ini.</td></tr>`}</tbody>
  <tfoot><tr>
    <td colspan="8" class="r">TOTAL</td>
    <td class="r">${money(s.totalNilaiTrx)}</td><td class="r">${money(s.totalFreon)}</td>
    <td class="r">${money(s.totalKapasitor)}</td><td class="r">${money(s.totalLain)}</td>
    <td class="r">${money(s.totalBonus)}</td><td colspan="2"></td>
  </tr></tfoot>
</table>
</section>

<section>
<h2>B. TIDAK TERMASUK BONUS (${rekap.excluded.length} job)</h2>
<table>
  <thead><tr>
    <th class="c">No</th><th>Tanggal</th><th>Job ID</th><th>Nama Job (Customer)</th><th>Layanan</th><th class="c">Unit</th>
    <th>Teknisi</th><th>Helper</th><th>Nilai Transaksi</th><th>Kategori</th><th>Alasan</th><th>✓</th>
  </tr></thead>
  <tbody>${excRows || `<tr><td colspan="12" class="c">Semua job periode ini sudah dapat bonus.</td></tr>`}</tbody>
</table>
</section>

<section>
<h2>C. REKAP PER ORANG</h2>
<table>
  <thead><tr>
    <th class="c">No</th><th>Nama</th><th class="c">Jml Job</th><th>Total Bagian</th>
    <th>Sudah Dibayar</th><th>Siap Cair</th><th>Dalam Warranty</th><th>✓</th>
  </tr></thead>
  <tbody>${personRows || `<tr><td colspan="8" class="c">Belum ada pembagian bonus.</td></tr>`}</tbody>
</table>
</section>

<section>
<h2>D. REKAP PER KATEGORI</h2>
<table style="width:auto;min-width:340px">
  <thead><tr><th>Kategori</th><th class="c">Jml Entri</th><th>Total Bonus</th></tr></thead>
  <tbody>${catRows || `<tr><td colspan="3" class="c">-</td></tr>`}</tbody>
</table>
</section>

<div class="sign">
  <div>Diperiksa oleh,<div class="line"></div>Admin</div>
  <div>Disetujui oleh,<div class="line"></div>Owner</div>
</div>
${autoPrint ? `<script>window.onload = () => { window.print(); }<\/script>` : ""}`;
}

export function printBonusRekap(rekap) {
  const html = bonusRekapToPrintHTML(rekap);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=1100,height=800,scrollbars=yes");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rekap_Bonus_AClean_${rekap.month}.html`;
    a.click();
    return false; // popup diblok → jatuh ke unduh file HTML
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
