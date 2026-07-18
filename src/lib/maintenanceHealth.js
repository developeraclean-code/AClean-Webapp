// Kesehatan unit AC maintenance — diturunkan MURNI dari riwayat maintenance_logs
// (+ jadwal unit). Tidak ada status tersimpan → tak ada dua sumber kebenaran.
// Dipakai MaintenanceView (badge per unit) & bisa dipakai portal/report nanti.
//
// Sumber data per log, urutan prioritas:
// 1. log.measurements (jsonb, migrasi 125 — autolog pasca-Sprint-1): terstruktur.
// 2. Fallback log lama: parse description ("... • Kondisi: A, B • Freon +100 •
//    Ampere 2.1 • catatan") + materials (baris freon = freon benar-benar ditambah).
// Fungsi murni semua — `today` bisa di-inject untuk test.

// SATU sumber label/warna/emoji status kesehatan — dipakai unitHealth, chip filter
// MaintenanceView, dan PDF (label). Jangan hardcode ulang di view/PDF (pernah drift:
// PDF sempat menulis "Belum Ada Data" sendiri).
export const HEALTH_META = {
  SEHAT:      { label: "Sehat",            emoji: "🟢", color: "#22c55e" },
  PERHATIAN:  { label: "Perlu Perhatian",  emoji: "🟡", color: "#f59e0b" },
  BERMASALAH: { label: "Bermasalah",       emoji: "🔴", color: "#ef4444" },
  NO_DATA:    { label: "Belum ada riwayat", emoji: "⚪", color: "#94a3b8" },
};

// KONDISI_SDH yang menandakan unit masih bermasalah SETELAH diservis.
export const RED_CONDITIONS = [
  "AC Masih Terkendala",
  "AC Rusak Perlu Pergantian Unit",
  "Kompresor Bermasalah",
];
export const WARN_CONDITIONS = [
  "Perlu Pergantian Sparepart",
  "Perlu Pergantian Parts",
  "Perlu Test Press",
  "Perlu Pengisian Freon",
  "Perlu Service Besar",
];

// Ambang heuristik (didokumentasikan di badge tooltip):
export const FREON_LEAK_WARN_COUNT = 2;  // ≥2 log tambah freon dlm 6 bln → indikasi bocor
export const FREON_LEAK_RED_COUNT = 3;   // ≥3 → hampir pasti bocor
export const FREON_LEAK_WINDOW_MONTHS = 6;
export const AMPERE_RISE_WARN_PCT = 15;  // ampere naik >15% dari pengukuran sebelumnya

// ── Normalisasi satu log → { kondisi_setelah[], ampere|null, psi|null, freon_added:boolean } ──
export function logMeasurements(log) {
  const out = { kondisi_setelah: [], ampere: null, psi: null, freon_added: false };
  if (!log) return out;

  const m = log.measurements;
  if (m && typeof m === "object") {
    if (Array.isArray(m.kondisi_setelah)) out.kondisi_setelah = m.kondisi_setelah;
    if (typeof m.ampere === "number" && m.ampere > 0) out.ampere = m.ampere;
    if (typeof m.freon_psi === "number" && m.freon_psi > 0) out.psi = m.freon_psi;
  } else {
    // Fallback log lama: parse description
    const desc = String(log.description || "");
    const kMatch = desc.match(/Kondisi:\s*([^•]+)/i);
    if (kMatch) out.kondisi_setelah = kMatch[1].split(",").map(s => s.trim()).filter(Boolean);
    const aMatch = desc.match(/Ampere\s+([\d.,]+)/i);
    if (aMatch) {
      const a = parseFloat(aMatch[1].replace(",", "."));
      if (!isNaN(a) && a > 0) out.ampere = a;
    }
    // "Freon +100" di description lama = TEKANAN psi (dari field freon_ditambah)
    const pMatch = desc.match(/Freon\s*\+\s*([\d.,]+)/i);
    if (pMatch) {
      const p = parseFloat(pMatch[1].replace(",", "."));
      if (!isNaN(p) && p > 0) out.psi = p;
    }
  }

  // Freon benar-benar DITAMBAH = ada baris material freon (qty > 0), KECUALI baris
  // tekanan: autolog (api/_handlers/portal.js) menulis pembacaan psi sebagai baris
  // materials {nama:"Tekanan Freon …", satuan:"psi"} — itu PENGUKURAN, bukan
  // penambahan. Tanpa pengecualian ini, tiap catatan tekanan terhitung "tambah
  // freon" → unit sehat ke-flag bocor (temuan review 18 Jul 2026).
  const mats = Array.isArray(log.materials) ? log.materials : [];
  out.freon_added = mats.some(mt => {
    const nama = String(mt?.nama || "").toLowerCase();
    const satuan = String(mt?.satuan || "").toLowerCase();
    if (nama.includes("tekanan") || satuan === "psi") return false;
    const qty = parseFloat(String(mt?.qty ?? mt?.jumlah ?? "").replace(",", "."));
    return nama.includes("freon") && !isNaN(qty) && qty > 0;
  });
  return out;
}

