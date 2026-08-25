// materialSplit — pembagian qty material terpakai ke beberapa job.
//
// LATAR (audit 25 Agu 2026)
// Sesi 'pulang' memotong stok dengan order_id = job_ids[0] saja. Akibatnya:
//   - 16 dari 38 sesi terkonfirmasi (42%) memotong stok TANPA job sama sekali
//   - sisanya menempel ke satu job, padahal teknisi rata-rata 2,33 job/hari (maks 6)
// Jadi pertanyaan "material terpakai di mana saja" memang belum bisa dijawab datanya.
//
// Di sini qty terpakai dibagi eksplisit per job saat Admin konfirmasi, lalu ditulis
// satu transaksi stok per job. Logika murni supaya bisa diuji tanpa DB.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Toleransi pembulatan: input 0.1 desimal bisa menyisakan 0.0000001.
const EPS = 0.005;

// Pembagian awal yang masuk akal, supaya admin tidak mengetik untuk kasus lazim:
//   - tepat 1 job  → semua qty ke job itu
//   - >1 job       → kosong, admin yang membagi (tebakan di jalur stok terlalu mahal)
//   - tanpa job    → kosong
export function defaultSplit(used, jobs) {
  const qty = round2(used);
  const list = Array.isArray(jobs) ? jobs : [];
  if (!(qty > 0) || list.length !== 1) return {};
  return { [list[0].id]: qty };
}

export function splitTotal(split) {
  return round2(Object.values(split || {}).reduce((s, v) => s + (Number(v) || 0), 0));
}

// Sisa yang belum dibagi (bisa negatif kalau admin kelebihan membagi).
export function splitRemainder(used, split) {
  return round2(round2(used) - splitTotal(split));
}

// Boleh dikonfirmasi bila seluruh qty terpakai sudah habis dibagi.
// Baris dengan used = 0 otomatis sah (tidak ada yang perlu dibagi).
export function isSplitComplete(used, split) {
  const qty = round2(used);
  if (!(qty > 0)) return true;
  return Math.abs(splitRemainder(qty, split)) <= EPS;
}

// Ubah pembagian jadi daftar alokasi siap tulis ke inventory_transactions.
// Nilai 0 / kosong dibuang supaya tidak lahir transaksi nol.
export function splitToAllocations(split, jobs) {
  const peta = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  return Object.entries(split || {})
    .map(([job_id, qty]) => ({
      job_id,
      qty: round2(qty),
      customer: peta[job_id]?.customer || null,
      job_date: peta[job_id]?.date || null,
    }))
    .filter((a) => a.qty > 0);
}

// Ringkasan seluruh kartu: berapa baris yang pembagiannya belum beres.
// Dipakai untuk mengunci tombol Confirm + memberi pesan yang jelas.
export function belumTerbagi(lines, splitMap) {
  return (lines || [])
    .filter((l) => round2(l.used) > 0)
    .filter((l) => !isSplitComplete(l.used, (splitMap || {})[l.key] || {}))
    .map((l) => ({ key: l.key, label: l.label, sisa: splitRemainder(l.used, (splitMap || {})[l.key] || {}) }));
}
