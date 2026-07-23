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
