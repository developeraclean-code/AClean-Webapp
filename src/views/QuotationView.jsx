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
  onOpenPDF, uploadQuotationPDFFn,
}) {
  const fmtFn = fmtProp || fmt;
  const today = getLocalDate?.() || new Date().toISOString().slice(0, 10);

  const [filter, setFilter]           = useState("Semua");
  const [search, setSearch]           = useState("");
  const [showModal, setShowModal]     = useState(false);
  const [editData, setEditData]       = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [approveTargetId, setApproveTargetId] = useState(null);
  const [approveDate, setApproveDate]          = useState("");

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
      Semua:     all.length,
      DRAFT:     all.filter(q => q.status === "DRAFT" && !isExpired(q)).length,
      SENT:      all.filter(q => q.status === "SENT" && !isExpired(q)).length,
      APPROVED:  all.filter(q => q.status === "APPROVED").length,
      EXPIRED:   all.filter(q => isExpired(q)).length,
      CANCELLED: all.filter(q => q.status === "CANCELLED").length,
    };
  }, [quotationsData, today]);

  // ── Approve: convert quotation → invoice + order (ke Planning Order) ──
  const handleApprove = async (quo, scheduledDate) => {
    setApprovingId(quo.id);
    setApproveTargetId(null);
    setApproveDate("");
    try {
      const todayStr = getLocalDate?.() || new Date().toISOString().slice(0, 10);
      const orderDate = scheduledDate || todayStr;
      const invoiceId = "INV-" + todayStr.replace(/-/g, "") + "-" + Math.random().toString(36).toUpperCase().slice(2, 7);
      const jobId     = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

      // Garansi 30 hari
      const garansiD = new Date(); garansiD.setDate(garansiD.getDate() + 30);
      const garansiExpires = garansiD.toISOString().slice(0, 10);

      // 1. Buat order DULU (invoice_job_id_fkey constraint: order harus ada sebelum invoice)
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
        date:       orderDate,
        time:       "09:00",
        time_end:   "11:00",
        status:     "PENDING",
        invoice_id: invoiceId,
        dispatch:   false,
        source:     "quotation",
        notes:      `Auto dari Quotation ${quo.id}${quo.notes ? " · " + quo.notes : ""}`,
      };
      const { error: orderErr } = await supabase.from("orders").insert(orderPayload);
      if (orderErr) throw new Error("Gagal buat order: " + orderErr.message);

      // 2. Buat invoice (job_id sekarang sudah ada di orders)
      const invoicePayload = {
        id:               invoiceId,
        customer:         quo.customer,
        phone:            quo.phone || null,
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
      if (invErr) {
        // Rollback: hapus order yang sudah terbuat
        await supabase.from("orders").delete().eq("id", jobId);
        throw new Error("Gagal buat invoice: " + invErr.message);
      }

      // 3. Insert invoice_items dari items jsonb quotation
      const items = (quo.items || []).map(item => ({
        invoice_id:  invoiceId,
        item_type:   item.item_type,
        description: item.description,
        qty:         item.qty || 1,
        unit_price:  item.unit_price || 0,
        subtotal:    item.subtotal || (item.qty * item.unit_price) || 0,
        satuan:      item.satuan || (item.item_type === "unit_ac" ? "Unit" : null),
        is_passthrough: item.item_type === "unit_ac",
      }));
      if (items.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(items);
        if (itemErr) {
          // Rollback: hapus invoice + order
          await supabase.from("invoices").delete().eq("id", invoiceId);
          await supabase.from("orders").delete().eq("id", jobId);
          throw new Error("Gagal simpan items invoice: " + itemErr.message);
        }
      }

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
      setOrdersData?.(prev => [orderPayload, ...prev]);
      setInvoicesData?.(prev => [invoicePayload, ...prev]);

      showNotif?.(`✅ ${quo.id} approved — Invoice ${invoiceId} & Order dibuat`);
    } catch (err) {
      showNotif?.("❌ " + (err.message || err));
    } finally {
      setApprovingId(null);
    }
  };

  // ── Delete quotation (Owner only, CANCELLED status) ──
  const handleDelete = async (quo) => {
    const ok = await showConfirm?.({
      icon: "🗑️", title: "Hapus Quotation Permanent?", danger: true,
      message: `Hapus permanent quotation ${quo.id} (${quo.customer})?\n\nTindakan ini tidak bisa dibatalkan.`,
      confirmText: "Ya, Hapus Permanent"
    });
    if (!ok) return;
    const { error } = await supabase.from("quotations").delete().eq("id", quo.id);
    if (error) { showNotif?.("❌ Gagal hapus: " + error.message); return; }
    setQuotationsData?.(prev => prev.filter(q => q.id !== quo.id));
    showNotif?.(`🗑️ Quotation ${quo.id} dihapus`);
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

  // ── Kirim WA + PDF attachment ──
  const [sendingWAId, setSendingWAId] = useState(null);
  const handleSendWA = async (quo) => {
    if (!quo.phone) { showNotif?.("⚠️ Tidak ada nomor HP customer"); return; }
    setSendingWAId(quo.id);
    try {
      const msg =
        `Halo ${quo.customer},\n\nBerikut penawaran dari AClean:\n\n` +
        `📋 *${quo.id}*\nTotal: *${fmt(quo.total)}*` +
        `\n\nPenawaran berlaku hingga ${quo.valid_until || "-"}.\nHubungi kami untuk konfirmasi.\n\n— AClean Service`;

      // Upload PDF quotation ke R2 terlebih dahulu jika tersedia
      let pdfAttachment = null;
      if (uploadQuotationPDFFn) {
        try {
          pdfAttachment = await uploadQuotationPDFFn(quo);
        } catch (pdfErr) {
          console.warn("[QuotationWA] PDF upload gagal, fallback teks:", pdfErr.message);
        }
      }

      await sendWAFn?.(quo.phone, msg, pdfAttachment ? { url: pdfAttachment.url, filename: pdfAttachment.filename } : {});

      // Update status ke SENT jika masih DRAFT
      if (quo.status === "DRAFT") {
        await supabase.from("quotations").update({ status: "SENT", updated_at: new Date().toISOString() }).eq("id", quo.id);
        setQuotationsData?.(prev => prev.map(q => q.id === quo.id ? { ...q, status: "SENT" } : q));
      }
      showNotif?.(`📱 WA dikirim ke ${quo.phone}${pdfAttachment ? " 📎 PDF terlampir" : ""}`);
    } finally {
      setSendingWAId(null);
    }
  };

  const FILTERS = ["Semua", "DRAFT", "SENT", "APPROVED", "EXPIRED", "CANCELLED"];

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

      {/* Conversion Rate Stats */}
      {canEdit && (quotationsData || []).length > 0 && (() => {
        const all = quotationsData || [];
        const total = all.length;
        const converted = all.filter(q => q.status === "APPROVED" && q.job_id).length;
        const sent = all.filter(q => q.status === "SENT" && !isExpired(q)).length;
        const expired = all.filter(q => isExpired(q)).length;
        const rate = total > 0 ? Math.round(converted / total * 100) : 0;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { label: "Total",      val: total,     color: cs.muted },
              { label: "Menunggu",   val: sent,      color: "#60a5fa" },
              { label: "Converted",  val: converted, color: "#4ade80" },
              { label: "Conv. Rate", val: rate + "%", color: rate >= 50 ? "#4ade80" : rate >= 25 ? "#f59e0b" : "#f87171" },
            ].map(s => (
              <div key={s.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        );
      })()}

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
                    <button onClick={() => handleSendWA(quo)} disabled={sendingWAId === quo.id}
                      style={{ ...btnStyle("#25d366"), opacity: sendingWAId === quo.id ? 0.6 : 1, cursor: sendingWAId === quo.id ? "not-allowed" : "pointer" }}>
                      {sendingWAId === quo.id ? "⏳ Mengirim..." : "📱 Kirim WA"}
                    </button>
                  )}

                  {canEdit && (quo.status === "SENT" || quo.status === "DRAFT" || expired) && quo.status !== "CANCELLED" && (
                    approveTargetId === quo.id ? null : (
                      <button onClick={() => { setApproveTargetId(quo.id); setApproveDate(today); }} disabled={approving}
                        style={btnStyle("#22c55e", approving)}>
                        {approving ? "..." : "✅ Approve"}
                      </button>
                    )
                  )}

                  {canEdit && quo.status !== "APPROVED" && quo.status !== "CANCELLED" && (
                    <button onClick={() => handleCancel(quo)}
                      style={btnStyle("#ef4444")}>❌ Cancel</button>
                  )}

                  {currentUser?.role === "Owner" && quo.status === "CANCELLED" && (
                    <button onClick={() => handleDelete(quo)}
                      style={btnStyle("#dc2626")}>🗑️ Hapus</button>
                  )}
                </div>

                {/* Inline Approve panel with date picker */}
                {approveTargetId === quo.id && canEdit && quo.status !== "APPROVED" && quo.status !== "CANCELLED" && (
                  <div style={{ marginTop: 12, background: "#22c55e10", border: "1px solid #22c55e33", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#4ade80", marginBottom: 8 }}>📅 Tanggal Pengerjaan</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="date" value={approveDate} onChange={e => setApproveDate(e.target.value)}
                        style={{ flex: 1, minWidth: 140, background: "#0f172a", border: "1px solid #22c55e44", borderRadius: 8, padding: "7px 10px", color: "#f8fafc", fontSize: 13, outline: "none" }} />
                      <button onClick={() => handleApprove(quo, approveDate)} disabled={approving || !approveDate}
                        style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", fontWeight: 700, fontSize: 12, cursor: approving || !approveDate ? "not-allowed" : "pointer", opacity: approving || !approveDate ? 0.6 : 1 }}>
                        {approving ? "Proses..." : "✅ Konfirmasi Approve"}
                      </button>
                      <button onClick={() => { setApproveTargetId(null); setApproveDate(""); }}
                        style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #64748b44", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
                        Batal
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                      Order akan masuk ke Planning Order. Assign teknisi dari sana.
                    </div>
                  </div>
                )}
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
