import { memo } from "react";
import { cs } from "../theme/cs.js";
import { statusColor, statusLabel } from "../constants/status.js";
import { smartSearchNormalize } from "../lib/phone.js";

function OrdersView({ ordersData, setOrdersData, orderFilter, setOrderFilter, orderTekFilter, setOrderTekFilter, orderDateFrom, setOrderDateFrom, orderDateTo, setOrderDateTo, searchOrder, setSearchOrder, orderPage, setOrderPage, orderServiceFilter, setOrderServiceFilter, currentUser, customersData, setSelectedCustomer, setCustomerTab, setActiveMenu, setEditOrderItem, setEditOrderForm, setModalEditOrder, setModalOrder, showConfirm, showNotif, dispatchStatus, sendDispatchWA, deleteOrder, addAgentLog, auditUserName, downloadRekapHarian, triggerRekapHarian, supabase, TODAY, ORDER_PAGE_SIZE, showUndoToast, insertOrder }) {
// ── SIM-1+2: search + teknisi filter + pagination ──
const allTekOrd = ["Semua", ...new Set(ordersData.map(o => o.teknisi).filter(Boolean))];
const sMap2 = { "Pending": "PENDING", "Confirmed": "CONFIRMED", "In Progress": "IN_PROGRESS", "Completed": "COMPLETED", "Cancelled": "CANCELLED" };
// Opsi B: order WA yang masih PENDING = draft di Inbox, belum naik ke sini
let filtered = ordersData.filter(o =>
  !(o.source === "whatsapp" && o.status === "PENDING")
);
if (orderFilter === "Hari Ini") filtered = filtered.filter(o => o.date === TODAY);
else if (orderFilter === "Stuck") filtered = filtered.filter(o => ["DISPATCHED", "ON_SITE"].includes(o.status) && o.date < TODAY);
else if (orderFilter !== "Semua") filtered = filtered.filter(o => o.status === (sMap2[orderFilter] || orderFilter));
if (orderTekFilter !== "Semua") filtered = filtered.filter(o => o.teknisi === orderTekFilter || o.helper === orderTekFilter);
if (orderDateFrom) filtered = filtered.filter(o => (o.date || "") >= orderDateFrom);
if (orderServiceFilter !== "Semua") filtered = filtered.filter(o => o.service === orderServiceFilter); // GAP-9
if (orderDateTo) filtered = filtered.filter(o => (o.date || "") <= orderDateTo);
if (searchOrder.trim()) {
  const q = searchOrder.trim().toLowerCase();
  filtered = filtered.filter(o =>
    (o.customer || "").toLowerCase().includes(q) ||
    (o.id || "").toLowerCase().includes(q) ||
    (o.phone || "").toLowerCase().includes(q) ||
    (o.teknisi || "").toLowerCase().includes(q) ||
    (o.helper || "").toLowerCase().includes(q) ||
    (o.address || "").toLowerCase().includes(q) ||
    (o.service || "").toLowerCase().includes(q) ||
    (o.notes || "").toLowerCase().includes(q)
  );
}
filtered.sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
const totPgO = Math.ceil(filtered.length / ORDER_PAGE_SIZE) || 1;
const curPgO = Math.min(orderPage, totPgO);
const pageData = filtered.slice((curPgO - 1) * ORDER_PAGE_SIZE, curPgO * ORDER_PAGE_SIZE);
return (
  <div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text, display: "flex", alignItems: "center", gap: 10 }}>
        📋 Order Masuk <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filtered.length})</span>
        {(() => {
          const stuck = ordersData.filter(o =>
            ["DISPATCHED", "ON_SITE"].includes(o.status) && o.date < TODAY
          ).length;
          return stuck > 0 ? (
            <span title="Job belum ada laporan (sudah lewat hari)" style={{ fontSize: 11, background: cs.red + "22", color: cs.red, border: "1px solid " + cs.red + "44", borderRadius: 99, padding: "2px 8px", fontWeight: 700, cursor: "pointer" }}
              onClick={() => { setOrderFilter("Stuck"); setOrderPage(1); }}>
              ⚠️ {stuck} stuck
            </span>
          ) : null;
        })()}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (() => {
          const todayUndispatched = ordersData.filter(o =>
            o.date === TODAY && !o.dispatch &&
            ["PENDING", "CONFIRMED", "DISPATCHED"].includes(o.status)
          );
          return todayUndispatched.length > 0 ? (
            <button onClick={async () => {
              if (!await showConfirm({
                icon: "📤", title: "Bulk Dispatch WA?",
                message: "Kirim WA ke " + todayUndispatched.length + " teknisi untuk job hari ini?",

                confirmText: "Ya, Kirim Semua"
              })) return;
              let sukses = 0, gagal = 0;
              showNotif(`⏳ Mengirim WA ke ${todayUndispatched.length} teknisi...`);
              for (const o of todayUndispatched) {
                try {
                  await sendDispatchWA(o);
                  sukses++;
                  await new Promise(r => setTimeout(r, 500)); // jeda 0.5s antar WA
                } catch (e) { gagal++; }
              }
              addAgentLog("BULK_DISPATCH", `Bulk dispatch: ${sukses} sukses, ${gagal} gagal — ${TODAY}`, sukses > 0 ? "SUCCESS" : "ERROR");
              showNotif(`✅ Bulk dispatch selesai: ${sukses} WA terkirim${gagal > 0 ? ", " + gagal + " gagal" : ""}`);
            }} style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "9px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              📤 Dispatch Hari Ini <span style={{ background: "#25D366", color: "#fff", borderRadius: 99, padding: "1px 7px", fontSize: 11 }}>{todayUndispatched.length}</span>
            </button>
          ) : null;
        })()}
        {/* ── Rekap Order: Download + Kirim WA ── */}
        {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "4px 7px"
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📥 Rekap</span>
            <input type="date" id="rekapOrder"
              defaultValue={TODAY}
              style={{
                background: cs.card, border: "1px solid " + cs.border, borderRadius: 6,
                padding: "3px 7px", fontSize: 11, color: cs.text, colorScheme: "dark", cursor: "pointer"
              }}
            />
            <button onClick={() => { const d = document.getElementById("rekapOrder")?.value || TODAY; downloadRekapHarian(d); }}
              title="Download rekap ke file"
              style={{
                background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green,
                padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 11
              }}>⬇️</button>
            <button onClick={() => { const d = document.getElementById("rekapOrder")?.value || TODAY; triggerRekapHarian(d); }}
              title="Kirim rekap via WhatsApp"
              style={{
                background: "#25D36622", border: "1px solid #25D36644", color: "#25D366",
                padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 11
              }}>📲</button>
          </div>
        )}
        <button onClick={() => setModalOrder(true)} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Order Baru</button>
      </div>
    </div>
    {/* Search bar */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
      <input id="searchOrder" value={searchOrder} onChange={e => { setSearchOrder(smartSearchNormalize(e.target.value)); setOrderPage(1); }}
        placeholder="Cari nama customer, Job ID, telepon, atau teknisi..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchOrder && <button onClick={() => { setSearchOrder(""); setOrderPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
    </div>
    {/* Filter pills + teknisi dropdown */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {["Semua", "Hari Ini", "Pending", "Confirmed", "In Progress", "Completed"].map(f => (
        <button key={f} onClick={() => { setOrderFilter(f); setOrderPage(1); }}
          style={{
            background: orderFilter === f ? cs.accent : cs.card, border: "1px solid " + (orderFilter === f ? cs.accent : cs.border),
            color: orderFilter === f ? "#0a0f1e" : cs.muted, padding: "6px 14px", borderRadius: 99, cursor: "pointer", fontSize: 12, fontWeight: 600
          }}>{f}</button>
      ))}
      {(() => {
        const stuckCount = ordersData.filter(o => ["DISPATCHED","ON_SITE"].includes(o.status) && o.date < TODAY).length;
        return stuckCount > 0 ? (
          <button onClick={() => { setOrderFilter("Stuck"); setOrderPage(1); }}
            style={{
              background: orderFilter === "Stuck" ? cs.red : cs.red + "18",
              border: "1px solid " + cs.red + (orderFilter === "Stuck" ? "" : "44"),
              color: orderFilter === "Stuck" ? "#fff" : cs.red,
              padding: "6px 14px", borderRadius: 99, cursor: "pointer", fontSize: 12, fontWeight: 700
            }}>⚠️ Stuck ({stuckCount})</button>
        ) : null;
      })()}
      <span style={{ width: 1, height: 16, background: cs.border, display: "inline-block", marginLeft: 4 }} />
      <select value={orderTekFilter} onChange={e => { setOrderTekFilter(e.target.value); setOrderPage(1); }}
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
        {allTekOrd.map(t => <option key={t} value={t}>👷 {t}</option>)}
      </select>
      <span style={{ width: 1, height: 16, background: cs.border, display: "inline-block", marginLeft: 4 }} />
      <input id="orderDateFrom" type="date" value={orderDateFrom} onChange={e => { setOrderDateFrom(e.target.value); setOrderPage(1); }}
        title="Dari tanggal"
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: orderDateFrom ? cs.text : cs.muted, padding: "5px 8px", fontSize: 11, cursor: "pointer", width: 130 }} />
      <span style={{ color: cs.muted, fontSize: 11 }}>–</span>
      <input id="orderDateTo" type="date" value={orderDateTo} onChange={e => { setOrderDateTo(e.target.value); setOrderPage(1); }}
        title="Sampai tanggal"
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: orderDateTo ? cs.text : cs.muted, padding: "5px 8px", fontSize: 11, cursor: "pointer", width: 130 }} />
      {(orderDateFrom || orderDateTo) && (
        <button onClick={() => { setOrderDateFrom(""); setOrderDateTo(""); setOrderPage(1); }}
          style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 14, padding: "2px 4px" }} title="Reset tanggal">✕</button>
      )}
      {/* GAP-9: Filter service type */}
      <span style={{ width: 1, height: 16, background: cs.border, display: "inline-block", marginLeft: 4 }} />
      <select value={orderServiceFilter} onChange={e => { setOrderServiceFilter(e.target.value); setOrderPage(1); }}
        style={{ background: cs.card, border: "1px solid " + (orderServiceFilter != "Semua" ? cs.yellow : cs.border), borderRadius: 8, color: orderServiceFilter != "Semua" ? cs.yellow : cs.text, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
        {["Semua", "Cleaning", "Install", "Repair", "Complain"].map(s => <option key={s} value={s}>🔧 {s}</option>)}
      </select>
      {/* GAP-9: Reset Semua filter */}
      {(orderFilter !== "Semua" || orderTekFilter !== "Semua" || orderDateFrom || orderDateTo || orderServiceFilter !== "Semua" || searchOrder) && (
        <button onClick={() => { setOrderFilter("Semua"); setOrderTekFilter("Semua"); setOrderDateFrom(""); setOrderDateTo(""); setOrderServiceFilter("Semua"); setSearchOrder(""); setOrderPage(1); }}
          style={{ background: cs.red + "18", border: "1px solid " + cs.red + "44", color: cs.red, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
          ✕ Reset Semua
        </button>
      )}
    </div>
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
            {["Job ID", "Customer", "Service", "Teknisi", "Tgl/Jam", "Status", "Aksi"].map(h => (
              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageData.map((o, i) => (
            <tr key={o.id} style={{ borderTop: "1px solid " + cs.border, background: i % 2 === 0 ? "transparent" : cs.surface + "80" }}>
              <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: cs.accent, fontWeight: 700 }}>{o.id}</td>
              <td style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{o.customer}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>{(o.address || "-").slice(0, 28)}...</div>
              </td>
              <td style={{ padding: "10px 14px" }}>
                {(() => {
                  const sCol = { Cleaning: "#22c55e", Install: "#3b82f6", Repair: "#f59e0b", Complain: "#ef4444" }[o.service] || cs.muted; return (
                    <><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700, background: sCol + "22", color: sCol, border: "1px solid " + sCol + "44" }}>{o.service}</span>
                      <span style={{ fontSize: 11, color: cs.muted, marginLeft: 5 }}>{o.units}u</span></>
                  );
                })()}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: cs.text }}>{o.teknisi || "—"}</div>
                {(o.helper || o.helper2 || o.helper3) && (currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>
                    🤝 {[o.helper, o.helper2, o.helper3].filter(Boolean).join(" + ")}
                  </div>
                )}
                {(o.teknisi2 || o.teknisi3) && (
                  <div style={{ fontSize: 10, color: cs.accent, marginTop: 1 }}>
                    👷 {[o.teknisi2, o.teknisi3].filter(Boolean).join(" + ")}
                  </div>
                )}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 12, color: cs.muted }}>{o.date}<br />{o.time}</td>
              <td style={{ padding: "10px 14px" }}>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 99, background: (statusColor[o.status] || cs.muted) + "22", color: statusColor[o.status] || cs.muted, border: "1px solid " + (statusColor[o.status] || cs.muted) + "44", fontWeight: 700 }}>{statusLabel[o.status] || o.status.replace("_", " ")}</span>
              </td>
              <td style={{ padding: "10px 14px" }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => { const c = customersData.find(c => c.phone === o.phone); if (c) { setSelectedCustomer(c); setCustomerTab("history"); setActiveMenu("customers"); } }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>History</button>
                  {/* Dispatch buttons — terpisah agar tidak campur aduk */}
                  <button
                    onClick={() => dispatchStatus(o)}
                    title={o.dispatch ? "Sudah dispatched" : "Set status DISPATCHED"}
                    style={{ background: o.dispatch ? "#22c55e22" : cs.accent + "22", border: "1px solid " + (o.dispatch ? "#22c55e44" : cs.accent + "44"), color: o.dispatch ? "#22c55e" : cs.accent, padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
                    {o.dispatch ? "✅" : "🔄"}
                  </button>
                  <button
                    onClick={() => sendDispatchWA(o)}
                    title="Kirim WA ke Teknisi & Helper"
                    style={{ background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
                    📤
                  </button>
                  {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                    <button onClick={() => { setEditOrderItem(o); setEditOrderForm({ customer: o.customer, phone: o.phone || "", address: o.address || "", area: o.area || "", service: o.service, type: o.type || "", units: o.units || 1, teknisi: o.teknisi, helper: o.helper || "", teknisi2: o.teknisi2 || "", helper2: o.helper2 || "", teknisi3: o.teknisi3 || "", helper3: o.helper3 || "", date: o.date, time: o.time || "09:00", status: o.status, notes: o.notes || "" }); setModalEditOrder(true); }}
                      style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✏️ Edit</button>
                  )}
                  {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                    <button onClick={async () => {
                      // Multi-hari: cek apakah ini induk dari pekerjaan multi-day
                      const childOrders = (ordersData || []).filter(c => c.parent_job_id === o.id && c.is_multi_day);
                      const isMultiDayParent = childOrders.length > 0;

                      const baseMsg = `Hapus order ${o.id} — ${o.customer}?\n\nTindakan ini tidak bisa dibatalkan.\nOrder yang sudah ada invoice TIDAK bisa dihapus.`;
                      const multiMsg = isMultiDayParent
                        ? `\n\n⚠️ INDUK pekerjaan ${childOrders.length + 1} hari. ${childOrders.length} order lanjutan akan ikut dihapus:\n`
                          + childOrders.map(c => `  • ${c.id} (${c.date})`).join("\n")
                        : "";

                      if (!await showConfirm({
                        icon: "🗑️",
                        title: isMultiDayParent ? "Hapus Pekerjaan Multi-Hari?" : "Hapus Order?",
                        danger: true,
                        message: baseMsg + multiMsg,
                        confirmText: isMultiDayParent ? `Ya, Hapus Semua (${childOrders.length + 1})` : "Ya, Hapus"
                      })) return;
                      if (o.invoice_id) {
                        showNotif("❌ Tidak bisa hapus: order sudah punya invoice " + o.invoice_id);
                        return;
                      }
                      // Blok jika ada child yang sudah punya invoice
                      const childWithInvoice = childOrders.find(c => c.invoice_id);
                      if (childWithInvoice) {
                        showNotif(`❌ Tidak bisa hapus: order lanjutan ${childWithInvoice.id} sudah punya invoice ${childWithInvoice.invoice_id}`);
                        return;
                      }
                      // Blok hapus jika status sudah COMPLETED (kecuali Owner)
                      if (currentUser?.role === "Admin" && ["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"].includes(o.status)) {
                        showNotif("❌ Admin tidak bisa hapus order yang sudah selesai. Hubungi Owner.");
                        return;
                      }
                      // Simpan snapshot untuk undo
                      const allDeleted = [o, ...childOrders];

                      // Hapus child dulu
                      if (isMultiDayParent) {
                        const childIds = childOrders.map(c => c.id);
                        const { error: cErr } = await supabase.from("orders").delete().in("id", childIds);
                        if (cErr) { showNotif("❌ Gagal hapus order lanjutan: " + cErr.message); return; }
                        try { await supabase.from("technician_schedule").delete().in("order_id", childIds); } catch (_) { }
                        setOrdersData(prev => prev.filter(x => !childIds.includes(x.id)));
                      }
                      const { error: delErr } = await deleteOrder(supabase, o.id, auditUserName());
                      if (delErr) { showNotif("❌ Gagal hapus: " + delErr.message); return; }
                      try { await supabase.from("technician_schedule").delete().eq("order_id", o.id); } catch (_) { }
                      setOrdersData(prev => prev.filter(x => x.id !== o.id));
                      addAgentLog("ORDER_DELETED",
                        `${currentUser?.role} hapus order ${o.id} — ${o.customer} (${o.service}) tgl ${o.date}`
                          + (isMultiDayParent ? ` + ${childOrders.length} child multi-day` : ""),
                        "WARNING");

                      // Undo toast 10 detik
                      const undoLabel = isMultiDayParent
                        ? `${allDeleted.length} order multi-hari "${o.customer}" dihapus`
                        : `Order "${o.customer}" (${o.date}) dihapus`;
                      showUndoToast?.(undoLabel, async () => {
                        for (const ord of allDeleted) {
                          const { last_changed_by: _, ...clean } = ord;
                          await supabase.from("orders").insert(clean);
                        }
                        setOrdersData(prev => [...allDeleted, ...prev]);
                        showNotif(`↩ ${allDeleted.length} order dikembalikan`);
                      });
                    }} title={currentUser?.role === "Admin"
                      ? "Hapus order (tidak bisa jika sudah selesai/ada invoice)"
                      : "Hapus order (Owner)"}
                      style={{
                        background: "#ef444422", border: "1px solid #ef444444", color: "#ef4444",
                        padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700
                      }}>
                      🗑️
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Pagination Orders */}
      {totPgO > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0" }}>
          <button onClick={() => setOrderPage(p => Math.max(1, p - 1))} disabled={curPgO === 1}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgO === 1 ? cs.surface : cs.card, color: curPgO === 1 ? cs.muted : cs.text, cursor: curPgO === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>
            ← Prev
          </button>
          {Array.from({ length: Math.min(totPgO, 7) }, (_, i) => {
            let pg = i + 1;
            if (totPgO > 7) {
              if (curPgO <= 4) pg = i + 1;
              else if (curPgO >= totPgO - 3) pg = totPgO - 6 + i;
              else pg = curPgO - 3 + i;
            }
            return (
              <button key={pg} onClick={() => setOrderPage(pg)}
                style={{
                  padding: "6px 12px", borderRadius: 8, border: "1px solid " + (curPgO === pg ? cs.accent : cs.border),
                  background: curPgO === pg ? cs.accent : cs.card, color: curPgO === pg ? "#0a0f1e" : cs.text, cursor: "pointer", fontSize: 12, fontWeight: curPgO === pg ? 700 : 400
                }}>
                {pg}
              </button>
            );
          })}
          <button onClick={() => setOrderPage(p => Math.min(totPgO, p + 1))} disabled={curPgO === totPgO}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgO === totPgO ? cs.surface : cs.card, color: curPgO === totPgO ? cs.muted : cs.text, cursor: curPgO === totPgO ? "not-allowed" : "pointer", fontSize: 12 }}>
            Next →
          </button>
          <span style={{ fontSize: 11, color: cs.muted }}>hal {curPgO}/{totPgO} · {filtered.length} order</span>
        </div>
      )}
    </div>
  </div>
);
}

export default memo(OrdersView);
