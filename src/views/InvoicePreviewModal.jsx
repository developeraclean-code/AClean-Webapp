import { useEffect, useState } from "react";
import { summarize } from "../lib/invoicing.js";

export default function InvoicePreviewModal({
  open, onClose, selectedInvoice, invoicesData, setInvoicesData,
  appSettings, currentUser, supabase, showNotif,
  approveInvoice, downloadInvoicePDF, invoiceReminderWA,
  computePph23, updateInvoice, parseMD, fmt, auditUserName,
  onOpenEditInvoice, generateInvoicePDFBlob,
}) {
  const liveInv = (open && selectedInvoice)
    ? (invoicesData.find(i => i.id === selectedInvoice.id) || selectedInvoice)
    : null;
  const rate = parseFloat(appSettings?.pph23_rate) || 0.025;

  const mArr = (() => {
    if (!liveInv) return [];
    const md = liveInv.materials_detail;
    const parsed = Array.isArray(md) ? md
      : (typeof md === "string" && md)
        ? (() => { try { return JSON.parse(md); } catch (_) { return []; } })()
        : [];
    return Array.isArray(parsed) ? parsed : [];
  })();
  // PPh 23 HANYA dari kategori Jasa (labor) — bukan liveInv.total (jasa+material).
  const jasaSubtotal = liveInv ? summarize(mArr).labor : 0;
  const pph = computePph23(jasaSubtotal, rate);

  // Preview = hasil generate PDF ASLI (InvoicePDF.jsx via generateInvoicePDFBlob),
  // BUKAN markup HTML terpisah — dulu preview ini re-implementasi manual yang gampang
  // ketinggalan zaman dari desain PDF sebenarnya (user komplain preview masih model
  // lama padahal PDF yang di-download sudah desain baru). Sekarang dijamin identik
  // karena sumbernya sama persis.
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  useEffect(() => {
    if (!liveInv) { setPdfUrl(null); setPdfError(null); return; }
    let cancelled = false;
    let objectUrl = null;
    setPdfUrl(null);
    setPdfError(null);
    generateInvoicePDFBlob(liveInv).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPdfUrl(objectUrl);
    }).catch(err => {
      if (!cancelled) setPdfError(err.message || "Gagal generate PDF");
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveInv?.id, liveInv?.pph23, liveInv?.pph23_amount, liveInv?.updated_at, liveInv?.status]);

  if (!open || !selectedInvoice || !liveInv) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#f8fafc", borderRadius: 20, width: "100%", maxWidth: 860, maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>

        {/* Toolbar */}
        <div style={{ background: "#1E3A5F", padding: "12px 20px", borderRadius: "20px 20px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, color: "#fff", fontSize: 14 }}>Preview Invoice — {liveInv.id}</div>
            <div style={{ fontSize: 11, color: "#93c5fd" }}>Format standar AClean · Dikirim sebagai PDF ke customer</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {liveInv.status === "PENDING_APPROVAL" && (
              <button onClick={() => { onClose(); setTimeout(() => approveInvoice(liveInv), 100); }}
                style={{ background: "#22c55e", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓ Approve Invoice</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "1px solid #ffffff44", color: "#fff", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>× Tutup</button>
          </div>
        </div>

        {/* PPh 23 toggle */}
        <div style={{ background: "#ecfeff", borderBottom: "1px solid #cffafe", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#0e7490", fontWeight: 700 }}>
            <input type="checkbox" checked={!!liveInv.pph23}
              onChange={async e => {
                const on = e.target.checked;
                const amt = on ? pph.amount : 0;
                setInvoicesData(prev => prev.map(i => i.id === liveInv.id ? { ...i, pph23: on, pph23_amount: amt } : i));
                const { error } = await updateInvoice(supabase, liveInv.id, { pph23: on, pph23_amount: amt }, auditUserName());
                if (error) showNotif("⚠️ Gagal simpan PPh 23: " + error.message);
                else showNotif(on ? `✅ PPh 23 aktif — DPP ${fmt(pph.dpp)}, dipotong ${fmt(pph.amount)}` : "PPh 23 dinonaktifkan");
              }}
              style={{ width: 15, height: 15, accentColor: "#0891b2" }} />
            Customer potong PPh 23 ({(rate * 100).toLocaleString("id-ID")}%)
          </label>
          {liveInv.pph23 && <span style={{ fontSize: 11, color: "#0e7490", fontFamily: "monospace" }}>DPP {fmt(pph.dpp)} · PPh −{fmt(pph.amount)} · diterima {fmt(liveInv.total)}</span>}
        </div>

        {/* PDF preview — render langsung dari InvoicePDF.jsx (sama persis dgn hasil download/WA) */}
        <div style={{ padding: 20, background: "#f8fafc" }}>
          {pdfError ? (
            <div style={{ padding: 50, textAlign: "center", color: "#dc2626", fontSize: 13 }}>⚠️ Gagal memuat preview: {pdfError}</div>
          ) : pdfUrl ? (
            <iframe title={`Invoice ${liveInv.id}`} src={pdfUrl}
              style={{ width: "100%", height: "72vh", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" }} />
          ) : (
            <div style={{ padding: 60, textAlign: "center", color: "#64748b", fontSize: 13 }}>⏳ Menyiapkan preview…</div>
          )}
        </div>

        {/* Action bar */}
        <div style={{ background: "#f1f5f9", padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", borderRadius: "0 0 20px 20px", flexShrink: 0 }}>
          <button onClick={() => downloadInvoicePDF(liveInv)} style={{ background: "#EFF6FF", border: "1px solid #bfdbfe", color: "#1d4ed8", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📥 Download PDF</button>
          {liveInv.status === "UNPAID" && (
            <button onClick={() => { invoiceReminderWA(liveInv); onClose(); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📱 Kirim via WA</button>
          )}
          {liveInv.status === "PENDING_APPROVAL" && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
            <button onClick={() => onOpenEditInvoice(liveInv)}
              style={{ background: "#fef9c322", border: "1px solid #fde68a", color: "#92400e", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit Nilai</button>
          )}
        </div>
      </div>
    </div>
  );
}
