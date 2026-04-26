// Pure Supabase read functions — tidak mengubah state, hanya return { data, error }.
// Caller (App.jsx) yang tangani error handling + state setter.
// LIMIT di-tune supaya page load cepat; reference tables tanpa limit.
// Kolom di-seleksi eksplisit (bukan SELECT *) untuk hemat egress.

export const fetchOrders = (supabase) =>
  supabase.from("orders")
    .select("id,customer,customer_id,phone,address,area,service,type,units,teknisi,helper,date,time,time_end,status,notes,dispatch,dispatch_at,invoice_id,created_at,teknisi_id,helper_id,teknisi2,helper2,teknisi3,helper3,source,team_slot,on_site_at,parent_job_id")
    .order("date", { ascending: false }).limit(500);

export const fetchInvoices = (supabase) =>
  supabase.from("invoices")
    .select("id,job_id,customer,phone,service,units,labor,material,dadakan,total,status,due,paid_at,sent,sent_at,created_at,follow_up,teknisi,garansi_days,garansi_expires,paid_method,materials_detail,payment_proof_url")
    .order("created_at", { ascending: false }).limit(300);

export const fetchCustomers = (supabase) =>
  supabase.from("customers")
    .select("id,name,phone,address,area,email,is_vip,notes,joined,total_orders,last_service")
    .order("name").limit(1000);

export const fetchInventory = (supabase) =>
  supabase.from("inventory")
    .select("id,code,name,unit,price,stock,reorder,status,min_alert,material_type,freon_type")
    .order("code").limit(500);

export const fetchServiceReports = (supabase) =>
  supabase.from("service_reports")
    .select("id,job_id,teknisi,helper,customer,service,type,date,total_units,total_freon,units,materials_used,foto_urls,rekomendasi,catatan_global,edit_log,status,submitted_at,updated_at,units_json,materials_json,submitted,unit_mismatch,created_at,is_substitute,is_install")
    .order("submitted_at", { ascending: false }).limit(200);

export const fetchAgentLogs = (supabase) =>
  supabase.from("agent_logs").select("*").order("created_at", { ascending: false }).limit(100);

export const fetchInventoryTransactions = (supabase) =>
  supabase.from("inventory_transactions")
    .select("id,inventory_code,inventory_name,qty,type,order_id,report_id,notes,created_at,customer_name,teknisi_name,job_date,unit_label")
    .order("created_at", { ascending: false }).limit(500);

export const fetchInventoryUnits = (supabase) =>
  supabase.from("inventory_units")
    .select("id,inventory_code,unit_label,stock,capacity,min_visible,is_active")
    .order("inventory_code").order("unit_label").limit(2000);

export const fetchExpenses = (supabase) =>
  supabase.from("expenses")
    .select("id,date,amount,category,subcategory,description,teknisi_name,item_name,freon_type,created_at")
    .order("date", { ascending: false }).limit(500);

export const fetchPayments = (supabase) =>
  supabase.from("payments").select("invoice_id,amount,method,paid_at").order("paid_at", { ascending: false }).limit(20);

export const fetchDispatchLogs = (supabase) =>
  supabase.from("dispatch_logs").select("order_id,teknisi,status,sent_at").order("sent_at", { ascending: false }).limit(30);

export const fetchAppSettings = (supabase) =>
  supabase.from("app_settings").select("*").limit(100);

export const fetchUserProfiles = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,email,phone,role,status,active,color,avatar,skills,last_login")
    .order("name").limit(100);

export const fetchUserAccounts = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,email,phone,role,status,active,color,avatar,skills,last_login")
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
