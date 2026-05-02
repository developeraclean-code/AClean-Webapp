import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor } from "../constants/status.js";

function InvoiceView({ invoiceFilterMemo, invoicesData, setInvoicesData, invoicePage, setInvoicePage, currentUser, isMobile, invoiceFilter, setInvoiceFilter, searchInvoice, invoiceDateFrom, setInvoiceDateFrom, invoiceDateTo, setInvoiceDateTo, setSearchInvoice, setSelectedInvoice, setModalPDF, setEditInvoiceData, setEditInvoiceForm, setEditJasaItems, setEditInvoiceItems, setModalEditInvoice, ordersData, setOrdersData, setActiveMenu, setAuditModal, invoiceReminderWA, approveInvoice, markPaid, showConfirm, showNotif, addAgentLog, auditUserName, markInvoicePaid, updateOrderStatus, deleteInvoice, updateInvoice, getLocalDate, fmt, parseMD, jasaSvcNames, downloadRekapHarian, supabase, TODAY, INV_PAGE_SIZE, laporanReports, uploadServiceReportPDFForWA, sendWAFn }) {
const { filteredInv, garansiAktif, garansiKritis, unpaidCnt } = invoiceFilterMemo;
const todayDateStr = getLocalDate();
const totPgI = Math.ceil(filteredInv.length / INV_PAGE_SIZE) || 1;
const curPgI = Math.min(invoicePage, totPgI);
const pageInv = filteredInv.slice((curPgI - 1) * INV_PAGE_SIZE, curPgI * INV_PAGE_SIZE);
return (
  <div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>🧾 Invoice <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filteredInv.length})</span></div>
      <button onClick={() => { const unpaid = invoicesData.filter(i => i.status === "UNPAID" || i.status === "OVERDUE"); unpaid.forEach(inv => invoiceReminderWA(inv)); showNotif(`📨 Reminder dikirim ke ${unpaid.length} customer`); }}
        style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
        🔔 Kirim Reminder ({unpaidCnt})
      </button>
      <button onClick={async () => {
        try {
          if (!window.XLSX) {
            await new Promise((res, rej) => {
              const s = document.createElement("script");
              s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
              s.onload = res; s.onerror = rej;
              document.head.appendChild(s);
            });
          }
          const XLSX = window.XLSX;
          const rows = filteredInv;
          const rangeLabel = invoiceDateFrom || invoiceDateTo
            ? `${invoiceDateFrom || "awal"}_sd_${invoiceDateTo || "skrg"}`
            : (invoiceFilter !== "Semua" ? invoiceFilter.replace(/\s/g, "_") : "Semua");
          const data = rows.map((inv, i) => ({
            "No": i + 1, "ID Invoice": inv.id || "-",
            "Tgl Dibuat": inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
            "Customer": inv.customer || "-", "No HP": inv.phone || "-",
            "Layanan": inv.service || "-", "Unit": Array.isArray(inv.units) ? inv.units.length : (inv.units || 1),
            "Status": inv.status || "-", "Total (Rp)": inv.total || 0,
            "Teknisi": inv.teknisi || "-",
            "Tgl Bayar": inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
            "Metode Bayar": inv.paid_method || "-",
          }));
          const totalPaid = rows.filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
          const totalUnpaid = rows.filter(i => ["UNPAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + (i.total || 0), 0);
          const summary = [
            { "Keterangan": "Total Invoice", "Nilai": rows.length },
            { "Keterangan": "Invoice PAID", "Nilai": rows.filter(i => i.status === "PAID").length },
            { "Keterangan": "Invoice UNPAID", "Nilai": rows.filter(i => i.status === "UNPAID").length },
            { "Keterangan": "Invoice OVERDUE", "Nilai": rows.filter(i => i.status === "OVERDUE").length },
            { "Keterangan": "Omset Terbayar (Rp)", "Nilai": totalPaid },
            { "Keterangan": "Belum Terbayar (Rp)", "Nilai": totalUnpaid },
          ];
          const wb = XLSX.utils.book_new();
          const ws1 = XLSX.utils.json_to_sheet(data);
          ws1["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 13 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 5 }, { wch: 15 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
          const ws2 = XLSX.utils.json_to_sheet(summary);
          ws2["!cols"] = [{ wch: 22 }, { wch: 16 }];
          XLSX.utils.book_append_sheet(wb, ws1, "Invoice");
          XLSX.utils.book_append_sheet(wb, ws2, "Summary");
          XLSX.writeFile(wb, `Invoice_${rangeLabel}_${getLocalDate()}.xlsx`);
          showNotif(`✅ Export ${rows.length} invoice → .xlsx berhasil!`);
        } catch (err) { showNotif("❌ Export gagal: " + err.message); }
      }}
        style={{
          background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
          padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
          display: "flex", alignItems: "center", gap: 6
        }}>
        📊 Export XLSX ({filteredInv.length})
      </button>
      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "4px 8px"
        }}>
          <span style={{ fontSize: 11, color: cs.muted, whiteSpace: "nowrap" }}>📥 Rekap Harian:</span>
          <input type="date" id="rekapDatePickerInv"
            defaultValue={TODAY}
            style={{
              background: cs.card, border: "1px solid " + cs.border, borderRadius: 6,
              padding: "4px 8px", fontSize: 11, color: cs.text, colorScheme: "dark", cursor: "pointer"
            }}
          />
          <button
            onClick={() => {
              const d = document.getElementById("rekapDatePickerInv")?.value || TODAY;
              downloadRekapHarian(d);
            }}
            style={{
              background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent,
              padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12,
              whiteSpace: "nowrap"
            }}>
            ⬇️ Download
          </button>
        </div>
      )}
    </div>
    {/* ── Date range picker + Download rekap ── */}
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px"
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📅 Filter Tanggal:</span>
      <input type="date" value={invoiceDateFrom}
        onChange={e => { setInvoiceDateFrom(e.target.value); setInvoicePage(1); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "5px 9px", fontSize: 12, color: cs.text, colorScheme: "dark", cursor: "pointer"
        }}
      />
      <span style={{ fontSize: 12, color: cs.muted }}>–</span>
      <input type="date" value={invoiceDateTo}
        onChange={e => { setInvoiceDateTo(e.target.value); setInvoicePage(1); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "5px 9px", fontSize: 12, color: cs.text, colorScheme: "dark", cursor: "pointer"
        }}
      />
      {(invoiceDateFrom || invoiceDateTo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: cs.accent, fontWeight: 600 }}>
            {filteredInv.length} invoice
          </span>
          <button onClick={() => { setInvoiceDateFrom(""); setInvoiceDateTo(""); setInvoicePage(1); }}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 99,
              background: cs.red + "22", border: "1px solid " + cs.red + "44",
              color: cs.red, cursor: "pointer", fontWeight: 600
            }}>
            ✕ Reset
          </button>
        </div>
      )}

      {/* ── Download sesuai filter tanggal aktif ── */}
      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
        <button onClick={async () => {
          try {
            if (!window.XLSX) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                s.onload = res; s.onerror = rej;
                document.head.appendChild(s);
              });
            }
            showNotif("⏳ Mengambil data dari server...");
            let q = supabase.from("invoices")
              .select("id,job_id,customer,phone,service,units,labor,material,discount,trade_in,trade_in_amount,total,status,due,paid_at,sent_at,created_at,teknisi,paid_method")
              .order("created_at", { ascending: false });
            if (invoiceDateFrom) q = q.gte("created_at", invoiceDateFrom + "T00:00:00");
            if (invoiceDateTo) q = q.lte("created_at", invoiceDateTo + "T23:59:59");
            const { data: rows, error } = await q;
            if (error) { showNotif("❌ Gagal fetch: " + error.message); return; }
            const label = invoiceDateFrom || invoiceDateTo
              ? `${invoiceDateFrom || "awal"}_sd_${invoiceDateTo || "skrg"}`
              : "Semua";
            const XLSX = window.XLSX;
            const data = (rows || []).map((inv, i) => ({
              "No": i + 1,
              "ID Invoice": inv.id || "-",
              "Tgl Dibuat": inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
              "Customer": inv.customer || "-",
              "No HP": inv.phone || "-",
              "Layanan": inv.service || "-",
              "Unit": inv.units || 1,
              "Teknisi": inv.teknisi || "-",
              "Status": inv.status || "-",
              "Jasa (Rp)": inv.labor || 0,
              "Material (Rp)": inv.material || 0,
              "Discount (Rp)": inv.discount || 0,
              "Trade-In (Rp)": inv.trade_in ? (inv.trade_in_amount || 0) : 0,
              "Total (Rp)": inv.total || 0,
              "Tgl Bayar": inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
              "Metode Bayar": inv.paid_method || "-",
            }));
            const totalPaid = (rows || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
            const totalUnpaid = (rows || []).filter(i => ["UNPAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + (i.total || 0), 0);
            const totalDiskon = (rows || []).reduce((s, i) => s + (i.discount || 0) + (i.trade_in ? (i.trade_in_amount || 0) : 0), 0);
            const summary = [
              { "Keterangan": "Periode", "Nilai": label },
              { "Keterangan": "Total Invoice", "Nilai": (rows || []).length },
              { "Keterangan": "Invoice PAID", "Nilai": (rows || []).filter(i => i.status === "PAID").length },
              { "Keterangan": "Invoice UNPAID", "Nilai": (rows || []).filter(i => i.status === "UNPAID").length },
              { "Keterangan": "Invoice OVERDUE", "Nilai": (rows || []).filter(i => i.status === "OVERDUE").length },
              { "Keterangan": "Omset Terbayar (Rp)", "Nilai": totalPaid },
              { "Keterangan": "Belum Terbayar (Rp)", "Nilai": totalUnpaid },
              { "Keterangan": "Total Potongan/Diskon (Rp)", "Nilai": totalDiskon },
            ];
            const wb = XLSX.utils.book_new();
            const ws1 = XLSX.utils.json_to_sheet(data);
            ws1["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 13 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 5 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }];
            const ws2 = XLSX.utils.json_to_sheet(summary);
            ws2["!cols"] = [{ wch: 24 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(wb, ws1, "Invoice");
            XLSX.utils.book_append_sheet(wb, ws2, "Summary");
            XLSX.writeFile(wb, `Invoice_${label}_${getLocalDate()}.xlsx`);
            showNotif(`✅ Export ${(rows || []).length} invoice berhasil!`);
          } catch (err) { showNotif("❌ Export gagal: " + err.message); }
        }}
          style={{
            marginLeft: "auto", fontSize: 11, padding: "4px 12px", borderRadius: 7, whiteSpace: "nowrap",
            background: cs.green + "20", border: "1px solid " + cs.green + "44", color: cs.green,
            cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 5
          }}>
          ⬇️ Download {invoiceDateFrom || invoiceDateTo ? "Filter Ini" : "Semua"}
        </button>
      )}
    </div>

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: cs.muted, pointerEvents: "none" }}>🔍</span>
      <input id="searchInvoice" value={searchInvoice} onChange={e => { setSearchInvoice(e.target.value); setInvoicePage(1); }}
        placeholder="Cari nama customer, no. telepon, atau ID invoice..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchInvoice && <button onClick={() => { setSearchInvoice(""); setInvoicePage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
    </div>
    {/* Status filter pills — SIM-3 */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[
        ["Semua", cs.muted],
        ["Hari Ini", "#f97316"],
        ["UNPAID", cs.yellow],
        ["OVERDUE", cs.red],
        ["PAID", cs.green],
        ["PENDING_APPROVAL", cs.accent],
        ["Garansi", "#22d3ee"],
      ].map(([s, col]) => {
        const todayStr = getLocalDate();
        const cnt = s === "Semua" ? invoicesData.length
          : s === "Hari Ini" ? invoicesData.filter(inv => (inv.created_at || "").slice(0, 10) === todayStr).length
            : s === "Garansi" ? garansiAktif.length
              : invoicesData.filter(i => i.status === s).length;
        const showBadge = s === "Garansi" && garansiKritis.length > 0;
        return (
          <button key={s} onClick={() => { setInvoiceFilter(s); setInvoicePage(1); }}
            style={{
              padding: "6px 14px", borderRadius: 99, border: "1px solid " + (invoiceFilter === s ? col : cs.border),
              background: invoiceFilter === s ? col + "22" : cs.card, color: invoiceFilter === s ? col : cs.muted,
              cursor: "pointer", fontSize: 12, fontWeight: invoiceFilter === s ? 700 : 500, position: "relative"
            }}>
            {s === "Semua" ? "Semua" : s === "PENDING_APPROVAL" ? "Approval" : s === "Garansi" ? "🛡️ Garansi" : s} ({cnt})
            {showBadge && <span style={{ position: "absolute", top: -4, right: -4, background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 9, padding: "1px 5px", fontWeight: 800 }}>{garansiKritis.length}</span>}
          </button>
        );
      })}
    </div>
    <div style={{ display: "grid", gap: 12 }}>
      {pageInv.map(inv => (
        <div key={inv.id} style={{ background: cs.card, border: "1px solid " + (statusColor[inv.status] || cs.border) + "44", borderRadius: 14, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 800, color: cs.accent, fontSize: 14 }}>{inv.id}</span>
              <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 99, background: (statusColor[inv.status] || cs.muted) + "22", color: statusColor[inv.status] || cs.muted, border: "1px solid " + (statusColor[inv.status] || cs.muted) + "44", fontWeight: 700 }}>{inv.status.replace(/_/g, " ")}</span>
              {inv.follow_up > 0 && <span style={{ fontSize: 10, color: cs.yellow }}>Follow-up: {inv.follow_up}x</span>}
              {inv.garansi_expires && (() => {
                const daysLeft = Math.ceil((new Date(inv.garansi_expires) - new Date()) / 86400000);
                if (daysLeft < 0) return <span style={{ fontSize: 10, color: cs.muted, background: cs.surface, padding: "1px 6px", borderRadius: 4 }}>🔒 Garansi selesai</span>;
                if (daysLeft <= 7) return <span style={{ fontSize: 10, color: "#ef4444", background: "#ef444418", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>⚠️ Garansi {daysLeft}h lagi</span>;
                if (daysLeft <= 30) return <span style={{ fontSize: 10, color: cs.yellow, background: cs.yellow + "18", padding: "1px 6px", borderRadius: 4 }}>🛡️ Garansi {daysLeft}h</span>;
                return <span style={{ fontSize: 10, color: cs.green, background: cs.green + "18", padding: "1px 6px", borderRadius: 4 }}>✅ Garansi {daysLeft}h</span>;
              })()}
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, color: cs.text, fontFamily: "monospace" }}>{fmt(inv.total)}</div>
          </div>
          {/* GAP 3 — breakdown nilai */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 6, fontSize: 11 }}>
            <div style={{ background: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? cs.green + "10" : cs.surface, borderRadius: 6, padding: "6px 10px", border: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? "1px solid " + cs.green + "33" : "none" }}><div style={{ color: cs.muted }}>Jasa</div><div style={{ color: inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? cs.green : cs.text, fontWeight: 700 }}>{inv.garansi_status === "GARANSI_DENGAN_MATERIAL" || inv.garansi_status === "GARANSI_AKTIF" ? "Rp 0 (Garansi)" : fmt(inv.labor)}</div></div>
            <div style={{ background: cs.surface, borderRadius: 6, padding: "6px 10px" }}><div style={{ color: cs.muted }}>Material</div><div style={{ color: cs.text, fontWeight: 700 }}>{fmt(inv.material)}</div></div>
          </div>
          {((inv.discount || 0) > 0 || inv.trade_in) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 6, fontSize: 11 }}>
              {(inv.discount || 0) > 0 && (
                <div style={{ background: "#be123c18", borderRadius: 6, padding: "6px 10px", border: "1px solid #be123c33" }}><div style={{ color: cs.muted }}>Discount</div><div style={{ color: "#f43f5e", fontWeight: 700 }}>-{fmt(inv.discount)}</div></div>
              )}
              {inv.trade_in && (inv.trade_in_amount || 0) > 0 && (
                <div style={{ background: "#be123c18", borderRadius: 6, padding: "6px 10px", border: "1px solid #be123c33" }}><div style={{ color: cs.muted }}>Trade-In AC</div><div style={{ color: "#f43f5e", fontWeight: 700 }}>-{fmt(inv.trade_in_amount)}</div></div>
              )}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "4px 20px", fontSize: 12, color: cs.muted, marginBottom: 12 }}>
            <span>👤 {inv.customer}</span><span>📱 {inv.phone}</span>
            <span>🔧 {inv.service} · {Array.isArray(inv.units) ? inv.units.length : (inv.units || 1)} unit</span>
            {inv.due && <span>⏰ Jatuh tempo: {inv.due}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>👁 Preview</button>
            {/* Edit invoice — Owner bisa edit semua status kecuali PAID */}
            {/* Edit invoice */}
            {inv.status !== "PAID" &&
              (currentUser?.role === "Owner" ||
                (currentUser?.role === "Admin" && inv.status === "PENDING_APPROVAL")) && (
                <button onClick={() => {
                  setEditInvoiceData(inv); setEditInvoiceForm({ labor: inv.labor, material: inv.material, notes: "" }); const _allItems = parseMD(inv.materials_detail).map((m, idx) => ({ ...m, _idx: idx }));
                  const _jasaItems = _allItems.filter(m => jasaSvcNames.some(s => (m.nama || "").includes(s)));
                  const _matItems = _allItems.filter(m => !jasaSvcNames.some(s => (m.nama || "").includes(s)));
                  setEditJasaItems(_jasaItems);
                  setEditInvoiceItems(_matItems); setModalEditInvoice(true);
                }}
                  style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✏️ Edit Nilai</button>
              )}
            {/* FREE REPAIR APPROVAL — Special handling for zero-cost repairs */}
            {inv.status === "PENDING_APPROVAL" && inv.repair_gratis && (
              <div style={{ gridColumn: "1 / -1", padding: "10px 12px", background: cs.yellow + "15", border: "1px dashed " + cs.yellow + "44", borderRadius: 8, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, color: cs.yellow, fontWeight: 700 }}>
                  🎁 {inv.repair_gratis === "gratis-garansi" ? "REPAIR GRATIS (Garansi Aktif)" : inv.repair_gratis === "gratis-customer" ? "REPAIR GRATIS (Arrangement)" : "REPAIR GRATIS"}
                </div>
                <div style={{ fontSize: 11, color: cs.muted }}>
                  Invoice Rp {fmt(inv.total)} untuk {inv.customer}.
                  {" "}
                  <b>Perlu disetujui Owner/Admin</b> sebelum dikirim ke customer atau dianggap PAID.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={async () => {
                    if (!await showConfirm({
                      icon: "🎁", title: "Setuju Repair Gratis?",
                      message: `Setujui invoice ${inv.id} Repair Gratis (Rp 0) untuk ${inv.customer}?\n\nInvoice akan dicatat LUNAS. TIDAK ada WA yang dikirim ke customer.`,
                      confirmText: "Setuju & Catat Lunas"
                    })) return;

                    const paidAt = new Date().toISOString();
                    setInvoicesData(prev => prev.map(i => i.id === inv.id
                      ? { ...i, status: "PAID", paid_at: paidAt } : i));
                    setOrdersData(prev => prev.map(o => o.id === inv.job_id
                      ? { ...o, status: "PAID" } : o));

                    const { error: upErr } = await markInvoicePaid(supabase, inv.id, paidAt, auditUserName());
                    if (!upErr) {
                      await updateOrderStatus(supabase, inv.job_id, "PAID", auditUserName());
                      addAgentLog("REPAIR_GRATIS_APPROVED",
                        `Invoice ${inv.id} (${inv.repair_gratis}) APPROVED & PAID oleh ${currentUser?.name}. Tidak ada WA terkirim.`,
                        "SUCCESS");
                      showNotif(`✅ Repair gratis disetujui dan dicatat LUNAS. Tidak dikirim ke customer.`);
                    } else {
                      showNotif("⚠️ Persetujuan lokal berhasil, tapi DB update gagal: " + upErr.message);
                    }
                  }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, flex: 1 }}>✅ Setuju Gratis</button>
                  <button onClick={async () => {
                    if (!await showConfirm({
                      icon: "❌", title: "Tolak Repair Gratis?",
                      message: `Tolak invoice ${inv.id} repair gratis?\n\nInvoice akan dihapus dan laporan perlu diedit ulang.`,
                      confirmText: "Tolak & Hapus"
                    })) return;
                    setInvoicesData(prev => prev.filter(i => i.id !== inv.id));
                    await deleteInvoice(supabase, inv.id, auditUserName(), "REPAIR_GRATIS_REJECTED");
                    if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                    addAgentLog("REPAIR_GRATIS_REJECTED", `Invoice ${inv.id} repair gratis REJECTED oleh ${currentUser?.name}`, "WARNING");
                    showNotif(`❌ Repair gratis ditolak — laporan ${inv.job_id} kembali ke COMPLETED`);
                    // Navigate to laporan page for quick edit
                    setActiveMenu("laporan");
                    setTimeout(() => {
                      showNotif(`💡 Cari laporan Job ID: ${inv.job_id} di halaman Laporan untuk diedit ulang.`);
                    }, 1500);
                  }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, flex: 1 }}>❌ Tolak & Edit</button>
                </div>
              </div>
            )}

            {/* COMPLAIN GARANSI OVERRIDE — Owner/Admin override auto-detect */}
            {inv.status === "PENDING_APPROVAL" && (inv.service || "").startsWith("Complain") &&
              (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                <div style={{ gridColumn: "1 / -1", padding: "10px 12px", background: "#8b5cf615", border: "1px dashed #8b5cf644", borderRadius: 8, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#a78bfa", fontWeight: 700 }}>
                    🛡️ Status Garansi: {inv.garansi_status === "GARANSI_AKTIF" || inv.garansi_status === "GARANSI_DENGAN_MATERIAL"
                      ? <span style={{ color: cs.green }}>Dalam Garansi (auto-detect)</span>
                      : inv.garansi_status === "GARANSI_EXPIRED"
                        ? <span style={{ color: cs.yellow }}>Garansi Expired</span>
                        : <span style={{ color: cs.muted }}>Tidak Ada Garansi</span>}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    Override manual jika perlu: paksa Gratis atau paksa Berbayar sebelum approve.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={async () => {
                      if (!await showConfirm({
                        icon: "🎁", title: "Override → Gratis?",
                        message: `Ubah invoice ${inv.id} menjadi GRATIS (Rp 0) dan langsung LUNAS?\n\nTidak ada WA terkirim ke customer.`,
                        confirmText: "Override Gratis & Lunas"
                      })) return;
                      const paidAt = new Date().toISOString();
                      const upd = { total: 0, labor: 0, material: 0, discount: 0, trade_in: false, trade_in_amount: 0, garansi_status: "GARANSI_OVERRIDE_FREE", status: "PAID", paid_at: paidAt };
                      setInvoicesData(prev => prev.map(i => i.id === inv.id ? { ...i, ...upd } : i));
                      setOrdersData(prev => prev.map(o => o.id === inv.job_id ? { ...o, status: "PAID" } : o));
                      const { error } = await updateInvoice(supabase, inv.id, upd, auditUserName());
                      if (error) { showNotif("⚠️ DB update gagal: " + error.message); return; }
                      if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "PAID", auditUserName());
                      addAgentLog("COMPLAIN_OVERRIDE_FREE", `Invoice ${inv.id} override GRATIS & LUNAS oleh ${currentUser?.name}`, "SUCCESS");
                      showNotif("✅ Invoice di-override GRATIS dan dicatat LUNAS");
                    }} style={{ flex: 1, background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      Override: Gratis
                    </button>
                    <button onClick={async () => {
                      if (!await showConfirm({
                        icon: "💰", title: "Override → Berbayar?",
                        message: `Ubah invoice ${inv.id} menjadi BERBAYAR?\n\nJika total sekarang Rp 0, silakan edit nilai dulu via tombol Edit Nilai.`,
                        confirmText: "Override Berbayar"
                      })) return;
                      const upd = { garansi_status: "GARANSI_OVERRIDE_PAID" };
                      setInvoicesData(prev => prev.map(i => i.id === inv.id ? { ...i, ...upd } : i));
                      const { error } = await updateInvoice(supabase, inv.id, upd, auditUserName());
                      if (error) { showNotif("⚠️ DB update gagal: " + error.message); return; }
                      addAgentLog("COMPLAIN_OVERRIDE_PAID", `Invoice ${inv.id} di-override BERBAYAR oleh ${currentUser?.name}`, "INFO");
                      showNotif("✅ Invoice di-override menjadi BERBAYAR — edit nilai jika perlu sebelum approve");
                    }} style={{ flex: 1, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                      Override: Berbayar
                    </button>
                  </div>
                </div>
              )}
            {inv.status === "PENDING_APPROVAL" && !inv.repair_gratis && (
              <>
                <button onClick={() => approveInvoice(inv)} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✅ Approve</button>
                <span style={{ fontSize: 11, color: cs.accent, alignSelf: "center" }}>Belum dikirim ke customer</span>
              </>
            )}
            {/* Kirim Invoice PDF ke Customer — hanya setelah UNPAID (sudah approved) */}
            {inv.status === "UNPAID" && (
              <>
                <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📤 Kirim ke Customer</button>
                <button onClick={async () => {
                  if (await showConfirm({
                    icon: "💰", title: "Tandai Lunas?",
                    message: `Tandai invoice ${inv.id} (${fmt(inv.total)}) sudah LUNAS?`,
                    confirmText: "Ya, Lunas"
                  })) { const pp = invoicesData.find(i => i.id === inv.id); markPaid(pp || inv); }
                }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>💰 Tandai Lunas</button>
                <button onClick={() => invoiceReminderWA(inv)} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>🔔 Reminder</button>
              </>
            )}
            {inv.status === "OVERDUE" && (
              <>
                <button onClick={() => { setSelectedInvoice(inv); setModalPDF(true); }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>📤 Kirim ke Customer</button>
                <button onClick={() => invoiceReminderWA(inv)} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>⚠️ Reminder OVERDUE</button>
              </>
            )}
            {/* Hapus Invoice — Owner only, hanya status PENDING_APPROVAL */}
            {currentUser?.role === "Owner" && inv.status === "PENDING_APPROVAL" && (
              <button onClick={async () => {
                if (!await showConfirm({
                  icon: "🗑️", title: "Hapus Invoice?", danger: true,
                  message: `Hapus invoice ${inv.id}?\n\nInvoice akan dihapus permanen dari database.\nOrder terkait akan kembali ke status COMPLETED.`,
                  confirmText: "Hapus Permanen"
                })) return;
                setInvoicesData(prev => prev.filter(i => i.id !== inv.id));
                const { error } = await deleteInvoice(supabase, inv.id, auditUserName(), "OWNER_HAPUS_MANUAL");
                if (error) { showNotif("⚠️ Hapus lokal OK, DB gagal: " + error.message); return; }
                if (inv.job_id) await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                addAgentLog("INVOICE_DELETED", `Invoice ${inv.id} (${inv.customer}) dihapus oleh ${currentUser?.name}`, "WARNING");
                showNotif("🗑️ Invoice " + inv.id + " berhasil dihapus");
              }} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Hapus Invoice</button>
            )}
            {/* Kirim Report Card manual — hanya Owner/Admin, status sudah approved, ada laporan terkait */}
            {inv.status !== "CANCELLED" &&
              (currentUser?.role === "Owner" || currentUser?.role === "Admin") &&
              inv.phone && laporanReports?.find(r => r.job_id === inv.job_id) && (
              <button onClick={async (e) => {
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = "⏳ Mengirim...";
                try {
                  const laporan = laporanReports.find(r => r.job_id === inv.job_id);
                  const srUrl = await uploadServiceReportPDFForWA(laporan, inv);
                  if (srUrl) {
                    const srMsg = `📋 *Service Report Card* — ${inv.service || "Servis AC"} untuk ${inv.customer}\n\nDokumen ini berisi detail pengerjaan & dokumentasi foto teknisi.\n\nTerima kasih telah mempercayai AClean Service! 🙏`;
                    sendWAFn(inv.phone, srMsg, { url: srUrl, filename: `ServiceReport-${inv.job_id}.pdf` });
                    showNotif(`📋 Service Report Card terkirim ke ${inv.customer}`);
                  } else {
                    showNotif("⚠️ Gagal upload report card");
                  }
                } catch (err) {
                  showNotif("⚠️ Error: " + err.message);
                } finally {
                  e.currentTarget.disabled = false;
                  e.currentTarget.textContent = "📋 Kirim Report Card";
                }
              }}
              style={{ background: "#0ea5e922", border: "1px solid #0ea5e944", color: "#38bdf8", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                📋 Kirim Report Card
              </button>
            )}
            {/* Bukti bayar dari WA — tampil di semua role jika ada URL */}
            {inv.payment_proof_url && (
              <button
                onClick={() => window.open(inv.payment_proof_url.startsWith("/api/") ? window.location.origin + inv.payment_proof_url : inv.payment_proof_url, "_blank")}
                style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >🧾 Bukti Bayar</button>
            )}
            <button
              onClick={() => setAuditModal({ tableName: "invoices", rowId: inv.id })}
              style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}
            >📜 Riwayat</button>
          </div>
        </div>
      ))}
    </div>
    {/* Pagination Invoice */}
    {totPgI > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
        <button onClick={() => setInvoicePage(p => Math.max(1, p - 1))} disabled={curPgI === 1}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgI === 1 ? cs.surface : cs.card, color: curPgI === 1 ? cs.muted : cs.text, cursor: curPgI === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
        <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgI}/{totPgI}</span>
        <button onClick={() => setInvoicePage(p => Math.min(totPgI, p + 1))} disabled={curPgI === totPgI}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgI === totPgI ? cs.surface : cs.card, color: curPgI === totPgI ? cs.muted : cs.text, cursor: curPgI === totPgI ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
        <span style={{ fontSize: 11, color: cs.muted }}>{filteredInv.length} invoice</span>
      </div>
    )}
  </div>
);
}

export default memo(InvoiceView);
