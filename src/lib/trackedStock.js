// syncTrackedStock — sinkron pemakaian material tabung-spesifik (freon dll) ke stok
// per-unit + inventori. Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function syncTrackedStock(reportId, orderId, newMaterials, customerName, teknisiName, jobDate, {
  addAgentLog, computeStockStatus, currentUser, invUnitsData, inventoryData,
  isTrackedByCode, isTrackedByName, setInvUnitsData, setInventoryData, supabase,
} = {}) {
    // 1. Hapus semua transaksi usage tracked lama untuk laporan ini
    const { data: oldTxs } = await supabase
      .from("inventory_transactions")
      .select("id, inventory_code, inventory_name, qty, unit_id")
      .eq("report_id", reportId)
      .eq("type", "usage");

    const oldTracked = (oldTxs || []).filter(tx =>
      isTrackedByCode(tx.inventory_code) || isTrackedByName(tx.inventory_name)
    );

    if (oldTracked.length > 0) {
      await supabase
        .from("inventory_transactions")
        .delete()
        .in("id", oldTracked.map(tx => tx.id));
    }

    // 2. Filter material baru yang tracked
    const newTracked = (newMaterials || []).filter(m =>
      parseFloat(m.jumlah) > 0 && (isTrackedByCode(m.inv_code || m._useCode) || isTrackedByName(m.nama))
    );

    // 3. Insert transaksi usage baru untuk setiap tracked material
    for (const m of newTracked) {
      const qty = parseFloat(m.jumlah) || 0;
      const invCode = m.inv_code || m._useCode || null;
      const unitId = m.freon_tabung_code || m._unitId || null;
      const unitLabel = m.freon_unit_label || m._unitLabel || null;
      const invItem = invCode
        ? inventoryData.find(i => i.code === invCode)
        : inventoryData.find(i => i.name.toLowerCase().includes((m.nama || "").toLowerCase()));
      const isFreon = (invItem?.material_type === "freon") || isTrackedByName(m.nama);
      try {
        await supabase.from("inventory_transactions").insert({
          inventory_code: invCode || invItem?.code || null,
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

    // 4. Recalculate inventory_units.stock dari semua transaksi di DB (bukan dari state lokal)
    // Kumpulkan semua unit_id yang terdampak (lama + baru)
    const affectedUnitIds = new Set([
      ...oldTracked.map(tx => tx.unit_id).filter(Boolean),
      ...newTracked.map(m => m.freon_tabung_code || m._unitId).filter(Boolean),
    ]);

    for (const unitId of affectedUnitIds) {
      const unit = invUnitsData.find(u => u.id === unitId);
      if (!unit) continue;
      // Query total usage untuk unit ini dari seluruh transaksi di DB
      const { data: allUnitTxs } = await supabase
        .from("inventory_transactions")
        .select("qty")
        .eq("unit_id", unitId)
        .eq("type", "usage");
      const totalUsed = (allUnitTxs || []).reduce((s, tx) => s + Math.abs(tx.qty), 0);
      const recalcStock = Math.max(0, (unit.capacity || unit.stock + totalUsed) - totalUsed);
      await supabase.from("inventory_units").update({ stock: recalcStock, updated_at: new Date().toISOString() }).eq("id", unitId);
      setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, stock: recalcStock } : u));
    }

    // 5. Recalculate inventory master stock dari semua transaksi di DB
    const affectedInvCodes = new Set([
      ...oldTracked.map(tx => tx.inventory_code).filter(Boolean),
      ...newTracked.map(m => m.inv_code || m._useCode).filter(Boolean),
    ]);

    for (const invCode of affectedInvCodes) {
      const { data: allInvTxs } = await supabase
        .from("inventory_transactions")
        .select("qty, type")
        .eq("inventory_code", invCode);
      if (!allInvTxs) continue;
      // Stok = restock - usage (semua jenis transaksi)
      const netQty = (allInvTxs || []).reduce((s, tx) => s + (tx.qty || 0), 0);
      const invItem = inventoryData.find(i => i.code === invCode);
      if (!invItem) continue;
      const recalcStock = Math.max(0, netQty);
      const newStatus = computeStockStatus(recalcStock, invItem.reorder);
      await supabase.from("inventory").update({ stock: recalcStock, status: newStatus }).eq("code", invCode);
      setInventoryData(prev => prev.map(i => i.code === invCode ? { ...i, stock: recalcStock, status: newStatus } : i));
    }

    addAgentLog("INV_SYNC", `Stok tracked disync laporan ${reportId} — ${newTracked.length} item, editor: ${currentUser?.name}`, "INFO");
}
