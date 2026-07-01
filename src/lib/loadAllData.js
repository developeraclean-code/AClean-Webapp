// loadAllData — bootstrap: muat SEMUA data awal dari Supabase (orders, invoices,
// customers, inventory, laporan, settings, users, WA, dll) + hydrate cache & state.
// Diekstrak dari App.jsx (Fase 3, pola ctx). 49 dependency dioper via ctx. Body
// verbatim. Dipanggil dari efek init & auto-refresh polling (nama tetap `loadAll`).
export async function loadAllData({
  _ls, _lsSave, buildPriceListFromDB, cachedFetch, currentUser, dedupReportsByJob,
  fetchAppSettings, fetchAraBrain, fetchCustomers, fetchDispatchLogs, fetchInventory,
  fetchInventoryTransactions, fetchInventoryUnits, fetchInvoices, fetchOrders,
  fetchPayments, fetchPriceList, fetchServiceReports, fetchUserAccounts,
  fetchUserProfiles, fetchWaConversations, parseInvoiceRow, parseLaporanRow,
  setAppSettings, setBonusCategories, setBrainMd, setBrainMdCustomer, setCronJobs,
  setCustomersData, setDispatchLogs, setInvTxData, setInvUnitsData, setInventoryData,
  setInvoicesData, setLaporanReports, setLlmApiKey, setLlmModel, setLlmProvider,
  setOrdersData, setPaymentSuggestions, setPaymentsData, setPriceListData,
  setPriceListSyncedAt, setProjectDailyReports, setTeknisiData, setUserAccounts,
  setWaConversations, setWaProvider, supabase,
}) {
        // Opsi-A: agent_logs, expenses, quotations dikeluarkan dari loadAll — diload on-demand saat view dibuka
        const results = await Promise.allSettled([
          cachedFetch("orders", () => fetchOrders(supabase)),
          cachedFetch("invoices", () => fetchInvoices(supabase)),
          cachedFetch("customers", () => fetchCustomers(supabase)),
          cachedFetch("inventory", () => fetchInventory(supabase)),
          cachedFetch("service_reports", () => fetchServiceReports(supabase)),
          cachedFetch("inv_tx", () => fetchInventoryTransactions(supabase)),
          cachedFetch("inv_units", () => fetchInventoryUnits(supabase)),
          cachedFetch("project_daily_reports", () => supabase.from("project_daily_reports").select("id,order_id,project_id,tanggal,status,submitted_by").order("tanggal", { ascending: false }).limit(1000)),
        ]);
        const [ordersRes, invoicesRes, customersRes, inventoryRes, laporanRes, invTxRes, invUnitsRes, pdrRes] = results.map(r => r.status === "fulfilled" ? r.value : { error: r.reason });
        // Selalu pakai data DB jika tidak error (bahkan array kosong = data nyata dari DB)
        // Jika error = fallback ke demo data yang sudah di-init
        if (!ordersRes.error && ordersRes.data) setOrdersData(ordersRes.data);
        if (!invTxRes?.error && invTxRes?.data) setInvTxData(invTxRes.data);
        if (!invUnitsRes?.error && invUnitsRes?.data) setInvUnitsData(invUnitsRes.data);
        if (!invoicesRes.error && invoicesRes.data) setInvoicesData(invoicesRes.data);
        if (!customersRes.error && customersRes.data) setCustomersData(customersRes.data);
        // [G1 FIXED] laporan load handled below by parseLaporan block
        if (!inventoryRes.error && inventoryRes.data) setInventoryData(inventoryRes.data);
        // Load laporan — single clean parse, always run (even empty = clear demo data)
        // Parse materials_detail JSON di invoices
        if (!invoicesRes.error && invoicesRes.data) {
          setInvoicesData(invoicesRes.data.map(parseInvoiceRow));
        }
        if (!laporanRes.error && laporanRes.data) {
          setLaporanReports(dedupReportsByJob(laporanRes.data.map(parseLaporanRow)));
        }
        if (!pdrRes?.error && pdrRes?.data) setProjectDailyReports(pdrRes.data);
        // Jika DB error total, keep demo data (already in useState init)
        // agent_logs: diakses lewat Monitoring → tab Audit Log (server-side)

        // ── Expenses & agent_logs: load on-demand (opsi-A, bukan di sini) ──

        // ── Auto-cleanup agent_logs > 90 hari: dilakukan oleh cron backend,
        //    bukan frontend — setelah RLS fix, anon/authenticated tidak bisa DELETE ──

        // GAP 3: Load payments summary & dispatch recent (untuk dashboard)
        try {
          const [payRes, dispRes] = await Promise.all([
            fetchPayments(supabase),
            fetchDispatchLogs(supabase),
          ]);
          if (!payRes.error && payRes.data) setPaymentsData(payRes.data);
          if (!dispRes.error && dispRes.data) setDispatchLogs(dispRes.data);
        } catch (e) { /* tabel belum ada, skip */ }

        // Load app_settings dari Supabase DB (backup dari localStorage)
        try {
          const setRes = await fetchAppSettings(supabase);
          if (!setRes.error && setRes.data) {
            const sMap = Object.fromEntries(setRes.data.map(s => [s.key, s.value]));
            // ── Load bonus_categories from app_settings ──
            if (sMap.bonus_categories) {
              try {
                const parsed = JSON.parse(sMap.bonus_categories);
                if (Array.isArray(parsed) && parsed.length > 0) setBonusCategories(parsed);
              } catch (e) { console.error("Failed to parse bonus_categories:", e); }
            }
            // ── FIXED: Load dari DB dan LOG untuk debugging ──
            // PRIORITAS: DB > localStorage > default "claude"
            const VALID_PROVIDERS = ["minimax", "claude", "openai", "groq", "ollama"];
            const currentLS = _ls("llmProvider", null);
            console.log("[Settings] DEBUG — localStorage llmProvider:", currentLS, "DB llm_provider:", sMap.llm_provider);

            const dbProvider = sMap.llm_provider;
            // Model default per provider — harus konsisten dengan LLM_PROVIDERS di SettingsView
            const DEFAULT_MODEL = { minimax: "MiniMax-M2.5", claude: "claude-haiku-4-5-20251001" };
            const resolvedProvider = (dbProvider && VALID_PROVIDERS.includes(dbProvider)) ? dbProvider : "claude";
            setLlmProvider(resolvedProvider);
            _lsSave("llmProvider", resolvedProvider);
            // Model HARUS konsisten dgn provider — cegah mismatch (mis. provider=claude
            // tapi llm_model DB masih "MiniMax-M2.5" -> badge & call ARA salah). Provider
            // dgn 1 model kanonik (claude/minimax) DIPAKSA ke DEFAULT_MODEL-nya; provider
            // lain (openai/groq/ollama) pakai llm_model DB kalau ada & bukan gemini.
            const dbModel = sMap.llm_model;
            const validModel = DEFAULT_MODEL[resolvedProvider]
              || (dbModel && !dbModel.includes("gemini") ? dbModel : "claude-haiku-4-5-20251001");
            setLlmModel(validModel);
            _lsSave("llmModel", validModel);
            // Load wa_provider (WhatsApp provider) from DB — global setting for Owner/Admin
            const VALID_WA_PROVIDERS = ["fonnte", "wa_cloud", "twilio"];
            if (sMap.wa_provider && VALID_WA_PROVIDERS.includes(sMap.wa_provider)) {
              setWaProvider(sMap.wa_provider);
            }
            // Load bank & phone settings dari DB
            if (sMap.bank_number) setAppSettings(prev => ({
              ...prev,
              bank_name: sMap.bank_name || prev.bank_name,
              bank_number: sMap.bank_number || prev.bank_number,
              bank_holder: sMap.bank_holder || prev.bank_holder,
              owner_phone: sMap.owner_phone || prev.owner_phone,
              company_name: sMap.company_name || prev.company_name,
              company_addr: sMap.company_addr || prev.company_addr,
              wa_number: sMap.wa_number || prev.wa_number,
              bap_statement_default: sMap.bap_statement_default || prev.bap_statement_default,
              bap_enabled: sMap.bap_enabled ?? prev.bap_enabled ?? "false",
              wa_autoreply_enabled: sMap.wa_autoreply_enabled ?? prev.wa_autoreply_enabled,
              wa_forward_to_owner: sMap.wa_forward_to_owner ?? prev.wa_forward_to_owner,
              wa_chatbot_enabled: sMap.wa_chatbot_enabled ?? prev.wa_chatbot_enabled ?? "false",
              wa_payment_detect: sMap.wa_payment_detect ?? prev.wa_payment_detect ?? "true",
              wa_cleanup_enabled: sMap.wa_cleanup_enabled ?? prev.wa_cleanup_enabled ?? "true",
              wa_monitor_enabled: sMap.wa_monitor_enabled ?? prev.wa_monitor_enabled ?? "false",
              ara_training_rules: sMap.ara_training_rules ?? prev.ara_training_rules,
              customer_portal_enabled: sMap.customer_portal_enabled ?? prev.customer_portal_enabled ?? "false",
              customer_portal_url: sMap.customer_portal_url ?? prev.customer_portal_url ?? "https://a-clean-webapp.vercel.app",
              rating_prompt_enabled: sMap.rating_prompt_enabled ?? prev.rating_prompt_enabled ?? "false",
              servis_reminder_enabled: sMap.servis_reminder_enabled ?? prev.servis_reminder_enabled ?? "false",
              voucher_loyalty_enabled: sMap.voucher_loyalty_enabled ?? prev.voucher_loyalty_enabled ?? "false",
              voucher_winback_enabled: sMap.voucher_winback_enabled ?? prev.voucher_winback_enabled ?? "false",
              voucher_expiry_reminder_enabled: sMap.voucher_expiry_reminder_enabled ?? prev.voucher_expiry_reminder_enabled ?? "false",
              app_name: sMap.app_name || prev.app_name,
              ai_name: sMap.ai_name || prev.ai_name,
              logo_url: sMap.logo_url ?? prev.logo_url,
              service_types_json: sMap.service_types_json ?? prev.service_types_json,
              area_utama: sMap.area_utama ?? prev.area_utama,
              area_konfirmasi: sMap.area_konfirmasi ?? prev.area_konfirmasi,
            }));
            if (sMap.cron_jobs) {
              try {
                const s = JSON.parse(sMap.cron_jobs);
                if (Array.isArray(s) && s.length > 0) setCronJobs(s);
              } catch { /* cron_jobs JSON rusak → pakai default */ }
            } else {
              // Migrasi: baca toggle lama ke active di masing-masing job
              setCronJobs(prev => prev.map(j => {
                if (!j.backendKey) return j;
                const val = sMap[j.backendKey];
                return val !== undefined ? { ...j, active: val !== "false" } : j;
              }));
            }
            // Sync apiKey sesuai provider dari DB
            if (sMap.llm_provider) {
              const dbProv = sMap.llm_provider;
              const savedKey = _ls("llmApiKey_" + dbProv, "") || _ls("llmApiKey", "");
              if (savedKey) setLlmApiKey(savedKey);
            }
          }
        } catch { /* muat setting opsional — abaikan */ }

        // Load Teknisi dari Supabase — fallback ke TEKNISI_DATA jika kosong/error
        try {
          const tekRes = await fetchUserProfiles(supabase);
          if (!tekRes.error && tekRes.data && tekRes.data.length > 0) {
            const tekList = tekRes.data.filter(u => {
              const r = (u.role || "").toLowerCase();
              return r === "teknisi" || r === "helper";
            });
            if (tekList.length > 0) {
              const normalized = tekList.map(u => ({
                ...u,
                role: (u.role || "").charAt(0).toUpperCase() + (u.role || "").slice(1).toLowerCase(),
                skills: u.skills || [],
                jobs_today: 0, // dihitung dari ordersData saat render
                status: u.status || "active",
              }));
              setTeknisiData(normalized);
            }
            // Jika tidak ada Teknisi/Helper di DB → tetap pakai TEKNISI_DATA default (sudah di useState awal)
          }
        } catch (e) { console.warn("Load teknisi failed:", e); }

        // Load semua user → userAccounts (untuk panel manage user)
        try {
          const uaRes = await fetchUserAccounts(supabase);
          if (!uaRes.error && uaRes.data && uaRes.data.length > 0) {
            const roleColors = { owner: "#f59e0b", admin: "#38bdf8", finance: "#10b981", teknisi: "#22c55e", helper: "#a78bfa" };
            const normalized = uaRes.data.map(u => ({
              ...u,
              role: (u.role || "").charAt(0).toUpperCase() + (u.role || "").slice(1).toLowerCase(),
              color: u.color || roleColors[(u.role || "").toLowerCase()] || "#94a3b8",
              avatar: u.avatar || (u.name || "").charAt(0).toUpperCase(),
              active: u.active !== false,
              lastLogin: u.last_login
                ? new Date(u.last_login).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "-",
            }));
            setUserAccounts(normalized);
          }
        } catch (e) { console.warn("Load userAccounts failed:", e); }

        // Load WA conversations dari Supabase (tabel opsional)
        try {
          const waRes = await fetchWaConversations(supabase, 100);
          if (!waRes.error && waRes.data && waRes.data.length > 0) setWaConversations(waRes.data);
        } catch (e) { /* WA tabel belum ada - skip */ }

        // ── GAP-03 FIX + PriceList state: Load price_list dari DB ──
        try {
          const plRes = await fetchPriceList(supabase);
          if (!plRes.error && plRes.data && plRes.data.length > 0) {
            // Set state untuk renderPriceList UI
            setPriceListData(plRes.data);
            // Build PRICE_LIST map untuk kalkulasi invoice
            const activePL = plRes.data.filter(r => r.is_active !== false);
            PRICE_LIST = buildPriceListFromDB(activePL);
            setPriceListSyncedAt(new Date());
          }
        } catch (e) { console.warn("price_list DB fallback to default:", e?.message); }

        // ── BRAIN LOAD: Baca brain.md & brain_customer dari Supabase ara_brain ──
        try {
          const brainRes = await fetchAraBrain(supabase);
          if (!brainRes.error && brainRes.data && brainRes.data.length > 0) {
            const brainMap = Object.fromEntries(brainRes.data.map(r => [r.key, r.value]));
            // Load dari DB, TAPI skip jika v4.0 (use hardcoded v5.1 instead)
            if (brainMap.brain_md && typeof brainMap.brain_md === "string" && brainMap.brain_md.length > 10) {
              const isOldVersion = brainMap.brain_md.includes("v4.0");
              if (!isOldVersion) {
                setBrainMd(brainMap.brain_md);
                _lsSave("brainMd", brainMap.brain_md);
              }
            }
            if (brainMap.brain_customer && typeof brainMap.brain_customer === "string" && brainMap.brain_customer.length > 10) {
              setBrainMdCustomer(brainMap.brain_customer);
              _lsSave("brainMdCustomer", brainMap.brain_customer);
            }
          }
        } catch (e) { console.warn("ara_brain DB load failed, pakai localStorage:", e?.message); }

        // ── Load pending payment suggestions (HANYA Owner/Admin) ──
        if (["Owner","Admin"].includes(currentUser?.role)) {
          try {
            const { data: psData } = await supabase.from("payment_suggestions")
              .select("*").eq("status","PENDING").order("created_at",{ascending:false}).limit(20);
            if (psData?.length > 0) setPaymentSuggestions(psData);
          } catch(_) { /* tabel belum ada, skip */ }
        }
}
