import { memo } from "react";
import { cs } from "../theme/cs.js";

function LaporanTimView({ laporanReports, setLaporanReports, ordersData, setOrdersData, invoicesData, setInvoicesData, priceListData, currentUser, isMobile, laporanDateFilter, setLaporanDateFilter, laporanDateFrom, setLaporanDateFrom, laporanDateTo, setLaporanDateTo, laporanSvcFilter, setLaporanSvcFilter, laporanStatusFilter, setLaporanStatusFilter, laporanTeamFilter, setLaporanTeamFilter, searchLaporan, setSearchLaporan, laporanPage, setLaporanPage, userAccounts, setSelectedLaporan, setEditLaporanMode, setModalLaporanDetail, setEditLaporanForm, setLaporanBarangItems, setEditRepairType, setEditGratisAlasan, setActiveEditUnitIdx, setEditPhotoMode, setEditLaporanFotos, setLaporanInstallItems, setActiveMenu, safeArr, fotoSrc, showConfirm, showNotif, addAgentLog, auditUserName, getLocalDate, fmt, updateServiceReport, deleteServiceReport, insertInvoice, deleteInvoice, updateOrder, updateOrderStatus, markInvoicePaid, lookupHargaGlobal, hargaPerUnitFromTipe, getBracketKey, hitungLabor, sendWA, supabase, LAP_PAGE_SIZE, INSTALL_ITEMS, downloadServiceReportPDF }) {
const sMap = { SUBMITTED: [cs.accent, "Submitted"], VERIFIED: [cs.green, "Terverifikasi"], REVISION: [cs.yellow, "Perlu Revisi"], REJECTED: [cs.red, "Ditolak"] };
const badge = (s) => {
  // Case insensitive status lookup
  const statusKey = (s || "").toUpperCase();
  const [col, lbl] = sMap[statusKey] || [cs.muted, s];
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: col + "22", color: col, fontWeight: 700 }}>{lbl}</span>;
};
const statusOrder = { SUBMITTED: 0, REVISION: 1, VERIFIED: 2, REJECTED: 3 };
// Fix sort to handle case-insensitive status
const getStatusOrder = (status) => statusOrder[(status || "").toUpperCase()] || 9;
// techColors — warna per teknisi (konsisten dengan kalender & dashboard)
const techColors = Object.fromEntries(
  [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map((n, i) => [
    n, ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"][i % 8]
  ])
);
// ── SIM-8: date + service + status filters + pagination ──
const todayLap = getLocalDate();
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
let filtered = [...laporanReports];

// ── AUTO-HIDE VERIFIED untuk Teknisi & Helper (hide laporan yang sudah selesai) ──
const userRole = currentUser?.role?.toLowerCase() || "";
const isTeknisiOrHelper = userRole === "teknisi" || userRole === "helper";

// Debug: log all status values
if (isTeknisiOrHelper && filtered.length > 0) {
  const statusCounts = {};
  filtered.forEach(r => {
    const s = r.status || "unknown";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
}

if (isTeknisiOrHelper) {
  const beforeCount = filtered.length;
  // Filter out VERIFIED — case insensitive
  filtered = filtered.filter(r => {
    const status = (r.status || "").toUpperCase();
    return status !== "VERIFIED";
  });
}

if (laporanDateFilter === "Hari Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "").slice(0, 10) === todayLap);
else if (laporanDateFilter === "Minggu Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "") >= weekAgo);
else if (laporanDateFilter === "Bulan Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "") >= monthAgo);
else if (laporanDateFilter === "Range" && (laporanDateFrom || laporanDateTo)) {
  // Convert dd/mm/yyyy → yyyy-mm-dd untuk perbandingan
  const parseDate = (s) => {
    if (!s) return "";
    const parts = s.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    return s; // already yyyy-mm-dd
  };
  const fromStr = parseDate(laporanDateFrom);
  const toStr = parseDate(laporanDateTo);
  filtered = filtered.filter(r => {
    const d = (r.date || r.submitted_at || "").slice(0, 10);
    if (fromStr && toStr) return d >= fromStr && d <= toStr;
    if (fromStr) return d >= fromStr;
    if (toStr) return d <= toStr;
    return true;
  });
}
if (laporanSvcFilter !== "Semua") filtered = filtered.filter(r => (r.service || "") === laporanSvcFilter);
if (laporanStatusFilter !== "Semua") filtered = filtered.filter(r => (r.status || "").toUpperCase() === laporanStatusFilter.toUpperCase());
if (laporanTeamFilter !== "Semua") filtered = filtered.filter(r => r.teknisi === laporanTeamFilter || r.helper === laporanTeamFilter);
if (searchLaporan.trim()) {
  const q = searchLaporan.trim().toLowerCase();
  filtered = filtered.filter(r =>
    (r.customer || "").toLowerCase().includes(q) ||
    (r.teknisi || "").toLowerCase().includes(q) ||
    (r.job_id || r.id || "").toLowerCase().includes(q) ||
    (r.helper || "").toLowerCase().includes(q) ||
    (r.service || "").toLowerCase().includes(q) ||
    (r.catatan_global || r.catatan || "").toLowerCase().includes(q) ||
    (r.rekomendasi || "").toLowerCase().includes(q)
  );
}
filtered.sort((a, b) => { const dA = a.submitted_at || a.date || "", dB = b.submitted_at || b.date || ""; if (dB !== dA) return dB.localeCompare(dA); return getStatusOrder(a.status) - getStatusOrder(b.status); });
const totPgL = Math.ceil(filtered.length / LAP_PAGE_SIZE) || 1;
const curPgL = Math.min(laporanPage, totPgL);
const pageLap = filtered.slice((curPgL - 1) * LAP_PAGE_SIZE, curPgL * LAP_PAGE_SIZE);

const verifyLaporan = async (r) => {
  setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "VERIFIED" } : x));
  const { error: vErr } = await updateServiceReport(supabase, r.id, { status: "VERIFIED" }, auditUserName());
  if (vErr) {
    console.warn("❌ verify laporan failed:", vErr.message);
    await supabase.from("service_reports").update({ status: "VERIFIED" }).eq("id", r.id).catch(e => console.warn("retry also failed:", e.message));
  }
  addAgentLog("LAPORAN_VERIFIED", `Laporan ${r.job_id} (${r.customer}) diverifikasi`, "SUCCESS");

  const existInv = invoicesData.find(i => i.job_id === r.job_id);
  if (existInv) {
    showNotif(`✅ Laporan verified! Invoice ${existInv.id} sudah ada — status: ${existInv.status}`);
  } else {
    const ord = ordersData.find(o => o.id === r.job_id);
    const invId = "INV" + Date.now().toString().slice(-7) + Math.floor(Math.random() * 100).toString().padStart(2, "0");

    const _rawMats = (() => {
      if (r.materials_json) {
        try { return JSON.parse(r.materials_json); } catch (_) { }
      }
      return safeArr(r.materials);
    })();
    const vMats = _rawMats.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
    const vMDetail = vMats.map(m => {
      const nama2 = (m.nama || "").toLowerCase();
      const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
      const rawQ = parseFloat(m.jumlah) || 0;
      const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
      let hSat = parseFloat(m.harga_satuan) || 0;
      if (!hSat) hSat = lookupHargaGlobal(m.nama, m.satuan);
      return { nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: hSat, subtotal: hSat * qty, keterangan: m.keterangan || "" };
    });

    if (!vMDetail.some(m => m.keterangan === "jasa")) {
      const rUnits = Array.isArray(r.units) ? r.units : [];
      const unitsWithTipe = rUnits.filter(u => u && u.tipe);
      if (unitsWithTipe.length > 0) {
        unitsWithTipe.forEach((u) => {
          const hargaUnit = hargaPerUnitFromTipe(r.service, u.tipe, priceListData);
          if (hargaUnit > 0) {
            const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
            const bracketLabel = getBracketKey(r.service, u.tipe) || u.tipe;
            vMDetail.unshift({
              nama: (r.service || "") + " " + bracketLabel + " (" + unitLabel + ")",
              jumlah: 1, satuan: "unit",
              harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
            });
          }
        });
      } else {
        const svcFeeV = hitungLabor(r.service, ord?.type, (Array.isArray(r.units) ? r.units.length : r.units) || ord?.units || 1);
        if (svcFeeV > 0) {
          const uCount = Math.max(1, (Array.isArray(r.units) ? r.units.length : parseInt(r.units)) || parseInt(ord?.units) || 1);
          vMDetail.unshift({ nama: (r.service || "") + (ord?.type ? " - " + ord.type : "") + " (Servis)", jumlah: uCount, satuan: "unit", harga_satuan: Math.round(svcFeeV / uCount), subtotal: svcFeeV, keterangan: "jasa" });
        }
      }
    }

    const laborV = vMDetail.filter(m => m.keterangan === "jasa" || m.keterangan === "repair").reduce((s, m) => s + m.subtotal, 0) || hitungLabor(r.service, ord?.type, (Array.isArray(r.units) ? r.units.length : r.units) || ord?.units || 1);
    const matV = vMDetail.filter(m => m.keterangan !== "jasa" && m.keterangan !== "repair").reduce((s, m) => s + m.subtotal, 0);

    const todayInv2 = new Date().toISOString().slice(0, 10);
    const isComplainSvc2 = r.service === "Complain";
    const prevGaransiActive2 = isComplainSvc2
      ? invoicesData.filter(inv =>
        inv.customer === r.customer && inv.service !== "Complain" &&
        inv.garansi_expires && inv.garansi_expires >= todayInv2 &&
        ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
      ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    let finalLabor2 = laborV;
    let finalMat2 = matV;
    let finalTotal2 = laborV + matV;
    let finalStatus2 = "PENDING_APPROVAL";

    if (isComplainSvc2 && prevGaransiActive2) {
      finalLabor2 = 0;
      finalTotal2 = matV;
      if (finalTotal2 === 0) finalStatus2 = "PAID";
    } else if (isComplainSvc2 && laborV + matV === 0) {
      const BIAYA_CEK2 = (() => {
        const pl = priceListData.find(r2 => r2.service === "Repair" && r2.type === "Biaya Pengecekan AC");
        return (pl && pl.price > 0) ? pl.price : 100000;
      })();
      finalLabor2 = BIAYA_CEK2;
      finalTotal2 = BIAYA_CEK2;
    }

    const totalInv = finalTotal2;
    const newInv = {
      id: invId, job_id: r.job_id, laporan_id: r.id,
      customer: r.customer, phone: r.phone || ord?.phone || "",
      service: r.service + (ord?.type ? " - " + ord.type : ""), units: r.units || ord?.units || 1,
      teknisi: r.teknisi || "",
      labor: finalLabor2, material: finalMat2,
      materials_detail: vMDetail.length > 0 ? JSON.stringify(vMDetail) : null,
      dadakan: 0, discount: 0,
      total: totalInv,
      status: finalStatus2,
      garansi_days: 30, garansi_expires: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      sent: false, created_at: new Date().toISOString()
    };
    const { data: oldDB, error: fetchOldErr } = await supabase
      .from("invoices").select("id").eq("job_id", r.job_id);
    if (fetchOldErr) {
      console.error("[AUTO_INVOICE] gagal cek existing:", fetchOldErr.message);
      showNotif("❌ Gagal verifikasi invoice existing — coba lagi.");
      return;
    }
    if (oldDB && oldDB.length > 0) {
      for (const oi of oldDB) {
        const { error: delErr } = await deleteInvoice(supabase, oi.id, auditUserName());
        if (delErr) {
          console.error("[AUTO_INVOICE] gagal hapus", oi.id, delErr.message);
          showNotif("❌ Gagal hapus invoice lama — coba lagi.");
          return;
        }
      }
      setInvoicesData(prev => prev.filter(inv => inv.job_id !== r.job_id));
    }
    setInvoicesData(prev => [...prev, newInv]);
    const { error: iErr } = await insertInvoice(supabase, newInv);
    if (iErr) showNotif("⚠️ Invoice gagal simpan: " + iErr.message);
    else {
      await updateOrder(supabase, r.job_id, { invoice_id: invId }, auditUserName());
      setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, invoice_id: invId } : o));
      addAgentLog("AUTO_INVOICE", `Invoice ${invId} auto-dibuat dari laporan ${r.job_id}`, "SUCCESS");
      showNotif(`✅ Invoice ${invId} dibuat (${fmt(totalInv)}) — tunggu approval Owner/Admin`);
      const owners = userAccounts.filter(u => u.role === "Owner" || u.role === "Admin");
      owners.forEach(o => { if (o?.phone) sendWA(o.phone, `⚡ *Invoice Auto-Generated*\n\nJob: *${r.job_id}*\nCustomer: ${r.customer}\nService: ${r.service}\nTotal: *${fmt(totalInv)}*\n\nMohon cek dan approve invoice di menu Invoice. — AClean`); });
    }
  }
};

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>Laporan Tim Teknisi <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filtered.length})</span></div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
          {isTeknisiOrHelper ? "📋 Menampilkan laporan baru & revisi saja. Laporan terverifikasi disembunyikan. " : ""}
          {!isTeknisiOrHelper ? "Verifikasi laporan, cek riwayat edit, tandai sesuai atau minta revisi" : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["SUBMITTED", cs.accent, "Baru"], ["VERIFIED", cs.green, "Verified"], ["REVISION", cs.yellow, "Revisi"], ["REJECTED", cs.red, "Ditolak"]].map(([s, col, lbl]) => (
          <span key={s} style={{ fontSize: 11, padding: "5px 11px", borderRadius: 99, background: col + "18", color: col, border: "1px solid " + col + "33", fontWeight: 700 }}>
            {laporanReports.filter(r => (r.status || "").toUpperCase() === s).length} {lbl}
          </span>
        ))}
      </div>
    </div>
    {/* Filters: date + service + status + tim */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {/* Date filter — tambah Hari Ini */}
      {[["Semua", "📋"], ["Hari Ini", "🔴"], ["Minggu Ini", "📅"], ["Bulan Ini", "📅"]].map(([f, ic]) => (
        <button key={f} onClick={() => { setLaporanDateFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanDateFilter === f ? cs.accent : cs.border),
            background: laporanDateFilter === f ? cs.accent + "22" : cs.surface,
            color: laporanDateFilter === f ? cs.accent : cs.muted,
            fontWeight: laporanDateFilter === f ? 700 : 400
          }}>
          {ic} {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {["Semua", "Cleaning", "Install", "Repair", "Complain"].map(f => (
        <button key={f} onClick={() => { setLaporanSvcFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanSvcFilter === f ? cs.accent : cs.border),
            background: laporanSvcFilter === f ? cs.accent + "22" : cs.surface,
            color: laporanSvcFilter === f ? cs.accent : cs.muted,
            fontWeight: laporanSvcFilter === f ? 700 : 400
          }}>
          {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {["Semua", "SUBMITTED", "VERIFIED", "REVISION", "REJECTED"].map(f => (
        <button key={f} onClick={() => { setLaporanStatusFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanStatusFilter === f ? (sMap[f] || [cs.accent])[0] : cs.border),
            background: laporanStatusFilter === f ? (sMap[f] || [cs.accent])[0] + "22" : cs.surface,
            color: laporanStatusFilter === f ? (sMap[f] || [cs.accent])[0] : cs.muted,
            fontWeight: laporanStatusFilter === f ? 700 : 400
          }}>
          {f === "Semua" ? "Semua" : f === "SUBMITTED" ? "Baru" : f === "VERIFIED" ? "Verified" : f === "REVISION" ? "Revisi" : "Ditolak"}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {/* Filter per tim/teknisi */}
      {["Semua", ...[...new Set([
        ...laporanReports.map(r => r.teknisi),
        ...laporanReports.map(r => r.helper)
      ].filter(Boolean))].sort()].map(f => (
        <button key={f} onClick={() => { setLaporanTeamFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanTeamFilter === f ? cs.green : cs.border),
            background: laporanTeamFilter === f ? cs.green + "22" : cs.surface,
            color: laporanTeamFilter === f ? cs.green : cs.muted,
            fontWeight: laporanTeamFilter === f ? 700 : 400,
            display: "flex", alignItems: "center", gap: 4
          }}>
          {f !== "Semua" && (
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: techColors?.[f] || cs.accent, display: "inline-block"
            }} />
          )}
          {f === "Semua" ? "👥 Semua Tim" : f}
        </button>
      ))}
    </div>
    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
      <input id="searchLaporan" value={searchLaporan} onChange={e => { setSearchLaporan(e.target.value); setLaporanPage(1); }}
        placeholder="Cari nama teknisi, customer, ID job, atau layanan..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 38px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchLaporan && <button onClick={() => { setSearchLaporan(""); setLaporanPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
    </div>
    {/* ── DATE RANGE PICKER ── */}
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px"
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📅 Rentang Tanggal:</span>
      {/* Input dari */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: cs.muted }}>Dari</span>
        <input
          type="date"
          value={laporanDateFrom}
          onChange={e => {
            setLaporanDateFrom(e.target.value);
            setLaporanDateFilter("Range");
            setLaporanPage(1);
          }}
          style={{
            background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
            padding: "5px 9px", fontSize: 12, color: cs.text, cursor: "pointer",
            colorScheme: "dark"
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: cs.muted }}>–</span>
      {/* Input sampai */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: cs.muted }}>Sampai</span>
        <input
          type="date"
          value={laporanDateTo}
          onChange={e => {
            setLaporanDateTo(e.target.value);
            setLaporanDateFilter("Range");
            setLaporanPage(1);
          }}
          style={{
            background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
            padding: "5px 9px", fontSize: 12, color: cs.text, cursor: "pointer",
            colorScheme: "dark"
          }}
        />
      </div>
      {/* Info hasil + tombol reset */}
      {laporanDateFilter === "Range" && (laporanDateFrom || laporanDateTo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: cs.accent, fontWeight: 600 }}>
            {filtered.length} laporan
          </span>
          <button
            onClick={() => {
              setLaporanDateFrom("");
              setLaporanDateTo("");
              setLaporanDateFilter("Semua");
              setLaporanPage(1);
            }}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 99,
              background: cs.red + "22", border: "1px solid " + cs.red + "44",
              color: cs.red, cursor: "pointer", fontWeight: 600
            }}>
            ✕ Reset
          </button>
        </div>
      )}
    </div>

    {/* ── LAPORAN HARI INI — selalu tampil di atas ── */}
    {(() => {
      const todayStr = getLocalDate();
      const todayReps = laporanReports.filter(r =>
        (r.date || r.submitted_at || "").slice(0, 10) === todayStr
      );
      if (todayReps.length === 0 && laporanDateFilter === "Semua") return null;
      if (laporanDateFilter !== "Semua") return null; // sudah difilter, tidak perlu card ini
      return (
        <div style={{ background: cs.card, border: "2px solid " + cs.accent + "44", borderRadius: 14, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: cs.accent }}>
              🔴 Laporan Hari Ini — {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div style={{ fontSize: 11, color: cs.muted }}>{todayReps.length} laporan</div>
          </div>
          {todayReps.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted, textAlign: "center", padding: "10px 0" }}>
              Belum ada laporan masuk hari ini
            </div>
          ) : (
            <div style={{ display: "grid", gap: 7 }}>
              {todayReps
                .sort((a, b) => (sMap[a.status] ? 0 : 1) - (sMap[b.status] ? 0 : 1))
                .map(r => {
                  const [col] = sMap[r.status] || [cs.muted];
                  const tcol = techColors?.[r.teknisi] || cs.accent;
                  return (
                    <div key={r.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: cs.surface, borderRadius: 10, padding: "8px 12px",
                      border: "1px solid " + col + "33"
                    }}>
                      {/* Avatar teknisi */}
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, background: tcol + "33",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 800, color: tcol, flexShrink: 0
                      }}>
                        {(r.teknisi || "?")[0]}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: cs.text,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                        }}>
                          {r.customer} · {r.service}
                        </div>
                        <div style={{ fontSize: 11, color: cs.muted }}>
                          👷 {r.teknisi}{r.helper ? " + " + r.helper : ""}
                          {" · "}{r.job_id || r.id}
                        </div>
                      </div>
                      {/* Status badge */}
                      <div style={{
                        fontSize: 10, padding: "3px 9px", borderRadius: 99,
                        background: col + "22", color: col, fontWeight: 700, flexShrink: 0
                      }}>
                        {r.status === "SUBMITTED" ? "Baru" : r.status === "VERIFIED" ? "Verified" :
                          r.status === "REVISION" ? "Revisi" : "Ditolak"}
                      </div>
                      {/* Tombol verifikasi cepat */}
                      {r.status === "SUBMITTED" && (currentUser?.role === "Admin" || currentUser?.role === "Owner") && (
                        <button onClick={() => verifyLaporan(r)}
                          style={{
                            fontSize: 11, padding: "4px 10px", borderRadius: 7,
                            background: cs.green + "22", border: "1px solid " + cs.green + "44",
                            color: cs.green, cursor: "pointer", fontWeight: 600, flexShrink: 0
                          }}>
                          ✅ Verify
                        </button>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>
      );
    })()}

    {/* List */}
    {filtered.length === 0
      ? <div style={{ background: cs.card, borderRadius: 14, padding: 40, textAlign: "center", color: cs.muted }}>Tidak ada laporan</div>
      : pageLap.map(r => (
        <div key={r.id} style={{ background: cs.card, border: "1px solid " + (sMap[r.status] ? sMap[r.status][0] : cs.border) + "33", borderRadius: 12, padding: "14px 16px" }}>
          {/* Card header — responsive */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: cs.accent, fontSize: 13 }}>{r.job_id}</span>
              {badge(r.status)}
              {safeArr(r.editLog).length > 0 && (
                <span style={{ fontSize: 9, color: cs.yellow, background: cs.yellow + "15", padding: "2px 6px", borderRadius: 99, border: "1px solid " + cs.yellow + "33", whiteSpace: "nowrap" }}>
                  ✏️ {safeArr(r.editLog).length}x
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: cs.muted, whiteSpace: "nowrap" }}>{r.submitted}</div>
          </div>

          {/* Info grid — responsive: 1 col mobile, 2 col desktop */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "6px 24px", fontSize: 12, marginBottom: 14 }}>
            <div><span style={{ color: cs.muted }}>Customer: </span><span style={{ fontWeight: 700, color: cs.text }}>{r.customer}</span></div>
            <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ fontWeight: 700, color: cs.accent }}>{r.teknisi}{r.helper ? " + " + r.helper + " (Helper)" : ""}</span></div>
            <div><span style={{ color: cs.muted }}>Layanan: </span><span style={{ color: cs.text }}>{r.service}</span></div>
            <div><span style={{ color: cs.muted }}>Tanggal: </span><span style={{ color: cs.text }}>{r.date}</span></div>
            <div><span style={{ color: cs.muted }}>Jumlah Unit: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{r.total_units || 1} unit</span></div>
            {safeArr(r.materials).length > 0 && <div><span style={{ color: cs.muted }}>Material: </span><span style={{ color: cs.text }}>{r.materials.length} item</span></div>}
            {(() => { const fotoCnt = safeArr(r.fotos).filter(f => f.url).length; return fotoCnt > 0 ? <div><span style={{ color: cs.green }}>📸 {fotoCnt} foto</span></div> : null; })()}
            {(() => { const tF = (r.units || []).reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0); return tF > 0 ? <div><span style={{ color: cs.muted }}>Freon: </span><span style={{ color: cs.text }}>{tF.toFixed(1)} kg</span></div> : null; })()}
            {/* Summary PK + brand semua unit */}
            {(r.units || []).length > 0 && (() => {
              const unitSummary = (r.units || []).map((u, i) => {
                const pk = u.pk || "";
                const merk = u.merk || "";
                const label = u.label || `Unit ${i + 1}`;
                return { label, pk, merk, tipe: u.tipe || "" };
              });
              return (
                <div style={{ gridColumn: "1/-1" }}>
                  <span style={{ color: cs.muted }}>Detail Unit: </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                    {unitSummary.map((u, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: cs.surface, border: "1px solid " + cs.border,
                        borderRadius: 7, padding: "3px 9px", fontSize: 11
                      }}>
                        <span style={{ fontWeight: 700, color: cs.accent }}>Unit {i + 1}</span>
                        <span style={{ color: cs.muted }}>·</span>
                        {u.merk && <span style={{ fontWeight: 700, color: cs.text }}>{u.merk}</span>}
                        {u.pk && (
                          <span style={{
                            background: cs.accent + "22", color: cs.accent,
                            fontWeight: 800, fontSize: 10, padding: "1px 6px", borderRadius: 99
                          }}>
                            {u.pk}
                          </span>
                        )}
                        {u.label && <span style={{ color: cs.muted, fontSize: 10 }}>{u.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Per-unit accordion — compact mobile layout */}
          {(r.units || []).map((u, ui) => (
            <div key={ui} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", marginBottom: 6, fontSize: 11 }}>
              {/* Unit header: compact mobile */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: cs.accent, fontSize: 12, minWidth: "50px" }}>
                  Unit {u.unit_no}
                </span>
                {u.label && (
                  <span style={{ fontSize: 11, color: cs.text, fontWeight: 600 }}>{u.label}</span>
                )}
                {u.merk && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: cs.text,
                    background: cs.surface, border: "1px solid " + cs.border,
                    borderRadius: 4, padding: "1px 6px"
                  }}>
                    {u.merk}
                  </span>
                )}
                {u.pk && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    background: cs.accent, borderRadius: 99, padding: "2px 7px"
                  }}>
                    {u.pk}
                  </span>
                )}
                {parseFloat(u.freon_ditambah) > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: "#06b6d4",
                    background: "#06b6d422", borderRadius: 99, padding: "1px 6px"
                  }}>
                    ❄️{u.freon_ditambah}psi
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.kondisi_sebelum || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.yellow + "18", color: cs.yellow, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.pekerjaan || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.accent + "18", color: cs.accent, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.kondisi_setelah || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.green + "18", color: cs.green, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ fontSize: 11, color: cs.muted }}>
                {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}{u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                {u.catatan_unit ? ` · ${u.catatan_unit}` : ""}
              </div>
            </div>
          ))}

          {/* Material summary */}
          {safeArr(r.materials).length > 0 && (
            <div style={{ background: cs.surface, borderRadius: 9, padding: "10px 13px", marginBottom: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: cs.text, marginBottom: 6 }}>🔧 Material Terpakai</div>
              {safeArr(r.materials).map((m, mi) => (
                <div key={mi} style={{ color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan ? ` — ${m.keterangan}` : ""}</div>
              ))}
            </div>
          )}

          {/* ── Foto grid untuk Admin/Owner ── */}
          {(() => {
            const fotoWithUrl = safeArr(r.fotos).filter(f => f.url);
            return fotoWithUrl.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.green, marginBottom: 6 }}>📸 Foto Laporan ({fotoWithUrl.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: 6 }}>
                  {fotoWithUrl.map((f, fi) => {
                    const url = typeof f === "string" ? f : f.url;
                    const label = typeof f === "string" ? `Foto ${fi + 1}` : f.label || `Foto ${fi + 1}`;
                    return (
                      <div key={fi} style={{ position: "relative", cursor: "pointer" }} onClick={() => window.open(fotoSrc(url), "_blank")}>
                        <img src={fotoSrc(url)} alt={label} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 7, border: "1px solid " + cs.border }} />
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#000a", borderRadius: "0 0 7px 7px", padding: "2px 4px", fontSize: 9, color: "#fff", textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}
          {r.rekomendasi && <div style={{ fontSize: 11, marginBottom: 6 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{r.rekomendasi}</span></div>}
          {r.catatan_global && <div style={{ fontSize: 11, marginBottom: 8 }}><span style={{ color: cs.muted }}>Catatan: </span><span style={{ color: cs.text }}>{r.catatan_global}</span></div>}

          {/* Edit log */}
          {safeArr(r.editLog).length > 0 && (
            <div style={{ background: cs.yellow + "08", border: "1px solid " + cs.yellow + "22", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 8 }}>Riwayat Edit</div>
              {safeArr(r.editLog).map((log, li) => (
                <div key={li} style={{ fontSize: 11, color: cs.muted, marginBottom: 5, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ background: cs.accent + "18", color: cs.accent, fontWeight: 700, padding: "1px 8px", borderRadius: 99, fontSize: 10 }}>{log.by}</span>
                  <span style={{ color: cs.muted }}>{log.at}</span>
                  <span>ubah <b style={{ color: cs.text }}>{log.field}</b>:</span>
                  <span style={{ color: cs.red, textDecoration: "line-through", fontStyle: "italic" }}>{log.old}</span>
                  <span style={{ color: cs.muted }}>→</span>
                  <span style={{ color: cs.green, fontWeight: 600 }}>{log.new}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {r.status === "SUBMITTED" && (<>
              <button onClick={() => verifyLaporan(r)} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ Verifikasi</button>
              <button onClick={async () => {
                setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "REVISION" } : x));
                const { error: revErr } = await updateServiceReport(supabase, r.id, { status: "REVISION" }, auditUserName());
                if (revErr) {
                  console.warn("❌ update REVISION failed:", revErr.message);
                  addAgentLog("LAPORAN_UPDATE_ERROR", `Update status REVISION gagal: ${revErr.message.slice(0, 80)}`, "WARNING");
                  showNotif("❌ Gagal update status — " + revErr.message.slice(0, 50));
                  return;
                }
                addAgentLog("LAPORAN_REVISION", `Laporan ${r.job_id} diminta revisi oleh ${currentUser?.name}`, "WARNING");
                showNotif("⚠️ Revisi diminta untuk laporan " + r.job_id);
                // SIM-11: WA notif ke teknisi saat laporan REVISION
                const tekAccRev = userAccounts.find(u => u.name === r.teknisi && u.phone);
                if (tekAccRev?.phone) sendWA(tekAccRev.phone,
                  "Laporan Perlu Direvisi\nJob: " + r.job_id
                  + "\nCustomer: " + r.customer + "\nService: " + r.service
                  + "\n\nAdmin meminta revisi. Silakan perbaiki. — AClean");
              }} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Minta Revisi</button>
              <button onClick={async () => {
                setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "REJECTED" } : x));
                const { error: rejErr } = await updateServiceReport(supabase, r.id, { status: "REJECTED" }, auditUserName());
                if (rejErr) {
                  console.warn("❌ update REJECTED failed:", rejErr.message);
                  addAgentLog("LAPORAN_UPDATE_ERROR", `Update status REJECTED gagal: ${rejErr.message.slice(0, 80)}`, "WARNING");
                  showNotif("❌ Gagal update status — " + rejErr.message.slice(0, 50));
                  return;
                }
                addAgentLog("LAPORAN_REJECTED", `Laporan ${r.job_id} ditolak oleh ${currentUser?.name}`, "ERROR");
                showNotif("❌ Laporan " + r.job_id + " ditolak");
              }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Tolak</button>
            </>)}
            {/* Edit laporan — Owner, Admin, atau Teknisi/Helper yang membuat laporan */}
            {((currentUser?.role === "Owner" || currentUser?.role === "Admin") || r.teknisi === currentUser?.name || r.helper === currentUser?.name) && (
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
                setEditLaporanForm({ editService: r.service, rekomendasi: r.rekomendasi || "", catatan_global: r.catatan_global || r.catatan || "", editUnits: JSON.parse(JSON.stringify(r.units || [])), editJasaItems: mats.filter(m => m.keterangan === "jasa"), editMatItems: mats.filter(m => m.keterangan !== "jasa" && m.keterangan !== "barang") });
                // ✨ Load repair type from existing invoice
                const existInvForEdit = invoicesData.find(i => i.job_id === r.id);
                setEditRepairType(existInvForEdit?.repair_gratis || "berbayar");
                setEditGratisAlasan("");
                setActiveEditUnitIdx(0);
                setEditPhotoMode(false); // Reset photo mode to default (don't re-upload)
                setEditLaporanFotos([]); // Clear any previous photo uploads
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
                ✏️ Edit Laporan
              </button>
            )}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && downloadServiceReportPDF && (
              <button onClick={() => {
                const relInv = invoicesData.find(i => i.job_id === r.job_id) || {};
                downloadServiceReportPDF(r, relInv);
              }}
                style={{ background: "#1e3a5f22", border: "1px solid #1e3a5f44", color: "#93c5fd", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                📋 Report Card
              </button>
            )}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <button onClick={async () => {
                const ok = await showConfirm({
                  icon: "🗑️", title: "Hapus Laporan?",
                  message: "Hapus laporan " + r.job_id + " (" + r.customer + ")? Invoice terkait juga akan dihapus.",
                  confirmText: "Ya, Hapus"
                });
                if (!ok) return;
                // Hapus laporan
                const { error: delErr } = await deleteServiceReport(supabase, r.id, auditUserName());
                if (delErr) {
                  console.warn("❌ delete laporan failed:", delErr.message);
                  showNotif("❌ Gagal hapus laporan: " + delErr.message.slice(0, 50));
                  return;
                }
                setLaporanReports(p => p.filter(x => x.id !== r.id));
                // Hapus invoice terkait jika ada
                const relInv = invoicesData.filter(i => i.job_id === r.job_id);
                if (relInv.length > 0) {
                  await Promise.all(relInv.map(inv => deleteInvoice(supabase, inv.id, auditUserName())));
                  setInvoicesData(p => p.filter(i => i.job_id !== r.job_id));
                }
                // Reset order status ke COMPLETED (bukan INVOICED)
                await updateOrderStatus(supabase, r.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                setOrdersData(p => p.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED", invoice_id: null } : o));
                addAgentLog("LAPORAN_DELETED", "Laporan " + r.job_id + " dihapus oleh " + currentUser?.name, "WARNING");
                showNotif("🗑️ Laporan " + r.job_id + " dihapus");
              }}
                style={{
                  background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red,
                  padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700
                }}>
                🗑️ Hapus Laporan
              </button>
            )}
            {r.status === "REVISION" && <span style={{ fontSize: 12, color: cs.yellow }}>Menunggu revisi dari {r.teknisi}</span>}
            {r.status === "VERIFIED" && <span style={{ fontSize: 12, color: cs.green }}>Laporan sudah terverifikasi</span>}
            {r.status === "REJECTED" && <span style={{ fontSize: 12, color: cs.red }}>Laporan ditolak</span>}
          </div>
        </div>
      ))}
    {/* Pagination Laporan */}
    {totPgL > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
        <button onClick={() => setLaporanPage(p => Math.max(1, p - 1))} disabled={curPgL === 1}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgL === 1 ? cs.surface : cs.card, color: curPgL === 1 ? cs.muted : cs.text, cursor: curPgL === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
        <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgL}/{totPgL}</span>
        <button onClick={() => setLaporanPage(p => Math.min(totPgL, p + 1))} disabled={curPgL === totPgL}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgL === totPgL ? cs.surface : cs.card, color: curPgL === totPgL ? cs.muted : cs.text, cursor: curPgL === totPgL ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
        <span style={{ fontSize: 11, color: cs.muted }}>{filtered.length} laporan</span>
      </div>
    )}
  </div>
);
}

export default memo(LaporanTimView);
