// Kesehatan unit AC maintenance — diturunkan MURNI dari riwayat maintenance_logs
// (+ jadwal unit). Tidak ada status tersimpan → tak ada dua sumber kebenaran.
// Dipakai MaintenanceView (badge per unit) & bisa dipakai portal/report nanti.
//
// Sumber data per log, urutan prioritas:
// 1. log.measurements (jsonb, migrasi 125 — autolog pasca-Sprint-1): terstruktur.
// 2. Fallback log lama: parse description ("... • Kondisi: A, B • Freon +100 •
//    Ampere 2.1 • catatan") + materials (baris freon = freon benar-benar ditambah).
// Fungsi murni semua — `today` bisa di-inject untuk test.

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

// ── Normalisasi satu log → { kondisi_setelah[], ampere|null, freon_added:boolean } ──
export function logMeasurements(log) {
  const out = { kondisi_setelah: [], ampere: null, freon_added: false };
  if (!log) return out;

  const m = log.measurements;
  if (m && typeof m === "object") {
    if (Array.isArray(m.kondisi_setelah)) out.kondisi_setelah = m.kondisi_setelah;
    if (typeof m.ampere === "number" && m.ampere > 0) out.ampere = m.ampere;
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
  }

  // Freon benar-benar DITAMBAH = ada baris material freon (qty > 0).
  // (measurements.freon_psi = tekanan, BUKAN penambahan — jangan dipakai utk indikasi bocor.)
  const mats = Array.isArray(log.materials) ? log.materials : [];
  out.freon_added = mats.some(mt => {
    const nama = String(mt?.nama || "").toLowerCase();
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
    return { key: "NO_DATA", label: "Belum ada riwayat", emoji: "⚪", color: "#94a3b8", reasons: ["Belum pernah tercatat servis"] };
  }

  const reasons = [];
  let level = 0; // 0 sehat, 1 perhatian, 2 bermasalah

  // 1. Kondisi terakhir pasca-servis
  const latest = logMeasurements(mine[0]);
  const redHit = latest.kondisi_setelah.filter(k => RED_CONDITIONS.includes(k));
  const warnHit = latest.kondisi_setelah.filter(k => WARN_CONDITIONS.includes(k));
  if (redHit.length) { level = 2; reasons.push("Kondisi terakhir: " + redHit.join(", ")); }
  else if (warnHit.length) { level = Math.max(level, 1); reasons.push("Kondisi terakhir: " + warnHit.join(", ")); }

  // 2. Indikasi bocor: berapa log DALAM 6 bulan terakhir yang menambah freon
  const cutoff = monthsAgoDate(FREON_LEAK_WINDOW_MONTHS, today);
  const freonAdds = mine.filter(l => String(l.service_date || "") >= cutoff && logMeasurements(l).freon_added).length;
  if (freonAdds >= FREON_LEAK_RED_COUNT) { level = 2; reasons.push(`Tambah freon ${freonAdds}× dlm ${FREON_LEAK_WINDOW_MONTHS} bln — hampir pasti bocor`); }
  else if (freonAdds >= FREON_LEAK_WARN_COUNT) { level = Math.max(level, 1); reasons.push(`Tambah freon ${freonAdds}× dlm ${FREON_LEAK_WINDOW_MONTHS} bln — indikasi bocor`); }

  // 3. Tren ampere: bandingkan 2 pengukuran terakhir yang ada angkanya
  const amps = mine.map(l => ({ date: l.service_date, a: logMeasurements(l).ampere })).filter(x => x.a != null);
  if (amps.length >= 2) {
    const [now_, prev] = amps;
    const risePct = ((now_.a - prev.a) / prev.a) * 100;
    if (risePct > AMPERE_RISE_WARN_PCT) {
      level = Math.max(level, 1);
      reasons.push(`Ampere naik ${prev.a}A → ${now_.a}A (+${Math.round(risePct)}%)`);
    }
  }

  // 4. Jadwal terlewat
  if (unit?.next_service_date && unit.next_service_date < today) {
    level = Math.max(level, 1);
    reasons.push("Jadwal servis terlewat (" + unit.next_service_date + ")");
  }

  if (level === 2) return { key: "BERMASALAH", label: "Bermasalah", emoji: "🔴", color: "#ef4444", reasons };
  if (level === 1) return { key: "PERHATIAN", label: "Perlu Perhatian", emoji: "🟡", color: "#f59e0b", reasons };
  return { key: "SEHAT", label: "Sehat", emoji: "🟢", color: "#22c55e", reasons: ["Kondisi terakhir baik"] };
}

// Ringkasan per klien untuk header tab Unit: { SEHAT: n, PERHATIAN: n, ... }
export function healthSummary(units, logs, today) {
  const sum = { SEHAT: 0, PERHATIAN: 0, BERMASALAH: 0, NO_DATA: 0 };
  (units || []).forEach(u => { sum[unitHealth(u, logs, today).key]++; });
  return sum;
}
