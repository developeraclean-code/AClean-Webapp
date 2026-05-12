import { useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import QuotationModal from "./QuotationModal.jsx";

const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const STATUS_COLOR = {
  DRAFT:     { bg: "#64748b22", border: "#64748b44", text: "#94a3b8" },
  SENT:      { bg: "#3b82f622", border: "#3b82f644", text: "#60a5fa" },
  APPROVED:  { bg: "#22c55e22", border: "#22c55e44", text: "#4ade80" },
  EXPIRED:   { bg: "#f59e0b22", border: "#f59e0b44", text: "#fbbf24" },
  CANCELLED: { bg: "#ef444422", border: "#ef444444", text: "#f87171" },
};

const STATUS_LABEL = {
  DRAFT:     "📝 Draft",
  SENT:      "📤 Sent",
  APPROVED:  "✅ Approved",
  EXPIRED:   "⏰ Expired",
  CANCELLED: "❌ Cancelled",
};

function StatusBadge({ status, isExpired }) {
  const effectiveStatus = isExpired && status === "SENT" ? "EXPIRED" : status;
  const s = STATUS_COLOR[effectiveStatus] || STATUS_COLOR.DRAFT;
  return (
    <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: s.bg, border: "1px solid " + s.border, color: s.text }}>
      {STATUS_LABEL[effectiveStatus] || effectiveStatus}
    </span>
  );
}

