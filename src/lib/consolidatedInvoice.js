// createConsolidatedInvoice — gabung beberapa invoice UNPAID milik 1 customer
// jadi 1 invoice konsolidasi. Diekstrak dari App.jsx (Fase 2, KALIBRASI pola ctx
// untuk fungsi stateful). Semua dependency (supabase, state setter, helper) dioper
// lewat objek ctx → fungsi lepas dari closure App.jsx. Body verbatim (behavior sama).
export async function createConsolidatedInvoice(invList, {
  supabase, currentUser, showNotif, addAgentLog, setInvoicesData,
  getLocalDate, samePhone, normalizeLines, summarize,
  checkInvoiceConsistency, describeInconsistency,
}) {
    if (!Array.isArray(invList) || invList.length < 2) {
      showNotif("⚠️ Pilih minimal 2 invoice"); return { ok: false };
    }
    const allSamePhone = invList.every(i => samePhone(i.phone, invList[0].phone));
    if (!allSamePhone) { showNotif("⚠️ Semua invoice harus dari customer yang sama"); return { ok: false }; }

    const sorted = [...invList].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const first = sorted[0];
    const sourceIds = sorted.map(i => i.id).join(", ");

    // Gabungkan materials_detail dari semua invoice. Sumber tanpa line item (legacy)
    // disintesis dari field labor/material agar nilainya tidak hilang saat merge.
    const mergedMaterials = normalizeLines(sorted.flatMap(inv => {
      let md = inv.materials_detail;
      if (typeof md === "string") { try { md = JSON.parse(md); } catch { md = null; } }
      if (Array.isArray(md) && md.length > 0) return md;
      const synth = [];
      if (Number(inv.labor) > 0) synth.push({ nama: inv.service || "Jasa", jumlah: 1, satuan: "unit", harga_satuan: Number(inv.labor), subtotal: Number(inv.labor), keterangan: "jasa" });
      if (Number(inv.material) > 0) synth.push({ nama: "Material", jumlah: 1, satuan: "unit", harga_satuan: Number(inv.material), subtotal: Number(inv.material), keterangan: "barang" });
      return synth;
    }));

    // Ringkasan diturunkan dari line item gabungan (single source of truth via summarize).
    const totalDiscount = sorted.reduce((s, i) => s + (Number(i.discount) || 0), 0);
    const _mergedSum    = summarize(mergedMaterials, { discount: totalDiscount });
    const totalLabor    = _mergedSum.labor;
    const totalMaterial = _mergedSum.material;
    const grandTotal    = _mergedSum.total;
    const dueDates      = sorted.map(i => i.due).filter(Boolean);
    const dueLatest     = dueDates.length ? dueDates.sort((a, b) => new Date(b) - new Date(a))[0] : null;
    const serviceNames  = [...new Set(sorted.map(i => i.service).filter(Boolean))].join(" + ");
    const unitTotal     = sorted.reduce((s, i) => {
      const u = Array.isArray(i.units) ? i.units.length : (Number(i.units) || 1);
      return s + u;
    }, 0);

    // Generate invoice ID — kolom id tabel invoices tidak punya default (format: INV-YYYYMMDD-XXXXX)
    const todayStr = getLocalDate();
    const invSeq = Date.now().toString(36).slice(-3).toUpperCase() + Math.random().toString(36).slice(-2).toUpperCase();
    const newId = "INV-" + todayStr.replace(/-/g, "").slice(0, 8) + "-" + invSeq;

    const newInv = {
      id:              newId,
      customer:        first.customer,
      phone:           first.phone,
      service:         `Invoice Gabungan (${sorted.length} pekerjaan)`,
      job_id:          null,
      units:           unitTotal,
      labor:           totalLabor,
      material:        totalMaterial,
      discount:        totalDiscount,
      total:           grandTotal,
      status:          "UNPAID",
      due:             dueLatest,
      teknisi:         first.teknisi || null,
      materials_detail: mergedMaterials.length > 0 ? JSON.stringify(mergedMaterials) : null,
      sent:            false,
      created_at:      new Date().toISOString(),
    };

    // Guard invarian (observasional)
    {
      const _chk = checkInvoiceConsistency({ ...newInv, lines: mergedMaterials });
      if (!_chk.ok) addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, newInv.id) + " (gabungan)", "WARNING");
    }

    const { data: created, error } = await supabase.from("invoices").insert([newInv]).select().single();
    if (error || !created) {
      showNotif("⚠️ Gagal buat invoice gabungan: " + (error?.message || "unknown"));
      return { ok: false };
    }

    // Tandai invoice sumber sebagai CANCELLED dengan keterangan
    for (const inv of sorted) {
      await supabase.from("invoices").update({
        status: "CANCELLED",
        service: (inv.service || "Servis AC") + ` [Digabung ke ${created.id}]`,
      }).eq("id", inv.id);
    }

    // Update state lokal — dedup created.id supaya tidak dobel di UI kalau subscription
    // realtime INSERT sudah menambah invoice gabungan duluan (race optimistic vs realtime).
    setInvoicesData(prev => {
      const updated = prev
        .filter(i => i.id !== created.id)
        .map(i =>
          sorted.some(s => s.id === i.id)
            ? { ...i, status: "CANCELLED", service: i.service + ` [Digabung ke ${created.id}]` }
            : i
        );
      return [created, ...updated];
    });

    addAgentLog("INVOICE_CONSOLIDATED",
      `${sorted.length} invoice digabung jadi ${created.id} oleh ${currentUser?.name || "—"}: ${sourceIds}`,
      "SUCCESS"
    );
    showNotif(`✅ Invoice gabungan ${created.id} berhasil dibuat — ${sorted.length} invoice sumber di-cancelled`);
    return { ok: true, newInvoice: created };
}
