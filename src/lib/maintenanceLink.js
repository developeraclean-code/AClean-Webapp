// Penautan order ↔ klien maintenance (kontrak B2B).
//
// SUMBER KEBENARAN: relasi customers ↔ maintenance_clients lewat kolom
// maintenance_clients.customer_id. Tidak ada kolom "tipe customer" tersimpan —
// customer DIANGGAP maintenance bila ada baris maintenance_clients yang menunjuk
// padanya. Jadi status tak mungkin berbohong saat kontrak ditambah/dihapus.
//
// KUNCI WAJIB customer_id, JANGAN nomor HP / nama. Bukti dari data prod (20 Jul 2026):
// - 1 nomor HP bisa menunjuk BANYAK site: 6287775196231 → 3 klien Jaya Kreasi
//   (Spectra / Jalan Panjang / Alam Sutera). Salah site = salah kontrak, salah
//   daftar unit, salah tarif.
// - 1 nomor HP bisa dipakai bersama customer PERORANGAN: 6281287619907 dipakai
//   "BAPAK TONNY M TOWN" (reguler) DAN "PT UICCP" (kontrak). Auto-link by HP akan
//   salah menandai job pribadi Pak Tonny sebagai pekerjaan kontrak.
// - Nama juga tidak bisa: "PT. Jaya Kreasi Indonesia Spectra" (klien) vs
//   "PT JAYA KREASI SPECTRA" (customer) — beda huruf besar & tanda baca.
// Tiap site B2B sudah punya baris customers sendiri (pola multi-lokasi
// UNIQUE(phone,name)), jadi relasinya memang 1:1 lewat customer_id.
//
// Fungsi murni semua — tanpa efek samping, tanpa akses DB.

/**
 * Cari klien maintenance milik satu customer.
 * @param {string|null} customerId  orders.customer_id / customers.id (mis. "CUST855")
 * @param {Array} maintClients      daftar maintenance_clients ({id, name, customer_id})
 * @returns {{id:string, name:string}|null} null = customer reguler / tak diketahui
 */
export function resolveMaintenanceClient(customerId, maintClients) {
  const cid = String(customerId || "").trim();
  if (!cid) return null; // order tanpa customer_id → jangan menebak
  const hit = (Array.isArray(maintClients) ? maintClients : []).find(
    mc => mc && String(mc.customer_id || "").trim() === cid
  );
  return hit ? { id: hit.id, name: hit.name || "" } : null;
}

/**
 * Apakah customer ini klien kontrak? (untuk badge turunan di menu Customer)
 */
export function isMaintenanceCustomer(customerId, maintClients) {
  return resolveMaintenanceClient(customerId, maintClients) !== null;
}

/**
 * Lengkapi payload order dengan maintenance_client_id bila customer-nya klien kontrak.
 * TIDAK menimpa nilai yang sudah ada — pilihan eksplisit (mis. order dibuat dari panel
 * Maintenance, atau admin memilih klien manual di form) selalu menang.
 *
 * @returns {{payload:Object, linked:{id:string,name:string}|null}}
 *          linked != null → caller sebaiknya memberi tahu user bahwa order ditautkan.
 */
export function withMaintenanceLink(payload, maintClients) {
  const p = payload || {};
  if (p.maintenance_client_id) return { payload: p, linked: null }; // hormati pilihan eksplisit
  const hit = resolveMaintenanceClient(p.customer_id, maintClients);
  if (!hit) return { payload: p, linked: null };
  return { payload: { ...p, maintenance_client_id: hit.id }, linked: hit };
}

