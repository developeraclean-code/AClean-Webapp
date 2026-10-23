import { useEffect, useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import { canReviewSettlement, isUsablePaymentProof, settlementBalance } from "../lib/invoiceSettlementReview.js";

export default function InvoiceSettlementReview({ invoice, supabase, fmt, fotoSrc, markPaid, onChooseProof, onShowAudit, onClose, showNotif }) {
  const [fresh, setFresh] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [method, setMethod] = useState("transfer");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedInvoiceId, setTypedInvoiceId] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [invoiceResult, historyResult] = await Promise.all([
          supabase.from("invoices").select("id,job_id,customer,phone,total,paid_amount,remaining_amount,status,payment_proof_url,paid_method").eq("id", invoice.id).single(),
          supabase.from("invoice_payments").select("id,amount,method,notes,paid_at,recorded_by_name,created_at").eq("invoice_id", invoice.id).order("created_at", { ascending: false }).limit(10),
        ]);
        if (invoiceResult.error) throw invoiceResult.error;
        if (historyResult.error) throw historyResult.error;
        if (!invoiceResult.data) throw new Error("Invoice tidak ditemukan");
        if (alive) {
          setFresh(invoiceResult.data);
          setHistory(historyResult.data || []);
        }
      } catch (error) {
        if (alive) setLoadError(error.message || "Gagal memuat data terbaru");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase, invoice.id]);

  const stale = fresh && (fresh.status !== invoice.status || Number(fresh.total) !== Number(invoice.total)
    || fresh.customer !== invoice.customer || fresh.phone !== invoice.phone);
  const proof = fresh?.payment_proof_url;
  const canSettle = !loading && !loadError && !stale && !saving && canReviewSettlement({
    invoice: fresh, method, reason, acknowledged, typedInvoiceId,
  });

  const confirm = async () => {
    if (!canSettle || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const note = method === "cash" ? `Cash tanpa bukti: ${reason.trim()}` : "Transfer: bukti diperiksa manual sebelum pelunasan";
      const result = await markPaid(fresh, method, note, false, method === "transfer" ? proof : null);
      if (result?.ok) onClose();
    } catch (error) {
      showNotif(`❌ Status pembayaran belum dapat dipastikan: ${error.message}. Periksa riwayat sebelum mencoba lagi.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const proofHref = isUsablePaymentProof(proof) ? fotoSrc(proof) : null;
  return (
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 650, background: "#000d", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Tinjau pelunasan invoice" onClick={event => event.stopPropagation()}
        style={{ background: cs.surface, color: cs.text, border: `1px solid ${cs.border}`, borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 20, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>🔎 Tinjau sebelum tandai lunas</div>
            <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>Belum ada perubahan sampai Anda mengonfirmasi di bawah.</div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} style={{ color: cs.text, background: "transparent", border: "none", fontSize: 22, cursor: "pointer" }} aria-label="Tutup">×</button>
        </div>

        {loading ? <p style={{ color: cs.muted }}>Memuat invoice dan riwayat terbaru…</p> : loadError ? (
          <p role="alert" style={{ color: cs.red }}>Gagal memuat data terbaru: {loadError}. Pelunasan dinonaktifkan.</p>
        ) : <>
          {stale && <p role="alert" style={{ color: cs.yellow }}>Invoice berubah sejak daftar dibuka. Tutup dan muat ulang sebelum melanjutkan.</p>}
          <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 10, padding: 12, margin: "14px 0", display: "grid", gap: 5, fontSize: 12 }}>
            <strong style={{ color: cs.accent, fontSize: 14 }}>{fresh.id}</strong>
            <span>Customer: <b>{fresh.customer}</b> · {fresh.phone || "nomor tidak tersedia"}</span>
            <span>Status saat ini: <b>{fresh.status}</b></span>
            <span>Total {fmt(fresh.total)} · sudah dibayar {fmt(fresh.paid_amount || 0)}</span>
            <strong style={{ color: cs.yellow }}>Sisa yang akan dilunasi: {fmt(settlementBalance(fresh))}</strong>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Riwayat pembayaran sebelumnya</div>
          {history.length ? <div style={{ maxHeight: 120, overflowY: "auto", display: "grid", gap: 4, marginBottom: 8 }}>
            {history.map(payment => <div key={payment.id} style={{ fontSize: 11, color: cs.muted, background: cs.card, padding: 7, borderRadius: 6 }}>
              {payment.paid_at || payment.created_at?.slice(0, 10)} · {fmt(payment.amount)} · {payment.method} · {payment.recorded_by_name || "—"}{payment.notes ? ` · ${payment.notes}` : ""}
            </div>)}
          </div> : <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>Belum ada pembayaran tercatat.</div>}
          <button type="button" onClick={() => onShowAudit(fresh.id)} style={{ background: "transparent", border: "none", padding: 0, color: cs.accent, fontSize: 11, cursor: "pointer" }}>Lihat riwayat perubahan status ↗</button>

          <div style={{ borderTop: `1px solid ${cs.border}`, marginTop: 14, paddingTop: 12 }}>
            <label style={{ fontSize: 12, display: "block", marginBottom: 6 }}>Metode pembayaran</label>
            <select value={method} onChange={event => { setMethod(event.target.value); setAcknowledged(false); }} disabled={saving}
              style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, color: cs.text, padding: 9, width: "100%" }}>
              <option value="transfer">Transfer (wajib ada bukti)</option>
              <option value="cash">Tunai (wajib alasan manual)</option>
            </select>
            {method === "transfer" && (proofHref ? <div style={{ marginTop: 10, fontSize: 12 }}>
              <div style={{ color: cs.yellow }}>Pastikan gambar, pengirim, nominal, dan invoice ini benar.</div>
              <a href={proofHref} target="_blank" rel="noreferrer" style={{ color: cs.accent }}>Buka bukti pembayaran tersimpan ↗</a>
            </div> : <div style={{ marginTop: 10, fontSize: 12, color: cs.yellow }}>
              Belum ada bukti bayar. Lampirkan dan verifikasi bukti terlebih dahulu.
              <button type="button" onClick={() => onChooseProof(fresh)} style={{ display: "block", marginTop: 7, background: cs.accent + "22", border: `1px solid ${cs.accent}`, color: cs.accent, borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>🔗 Periksa & lampirkan bukti</button>
            </div>)}
            {method === "cash" && proofHref && <div role="alert" style={{ color: cs.yellow, fontSize: 11, marginTop: 8 }}>
              Ada bukti tersimpan di invoice ini. Jangan catat sebagai tunai sebelum bukti tersebut diperiksa atau dikoreksi.
            </div>}
            {method === "cash" && <label style={{ display: "block", fontSize: 12, marginTop: 10 }}>
              Alasan / rujukan penerimaan tunai (minimal 10 karakter)
              <textarea value={reason} onChange={event => setReason(event.target.value)} disabled={saving} rows={2} placeholder="Contoh: diterima oleh kasir, tanggal dan referensi…"
                style={{ display: "block", marginTop: 5, width: "100%", boxSizing: "border-box", background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, color: cs.text, padding: 8 }} />
            </label>}
            <label style={{ display: "block", fontSize: 12, marginTop: 12 }}>
              <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={saving} /> Saya sudah memeriksa customer, nominal, riwayat, dan {method === "cash" ? "penerimaan tunai" : "bukti bayar"}.
            </label>
            <label style={{ display: "block", fontSize: 12, marginTop: 10 }}>
              Ketik ulang ID invoice <b>{fresh.id}</b> untuk konfirmasi
              <input value={typedInvoiceId} onChange={event => setTypedInvoiceId(event.target.value)} disabled={saving} autoComplete="off"
                style={{ display: "block", marginTop: 5, width: "100%", boxSizing: "border-box", background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, color: cs.text, padding: 9 }} />
            </label>
          </div>
        </>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ flex: 1, background: cs.card, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 8, padding: 10, cursor: "pointer" }}>Batal</button>
          <button type="button" onClick={confirm} disabled={!canSettle} style={{ flex: 2, background: canSettle ? cs.green : cs.card, border: "none", color: canSettle ? "white" : cs.muted, borderRadius: 8, padding: 10, fontWeight: 800, cursor: canSettle ? "pointer" : "not-allowed" }}>
            {saving ? "Menyimpan…" : "Konfirmasi & tandai PAID"}
          </button>
        </div>
      </div>
    </div>
  );
}
