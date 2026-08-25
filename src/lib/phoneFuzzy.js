// phoneFuzzy — pencocokan nomor HP yang TOLERAN SATU DIGIT SALAH.
//
// Latar: bukti bayar Bapak Ricky (22 Agu 2026) tidak pernah nyambung ke
// INV-20260822-NW17V karena nomor customer di DB kehilangan satu digit:
//   WA asli : 628121047006  (0812-1047-006)
//   di DB   : 62812047006   (0812-047-006)   ← "1" hilang sejak CUST420 dibuat
// buildPhoneVariants() hanya menangani beda FORMAT (08/62/+62), bukan beda DIGIT,
// jadi pencarian exact-match tidak punya peluang menemukannya.
//
// PENTING — ini jaring pengaman TERAKHIR, bukan pengganti exact match.
// Dipakai hanya setelah pencocokan nomor persis gagal, dan HARUS dibarengi
// bukti kedua (nominal invoice sama persis) supaya tidak salah tempel ke
// invoice milik orang lain. Lihat findNearPhoneInvoice().
//
// CATATAN DUPLIKASI: fungsi isNearPhone di-mirror di api/_validate.js karena
// backend Vercel tidak meng-import lintas folder src/. Parity keduanya dijaga
// test src/lib/__tests__/phoneFuzzy.test.js — ubah satu, ubah dua-duanya.

// Panjang minimal supaya toleransi tidak dipakai pada nomor pendek/janggal:
// beda 1 digit pada nomor 8 digit terlalu mudah tabrakan.
const MIN_LEN = 10;

// true bila a dan b beda TEPAT satu digit — baik salah ketik (substitusi),
// digit hilang, maupun digit kelebihan (insert/delete).
// Nomor yang identik → false (itu urusan exact match, bukan fungsi ini).
export function isNearPhone(a, b) {
  const x = String(a || "").replace(/[^\d]/g, "");
  const y = String(b || "").replace(/[^\d]/g, "");
  if (!x || !y || x === y) return false;
  if (x.length < MIN_LEN || y.length < MIN_LEN) return false;
  // Hanya untuk nomor Indonesia — nomor internasional punya panjang beragam
  // sehingga toleransi 1 digit terlalu longgar.
  if (!x.startsWith("62") || !y.startsWith("62")) return false;

  const diff = x.length - y.length;
  if (Math.abs(diff) > 1) return false;

  if (diff === 0) {
    // Substitusi: tepat satu posisi berbeda.
    let salah = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i] && ++salah > 1) return false;
    }
    return salah === 1;
  }

  // Insert/delete: yang panjang harus jadi yang pendek dgn membuang 1 digit.
  const [panjang, pendek] = diff > 0 ? [x, y] : [y, x];
  let i = 0, j = 0, dibuang = 0;
  while (i < panjang.length && j < pendek.length) {
    if (panjang[i] === pendek[j]) { i++; j++; continue; }
    if (++dibuang > 1) return false;
    i++;
  }
  return true;
}

// Cari SATU invoice yang hampir pasti milik pengirim bukti bayar ini.
//
// Syarat berlapis (semua wajib) supaya aman dipakai otomatis:
//   1. nominal bukti > 0 dan SAMA PERSIS dengan total invoice
//   2. nomor invoice beda maksimal 1 digit dari nomor pengirim
//   3. hasilnya TEPAT SATU — kalau ada 2+ kandidat, menyerah (biar manual)
// Syarat ke-3 yang bikin ini tidak berani menebak: nominal Rp190.000 itu umum,
// tapi "Rp190.000 DAN nomornya mirip" praktis tidak mungkin kembar.
export function findNearPhoneInvoice(senderPhone, invoices, amount) {
  const nominal = Number(amount) || 0;
  if (!nominal || !senderPhone || !Array.isArray(invoices)) return null;

  const cocok = invoices.filter(inv =>
    Number(inv?.total) === nominal && isNearPhone(senderPhone, inv?.phone)
  );
  return cocok.length === 1 ? cocok[0] : null;
}

// Versi untuk arah sebaliknya: satu invoice, banyak kandidat bukti bayar
// (dipakai retro-match saat invoice baru di-approve).
export function findNearPhoneSuggestion(invoicePhone, suggestions, invoiceTotal) {
  const total = Number(invoiceTotal) || 0;
  if (!total || !invoicePhone || !Array.isArray(suggestions)) return null;

  const cocok = suggestions.filter(s =>
    Number(s?.amount) === total && isNearPhone(invoicePhone, s?.phone)
  );
  return cocok.length === 1 ? cocok[0] : null;
}
