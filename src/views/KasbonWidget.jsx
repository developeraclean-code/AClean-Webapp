import { useState } from "react";
import { cs } from "../theme/cs.js";

// Widget Kasbon untuk dashboard teknisi/helper — tombol Request + riwayat + modal.
// Self-contained: kelola sendiri modal state. Render di TechMobileView & DashboardView.
function KasbonRequestModal({ currentUser, kasbonRequests, setKasbonRequests, insertKasbonRequest, sendWA, appSettings, userAccounts, supabase, onClose, showNotif }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const myPending = (kasbonRequests || []).filter(r => r.teknisi_name === currentUser?.name && r.status === "PENDING");

  const submit = async () => {
    const amt = parseInt(amount.replace(/\D/g, "")) || 0;
    if (!amt || amt < 10000) { showNotif("⚠️ Nominal minimal Rp 10.000"); return; }
    if (!reason.trim()) { showNotif("⚠️ Alasan/keperluan wajib diisi"); return; }
    setSubmitting(true);
    try {
      const id = "KSB-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
      const payload = {
        id, teknisi_name: (currentUser?.name || "").trim(),
        teknisi_phone: currentUser?.phone || null,
        amount: amt, reason: reason.trim(), status: "PENDING",
        requested_at: new Date().toISOString(),
      };
      const { data, error } = await insertKasbonRequest(supabase, payload);
      if (error) { showNotif("❌ Gagal kirim request: " + error.message); return; }
      setKasbonRequests(prev => [data || payload, ...prev]);
      const owners = (userAccounts || []).filter(u => u.role === "Owner" || u.role === "Admin");
      owners.forEach(u => { if (u.phone) sendWA(u.phone, `💰 *Request Kasbon*\n\nDari: ${currentUser?.name}\nNominal: Rp ${amt.toLocaleString("id-ID")}\nKeperluan: ${reason.trim()}\n\nSilakan approve/reject di menu Laporan Tim → Kasbon.\n— ${appSettings?.app_name || "AClean"}`); });
      showNotif("✅ Request kasbon terkirim — menunggu approval");
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 600, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: 24, paddingBottom: 32 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>💰 Request Kasbon</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Permintaan uang muka — akan dicatat ke Biaya setelah disetujui</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {myPending.length > 0 && (
          <div style={{ background: cs.yellow + "15", border: "1px solid " + cs.yellow + "44", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: cs.yellow }}>
            ⏳ Kamu masih punya <b>{myPending.length}</b> request kasbon yang menunggu approval
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 5 }}>Nominal (Rp) *</div>
            <input value={amount} onChange={e => { const v = e.target.value.replace(/\D/g, ""); setAmount(v ? Number(v).toLocaleString("id-ID") : ""); }}
              placeholder="contoh: 150.000" inputMode="numeric"
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 5 }}>Keperluan / Alasan *</div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="Bensin, sparepart, makan siang, dll..."
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }} />
          </div>
          <button onClick={submit} disabled={submitting}
            style={{ background: submitting ? cs.surface : "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: submitting ? cs.muted : "#fff", padding: "13px", borderRadius: 10, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14 }}>
            {submitting ? "⏳ Mengirim..." : "💰 Kirim Request Kasbon"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KasbonWidget({ currentUser, kasbonRequests, setKasbonRequests, insertKasbonRequest, sendWA, appSettings, userAccounts, supabase, showNotif }) {
  const [showModal, setShowModal] = useState(false);
  const myName = currentUser?.name || "";
  const myKasbon = (kasbonRequests || []).filter(r => r.teknisi_name === myName).slice(0, 10);
  const pendingCount = myKasbon.filter(r => r.status === "PENDING").length;
  const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const fmtTgl = (d) => { try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d || "—"; } };

  return (
    <>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: myKasbon.length > 0 ? 12 : 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>💰 Kasbon</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>
              {pendingCount > 0
                ? <span style={{ color: cs.yellow }}>⏳ {pendingCount} menunggu approval</span>
                : "Request uang muka ke Admin/Owner"}
            </div>
          </div>
          <button onClick={() => setShowModal(true)}
            style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", border: "none", color: "#fff", padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            + Request
          </button>
        </div>
        {myKasbon.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {myKasbon.map(r => {
              const statusStyle = { PENDING: [cs.yellow, "⏳ Menunggu"], APPROVED: [cs.green, "✅ Disetujui"], REJECTED: [cs.red, "❌ Ditolak"] }[r.status] || [cs.muted, r.status];
              return (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: cs.surface, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: cs.text }}>{fmtRp(r.amount)}</div>
                    <div style={{ color: cs.muted, fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason}</div>
                    {r.review_notes && <div style={{ color: cs.muted, fontSize: 10, marginTop: 1, fontStyle: "italic" }}>Catatan: {r.review_notes}</div>}
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: statusStyle[0] }}>{statusStyle[1]}</div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>{fmtTgl(r.requested_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <KasbonRequestModal
          currentUser={currentUser} kasbonRequests={kasbonRequests || []} setKasbonRequests={setKasbonRequests}
          insertKasbonRequest={insertKasbonRequest} sendWA={sendWA} appSettings={appSettings}
          userAccounts={userAccounts} supabase={supabase}
          onClose={() => setShowModal(false)}
          showNotif={showNotif || ((msg) => alert(msg))}
        />
      )}
    </>
  );
}
