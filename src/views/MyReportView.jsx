import { memo, useState } from "react";
import { cs } from "../theme/cs.js";

function KasbonRequestModal({ currentUser, kasbonRequests, setKasbonRequests, insertKasbonRequest, sendWA, appSettings, userAccounts, supabase, onClose, showNotif }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const myPending = kasbonRequests.filter(r => r.teknisi_name === currentUser?.name && r.status === "PENDING");

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
      // WA notif ke Owner/Admin
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

        {/* Pending request indicator */}
        {myPending.length > 0 && (
          <div style={{ background: cs.yellow + "15", border: "1px solid " + cs.yellow + "44", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: cs.yellow }}>
            ⏳ Kamu masih punya <b>{myPending.length}</b> request kasbon yang menunggu approval
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 5 }}>Nominal (Rp) *</div>
            <input value={amount} onChange={e => { const v = e.target.value.replace(/\D/g, ""); setAmount(v ? Number(v).toLocaleString("id-ID") : ""); }}
              placeholder="contoh: 150.000"
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

function MyReportView({ laporanReports, ordersData, invoicesData, currentUser, searchLaporan, setSearchLaporan, setSelectedLaporan, setEditLaporanMode, setModalLaporanDetail, setEditLaporanForm, setLaporanBarangItems, setEditRepairType, setEditGratisAlasan, setActiveEditUnitIdx, setEditPhotoMode, setEditLaporanFotos, setEditStockMats, setLaporanInstallItems, openLaporanModal, openBAPModal, bapEnabled, safeArr, TODAY, INSTALL_ITEMS, downloadServiceReportPDF, kasbonRequests, setKasbonRequests, insertKasbonRequest, sendWA, appSettings, userAccounts, supabase, showNotif }) {
const myName = currentUser?.name || "";
// Get all submitted reports
const submittedReps = laporanReports.filter(r => r.teknisi === myName || r.helper === myName);
// Get my ORDERS_DATA jobs that don't have a report yet — show as pending
const myJobs = ordersData.filter(o => o.teknisi === myName || o.helper === myName);
const reportedJobIds = submittedReps.map(r => r.job_id);
const pendingJobs = myJobs.filter(o =>
  !reportedJobIds.includes(o.id) && (o.date || "") <= TODAY
);
const pendingAsDraft = pendingJobs.map(o => ({
  id: "PENDING_" + o.id, job_id: o.id, teknisi: o.teknisi, helper: o.helper || null,
  customer: o.customer, service: o.service, date: o.date, submitted: "Belum dibuat",
  status: "PENDING", kondisi_sebelum: "", kondisi_setelah: "", pekerjaan: [],
  rekomendasi: "", catatan: "", freon: "0", ampere: "", editLog: []
}));
let myReps = [...submittedReps, ...pendingAsDraft]
  .sort((a, b) => {
    const da = a.date || a.submitted?.slice(0, 10) || "";
    const db = b.date || b.submitted?.slice(0, 10) || "";
    if (da === TODAY && db !== TODAY) return -1;
    if (db === TODAY && da !== TODAY) return 1;
    return db.localeCompare(da);
  });

// ── AUTO-HIDE VERIFIED untuk Teknisi & Helper (hide laporan yang sudah selesai) ──
const userRole = currentUser?.role?.toLowerCase() || "";
const isTeknisiOrHelper = userRole === "teknisi" || userRole === "helper";
if (isTeknisiOrHelper) {
  myReps = myReps.filter(r => (r.status || "").toUpperCase() !== "VERIFIED");
}

// CUTOFF_DATE dihapus — tampilkan semua belum-laporan yang real, tanpa filter tanggal.
// Auto-hide VERIFIED untuk teknisi/helper tetap berlaku (laporan selesai tidak menumpuk).

const filtReps = myReps.filter(r =>
  !searchLaporan ||
  r.customer.toLowerCase().includes(searchLaporan.toLowerCase()) ||
  r.job_id.toLowerCase().includes(searchLaporan.toLowerCase())
);

// Kasbon: request milik saya saja, sorted newest first
const [showKasbonModal, setShowKasbonModal] = useState(false);
const myKasbon = (kasbonRequests || []).filter(r => r.teknisi_name === myName).slice(0, 10);
const pendingKasbonCount = myKasbon.filter(r => r.status === "PENDING").length;
const fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const fmtTgl = (d) => { try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d || "—"; } };
const sMap = { SUBMITTED: [cs.accent, "Submitted"], VERIFIED: [cs.green, "Terverifikasi"], REVISION: [cs.yellow, "Perlu Revisi"], REJECTED: [cs.red, "Ditolak"], PENDING: [cs.muted, "Belum Dibuat"] };
const badge = (s) => {
  // Make badge case-insensitive for status lookup
  const normalizedStatus = (s || "").toUpperCase();
  const [col, lbl] = sMap[normalizedStatus] || [cs.muted, s];
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: col + "22", color: col, border: "1px solid " + col + "44", fontWeight: 700 }}>{lbl}</span>;
};

