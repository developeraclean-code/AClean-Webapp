// Pure Supabase read functions — tidak mengubah state, hanya return { data, error }.
// Caller (App.jsx) yang tangani error handling + state setter.
// LIMIT di-tune supaya page load cepat; reference tables tanpa limit.
// Kolom di-seleksi eksplisit (bukan SELECT *) untuk hemat egress.

const ORDER_COLS = "id,customer,customer_id,phone,address,area,service,type,units,teknisi,helper,date,time,time_end,status,notes,dispatch,dispatch_at,invoice_id,created_at,teknisi_id,helper_id,teknisi2,helper2,teknisi3,helper3,source,team_slot,on_site_at,parent_job_id,is_multi_day,day_number,maintenance_client_id,maintenance_unit_ids";
export const fetchOrders = (supabase) =>
  supabase.from("orders")
    .select(ORDER_COLS)
    .order("date", { ascending: false }).limit(500);

// Server-side search order — ilike di kolom yang relevan, batas 100 hasil.
export const searchOrdersServer = (supabase, query) => {
  const term = (query || "").trim().replace(/[(),]/g, " ").trim();
  if (term.length < 2) return Promise.resolve({ data: [], error: null });
  const p = `%${term}%`;
  return supabase.from("orders")
    .select(ORDER_COLS)
    .or(`customer.ilike.${p},id.ilike.${p},phone.ilike.${p},teknisi.ilike.${p},helper.ilike.${p},address.ilike.${p},service.ilike.${p}`)
    .order("date", { ascending: false })
    .limit(100);
};

const INVOICE_COLS = "id,job_id,customer,phone,address,service,units,labor,material,discount,trade_in,trade_in_amount,total,status,due,paid_at,sent,sent_at,created_at,updated_at,follow_up,teknisi,garansi_days,garansi_expires,paid_method,materials_detail,payment_proof_url,repair_gratis,invoice_type,unit_ac_amount,paket_pasang,paid_amount,remaining_amount,wa_sent_count,wa_last_sent_at,wa_last_sent_mode,pdf_url,pdf_generated_at";
export const fetchInvoices = (supabase) =>
  supabase.from("invoices")
    .select(INVOICE_COLS)
    .order("created_at", { ascending: false }).limit(300);

// Server-side search invoice — multi-kolom: identitas + tim + layanan + bayar + status.
// Karakter spesial (koma, kurung) di-strip untuk hindari masalah parser .or() Supabase.
export const searchInvoicesServer = (supabase, query) => {
  const term = (query || "").trim().replace(/[(),]/g, " ").trim();
  if (term.length < 2) return Promise.resolve({ data: [], error: null });
  const p = `%${term}%`;
  return supabase.from("invoices")
    .select(INVOICE_COLS)
    .or([
      `customer.ilike.${p}`,
      `id.ilike.${p}`,
      `phone.ilike.${p}`,
      `job_id.ilike.${p}`,
      `teknisi.ilike.${p}`,
    ].join(","))
    .order("created_at", { ascending: false })
    .limit(100);
};

export const fetchCustomers = (supabase) =>
  supabase.from("customers")
    .select("id,name,phone,address,area,email,is_vip,notes,joined,total_orders,last_service,membership_tier,total_units_serviced")
    .order("name").limit(5000);

// Server-side lookup by phone (anti race condition & tidak terbatas limit fetchCustomers).
// Phone ter-index (unique constraint phone+name) → query cepat walau ribuan customer.
export const lookupCustomersByPhone = (supabase, normalizedPhone) =>
  supabase.from("customers")
    .select("id,name,phone,address,area,total_orders,last_service")
    .eq("phone", normalizedPhone)
    .limit(20);

export const fetchInventory = (supabase) =>
  supabase.from("inventory")
    .select("id,code,name,unit,price,stock,reorder,status,min_alert,material_type,freon_type")
    .order("code").limit(500);

export const fetchServiceReports = (supabase) =>
  supabase.from("service_reports")
    .select("id,job_id,teknisi,helper,customer,service,type,date,total_units,total_freon,units,materials_used,foto_urls,rekomendasi,catatan_global,edit_log,status,submitted_at,updated_at,units_json,materials_json,submitted,unit_mismatch,created_at,is_substitute,is_install,bap_number,bap_statement,bap_recommendation,ttd_customer_url,ttd_customer_name,bap_skipped_reason,bap_signed_at,hasil_survey,catatan_rekomendasi,survey_sent_at")
    .order("submitted_at", { ascending: false }).limit(5000);

