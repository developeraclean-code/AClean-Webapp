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

export const markInvoicePaid = async (supabase, id, paidAt, userName, options = {}) => {
  const paymentId = options.paymentId || globalThis.crypto?.randomUUID?.()
    || `00000000-0000-4000-8000-${Date.now().toString().padStart(12,"0").slice(-12)}`;
  const { data, error } = await supabase.rpc("settle_invoice_atomic", {
    p_invoice_id: id,
    p_payment_id: paymentId,
    p_paid_at: String(paidAt || "").slice(0,10),
    p_method: options.method || "transfer",
    p_notes: options.notes || null,
    p_payment_proof_url: options.paymentProofUrl || null,
    p_actor_name: userName || null,
    p_mutation_key: options.mutationKey || `invoice-settle:${paymentId}`,
  });
  if (!error) return { data: data?.invoice || data || null, error: null, result: data || null };

  // Trial lokal sebelum migration 177 dipasang: pertahankan perilaku lama. Error bisnis
  // dari RPC TIDAK boleh difallback karena dapat menembus guard double-payment.
  const rpcMissing = error.code === "PGRST202" || error.code === "42883"
    || /settle_invoice_atomic.*(schema cache|does not exist|not found)/i.test(error.message || "");
  if (!rpcMissing) return { data: null, error, result: null };

  const { data: inv, error: readError } = await supabase.from("invoices")
    .select("id,job_id,phone,total,paid_amount,status").eq("id",id).single();
  if (readError || !inv) return { data:null,error:readError || { message:"Invoice tidak ditemukan" } };
  if (!["UNPAID","OVERDUE","PARTIAL_PAID","PENDING_APPROVAL"].includes(inv.status)) {
    return { data:null,error:{ message:`Invoice sudah ${inv.status} — tidak bisa dibayar ulang` } };
  }
  const total=Number(inv.total)||0;
  const legacy = await supabase.from("invoices").update({
    status:"PAID",paid_at:paidAt,paid_method:options.method || "transfer",
    paid_amount:total,remaining_amount:0,pdf_url:null,pdf_generated_at:null,
    ...(options.paymentProofUrl ? { payment_proof_url:options.paymentProofUrl } : {}),
    last_changed_by:userName,
  }).eq("id",id).in("status",["UNPAID","OVERDUE","PARTIAL_PAID","PENDING_APPROVAL"]).select().single();
  if (legacy.error) return legacy;
  await supabase.from("orders").update({ status:"PAID",last_changed_by:userName }).or(`id.eq.${inv.job_id},invoice_id.eq.${id}`);
  const remaining=Math.max(0,total-Number(inv.paid_amount||0));
  if (remaining>0) await supabase.from("invoice_payments").insert({
    id:paymentId,invoice_id:id,amount:remaining,method:options.method || "transfer",
    notes:options.notes || "Lunas",paid_at:String(paidAt||"").slice(0,10),recorded_by_name:userName,
  });
  if (inv.phone) await supabase.from("customers").update({ last_service:String(paidAt||"").slice(0,10) }).eq("phone",inv.phone);
  return { data:legacy.data,error:null,result:{ invoice:legacy.data,replayed:false,legacy_fallback:true } };
};

// Revert invoice PAID/PARTIAL_PAID → UNPAID/OVERDUE (Owner only — untuk koreksi nilai).
// Hanya membalik status + field pembayaran. payment_logs & bukti bayar TIDAK dihapus (audit).
// Order terkait (PAID → INVOICE_APPROVED) di-handle di caller.
export const revertInvoiceToUnpaid = async (supabase, id, userName) => {
  const { data: inv } = await supabase
    .from("invoices").select("total,status,due").eq("id", id).single();
  if (!inv) return { data: null, error: { message: "Invoice tidak ditemukan" } };

  const REVERTABLE = ["PAID", "PARTIAL_PAID"];
  if (!REVERTABLE.includes(inv.status)) {
    return { data: null, error: { message: `Invoice status ${inv.status} — hanya PAID/PARTIAL yang bisa direvert` } };
  }

  const total = Number(inv.total) || 0;
  const isOverdue = inv.due && new Date(inv.due) < new Date();
  const newStatus = isOverdue ? "OVERDUE" : "UNPAID";

  const { data, error } = await supabase.from("invoices").update({
    status: newStatus,
    paid_at: null,
    paid_amount: 0,
    remaining_amount: total,
    paid_method: null,
    pdf_url: null,
    pdf_generated_at: null,
    last_changed_by: `${userName}::REVERT_PAID`,
  }).eq("id", id).in("status", REVERTABLE).select("id");

  if (!error && (!data || data.length === 0)) {
    return { data: null, error: { message: "Invoice sudah diproses pengguna lain — refresh halaman" } };
  }
  return { data, error, newStatus };
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
