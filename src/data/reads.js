// Pure Supabase read functions — tidak mengubah state, hanya return { data, error }.
// Caller (App.jsx) yang tangani error handling + state setter.
// LIMIT di-tune supaya page load cepat; reference tables tanpa limit.

export const fetchOrders = (supabase) =>
  supabase.from("orders").select("*").order("date", { ascending: false }).limit(500);

export const fetchInvoices = (supabase) =>
  supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(300);

export const fetchCustomers = (supabase) =>
  supabase.from("customers").select("*").order("name");

export const fetchInventory = (supabase) =>
  supabase.from("inventory").select("*").order("code");

export const fetchServiceReports = (supabase) =>
  supabase.from("service_reports").select("*").order("submitted_at", { ascending: false }).limit(200);

export const fetchAgentLogs = (supabase) =>
  supabase.from("agent_logs").select("*").order("created_at", { ascending: false }).limit(100);

export const fetchInventoryTransactions = (supabase) =>
  supabase.from("inventory_transactions").select("*").order("created_at", { ascending: false }).limit(500);

export const fetchInventoryUnits = (supabase) =>
  supabase.from("inventory_units").select("*").order("inventory_code").order("unit_label");

export const fetchExpenses = (supabase) =>
  supabase.from("expenses").select("*").order("date", { ascending: false }).limit(500);

export const fetchPayments = (supabase) =>
  supabase.from("payments").select("invoice_id,amount,method,paid_at").order("paid_at", { ascending: false }).limit(20);

export const fetchDispatchLogs = (supabase) =>
  supabase.from("dispatch_logs").select("order_id,teknisi,status,sent_at").order("sent_at", { ascending: false }).limit(30);

export const fetchAppSettings = (supabase) =>
  supabase.from("app_settings").select("*");

export const fetchUserProfiles = (supabase) =>
  supabase.from("user_profiles").select("*").order("name");

export const fetchUserAccounts = (supabase) =>
  supabase.from("user_profiles").select("*")
    .in("role", ["Owner", "Admin", "owner", "admin"]).order("name");

export const fetchWaConversations = (supabase, limit = 50) => {
  const q = supabase.from("wa_conversations").select("*").order("updated_at", { ascending: false });
  return limit ? q.limit(limit) : q;
};

export const fetchPriceList = (supabase) =>
  supabase.from("price_list").select("*").order("service").order("type");

export const fetchAraBrain = (supabase) =>
  supabase.from("ara_brain").select("key,value");