export const fetchAgentLogs = (supabase) =>
  supabase.from("agent_logs").select("*").order("created_at", { ascending: false }).limit(100);

// ───── OBSERVABILITY (Mission Control) ─────
// Filter agent_logs by severity/category — untuk audit log viewer
export const fetchAgentLogsFiltered = (supabase, { severity, category, since, limit = 100 } = {}) => {
  let q = supabase.from("agent_logs")
    .select("id,action,severity,category,status,detail,metadata,user_name,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (severity) q = q.eq("severity", severity);
  if (category) q = q.eq("category", category);
  if (since) q = q.gte("created_at", since);
  return q;
};

// Cron runs — last N executions, optionally per task
export const fetchCronRuns = (supabase, { taskName, since, limit = 100 } = {}) => {
  let q = supabase.from("cron_runs")
    .select("id,task_name,status,duration_ms,items_processed,error_message,metadata,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (taskName) q = q.eq("task_name", taskName);
  if (since) q = q.gte("started_at", since);
  return q;
};

// AI usage — untuk cost tracking dashboard
export const fetchAiUsage = (supabase, { since, provider, feature, limit = 200 } = {}) => {
  let q = supabase.from("ai_usage")
    .select("id,provider,model,feature,input_tokens,output_tokens,cost_usd,duration_ms,error,user_name,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("created_at", since);
  if (provider) q = q.eq("provider", provider);
  if (feature) q = q.eq("feature", feature);
  return q;
};

// WA delivery summary view — 30 hari last
export const fetchWaDeliverySummary = (supabase) =>
  supabase.from("wa_delivery_summary").select("*").order("day", { ascending: false }).limit(30);

// Dispatch logs detail dengan delivery status
export const fetchDispatchLogsDetailed = (supabase, { since, limit = 100 } = {}) => {
  let q = supabase.from("dispatch_logs")
    .select("id,order_id,teknisi,assigned_by_name,status,delivered_at,failed_reason,retry_count,sent_at")
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (since) q = q.gte("sent_at", since);
  return q;
};

export const fetchInventoryTransactions = (supabase) =>
  supabase.from("inventory_transactions")
    .select("id,inventory_code,inventory_name,qty,qty_actual,type,order_id,report_id,notes,created_at,customer_name,teknisi_name,job_date,unit_label,unit_id")
    .order("created_at", { ascending: false }).limit(500);

export const fetchInventoryUnits = (supabase) =>
  supabase.from("inventory_units")
    .select("id,inventory_code,unit_label,stock,capacity,min_visible,is_active,archived,archived_at,archived_reason")
    .order("inventory_code").order("unit_label").limit(2000);

export const fetchExpenses = (supabase) =>
  supabase.from("expenses")
    .select("id,date,amount,category,subcategory,description,teknisi_name,item_name,freon_type,created_at")
    .is("deleted_at", null)
    .order("date", { ascending: false }).limit(2000);

// Recycle bin — expenses yang sudah di-soft-delete (untuk tab "Dihapus")
export const fetchDeletedExpenses = (supabase) =>
  supabase.from("expenses")
    .select("id,date,amount,category,subcategory,description,teknisi_name,item_name,freon_type,created_at,deleted_at,deleted_by")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false }).limit(500);

// Bulk kasbon untuk satu periode (semua orang) — untuk deteksi staleness payroll.
// Hanya yang aktif (deleted_at NULL) agar konsisten dengan total live.
export const fetchAllKasbonByPeriod = (supabase, periodStart, periodEnd) =>
  supabase.from("expenses")
    .select("teknisi_name,amount,date")
    .eq("subcategory", "Kasbon Karyawan")
    .is("deleted_at", null)
    .gte("date", periodStart)
    .lte("date", periodEnd);

export const fetchPayments = (supabase) =>
  supabase.from("payments").select("invoice_id,amount,method,paid_at").order("paid_at", { ascending: false }).limit(20);

export const fetchDispatchLogs = (supabase) =>
  supabase.from("dispatch_logs").select("order_id,teknisi,status,sent_at").order("sent_at", { ascending: false }).limit(30);

export const fetchAppSettings = (supabase) =>
  supabase.from("app_settings").select("*").limit(100);

export const fetchUserProfiles = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,email,phone,role,status,active,color,avatar,skills,last_login,daily_rate")
    .order("name").limit(100);

export const fetchUserAccounts = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,email,phone,role,status,active,color,avatar,skills,last_login,daily_rate")
    .order("name").limit(200);

export const fetchWaConversations = (supabase, limit = 50) => {
  const q = supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false });
  return limit ? q.limit(limit) : q;
};

