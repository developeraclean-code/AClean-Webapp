// syncTrackedStock — sinkron pemakaian material tabung-spesifik (freon/pipa) ke stok
// per-tabung (inventory_units) + master (inventory). Diekstrak dari App.jsx (Fase 3, pola ctx).
//
// MODEL (fix migrasi 116): stok master = STORED, diubah INCREMENTAL oleh trigger DB:
//   - INSERT tx  → trigger potong stok (stock + qty, qty negatif utk usage)
//   - DELETE tx  → trigger balikin stok (stock - OLD.qty)
// Jadi di sini TIDAK ada lagi recalc absolut (dulu `stock = max(0, sum semua tx)` yang
// meng-WIPE base stok seed yang tak tercatat sebagai transaksi). Master cukup andalkan trigger.
// Tabung (inventory_units) TIDAK punya trigger → dihitung incremental di kode.
export async function syncTrackedStock(reportId, orderId, newMaterials, customerName, teknisiName, jobDate, {
  addAgentLog, currentUser, invUnitsData, inventoryData,
  isTrackedByCode, isTrackedByName, setInvUnitsData, setInventoryData, supabase,
} = {}) {
    // 1. Ambil transaksi usage tracked LAMA utk laporan ini (sebelum dihapus).
    const { data: oldTxs } = await supabase
      .from("inventory_transactions")
      .select("id, inventory_code, inventory_name, qty, unit_id")
      .eq("report_id", reportId)
      .eq("type", "usage");

    const oldTracked = (oldTxs || []).filter(tx =>
      isTrackedByCode(tx.inventory_code) || isTrackedByName(tx.inventory_name)
    );

    // Akumulasi qty lama per tabung (utk restore incremental — tabung tak punya trigger).
    const oldUnitSum = {}; // unitId -> sum(qty) (negatif)
    for (const tx of oldTracked) {
      if (tx.unit_id) oldUnitSum[tx.unit_id] = (oldUnitSum[tx.unit_id] || 0) + (tx.qty || 0);
    }

    const affectedCodes = new Set(oldTracked.map(tx => tx.inventory_code).filter(Boolean));

    // 2. Hapus transaksi tracked lama → trigger DELETE otomatis BALIKIN stok master.
    if (oldTracked.length > 0) {
      await supabase.from("inventory_transactions").delete().in("id", oldTracked.map(tx => tx.id));
    }

    // 3. Material baru yang tracked.
    const newTracked = (newMaterials || []).filter(m =>
      parseFloat(m.jumlah) > 0 && (isTrackedByCode(m.inv_code || m._useCode) || isTrackedByName(m.nama))
    );

    const newUnitSum = {}; // unitId -> sum(qty) (negatif)

    // 4. Insert transaksi usage baru → trigger INSERT otomatis POTONG stok master.
    for (const m of newTracked) {
      const qty = parseFloat(m.jumlah) || 0;
      const invCode = m.inv_code || m._useCode || null;
      const unitId = m.freon_tabung_code || m._unitId || null;
      const unitLabel = m.freon_unit_label || m._unitLabel || null;
      const invItem = invCode
        ? inventoryData.find(i => i.code === invCode)
        : inventoryData.find(i => i.name.toLowerCase().includes((m.nama || "").toLowerCase()));
      const finalCode = invCode || invItem?.code || null;
      const isFreon = (invItem?.material_type === "freon") || isTrackedByName(m.nama);
      if (finalCode) affectedCodes.add(finalCode);
      if (unitId) newUnitSum[unitId] = (newUnitSum[unitId] || 0) + (-qty);
      try {
        await supabase.from("inventory_transactions").insert({
          inventory_code: finalCode,
          inventory_name: invItem?.name || m.nama || null,
          order_id: orderId || null,
          report_id: reportId || null,
          qty: -qty,
          qty_actual: isFreon ? null : -qty,
          type: "usage",
          notes: `Laporan ${reportId} oleh ${currentUser?.name || "sistem"}`,
          customer_name: customerName || null,
          teknisi_name: (teknisiName || "").trim() || null,
          job_date: jobDate || null,
          created_by: currentUser?.id || null,
          created_by_name: currentUser?.name || "",
          unit_id: unitId || null,
          unit_label: unitLabel || null,
        });
      } catch (e) { console.warn("syncTrackedStock insert skip:", e?.message); }
    }

    // 5. Stok per tabung (inventory_units) — incremental di kode (tak ada trigger).
    //    delta = restore pemakaian lama (-oldSum) + terapkan pemakaian baru (+newSum, negatif).
    const affectedUnitIds = new Set([...Object.keys(oldUnitSum), ...Object.keys(newUnitSum)]);
    for (const unitId of affectedUnitIds) {
      const unit = invUnitsData.find(u => u.id === unitId);
      if (!unit) continue;
      const delta = -(oldUnitSum[unitId] || 0) + (newUnitSum[unitId] || 0);
      if (delta === 0) continue;
      const ns = Math.max(0, Number(unit.stock || 0) + delta);
      await supabase.from("inventory_units").update({ stock: ns, updated_at: new Date().toISOString() }).eq("id", unitId);
      setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, stock: ns } : u));
    }

    // 6. Sinkronkan state lokal master dari DB (trigger INSERT/DELETE sudah final di DB).
    if (affectedCodes.size > 0) {
      const { data: freshInv } = await supabase.from("inventory").select("code, stock, status").in("code", [...affectedCodes]);
      if (freshInv) {
        const map = Object.fromEntries(freshInv.map(r => [r.code, r]));
        setInventoryData(prev => prev.map(i => map[i.code] ? { ...i, stock: map[i.code].stock, status: map[i.code].status } : i));
      }
    }

    addAgentLog("INV_SYNC", `Stok tracked disync laporan ${reportId} — ${newTracked.length} item (incremental), editor: ${currentUser?.name}`, "INFO");
}
