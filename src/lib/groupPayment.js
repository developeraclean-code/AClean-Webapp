// handleGroupPayment — bayar sekaligus beberapa invoice 1 customer (alokasi greedy
// ke invoice terlama, tandai lunas). Diekstrak dari App.jsx (Fase 2, pola ctx).
// ctx = param terakhir. Body verbatim (behavior-preserving).
export async function handleGroupPayment(customerPhone, invoiceIds, totalReceived, proofUrl, method, {
  addAgentLog, auditUserName, fmt, getLocalISOString, invoicesData, markInvoicePaid,
  ordersData, setAuditUser, setInvoicesData, setOrdersData, showNotif, supabase,
} = {}) {
    const targetInvoices = invoicesData.filter(i => invoiceIds.includes(i.id));
    if (!targetInvoices.length) { showNotif("❌ Tidak ada invoice yang dipilih"); return; }
    // Untuk PARTIAL_PAID, tagihan efektif adalah remaining_amount (bukan total)
    const effectiveTagihan = (inv) => inv.status === "PARTIAL_PAID"
      ? (inv.remaining_amount ?? ((inv.total || 0) - (inv.paid_amount || 0)))
      : (inv.total || 0);
    const totalTagihan = targetInvoices.reduce((s, i) => s + effectiveTagihan(i), 0);

    // Block over-payment signifikan (toleransi Rp 1.000 untuk pembulatan)
    if (totalReceived > totalTagihan + 1000) {
      showNotif(`❌ Jumlah bayar (${fmt(totalReceived)}) melebihi total tagihan (${fmt(totalTagihan)}). Cek kembali.`);
      return;
    }

    // Greedy alokasi: invoice terlama dulu, pakai effective tagihan
    const sorted = [...targetInvoices].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let sisa = totalReceived;
    const allocation = {};
    const fullyPaid = [];
    const partialPaid = [];
    for (const inv of sorted) {
      if (sisa <= 0) break;
      const tagihan = effectiveTagihan(inv);
      if (sisa >= tagihan) {
        allocation[inv.id] = tagihan;
        fullyPaid.push(inv);
        sisa -= tagihan;
      } else {
        allocation[inv.id] = sisa;
        partialPaid.push({ ...inv, _paid_amount: (inv.paid_amount || 0) + sisa });
        sisa = 0;
      }
    }

    const paidAt = getLocalISOString();
    await setAuditUser();

    // Optimistic UI
    setInvoicesData(prev => prev.map(i => {
      if (fullyPaid.find(f => f.id === i.id)) return { ...i, status: "PAID", paid_at: paidAt, payment_proof_url: proofUrl || i.payment_proof_url };
      const p = partialPaid.find(f => f.id === i.id);
      if (p) return { ...i, status: "PARTIAL_PAID", paid_amount: p._paid_amount, remaining_amount: (i.total || 0) - p._paid_amount, payment_proof_url: proofUrl || i.payment_proof_url };
      return i;
    }));

    // Simpan 1 record payment untuk 1 transfer
    let paymentId = null;
    {
      const { data: paymentRow, error: gpErr } = await supabase.from("payments").insert({
        customer_phone: customerPhone,
        customer_name: sorted[0]?.customer,
        total_amount: totalReceived,
        amount: totalReceived,
        method,
        is_partial: totalReceived < totalTagihan,
        invoice_ids: invoiceIds,
        allocation_detail: allocation,
        payment_proof_url: proofUrl || null,
        paid_at: paidAt,
        notes: `Group payment: ${invoiceIds.join(", ")}`,
      }).select("id").single();
      if (gpErr?.code === "23505" && gpErr?.message?.includes("payment_proof")) {
        showNotif("⚠️ Bukti pembayaran ini sudah pernah digunakan. Cek invoice yang terkait.");
        return;
      }
      if (gpErr) console.warn("group payment insert:", gpErr?.message);
      paymentId = paymentRow?.id || null;
    }

    // Junction table: 1 payment → banyak invoice
    if (paymentId) {
      const junctionRows = Object.entries(allocation).map(([invId, amt]) => ({
        payment_id: paymentId,
        invoice_id: invId,
        amount: amt,
      }));
      await supabase.from("invoice_payments").insert(junctionRows).then(() => {});
    }

    // Update DB per invoice
    for (const inv of fullyPaid) {
      await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
      supabase.from("invoices").update({
        payment_proof_url: proofUrl || null,
        paid_method: method,
        paid_amount: inv.total,
        remaining_amount: 0,
      }).eq("id", inv.id).then(() => {});
      // Update order status
      const ord = ordersData.find(o => o.id === inv.job_id || o.invoice_id === inv.id);
      if (ord) {
        supabase.from("orders").update({ status: "PAID" }).eq("id", ord.id).then(() => {});
        setOrdersData(prev => prev.map(o => o.id === ord.id ? { ...o, status: "PAID" } : o));
      }
      // Update customer last_service
      if (inv.phone) supabase.from("customers").update({ last_service: paidAt.slice(0, 10) }).eq("phone", inv.phone).then(() => {});
    }

    for (const inv of partialPaid) {
      supabase.from("invoices").update({
        status: "PARTIAL_PAID",
        paid_amount: inv._paid_amount,
        remaining_amount: (inv.total || 0) - inv._paid_amount,
        payment_proof_url: proofUrl || null,
        paid_method: method,
      }).eq("id", inv.id).then(() => {});
    }

    const msg = fullyPaid.length && partialPaid.length
      ? `💰 ${fullyPaid.length} invoice LUNAS + ${partialPaid.length} partial — ${fmt(totalReceived)}`
      : fullyPaid.length
        ? `💰 ${fullyPaid.length} invoice LUNAS — ${fmt(totalReceived)}`
        : `💳 Pembayaran partial ${fmt(totalReceived)} dari ${fmt(totalTagihan)} dicatat`;
    addAgentLog("GROUP_PAYMENT", `Group payment ${customerPhone}: ${invoiceIds.join(",")} — ${fmt(totalReceived)} via ${method}`, "SUCCESS");
    showNotif(msg);
}
