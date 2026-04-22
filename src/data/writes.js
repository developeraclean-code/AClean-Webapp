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

export const updateInvoice = (supabase, id, fields, userName) =>
  supabase.from("invoices").update({ ...fields, last_changed_by: userName }).eq("id", id);

export const markInvoicePaid = (supabase, id, paidAt, userName) =>
  supabase.from("invoices").update({
    status: "PAID", paid_at: paidAt, last_changed_by: userName
  }).eq("id", id);

export const deleteInvoice = async (supabase, id, userName, reason = "MANUAL_DELETE") => {
  await supabase.from("invoices").update({ last_changed_by: `${userName}::${reason}` }).eq("id", id);
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

export const deleteExpense = async (supabase, id, userName) => {
  await supabase.from("expenses").update({ last_changed_by: userName }).eq("id", id);
  return supabase.from("expenses").delete().eq("id", id);
};

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
