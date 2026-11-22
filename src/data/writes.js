import { fsmCommand } from "../lib/fsmCommand.js";

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

export const updateOrderWorkflowAtomic = (supabase, id, fields, userName, mutationKey) =>
  supabase.rpc("update_order_workflow_atomic", {
    p_order_id: id,
    p_patch: fields,
    p_actor_name: userName || null,
    p_mutation_key: mutationKey || null,
  });

export const updateOrderStatus = async (supabase, id, status, userName, extra = {}) => {
  let result = await supabase.from("orders").update({ status, ...extra, last_changed_by: userName })
    .eq("id", id).select("id,status").maybeSingle();
  const hasOptionalLocation = Object.keys(extra).some(key => key.startsWith("on_site_location_")
    || ["on_site_latitude", "on_site_longitude", "on_site_accuracy_m"].includes(key));
  const missingLocationColumn = result.error && hasOptionalLocation
    && ["42703", "PGRST204"].includes(result.error.code);
  if (missingLocationColumn) {
    const safeExtra = Object.fromEntries(Object.entries(extra).filter(([key]) => !(
      key.startsWith("on_site_location_")
      || ["on_site_latitude", "on_site_longitude", "on_site_accuracy_m"].includes(key)
    )));
    result = await supabase.from("orders").update({ status, ...safeExtra, last_changed_by: userName })
      .eq("id", id).select("id,status").maybeSingle();
    return { ...result, locationSkipped: !result.error };
  }
  return result;
};

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

export const markInvoicePaid = async (supabase, id, paidAt, userName, options = {}) => {
  const paymentId = options.paymentId || globalThis.crypto?.randomUUID?.()
    || `00000000-0000-4000-8000-${Date.now().toString().padStart(12,"0").slice(-12)}`;
  const { data, error } = await fsmCommand(supabase, "settle_invoice_atomic", {
    p_invoice_id: id,
    p_payment_id: paymentId,
    p_paid_at: String(paidAt || "").slice(0,10),
    p_method: options.method || "transfer",
    p_notes: options.notes || null,
    p_payment_proof_url: options.paymentProofUrl || null,
    p_actor_name: userName || null,
    p_mutation_key: options.mutationKey || `invoice-settle:${paymentId}`,
  });
  if (!error) {
    if (data?.invoice?.id !== id || data.invoice.status !== "PAID") {
      return { data: null, error: { message: "Pelunasan belum terkonfirmasi; periksa riwayat dengan ID pembayaran yang sama" }, result: null };
    }
    return { data: data.invoice, error: null, result: data };
  }

  // Missing capabilities fail closed: never replace an atomic payment with
  // separate browser writes. Keep the same payment/request ID when reconciling.
  return { data: null, error, result: null };
};

// Keep posted cash/ledger intact. The RPC rejects financial resets and performs
// any permitted zero-value status correction with its order changes atomically.
export const revertInvoiceToUnpaid = async (supabase, id, userName) => {
  try {
    const { data, error } = await fsmCommand(supabase, "revert_invoice_unpaid_atomic", {
      p_invoice_id: id, p_actor_name: userName || null,
    });
    if (error) return { data: null, error };
    if (!data?.invoice || !Array.isArray(data.orders)) {
      return { data: null, error: { message: "Hasil koreksi belum terkonfirmasi; muat ulang invoice sebelum mencoba lagi" } };
    }
    return { data: data.invoice, orders: data.orders, error: null, newStatus: data.new_status };
  } catch (error) { return { data: null, error }; }
};

export const deleteInvoice = async (supabase, id, userName, reason = "MANUAL_DELETE") => {
  try {
    const { data, error } = await fsmCommand(supabase, "delete_invoice_atomic", {
      p_invoice_id: id, p_actor_name: userName || null, p_reason: reason,
    });
    if (error) return { data: null, error };
    if (data?.deleted !== true || data.id !== id) {
      return { data: null, error: { message: "Penghapusan belum terkonfirmasi; periksa invoice sebelum mencoba lagi" } };
    }
    return { data, error: null };
  } catch (error) { return { data: null, error }; }
};

// ───── SERVICE REPORTS ─────
export const updateServiceReport = (supabase, id, fields, userName) =>
  supabase.from("service_reports").update({ ...fields, last_changed_by: userName }).eq("id", id).select("id").maybeSingle();

export const submitServiceReportAtomic = (supabase, report, userName, mutationKey) =>
  supabase.rpc("submit_service_report_atomic", {
    p_report: report,
    p_actor_name: userName || null,
    p_mutation_key: mutationKey || `report-submit:${report?.id}`,
  });

