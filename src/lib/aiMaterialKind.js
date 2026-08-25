// aiMaterialKind — tentukan ARAH laporan material dari foto WA:
// barang DIBAWA ke job, TERPAKAI di job, atau SISA yang kembali ke kantor.
//
// LATAR (25 Agu 2026)
// Skema AI cuma `items: [{type, brand, size, qty}]` — tidak ada field arah sama
// sekali, padahal prompt-nya sendiri menyebut material mencakup "dibawa, dipakai,
// sisa, atau dikembalikan". Akibatnya caption nyata seperti
//   "pipa A4 - 7 meter terpakai 5 meter tersisa 2 meter"  → {qty: 2, type: pipa}
// tidak bisa dibedakan dari "bawa pipa A4 2 meter". Dan tombol "Link ke Job"
// menulisnya sebagai BROUGHT — artinya 2 meter tercatat KELUAR, padahal 2 meter
// justru KEMBALI. Kebalikan dari kenyataan.
//
// Ke depan AI mengisi `kind` sendiri. Fungsi ini tetap dipakai sebagai cadangan
// untuk baris lama (766 baris tanpa `kind`) dan saat AI ragu.

const RE_SISA = /\b(sisa|tersisa|sisany|kembali|balik|retur|tidak\s*(ter)?pakai|blm\s*terpakai|belum\s*terpakai)\b/i;
const RE_PAKAI = /\b(terpakai|dipakai|dipake|kepake|habis|pemakaian)\b/i;

// Buang frasa "tidak terpakai" dulu — kalau tidak, kata "terpakai" di dalamnya
// membuat laporan sisa ikut terbaca sebagai pemakaian.
const tanpaNegasi = (t) => String(t || "").replace(/\btidak\s*(ter)?pakai\w*/gi, " ");

// → "dibawa" | "terpakai" | "sisa" | "campuran"
// "campuran" = caption menyebut pemakaian DAN sisa sekaligus; angka yang ditangkap
// AI ambigu, jadi wajib diputuskan manusia. Jangan ditebak.
export function detectKind(item, caption) {
  const eksplisit = String(item?.kind || "").toLowerCase();
  if (["dibawa", "terpakai", "sisa"].includes(eksplisit)) return eksplisit;

  const teks = String(caption || "");
  const adaSisa = RE_SISA.test(teks);
  const adaPakai = RE_PAKAI.test(tanpaNegasi(teks));
  if (adaSisa && adaPakai) return "campuran";
  if (adaSisa) return "sisa";
  if (adaPakai) return "terpakai";
  return "dibawa";
}

export const KIND_META = {
  dibawa:   { label: "Dibawa ke job",  warna: "#38bdf8" },
  terpakai: { label: "Terpakai",       warna: "#22c55e" },
  sisa:     { label: "Sisa / kembali", warna: "#a78bfa" },
  campuran: { label: "Pakai + sisa",   warna: "#eab308" },
};

// AI sering menaruh angka di `size` saat caption berantakan
// (nyata: "Kr32 kembali tidak terpakai 4.8kg" → {qty: 1, size: "4.8kg"}).
// Ambil angka dari size kalau qty terlihat seperti pengisi (1/null) sementara
// size justru memuat satuan berat/panjang.
export function qtyEfektif(item) {
  const qty = Number(item?.qty);
  const size = String(item?.size || "");
  const m = size.match(/(\d+[.,]?\d*)\s*(kg|gr|gram|m|meter)\b/i);
  if (m && (!Number.isFinite(qty) || qty <= 1)) {
    const angka = Number(m[1].replace(",", "."));
    if (Number.isFinite(angka) && angka > 0) return angka;
  }
  return Number.isFinite(qty) ? qty : null;
}

// Cocokkan satu baris AI ke baris sesi PAGI supaya tahu tabung/roll mana yang
// dimaksud. AI tidak pernah tahu unit_id — sumber kebenarannya sesi pagi teknisi.
// Aman hanya bila kandidatnya TEPAT SATU; lebih dari itu serahkan ke admin.
export function cocokkanKePagi(item, pagiItems) {
  const tipe = String(item?.type || "").toLowerCase();
  if (!tipe) return null;
  const kandidat = (Array.isArray(pagiItems) ? pagiItems : [])
    .filter((p) => String(p?.material_type || "").toLowerCase() === tipe);
  return kandidat.length === 1 ? kandidat[0] : null;
}

// ── Saringan: item mana yang boleh ditautkan ke job ─────────────────────────
// AI menandai apa pun yang terlihat di foto sebagai "material", termasuk ALAT
// (manifold, vakum, bor) dan barang habis pakai yang tidak dilacak per unit
// (duct tape, paralon). Kalau semuanya boleh di-link, rekap material job jadi
// tercampur alat dan angkanya tak berarti.
//
// Aturan Owner (25 Agu 2026): hanya PIPA AC, KABEL, FREON yang boleh ditautkan.
// Alat & barang lain tetap tersimpan sebagai catatan di antrean — tinggal
// ditandai "Sudah Tercatat", bukan dipaksa masuk rekap material job.
const RE_KECUALIKAN = /\b(paralon|vacum|vakum|vaccum|vacuum|manifold|duct\s*tape|ducttape|lakban|bor|gerinda|tangga|obeng|tang|kunci\s*inggris)\b/i;
const RE_MATERIAL_INTI = /\b(pipa\s*ac|pipa|kabel|freon|r-?22|r-?32|r-?410)\b/i;
const TIPE_INTI = ["pipa", "kabel", "freon"];

// Semua teks yang menempel pada satu baris AI — jenis, merek, ukuran.
const teksItem = (item) =>
  [item?.type, item?.brand, item?.size, item?.name, item?.label].filter(Boolean).join(" ");

export function bolehLinkKeJob(item, caption) {
  const teks = teksItem(item);
  // Kata terlarang menang duluan: "paralon" bisa saja ditandai AI sebagai pipa,
  // dan manifold/vakum kadang ikut tertulis di caption baris yang sama.
  if (RE_KECUALIKAN.test(teks)) return false;
  const tipe = String(item?.type || "").toLowerCase();
  if (TIPE_INTI.includes(tipe)) return true;
  // Tipe "lain" masih boleh lolos kalau namanya jelas menyebut material inti,
  // karena AI sering salah menaruh pipa/kabel ke "lain".
  if (RE_KECUALIKAN.test(String(caption || ""))) return false;
  return RE_MATERIAL_INTI.test(teks);
}

// Pisahkan baris yang boleh di-link dari yang hanya jadi catatan.
export function pisahkanItemLink(items, caption) {
  const boleh = [], tolak = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    (bolehLinkKeJob(it, caption) ? boleh : tolak).push(it);
  }
  return { boleh, tolak };
}

// Label pendek untuk pesan ke admin ("manifold", "pipa A4").
export const namaItem = (item) =>
  [item?.type, item?.brand, item?.size].filter(Boolean).join(" ").trim() || "item";