function monthsAgoDate(months, today) {
  const d = new Date(today);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ── Kesehatan satu unit dari riwayat log-nya ──
// unit: baris maintenance_units (butuh next_service_date bila ada)
// logs: SEMUA log klien (difilter unit_id di sini) ATAU sudah terfilter — dua-duanya aman.
export function unitHealth(unit, logs, today = new Date().toISOString().slice(0, 10)) {
  const mine = (Array.isArray(logs) ? logs : [])
    .filter(l => l && l.unit_id === unit?.id)
    .sort((a, b) => String(b.service_date || "").localeCompare(String(a.service_date || "")));

  if (!mine.length) {
    return { key: "NO_DATA", ...HEALTH_META.NO_DATA, reasons: ["Belum pernah tercatat servis"] };
  }

  // Parse SEKALI per log (regex description + scan materials tidak murah;
  // dipakai 3 sinyal di bawah — jangan panggil logMeasurements berulang).
  const ms = mine.map(l => ({ date: l.service_date, m: logMeasurements(l) }));

  const reasons = [];
  let level = 0; // 0 sehat, 1 perhatian, 2 bermasalah

  // 1. Kondisi terakhir pasca-servis
  const latest = ms[0].m;
  const redHit = latest.kondisi_setelah.filter(k => RED_CONDITIONS.includes(k));
  const warnHit = latest.kondisi_setelah.filter(k => WARN_CONDITIONS.includes(k));
  if (redHit.length) { level = 2; reasons.push("Kondisi terakhir: " + redHit.join(", ")); }
  else if (warnHit.length) { level = Math.max(level, 1); reasons.push("Kondisi terakhir: " + warnHit.join(", ")); }

  // 2. Indikasi bocor: berapa log DALAM 6 bulan terakhir yang menambah freon
  const cutoff = monthsAgoDate(FREON_LEAK_WINDOW_MONTHS, today);
  const freonAdds = ms.filter(x => String(x.date || "") >= cutoff && x.m.freon_added).length;
  if (freonAdds >= FREON_LEAK_RED_COUNT) { level = 2; reasons.push(`Tambah freon ${freonAdds}× dlm ${FREON_LEAK_WINDOW_MONTHS} bln — hampir pasti bocor`); }
  else if (freonAdds >= FREON_LEAK_WARN_COUNT) { level = Math.max(level, 1); reasons.push(`Tambah freon ${freonAdds}× dlm ${FREON_LEAK_WINDOW_MONTHS} bln — indikasi bocor`); }

  // 3. Tren ampere: bandingkan 2 pengukuran terakhir yang ada angkanya
  const amps = ms.filter(x => x.m.ampere != null);
  if (amps.length >= 2) {
    const [now_, prev] = amps;
    const risePct = ((now_.m.ampere - prev.m.ampere) / prev.m.ampere) * 100;
    if (risePct > AMPERE_RISE_WARN_PCT) {
      level = Math.max(level, 1);
      reasons.push(`Ampere naik ${prev.m.ampere}A → ${now_.m.ampere}A (+${Math.round(risePct)}%)`);
    }
  }

  // 4. Jadwal terlewat
  if (unit?.next_service_date && unit.next_service_date < today) {
    level = Math.max(level, 1);
    reasons.push("Jadwal servis terlewat (" + unit.next_service_date + ")");
  }

  if (level === 2) return { key: "BERMASALAH", ...HEALTH_META.BERMASALAH, reasons };
  if (level === 1) return { key: "PERHATIAN", ...HEALTH_META.PERHATIAN, reasons };
  return { key: "SEHAT", ...HEALTH_META.SEHAT, reasons: ["Kondisi terakhir baik"] };
}

// Ringkasan per klien untuk header tab Unit: { SEHAT: n, PERHATIAN: n, ... }
export function healthSummary(units, logs, today) {
  const sum = { SEHAT: 0, PERHATIAN: 0, BERMASALAH: 0, NO_DATA: 0 };
  (units || []).forEach(u => { sum[unitHealth(u, logs, today).key]++; });
  return sum;
}

// ── Deret pengukuran satu unit (utk grafik tren & PDF) ──
// Return ASC by date: [{ date, ampere|null, psi|null, freon_added }]
// Hanya titik yang punya minimal satu nilai/penanda (log tanpa pengukuran di-skip).
export function unitMeasurementSeries(unit, logs) {
  return (Array.isArray(logs) ? logs : [])
    .filter(l => l && l.unit_id === unit?.id && l.service_date)
    .map(l => {
      const m = logMeasurements(l);
      return { date: l.service_date, ampere: m.ampere, psi: m.psi, freon_added: m.freon_added };
    })
    .filter(p => p.ampere != null || p.psi != null || p.freon_added)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// ═══════════ Analisis "unit boros" — kandidat ganti unit / test press ═══════════
// Skor transparan berbasis sinyal yang ADA di data (verifikasi prod 18 Jul 2026:
// year_installed cuma terisi 1/347 unit, cost 29/342 log → keduanya BONUS, bukan
// tumpuan). Tumpuan utama: frekuensi perbaikan, indikasi bocor freon, follow-up
// terbuka, kesehatan terkini. Ambang & bobot didokumentasikan agar bisa diaudit.
export const BOROS_LEVEL_GANTI = 60;   // skor ≥60 → rekomendasi ganti / test press
export const BOROS_LEVEL_PANTAU = 35;  // 35–59 → pantau ketat

export function unitBorosSignals(unit, logs, followups = [], today = new Date().toISOString().slice(0, 10)) {
  const reasons = [];
  let score = 0;

  // Slice log milik unit ini dihitung SEKALI, lalu dipakai unitHealth + sinyal lain
  // (unitHealth re-filter by unit_id — slice yang sudah terfilter tetap lolos).
  const mine = (Array.isArray(logs) ? logs : []).filter(l => l && l.unit_id === unit?.id);

  // 1. Kesehatan terkini (reuse heuristik unitHealth).
  // BERMASALAH = +40 (di atas ambang PANTAU) — unit merah TIDAK BOLEH luput dari daftar.
  const health = unitHealth(unit, mine, today);
  if (health.key === "BERMASALAH") { score += 40; reasons.push(...health.reasons); }
  else if (health.key === "PERHATIAN") { score += 15; reasons.push(...health.reasons); }

  // 2. Frekuensi perbaikan 12 bulan terakhir
  const cutoff12 = monthsAgoDate(12, today);
  const repairs = mine.filter(l => String(l.service_date || "") >= cutoff12 && l.service_category === "perbaikan").length;
  if (repairs > 0) {
    score += Math.min(repairs * 12, 36);
    reasons.push(`${repairs}× perbaikan dlm 12 bln`);
  }

  // 3. Biaya tercatat 12 bulan (bonus — kolom cost jarang terisi)
  const cost12 = mine.filter(l => String(l.service_date || "") >= cutoff12)
    .reduce((s, l) => s + (Number(l.cost) > 0 ? Number(l.cost) : 0), 0);
  if (cost12 >= 1000000) { score += 20; reasons.push(`Biaya servis 12 bln: Rp ${cost12.toLocaleString("id-ID")}`); }
  else if (cost12 >= 500000) { score += 10; reasons.push(`Biaya servis 12 bln: Rp ${cost12.toLocaleString("id-ID")}`); }

  // 4. Follow-up masih terbuka
  const openFu = (Array.isArray(followups) ? followups : [])
    .filter(f => f && f.unit_id === unit?.id && ["open", "scheduled", "in_progress"].includes(f.status));
  if (openFu.length) {
    score += Math.min(openFu.reduce((s, f) => s + (f.priority === "high" ? 12 : 6), 0), 24);
    reasons.push(`${openFu.length} temuan belum tuntas`);
  }

  // 5. Umur unit (bonus — year_installed jarang terisi)
  const year = Number(unit?.year_installed);
  const nowYear = Number(String(today).slice(0, 4));
  if (year > 1990 && nowYear - year >= 8) { score += 20; reasons.push(`Umur ±${nowYear - year} tahun`); }
  else if (year > 1990 && nowYear - year >= 5) { score += 10; reasons.push(`Umur ±${nowYear - year} tahun`); }

  const level = score >= BOROS_LEVEL_GANTI ? "GANTI" : score >= BOROS_LEVEL_PANTAU ? "PANTAU" : null;
  return { score, level, reasons, health };
}

// Ranking kandidat per klien — hanya unit dengan level (GANTI/PANTAU), skor tertinggi dulu.
// Log & followup di-index per unit dalam SATU pass (bukan re-scan seluruh array per unit
// — 347 unit × 342 log × 2 scan itu ratusan ribu operasi sinkron di render path).
export function borosRanking(units, logs, followups = [], today) {
  const logsByUnit = new Map();
  (Array.isArray(logs) ? logs : []).forEach(l => {
    if (!l || !l.unit_id) return;
    const arr = logsByUnit.get(l.unit_id) || [];
    arr.push(l); logsByUnit.set(l.unit_id, arr);
  });
  const fuByUnit = new Map();
  (Array.isArray(followups) ? followups : []).forEach(f => {
    if (!f || !f.unit_id) return;
    const arr = fuByUnit.get(f.unit_id) || [];
    arr.push(f); fuByUnit.set(f.unit_id, arr);
  });
  return (units || [])
    .map(u => ({ unit: u, ...unitBorosSignals(u, logsByUnit.get(u.id) || [], fuByUnit.get(u.id) || [], today) }))
    .filter(r => r.level)
    .sort((a, b) => b.score - a.score);
}