export const finalizeServiceReportAtomic = (supabase, reportId, invoice, userName, mutationKey) =>
  supabase.rpc("finalize_service_report_atomic", {
    p_report_id: reportId,
    p_invoice: invoice || null,
    p_actor_name: userName || null,
    p_mutation_key: mutationKey || `report-finalize:${reportId}`,
  });

export const createOrderWorkflowAtomic = (supabase, order, autoDispatch, userName, mutationKey) =>
  supabase.rpc("create_order_workflow_atomic", {
    p_order: order,
    p_auto_dispatch: !!autoDispatch,
    p_actor_name: userName || null,
    p_mutation_key: mutationKey || `order-create:${order?.id}`,
  });

export const confirmScheduleNoteTeam = (supabase, noteId, expectedVersion, orders, userName) =>
  supabase.rpc("confirm_schedule_note_team", {
    p_note_id: noteId,
    p_expected_version: expectedVersion,
    p_orders: orders,
    p_actor_name: userName || null,
  });

export const deleteServiceReport = async (supabase, id, userName) => {
  await supabase.from("service_reports").update({ last_changed_by: userName }).eq("id", id);
  return supabase.from("service_reports").delete().eq("id", id);
};

// ───── KASBON REQUESTS ─────
export const insertKasbonRequest = (supabase, payload) =>
  supabase.from("kasbon_requests").insert(payload).select().single();

export const updateKasbonRequest = (supabase, id, fields) =>
  supabase.from("kasbon_requests").update(fields).eq("id", id);

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

export const updateCustomer = (supabase, id, fields) =>
  supabase.from("customers").update(fields).eq("id", id);

export const deleteCustomer = (supabase, id) =>
  supabase.from("customers").delete().eq("id", id);

// ───── AC UNIT REGISTRY (ac_units) — registry unit AC permanen per customer ─────
export const fetchAcUnitsByCustomer = (supabase, customerId) =>
  supabase.from("ac_units").select("*").eq("customer_id", customerId).eq("is_active", true).order("created_at");

export const insertAcUnit = (supabase, payload) =>
  supabase.from("ac_units").insert(payload).select().single();

export const updateAcUnit = (supabase, id, fields) =>
  supabase.from("ac_units").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);

// ───── PAYMENT SUGGESTIONS ─────
export const resolvePaymentSuggestion = (supabase, id, status, resolvedBy) =>
  supabase.from("payment_suggestions").update({
    status,
    resolved_at: new Date(Date.now() + 7*3600000).toISOString(),
    resolved_by: resolvedBy
  }).eq("id", id);

// ───── PAYROLL ─────
export const updateUserDailyRate = (supabase, userId, dailyRate) =>
  supabase.from("user_profiles").update({ daily_rate: dailyRate }).eq("id", userId)
    .select("id,daily_rate").single();

export const upsertWeeklyPayroll = (supabase, payload) =>
  supabase.from("weekly_payroll")
    .upsert(payload, { onConflict: "user_id,period_start" })
    .select().single();

export const updateWeeklyPayroll = (supabase, id, fields) =>
  supabase.from("weekly_payroll")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id).select("id,daily_rate").single();

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

// Pencairan massal dari Rekap & Cetak. Validasi status/nilai/tim dan proteksi
// double-click dilakukan dalam satu transaksi PostgreSQL (migration 185).
export const markBonusesPaidBulkAtomic = (supabase, bonusIds, paidBy, mutationKey) =>
  supabase.rpc("mark_order_bonuses_paid_bulk_atomic", {
    p_bonus_ids: bonusIds,
    p_actor_name: paidBy || null,
    p_mutation_key: mutationKey || null,
  });

// Invoice di tab Tanpa Bukti sudah berstatus PAID. RPC ini hanya mengesahkan
// klasifikasi buktinya (cash / memang tanpa bukti), tanpa membuat pembayaran baru.
export const acknowledgePaidInvoicesWithoutProofAtomic = (supabase, invoiceIds, mode, actorName, mutationKey) =>
  supabase.rpc("acknowledge_paid_invoices_without_proof_atomic", {
    p_invoice_ids: invoiceIds,
    p_mode: mode,
    p_actor_name: actorName || null,
    p_mutation_key: mutationKey || null,
  });

// Hanya mengisi order.invoice_id yang kosong/putus bila pasangan invoice aktifnya
// unik dan jelas. Tidak membuat/menghapus invoice atau laporan.
export const applyOrderInvoiceReconciliation = (supabase) =>
  supabase.rpc("reconcile_order_invoice_links", { p_apply: true });

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