return (
  <div style={{ display: "grid", gap: 16 }}>
    <div>
      <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>Laporan Saya</div>
      <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
        {isTeknisiOrHelper ? "📋 Menampilkan laporan baru & revisi saja. Laporan terverifikasi disembunyikan. " : ""}
        {!isTeknisiOrHelper ? "Semua job kamu — buat laporan untuk job yang belum dilaporkan, edit yang sudah masuk" : ""}
      </div>
    </div>

    {/* Stats */}
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${isTeknisiOrHelper ? 2 : 3},1fr)`, gap: 10 }}>
      {(isTeknisiOrHelper
        ? [["Belum Laporan", pendingAsDraft.length, cs.muted], ["Submitted", submittedReps.filter(r => (r.status || "").toUpperCase() === "SUBMITTED").length, cs.accent]]
        : [["Belum Laporan", pendingAsDraft.length, cs.muted], ["Submitted", submittedReps.filter(r => (r.status || "").toUpperCase() === "SUBMITTED").length, cs.accent], ["Terverifikasi", submittedReps.filter(r => (r.status || "").toUpperCase() === "VERIFIED").length, cs.green]]
      ).map(([lbl, val, col]) => (
        <div key={lbl} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16, textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 26, color: col }}>{val}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>{lbl}</div>
        </div>
      ))}
    </div>

    {/* Kasbon Button + History */}
    {isTeknisiOrHelper && (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: myKasbon.length > 0 ? 12 : 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>💰 Kasbon</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>
              {pendingKasbonCount > 0
                ? <span style={{ color: cs.yellow }}>⏳ {pendingKasbonCount} menunggu approval</span>
                : "Request uang muka ke Admin/Owner"}
            </div>
          </div>
          <button onClick={() => setShowKasbonModal(true)}
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
    )}

    {/* Kasbon Modal */}
    {showKasbonModal && (
      <KasbonRequestModal
        currentUser={currentUser} kasbonRequests={kasbonRequests || []} setKasbonRequests={setKasbonRequests}
        insertKasbonRequest={insertKasbonRequest} sendWA={sendWA} appSettings={appSettings}
        userAccounts={userAccounts} supabase={supabase}
        onClose={() => setShowKasbonModal(false)}
        showNotif={showNotif || ((msg) => alert(msg))}
      />
    )}

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>&#128269;</span>
      <input id="searchLaporan" value={searchLaporan} onChange={e => setSearchLaporan(e.target.value)}
        placeholder="Cari customer atau ID job..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 38px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      {searchLaporan && <button onClick={() => setSearchLaporan("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>x</button>}
    </div>

    {/* List */}
    {filtReps.length === 0
      ? <div style={{ background: cs.card, borderRadius: 14, padding: 40, textAlign: "center", color: cs.muted }}>
        Belum ada laporan. Gunakan tombol Laporan di halaman Jadwal.
      </div>
      : filtReps.map(r => {
        const isPending = r.status === "PENDING";
        const canEdit = (r.status === "SUBMITTED" || r.status === "REVISION") &&
          ((currentUser?.role === "Owner" || currentUser?.role === "Admin") || r.teknisi === myName || r.helper === myName);
        const isReadOnly = false;
        const isHelper = r.helper === myName;
        return (
          <div key={r.id} style={{ background: cs.card, border: "1px solid " + (r.status === "REVISION" ? cs.yellow : r.status === "VERIFIED" ? cs.green : cs.border) + "44", borderRadius: 14, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent }}>{r.job_id}</span>
                {badge(r.status)}
                {isHelper && <span style={{ fontSize: 10, color: cs.muted, background: cs.surface, padding: "1px 7px", borderRadius: 99 }}>Helper</span>}
                {safeArr(r.editLog).length > 0 && <span style={{ fontSize: 10, color: cs.muted }}>Diedit {safeArr(r.editLog).length}x</span>}
              </div>
              <span style={{ fontSize: 11, color: cs.muted }}>{r.submitted}</span>
            </div>
            <div style={{ fontWeight: 700, color: cs.text, fontSize: 14, marginBottom: 4 }}>{r.customer}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8 }}>{r.service} — {r.date}</div>

            {r.status === "REVISION" && (
              <div style={{ background: cs.yellow + "12", border: "1px solid " + cs.yellow + "33", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: cs.yellow }}>
                Laporan diminta revisi oleh Owner/Admin. Silakan edit dan simpan ulang.
              </div>
            )}

            {/* Edit log visible to teknisi */}
            {safeArr(r.editLog).length > 0 && (
              <div style={{ background: cs.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Riwayat Perubahan</div>
                {safeArr(r.editLog).map((log, li) => (
                  <div key={li} style={{ fontSize: 10, color: cs.muted, marginBottom: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ color: cs.accent, fontWeight: 600 }}>{log.by}</span>
                    <span>{log.at}</span>
                    <span>ubah {log.field}:</span>
                    <span style={{ color: cs.red, textDecoration: "line-through" }}>{log.old}</span>
                    <span>→</span>
                    <span style={{ color: cs.green, fontWeight: 600 }}>{log.new}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              {isPending && (() => {
                // Cek apakah teknisi lain sudah mengisi laporan untuk job ini
                const jobReport = laporanReports.find(lr => lr.job_id === r.job_id && lr.status !== "PENDING");
                if (jobReport && jobReport.teknisi !== myName) {
                  return (
                    <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: cs.muted }}>
                      🔒 Laporan sudah diisi oleh <b style={{ color: cs.accent }}>{jobReport.teknisi}</b>
                    </div>
                  );
                }
                const srcOrder = ordersData.find(o => o.id === r.job_id) || { id: r.job_id, customer: r.customer, service: r.service, date: r.date, teknisi: r.teknisi, helper: r.helper, units: 1 };
                if (!bapEnabled) return (
                  <button onClick={() => openLaporanModal?.(srcOrder)}
                    style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    📝 Buat Laporan
                  </button>
                );
                return (
                  <button onClick={() => openBAPModal?.(srcOrder)}
                    style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    📋 Buat BAP
                  </button>
                );
              })()}
              {isReadOnly && (
                <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: cs.muted, display: "flex", alignItems: "center", gap: 6 }}>
                  🔒 Dibuat oleh <b style={{ color: cs.accent, marginLeft: 4 }}>{r.teknisi}</b>
                  <span style={{ color: cs.muted, marginLeft: 4 }}>— kamu sebagai helper</span>
                </div>
              )}
              {canEdit && (
                <>
                  {/* Tulis Ulang — buka form laporan dari awal, hapus data lama */}
                  <button onClick={() => {
                    const srcOrder = ordersData.find(o => o.id === r.job_id) || {
                      id: r.job_id, customer: r.customer, service: r.service,
                      type: r.type || "AC Split 0.5-1PK", units: r.total_units || (r.units || []).length || 1,
                      teknisi: r.teknisi, helper: r.helper, date: r.date, time: r.time || "09:00"
                    };
                    openLaporanModal({ ...srcOrder, _rewriteId: r.id });
                  }}
                    style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    🔄 Tulis Ulang
                  </button>
                  {/* Edit biasa — edit catatan/rekomendasi saja */}
                  <button onClick={() => {
                    const mats = JSON.parse(JSON.stringify(r.materials || []));
                    // ✨ PHASE 2: Load barang items separately from existing laporan
                    const barangFromMats = mats.filter(m => m.keterangan === "barang").map(b => ({
                      id: Date.now() + Math.random(),
                      nama: b.nama,
                      jumlah: b.jumlah,
                      satuan: b.satuan || "pcs",
                      harga_satuan: b.harga_satuan || 0,
                      _isManual: false
                    }));
                    setLaporanBarangItems(barangFromMats);
                    setEditLaporanForm({ rekomendasi: r.rekomendasi || "", catatan_global: r.catatan_global || r.catatan || "", editUnits: JSON.parse(JSON.stringify(r.units || [])), editJasaItems: mats.filter(m => m.keterangan === "jasa"), editMatItems: mats.filter(m => m.keterangan !== "jasa" && m.keterangan !== "barang") });
                    // ✨ Load repair type from existing invoice
                    const existInvForEdit = invoicesData.find(i => i.job_id === r.id);
                    setEditRepairType(existInvForEdit?.repair_gratis || "berbayar");
                    setEditGratisAlasan("");
                    setActiveEditUnitIdx(0);
                    setEditPhotoMode(false); // Reset photo mode
                    setEditLaporanFotos([]); // Clear any previous photo uploads
                    setEditStockMats([]); // Clear stock-linked material picker
                    // ── Install: rebuild laporanInstallItems from existing materials ──
                    if (r.service === "Install") {
                      const installMap = {};
                      (r.materials || []).forEach(mat => {
                        const ii = INSTALL_ITEMS.find(item => item.label === mat.nama || item.key === mat.id);
                        if (ii) installMap[ii.key] = String(mat.jumlah || 0);
                      });
                      setLaporanInstallItems(installMap);
                    }
                    setSelectedLaporan(r); setEditLaporanMode(true); setModalLaporanDetail(true);
                  }}
                    style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    ✏️ Edit
                  </button>
                </>
              )}
              {!isPending && (
                <button onClick={() => { setSelectedLaporan(r); setEditLaporanMode(false); setModalLaporanDetail(true); }}
                  style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                  Lihat Detail
                </button>
              )}
              {!isPending && downloadServiceReportPDF && (
                <button onClick={() => {
                  const relInv = invoicesData.find(i => i.job_id === r.job_id) || {};
                  downloadServiceReportPDF(r, relInv);
                }}
                  style={{ background: "#1e3a5f22", border: "1px solid #1e3a5f44", color: "#93c5fd", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  📋 Report Card
                </button>
              )}
            </div>
          </div>
        );
      })
    }
  </div>
);
}

export default memo(MyReportView);