// ── Deteksi klien kontrak via HP + alamat (untuk PROMPT pilih-unit, bukan link diam²) ──
// Dipakai saat admin membuat order dari Planning Order: kalau customer-nya klien
// maintenance, munculkan popup pilih unit supaya repair/complain nyangkut ke unit
// spesifik (riwayat & frekuensi unit akurat).
//
// Kenapa boleh pakai HP di sini padahal file ini melarang match-HP untuk auto-link?
// (1) Hasilnya cuma MEMICU popup konfirmasi — admin selalu bisa "Lewati", tak ada
//     mutasi diam-diam seperti withMaintenanceLink. (2) Kunci utama tetap ANDAL:
//     HP + ALAMAT. Pitfall "1 HP → banyak site" (3 klien Jaya Kreasi) justru
//     dipecahkan oleh alamat. Pitfall "HP dipakai personal + kontrak" (Pak Tonny +
//     UICCP) dijaga: kalau order beralamat & alamatnya jelas beda dari kandidat,
//     kami tekan (return null).

const _digits = (s) => String(s || "").replace(/\D/g, "");
// Samakan format HP ke 62xxxxxxxxx (tanpa import lintas-lib agar helper tetap murni).
function _normPhone(s) {
  let d = _digits(s);
  if (!d) return "";
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  else if (d.startsWith("620")) d = "62" + d.slice(3);
  return d;
}
function _normAddr(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
// Skor kemiripan alamat 0..1: token Jaccard + bonus containment. Murni, tanpa deps.
function _addrScore(a, b) {
  const na = _normAddr(a), nb = _normAddr(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const A = new Set(na.split(" ").filter(w => w.length > 2));
  const B = new Set(nb.split(" ").filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter); // Jaccard
}

// Kumpulkan HP+alamat kandidat sebuah klien: dari baris klien (pic_phone/address)
// DAN dari customer tertaut (customer_id → customers). Dua-duanya dipertimbangkan.
function _clientContacts(mc, customersById) {
  const cust = mc.customer_id ? customersById.get(String(mc.customer_id)) : null;
  const phones = [mc.pic_phone, cust?.phone].map(_normPhone).filter(Boolean);
  const addrs = [mc.address, cust?.address].filter(Boolean);
  return { phones, addrs };
}

/**
 * Cari klien maintenance yang HP-nya sama & (bila perlu) alamatnya cocok.
 * @param {string} phone     order.phone
 * @param {string} address   order.address
 * @param {Array}  maintClients  [{id,name,customer_id,pic_phone,address}]
 * @param {Array}  customers     customersData [{id,phone,address}]
 * @param {number} addrThreshold ambang skor alamat saat HP dipakai >1 site (default .34)
 * @returns {{id,name,via:'phone-unique'|'phone+address'}|null}
 */
export function findMaintClientByPhoneAddr(phone, address, maintClients, customers, addrThreshold = 0.34) {
  const ph = _normPhone(phone);
  if (!ph) return null; // tanpa HP → jangan menebak
  const customersById = new Map((Array.isArray(customers) ? customers : []).map(c => [String(c.id), c]));

  // Kandidat = klien yang salah satu HP-nya == HP order.
  const cands = (Array.isArray(maintClients) ? maintClients : [])
    .map(mc => ({ mc, ...(_clientContacts(mc, customersById)) }))
    .filter(x => x.phones.includes(ph));
  if (!cands.length) return null;

  const orderAddr = _normAddr(address);

  if (cands.length === 1) {
    // HP unik ke 1 klien → aman. Kecuali order beralamat & jelas beda (guard personal+kontrak).
    const only = cands[0];
    if (orderAddr && only.addrs.length) {
      const best = Math.max(...only.addrs.map(a => _addrScore(address, a)));
      if (best < 0.15) return null; // alamat jelas beda → mungkin job personal, jangan picu
    }
    return { id: only.mc.id, name: only.mc.name || "", via: "phone-unique" };
  }

  // HP dipakai banyak site → ALAMAT jadi penentu. Wajib ada alamat order.
  if (!orderAddr) return null;
  let best = null, bestScore = 0;
  for (const c of cands) {
    const score = c.addrs.length ? Math.max(...c.addrs.map(a => _addrScore(address, a))) : 0;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= addrThreshold ? { id: best.mc.id, name: best.mc.name || "", via: "phone+address" } : null;
}
