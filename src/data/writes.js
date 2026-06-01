// Pure Supabase write functions dengan injeksi `last_changed_by` untuk audit trail.
// Fokus 5 tabel: orders, invoices, customers, expenses, service_reports.
// Tabel lain (inventory, user_profiles, price_list, ara_brain, app_settings,
// inventory_units, payments, dispatch_logs, technician_schedule) tetap inline
// karena belum punya kolom `last_changed_by` atau pattern-nya beragam.
//
// Pattern DELETE: pre-update `last_changed_by` dulu supaya trigger audit
// bisa baca user dari OLD row (Supabase pooler transaction mode tidak
// persist session vars).

// ───── ORDERS ─────
export const insertOrder = (supabase, payload) =>
  supabase.from("orders").insert(payload);

export const updateOrder = (supabase, id, fields, userName) =>
  supabase.from("orders").update({ ...fields, last_changed_by: userName }).eq("id", id);

export const updateOrderStatus = (supabase, id, status, userName, extra = {}) =>
  supabase.from("orders").update({ status, ...extra, last_changed_by: userName }).eq("id", id);

export const deleteOrder = async (supabase, id, userName) => {
  await supabase.from("orders").update({ last_changed_by: userName }).eq("id", id);
  return supabase.from("orders").delete().eq("id", id);
};

// ───── INVOICES ─────
export const insertInvoice = (supabase, payload) =>
  supabase.from("invoices").insert(payload);

// updateInvoice auto-invalidate PDF cache: setiap edit invoice, pdf_url di-NULL kan
// supaya next generate pakai data terbaru. Lihat src/lib/pdfCache.js + generateInvoicePDFBlob di App.jsx.
// Caller bisa override dengan fields.pdf_url eksplisit (mis. saat cache flow set ulang URL baru).
export const updateInvoice = (supabase, id, fields, userName) => {
  const hasExplicitPdfUrl = Object.prototype.hasOwnProperty.call(fields || {}, "pdf_url");
  const invalidation = hasExplicitPdfUrl ? {} : { pdf_url: null, pdf_generated_at: null };
  return supabase
    .from("invoices")
    .update({ ...fields, ...invalidation, last_changed_by: userName })
    .eq("id", id);
};

export const markInvoicePaid = async (supabase, id, paidAt, userName) => {
  const { data: inv } = await supabase
    .from("invoices").select("total,status").eq("id", id).single();

  if (!inv) return { data: null, error: { message: "Invoice tidak ditemukan" } };

  const PAYABLE_STATUSES = ["UNPAID", "OVERDUE", "PARTIAL_PAID", "PENDING_APPROVAL"];
  if (!PAYABLE_STATUSES.includes(inv.status)) {
    return { data: null, error: { message: `Invoice sudah ${inv.status} — tidak bisa dibayar ulang` } };
  }

  const total = Number(inv.total) || 0;
  const { data, error } = await supabase.from("invoices").update({
    status: "PAID",
    paid_at: paidAt,
    paid_amount: total,
    remaining_amount: 0,
    last_changed_by: userName,
  }).eq("id", id).in("status", PAYABLE_STATUSES).select("id");

  if (!error && (!data || data.length === 0)) {
    return { data: null, error: { message: "Invoice sudah diproses oleh pengguna lain — refresh halaman" } };
  }
  return { data, error };
};

export const deleteInvoice = async (supabase, id, userName, reason = "MANUAL_DELETE") => {
  await supabase.from("invoices").update({ last_changed_by: `${userName}::${reason}` }).eq("id", id);
  // payment_logs FK NO ACTION — hapus dulu agar invoice bisa dihapus
  await supabase.from("payment_logs").delete().eq("invoice_id", id);
  // Untuk invoice AC unit sale, ada order install yang auto-created — clear linkage
  // Order tidak dihapus (ada laporan teknisi yang link ke order), hanya unset invoice_id
  await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", id);
  // invoice_items + payments akan terhapus via FK CASCADE
  return supabase.from("invoices").delete().eq("id", id);
};

// ───── SERVICE REPORTS ─────
export const updateServiceReport = (supabase, id, fields, userName) =>
  supabase.from("service_reports").update({ ...fields, last_changed_by: userName }).eq("id", id);

