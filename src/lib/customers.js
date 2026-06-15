import { samePhone } from "./phone.js";

// Unik berdasarkan phone + nama lengkap (case insensitive, trim)
// "Bapak Dedy Jelita" vs "Bapak Dedy Aruna" = BEDA meski phone sama.
export const sameCustomer = (c, phone, name) => {
  if (!c || !phone || !name) return false;
  return samePhone(c.phone, phone) &&
    c.name.trim().toLowerCase() === name.trim().toLowerCase();
};

// Cari customer paling tepat — prioritas (phone+name) > phone saja.
// CATATAN: 1 nomor HP bisa punya banyak customer (beda lokasi, beda nama belakang).
// Jangan gunakan phone-only match jika ada lebih dari 1 customer dengan HP sama.
export const findCustomer = (customers, phone, name) => {
  if (!phone && !name) return null;
  if (phone && name) {
    const exact = customers.find(c => sameCustomer(c, phone, name));
    if (exact) return exact;
    // Partial: hanya jika HP tersebut hanya punya 1 customer (tidak multi-lokasi)
    const byPhone = customers.filter(c => samePhone(c.phone, phone));
    if (byPhone.length === 1) {
      const firstName = name.trim().toLowerCase().split(" ").slice(0, 2).join(" ");
      if (byPhone[0].name.trim().toLowerCase().startsWith(firstName)) return byPhone[0];
    }
  }
  if (phone && !name) {
    const byPhone = customers.filter(c => samePhone(c.phone, phone));
    // Jika ada lebih dari 1 customer dengan HP sama, tidak bisa pilih otomatis — return null
    if (byPhone.length === 1) return byPhone[0];
    return null;
  }
  if (name && !phone) {
    return customers.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
  }
  return null;
};

// Ambil semua customer yang punya nomor HP yang sama (untuk customer multi-lokasi).
// Gunakan ini di UI untuk menampilkan pilihan jika ada lebih dari 1 hasil.
export const findCustomersByPhone = (customers, phone) => {
  if (!phone) return [];
  return customers.filter(c => samePhone(c.phone, phone));
};

// Build history per customer dari ordersData + laporanReports + invoicesData.
// Output: array job (terbaru dulu) dengan data gabungan order + invoice + laporan.
// allCustomers (opsional): jika diberikan & nomor HP ini dipakai >1 customer
// (multi-lokasi), history di-scope ketat by NAMA saja — jangan pakai phone-OR,
// karena phone yang sama akan menarik order lokasi lain & bikin riwayat tercampur.
export const buildCustomerHistory = (customer, ordersData, laporanReports, invoicesData, allCustomers = null) => {
  if (!customer) return [];
  const nm = (s) => (s || "").trim().toLowerCase();
  const matchName = (o) => nm(o.customer) === nm(customer.name);
  const matchPhone = (o) => customer.phone && o.phone && samePhone(o.phone, customer.phone);
  // LINK PERMANEN: order yang sudah punya customer_id = id customer ini SELALU ikut,
  // tak peduli phone / nama / alamat customer diedit kemudian. Inilah sumber kebenaran
  // utama — order yang sudah dibayar/diproses tidak akan lepas dari customernya.
  const matchId = (o) => o.customer_id && customer.id && o.customer_id === customer.id;

  // Deteksi multi-lokasi: 1 nomor HP punya >1 customer (beda nama).
  const isMultiLoc = !!(allCustomers && customer.phone &&
    allCustomers.filter(c => c && c.phone && samePhone(c.phone, customer.phone)).length > 1);

  return ordersData
    .filter(o => {
      if (matchId(o)) return true;          // tertaut permanen via customer_id
      if (o.customer_id) return false;      // sudah tertaut ke customer LAIN → jangan klaim by phone/nama
      // Legacy (order belum punya customer_id) → fallback by nama/phone seperti semula.
      return isMultiLoc ? matchName(o) : (matchName(o) || matchPhone(o));
    })
    .map(o => {
      const lap = laporanReports.find(r => r.job_id === o.id);
      const inv = invoicesData
        ? invoicesData.find(i => i.job_id === o.id || i.order_id === o.id)
        : null;
      const unitDetail = lap?.units || [];
      return {
        id: o.id,
        job_id: o.id,
        date: o.date,
        service: o.service,
        type: o.type || "",
        units: o.units || 1,
        teknisi: o.teknisi || "",
        helper: o.helper || "",
        status: o.status || "PENDING",
        notes: o.notes || "",
        area: o.area || "",
        invoice_id: inv?.id || o.invoice_id || null,
        invoice_total: inv?.total || 0,
        invoice_status: inv?.status || null,
        laporan_id: lap?.id || null,
        laporan_status: lap?.status || null,
        unit_detail: unitDetail,
        materials: lap?.materials || [],
        rekomendasi: lap?.rekomendasi || "",
        catatan: lap?.catatan_global || "",
        foto_urls: lap?.foto_urls
          || (lap?.fotos || []).filter(f => f.url).map(f => f.url)
          || (lap?.fotos || []).map(f => typeof f === "string" ? f : f.url).filter(Boolean)
          || [],
        total_freon: lap?.total_freon || 0,
      };
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
};
