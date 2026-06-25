// Pure builder bizContext untuk ARA chat — diekstrak dari sendToARA di App.jsx (behavior-preserving).
// Hanya SHAPING data (read-only) jadi objek konteks yang dikirim ke /api/ara-chat. TANPA efek samping.
// Helper component-local (cariSlotKosong, araSchedulingSuggest) & PRICE_LIST dioper sebagai argumen.
import { samePhone } from "./phone.js";

/**
 * Bangun objek bizContext (data bisnis live) untuk dikirim ke ARA.
 * @param {object} p — semua data array + helper + konstanta yang dibaca konteks.
 * @returns {object} bizContext
 */
export function buildAraContext({
  today,
  bulanIni,
  ordersData = [],
  invoicesData = [],
  inventoryData = [],
  customersData = [],
  laporanReports = [],
  teknisiData = [],
  waConversations = [],
  paymentSuggestions = [],
  priceListData = [],
  PRICE_LIST = {},
  cariSlotKosong,
  araSchedulingSuggest,
}) {
  return {
    today,
    orders: ordersData.map(o => ({ id: o.id, customer: o.customer, service: o.service, type: o.type, units: o.units, status: o.status, date: o.date, time: o.time, teknisi: o.teknisi, helper: o.helper, dispatch: o.dispatch, invoice_id: o.invoice_id })),
    invoices: invoicesData.map(i => ({ id: i.id, customer: i.customer, phone: i.phone, total: i.total, status: i.status, due: i.due, labor: i.labor, material: i.material, discount: i.discount, trade_in: i.trade_in, trade_in_amount: i.trade_in_amount, materials_detail: (Array.isArray(i.materials_detail) ? i.materials_detail : (typeof i.materials_detail === "string" ? (() => { try { return JSON.parse(i.materials_detail); } catch { return []; } })() : [])).map(m => ({ nama: m.nama, jumlah: m.jumlah, satuan: m.satuan, harga_satuan: m.harga_satuan, subtotal: m.subtotal })) })),
    inventory: inventoryData.map(i => ({ code: i.code, name: i.name, stock: i.stock, unit: i.unit, status: i.status, price: i.price, reorder: i.reorder })),
    customers: customersData.map(c => ({ id: c.id, name: c.name, phone: c.phone, area: c.area, total_orders: c.total_orders, is_vip: c.is_vip })),
    laporan: laporanReports.map(r => ({
      id: r.id, job_id: r.job_id, teknisi: r.teknisi, customer: r.customer,
      service: r.service, status: r.status, date: r.date, submitted: r.submitted,
      is_install: r.service === "Install",
      pekerjaan_aktual: (r.units || []).flatMap(u => u.pekerjaan || []),
      has_service_besar: (r.units || []).some(u => (u.pekerjaan || []).some(p => p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep"))),
      service_besar_type: (r.units || []).some(u => (u.pekerjaan || []).some(p => p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep"))) ? (r.total_units > 1 ? "Jasa Service Besar 1,5PK - 2,5PK" : "Jasa Service Besar 0,5PK - 1PK") : null,
      materials: (r.materials || []).map(m => ({ nama: m.nama, jumlah: m.jumlah, satuan: m.satuan })),
      total_units: r.total_units || 0,
    })),
    laporanPending: laporanReports.filter(r => r.status === "SUBMITTED").length,
    laporanRevisi: laporanReports.filter(r => r.status === "REVISION").length,
    teknisiWorkload: teknisiData.filter(t => t.role === "Teknisi" || t.role === "teknisi").map(t => ({
      name: t.name, role: t.role, status: t.status,
      phone: t.phone || "",
      skills: Array.isArray(t.skills) ? t.skills : [],
      area: t.area || "",
      jobsToday: ordersData.filter(o => o.teknisi === t.name && o.date === today).length,
      jobsPending: ordersData.filter(o => o.teknisi === t.name && ["CONFIRMED", "IN_PROGRESS"].includes(o.status)).length,
      slotKosongHariIni: cariSlotKosong ? cariSlotKosong(t.name, today, "Cleaning", 1) : null,
      jadwalHariIni: ordersData.filter(o => o.teknisi === t.name && o.date === today).map(o => ({ id: o.id, time: o.time, time_end: o.time_end || "?", service: o.service, units: o.units, customer: o.customer })),
    })),
    helperList: teknisiData.filter(t => t.role === "Helper" || t.role === "helper").map(t => ({
      name: t.name, role: t.role, status: t.status,
      phone: t.phone || "",
      skills: Array.isArray(t.skills) ? t.skills : [],
      jobsToday: ordersData.filter(o => o.helper === t.name && o.date === today).length,
    })),
    areaPelayanan: {
      utama: ["Alam Sutera", "BSD", "Gading Serpong", "Graha Raya", "Karawaci", "Tangerang", "Tangerang Selatan", "Serpong"],
      konfirmasi: ["Jakarta Barat"],
    },
    // ── Rekomendasi slot dari araSchedulingSuggest (sudah dihitung, ARA tinggal baca) ──
    slotRekomendasi: (() => {
      try {
        const { pref, sorted } = araSchedulingSuggest(today, "Cleaning", 1);
        return {
          teknisiDisarankan: sorted ? sorted.slice(0, 3).map(t => ({
            nama: t.name,
            jobsHariIni: ordersData.filter(o => o.teknisi === t.name && o.date === today).length,
            helperFavorit: pref[t.name] || null,
            slotTersedia: true
          })) : [],
          pasanganFavorit: pref,
        };
      } catch (_) { return { teknisiDisarankan: [], pasanganFavorit: {} }; }
    })(),
    logikaDurasi: "Cleaning: 1u=1j,2u=2j,3u=3j,4u=3j,5-6u=4j,7-8u=5j,9-10u=6j,>10=sehari | Install: 1-3u=1hari,4+u=2hari | Repair: 60-120mnt/unit | Complain: 1u=30mnt,setiap tambahan unit +15mnt",
    jamKerja: "09:00-17:00 WIB",
    recentWa: waConversations.slice(0, 20).map(c => {
      const cust = customersData.find(x => samePhone(x.phone, c.phone));
      return { phone: c.phone, name: c.name, lastMessage: c.last_message || c.last || "", updatedAt: c.updated_at, unread: c.unread || 0, intent: c.intent || "", customerName: cust?.name || null, totalOrders: cust?.total_orders || 0, isKnownCustomer: !!cust };
    }),
    pendingPayments: paymentSuggestions.map(p => ({
      phone: p.phone, senderName: p.sender_name, amount: p.amount || null,
      bank: p.bank || null, invoiceId: p.invoice_id || null, orderId: p.order_id || null,
      status: p.status, source: p.source, createdAt: p.created_at,
      hasProof: !!(p.image_url || p.source === "image"),
    })),
    revenueStats: {
      bulanIni: invoicesData.filter(i => i.status === "PAID" && String(i.sent || i.created_at || "").startsWith(bulanIni)).reduce((a, b) => a + (b.total || 0), 0),
      totalUnpaid: invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").reduce((a, b) => a + (b.total || 0), 0),
      stokKritis: inventoryData.filter(i => i.status === "OUT" || i.status === "CRITICAL").map(i => i.name),
    },
    // ── PRICE LIST LIVE: baca dari priceListData (React state — reactive) ──
    hargaLayanan: (() => {
      const src = priceListData.filter(r => r.is_active !== false);
      if (src.length === 0) {
        // Fallback ke PRICE_LIST var jika state belum load
        const rows = [];
        Object.entries(PRICE_LIST).forEach(([svc, types]) => {
          if (typeof types === "object" && !Array.isArray(types)) {
            Object.entries(types).forEach(([tipe, harga]) => {
              if (tipe !== "default") rows.push({ service: svc, type: tipe, harga, formatted: "Rp" + Number(harga).toLocaleString("id-ID") });
            });
          }
        });
        return rows;
      }
      return src.map(r => ({
        service: r.service,
        type: r.type,
        harga: Number(r.price) || 0,
        formatted: "Rp" + Number(r.price || 0).toLocaleString("id-ID"),
        notes: r.notes || null,
      }));
    })(),
  };
}
