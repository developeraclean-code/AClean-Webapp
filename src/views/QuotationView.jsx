import { useState, useMemo, useRef, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { formatPhone } from "../lib/phone.js";
import { QUOTATION_PAYMENT, quotationPaymentDetails } from "../lib/quotation.js";
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
  onOpenPDF, uploadQuotationPDFFn, setActiveMenu,
}) {
  const fmtFn = fmtProp || fmt;
  const today = getLocalDate?.() || new Date().toISOString().slice(0, 10);

  const [filter, setFilter]           = useState("Semua");
  const [search, setSearch]           = useState("");
  const [showModal, setShowModal]     = useState(false);
  const [editData, setEditData]       = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const approvingNow = useRef(new Set());
  const [approveTargetId, setApproveTargetId] = useState(null);
  const [approveDate, setApproveDate]          = useState("");
  const [quotationPayments, setQuotationPayments] = useState([]);
  const [depositTarget, setDepositTarget] = useState(null);
  const [depositSaving, setDepositSaving] = useState(false);
  const depositSavingNow = useRef(false);
  const [depositFeatureReady, setDepositFeatureReady] = useState(true);
  const [depositForm, setDepositForm] = useState({ amount: "", method: "transfer", paid_at: today, reference: "", notes: "" });

  const canEdit = currentUser?.role === "Owner" || currentUser?.role === "Admin";
  const canRecordPayment = ["Owner", "Admin", "Finance"].includes(currentUser?.role);

  useEffect(() => {
    const ids = (quotationsData || []).map(q => q.id).filter(Boolean);
    if (!supabase || ids.length === 0 || !canRecordPayment) {
      setQuotationPayments([]);
      return;
    }
    let alive = true;
    supabase.from("quotation_payments")
      .select("id,quotation_id,amount,applied_amount,method,paid_at,reference,notes,applied_invoice_id,created_at")
      .in("quotation_id", ids)
      .order("paid_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setDepositFeatureReady(false);
          setQuotationPayments([]);
          console.warn("[QuotationDeposit] ledger belum tersedia:", error.message);
          return;
        }
        setDepositFeatureReady(true);
        setQuotationPayments(data || []);
      });
    return () => { alive = false; };
  }, [supabase, quotationsData, canRecordPayment]);

  const paymentSummary = (quotationId) => {
    const rows = quotationPayments.filter(p => p.quotation_id === quotationId);
    return {
      rows,
      received: rows.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      applied: rows.reduce((sum, p) => sum + Number(p.applied_amount || 0), 0),
    };
  };

  const openDeposit = (quo) => {
    const summary = paymentSummary(quo.id);
    setDepositTarget(quo);
    setDepositForm({
      amount: String(Math.max(0, Number(quo.down_payment_amount || 0) - summary.received) || ""),
      payment_id: crypto.randomUUID(), method: "transfer", paid_at: today, reference: "", notes: "",
    });
  };

  const recordDeposit = async () => {
    if (!depositTarget || depositSavingNow.current) return;
    const amount = Number(depositForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotif?.("⚠️ Nominal DP diterima wajib lebih dari Rp 0");
      return;
    }
    depositSavingNow.current = true;
    setDepositSaving(true);
    try {
      const paymentId = depositForm.payment_id;
      const { data, error } = await supabase.rpc("record_quotation_deposit_atomic", {
        p_payment_id: paymentId,
        p_quotation_id: depositTarget.id,
        p_amount: amount,
        p_method: depositForm.method,
        p_paid_at: depositForm.paid_at,
        p_reference: depositForm.reference || null,
        p_notes: depositForm.notes || null,
        p_proof_url: null,
        p_actor_name: currentUser?.name || null,
      });
      if (error) throw error;
      const saved = data?.payment;
      if (!saved?.id) throw new Error("Penerimaan DP tersimpan tetapi respons ledger tidak lengkap");
      setQuotationPayments(prev => [saved, ...prev.filter(p => p.id !== saved.id)]);
      if (data?.application?.invoice && setInvoicesData) {
        const appliedInvoice = data.application.invoice;
        setInvoicesData(prev => prev.map(i => i.id === appliedInvoice.id ? { ...i, ...appliedInvoice } : i));
      }
      setDepositTarget(null);
      showNotif?.(`✅ DP ${fmt(amount)} tercatat sebagai uang masuk${saved.applied_invoice_id ? " dan mengurangi invoice aktual" : "; menunggu invoice aktual"}`);
    } catch (error) {
      showNotif?.("❌ Gagal mencatat DP: " + (error.message || error));
    } finally {
      depositSavingNow.current = false;
      setDepositSaving(false);
    }
  };

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

  // ── Approve: convert quotation → order saja (masuk Planning Order) ──
  // Invoice TIDAK dibuat di sini. Flow: order → teknisi report → invoice (flow normal) → sent
  const handleApprove = async (quo, scheduledDate) => {
    if (approvingNow.current.has(quo.id)) return;
    approvingNow.current.add(quo.id);
    setApprovingId(quo.id);
    setApproveTargetId(null);
    setApproveDate("");
    try {
      const todayStr = getLocalDate?.() || new Date().toISOString().slice(0, 10);
      const orderDate = scheduledDate || todayStr;
      const jobId     = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

      // 1. Buat order → masuk Planning Order (status PENDING, teknisi kosong)
      const totalUnits = (quo.items || []).filter(i => i.item_type === "unit_ac").reduce((s, i) => s + (i.qty || 1), 0) || 1;
      // P2: Detect service type dari items — jangan hardcode "Install"
      const itemDescs = (quo.items || []).map(i => (i.description || "").toLowerCase()).join(" ");
      const detectedService = (() => {
        if ((quo.items || []).some(i => i.item_type === "unit_ac")) return "Install";
        if (/cuci|cleaning|maintenance|rutin/.test(itemDescs)) return "Cleaning";
        if (/repair|perbaik|freon|isi gas/.test(itemDescs)) return "Repair";
        if (/pasang|install/.test(itemDescs)) return "Install";
        return "Install";
      })();
      // Skip T&C standar dari catatan order (sudah otomatis di PDF) — cegah card Planning Order membengkak
      const _nLow = (quo.notes || "").toLowerCase();
      const isPresetNote = _nLow.includes("jasa perapian tembok") && _nLow.includes("term of payment");
      const customNote = quo.notes && !isPresetNote ? quo.notes : "";
      const orderPayload = {
        id:         jobId,
        customer:   quo.customer,
        phone:      quo.phone || null,
        address:    quo.address || "",
        area:       quo.area || "",
        service:    detectedService,
        type:       detectedService,
        units:      totalUnits,
        date:       orderDate,
        time:       "09:00",
        time_end:   "11:00",
        status:     "PENDING",
        dispatch:   false,
        source:     "quotation",
        notes:      `Auto dari Quotation ${quo.id}${customNote ? " · " + customNote : ""}`,
        // Penawaran B2B sudah membawa maintenance_client_id-nya sendiri → order hasil
        // approve ikut tertaut ke kontrak (tanpa perlu resolve ulang lewat customer_id).
        ...(quo.maintenance_client_id ? { maintenance_client_id: quo.maintenance_client_id } : {}),
      };
      // DB mengunci quotation dan membuat order+link bersama. Jika respons hilang,
      // retry akan mengembalikan order yang sudah ada, bukan membuat order kedua.
      const { data: result, error: approveErr } = await supabase.rpc("approve_quotation_order_atomic", {
        p_quotation_id: quo.id, p_job_id: jobId, p_order: orderPayload,
      });
      if (approveErr) throw new Error("Gagal approve quotation: " + approveErr.message);
      const savedOrder = result?.order;
      if (!savedOrder?.id) throw new Error("Order hasil approve tidak terbaca; muat ulang sebelum mencoba lagi");

      // 3. Update local state
      setQuotationsData?.(prev => prev.map(q => q.id === quo.id
        ? { ...q, status: "APPROVED", job_id: savedOrder.id }
        : q
      ));
      setOrdersData?.(prev => prev.some(o => o.id === savedOrder.id) ? prev : [savedOrder, ...prev]);

      showNotif?.(`✅ ${quo.id} approved — Order ${savedOrder.id} masuk Planning Order. Invoice dibuat setelah laporan teknisi.`);
    } catch (err) {
      showNotif?.("❌ " + (err.message || err));
    } finally {
      approvingNow.current.delete(quo.id);
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
  const sendingWaNow = useRef(new Set());
  const recentlySentWA = useRef(new Map());
  const handleSendWA = async (quo) => {
    if (sendingWaNow.current.has(quo.id)) return;
    if (Date.now() - (recentlySentWA.current.get(quo.id) || 0) < 5000) {
      showNotif?.("⚠️ Quotation ini baru saja dikirim; tunggu sebentar sebelum mengirim ulang.");
      return;
    }
    if (!quo.phone) { showNotif?.("⚠️ Tidak ada nomor HP customer"); return; }
    sendingWaNow.current.add(quo.id);
    setSendingWAId(quo.id);
    try {
      const payment = quotationPaymentDetails({ method: quo.payment_method, downPaymentAmount: quo.down_payment_amount, total: quo.total });
      const paymentMessage = payment.method === QUOTATION_PAYMENT.DOWN_PAYMENT
        ? `\nDown Payment: *${fmt(payment.downPaymentAmount)}*\nSisa: *${fmt(payment.remainingAmount)}*`
        : "\nPembayaran: *Transfer Full*";
      const msg =
        `Halo ${quo.customer},\n\nBerikut penawaran dari AClean:\n\n` +
        `📋 *${quo.id}*\nTotal: *${fmt(quo.total)}*${paymentMessage}` +
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

      const sent = await sendWAFn?.(quo.phone, msg, pdfAttachment ? { url: pdfAttachment.url, filename: pdfAttachment.filename } : {});
      if (sent !== true) { showNotif?.("⚠️ Quotation belum terkirim via WA. Status tidak diubah."); return; }
      recentlySentWA.current.set(quo.id, Date.now());

      // Update status ke SENT jika masih DRAFT
      if (quo.status === "DRAFT") {
        const { error: statusError } = await supabase.from("quotations").update({ status: "SENT", updated_at: new Date().toISOString() }).eq("id", quo.id);
        if (statusError) { showNotif?.("⚠️ WA terkirim, tetapi status quotation gagal disimpan: " + statusError.message); return; }
        setQuotationsData?.(prev => prev.map(q => q.id === quo.id ? { ...q, status: "SENT" } : q));
      }
      showNotif?.(`📱 WA dikirim ke ${formatPhone(quo.phone)}${pdfAttachment ? " 📎 PDF terlampir" : ""}`);
    } finally {
      sendingWaNow.current.delete(quo.id);
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
            const deposit = paymentSummary(quo.id);
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
                    <div style={{ fontSize: 12, color: cs.muted }}>{formatPhone(quo.phone)} · {quo.area}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: cs.accent }}>{fmt(quo.total)}</div>
                    <div style={{ fontSize: 10.5, color: quo.payment_method === QUOTATION_PAYMENT.DOWN_PAYMENT ? "#fbbf24" : cs.muted, marginTop: 2 }}>
                      {quo.payment_method === QUOTATION_PAYMENT.DOWN_PAYMENT
                        ? `DP ${fmt(quo.down_payment_amount)}`
                        : "Transfer Full"}
                    </div>
                    {quo.payment_method === QUOTATION_PAYMENT.DOWN_PAYMENT && (
                      <div style={{ fontSize: 10.5, color: deposit.received > 0 ? "#4ade80" : "#f87171", marginTop: 2 }}>
                        Diterima {fmt(deposit.received)} · belum diterima {fmt(Math.max(0, Number(quo.down_payment_amount || 0) - deposit.received))}
                      </div>
                    )}
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
                        {(item.description?.trim() || (item.item_type === "unit_ac" ? "Unit AC" : "")).slice(0, 30)}
                      </span>
                    ))}
                    {(quo.items || []).length > 4 && (
                      <span style={{ fontSize: 10, color: cs.muted }}>+{quo.items.length - 4} lainnya</span>
                    )}
                  </div>
                )}

                {/* Approved: link ke order + invoice (P4) */}
                {quo.status === "APPROVED" && quo.job_id && (
                  <div style={{ fontSize: 11, marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ color: "#4ade80" }}>✅ Order: <b>{quo.job_id}</b></span>
                    {quo.invoice_id
                      ? <span
                          onClick={() => setActiveMenu?.("invoice")}
                          style={{ color: "#a5b4fc", cursor: "pointer", textDecoration: "underline" }}
                          title="Buka menu Invoice">
                          📄 Invoice: <b>{quo.invoice_id}</b>
                        </span>
                      : <span style={{ color: "#64748b" }}>⏳ Invoice belum dibuat</span>
                    }
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

                  {canRecordPayment && quo.payment_method === QUOTATION_PAYMENT.DOWN_PAYMENT && quo.status !== "CANCELLED" && (
                    <button onClick={() => openDeposit(quo)} disabled={!depositFeatureReady}
                      title={depositFeatureReady ? "Catat uang DP yang benar-benar sudah diterima" : "Jalankan migration 190 terlebih dahulu"}
                      style={btnStyle("#06b6d4", !depositFeatureReady)}>
                      💳 Catat DP Masuk
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

      {depositTarget && (
        <div onClick={() => !depositSaving && setDepositTarget(null)} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "#020617cc", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(520px, 100%)", background: cs.card, border: "1px solid #06b6d455", borderRadius: 14, padding: 18, display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>💳 Catat DP Benar-benar Diterima</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>{depositTarget.id} · {depositTarget.customer}</div>
            </div>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 10, fontSize: 12, color: cs.muted }}>
              Rencana DP <b style={{ color: "#fbbf24" }}>{fmt(depositTarget.down_payment_amount)}</b> · sudah diterima <b style={{ color: "#4ade80" }}>{fmt(paymentSummary(depositTarget.id).received)}</b>.
              {depositTarget.invoice_id ? " Pembayaran langsung diterapkan ke invoice aktual." : " Dana disimpan sebagai kas masuk dan otomatis diterapkan saat invoice aktual dibuat."}
            </div>
            {paymentSummary(depositTarget.id).rows.length > 0 && (
              <div style={{ display: "grid", gap: 5 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted }}>Riwayat penerimaan</div>
                {paymentSummary(depositTarget.id).rows.map(row => (
                  <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "7px 9px", fontSize: 11 }}>
                    <span style={{ color: cs.text }}>{row.paid_at} · {String(row.method || "transfer").toUpperCase()}{row.reference ? ` · ${row.reference}` : ""}</span>
                    <span style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(row.amount)}{Number(row.applied_amount || 0) > 0 ? ` · terpakai ${fmt(row.applied_amount)}` : " · menunggu invoice"}</span>
                  </div>
                ))}
              </div>
            )}
            <label style={{ fontSize: 11, color: cs.muted }}>Nominal diterima
              <input type="number" min="1" value={depositForm.amount} onChange={e => setDepositForm(p => ({ ...p, amount: e.target.value }))}
                style={{ width: "100%", marginTop: 4, boxSizing: "border-box", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 10px", color: cs.text }} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 11, color: cs.muted }}>Metode
                <select value={depositForm.method} onChange={e => setDepositForm(p => ({ ...p, method: e.target.value }))} style={{ width: "100%", marginTop: 4, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 10px", color: cs.text }}>
                  <option value="transfer">Transfer</option><option value="cash">Cash</option><option value="qris">QRIS</option><option value="card">Kartu</option><option value="other">Lainnya</option>
                </select>
              </label>
              <label style={{ fontSize: 11, color: cs.muted }}>Tanggal diterima
                <input type="date" value={depositForm.paid_at} onChange={e => setDepositForm(p => ({ ...p, paid_at: e.target.value }))} style={{ width: "100%", marginTop: 4, boxSizing: "border-box", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text }} />
              </label>
            </div>
            <input value={depositForm.reference} onChange={e => setDepositForm(p => ({ ...p, reference: e.target.value }))} placeholder="Nomor referensi transfer (opsional)" style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 10px", color: cs.text }} />
            <textarea value={depositForm.notes} onChange={e => setDepositForm(p => ({ ...p, notes: e.target.value }))} placeholder="Catatan (opsional)" rows={2} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 10px", color: cs.text, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button disabled={depositSaving} onClick={() => setDepositTarget(null)} style={btnStyle("#94a3b8", depositSaving)}>Batal</button>
              <button disabled={depositSaving} onClick={recordDeposit} style={btnStyle("#06b6d4", depositSaving)}>{depositSaving ? "Menyimpan..." : "✅ Simpan Uang Masuk"}</button>
            </div>
          </div>
        </div>
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
