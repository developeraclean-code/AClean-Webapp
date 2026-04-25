import { useState, useMemo, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { SERVICE_TYPES } from "../constants/services.js";
import { statusColor, statusLabel } from "../constants/status.js";
import { normalizePhone } from "../lib/phone.js";
import { getTechColor } from "../lib/techColor.js";

// ── Durasi estimasi (jam) — sama dengan logic di App.jsx ──
function hitungDurasi(service, units) {
  const u = parseInt(units) || 1;
  if (service === "Install") return Math.min(u * 2.5, 8);
  if (service === "Repair") return Math.ceil(u * 1.5);
  if (service === "Complain") return Math.max(0.5, u * 0.5);
  // Cleaning
  if (u === 1) return 1;
  if (u === 2) return 2;
  if (u === 3) return 3;
  if (u === 4) return 3;
  if (u <= 6) return 4;
  if (u <= 8) return 5;
  if (u <= 10) return 6;
  return 8;
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// ── Conflict detection: overlap ±1 jam ──
function hasConflict(orders, teknisi, date, time, excludeId = null) {
  if (!teknisi || !date || !time) return null;
  const [h, m] = time.split(":").map(Number);
  const targetMin = h * 60 + m;
  const conflicts = orders.filter(o => {
    if (o.id === excludeId) return false;
    if (o.teknisi !== teknisi) return false;
    if (o.date !== date) return false;
    if (!o.time) return false;
    const [oh, om] = o.time.split(":").map(Number);
    const oMin = oh * 60 + om;
    return Math.abs(oMin - targetMin) < 60;
  });
  return conflicts.length > 0 ? conflicts : null;
}

// ── Status badge ──
function StatusBadge({ status }) {
  const color = statusColor[status] || "#64748b";
  return (
    <span style={{ background: color + "22", color, border: "1px solid " + color + "55", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
      {statusLabel[status] || status}
    </span>
  );
}

// ── Sumber badge ──
function SourceBadge({ source }) {
  if (!source || source === "manual") return null;
  const map = { whatsapp: { label: "WhatsApp", color: "#22c55e" }, website: { label: "Website", color: "#38bdf8" } };
  const s = map[source] || { label: source, color: "#64748b" };
  return (
    <span style={{ background: s.color + "18", color: s.color, border: "1px solid " + s.color + "44", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

// ── Time Grid: tampilan per jam 09:00–17:00 per teknisi per hari yang dipilih ──
const GRID_START = 9;   // jam 09:00
const GRID_END   = 17;  // sampai 17:00 (8 slot)
const HOURS = Array.from({ length: GRID_END - GRID_START }, (_, i) => GRID_START + i); // [9,10,...,16]

function TimeGrid({ weekDays, weekLabel, weekOffset, setWeekOffset, gridTeknisi, weekOrders, teknisiData, expandedId, setExpandedId, TODAY }) {
  const [selectedDate, setSelectedDate] = useState(weekDays.find(d => d.date === TODAY)?.date || weekDays[0]?.date);

  // Kalau minggu berganti, reset ke hari pertama
  const currentDate = weekDays.find(d => d.date === selectedDate) ? selectedDate : weekDays[0]?.date;

  // Order di hari terpilih, bukan cancelled
  const dayOrders = weekOrders.filter(o => o.date === currentDate);

  // Untuk tiap teknisi + jam: apakah jam ini terisi?
  // Return: null = kosong, { ...order, endMin } = terisi, 'cont' = lanjutan dari jam sebelumnya
  function getSlot(tek, hour) {
    const slotStart = hour * 60;
    const slotEnd   = slotStart + 60;
    const orders = dayOrders.filter(o => o.teknisi === tek && o.time);
    for (const o of orders) {
      const start = toMinutes(o.time);
      if (start === null) continue;
      const dur = hitungDurasi(o.service, o.units);
      const end = start + Math.round(dur * 60);
      if (start >= slotStart && start < slotEnd) return { ...o, startMin: start, endMin: end, isStart: true };
      if (start < slotStart && end > slotStart) return { ...o, startMin: start, endMin: end, isStart: false };
    }
    return null;
  }

  // Berapa slot jam yang ditempati order ini mulai dari jam ini
  function spanCount(o, hour) {
    const start = toMinutes(o.time);
    const dur = hitungDurasi(o.service, o.units);
    const endMin = start + Math.round(dur * 60);
    const slotStart = hour * 60;
    // hitung berapa jam ke depan masih terisi
    let count = 0;
    for (let h = hour; h < GRID_END; h++) {
      if (h * 60 >= endMin) break;
      count++;
    }
    return Math.max(1, count);
  }

  return (
    <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📅 Time Grid Jadwal</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setWeekOffset(w => w - 1)}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 7, padding: "5px 11px", cursor: "pointer", fontSize: 13 }}>‹</button>
          <span style={{ fontSize: 12, color: cs.muted, minWidth: 115, textAlign: "center" }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset(w => w + 1)}
            style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 7, padding: "5px 11px", cursor: "pointer", fontSize: 13 }}>›</button>
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)}
              style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 7, padding: "5px 9px", cursor: "pointer", fontSize: 11 }}>Minggu ini</button>
          )}
        </div>
      </div>

      {/* Pilih hari */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {weekDays.map(d => {
          const isToday = d.date === TODAY;
          const isSelected = d.date === currentDate;
          const orderCount = weekOrders.filter(o => o.date === d.date).length;
          return (
            <button key={d.date} onClick={() => setSelectedDate(d.date)}
              style={{
                background: isSelected ? cs.accent : isToday ? cs.accent + "18" : cs.card,
                color: isSelected ? "#fff" : isToday ? cs.accent : cs.text,
                border: "1px solid " + (isSelected ? cs.accent : isToday ? cs.accent + "66" : cs.border),
                borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: isSelected ? 700 : 400,
                position: "relative",
              }}>
              {d.label}
              {orderCount > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, background: isSelected ? cs.green : cs.yellow, color: "#000", borderRadius: 8, fontSize: 9, padding: "1px 4px", fontWeight: 800 }}>{orderCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: cs.muted }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#22c55e22", border: "1px solid #22c55e66", borderRadius: 2, marginRight: 4 }} />Kosong (tersedia)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#38bdf822", border: "1px solid #38bdf866", borderRadius: 2, marginRight: 4 }} />Terisi</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#ef444422", border: "1px solid #ef444466", borderRadius: 2, marginRight: 4 }} />Konflik</span>
      </div>

      {/* Time grid table */}
      {gridTeknisi.length === 0 ? (
        <div style={{ textAlign: "center", color: cs.muted, padding: 32, fontSize: 13 }}>
          Belum ada teknisi atau jadwal minggu ini
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 90 }} />
              {HOURS.map(h => <col key={h} style={{ width: 70 }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={{ padding: "5px 8px", color: cs.muted, fontWeight: 700, borderBottom: "1px solid " + cs.border, textAlign: "left", fontSize: 11 }}>
                  Teknisi
                </th>
                {HOURS.map(h => (
                  <th key={h} style={{
                    padding: "5px 4px", textAlign: "center", borderBottom: "1px solid " + cs.border,
                    color: h >= 12 && h < 14 ? cs.yellow : cs.muted,
                    fontWeight: 600, fontSize: 10,
                    background: h >= 12 && h < 14 ? cs.yellow + "08" : "transparent",
                  }}>
                    {String(h).padStart(2,"0")}:00
                    {h >= 12 && h < 14 && <div style={{ fontSize: 8, color: cs.yellow }}>siang</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridTeknisi.map(tek => {
                const color = getTechColor(tek, teknisiData);
                // pre-compute: jam mana saja yang sudah di-render (karena rowspan)
                const rendered = new Set();
                return (
                  <tr key={tek} style={{ borderBottom: "1px solid " + cs.border + "33" }}>
                    {/* Nama teknisi */}
                    <td style={{ padding: "6px 8px", fontWeight: 700, color, fontSize: 11, whiteSpace: "nowrap", borderRight: "1px solid " + cs.border + "44" }}>
                      {tek}
                    </td>
                    {HOURS.map(h => {
                      if (rendered.has(h)) return null;
                      const slot = getSlot(tek, h);

                      if (!slot) {
                        // Kosong — warna hijau muda
                        return (
                          <td key={h} style={{
                            background: "#22c55e0a",
                            border: "1px solid " + cs.border + "33",
                            textAlign: "center", padding: "4px 2px",
                          }}>
                            <span style={{ color: cs.border + "88", fontSize: 9 }}>—</span>
                          </td>
                        );
                      }

                      if (!slot.isStart) {
                        // Lanjutan order dari jam sebelumnya — sudah dirender via colSpan
                        rendered.add(h);
                        return null;
                      }

                      // Ini awal order — hitung berapa jam terisi (colSpan)
                      const span = spanCount(slot, h);
                      for (let s = h + 1; s < h + span; s++) rendered.add(s);

                      // Cek konflik: ada order lain di slot yg sama
                      const othersInSlot = dayOrders.filter(o =>
                        o.teknisi === tek && o.id !== slot.id && o.time &&
                        (() => {
                          const os = toMinutes(o.time);
                          const oe = os + Math.round(hitungDurasi(o.service, o.units) * 60);
                          return os < slot.endMin && oe > slot.startMin;
                        })()
                      );
                      const isConflict = othersInSlot.length > 0;

                      return (
                        <td key={h} colSpan={span}
                          onClick={() => setExpandedId(expandedId === slot.id ? null : slot.id)}
                          style={{
                            background: isConflict ? cs.red + "22" : color + "20",
                            border: "2px solid " + (isConflict ? cs.red + "88" : color + "66"),
                            borderRadius: 5, padding: "4px 6px", cursor: "pointer",
                            verticalAlign: "top", position: "relative",
                          }}>
                          <div style={{ color, fontWeight: 800, fontSize: 10 }}>
                            {slot.time?.slice(0,5)}–{slot.time_end?.slice(0,5) || (() => {
                              const em = slot.startMin + Math.round(hitungDurasi(slot.service, slot.units) * 60);
                              return String(Math.floor(em/60)).padStart(2,"0") + ":" + String(em%60).padStart(2,"0");
                            })()}
                          </div>
                          <div style={{ color: cs.text, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: span * 68 }}>
                            {slot.customer}
                          </div>
                          <div style={{ color: cs.muted, fontSize: 9 }}>
                            {slot.service}{slot.units > 1 ? ` ×${slot.units}` : ""}
                          </div>
                          {isConflict && <div style={{ color: cs.red, fontSize: 9, fontWeight: 800 }}>⚠️ konflik</div>}
                          {expandedId === slot.id && (
                            <div style={{ marginTop: 4, borderTop: "1px solid " + color + "33", paddingTop: 4 }}>
                              <div style={{ color: cs.muted, fontSize: 9 }}>{slot.address || "—"}</div>
                              <div style={{ marginTop: 2 }}><StatusBadge status={slot.status} /></div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const INBOX_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED"];
const WEEK_DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function getWeekDays(offset = 0) {
  const base = new Date();
  const dow = base.getDay();
  const toMon = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(base);
  weekStart.setDate(base.getDate() + toMon + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { date: d.toISOString().slice(0, 10), label: `${WEEK_DAYS[i]} ${d.getDate()}` };
  });
}

function calcTimeEnd(timeStart, service, units) {
  const dur = hitungDurasi(service, parseInt(units) || 1);
  const [h, m] = (timeStart || "09:00").split(":").map(Number);
  const totalMin = h * 60 + m + Math.round(dur * 60);
  const nh = Math.min(Math.floor(totalMin / 60), 20);
  const nm = totalMin % 60;
  return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
}

const EMPTY_FORM = {
  customer: "", phone: "", service: "Cleaning", type: "", address: "", date: "", time: "09:00",
  time_end: "10:00",
  teknisi: "", notes: "", status: "PENDING", units: 1,
  customer_id: null,
};

export default function OrderInboxView({ ordersData, setOrdersData, customersData, teknisiData, currentUser, supabase, showNotif, showConfirm, auditUserName, TODAY }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, date: TODAY });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekLabel = `${weekDays[0].date.slice(5).replace("-", "/")} – ${weekDays[6].date.slice(5).replace("-", "/")}`;

  // Teknisi aktif
  const activeTeknisi = useMemo(() =>
    (teknisiData || []).filter(t => t.active !== false && (t.role === "Teknisi" || t.role === "Owner" || t.role === "Admin")),
    [teknisiData]
  );

  // Conflict check realtime
  const conflict = useMemo(() =>
    hasConflict(ordersData, form.teknisi, form.date, form.time, editId),
    [ordersData, form.teknisi, form.date, form.time, editId]
  );

  // Autocomplete: cari by nama ATAU nomor WA
  const customerSuggest = useMemo(() => {
    const raw = form.customer.trim();
    if (raw.length < 2) return [];
    const q = raw.toLowerCase();
    const isPhone = /^[0-9+]/.test(raw);
    return (customersData || []).filter(c =>
      isPhone
        ? (c.phone || "").replace(/\D/g, "").includes(raw.replace(/\D/g, ""))
        : c.name?.toLowerCase().includes(q) || (c.phone || "").includes(q)
    ).slice(0, 6);
  }, [form.customer, customersData]);

  // Lookup nomor WA di field phone → suggest customer
  const phoneSuggest = useMemo(() => {
    const raw = form.phone.replace(/\D/g, "");
    if (raw.length < 5) return [];
    return (customersData || []).filter(c =>
      (c.phone || "").replace(/\D/g, "").includes(raw)
    ).slice(0, 4);
  }, [form.phone, customersData]);

  // Riwayat order terakhir customer yang dipilih (untuk autofill alamat)
  const customerLastOrder = useMemo(() => {
    if (!form.customer_id) return null;
    return ordersData
      .filter(o => o.customer_id === form.customer_id && o.address)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
  }, [form.customer_id, ordersData]);

  const setField = useCallback((k, v) => setForm(f => {
    const next = { ...f, [k]: v };
    // Auto-recalc time_end saat time/service/units berubah, KECUALI user edit time_end langsung
    if (k !== "time_end" && ["time", "service", "units"].includes(k)) {
      next.time_end = calcTimeEnd(next.time, next.service, next.units);
    }
    return next;
  }), []);

  function applyCustomer(c) {
    // Ambil alamat dari order terakhir customer ini
    const lastOrder = ordersData
      .filter(o => o.customer_id === c.id && o.address)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    setForm(f => ({
      ...f,
      customer: c.name,
      phone: c.phone || f.phone,
      address: lastOrder?.address || c.address || f.address,
      customer_id: c.id || null,
    }));
  }

  async function handleSave() {
    if (!form.customer.trim()) return showNotif("Nama customer wajib diisi", "error");
    if (!form.date) return showNotif("Tanggal wajib diisi", "error");
    if (!form.service) return showNotif("Layanan wajib diisi", "error");

    setSaving(true);
    const payload = {
      customer: form.customer.trim(),
      phone: normalizePhone(form.phone),
      service: form.service,
      type: form.type || null,
      address: form.address.trim() || null,
      date: form.date,
      time: form.time || "09:00",
      teknisi: form.teknisi || null,
      notes: form.notes.trim() || null,
      status: form.status,
      units: Number(form.units) || 1,
      time_end: form.time_end || calcTimeEnd(form.time, form.service, form.units),
      source: "whatsapp",
      ...(form.customer_id ? { customer_id: form.customer_id } : {}),
      last_changed_by: auditUserName(),
    };

    try {
      if (editId) {
        const { error } = await supabase.from("orders").update(payload).eq("id", editId);
        if (error) throw error;
        setOrdersData(prev => prev.map(o => o.id === editId ? { ...o, ...payload } : o));
        showNotif("Order diperbarui");
        setEditId(null);
      } else {
        const id = "WA-" + Date.now();
        const { error } = await supabase.from("orders").insert({ ...payload, id });
        if (error) throw error;
        setOrdersData(prev => [{ ...payload, id, created_at: new Date().toISOString() }, ...prev]);
        showNotif("Order masuk disimpan");
      }
      setForm({ ...EMPTY_FORM, date: TODAY });
    } catch (e) {
      showNotif("Gagal simpan: " + (e.message || "unknown"), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(order) {
    setEditId(order.id);
    setForm({
      customer: order.customer || "",
      phone: order.phone || "",
      service: order.service || "Cleaning",
      type: order.type || "",
      address: order.address || "",
      date: order.date || TODAY,
      time: order.time ? order.time.slice(0, 5) : "09:00",
      time_end: order.time_end ? order.time_end.slice(0, 5) : calcTimeEnd(order.time || "09:00", order.service || "Cleaning", order.units || 1),
      teknisi: order.teknisi || "",
      notes: order.notes || "",
      status: order.status || "PENDING",
      units: order.units || 1,
      customer_id: order.customer_id || null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    setEditId(null);
    setForm({ ...EMPTY_FORM, date: TODAY });
  }

  async function handleStatusChange(order, newStatus) {
    const { error } = await supabase.from("orders")
      .update({ status: newStatus, last_changed_by: auditUserName() })
      .eq("id", order.id);
    if (error) return showNotif("Gagal update status: " + error.message);
    setOrdersData(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
  }

  async function handleDelete(order) {
    const ok = await showConfirm({
      icon: "🗑", title: "Hapus Order?",
      message: `Hapus order ${order.customer} (${order.date})?`,
      confirmText: "Hapus",
    });
    if (!ok) return;
    await supabase.from("orders").update({ last_changed_by: auditUserName() }).eq("id", order.id);
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) return showNotif("Gagal hapus: " + error.message);
    setOrdersData(prev => prev.filter(o => o.id !== order.id));
    showNotif("Order dihapus");
  }

  // ── Grid data: order per hari per teknisi ──
  const weekDateSet = useMemo(() => new Set(weekDays.map(d => d.date)), [weekDays]);
  const weekOrders = useMemo(() =>
    ordersData.filter(o => weekDateSet.has(o.date) && o.status !== "CANCELLED"),
    [ordersData, weekDateSet]
  );
  const gridTeknisi = useMemo(() => {
    const names = new Set(activeTeknisi.map(t => t.name));
    weekOrders.forEach(o => { if (o.teknisi) names.add(o.teknisi); });
    return [...names].sort();
  }, [activeTeknisi, weekOrders]);

  function getSlotOrders(tek, date) {
    return weekOrders.filter(o => o.teknisi === tek && o.date === date)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function isSlotConflict(tek, date) {
    const orders = getSlotOrders(tek, date);
    for (let i = 0; i < orders.length; i++) {
      for (let j = i + 1; j < orders.length; j++) {
        if (!orders[i].time || !orders[j].time) continue;
        const [h1, m1] = orders[i].time.split(":").map(Number);
        const [h2, m2] = orders[j].time.split(":").map(Number);
        if (Math.abs((h1 * 60 + m1) - (h2 * 60 + m2)) < 60) return true;
      }
    }
    return false;
  }

  // ── Opsi B: update teknisi/helper inline tanpa buka form edit ──
  async function handleQuickAssign(order, field, value) {
    const update = { [field]: value || null, last_changed_by: auditUserName() };
    const { error } = await supabase.from("orders").update(update).eq("id", order.id);
    if (error) return showNotif("Gagal update " + field + ": " + error.message);
    setOrdersData(prev => prev.map(o => o.id === order.id ? { ...o, ...update } : o));
  }

  // ── Inbox list — hanya today + ke depan, EXCLUDE cancelled lama ──
  const inboxOrders = useMemo(() => {
    let list = ordersData.filter(o => {
      if (!o.date) return false;
      if (o.date < TODAY) return false;                          // buang masa lalu
      if (o.status === "CANCELLED" && o.date < TODAY) return false;
      return true;
    });
    if (filterStatus !== "ALL") list = list.filter(o => o.status === filterStatus);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(o =>
        (o.customer || "").toLowerCase().includes(q) ||
        (o.phone || "").includes(q) ||
        (o.address || "").toLowerCase().includes(q) ||
        (o.teknisi || "").toLowerCase().includes(q) ||
        (o.helper || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const dateComp = (a.date || "").localeCompare(b.date || "");  // ascending: terdekat dulu
      if (dateComp !== 0) return dateComp;
      return (a.time || "").localeCompare(b.time || "");
    });
  }, [ordersData, filterStatus, searchQ, TODAY]);

  const inputStyle = {
    background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
    color: cs.text, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ═══ FORM QUICK ENTRY ═══ */}
      <div style={{ background: cs.surface, border: "1px solid " + (editId ? cs.yellow : cs.border), borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: editId ? cs.yellow : cs.text, marginBottom: 16 }}>
          {editId ? "✏️ Edit Order — " + editId : "➕ Input Order WhatsApp"}
        </div>

        {/* Conflict warning */}
        {conflict && (
          <div style={{ background: cs.red + "18", border: "2px solid " + cs.red, borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
            <div style={{ color: cs.red, fontWeight: 800, marginBottom: 4 }}>⚠️ Potensi Konflik Jadwal</div>
            {conflict.map(c => (
              <div key={c.id} style={{ color: "#fca5a5", marginTop: 2 }}>
                → {c.teknisi} sudah ada order jam {c.time?.slice(0,5)} — {c.customer} ({c.service})
              </div>
            ))}
          </div>
        )}

        {/* Customer existing badge */}
        {form.customer_id && (
          <div style={{ background: cs.green + "12", border: "1px solid " + cs.green + "44", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: cs.green, fontWeight: 700 }}>✓ Customer Existing</span>
            <span style={{ color: cs.muted }}>Data tersinkron dari tabel customer</span>
            {customerLastOrder && (
              <span style={{ color: cs.muted, marginLeft: "auto" }}>
                Order terakhir: <span style={{ color: cs.text }}>{customerLastOrder.date} — {customerLastOrder.service}</span>
              </span>
            )}
            <button onClick={() => setForm(f => ({ ...f, customer_id: null }))}
              style={{ background: "transparent", border: "none", color: cs.muted, cursor: "pointer", fontSize: 11, marginLeft: 4 }}>✕ Lepas</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {/* Customer */}
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>
              Nama Customer *
              {form.customer_id && <span style={{ color: cs.green, marginLeft: 6 }}>✓ existing</span>}
            </label>
            <input
              style={{ ...inputStyle, borderColor: form.customer_id ? cs.green + "88" : cs.border }}
              value={form.customer}
              onChange={e => {
                setField("customer", e.target.value);
                if (form.customer_id) setField("customer_id", null);
              }}
              placeholder="Ketik nama atau nomor WA..." />
            {customerSuggest.length > 0 && !form.customer_id && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, zIndex: 100, overflow: "hidden", boxShadow: "0 4px 16px #00000066" }}>
                {customerSuggest.map(c => {
                  const lastOrd = ordersData.filter(o => o.customer_id === c.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
                  return (
                    <div key={c.id} onClick={() => applyCustomer(c)}
                      style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid " + cs.border + "55" }}
                      onMouseEnter={e => e.currentTarget.style.background = cs.border + "66"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ color: cs.text, fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                      <div style={{ color: cs.muted, fontSize: 11, marginTop: 1 }}>
                        {c.phone || "—"}
                        {c.area ? " · " + c.area : ""}
                        {lastOrd ? <span style={{ color: cs.accent, marginLeft: 6 }}>Terakhir: {lastOrd.date}</span> : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* WA — dengan lookup */}
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>
              No. WhatsApp
              {form.customer_id && <span style={{ color: cs.green, marginLeft: 6 }}>✓</span>}
            </label>
            <input
              style={{ ...inputStyle, borderColor: form.customer_id ? cs.green + "88" : cs.border }}
              value={form.phone}
              onChange={e => {
                setField("phone", e.target.value);
                if (form.customer_id) setField("customer_id", null);
              }}
              placeholder="08xx — auto-lookup customer" />
            {phoneSuggest.length > 0 && !form.customer_id && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, zIndex: 100, overflow: "hidden", boxShadow: "0 4px 16px #00000066" }}>
                <div style={{ padding: "5px 12px", fontSize: 10, color: cs.muted, borderBottom: "1px solid " + cs.border + "44" }}>Customer ditemukan:</div>
                {phoneSuggest.map(c => (
                  <div key={c.id} onClick={() => applyCustomer(c)}
                    style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid " + cs.border + "55" }}
                    onMouseEnter={e => e.currentTarget.style.background = cs.border + "66"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ color: cs.text, fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                    <div style={{ color: cs.muted, fontSize: 11 }}>{c.phone}{c.area ? " · " + c.area : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status */}
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={e => setField("status", e.target.value)}>
              {INBOX_STATUSES.map(s => <option key={s} value={s}>{statusLabel[s] || s}</option>)}
            </select>
          </div>

          {/* Layanan */}
          <div>
            <label style={labelStyle}>Layanan *</label>
            <select style={inputStyle} value={form.service} onChange={e => setField("service", e.target.value)}>
              {[...SERVICE_TYPES, "Maintenance"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Type / detail */}
          <div>
            <label style={labelStyle}>Tipe (opsional)</label>
            <input style={inputStyle} value={form.type}
              onChange={e => setField("type", e.target.value)}
              placeholder="Misal: 1/2 PK, 1 PK, VRV..." />
          </div>

          {/* Units */}
          <div>
            <label style={labelStyle}>Jumlah Unit</label>
            <input style={inputStyle} type="number" min="1" max="20" value={form.units}
              onChange={e => setField("units", e.target.value)} />
          </div>

          {/* Tanggal */}
          <div>
            <label style={labelStyle}>Tanggal *</label>
            <input style={inputStyle} type="date" value={form.date}
              onChange={e => setField("date", e.target.value)} />
          </div>

          {/* Jam Mulai */}
          <div>
            <label style={labelStyle}>Jam Mulai</label>
            <input style={inputStyle} type="time" value={form.time}
              onChange={e => setField("time", e.target.value)} />
          </div>

          {/* Jam Selesai — auto dari durasi, bisa override manual */}
          <div>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
              Jam Selesai (estimasi)
              <button
                type="button"
                onClick={() => setField("time_end", calcTimeEnd(form.time, form.service, form.units))}
                style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 5, padding: "1px 7px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
                Reset ↺
              </button>
            </label>
            <input style={inputStyle} type="time" value={form.time_end}
              onChange={e => setField("time_end", e.target.value)} />
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>
              Estimasi: {calcTimeEnd(form.time, form.service, form.units)}
              {" "}({hitungDurasi(form.service, form.units)} jam)
            </div>
          </div>

          {/* Teknisi */}
          <div>
            <label style={labelStyle}>Teknisi</label>
            <select style={inputStyle} value={form.teknisi} onChange={e => setField("teknisi", e.target.value)}>
              <option value="">— Belum ditentukan —</option>
              {activeTeknisi.map(t => (
                <option key={t.id || t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Alamat — full width */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
              Alamat
              {customerLastOrder && !form.address && (
                <button onClick={() => setField("address", customerLastOrder.address)}
                  style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 5, padding: "2px 8px", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
                  Pakai alamat terakhir ↗
                </button>
              )}
            </label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
              value={form.address} onChange={e => setField("address", e.target.value)}
              placeholder={customerLastOrder ? "Alamat terakhir: " + customerLastOrder.address : "Alamat lengkap, cluster, blok, no unit..."} />
          </div>

          {/* Catatan — full width */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Catatan (freon, unit AC, akses, dll)</label>
            <textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }}
              value={form.notes} onChange={e => setField("notes", e.target.value)}
              placeholder="Info tambahan untuk teknisi..." />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ background: cs.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontWeight: 700, fontSize: 13, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Menyimpan..." : editId ? "Simpan Perubahan" : "Simpan Order"}
          </button>
          {editId && (
            <button onClick={handleCancelEdit}
              style={{ background: "transparent", color: cs.muted, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>
              Batal Edit
            </button>
          )}
        </div>
      </div>

      {/* ═══ TIME GRID JADWAL MINGGUAN ═══ */}
      <TimeGrid
        weekDays={weekDays} weekLabel={weekLabel} weekOffset={weekOffset}
        setWeekOffset={setWeekOffset} gridTeknisi={gridTeknisi}
        weekOrders={weekOrders} teknisiData={teknisiData}
        expandedId={expandedId} setExpandedId={setExpandedId}
        TODAY={TODAY}
      />

      {/* ═══ DAFTAR ORDER INBOX (today + ke depan) ═══ */}
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              📋 Planning Order
              <span style={{ color: cs.muted, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>({inboxOrders.length})</span>
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Hari ini &amp; ke depan · CONFIRMED → naik ke Order Masuk</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...inputStyle, width: 190, padding: "6px 10px" }}
              placeholder="Cari nama, teknisi, alamat..."
              value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            <select style={{ ...inputStyle, width: "auto", padding: "6px 10px" }}
              value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="ALL">Semua Status</option>
              {INBOX_STATUSES.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}
            </select>
          </div>
        </div>

        {/* Info Opsi B */}
        <div style={{ background: cs.accent + "0a", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "7px 12px", marginBottom: 14, fontSize: 11, color: cs.muted }}>
          <span style={{ color: cs.accent, fontWeight: 700 }}>Alur Opsi B: </span>
          PENDING = planning · <span style={{ color: statusColor.CONFIRMED }}>CONFIRMED</span> = fix, muncul di Order Masuk ·
          <span style={{ color: statusColor.CANCELLED }}> CANCELLED</span> = batal, tidak di-dispatch
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid " + cs.border }}>
                {["Tgl & Jam", "Customer", "Layanan", "Teknisi", "Helper", "Status", "Aksi"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", color: cs.muted, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inboxOrders.slice(0, 150).map(o => {
                const isEditing = editId === o.id;
                const techColor = o.teknisi ? getTechColor(o.teknisi, teknisiData) : cs.muted;
                const helperColor = o.helper ? getTechColor(o.helper, teknisiData) : cs.muted;
                const isToday = o.date === TODAY;
                const isCancelled = o.status === "CANCELLED";
                const ddStyle = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, color: cs.text, padding: "4px 6px", fontSize: 11, cursor: "pointer", outline: "none", width: "100%", minWidth: 110 };
                return (
                  <tr key={o.id} style={{
                    borderBottom: "1px solid " + cs.border + "44",
                    background: isEditing ? cs.yellow + "08" : isCancelled ? cs.red + "06" : isToday ? cs.accent + "06" : "transparent",
                    opacity: isCancelled ? 0.6 : 1,
                  }}>
                    {/* Tanggal + Jam */}
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <div style={{ color: isToday ? cs.accent : cs.text, fontWeight: isToday ? 700 : 400 }}>
                        {o.date || "—"}
                        {isToday && <span style={{ color: cs.accent, fontSize: 10, marginLeft: 4, fontWeight: 800 }}>● HARI INI</span>}
                      </div>
                      <div style={{ color: cs.muted, fontSize: 11 }}>
                        {o.time?.slice(0,5) || "—"}
                        {o.time_end && <span> – {o.time_end?.slice(0,5)}</span>}
                      </div>
                    </td>

                    {/* Customer */}
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ color: cs.text, fontWeight: 600 }}>{o.customer}</div>
                      {o.phone && <div style={{ color: cs.muted, fontSize: 11 }}>{o.phone}</div>}
                      {o.address && <div style={{ color: cs.muted, fontSize: 10, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.address}</div>}
                      {o.notes && <div style={{ color: cs.ara, fontSize: 10, fontStyle: "italic" }}>{o.notes}</div>}
                    </td>

                    {/* Layanan */}
                    <td style={{ padding: "8px 10px", color: cs.text, whiteSpace: "nowrap" }}>
                      <div>{o.service}{o.type ? ` — ${o.type}` : ""}</div>
                      {o.units > 1 && <div style={{ color: cs.muted, fontSize: 10 }}>×{o.units} unit</div>}
                      <SourceBadge source={o.source} />
                    </td>

                    {/* Teknisi — inline dropdown */}
                    <td style={{ padding: "8px 10px", minWidth: 130 }}>
                      <select value={o.teknisi || ""} onChange={e => handleQuickAssign(o, "teknisi", e.target.value)}
                        style={{ ...ddStyle, color: o.teknisi ? techColor : cs.muted, borderColor: o.teknisi ? techColor + "66" : cs.border }}>
                        <option value="">— Pilih —</option>
                        {activeTeknisi.map(t => (
                          <option key={t.id || t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Helper — inline dropdown */}
                    <td style={{ padding: "8px 10px", minWidth: 130 }}>
                      <select value={o.helper || ""} onChange={e => handleQuickAssign(o, "helper", e.target.value)}
                        style={{ ...ddStyle, color: o.helper ? helperColor : cs.muted, borderColor: o.helper ? helperColor + "66" : cs.border }}>
                        <option value="">— Tidak ada —</option>
                        {activeTeknisi.map(t => (
                          <option key={t.id || t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Status — dengan visual Opsi B */}
                    <td style={{ padding: "8px 10px" }}>
                      <select
                        value={o.status}
                        onChange={e => handleStatusChange(o, e.target.value)}
                        style={{
                          background: (statusColor[o.status] || "#64748b") + "22",
                          color: statusColor[o.status] || cs.muted,
                          border: "2px solid " + (statusColor[o.status] || "#64748b") + "88",
                          borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 800,
                          cursor: "pointer", outline: "none",
                        }}>
                        {INBOX_STATUSES.map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}
                      </select>
                      {o.status === "CONFIRMED" && (
                        <div style={{ color: cs.green, fontSize: 10, marginTop: 3, fontWeight: 600 }}>✓ Muncul di Order Masuk</div>
                      )}
                      {o.status === "CANCELLED" && (
                        <div style={{ color: cs.red, fontSize: 10, marginTop: 3 }}>✕ Tidak di-dispatch</div>
                      )}
                    </td>

                    {/* Aksi */}
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                      <button onClick={() => handleEdit(o)}
                        style={{ background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", marginRight: 6, fontWeight: 600 }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(o)}
                        style={{ background: cs.red + "18", color: cs.red, border: "1px solid " + cs.red + "44", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
              {inboxOrders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: cs.muted, padding: 32, fontSize: 13 }}>
                    Tidak ada order hari ini atau ke depan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
