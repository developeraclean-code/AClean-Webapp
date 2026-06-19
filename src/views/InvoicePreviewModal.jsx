import { cs } from "../theme/cs.js";

export default function InvoicePreviewModal({
  open, onClose, selectedInvoice, invoicesData, setInvoicesData,
  appSettings, currentUser, supabase, showNotif,
  approveInvoice, downloadInvoicePDF, invoiceReminderWA,
  computePph23, updateInvoice, parseMD, fmt, auditUserName,
  onOpenEditInvoice,
}) {
  if (!open || !selectedInvoice) return null;

  const liveInv = invoicesData.find(i => i.id === selectedInvoice.id) || selectedInvoice;
  const rate = parseFloat(appSettings?.pph23_rate) || 0.025;
  const pph = computePph23(liveInv.total, rate);

  const mArr = (() => {
    const md = liveInv.materials_detail;
    const parsed = Array.isArray(md) ? md
      : (typeof md === "string" && md)
        ? (() => { try { return JSON.parse(md); } catch (_) { return []; } })()
        : [];
    return Array.isArray(parsed) ? parsed : [];
  })();

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#f8fafc", borderRadius: 20, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>

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

        {/* Invoice body */}
        <div style={{ padding: 20, background: "#f8fafc" }}>
          {/* Header */}
          <div style={{ background: "#1E3A5F", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ height: 4, background: "#2563EB" }} />
            <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>
                  <span style={{ color: "#60a5fa" }}>AC</span>lean Service
                </div>
                <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 3 }}>Jasa Servis &amp; Perawatan AC Profesional</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#93c5fd", fontWeight: 600 }}>INVOICE</div>
                <div style={{ background: "#2563EB", color: "#fff", padding: "4px 10px", borderRadius: 6, fontFamily: "monospace", fontWeight: 800, fontSize: 13 }}>{liveInv.id}</div>
              </div>
            </div>
            <div style={{ background: "#0f2744", padding: "8px 20px", display: "flex", gap: 20, fontSize: 10, color: "#94a3b8" }}>
              <span>📍 {appSettings.company_addr}</span>
              <span>🏦 {appSettings.bank_name} {appSettings.bank_number} a.n. {appSettings.bank_holder}</span>
            </div>
          </div>

          {/* Detail Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 8, textTransform: "uppercase" }}>Detail Invoice</div>
              {[
                ["Tgl Invoice", liveInv.created_at ? new Date(liveInv.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : (liveInv.sent_at ? new Date(liveInv.sent_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—")],
                ["Issued", new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })],
                ["No. Invoice", liveInv.id],
                ["No. Order", liveInv.job_id || "—"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color: "#64748b", minWidth: 80 }}>{k}</span>
                  <span style={{ color: "#1e293b", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 8, textTransform: "uppercase" }}>Tagihan Kepada</div>
              <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13, marginBottom: 4 }}>{liveInv.customer}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>📱 {liveInv.phone}</div>
            </div>
          </div>

          {/* Service Table */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14, fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#1E3A5F" }}>
                {[["Deskripsi", "auto"], ["Jml Unit", "72px"], ["Harga Satuan", "100px"], ["Subtotal", "100px"]].map(([h, w]) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: h === "Deskripsi" ? "left" : "right", color: "#fff", fontWeight: 700, width: w, fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liveInv.labor > 0 && mArr.length === 0 && (
                <tr style={{ background: "#fff" }}>
                  <td style={{ padding: "8px 10px", color: "#1e293b" }}>{liveInv.service}</td>
                  <td style={{ padding: "8px 10px", color: "#475569", textAlign: "center" }}>{liveInv.units}</td>
                  <td style={{ padding: "8px 10px", color: "#475569", fontFamily: "monospace" }}>{((liveInv.labor || 0) / (liveInv.units || 1)).toLocaleString("id-ID")}</td>
                  <td style={{ padding: "8px 10px", color: "#1e293b", fontFamily: "monospace", fontWeight: 600 }}>{liveInv.labor.toLocaleString("id-ID")}</td>
                </tr>
              )}
              {mArr.length > 0 && mArr.map((m, mi) => (
                <tr key={mi} style={{ background: mi % 2 === 0 ? "#f0f9ff" : "#fff" }}>
                  <td style={{ padding: "8px 10px", color: "#1e293b" }}>
                    {m.nama}
                    {m.keterangan && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>({m.keterangan})</span>}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#475569", width: "72px" }}>{m.jumlah} {m.satuan}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#475569", textAlign: "right" }}>
                    {(() => {
                      const hF = m.harga_satuan > 0 ? m.harga_satuan
                        : (m.subtotal > 0 && m.jumlah > 0 ? Math.round(m.subtotal / m.jumlah) : 0);
                      return hF > 0 ? hF.toLocaleString("id-ID") : "—";
                    })()}
                  </td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>
                    {m.subtotal > 0 ? m.subtotal.toLocaleString("id-ID") : "—"}
                  </td>
                </tr>
              ))}
              {mArr.length === 0 && (liveInv.material || 0) > 0 && (
                <tr style={{ background: "#f0f9ff" }}>
                  <td style={{ padding: "8px 10px", color: "#64748b", fontStyle: "italic" }}>Material &amp; Spare Part</td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>—</td>
                  <td style={{ padding: "8px 10px" }}>—</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>
                    {(liveInv.material || 0).toLocaleString("id-ID")}
                  </td>
                </tr>
              )}
              {(liveInv.discount || 0) > 0 && (
                <tr style={{ background: "#fff1f2" }}>
                  <td style={{ padding: "8px 10px", color: "#be123c", fontStyle: "italic" }}>Discount</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", color: "#be123c" }}>—</td>
                  <td style={{ padding: "8px 10px", color: "#be123c" }}>—</td>
                  <td style={{ padding: "8px 10px", color: "#be123c", fontFamily: "monospace", fontWeight: 600 }}>-{liveInv.discount.toLocaleString("id-ID")}</td>
                </tr>
              )}
              {liveInv.trade_in && (liveInv.trade_in_amount || 0) > 0 && (
                <tr style={{ background: "#fff1f2" }}>
                  <td style={{ padding: "8px 10px", color: "#be123c", fontStyle: "italic" }}>Trade-In AC Lama</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", color: "#be123c" }}>—</td>
                  <td style={{ padding: "8px 10px", color: "#be123c" }}>—</td>
                  <td style={{ padding: "8px 10px", color: "#be123c", fontFamily: "monospace", fontWeight: 600 }}>-{(liveInv.trade_in_amount || 0).toLocaleString("id-ID")}</td>
                </tr>
              )}
              {liveInv.pph23 && (liveInv.pph23_amount || 0) > 0 && (
                <>
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 10px", color: "#475569" }}>Nilai Jasa (DPP)</td>
                    <td style={{ padding: "8px 10px", color: "#1e293b", fontFamily: "monospace" }}>{((liveInv.total || 0) + (liveInv.pph23_amount || 0)).toLocaleString("id-ID")}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ padding: "8px 10px", color: "#0369a1" }}>PPh 23 (2,5%) dipotong customer</td>
                    <td style={{ padding: "8px 10px", color: "#0369a1", fontFamily: "monospace", fontWeight: 600 }}>-{(liveInv.pph23_amount || 0).toLocaleString("id-ID")}</td>
                  </tr>
                </>
              )}
              <tr style={{ background: "#1E3A5F" }}>
                <td colSpan={3} style={{ padding: "8px 10px", color: "#fff", fontWeight: 700 }}>{liveInv.pph23 && (liveInv.pph23_amount || 0) > 0 ? "DIBAYAR KE ACLEAN" : "TOTAL TAGIHAN"}</td>
                <td style={{ padding: "8px 10px", color: "#fff", fontFamily: "monospace", fontWeight: 800, fontSize: 14 }}>Rp {liveInv.total.toLocaleString("id-ID")}</td>
              </tr>
            </tbody>
          </table>

          {/* Footer */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af", marginBottom: 6 }}>Informasi Pembayaran</div>
              <div style={{ fontSize: 11, color: "#475569" }}>Transfer Bank BCA</div>
              <div style={{ fontWeight: 800, color: "#1e293b", fontSize: 13, marginTop: 4 }}>{appSettings.bank_number}</div>
              <div style={{ fontSize: 11, color: "#475569" }}>a.n. {appSettings.bank_holder}</div>
            </div>
            <div style={{ background: liveInv.status === "OVERDUE" ? "#FEF2F2" : liveInv.status === "PAID" ? "#F0FDF4" : "#FFFBEB", borderRadius: 8, padding: "12px 14px", border: "1px solid " + (liveInv.status === "OVERDUE" ? "#fca5a5" : liveInv.status === "PAID" ? "#86efac" : "#fde68a") }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", marginBottom: 6 }}>Jatuh Tempo</div>
              <div style={{ fontWeight: 700, color: "#1e293b" }}>{liveInv.due || "Menunggu Approval"}</div>
              {liveInv.status === "OVERDUE" && <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 700, marginTop: 4 }}>⚠️ SUDAH JATUH TEMPO</div>}
              {liveInv.status === "PAID" && <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, marginTop: 4 }}>✅ LUNAS</div>}
            </div>
          </div>
          <div style={{ textAlign: "center", padding: "10px 0", borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, color: "#64748b" }}>Pertanyaan? Hubungi kami via WA: {appSettings.wa_number}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 4 }}>Terima kasih telah mempercayakan perawatan AC Anda kepada {appSettings.company_name}</div>
          </div>
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
