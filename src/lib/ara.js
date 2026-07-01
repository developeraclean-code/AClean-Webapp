// sendToARA — handler chat ARA (AI agent): panggil LLM (Claude/OpenAI/Groq/Ollama/
// MiniMax) + parse [ACTION] + eksekusi mutasi (order/invoice/inventory/customer/
// expense). Diekstrak dari App.jsx (Fase 2, pola ctx stateful). SEMUA dependency
// (70) dioper lewat objek ctx → fungsi lepas dari closure App.jsx. Body verbatim
// KECUALI 1 bugfix: setMessages(...) -> setAraMessages(...) (setMessages tak pernah
// didefinisikan di App.jsx = ReferenceError laten pada cabang "Ollama URL invalid").
export async function sendToARA(userMsg, {
  BRAIN_MD_DEFAULT, PRICE_LIST, TODAY, _apiHeaders, addAgentLog, appSettings,
  approveInvoice, araBottomRef, araImageData, araImagePreview, araImageType,
  araLoading, araMessages, araSchedulingSuggest, auditUserName, brainMd,
  buildAraContext, bulanIni, cariSlotKosong, cekTeknisiAvailableDB,
  checkInvoiceConsistency, computeStockStatus, currentUser, customersData,
  describeInconsistency, dispatchWA, fetchInventory, findCustomer, fmt,
  getLocalDate, getLocalISOString, insertExpense, insertInvoice, insertOrder,
  invalidateCache, inventoryData, invoiceReminderWA, invoicesData, laporanReports,
  llmApiKey, llmModel, llmProvider, markPaid, normalizeLines, ollamaUrl,
  ordersData, paymentSuggestions, priceListData, safeArr, sameCustomer, sendWA,
  setAraImageData, setAraImagePreview, setAraImageType, setAraInput, setAraLoading,
  setAraMessages, setAuditUser, setCustomersData, setExpensesData, setInventoryData,
  setInvoicesData, setOrdersData, summarize, supabase, teknisiData, updateInvoice,
  updateOrder, updateOrderStatus, waConversations,
}) {
    if (!userMsg.trim() || araLoading) return;
    const newMessages = [...araMessages, { role: "user", content: userMsg }];
    setAraMessages(newMessages);
    setAraInput("");
    setAraLoading(true);
    // Clear image after sending
    const sentImagePreview = araImagePreview;
    setAraImageData(null); setAraImageType(null); setAraImagePreview(null);

    // bizContext (data bisnis live untuk ARA) — diekstrak ke lib/araContext.js (pure, read-only).
    const bizContext = buildAraContext({
      today: TODAY, bulanIni,
      ordersData, invoicesData, inventoryData, customersData, laporanReports,
      teknisiData, waConversations, paymentSuggestions, priceListData, PRICE_LIST,
      cariSlotKosong, araSchedulingSuggest,
    });

    try {
      let fullText = "";

      // ── Coba backend proxy dulu (API key aman di server) ──
      const backendRes = await fetch("/api/ara-chat", {
        method: "POST", headers: await _apiHeaders(),
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          bizContext, brainMd, provider: llmProvider, model: llmModel, ollamaUrl,
          ...(araImageData ? { imageData: araImageData, imageType: araImageType } : {})
        })
      }).catch(() => null);

      if (backendRes?.ok) {
        const d = await backendRes.json();
        fullText = d.reply || "";
        // Jika backendRes ok tapi reply kosong — tangkap error dari server
        if (!fullText && d.error) throw new Error(d.error);
        if (!fullText) throw new Error("ARA tidak memberikan respons. Cek Vercel logs: kemungkinan LLM_API_KEY belum diset di Vercel Environment Variables.");
      } else if (backendRes && !backendRes.ok) {
        // ara-chat.js error (400/500) — ambil pesan error dari body
        try {
          const errData = await backendRes.json();
          throw new Error(errData.error || "Server error " + backendRes.status);
        } catch (je) {
          throw new Error(je.message || "ara-chat server error " + backendRes.status);
        }
      } else if (!backendRes && llmProvider === "ollama") {
        // ── Ollama ONLY: Fallback jika /api/ara-chat tidak tersedia (localhost dev) ──
        // SECURITY NOTE: Direct API calls with keys are NOT supported anymore
        // Production: always use backend /api/ara-chat endpoint (keys are safe on server)
        // Development: use /api/ara-chat or local Ollama
        const sysP = (typeof brainMd === "string" ? brainMd : BRAIN_MD_DEFAULT) + `\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}\n\n## TOOL — ACTIONS TERSEDIA\nGunakan [ACTION]{...}[/ACTION] untuk eksekusi operasi. Format JSON:\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"labor","value":100000} (field: labor/material/discount/notes. Detail material ada di invoices[].materials_detail)\\n- {"type":"UPDATE_INVOICE","id":"INV-xxx","field":"material","value":200000} (ubah total material)\\n- {"type":"MARK_PAID","id":"INV-xxx"}\n- {"type":"APPROVE_INVOICE","id":"INV-xxx"}\n- {"type":"SEND_REMINDER","invoice_id":"INV-xxx"}\n- {"type":"UPDATE_ORDER_STATUS","id":"JOB-xxx","status":"COMPLETED"}\n- {"type":"DISPATCH_WA","order_id":"JOB-xxx"}\n- {"type":"SEND_WA","phone":"628xxx","message":"..."}\n- {"type":"UPDATE_STOCK","code":"MAT001","delta":5} (delta=tambah/kurang)\n- {"type":"CANCEL_ORDER","id":"JOB-xxx","reason":"..."}
- {"type":"CREATE_INVOICE","order_id":"ORD-xxx"}\n- {"type":"RESCHEDULE_ORDER","id":"JOB-xxx","date":"2026-03-10","time":"09:00","teknisi":"Mulyadi"}\nGunakan data teknisiWorkload.slotKosongHariIni dan jadwalHariIni untuk cek jadwal kosong. Area utama: Alam Sutera, BSD, Gading Serpong, Graha Raya, Karawaci, Tangerang Selatan. Jakarta Barat: perlu konfirmasi admin.\n- {"type":"MARK_INVOICE_OVERDUE"} (tandai semua yang lewat due date)\nHanya gunakan 1 ACTION per response. Konfirmasi ke user setelah eksekusi.`;

        if (llmProvider === "ollama") {
          // ── Ollama Local / ngrok ──
          // H-07: SSRF validation — block internal/cloud-metadata URLs
          const _isValidOllamaUrl = (url) => {
            try {
              const p = new URL(url);
              if (!["http:","https:"].includes(p.protocol)) return false;
              const h = p.hostname.toLowerCase();
              if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.|::1)/.test(h)) return false;
              if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return false;
              return true;
            } catch { return false; }
          };
          const baseUrl = (ollamaUrl || "").replace(/\/+$/, "");
          if (!baseUrl || !_isValidOllamaUrl(baseUrl)) {
            setAraMessages(prev => [...prev, { role: "assistant", content: "⚠️ Ollama URL tidak valid atau menggunakan alamat internal. Masukkan URL publik (contoh: https://xxxx.ngrok.io)." }]);
            setAraLoading(false);
            return;
          }
          const fr = await fetch(baseUrl + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: llmModel || "llama3",
              stream: false,
              messages: [
                { role: "system", content: sysP },
                ...newMessages.map(m => ({ role: m.role, content: m.content }))
              ]
            })
          });
          if (!fr.ok) {
            const txt = await fr.text().catch(() => "");
            throw new Error("Ollama error " + fr.status + (txt ? ": " + txt.slice(0, 100) : ""));
          }
          const fd = await fr.json();
          fullText = fd.message?.content || fd.response || "";
        } else {
          // ── SECURITY: No direct API calls from frontend ──
          // All LLM calls must go through /api/ara-chat backend endpoint
          // This ensures API keys are never exposed in browser
          throw new Error(`Provider "${llmProvider}" requires backend /api/ara-chat endpoint. Is your API server running?`);
        }
      } else {
        const needKey = llmProvider !== "ollama";
        const hasKey = llmProvider === "ollama" ? !!ollamaUrl : !!llmApiKey;
        if (!hasKey) throw new Error(llmProvider === "ollama"
          ? "URL Ollama belum diset. Buka Pengaturan → ARA Brain → masukkan URL Ollama."
          : "API Key belum diset. Buka Pengaturan → ARA Brain.");
        // fallthrough tidak akan terjadi karena sudah ada routing di atas
      }

      // ── Parse & eksekusi ACTION tags ──
      const am = fullText.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let ar = "";
      if (am) {
        try {
          const act = JSON.parse(am[1].trim());
          // H-06: Role check — aksi sensitif hanya Owner/Admin
          const ARA_SENSITIVE = ["UPDATE_INVOICE","MARK_PAID","APPROVE_INVOICE","CANCEL_ORDER","CREATE_EXPENSE","UPDATE_STOCK","MARK_INVOICE_OVERDUE"];
          const araCallerRole = currentUser?.role || "";
          if (ARA_SENSITIVE.includes(act.type) && !["Owner","Admin"].includes(araCallerRole)) {
            ar = `\n⚠️ *Aksi ${act.type} hanya bisa dilakukan Owner/Admin. Hubungi Owner untuk melanjutkan.*`;
            addAgentLog("ARA_BLOCKED", `ARA blocked ${act.type} — caller role: ${araCallerRole}`, "WARNING");
          } else
          if (act.type === "UPDATE_INVOICE") {
            setInvoicesData(prev => prev.map(i => { if (i.id !== act.id) return i; const u = { ...i, [act.field]: act.value }; u.total = (u.labor || 0) + (u.material || 0) - (u.discount || 0) - (u.trade_in ? (u.trade_in_amount || 0) : 0); return u; }));
            await setAuditUser();
            await updateInvoice(supabase, act.id, { [act.field]: act.value }, auditUserName());
            addAgentLog("ARA_ACTION", `ARA update ${act.id}: ${act.field}=${fmt(act.value)}`, "SUCCESS");
            ar = `\n✅ *Invoice ${act.id} diupdate — ${act.field}: ${fmt(act.value)}*`;
          } else if (act.type === "MARK_PAID") {
            markPaid(invoicesData.find(i => i.id === act.id) || { id: act.id, customer: "", total: 0 });
            ar = `\n✅ *Invoice ${act.id} ditandai LUNAS*\n💬 Notif WA ke customer akan diminta konfirmasi admin.`;
          } else if (act.type === "APPROVE_INVOICE") {
            approveInvoice(invoicesData.find(i => i.id === act.id) || { id: act.id, job_id: "", customer: "", total: 0 });
            ar = `\n✅ *Invoice ${act.id} diapprove*`;
          } else if (act.type === "SEND_REMINDER") {
            const inv = invoicesData.find(i => i.id === act.invoice_id);
            if (inv) { invoiceReminderWA(inv); ar = `\n✅ *Reminder dikirim ke ${inv.customer}*`; }
          } else if (act.type === "UPDATE_ORDER_STATUS") {
            setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, status: act.status } : o));
            await setAuditUser();
            await updateOrderStatus(supabase, act.id, act.status, auditUserName());
            addAgentLog("ARA_ACTION", `ARA update status ${act.id} → ${act.status}`, "SUCCESS");
            ar = `\n✅ *Order ${act.id} → ${act.status}*`;
          } else if (act.type === "DISPATCH_WA") {
            const orderD = ordersData.find(o => o.id === act.order_id);
            if (orderD) { await dispatchWA(orderD); ar = `\n✅ *Dispatch WA dikirim untuk ${act.order_id}*`; }
            else ar = `\n⚠️ *Order ${act.order_id} tidak ditemukan*`;
          } else if (act.type === "SEND_WA") {
            const sent = await sendWA(act.phone, act.message);
            addAgentLog("ARA_WA_SENT", `ARA kirim WA ke ${act.phone}`, sent ? "SUCCESS" : "WARNING");
            ar = `\n✅ *WA dikirim ke ${act.phone}*`;
          } else if (act.type === "UPDATE_STOCK") {
            const item = inventoryData.find(i => i.code === act.code || i.name.toLowerCase().includes((act.name || "").toLowerCase()));
            if (item) {
              const delta = act.delta || (act.stock != null ? act.stock - item.stock : 0);
              const txType = delta >= 0 ? "restock" : "usage";
              // GAP 1: lewat inventory_transactions → trigger DB update stock otomatis
              const { error: txErr } = await supabase.from("inventory_transactions").insert({
                inventory_code: item.code,
                inventory_name: item.name,
                qty: delta,
                type: txType,
                notes: `ARA ${txType}: ${act.reason || ""}`,
                created_by: currentUser?.id || null,
                created_by_name: currentUser?.name || "ARA",
              });
              if (txErr) {
                // Fallback: update langsung jika trigger belum jalan
                const newStock = Math.max(0, item.stock + delta);
                const ns = computeStockStatus(newStock, item.reorder);
                setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: newStock, status: ns } : i));
                await supabase.from("inventory").update({ stock: newStock, status: ns }).eq("code", item.code);
                ar = `\n✅ *Stok ${item.name} diupdate → ${newStock} ${item.unit}*`;
              } else {
                // Reload inventory dari DB setelah trigger update
                const { data: freshInv } = await fetchInventory(supabase);
                if (freshInv) setInventoryData(freshInv);
                const newStock = item.stock + delta;
                ar = `\n✅ *Stok ${item.name} ${delta >= 0 ? "ditambah +" + delta : "dikurangi " + delta} → ${newStock} ${item.unit}*`;
              }
              addAgentLog("ARA_STOCK", `ARA ${txType} ${item.name}: delta ${delta}`, "SUCCESS");
            } else ar = `\n⚠️ *Material tidak ditemukan*`;
          } else if (act.type === "CREATE_ORDER") {
            const today = getLocalDate();
            const seq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
            const newId = "ORD-" + (act.date || today).replace(/-/g, "").slice(2, 8) + "-" + seq;
            // Normalize service type — handle case insensitive + alias dari bahasa natural
            const _normSvc = (s) => {
              const sl = (s || "").toLowerCase().trim();
              if (sl.includes("install") || sl.includes("pasang") || sl.includes("baru")) return "Install";
              if (sl.includes("repair") || sl.includes("perbaikan") || sl.includes("servis")) return "Repair";
              if (sl.includes("complain") || sl.includes("komplain") || sl.includes("garansi") || sl.includes("complain")) return "Complain";
              if (sl.includes("bongkar")) return "Repair"; // bongkar = repair category
              return "Cleaning"; // default
            };
            const normService = _normSvc(act.service);
            const normTeknisi = act.teknisi
              ? (teknisiData.find(t => (t.role === "Teknisi" || t.role === "Helper") && t.name.toLowerCase() === (act.teknisi || "").toLowerCase())?.name || act.teknisi)
              : "";
            const newOrd = {
              id: newId,
              customer: act.customer || "?",
              phone: act.phone || "",
              address: act.address || "",
              service: normService,
              units: parseInt(act.units) || 1,
              teknisi: normTeknisi,
              helper: act.helper || "",
              date: act.date || today,
              time: act.time || "09:00",
              status: "PENDING",
              notes: act.notes || "",
              dispatch: false,
              created_at: new Date().toISOString(),
            };
            // ── Auto-enforce helper rule: 3+ unit ATAU Install untuk SEMUA service ──
            if ((parseInt(newOrd.units) || 1) >= 3 || newOrd.service === "Install") {
              if (!newOrd.helper) {
                const availHelper = teknisiData.find(t => t.role === "Helper" && t.active !== false);
                if (availHelper) { newOrd.helper = availHelper.name; }
                else addAgentLog("ARA_WARN", "Helper dibutuhkan tapi belum ada di database", "WARNING");
              }
            }
            setOrdersData(prev => prev.some(o => o.id === newOrd.id) ? prev : [...prev, newOrd]);
            const { error: oErr } = await insertOrder(supabase, newOrd);
            if (oErr) console.warn("Create order DB:", oErr.message);
            addAgentLog("ARA_CREATE_ORDER", "ARA buat order " + newId + " untuk " + newOrd.customer, "SUCCESS");

            // ── Auto-upsert customer + link customer_id ke order ──
            if (newOrd.phone && newOrd.customer) {
              const existingCust = findCustomer(customersData, newOrd.phone, newOrd.customer);
              if (!existingCust) {
                try {
                  const { data: savedCust } = await supabase.from("customers")
                    .upsert({ name: newOrd.customer.trim(), phone: newOrd.phone, address: newOrd.address || "", joined: newOrd.date, last_service: newOrd.date, is_vip: false, total_orders: 1 }, { onConflict: "phone" })
                    .select().single();
                  if (savedCust?.id) {
                    await supabase.from("orders").update({ customer_id: savedCust.id }).eq("id", newId);
                    setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: savedCust.id } : o));
                    setCustomersData(prev => [...prev, savedCust]);
                  }
                } catch (e) { console.warn("Customer upsert:", e?.message); }
                ar += "\n👤 *Customer baru ditambahkan: " + newOrd.customer + "*";
              } else {
                // Link customer_id + update total_orders
                if (existingCust.id && !newOrd.customer_id) {
                  await supabase.from("orders").update({ customer_id: existingCust.id }).eq("id", newId);
                  setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existingCust.id } : o));
                }
                setCustomersData(prev => prev.map(c =>
                  sameCustomer(c, newOrd.phone, newOrd.customer) ? { ...c, total_orders: (c.total_orders || 0) + 1, last_service: newOrd.date } : c
                ));
                try {
                  await supabase.from("customers").update({
                    total_orders: (existingCust.total_orders || 0) + 1, last_service: newOrd.date
                  }).eq("id", existingCust.id);
                } catch (e) { console.warn("Customer update skip:", e?.message); }
                ar += "\n👤 *Customer existing: " + newOrd.customer + " (order ke-" + ((existingCust.total_orders || 0) + 1) + ")*";
              }
            }

            ar = "\n✅ *Order " + newId + " dibuat untuk " + newOrd.customer + " — " + newOrd.service + " " + newOrd.units + " unit, " + newOrd.date + " jam " + newOrd.time + "*" + ar;
          } else if (act.type === "CREATE_INVOICE") {
            // Buat invoice dari order yang sudah COMPLETED
            const ord = ordersData.find(o => o.id === act.order_id);
            // Query DB langsung untuk cegah race (local state bisa stale saat ARA dispatch cepat).
            const { data: existingDBInv } = await supabase
              .from("invoices").select("id,status")
              .eq("job_id", act.order_id).neq("status", "CANCELLED").limit(1);
            if (!ord) { ar = "\n⚠️ *Order " + act.order_id + " tidak ditemukan*"; }
            else if (existingDBInv && existingDBInv.length > 0) {
              const existing = existingDBInv[0];
              ar = `\n⚠️ *Invoice untuk order ini sudah ada: ${existing.id}* (status: ${existing.status})`;
              addAgentLog("ARA_DUPLICATE_INVOICE", `Duplicate invoice attempt for order ${act.order_id} — existing: ${existing.id}`, "WARNING");
            }
            else {
              const today = getLocalDate();
              const seq2 = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
              const invId = "INV-" + today.replace(/-/g, "").slice(2, 8) + "-" + seq2;
              // Cek pekerjaan aktual + tipe AC dari laporan teknisi
              const lapRepForLabor = laporanReports.find(r => r.job_id === ord.id);
              const hasServiceBesar = lapRepForLabor?.units
                ? lapRepForLabor.units.some(u => (u.pekerjaan || []).some(p =>
                  p.toLowerCase().includes("besar") || p.toLowerCase().includes("deep")))
                : false;

              // ── BUILD EFFECTIVE TYPE untuk invoice ──
              // Priority: 1) Laporan tipe AC+PK detail, 2) Service besar detection, 3) Order type, 4) Default
              let effectiveType = "default";
              if (lapRepForLabor?.units && lapRepForLabor.units.length > 0) {
                // Build type dari tipe AC + PK di laporan (Step 1 detail)
                const typeList = lapRepForLabor.units
                  .filter(u => u.tipe && u.pk)
                  .map(u => `${u.tipe} ${u.pk}`)
                  .join(", ");
                if (typeList) effectiveType = typeList; // Contoh: "Cassette 5PK, Split 1PK"
              }

              // Jika service besar → gunakan harga service besar (override tipe jika ada)
              if (hasServiceBesar && ord.service === "Cleaning") {
                effectiveType = (ord.units || 1) > 1
                  ? "Jasa Service Besar 1,5PK - 2,5PK"
                  : "Jasa Service Besar 0,5PK - 1PK";
              }

              // Fallback ke order type jika laporan tidak ada
              if (effectiveType === "default" && ord.type) {
                effectiveType = ord.type;
              }

              const labor = PRICE_LIST[ord.service]?.[effectiveType] ??
                PRICE_LIST[ord.service]?.["default"] ?? 0;
              const laborTotal = labor * (ord.units || 1);

              // ── Baca material + freon dari laporan teknisi ──
              const lapRep = laporanReports.find(r => r.job_id === ord.id);
              const materialCost = lapRep?.materials
                ? lapRep.materials.reduce((sum, m) => {
                  // Lookup harga dari inventory (sama seperti hitungMaterialTotal)
                  const _mNama = (m.nama || "").toLowerCase();
                  const _invItem = inventoryData.find(inv =>
                    inv.name.toLowerCase().includes(_mNama) || _mNama.includes(inv.name.toLowerCase())
                  );
                  let harga = _invItem?.price || m.harga || m.price || 0;
                  // Fallback ke PRICE_LIST freon jika tidak ada di inventory
                  if (!harga) {
                    if (_mNama.includes("r-22") || _mNama.includes("r22")) harga = PRICE_LIST["freon_R22"] || 150000;
                    else if (_mNama.includes("r-32") || _mNama.includes("r32")) harga = PRICE_LIST["freon_R32"] || 450000;
                    else if (_mNama.includes("r-410") || _mNama.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
                  }
                  const qty = parseFloat(m.jumlah || m.qty || m.quantity || 1);
                  return sum + (harga * qty);
                }, 0)
                : 0;
              // [OPSI A] Freon tidak dihitung dari total_freon (psi data)
              const freonCost = 0; // freon masuk via material manual
              // Freon: hitung dari total_freon × harga freon (R32=200rb, R22=150rb default R32)

              const totalInv = laborTotal + materialCost;

              // Build line item ARA: 1 baris jasa (labor) + baris material dari laporan
              // (harga di-resolve dari inventory/PRICE_LIST seperti perhitungan materialCost),
              // lalu ringkasan diturunkan dari line item via summarize (single source of truth).
              const _resolveMatPrice = (m) => {
                const _mNama = (m.nama || "").toLowerCase();
                const _invItem = inventoryData.find(inv =>
                  inv.name.toLowerCase().includes(_mNama) || _mNama.includes(inv.name.toLowerCase()));
                let harga = parseFloat(m.harga_satuan) || _invItem?.price || m.harga || m.price || 0;
                if (!harga) {
                  if (_mNama.includes("r-22") || _mNama.includes("r22")) harga = PRICE_LIST["freon_R22"] || 150000;
                  else if (_mNama.includes("r-32") || _mNama.includes("r32")) harga = PRICE_LIST["freon_R32"] || 450000;
                  else if (_mNama.includes("r-410") || _mNama.includes("r410")) harga = PRICE_LIST["freon_R410A"] || 450000;
                }
                return harga;
              };
              const _araLines = (() => {
                const lines = [];
                if (laborTotal > 0) lines.push({
                  nama: ord.service + (ord.type ? " - " + ord.type : ""), jumlah: ord.units || 1, satuan: "unit",
                  harga_satuan: Math.round(laborTotal / (ord.units || 1)), subtotal: laborTotal, keterangan: "jasa",
                });
                const mats = (() => {
                  if (lapRep?.materials_json) { try { return JSON.parse(lapRep.materials_json); } catch { /* materials_json rusak → pakai default */ } }
                  return safeArr(lapRep?.materials);
                })().filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
                mats.forEach(m => {
                  const qty = parseFloat(m.jumlah) || 1;
                  const harga = _resolveMatPrice(m);
                  lines.push({ nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: harga, subtotal: harga * qty, keterangan: m.keterangan || "barang" });
                });
                return normalizeLines(lines);
              })();
              const _araSum = summarize(_araLines);
              const newInv = {
                id: invId, job_id: ord.id,
                customer: ord.customer, phone: ord.phone || "",
                service: ord.service + (ord.type ? " - " + ord.type : ""),
                units: ord.units || 1,
                labor: _araSum.labor,
                material: _araSum.material,
                materials_detail: _araLines.length > 0 ? JSON.stringify(_araLines) : null,
                discount: 0,
                trade_in: false,
                trade_in_amount: 0,
                total: _araSum.total,
                status: "PENDING",
                garansi_days: 30,
                garansi_expires: new Date(Date.now() + 30 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                laporan_id: lapRep?.id || null,
                due: new Date(Date.now() + 3 * 86400000 + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
                sent: false, created_at: getLocalISOString()
              };
              {
                const _chk = checkInvoiceConsistency({ ...newInv, lines: _araLines });
                if (!_chk.ok) addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInv.id) + " (ARA)", "WARNING");
              }
              invalidateCache("invoices", "orders");
              setInvoicesData(prev => prev.some(i => i.id === newInv.id) ? prev : [...prev, newInv]);
              const { error: invErr } = await insertInvoice(supabase, newInv);
              if (invErr) console.warn("Create invoice DB:", invErr.message);
              // Link invoice ke order
              setOrdersData(prev => prev.map(o => o.id === ord.id ? { ...o, invoice_id: invId } : o));
              await updateOrder(supabase, ord.id, { invoice_id: invId }, auditUserName());
              addAgentLog("ARA_CREATE_INVOICE", "ARA buat invoice " + invId + " dari " + ord.id + " — " + newInv.customer, "SUCCESS");
              ar = "\n✅ *Invoice " + invId + " dibuat untuk " + newInv.customer + " — Total: " + (newInv.total || 0).toLocaleString("id-ID") + "*";
            }
          } else if (act.type === "CANCEL_ORDER") {
            setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, status: "CANCELLED" } : o));
            await updateOrderStatus(supabase, act.id, "CANCELLED", auditUserName());
            addAgentLog("ARA_CANCEL", `ARA cancel order ${act.id}: ${act.reason || ""}`, "WARNING");
            ar = `\n✅ *Order ${act.id} dibatalkan*${act.reason ? " — " + act.reason : ""}`;
          } else if (act.type === "RESCHEDULE_ORDER") {
            const upd = { date: act.date, time: act.time || "09:00", ...(act.teknisi ? { teknisi: act.teknisi } : {}) };
            const rOrdCheck = ordersData.find(o => o.id === act.id);
            const tekForReschedule = act.teknisi || rOrdCheck?.teknisi;

            // ── Cek konflik di hari & jam baru sebelum reschedule ──
            let rescheduleConflict = null;
            if (tekForReschedule && act.date && act.time && rOrdCheck) {
              // GAP-1/2: Cek dari DB langsung, bukan state lokal
              const dbConflict = await cekTeknisiAvailableDB(tekForReschedule, act.date, act.time, rOrdCheck.service, rOrdCheck.units);
              if (!dbConflict.ok && !dbConflict.reason?.includes(act.id)) {
                rescheduleConflict = dbConflict.reason || "Ada order lain di waktu tersebut";
              }
            }

            if (rescheduleConflict) {
              // Ada konflik — jangan langsung reschedule, minta persetujuan
              ar = `\n⚠️ *Konflik Jadwal Reschedule!*\n\nTeknisi *${tekForReschedule}* sudah ada job di *${act.date} jam ${act.time}*:\n${typeof rescheduleConflict === "string" ? rescheduleConflict : "Ada order lain di waktu tersebut"}\n\n*Apakah tetap ingin reschedule?* (ketik: "ya, tetap reschedule ORD-xxx" atau pilih waktu lain)`;
            } else {
              setOrdersData(prev => prev.map(o => o.id === act.id ? { ...o, ...upd } : o));
              await updateOrder(supabase, act.id, upd, auditUserName());
              // Auto-kirim WA notifikasi reschedule ke teknisi
              const rOrd = ordersData.find(o => o.id === act.id);
              if (rOrd) {
                const tekData = teknisiData.find(t => t.name === (act.teknisi || rOrd.teknisi));
                // Notif customer
                if (rOrd.phone) {
                  const custMsg = `📅 *Info Perubahan Jadwal*

Yth. ${rOrd.customer},
Jadwal layanan AC Anda *${act.id}* telah diubah:
📅 Tanggal baru: *${act.date}*
⏰ Jam: ${act.time || "09:00"}
🔧 Layanan: ${rOrd.service}

Mohon pastikan ada di lokasi pada waktu tersebut.
Terima kasih — *${appSettings.app_name || "AClean"} Service* 😊`;
                  if (rOrd?.phone) sendWA(rOrd.phone, custMsg);
                }
                if (tekData?.phone) {
                  const rMsg = `📅 *Jadwal Diubah*

Halo ${tekData.name}, jadwal order *${act.id}* telah diubah:
👤 Customer: ${rOrd.customer}
📍 Alamat: ${rOrd.address || "-"}
🔧 Layanan: ${rOrd.service}
📅 Tanggal baru: ${act.date}
⏰ Jam: ${act.time || "09:00"}

Mohon sesuaikan jadwal Anda. Terima kasih!`;
                  sendWA(tekData.phone, rMsg);
                }
              }
              addAgentLog("ARA_RESCHEDULE", `ARA reschedule ${act.id} → ${act.date} ${act.time || "09:00"}`, "SUCCESS");
              ar = `\n✅ *Order ${act.id} dijadwal ulang → ${act.date} jam ${act.time || "09:00"}*`;
            } // end konflik check
          } else if (act.type === "MARK_INVOICE_OVERDUE") {
            setInvoicesData(prev => prev.map(i => i.status === "UNPAID" && i.due && i.due < TODAY ? { ...i, status: "OVERDUE" } : i));
            const cnt = invoicesData.filter(i => i.status === "UNPAID" && i.due && i.due < TODAY).length;
            await supabase.from("invoices").update({ status: "OVERDUE" }).eq("status", "UNPAID").lt("due", TODAY);
            ar = `\n✅ *${cnt} invoice ditandai OVERDUE*`;

          } else if (act.type === "CREATE_EXPENSE") {
            // ── ARA create pengeluaran/biaya ──
            const _expCat = (cat) => {
              const c = (cat || "").toLowerCase();
              if (c.includes("material") || c.includes("pipa") || c.includes("kabel") || c.includes("freon")) return "material_purchase";
              return "petty_cash";
            };
            const _expSub = (sub) => {
              const s = (sub || "").toLowerCase();
              if (s.includes("bensin") || s.includes("bbm") || s.includes("solar")) return "Bensin Motor";
              if (s.includes("parkir")) return "Parkir";
              if (s.includes("kasbon") || s.includes("pinjam") || s.includes("utang")) return "Kasbon Karyawan";
              if (s.includes("lembur") || s.includes("overtime")) return "Lembur";
              if (s.includes("bonus")) return "Bonus";
              if (s.includes("perbaikan motor") || s.includes("servis motor") || s.includes("motor")) return "Perbaikan Motor";
              if (s.includes("pipa")) return "Pipa AC";
              if (s.includes("kabel")) return "Kabel";
              if (s.includes("freon")) return "Freon";
              if (s.includes("material")) return "Material Lain";
              return sub || "Lain-lain";
            };
            const expPayload = {
              category: act.category ? _expCat(act.category) : _expCat(act.subcategory),
              subcategory: act.subcategory ? _expSub(act.subcategory) : (act.category || "Lain-lain"),
              amount: Number(act.amount) || 0,
              date: act.date || TODAY,
              description: act.description || act.keterangan || "",
              teknisi_name: (act.teknisi_name || act.nama_karyawan || "").trim() || null,
              item_name: act.item_name || act.nama_barang || null,
              freon_type: act.freon_type || null,
              created_by: currentUser?.name || "ARA",
              last_changed_by: auditUserName(),
            };
            if (!expPayload.amount) {
              ar = "\n⚠️ *Jumlah biaya (amount) wajib diisi*";
            } else {
              await setAuditUser();
              const { data: expData, error: expErr } = await insertExpense(supabase, expPayload);
              if (expErr) {
                ar = `\n⚠️ *Gagal catat biaya: ${expErr.message}*`;
              } else {
                invalidateCache("expenses");
                setExpensesData(prev => [expData || expPayload, ...prev]);
                addAgentLog("ARA_EXPENSE", `ARA create expense: ${expPayload.subcategory} — Rp${expPayload.amount.toLocaleString("id-ID")} (${expPayload.date})`, "SUCCESS");
                ar = `\n✅ *Biaya dicatat:*\n📂 ${expPayload.category === "material_purchase" ? "Pembelian Material" : "Petty Cash"} — ${expPayload.subcategory}\n💰 Rp${expPayload.amount.toLocaleString("id-ID")}\n📅 ${expPayload.date}${expPayload.description ? " — " + expPayload.description : ""}`;

                // ── AUTO-LINK: material_purchase → update stok inventory ──
                if (expPayload.category === "material_purchase") {
                  const matQty = (() => {
                    // Coba ekstrak qty dari item_name cth: "R32 2kg" → 2, "Pipa 10m" → 10
                    const raw = (act.item_name || act.nama_barang || "");
                    const m = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|m|roll|pcs|botol|unit|liter)/i);
                    return m ? parseFloat(m[1].replace(",", ".")) : 1;
                  })();
                  // Cari item inventory yang cocok
                  const _matchInv = (keyword) => inventoryData.find(i =>
                    i.name.toLowerCase().includes(keyword.toLowerCase()) ||
                    keyword.toLowerCase().includes(i.name.toLowerCase())
                  );
                  const matKeyword = act.item_name || act.freon_type
                    ? (act.freon_type ? "Freon " + act.freon_type : act.item_name)
                    : expPayload.subcategory;
                  const matchedItem = matKeyword ? _matchInv(matKeyword) : null;

                  if (matchedItem && matQty > 0) {
                    const newStock = matchedItem.stock + matQty;
                    const newStatus = computeStockStatus(newStock, matchedItem.reorder);
                    setInventoryData(prev => prev.map(i => i.code === matchedItem.code ? { ...i, stock: newStock, status: newStatus } : i));
                    await supabase.from("inventory_transactions").insert({
                      inventory_code: matchedItem.code,
                      inventory_name: matchedItem.name,
                      qty: matQty,
                      type: "restock",
                      notes: `Auto dari expense ARA: ${expPayload.subcategory} (${expPayload.date})`,
                      created_by: currentUser?.id || null,
                      created_by_name: currentUser?.name || "ARA",
                    }).then(() => {});
                    await supabase.from("inventory").update({ stock: newStock, updated_at: new Date().toISOString() }).eq("code", matchedItem.code).then(() => {});
                    addAgentLog("STOCK_AUTO_RESTOCK", `Auto restock ${matchedItem.name} +${matQty} ${matchedItem.unit} dari expense`, "SUCCESS");
                    ar += `\n📦 *Stok auto-update:* ${matchedItem.name} +${matQty} ${matchedItem.unit} → ${newStock} ${matchedItem.unit}`;
                  }
                }
              }
            }

          } else if (act.type === "BULK_CREATE_ORDER") {
            // ── ARA bulk create order dari dump teks ──
            const orders = Array.isArray(act.orders) ? act.orders : [];
            if (orders.length === 0) {
              ar = "\n⚠️ *BULK_CREATE_ORDER membutuhkan field `orders` berupa array*";
            } else if (orders.length > 20) {
              ar = "\n⚠️ *Maksimal 20 order sekaligus — pisah menjadi beberapa batch*";
            } else {
              const today = getLocalDate();
              const _normSvcBulk = (s) => {
                const sl = (s || "").toLowerCase().trim();
                if (sl.includes("install") || sl.includes("pasang") || sl.includes("baru")) return "Install";
                if (sl.includes("repair") || sl.includes("perbaikan") || sl.includes("servis") || sl.includes("bongkar")) return "Repair";
                if (sl.includes("complain") || sl.includes("komplain") || sl.includes("garansi")) return "Complain";
                return "Cleaning";
              };
              const results = [];
              for (const o of orders) {
                const seq2 = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
                const bId = "ORD-" + (o.date || today).replace(/-/g, "").slice(2, 8) + "-" + seq2;
                const bOrd = {
                  id: bId,
                  customer: o.customer || "?",
                  phone: o.phone || "",
                  address: o.address || "",
                  service: _normSvcBulk(o.service),
                  units: parseInt(o.units) || 1,
                  teknisi: o.teknisi || "",
                  helper: o.helper || "",
                  date: o.date || today,
                  time: o.time || "09:00",
                  status: "PENDING",
                  notes: o.notes || "",
                  dispatch: false,
                  created_at: new Date().toISOString(),
                };
                // Auto helper
                if ((bOrd.units >= 3 || bOrd.service === "Install") && !bOrd.helper) {
                  const avH = teknisiData.find(t => t.role === "Helper" && t.active !== false);
                  if (avH) bOrd.helper = avH.name;
                }
                setOrdersData(prev => prev.some(o => o.id === bOrd.id) ? prev : [...prev, bOrd]);
                const { error: bErr } = await insertOrder(supabase, bOrd);
                if (!bErr && bOrd.phone && bOrd.customer) {
                  const bCust = findCustomer(customersData, bOrd.phone, bOrd.customer);
                  if (bCust?.id) {
                    await supabase.from("orders").update({ customer_id: bCust.id }).eq("id", bId);
                  }
                }
                results.push({ id: bId, customer: bOrd.customer, service: bOrd.service, date: bOrd.date, ok: !bErr });
                // Small delay agar ID unik
                await new Promise(r => setTimeout(r, 60));
              }
              addAgentLog("ARA_BULK_ORDER", `ARA bulk create ${results.length} orders`, "SUCCESS");
              ar = `\n✅ *${results.length} order berhasil dibuat:*\n` +
                results.map((r, i) => `${i + 1}. \`${r.id}\` — ${r.customer} | ${r.service} | ${r.date} ${r.ok ? "✅" : "❌"}`).join("\n");
            }
          }
        } catch (e) { console.warn("Action parse", e); }
      }

      const clean = fullText.replace(/\[ACTION\].*?\[\/ACTION\]/s, "").trim() + ar;
      setAraMessages(prev => [...prev, { role: "assistant", content: clean }]);
      addAgentLog("ARA_CHAT", `ARA: "${userMsg.slice(0, 50)}..."`, "SUCCESS");
    } catch (err) {
      const msg = err.message.includes("Backend belum") ? "⚠️ " + err.message
        : err.message.includes("401") || err.message.includes("API key") ? "⚠️ API Key tidak valid. Buka Pengaturan → ARA Brain."
          : "⚠️ ARA gagal: " + err.message;
      setAraMessages(prev => [...prev, { role: "assistant", content: msg }]);
      addAgentLog("ARA_ERROR", err.message.slice(0, 80), "ERROR");
    } finally {
      setAraLoading(false);
      setTimeout(() => araBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
}
