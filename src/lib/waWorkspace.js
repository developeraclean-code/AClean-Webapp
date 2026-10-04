import { normalizePhone, samePhone, smartSearchNormalize } from "./phone.js";

export const waMoney = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);

export function invoiceBalance(invoice) {
  if (!["UNPAID", "OVERDUE", "PARTIAL_PAID"].includes(invoice.status)) return 0;
  return Math.max(0, Number(invoice.remaining_amount ?? (Number(invoice.total || 0) - Number(invoice.paid_amount || 0))) || 0);
}

// A phone can belong to several customer locations. Never mix their orders or bills.
export function customerRecords(rows, customer, phone, customers) {
  const matches = customers.filter(c => samePhone(c.phone, phone));
  if (!customer && matches.length > 1) return [];
  const name = (customer?.name || "").trim().toLowerCase();
  return rows.filter(row => {
    if (row.customer_id && customer) return row.customer_id === customer.id;
    if (matches.length > 1) return !!name && (row.customer || "").trim().toLowerCase() === name;
    return samePhone(row.phone, phone) || (!!name && (row.customer || "").trim().toLowerCase() === name);
  });
}

export function matchesConversation(conv, customers, search) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const phoneQuery = smartSearchNormalize(q);
  return [conv.name, conv.last_message, conv.last_reply, conv.last, ...customers.map(c => c.name)]
    .some(value => String(value || "").toLowerCase().includes(q)) ||
    normalizePhone(conv.phone).includes(phoneQuery);
}

export function createWaOrderDraft(conv, customer, previous) {
  return {
    customer_id: customer?.id || null,
    customer: customer?.name || conv.name || "", phone: normalizePhone(conv.phone),
    address: previous?.address || customer?.address || "", area: previous?.area || customer?.area || "",
    service: previous?.service || "Cleaning", type: previous?.type || "AC Split 0.5-1PK", units: previous?.units || 1,
    teknisi: "", helper: "", team_slot: "", date: "", time: "09:00",
    notes: previous ? `Reorder dari ${previous.id}. Konfirmasi kembali detail dan jadwal dengan pelanggan.` : "Order dari WhatsApp AClean.",
    maintenance_client_id: "", maintenance_unit_ids: [],
  };
}

// Planning deliberately leaves personnel empty, even when a slot search suggested
// a technician. Daily roster assignment is a separate action on the chosen date.
export function createWaPlanningForm(draft, calculateEnd) {
  const time = draft.time || "09:00";
  return {
    customer_id: draft.customer_id || null, customer: draft.customer || "",
    phone: normalizePhone(draft.phone), address: draft.address || "",
    service: draft.service || "Cleaning", type: draft.type || "", units: draft.units || 1,
    date: draft.date || "", time, time_end: draft.time_end || calculateEnd(time, draft.service || "Cleaning", draft.units || 1),
    status: draft.status === "CONFIRMED" ? "CONFIRMED" : "PENDING", team_slot: draft.team_slot || "", teknisi: "", helper: "",
    notes: [draft.notes, draft.teknisi ? `Referensi slot: ${draft.teknisi}. Penugasan tim ditentukan melalui Planning Order.` : ""].filter(Boolean).join("\n"),
  };
}

export function paymentReminder(customerName, invoice) {
  return `Halo ${customerName}, kami dari AClean ingin mengingatkan pembayaran invoice ${invoice.id}${invoice.service ? ` untuk ${invoice.service}` : ""}. Sisa tagihan ${waMoney(invoiceBalance(invoice))}. Jika sudah melakukan pembayaran, mohon kirimkan bukti transfer agar dapat kami periksa. Terima kasih.`;
}

export async function fetchWaHistory(supabase, phone, limit = 100) {
  const query = columns => supabase.from("wa_messages").select(columns).eq("phone", phone)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  let result = await query("id,phone,name,content,role,created_at,image_url");
  if (result.error?.code === "42703") result = await query("id,phone,name,content,role,created_at");
  if (result.error) throw new Error(result.error.message || "Gagal memuat pesan");
  return [...(result.data || [])].reverse();
}