export const deleteServiceReport = async (supabase, id, userName) => {
  await supabase.from("service_reports").update({ last_changed_by: userName }).eq("id", id);
  return supabase.from("service_reports").delete().eq("id", id);
};

// ───── EXPENSES ─────
export const insertExpense = (supabase, payload) =>
  supabase.from("expenses").insert(payload).select().single();

export const updateExpense = (supabase, id, fields, userName) =>
  supabase.from("expenses").update({ ...fields, last_changed_by: userName }).eq("id", id);

// Soft-delete: pindah ke recycle bin (deleted_at terisi), bukan hapus permanen.
// Bisa di-restore lewat restoreExpense. Hard delete pakai purgeExpense (Owner only).
export const deleteExpense = (supabase, id, userName) =>
  supabase.from("expenses")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userName, last_changed_by: userName })
    .eq("id", id);

// Restore dari recycle bin → kembali aktif.
export const restoreExpense = (supabase, id, userName) =>
  supabase.from("expenses")
    .update({ deleted_at: null, deleted_by: null, last_changed_by: userName })
    .eq("id", id)
    .select()
    .single();

// Hapus permanen dari recycle bin (tidak bisa di-undo) — Owner only.
export const purgeExpense = (supabase, id) =>
  supabase.from("expenses").delete().eq("id", id);

// ───── CUSTOMERS ─────
// Customers table belum punya kolom last_changed_by — tidak ada audit injection.
export const insertCustomer = (supabase, payload) =>
  supabase.from("customers").insert(payload).select().single();

export const upsertCustomer = (supabase, payload, onConflict = "phone") =>
  supabase.from("customers").upsert(payload, { onConflict, ignoreDuplicates: false }).select().single();

export const updateCustomer = (supabase, id, fields) =>
  supabase.from("customers").update(fields).eq("id", id);

export const deleteCustomer = (supabase, id) =>
  supabase.from("customers").delete().eq("id", id);

// ───── PAYMENT SUGGESTIONS ─────
export const resolvePaymentSuggestion = (supabase, id, status, resolvedBy) =>
  supabase.from("payment_suggestions").update({
    status,
    resolved_at: new Date(Date.now() + 7*3600000).toISOString(),
    resolved_by: resolvedBy
  }).eq("id", id);

// ───── PAYROLL ─────
export const updateUserDailyRate = (supabase, userId, dailyRate) =>
  supabase.from("user_profiles").update({ daily_rate: dailyRate }).eq("id", userId);

export const upsertWeeklyPayroll = (supabase, payload) =>
  supabase.from("weekly_payroll")
    .upsert(payload, { onConflict: "user_id,period_start" })
    .select().single();

export const updateWeeklyPayroll = (supabase, id, fields) =>
  supabase.from("weekly_payroll")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

export const markPayrollPaid = (supabase, id, paidBy) =>
  supabase.from("weekly_payroll").update({
    is_paid: true,
    paid_at: new Date().toISOString(),
    paid_by: paidBy,
    updated_at: new Date().toISOString()
  }).eq("id", id);

export const markPayrollWaSent = (supabase, id) =>
  supabase.from("weekly_payroll").update({
    wa_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("id", id);

// ───── ORDER BONUSES ─────
export const insertOrderBonus = (supabase, payload, createdBy) =>
  supabase.from("order_bonuses")
    .insert({ ...payload, created_by: createdBy })
    .select().single();

export const updateOrderBonus = (supabase, id, fields) =>
  supabase.from("order_bonuses")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

export const markBonusPaid = (supabase, id, paidBy) =>
  supabase.from("order_bonuses").update({
    status: "PAID",
    paid_at: new Date().toISOString(),
    paid_by: paidBy,
    updated_at: new Date().toISOString()
  }).eq("id", id);

export const voidBonus = (supabase, id, reason, voidedBy) =>
  supabase.from("order_bonuses").update({
    status: "VOID",
    void_reason: reason,
    voided_at: new Date().toISOString(),
    voided_by: voidedBy,
    updated_at: new Date().toISOString()
  }).eq("id", id);

export const deleteOrderBonus = (supabase, id) =>
  supabase.from("order_bonuses").delete().eq("id", id);