export default function QuotationView({
  quotationsData, setQuotationsData, customersData, showNotif, showConfirm,
  currentUser, supabase, getLocalDate, fmt: fmtProp, priceListData,
  invoicesData, setInvoicesData, ordersData, setOrdersData, sendWAFn,
  onOpenPDF,
}) {
  const fmtFn = fmtProp || fmt;
  const today = getLocalDate?.() || new Date().toISOString().slice(0, 10);

  const [filter, setFilter]           = useState("Semua");
  const [search, setSearch]           = useState("");
  const [showModal, setShowModal]     = useState(false);
  const [editData, setEditData]       = useState(null);
  const [approvingId, setApprovingId] = useState(null);

  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Admin";

  const isExpired = (q) => q.valid_until && q.valid_until < today && q.status !== "APPROVED" && q.status !== "CANCELLED";

  const filtered = useMemo(() => {
    let list = quotationsData || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(q => (q.customer || "").toLowerCase().includes(s) || (q.id || "").toLowerCase().includes(s) || (q.phone || "").includes(search));
    }
    if (filter === "EXPIRED") return list.filter(q => isExpired(q));
    if (filter !== "Semua")   return list.filter(q => q.status === filter && !isExpired(q));
    return list;
  }, [quotationsData, filter, search, today]);

  const counts = useMemo(() => {
    const all = quotationsData || [];
    return {
      Semua:    all.length,
      DRAFT:    all.filter(q => q.status === "DRAFT" && !isExpired(q)).length,
      SENT:     all.filter(q => q.status === "SENT" && !isExpired(q)).length,
      APPROVED: all.filter(q => q.status === "APPROVED").length,
      EXPIRED:  all.filter(q => isExpired(q)).length,
    };
  }, [quotationsData, today]);

  // ── Approve: convert quotation → invoice + order ──
  const handleApprove = async (quo) => {
    const ok = await showConfirm?.({
      icon: "✅", title: "Approve Quotation?",
      message: `Approve ${quo.id} untuk ${quo.customer}?\n\nInvoice + Order install akan dibuat otomatis.`,
      confirmText: "Ya, Approve"
    });
    if (!ok) return;

    setApprovingId(quo.id);
    try {
      const todayStr = getLocalDate?.() || new Date().toISOString().slice(0, 10);
      const invoiceId = "INV-" + todayStr.replace(/-/g, "") + "-" + Math.random().toString(36).toUpperCase().slice(2, 7);
      const jobId     = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

      // Garansi 30 hari
      const garansiD = new Date(); garansiD.setDate(garansiD.getDate() + 30);
      const garansiExpires = garansiD.toISOString().slice(0, 10);

      // 1. Buat invoice dari quotation
      const invoicePayload = {
        id:               invoiceId,
        customer:         quo.customer,
        phone:            quo.phone || null,
        address:          quo.address || null,
        area:             quo.area || null,
        invoice_type:     "quotation_converted",
        quotation_id:     quo.id,
        status:           "UNPAID",
        total:            quo.total || 0,
        material:         quo.material || 0,
        labor:            quo.labor || 0,
        unit_ac_amount:   quo.unit_ac_amount || 0,
        discount:         quo.discount || 0,
        trade_in_amount:  quo.trade_in_amount || 0,
        paid_amount:      0,
        remaining_amount: quo.total || 0,
        garansi_days:     30,
        garansi_expires:  garansiExpires,
        sent:             true,
        job_id:           jobId,
        notes:            quo.notes || null,
        created_at:       new Date().toISOString(),
      };

      const { error: invErr } = await supabase.from("invoices").insert(invoicePayload);
      if (invErr) throw new Error("Gagal buat invoice: " + invErr.message);

      // 2. Insert invoice_items dari items jsonb quotation
      const items = (quo.items || []).map(item => ({
        invoice_id:  invoiceId,
        item_type:   item.item_type,
        description: item.description,
        qty:         item.qty || 1,
        unit_price:  item.unit_price || 0,
        subtotal:    item.subtotal || (item.qty * item.unit_price) || 0,
        is_passthrough: item.item_type === "unit_ac",
      }));
      if (items.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(items);
        if (itemErr) {
          // Rollback: hapus invoice yang sudah terbuat
          await supabase.from("invoices").delete().eq("id", invoiceId);
          throw new Error("Gagal simpan items invoice: " + itemErr.message);
        }
      }

      // 3. Buat order (tanpa tanggal/teknisi — diset manual di Planning Order)
      const totalUnits = (quo.items || []).filter(i => i.item_type === "unit_ac").reduce((s, i) => s + (i.qty || 1), 0) || 1;
      const orderPayload = {
        id:         jobId,
        customer:   quo.customer,
        phone:      quo.phone || null,
        address:    quo.address || "",
        area:       quo.area || "",
        service:    "Install",
        type:       "Install",
        units:      totalUnits,
        date:       todayStr,
        time:       "09:00",
        time_end:   "11:00",
        status:     "PENDING",
        invoice_id: invoiceId,
        dispatch:   false,
        notes:      `Auto dari Quotation ${quo.id}${quo.notes ? " · " + quo.notes : ""}`,
      };
      const { error: orderErr } = await supabase.from("orders").insert(orderPayload);
      if (orderErr) console.warn("Gagal buat order:", orderErr.message);

      // 4. Update quotation: status APPROVED + isi invoice_id + job_id
      const { error: quoErr } = await supabase.from("quotations").update({
        status: "APPROVED", invoice_id: invoiceId, job_id: jobId, updated_at: new Date().toISOString()
      }).eq("id", quo.id);
      if (quoErr) throw new Error("Gagal update quotation: " + quoErr.message);

      // 5. Update local state
      setQuotationsData?.(prev => prev.map(q => q.id === quo.id
        ? { ...q, status: "APPROVED", invoice_id: invoiceId, job_id: jobId }
        : q
      ));
      setInvoicesData?.(prev => [invoicePayload, ...prev]);
      if (!orderErr) setOrdersData?.(prev => [orderPayload, ...prev]);

      showNotif?.(`✅ ${quo.id} approved — Invoice ${invoiceId} & Order dibuat`);
    } catch (err) {
      showNotif?.("❌ " + (err.message || err));
    } finally {
      setApprovingId(null);
    }
  };

  // ── Cancel quotation ──
  const handleCancel = async (quo) => {
    const ok = await showConfirm?.({
      icon: "❌", title: "Cancel Quotation?",
      message: `Cancel quotation ${quo.id} untuk ${quo.customer}?`,
      confirmText: "Ya, Cancel"
    });
    if (!ok) return;
    const { error } = await supabase.from("quotations").update({ status: "CANCELLED", updated_at: new Date().toISOString() }).eq("id", quo.id);
    if (error) { showNotif?.("❌ Gagal cancel: " + error.message); return; }
    setQuotationsData?.(prev => prev.map(q => q.id === quo.id ? { ...q, status: "CANCELLED" } : q));
    showNotif?.(`Quotation ${quo.id} dibatalkan`);
  };

  // ── Kirim WA ──
  const handleSendWA = async (quo) => {
    if (!quo.phone) { showNotif?.("⚠️ Tidak ada nomor HP customer"); return; }
    const msg = `Halo ${quo.customer},\n\nBerikut penawaran dari AClean:\n\n📋 *${quo.id}*\nTotal: *${fmt(quo.total)}*${quo.notes ? "\n\n" + quo.notes : ""}\n\nPenawaran berlaku hingga ${quo.valid_until || "-"}.\nHubungi kami untuk konfirmasi.\n\n— AClean Service`;
    sendWAFn?.(quo.phone, msg);
    // Update status ke SENT jika masih DRAFT
    if (quo.status === "DRAFT") {
      await supabase.from("quotations").update({ status: "SENT", updated_at: new Date().toISOString() }).eq("id", quo.id);
      setQuotationsData?.(prev => prev.map(q => q.id === quo.id ? { ...q, status: "SENT" } : q));
    }
    showNotif?.(`📱 WA dikirim ke ${quo.phone}`);
  };

  const FILTERS = ["Semua", "DRAFT", "SENT", "APPROVED", "EXPIRED"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📋 Quotation</div>
        {canEdit && (
          <button onClick={() => { setEditData(null); setShowModal(true); }}
            style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: cs.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + Buat Quotation
          </button>
        )}
      </div>

      {/* Search */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Cari customer, ID quotation, no HP..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "9px 14px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: filter === f ? 700 : 500, cursor: "pointer",
              border: "1px solid " + (filter === f ? cs.accent : cs.border),
              background: filter === f ? cs.accent + "22" : cs.card,
              color: filter === f ? cs.accent : cs.muted }}>
            {f} {counts[f] !== undefined ? `(${counts[f]})` : ""}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted, fontSize: 14 }}>
          {filter === "Semua" && !search ? 'Belum ada quotation. Klik "+ Buat Quotation" untuk mulai.' : "Tidak ada quotation ditemukan."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map(quo => {
            const expired = isExpired(quo);
            const approving = approvingId === quo.id;
            return (
              <div key={quo.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
                {/* Row 1: ID + status + total */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>{quo.id}</span>
                      <StatusBadge status={quo.status} isExpired={expired} />
                      {expired && quo.status !== "APPROVED" && (
                        <span style={{ fontSize: 11, color: "#fbbf24" }}>valid s.d {quo.valid_until}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: cs.text, marginTop: 4 }}>{quo.customer}</div>
                    <div style={{ fontSize: 12, color: cs.muted }}>{quo.phone} · {quo.area}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: cs.accent }}>{fmt(quo.total)}</div>
                    {quo.unit_ac_amount > 0 && (
                      <div style={{ fontSize: 11, color: cs.muted }}>omset {fmt((quo.total || 0) - (quo.unit_ac_amount || 0))}</div>
                    )}
                  </div>
                </div>

                {/* Items preview */}
                {(quo.items || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {(quo.items || []).slice(0, 4).map((item, i) => (
                      <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted }}>
                        {item.description?.slice(0, 30)}
                      </span>
                    ))}
                    {(quo.items || []).length > 4 && (
                      <span style={{ fontSize: 10, color: cs.muted }}>+{quo.items.length - 4} lainnya</span>
                    )}
                  </div>
                )}

                {/* Approved: link ke invoice + order */}
                {quo.status === "APPROVED" && quo.invoice_id && (
                  <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 8 }}>
                    ✅ Invoice: {quo.invoice_id} · Order: {quo.job_id || "—"}
                  </div>
                )}

                {/* Valid until */}
                {quo.valid_until && quo.status !== "APPROVED" && (
                  <div style={{ fontSize: 11, color: expired ? "#fbbf24" : cs.muted, marginBottom: 8 }}>
                    {expired ? "⏰ Expired" : "📅 Valid s.d"} {quo.valid_until}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {onOpenPDF && (
                    <button onClick={() => onOpenPDF(quo)}
                      style={btnStyle("#64748b")}>👁 Preview</button>
                  )}

                  {canEdit && quo.status !== "APPROVED" && quo.status !== "CANCELLED" && (
                    <button onClick={() => { setEditData(quo); setShowModal(true); }}
                      style={btnStyle(cs.accent)}>✏️ Edit</button>
                  )}

                  {canEdit && quo.status !== "CANCELLED" && (
                    <button onClick={() => handleSendWA(quo)}
                      style={btnStyle("#25d366")}>📱 Kirim WA</button>
                  )}

                  {canEdit && (quo.status === "SENT" || quo.status === "DRAFT" || expired) && quo.status !== "CANCELLED" && (
                    <button onClick={() => handleApprove(quo)} disabled={approving}
                      style={btnStyle("#22c55e", approving)}>
                      {approving ? "..." : "✅ Approve"}
                    </button>
                  )}

                  {canEdit && quo.status !== "APPROVED" && quo.status !== "CANCELLED" && (
                    <button onClick={() => handleCancel(quo)}
                      style={btnStyle("#ef4444")}>❌ Cancel</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <QuotationModal
          onClose={() => { setShowModal(false); setEditData(null); }}
          supabase={supabase}
          customersData={customersData}
          showNotif={showNotif}
          setQuotationsData={setQuotationsData}
          getLocalDate={getLocalDate}
          editData={editData}
          priceListData={priceListData}
        />
      )}
    </div>
  );
}

function btnStyle(color, disabled = false) {
  return {
    padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid " + color + "44", background: color + "22", color, opacity: disabled ? 0.6 : 1,
  };
}