export const fetchPriceList = (supabase) =>
  supabase.from("price_list").select("*").order("service").order("type").limit(200);

export const fetchAraBrain = (supabase) =>
  supabase.from("ara_brain").select("key,value").limit(50);

export const fetchPendingPaymentSuggestions = (supabase) =>
  supabase.from("payment_suggestions").select("*").eq("status","PENDING")
    .order("created_at",{ascending:false}).limit(20);

// Kehadiran teknisi — ambil 14 hari ke depan dari today
export const fetchTechAvailability = (supabase, fromDate) =>
  supabase.from("technician_availability").select("*")
    .gte("date", fromDate).order("date").limit(200);

// Availability override per orang per periode (payroll) — hanya yang punya status non-null
export const fetchAvailabilityByUserPeriod = (supabase, userName, periodStart, periodEnd) =>
  supabase.from("technician_availability")
    .select("date,status,reason")
    .eq("teknisi", userName)
    .gte("date", periodStart)
    .lte("date", periodEnd)
    .not("status", "is", null);

// ───── PAYROLL ─────
export const fetchWeeklyPayroll = (supabase, periodStart) =>
  supabase.from("weekly_payroll")
    .select("*")
    .eq("period_start", periodStart)
    .order("user_name");

export const fetchWeeklyPayrollByUser = (supabase, userId, limit = 12) =>
  supabase.from("weekly_payroll")
    .select("*")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(limit);

// Auto-hitung hari masuk dari orders untuk satu periode (Senin–Sabtu)
export const fetchDaysWorkedFromOrders = (supabase, userName, periodStart, periodEnd) =>
  supabase.from("orders")
    .select("date,teknisi,teknisi2,teknisi3,helper,helper2,helper3")
    .gte("date", periodStart)
    .lte("date", periodEnd)
    .or(`teknisi.eq.${userName},teknisi2.eq.${userName},teknisi3.eq.${userName},helper.eq.${userName},helper2.eq.${userName},helper3.eq.${userName}`);

// Kasbon periode — sum dari expenses kasbon per orang
// PENTING: ilike untuk match case-insensitive (mitigasi data lama "putra" / "Putra" / dll)
// Trailing space dimitigasi di entry point ExpensesView (trim saat insert)
export const fetchKasbonByPeriod = (supabase, userName, periodStart, periodEnd) =>
  supabase.from("expenses")
    .select("amount,date,description")
    .eq("subcategory", "Kasbon Karyawan")
    .is("deleted_at", null)
    .ilike("teknisi_name", (userName || "").trim())
    .gte("date", periodStart)
    .lte("date", periodEnd);

// ───── KASBON REQUESTS ─────
export const fetchKasbonRequests = (supabase) =>
  supabase.from("kasbon_requests")
    .select("id,teknisi_name,teknisi_phone,amount,reason,status,requested_at,reviewed_at,reviewed_by,review_notes,expense_id,job_id,created_at")
    .order("requested_at", { ascending: false }).limit(500);

// ───── ORDER BONUSES ─────
export const fetchOrderBonuses = (supabase, { status, orderDate, limit = 100 } = {}) => {
  let q = supabase.from("order_bonuses").select("*").order("order_date", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  if (orderDate) q = q.eq("order_date", orderDate);
  return q;
};

export const fetchOrderBonusesByPeriod = (supabase, from, to) =>
  supabase.from("order_bonuses")
    .select("*")
    .gte("order_date", from)
    .lte("order_date", to)
    .order("order_date", { ascending: false });

// Bonus milik satu user (by name dalam team_members array)
export const fetchMyBonuses = (supabase, userName, limit = 50) =>
  supabase.from("order_bonuses")
    .select("*")
    .contains("team_members", [userName])
    .order("order_date", { ascending: false })
    .limit(limit);

// Orders minggu ini yang belum punya bonus entry (untuk admin review)
export const fetchOrdersWithoutBonus = (supabase, periodStart, periodEnd) =>
  supabase.from("orders")
    .select("id,date,customer,service,units,teknisi,teknisi2,teknisi3,helper,helper2,helper3,invoice_id,status")
    .gte("date", periodStart)
    .lte("date", periodEnd)
    .in("status", ["COMPLETED","PAID"])
    .order("date");
