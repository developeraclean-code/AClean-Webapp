// Pure Supabase read functions — tidak mengubah state, hanya return { data, error }.
// Caller (App.jsx) yang tangani error handling + state setter.
// Opsi-A optimization: kolom spesifik (bukan *) + limit dikurangi untuk hemat bandwidth & koneksi.

export const fetchOrders = (supabase) =>
  supabase.from("orders")
    .select("id,customer,phone,address,service,units,teknisi,helper,date,time,status,notes,price,dadakan,created_at,updated_at,last_changed_by,last_changed_at,audit_trail")
    .order("date", { ascending: false }).limit(200);

export const fetchInvoices = (supabase) =>
  supabase.from("invoices")
    .select("id,order_id,customer,phone,service,units,teknisi,date,status,subtotal,total,paid_at,due_date,notes,materials_detail,dadakan,freon_type,freon_qty,created_at,approved_by,approved_at,last_changed_by,last_changed_at")
    .order("created_at", { ascending: false }).limit(150);

export const fetchCustomers = (supabase) =>
  supabase.from("customers")
    .select("id,name,phone,address,area,notes,created_at,updated_at")
    .order("name").limit(500);

export const fetchInventory = (supabase) =>
  supabase.from("inventory")
    .select("id,code,name,unit,price,stock,reorder,min_alert,status,updated_at")
    .order("code").limit(250);

export const fetchServiceReports = (supabase) =>
  supabase.from("service_reports")
    .select("id,job_id,order_id,teknisi,helper,customer,address,service,status,submitted_at,verified_at,units_json,materials_json,fotos,foto_urls,catatan,edit_log,units,materials_used")
    .order("submitted_at", { ascending: false }).limit(150);

export const fetchAgentLogs = (supabase) =>
  supabase.from("agent_logs")
    .select("id,action,description,level,user_name,created_at")
    .order("created_at", { ascending: false }).limit(100);

export const fetchInventoryTransactions = (supabase) =>
  supabase.from("inventory_transactions")
    .select("id,inventory_code,inventory_name,qty,type,notes,created_at,order_id,expense_id")
    .order("created_at", { ascending: false }).limit(300);

export const fetchInventoryUnits = (supabase) =>
  supabase.from("inventory_units")
    .select("id,inventory_code,unit_label,capacity,current_stock,min_visible,updated_at")
    .order("inventory_code").order("unit_label").limit(500);

export const fetchExpenses = (supabase) =>
  supabase.from("expenses")
    .select("id,category,subcategory,amount,date,description,teknisi_name,item_name,freon_type,created_at,updated_at")
    .order("date", { ascending: false }).limit(300);

export const fetchPayments = (supabase) =>
  supabase.from("payments").select("invoice_id,amount,method,paid_at").order("paid_at", { ascending: false }).limit(20);

export const fetchDispatchLogs = (supabase) =>
  supabase.from("dispatch_logs").select("order_id,teknisi,status,sent_at").order("sent_at", { ascending: false }).limit(30);

export const fetchAppSettings = (supabase) =>
  supabase.from("app_settings").select("*").limit(100);

export const fetchUserProfiles = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,role,active,status,phone,email,avatar_url,teknisi_color")
    .order("name").limit(100);

export const fetchUserAccounts = (supabase) =>
  supabase.from("user_profiles")
    .select("id,name,role,active,status,phone,email,avatar_url,teknisi_color")
    .order("name").limit(100);

export const fetchWaConversations = (supabase, limit = 50) => {
  const q = supabase.from("wa_conversations")
    .select("id,phone,name,last_message,last_message_at,updated_at,unread_count,status")
    .order("updated_at", { ascending: false });
  return limit ? q.limit(limit) : q;
};

export const fetchPriceList = (supabase) =>
  supabase.from("price_list").select("*").order("service").order("type").limit(200);

export const fetchAraBrain = (supabase) =>
  supabase.from("ara_brain").select("key,value").limit(50);

export const fetchPendingPaymentSuggestions = (supabase) =>
  supabase.from("payment_suggestions")
    .select("id,order_id,phone,customer,amount,bank,status,created_at")
    .eq("status","PENDING")
    .order("created_at",{ascending:false}).limit(20);
