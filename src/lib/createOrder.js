// createOrder — buat order baru (+ upsert customer, cek konflik teknisi, dispatch).
// Diekstrak dari App.jsx (Fase 2, pola ctx stateful). Semua dependency dioper lewat
// objek ctx → fungsi lepas dari closure App.jsx. Body verbatim (behavior-preserving).
// Return newId (atau null bila gagal).
export async function createOrder(form, {
  supabase, currentUser, showNotif, addAgentLog, auditUserName,
  setOrdersData, setCustomersData, customersData,
  insertOrder, updateOrderStatus, invalidateCache,
  findCustomer, sameCustomer, lookupCustomersByPhone, normalizePhone,
  cekTeknisiAvailableDB, hitungJamSelesai, sendDispatchWA,
  validateAddressLength, validateDate, validateNameLength,
  validatePhone, validatePositiveNumber, validateTime,
}) {
    // Input validation
    if (!validateNameLength(form.customer)) {
      showNotif("❌ Nama customer harus 2-100 karakter");
      return null;
    }
    if (!validatePhone(form.phone)) {
      showNotif("❌ Format nomor HP tidak valid");
      return null;
    }
    if (!validateAddressLength(form.address)) {
      showNotif("❌ Alamat harus 5-255 karakter");
      return null;
    }
    if (!form.date || !validateDate(form.date)) {
      showNotif("❌ Format tanggal tidak valid (gunakan YYYY-MM-DD)");
      return null;
    }
    if (!form.time || !validateTime(form.time)) {
      showNotif("❌ Format jam tidak valid (gunakan HH:MM)");
      return null;
    }
    if (!form.service || form.service.trim().length === 0) {
      showNotif("❌ Pilih jenis layanan");
      return null;
    }
    if (!validatePositiveNumber(form.units)) {
      showNotif("❌ Jumlah unit harus lebih dari 0");
      return null;
    }
    if (!form.teknisi || form.teknisi.trim().length === 0) {
      showNotif("❌ Pilih teknisi");
      return null;
    }

    // GAP-1&2: DB-level conflict check (real-time, anti race condition)
    if (form.teknisi && form.date && form.time) {
      const dbCheck = await cekTeknisiAvailableDB(form.teknisi, form.date, form.time, form.service, form.units);
      if (!dbCheck.ok) {
        showNotif("⚠️ " + (dbCheck.reason || form.teknisi + " tidak tersedia di jam tersebut"));
        return null;
      }
    }
    // Higher entropy order ID to prevent collisions on simultaneous submissions
    const newId = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const timeEnd = hitungJamSelesai(form.time || "09:00", form.service || "Cleaning", form.units || 1);

    // Gerbang atomik anti double-book dilakukan SETELAH order tersimpan (di bawah),
    // karena technician_schedule.order_id FK ke orders.id — klaim butuh order sudah ada.
    let slotClaimed = false;
    // Cek customer existing by phone ATAU name (untuk customer_id).
    // Fallback ke server kalau tidak ketemu di array client (mungkin di luar limit fetchCustomers).
    let preExistCust = findCustomer(customersData, form.phone, form.customer);
    if (!preExistCust && form.phone && normalizePhone(form.phone).length >= 8) {
      try {
        const { data: srvMatches } = await lookupCustomersByPhone(supabase, normalizePhone(form.phone));
        if (srvMatches && srvMatches.length) preExistCust = findCustomer(srvMatches, form.phone, form.customer);
      } catch (e) { /* lookup server opsional */ }
    }
    const newOrder = {
      id: newId,
      customer: form.customer, phone: normalizePhone(form.phone), address: form.address,
      customer_id: preExistCust?.id || null,
      service: form.service, type: form.type, units: parseInt(form.units) || 1,
      teknisi: form.teknisi, helper: form.helper || null,
      teknisi2: form.teknisi2 || null, helper2: form.helper2 || null,
      teknisi3: form.teknisi3 || null, helper3: form.helper3 || null,
      date: form.date, time: form.time, time_end: timeEnd, status: "CONFIRMED",
      team_slot: form.team_slot || null,
      invoice_id: null, dispatch: false, notes: form.notes || "",
      parent_job_id: form.parent_job_id || null,
      is_multi_day: form.is_multi_day || false,
      maintenance_client_id: form.maintenance_client_id || null,
      maintenance_unit_ids: Array.isArray(form.maintenance_unit_ids) ? form.maintenance_unit_ids : [],
    };

    // ── Fallback insert: coba full → minimal (BEFORE updating state) ──
    let orderSaved = false;

    // Attempt 1: full payload
    {
      const { error: e1 } = await insertOrder(supabase, newOrder);
      if (!e1) { orderSaved = true; }
      else console.warn("❌ A1 full:", e1.message, "| hint:", e1.hint, "| detail:", e1.details);
    }

    // Attempt 2: kolom aman saja
    if (!orderSaved) {
      const safe2 = {
        id: newOrder.id, date: newOrder.date, status: newOrder.status,
        service: newOrder.service, units: newOrder.units,
        customer: newOrder.customer, teknisi: newOrder.teknisi,
        helper: newOrder.helper, time: newOrder.time, time_end: newOrder.time_end,
        customer_id: newOrder.customer_id,
      };
      const { error: e2 } = await insertOrder(supabase, safe2);
      if (!e2) { orderSaved = true; }
      else console.warn("❌ A2 safe:", e2.message, "| hint:", e2.hint);
    }

    // Attempt 3: hanya id + date + service + units + status
    if (!orderSaved) {
      const minimal = {
        id: newOrder.id, date: newOrder.date,
        service: newOrder.service, units: newOrder.units, status: newOrder.status
      };
      const { error: e3 } = await insertOrder(supabase, minimal);
      if (!e3) { orderSaved = true; }
      else {
        console.error("❌ A3 minimal:", e3.message, "| hint:", e3.hint, "| detail:", e3.details);
        showNotif("❌ Gagal simpan order: " + e3.message + (e3.hint ? " — " + e3.hint : ""));
        return null;
      }
    }
    if (!orderSaved) return null;

    // ── GERBANG ATOMIK (anti double-book/TOCTOU) — setelah order ada di DB ──
    // RPC try_claim_teknisi_slot: advisory-lock per teknisi+tanggal → cek overlap+cap
    // lalu INSERT klaim ke technician_schedule, semua dalam 1 transaksi (migrasi 070).
    // Caller konkuren terserialisasi; yang kalah → order-nya dihapus lagi di sini.
    if (form.teknisi && form.date && form.time && timeEnd) {
      try {
        const { data: claimOk, error: claimErr } = await supabase.rpc("try_claim_teknisi_slot", {
          p_teknisi: form.teknisi, p_date: form.date, p_order_id: newId,
          p_start: form.time, p_end: timeEnd,
        });
        if (claimErr) {
          console.warn("try_claim_teknisi_slot error:", claimErr.message, "— fallback insert schedule biasa");
        } else if (claimOk === false) {
          // Kalah race / slot bentrok → buang order yang sudah terlanjur dibuat
          try { await supabase.from("orders").delete().eq("id", newId); } catch { /* rollback hapus order best-effort */ }
          showNotif("🚫 " + form.teknisi + " bentrok di jam tersebut (slot baru saja terisi)");
          return null;
        } else {
          slotClaimed = true;
        }
      } catch (e) { console.warn("claim slot catch:", e.message); }
    }

    // ── Only update state AFTER DB confirmation ──
    invalidateCache("orders");
    // Dedup: realtime bisa keburu menambah order ini sebelum baris ini jalan.
    setOrdersData(prev => prev.some(o => o.id === newOrder.id) ? prev : [...prev, newOrder]);

    // GAP 1.5: technician_schedule.
    // Jika slot sudah diklaim atomik via RPC (migrasi 070) → baris sudah ada, skip.
    // Insert manual hanya sebagai fallback kalau RPC error/tidak jalan (slotClaimed=false).
    if (!slotClaimed && form.teknisi && form.date && form.time && timeEnd) {
      try {
        const schedPayload = {
          order_id: newId,
          teknisi: form.teknisi,
          date: form.date,
          time_start: form.time || "09:00",
          time_end: timeEnd,
          status: "ACTIVE",
        };
        const { error: se } = await supabase.from("technician_schedule").insert(schedPayload);
        if (se) console.error("technician_schedule 400:", se.message, "|", se.hint, "|", se.details, "| payload:", JSON.stringify(schedPayload));
      } catch (e) { /* technician_schedule opsional */ }
    }

    addAgentLog("ORDER_CREATED", `Order baru ${newId} — ${form.customer} (${form.service} ${form.units} unit)`, "SUCCESS");

    // ── AUTO-DISPATCH: Owner/Admin buat order → langsung dispatch ke teknisi ──
    // Teknisi tidak perlu menunggu tombol dispatch manual
    if (form.teknisi && (currentUser?.role === "Owner" || currentUser?.role === "Admin")) {
      // Update status ke DISPATCHED dulu
      setOrdersData(prev => prev.map(o =>
        o.id === newId ? { ...o, status: "DISPATCHED", dispatch: true, dispatch_at: new Date().toISOString() } : o
      ));
      await updateOrderStatus(supabase, newId, "DISPATCHED", auditUserName(), {
        dispatch: true, dispatch_at: new Date().toISOString()
      });

      // Kirim WA ke teknisi (dan helper jika ada) + customer
      await sendDispatchWA(newOrder);
      showNotif(`✅ Order ${newId} dibuat & WA dispatch dikirim ke ${form.teknisi}!`);
      addAgentLog("AUTO_DISPATCH", `Auto-dispatch ${newId} → ${form.teknisi}`, "SUCCESS");
    } else {
      showNotif(`✅ Order ${newId} berhasil dibuat!`);
    }

    // (komentar lama dihapus)

    // ── AUTO-SAVE CUSTOMER: tambah/update customer saat order dibuat ──
    if (form.phone && form.customer) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const orderDate = form.date || todayStr;
      // Reuse hasil lookup di atas (sudah termasuk fallback server) agar tidak miss customer di luar limit
      const existing = preExistCust || findCustomer(customersData, form.phone, form.customer);

      if (!existing) {
        // ── Customer BARU ──
        if (!form.phone || form.phone.trim().length < 5) {
          // Phone kosong — skip insert, hanya log
          addAgentLog("CUSTOMER_SKIP", "Customer " + form.customer + " tidak disimpan: no HP kosong", "WARNING");
        } else {
          const insertPayload = {
            name: form.customer.trim(),
            phone: normalizePhone(form.phone),
            address: (form.address || "").trim(),
            area: (form.area || "").trim(),
            notes: "",
            is_vip: false,
            total_orders: 1,
            joined_date: orderDate,
            last_service: orderDate,
          };
          const { data: savedCust, error: custErr } = await supabase
            .from("customers")
            .insert(insertPayload)
            .select()
            .single();

          if (custErr) {
            // Fallback: phone sudah ada di DB tapi belum di state lokal — fetch & link saja, jangan override nama/alamat
            const { data: existingInDB } = await supabase
              .from("customers")
              .select("id,name,phone,address,area,total_orders,last_service")
              .eq("phone", normalizePhone(form.phone))
              .maybeSingle();
            if (existingInDB) {
              // Customer sudah ada — hanya update stats, jangan override nama/alamat
              const updatedOrders = (existingInDB.total_orders || 0) + 1;
              await supabase.from("customers")
                .update({ total_orders: updatedOrders, last_service: orderDate })
                .eq("id", existingInDB.id);
              await supabase.from("orders").update({ customer_id: existingInDB.id }).eq("id", newId);
              setCustomersData(prev => {
                const alreadyIn = prev.find(c => c.id === existingInDB.id);
                if (alreadyIn) return prev.map(c => c.id === existingInDB.id ? { ...c, total_orders: updatedOrders, last_service: orderDate } : c);
                return [...prev, { ...existingInDB, total_orders: updatedOrders, last_service: orderDate }];
              });
              setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existingInDB.id } : o));
              addAgentLog("CUSTOMER_LINKED", "Customer existing (beda lokasi): " + existingInDB.name + " (" + form.phone + ")", "SUCCESS");
            } else {
              addAgentLog("CUSTOMER_SAVE_ERROR",
                "Gagal simpan customer " + form.customer + ": " + custErr.message, "ERROR");
              showNotif("⚠️ Customer gagal ke DB: " + custErr.message + " — tambah manual di menu Customer");
              setCustomersData(prev => [...prev, { ...insertPayload, id: "CUST_LOCAL_" + Date.now() }]);
            }
          } else {
            const c1 = savedCust || { ...insertPayload, id: "CUST_" + Date.now() };
            setCustomersData(prev => [...prev, c1]);
            if (c1.id && !c1.id.startsWith("CUST_")) {
              await supabase.from("orders").update({ customer_id: c1.id }).eq("id", newId);
              setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: c1.id } : o));
            }
            addAgentLog("CUSTOMER_AUTO_ADDED", "Customer baru: " + form.customer + " (" + form.phone + ")", "SUCCESS");
            showNotif("✅ Order + Customer baru " + form.customer + " tersimpan ke database!");
          }
        }
      } else {
        // ── Customer EXISTING: update total_orders & last_service + pastikan order ter-link ──
        const updatedOrders = (existing.total_orders || 0) + 1;
        setCustomersData(prev => prev.map(c =>
          sameCustomer(c, form.phone, form.customer)
            ? { ...c, total_orders: updatedOrders, last_service: orderDate }
            : c
        ));
        // Pastikan order ter-link ke customer_id (kalau sebelumnya null karena race condition)
        if (existing.id && !newOrder.customer_id) {
          await supabase.from("orders").update({ customer_id: existing.id }).eq("id", newId);
          setOrdersData(prev => prev.map(o => o.id === newId ? { ...o, customer_id: existing.id } : o));
        }
        try {
          await supabase.from("customers")
            .update({ total_orders: updatedOrders, last_service: orderDate })
            .eq("id", existing.id);
        } catch (e) {
          addAgentLog("CUSTOMER_UPDATE_WARN", "Gagal update total_orders: " + (e?.message || ""), "WARNING");
        }
      }
    }
    return newId;
}
