// tebakUnit — tebak tabung/roll mana yang dimaksud, supaya admin tidak perlu
// memilih manual untuk kasus yang sudah jelas.
//
// LATAR (25 Agu 2026)
// Draft dari foto/teks grup tidak pernah membawa unit_id — AI tidak bisa melihat
// "ini Roll 1PK-A4 atau Roll 1PK-B". Padahal stok dilacak PER unit fisik, jadi
// admin harus memilih satu per satu (~10 foto/hari). Dua aturan aman menutup
// sebagian besar kasus tanpa menebak-nebak.

const potong = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// → unit_id (string) atau null kalau tidak yakin.
// SENGAJA konservatif: lebih baik minta admin memilih daripada salah tabung,
// karena salah tabung = stok fisik dan catatan langsung berselisih.
export function tebakUnit(line, units, teks) {
  if (line?.unit_id) return line.unit_id;                 // sudah ditentukan, jangan diganggu
  const daftar = (Array.isArray(units) ? units : []).filter((u) => u && u.id);
  if (daftar.length === 0) return null;
  if (daftar.length === 1) return daftar[0].id;           // hanya satu kandidat → jelas

  // Lebih dari satu kandidat: cari kata yang HANYA dimiliki satu unit
  // ("Tabung R32 - K" vs "Tabung R32 - G" → pembedanya "k" dan "g"),
  // lalu lihat apakah kata itu disebut di laporan.
  const kata = new Set(potong([teks, line?.label].filter(Boolean).join(" ")));
  const jumlah = {};
  const perUnit = daftar.map((u) => {
    const t = new Set(potong(u.unit_label));
    t.forEach((x) => { jumlah[x] = (jumlah[x] || 0) + 1; });
    return { u, t };
  });
  const skor = perUnit.map(({ u, t }) => {
    let n = 0;
    t.forEach((x) => { if (jumlah[x] === 1 && kata.has(x)) n++; });
    return { u, n };
  });
  const tertinggi = Math.max(...skor.map((x) => x.n));
  if (tertinggi === 0) return null;                       // tidak ada petunjuk sama sekali
  const juara = skor.filter((x) => x.n === tertinggi);
  return juara.length === 1 ? juara[0].u.id : null;       // seri = ambigu, serahkan ke admin
}

// Terapkan tebakan ke semua baris tracked sekaligus.
// Mengembalikan baris baru + daftar mana yang terisi otomatis (untuk diberi tanda
// di UI, supaya admin tahu ini tebakan sistem dan bisa mengoreksinya).
export function isiUnitOtomatis(lines, unitsByType, teks) {
  const terisi = [];
  const hasil = (Array.isArray(lines) ? lines : []).map((l) => {
    if (!["pipa", "kabel", "freon"].includes(l?.material_type) || l?.unit_id) return l;
    const kandidat = (unitsByType || {})[l.material_type] || [];
    const id = tebakUnit(l, kandidat, teks);
    if (!id) return l;
    const u = kandidat.find((x) => x.id === id);
    terisi.push({ label: l.label, unit_label: u?.unit_label });
    return { ...l, unit_id: id, inventory_code: u?.inventory_code || l.inventory_code || null, _unitTebakan: true };
  });
  return { lines: hasil, terisi };
}
