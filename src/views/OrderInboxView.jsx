import { useState, useMemo, useCallback, useEffect } from "react";
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

// ── Conflict detection: pakai durasi aktual, bukan ±1 jam flat ──
function hasConflict(orders, teknisi, date, time, excludeId = null, service = "Cleaning", units = 1) {
  if (!teknisi || !date || !time) return null;
  const [h, m] = time.split(":").map(Number);
  const startMin = h * 60 + m;
  const durMin = Math.round(hitungDurasi(service, units) * 60);
  const endMin = startMin + durMin;
  const conflicts = orders.filter(o => {
    if (o.id === excludeId) return false;
    if (o.teknisi !== teknisi && o.teknisi2 !== teknisi) return false;
    if (o.date !== date) return false;
    if (!o.time) return false;
    if (!["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS","ON_SITE"].includes(o.status)) return false;
    const [oh, om] = o.time.split(":").map(Number);
    const oStartMin = oh * 60 + om;
    const oDurMin = Math.round(hitungDurasi(o.service || "Cleaning", o.units || 1) * 60);
    const oEndMin = oStartMin + oDurMin;
    return startMin < oEndMin && endMin > oStartMin;
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

// ── Time Grid: timeline view berdasarkan jam mulai aktual (pixel-accurate) ──
const GRID_START = 9;   // jam 09:00
const GRID_END   = 17;  // jam 17:00
const GRID_HOURS = Array.from({ length: GRID_END - GRID_START + 1 }, (_, i) => GRID_START + i); // [9..17]
const GRID_TOTAL_MIN = (GRID_END - GRID_START) * 60; // 480 menit total

// Konversi menit ke % posisi dalam grid
function minToPercent(minutes) {
  const rel = Math.max(0, Math.min(minutes - GRID_START * 60, GRID_TOTAL_MIN));
  return (rel / GRID_TOTAL_MIN) * 100;
}

// onDateChange: callback ke parent agar Planning Order ikut filter
function TimeGrid({ weekDays, weekLabel, weekOffset, setWeekOffset, gridTeknisi, weekOrders, teknisiData, expandedId, setExpandedId, TODAY, onDateChange }) {
  const [selectedDate, setSelectedDate] = useState(weekDays.find(d => d.date === TODAY)?.date || weekDays[0]?.date);

  function selectDate(d) {
    setSelectedDate(d);
    onDateChange && onDateChange(d);
  }

  const currentDate = weekDays.find(d => d.date === selectedDate) ? selectedDate : weekDays[0]?.date;
  const dayOrders = weekOrders.filter(o => o.date === currentDate);

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
            <button key={d.date} onClick={() => selectDate(d.date)}
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
      <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 11, color: cs.muted, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#22c55e22", border: "1px solid #22c55e66", borderRadius: 2, marginRight: 4 }} />Tersedia</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#38bdf822", border: "1px solid #38bdf866", borderRadius: 2, marginRight: 4 }} />Terisi</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#ef444422", border: "1px solid #ef444466", borderRadius: 2, marginRight: 4 }} />Konflik</span>
        <span style={{ color: cs.muted, fontStyle: "italic" }}>Posisi bar = jam mulai aktual</span>
      </div>

      {/* Timeline grid */}
      {gridTeknisi.length === 0 ? (
        <div style={{ textAlign: "center", color: cs.muted, padding: 32, fontSize: 13 }}>
          Belum ada teknisi atau jadwal minggu ini
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          {/* Header jam */}
          <div style={{ display: "flex", marginLeft: 90, marginBottom: 4, position: "relative", minWidth: 560 }}>
            {GRID_HOURS.map(h => (
              <div key={h} style={{
                flex: h === GRID_END ? "0 0 0px" : 1,
                fontSize: 10, color: h >= 12 && h < 14 ? cs.yellow : h === GRID_END ? cs.red + "aa" : cs.muted,
                fontWeight: 600, textAlign: "left", paddingLeft: 2,
                borderLeft: "1px solid " + (h === GRID_END ? cs.red + "55" : cs.border + "44"),
                paddingBottom: 2,
              }}>
                {String(h).padStart(2,"0")}:00
                {h >= 12 && h < 14 && <div style={{ fontSize: 8, color: cs.yellow }}>siang</div>}
                {h === GRID_END && <div style={{ fontSize: 8, color: cs.red + "88" }}>selesai</div>}
              </div>
            ))}
          </div>

          {/* Baris per teknisi */}
          {gridTeknisi.map(tek => {
            const color = getTechColor(tek, teknisiData);
            const tekOrders = dayOrders.filter(o =>
              o.time && o.teknisi === tek &&
              !["CANCELLED","COMPLETED","VERIFIED","REPORT_SUBMITTED"].includes(o.status)
            );


            return (
              <div key={tek} style={{ display: "flex", alignItems: "stretch", marginBottom: 6, minWidth: 650 }}>
                {/* Nama teknisi */}
                <div style={{ width: 90, flexShrink: 0, fontWeight: 700, color, fontSize: 11, paddingRight: 8, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                  {tek}
                </div>

                {/* Timeline bar */}
                <div style={{ flex: 1, position: "relative", height: 48, background: "#22c55e08", border: "1px solid " + cs.border + "44", borderRadius: 8, overflow: "visible" }}>
                  {/* Grid garis jam */}
                  {GRID_HOURS.map(h => (
                    <div key={h} style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: minToPercent(h * 60) + "%",
                      borderLeft: "1px solid " + (h === GRID_END ? cs.red + "55" : cs.border + "33"),
                      pointerEvents: "none",
                    }} />
                  ))}
                  {/* Jam 12-14: background siang */}
                  <div style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: minToPercent(12 * 60) + "%",
                    width: (minToPercent(14 * 60) - minToPercent(12 * 60)) + "%",
                    background: cs.yellow + "08", pointerEvents: "none",
                  }} />

                  {/* Order blocks */}
                  {tekOrders.map(o => {
                    const startMin = toMinutes(o.time);
                    if (startMin === null) return null;
                    const durMin = Math.round(hitungDurasi(o.service, o.units) * 60);
                    const endMin = startMin + durMin;

                    // Clamp ke grid
                    const leftPct = minToPercent(startMin);
                    const widthPct = minToPercent(endMin) - leftPct;

                    // Konflik: overlap dengan order lain di teknisi yang sama
                    const isConflict = tekOrders.some(o2 => {
                      if (o2.id === o.id) return false;
                      const s2 = toMinutes(o2.time);
                      const e2 = s2 + Math.round(hitungDurasi(o2.service, o2.units) * 60);
                      return startMin < e2 && endMin > s2;
                    });

                    // Jam selesai display
                    const endH = Math.floor(endMin / 60);
                    const endM = endMin % 60;
                    const endStr = String(endH).padStart(2,"0") + ":" + String(endM).padStart(2,"0");

                    return (
                      <div key={o.id}
                        onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                        title={`${o.customer} · ${o.time?.slice(0,5)}–${endStr} · ${o.service}${o.units > 1 ? " ×"+o.units : ""}`}
                        style={{
                          position: "absolute",
                          left: leftPct + "%",
                          width: Math.max(widthPct, 2) + "%",
                          top: 3, bottom: 3,
                          background: isConflict ? cs.red + "33" : color + "28",
                          border: "2px solid " + (isConflict ? cs.red + "99" : color + "88"),
                          borderRadius: 6,
                          cursor: "pointer",
                          overflow: "hidden",
                          display: "flex", flexDirection: "column", justifyContent: "center",
                          padding: "0 5px",
                          zIndex: isConflict ? 2 : 1,
                          boxSizing: "border-box",
                        }}>
                        <div style={{ color, fontWeight: 800, fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {o.time?.slice(0,5)}–{endStr}
                          {isConflict && " ⚠️"}
                        </div>
                        <div style={{ color: cs.text, fontWeight: 700, fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {o.customer}
                        </div>
                        <div style={{ color: cs.muted, fontSize: 9, whiteSpace: "nowrap" }}>
                          {o.service}{o.units > 1 ? ` ×${o.units}` : ""}
                        </div>

                        {/* Expanded detail */}
                        {expandedId === o.id && (
                          <div style={{
                            position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 4,
                            background: cs.surface, border: "1px solid " + (isConflict ? cs.red + "88" : color + "66"),
                            borderRadius: 8, padding: "8px 10px", minWidth: 180, boxShadow: "0 4px 20px #0008",
                          }} onClick={e => e.stopPropagation()}>
                            <div style={{ fontWeight: 800, fontSize: 12, color: cs.text, marginBottom: 4 }}>{o.customer}</div>
                            <div style={{ fontSize: 11, color: cs.muted }}>{o.time?.slice(0,5)} – {endStr} ({Math.round(durMin/60*10)/10} jam)</div>
                            <div style={{ fontSize: 11, color: cs.muted }}>{o.service}{o.units > 1 ? ` · ${o.units} unit` : ""}</div>
                            {o.address && <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{o.address}</div>}
                            <div style={{ marginTop: 4 }}><StatusBadge status={o.status} /></div>
                            {isConflict && <div style={{ color: cs.red, fontSize: 10, fontWeight: 800, marginTop: 4 }}>⚠️ Waktu bentrok dengan order lain</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Baris "Belum Diassign" — order di hari ini yang belum punya teknisi atau jam */}
          {(() => {
            const unassigned = dayOrders.filter(o =>
              (!o.teknisi || !o.time) &&
              !["CANCELLED","COMPLETED","VERIFIED","REPORT_SUBMITTED"].includes(o.status)
            );
            if (unassigned.length === 0) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", marginTop: 8, minWidth: 650 }}>
                <div style={{ width: 90, flexShrink: 0, fontWeight: 700, color: cs.yellow, fontSize: 11, paddingRight: 8, whiteSpace: "nowrap" }}>
                  ⚠️ Belum
                </div>
                <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 5, background: cs.yellow + "08", border: "1px dashed " + cs.yellow + "55", borderRadius: 8, padding: "6px 8px", minHeight: 36 }}>
                  {unassigned.map(o => (
                    <div key={o.id}
                      onClick={() => setExpandedId(expandedId === o.id ? null : o.id)}
                      style={{ background: cs.yellow + "18", border: "1px solid " + cs.yellow + "55", borderRadius: 6, padding: "3px 8px", cursor: "pointer", position: "relative" }}>
                      <div style={{ fontSize: 9, color: cs.yellow, fontWeight: 800 }}>
                        {o.time ? o.time.slice(0,5) : "—:——"} · {o.teknisi || "Teknisi?"}
                      </div>
                      <div style={{ fontSize: 10, color: cs.text, fontWeight: 700 }}>{o.customer}</div>
                      <div style={{ fontSize: 9, color: cs.muted }}>{o.service}{o.units > 1 ? ` ×${o.units}` : ""}</div>
                      {expandedId === o.id && (
                        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 4, background: cs.surface, border: "1px solid " + cs.yellow + "66", borderRadius: 8, padding: "8px 10px", minWidth: 180, boxShadow: "0 4px 20px #0008" }}
                          onClick={e => e.stopPropagation()}>
                          <div style={{ fontWeight: 800, fontSize: 12, color: cs.text, marginBottom: 4 }}>{o.customer}</div>
                          <div style={{ fontSize: 11, color: cs.yellow }}>
                            {!o.teknisi && "⚠️ Belum ada teknisi"}
                            {!o.time && (!o.teknisi ? " · " : "") + "⚠️ Belum ada jam"}
                          </div>
                          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{o.service}{o.units > 1 ? ` · ${o.units} unit` : ""}</div>
                          {o.address && <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{o.address}</div>}
                          <div style={{ marginTop: 4 }}><StatusBadge status={o.status} /></div>
                          <div style={{ fontSize: 10, color: cs.muted, marginTop: 4, fontStyle: "italic" }}>Edit di Planning Order di bawah untuk assign teknisi & jam</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const INBOX_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED"];
const WEEK_DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const DAY_NAMES  = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

// ─────────────────────────────────────────────
// Panel Isi Tim Harian (Team 01–10)
// ─────────────────────────────────────────────
function DailyTeamPanel({ slotDate, setSlotDate, TODAY, TEAM_SLOTS, activeTeknisi, teknisiData, availability, toggleAvailability, getSlotData, slotMembers, slotMemberRoles, saveSlot, confirmSlot, slotLoading, dailySlots, ordersData, teamPresets, onBulkDispatch, bulkDispatching }) {

  // Berapa row yang ditampilkan per slot (2 default, bisa expand ke 4)
  const [expandedSlots, setExpandedSlots] = useState({});
  function visibleRows(slotName, slot) {
    if (expandedSlots[slotName]) return 4;
    // Tampilkan 3/4 kalau sudah ada isinya
    if (slot.member3 || slot.member4) return 4;
    if (slot.member2) return 3;  // kalau ada helper ke-2, tampilkan row 3 sekalian
    return 2;  // default: teknisi + helper
  }

  function isAvail(name, date) {
    const rec = availability.find(a => a.teknisi === name && a.date === date);
    return rec ? rec.is_available : true;
  }

  const memberFields = ["member1","member2","member3","member4"];
  const roleFields   = ["member1_role","member2_role","member3_role","member4_role"];
  const defaultRoles = ["teknisi","helper","helper","helper"];

  // Hitung order count per slot per hari
  function orderCount(date, slotName) {
    return ordersData.filter(o => o.date === date && o.team_slot === slotName && o.status !== "CANCELLED").length;
  }

  return (
    <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>👥 Isi Tim Harian</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            Isi siapa mengisi Team 01–10 hari ini · Confirm → propagasi ke semua order tim tsb
          </div>
        </div>
        {/* Tab 7 hari */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {Array.from({ length: 7 }, (_, i) => {
            const d = new Date(TODAY); d.setDate(d.getDate() + i);
            const iso = d.toISOString().slice(0, 10);
            const label = i === 0 ? "Hari ini" : DAY_NAMES[d.getDay()] + " " + d.getDate();
            const filledSlots = dailySlots.filter(s => s.date === iso && slotMembers(s).length > 0).length;
            const isSelected = slotDate === iso;
            return (
              <button key={iso} onClick={() => setSlotDate(iso)}
                style={{ background: isSelected ? cs.accent : cs.card, color: isSelected ? "#fff" : cs.muted, border: "1px solid " + (isSelected ? cs.accent : cs.border), borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: isSelected ? 700 : 400 }}>
                {label}
                <span style={{ marginLeft: 4, fontSize: 10, color: isSelected ? "#ffffffaa" : filledSlots > 0 ? cs.green : cs.border }}>
                  {filledSlots}/{TEAM_SLOTS.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toggle kehadiran individu */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6, fontWeight: 600 }}>
          Kehadiran {slotDate} — toggle siapa yang hadir:
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {activeTeknisi.map(t => {
            const avail = isAvail(t.name, slotDate);
            const color = getTechColor(t.name, teknisiData);
            return (
              <button key={t.name} onClick={() => toggleAvailability(t.name, slotDate, avail)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: avail ? color + "18" : cs.card, border: "2px solid " + (avail ? color : cs.border), borderRadius: 8, padding: "5px 10px", cursor: "pointer", transition: "all 0.15s" }}>
                <div style={{ width: 28, height: 16, borderRadius: 8, background: avail ? color : cs.border, position: "relative" }}>
                  <div style={{ position: "absolute", top: 2, left: avail ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </div>
                <span style={{ color: avail ? color : cs.muted, fontWeight: 700, fontSize: 11 }}>{t.name}</span>
                <span style={{ fontSize: 9, color: avail ? cs.green : cs.red }}>{avail ? "Hadir" : "Ijin"}</span>
              </button>
            );
          })}
        </div>
      </div>


      {/* Bulk WA ke semua Teknisi & Helper hari ini */}
      {onBulkDispatch && (() => {
        const confirmedCount = dailySlots.filter(s => s.date === slotDate && s.confirmed).length;
        if (confirmedCount === 0) return null;
        return (
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => onBulkDispatch(slotDate)} disabled={bulkDispatching}
              style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 700, cursor: bulkDispatching ? "not-allowed" : "pointer", opacity: bulkDispatching ? 0.7 : 1 }}>
              {bulkDispatching ? "⏳ Mengirim..." : `📲 Kirim WA ke Teknisi & Helper (${confirmedCount} tim confirmed)`}
            </button>
            <span style={{ fontSize: 11, color: cs.muted }}>Kirim ringkasan job hari ini ke semua anggota tim yang confirmed — tidak ke customer</span>
          </div>
        );
      })()}

      {/* Grid slot Team 01–10 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {TEAM_SLOTS.map(slotName => {
          const slot = getSlotData(slotDate, slotName);
          const members = slotMemberRoles(slot);
          const ordCount = orderCount(slotDate, slotName);
          const isConfirmed = slot.confirmed;
          const hadirList = activeTeknisi.filter(t => isAvail(t.name, slotDate));

          return (
            <div key={slotName} style={{
              background: cs.card, border: "2px solid " + (isConfirmed ? cs.green : members.length > 0 ? cs.accent + "44" : cs.border),
              borderRadius: 10, padding: 12,
            }}>
              {/* Header slot */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: isConfirmed ? cs.green : cs.text }}>{slotName}</div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {ordCount > 0 && (
                    <span style={{ background: cs.accent + "22", color: cs.accent, borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                      {ordCount} job
                    </span>
                  )}
                  {isConfirmed
                    ? <span style={{ color: cs.green, fontSize: 10, fontWeight: 700 }}>✓ Confirmed</span>
                    : members.length > 0 && (
                      <button onClick={() => confirmSlot(slotDate, slotName)} disabled={slotLoading}
                        style={{ background: cs.green, color: "#fff", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, cursor: slotLoading ? "not-allowed" : "pointer" }}>
                        Confirm →
                      </button>
                    )
                  }
                </div>
              </div>

              {/* Member rows — default 2, expand ke 4 */}
              {memberFields.slice(0, visibleRows(slotName, slot)).map((mf, idx) => {
                const rolef = roleFields[idx];
                const val = slot[mf] || "";
                const roleVal = slot[rolef] || defaultRoles[idx];
                const isTekn = roleVal === "teknisi";
                const memberColor = val ? getTechColor(val, teknisiData) : cs.muted;
                // Cek apakah ini teknisi preset yang belum di-save (masih kosong di DB)
                const presetVal = idx === 0 ? (teamPresets?.[slotName] || "") : "";
                const isFromPreset = idx === 0 && presetVal && val === presetVal && !dailySlots.find(s => s.date === slotDate && s.slot === slotName);
                const isOverridePreset = idx === 0 && presetVal && val && val !== presetVal;
                return (
                  <div key={mf} style={{ display: "flex", gap: 6, marginBottom: 5, alignItems: "center" }}>
                    {/* Avatar T / H — klik untuk toggle role */}
                    <div
                      onClick={() => !isConfirmed && saveSlot(slotDate, slotName, { ...slot, [rolef]: isTekn ? "helper" : "teknisi" })}
                      title={isTekn ? "Teknisi — klik ganti ke Helper" : "Helper — klik ganti ke Teknisi"}
                      style={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isTekn ? cs.accent : cs.surface,
                        border: "2px solid " + (isTekn ? cs.accent : cs.border),
                        color: isTekn ? "#fff" : cs.muted,
                        fontSize: 11, fontWeight: 800,
                        cursor: isConfirmed ? "default" : "pointer",
                        userSelect: "none",
                        transition: "all 0.15s",
                      }}>
                      {isTekn ? "T" : "H"}
                    </div>
                    {/* Nama anggota */}
                    <div style={{ flex: 1, position: "relative" }}>
                      <select
                        value={val}
                        onChange={e => saveSlot(slotDate, slotName, { ...slot, [mf]: e.target.value || null, confirmed: false })}
                        style={{ width: "100%", background: isOverridePreset ? cs.yellow + "18" : cs.surface, border: "1px solid " + (isOverridePreset ? cs.yellow + "88" : val ? memberColor + "66" : cs.border), color: val ? memberColor : cs.muted, borderRadius: 5, padding: "3px 7px", fontSize: 11, cursor: "pointer", outline: "none", fontWeight: val ? 700 : 400 }}>
                        <option value="">— kosong —</option>
                        {hadirList.map(t => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                        {activeTeknisi.filter(t => !isAvail(t.name, slotDate)).map(t => (
                          <option key={t.name} value={t.name}>✗ {t.name}</option>
                        ))}
                      </select>
                      {isFromPreset && <span style={{ position: "absolute", right: 22, top: "50%", transform: "translateY(-50%)", fontSize: 8, color: cs.accent, fontWeight: 800, pointerEvents: "none" }}>PRESET</span>}
                      {isOverridePreset && <span style={{ position: "absolute", right: 22, top: "50%", transform: "translateY(-50%)", fontSize: 8, color: cs.yellow, fontWeight: 800, pointerEvents: "none" }}>GANTI</span>}
                    </div>
                  </div>
                );
              })}
              {/* Tombol + Tambah untuk row ke-3/4 */}
              {visibleRows(slotName, slot) < 4 && !isConfirmed && (
                <button
                  onClick={() => setExpandedSlots(p => ({ ...p, [slotName]: true }))}
                  style={{ background: "transparent", border: "1px dashed " + cs.border, color: cs.muted, borderRadius: 5, padding: "2px 8px", fontSize: 10, cursor: "pointer", width: "100%", marginTop: 2 }}>
                  + Tambah anggota
                </button>
              )}

              {/* Preview ringkas */}
              {members.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 10, color: cs.muted, borderTop: "1px solid " + cs.border + "44", paddingTop: 4 }}>
                  {members.map(m => (
                    <span key={m.name} style={{ marginRight: 8 }}>
                      <span style={{ color: getTechColor(m.name, teknisiData), fontWeight: 700 }}>{m.name}</span>
                      <span style={{ color: cs.muted }}> ({m.role})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════
// Safety Net Panel — Deteksi tim confirmed dengan anggota ijin/absen
// ══════════════════════════════════════════════════
function SafetyNetPanel({ slotDate, dailySlots, availability, ordersData, teknisiData, supabase, showNotif, onReassigned }) {
  const [reassignMap, setReassignMap] = useState({});   // orderId → newTeknisi
  const [notifSent, setNotifSent] = useState({});       // orderId → bool
  const [saving, setSaving] = useState(false);

  // Cari slot yang confirmed tapi ada anggota yang absen
  const alerts = useMemo(() => {
    const confirmedSlots = dailySlots.filter(s => s.date === slotDate && s.confirmed);
    const result = [];
    for (const slot of confirmedSlots) {
      const members = [slot.member1, slot.member2, slot.member3, slot.member4].filter(Boolean);
      const absentMembers = members.filter(name => {
        const rec = availability.find(a => a.teknisi === name && a.date === slotDate);
        return rec && rec.is_available === false;
      });
      if (absentMembers.length === 0) continue;
      const affectedOrders = ordersData.filter(o =>
        o.date === slotDate && o.team_slot === slot.slot && o.status !== "CANCELLED"
      );
      result.push({ slot: slot.slot, absentMembers, affectedOrders });
    }
    return result;
  }, [dailySlots, slotDate, availability, ordersData]);

  if (alerts.length === 0) return null;

  async function handleReassign(order) {
    const newTeknisi = reassignMap[order.id];
    if (!newTeknisi) return showNotif("Pilih teknisi pengganti dulu", "error");
    setSaving(true);
    const { error } = await supabase.from("orders")
      .update({ teknisi: newTeknisi, last_changed_by: "Safety Net" })
      .eq("id", order.id);
    setSaving(false);
    if (error) return showNotif("Gagal reassign: " + error.message, "error");
    showNotif(`Order ${order.id} di-reassign ke ${newTeknisi}`);
    if (onReassigned) onReassigned(order.id, newTeknisi);
  }

  async function handleNotifCustomer(order) {
    try {
      const token = import.meta.env.VITE_INTERNAL_API_SECRET || "";
      const msg = `Halo *${order.customer}* 👋\n\nKami perlu informasikan bahwa jadwal service AC Anda hari ini mengalami perubahan jadwal karena teknisi kami berhalangan hadir.\n\nTim kami akan segera menghubungi Anda untuk penjadwalan ulang. Mohon maaf atas ketidaknyamanannya 🙏\n\n— AClean Service`;
      const r = await fetch("/api/send-wa", {
        method: "POST",
        headers: { "x-internal-token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ phone: order.phone, message: msg }),
      });
      if (r.ok) {
        setNotifSent(p => ({ ...p, [order.id]: true }));
        showNotif(`WA terkirim ke ${order.customer}`);
      } else showNotif("Gagal kirim WA", "error");
    } catch (e) {
      showNotif("Error: " + e.message, "error");
    }
  }

  const availableTeknisi = [...new Set(
    dailySlots.filter(s => s.date === slotDate)
      .flatMap(s => [s.member1, s.member2, s.member3, s.member4].filter(Boolean))
  )].filter(name => {
    const rec = availability.find(a => a.teknisi === name && a.date === slotDate);
    return !rec || rec.is_available !== false;
  });

  return (
    <div style={{ background: cs.red + "0a", border: "2px solid " + cs.red + "44", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>🚨</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.red }}>Safety Net — Anggota Tim Ijin/Absen</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>
            Tim di bawah sudah di-Confirm namun ada anggota yang ditandai tidak hadir. Tindakan diperlukan.
          </div>
        </div>
      </div>

      {alerts.map(alert => (
        <div key={alert.slot} style={{ background: cs.card, borderRadius: 10, padding: 14, marginBottom: 10, border: "1px solid " + cs.red + "33" }}>
          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 6 }}>
            {alert.slot}
            <span style={{ marginLeft: 8, fontSize: 11, color: cs.red, fontWeight: 400 }}>
              Absen: {alert.absentMembers.join(", ")}
            </span>
          </div>

          {alert.affectedOrders.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada order aktif untuk tim ini hari ini.</div>
          ) : alert.affectedOrders.map(ord => (
            <div key={ord.id} style={{ background: cs.surface, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                <div>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: cs.accent, fontWeight: 700 }}>{ord.id}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: cs.text }}>{ord.customer}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: cs.muted }}>{ord.service} — {ord.time?.slice(0,5)}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {/* WA Notif ke customer */}
                  {ord.phone && (
                    <button onClick={() => handleNotifCustomer(ord)} disabled={notifSent[ord.id]}
                      style={{ background: notifSent[ord.id] ? cs.green + "22" : cs.yellow + "22", border: "1px solid " + (notifSent[ord.id] ? cs.green + "44" : cs.yellow + "44"), color: notifSent[ord.id] ? cs.green : cs.yellow, borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
                      {notifSent[ord.id] ? "✓ WA Terkirim" : "📲 WA Customer"}
                    </button>
                  )}
                  {/* Reassign teknisi */}
                  <select value={reassignMap[ord.id] || ""} onChange={e => setReassignMap(p => ({ ...p, [ord.id]: e.target.value }))}
                    style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 6, padding: "4px 8px", fontSize: 11, outline: "none" }}>
                    <option value="">— Pilih Teknisi Pengganti —</option>
                    {availableTeknisi.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button onClick={() => handleReassign(ord)} disabled={saving || !reassignMap[ord.id]}
                    style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Ganti →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

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

// 10 slot tim — saat ini pakai 7, siapkan sampai 10
const TEAM_SLOTS = Array.from({ length: 10 }, (_, i) => `Team ${String(i + 1).padStart(2, "0")}`);
const MEMBER_ROLES = ["teknisi", "helper"];
const EMPTY_SLOT = { member1: "", member1_role: "teknisi", member2: "", member2_role: "helper", member3: "", member3_role: "helper", member4: "", member4_role: "helper", confirmed: false };

const EMPTY_FORM = {
  customer: "", phone: "", service: "Cleaning", type: "", address: "", date: "", time: "09:00",
  time_end: "10:00", team_slot: "", notes: "", status: "PENDING", units: 1,
  customer_id: null,
};

export default function OrderInboxView({ ordersData, setOrdersData, customersData, teknisiData, currentUser, supabase, showNotif, showConfirm, auditUserName, TODAY, sendWA }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, date: TODAY });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterTeam, setFilterTeam] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  // Tanggal aktif dari klik di Time Grid — Planning Order ikut filter ke hari ini
  const [gridDate, setGridDate] = useState(null);

  // ── Team slot state ──
  const [dailySlots, setDailySlots] = useState([]);   // [{date, slot, member1..4, confirmed}]
  const [slotDate, setSlotDate] = useState(TODAY);    // tanggal aktif di panel tim
  const [slotLoading, setSlotLoading] = useState(false);
  // availability (hadir/tidak) tetap ada untuk toggle per individu
  const [availability, setAvailability] = useState([]);

  // ── Team presets (teknisi default per slot) ──
  const [teamPresets, setTeamPresets] = useState({}); // slot → teknisi

  // Load data saat mount
  useEffect(() => {
    async function load() {
      const [slotRes, availRes, presetRes] = await Promise.all([
        supabase.from("daily_team_slots").select("*").gte("date", TODAY).order("date").order("slot").limit(300),
        supabase.from("technician_availability").select("*").gte("date", TODAY).order("date").limit(200),
        supabase.from("team_presets").select("slot,teknisi").order("sort_order"),
      ]);
      if (slotRes.data) setDailySlots(slotRes.data);
      if (availRes.data) setAvailability(availRes.data);
      if (presetRes.data) {
        const map = {};
        presetRes.data.forEach(r => { map[r.slot] = r.teknisi; });
        setTeamPresets(map);
      }
    }
    load();
  }, []);

  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekLabel = `${weekDays[0].date.slice(5).replace("-", "/")} – ${weekDays[6].date.slice(5).replace("-", "/")}`;

  // Semua anggota aktif (teknisi + helper)
  const activeTeknisi = useMemo(() =>
    (teknisiData || []).filter(t => t.active !== false &&
      ["Teknisi", "Helper", "Owner", "Admin"].includes(t.role)),
    [teknisiData]
  );

  // Helper: cek kehadiran individu
  function isAvailable(name, date) {
    const rec = availability.find(a => a.teknisi === name && a.date === date);
    return rec ? rec.is_available : true;
  }

  // Ambil slot untuk tanggal+nama tim tertentu (atau buat empty, auto-fill teknisi dari preset)
  function getSlotData(date, slotName) {
    const existing = dailySlots.find(s => s.date === date && s.slot === slotName);
    if (existing) return existing;
    const presetTeknisi = teamPresets[slotName] || "";
    return { ...EMPTY_SLOT, date, slot: slotName, member1: presetTeknisi, member1_role: "teknisi" };
  }

  // Semua anggota dalam sebuah slot (nama saja, filter empty)
  function slotMembers(slot) {
    return [slot.member1, slot.member2, slot.member3, slot.member4].filter(Boolean);
  }

  function slotMemberRoles(slot) {
    return [
      slot.member1 ? { name: slot.member1, role: slot.member1_role } : null,
      slot.member2 ? { name: slot.member2, role: slot.member2_role } : null,
      slot.member3 ? { name: slot.member3, role: slot.member3_role } : null,
      slot.member4 ? { name: slot.member4, role: slot.member4_role } : null,
    ].filter(Boolean);
  }

  // Upsert slot ke DB
  async function saveSlot(date, slotName, fields) {
    setSlotLoading(true);
    const payload = { date, slot: slotName, ...fields, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("daily_team_slots")
      .upsert(payload, { onConflict: "date,slot" }).select().single();
    setSlotLoading(false);
    if (error) return showNotif("Gagal simpan slot: " + error.message);
    setDailySlots(prev => {
      const idx = prev.findIndex(s => s.date === date && s.slot === slotName);
      return idx >= 0 ? prev.map((s, i) => i === idx ? data : s) : [...prev, data];
    });
    return data;
  }

  // Confirm slot → propagasi nama ke semua orders hari itu yg pakai slot ini
  async function confirmSlot(date, slotName) {
    const slot = getSlotData(date, slotName);
    const members = slotMemberRoles(slot);
    if (members.length === 0) return showNotif("Isi minimal 1 anggota dulu", "error");

    // Tentukan teknisi utama (member pertama bertipe teknisi, fallback member1)
    const utama = members.find(m => m.role === "teknisi") || members[0];
    const helpers = members.filter(m => m !== utama);

    const updatePayload = {
      teknisi: utama.name,
      helper:  helpers[0]?.name || null,
      helper2: helpers[1]?.name || null,
      helper3: helpers[2]?.name || null,
      last_changed_by: auditUserName(),
    };

    // Update semua orders hari itu dengan team_slot ini
    const { error: ordErr } = await supabase.from("orders")
      .update(updatePayload)
      .eq("date", date).eq("team_slot", slotName)
      .neq("status", "CANCELLED");

    if (ordErr) return showNotif("Gagal propagasi ke orders: " + ordErr.message);

    // Update state orders lokal
    setOrdersData(prev => prev.map(o =>
      o.date === date && o.team_slot === slotName && o.status !== "CANCELLED"
        ? { ...o, ...updatePayload }
        : o
    ));

    // Tandai slot sebagai confirmed
    await saveSlot(date, slotName, { ...slot, confirmed: true });
    showNotif(`${slotName} dikonfirmasi → ${members.map(m => m.name).join(", ")} ter-assign ke ${date}`);
  }


  // Toggle hadir/tidak individu
  async function toggleAvailability(name, date, current) {
    const newVal = !current;
    const { error } = await supabase.from("technician_availability")
      .upsert({ date, teknisi: name, is_available: newVal, updated_at: new Date().toISOString() },
        { onConflict: "date,teknisi" });
    if (error) return showNotif("Gagal: " + error.message);
    setAvailability(prev => {
      const idx = prev.findIndex(a => a.teknisi === name && a.date === date);
      return idx >= 0
        ? prev.map((a, i) => i === idx ? { ...a, is_available: newVal } : a)
        : [...prev, { teknisi: name, date, is_available: newVal }];
    });
  }

  // ── Bulk WA ke semua teknisi & helper hari ini ──
  const [bulkDispatching, setBulkDispatching] = useState(false);

  async function handleBulkDispatch(date) {
    if (!sendWA) { showNotif("⚠️ sendWA tidak tersedia"); return; }
    setBulkDispatching(true);
    try {
      // Ambil semua order hari itu yang confirmed/pending (bukan cancelled)
      const dayOrders = ordersData.filter(o =>
        o.date === date && !["CANCELLED", "COMPLETED", "INVOICED"].includes(o.status)
      );
      if (dayOrders.length === 0) { showNotif("Tidak ada order aktif di tanggal ini"); return; }

      // Kumpulkan pesan per anggota (teknisi & helper), group by nama
      const msgPerMember = {}; // name → { phone, lines[] }

      for (const o of dayOrders) {
        const members = [
          { name: o.teknisi, role: "Teknisi" },
          { name: o.helper,  role: "Helper" },
          { name: o.helper2, role: "Helper" },
          { name: o.helper3, role: "Helper" },
        ].filter(m => m.name);

        const jobLine = `• ${o.time?.slice(0,5) || "—"} ${o.customer} (${o.service}${o.units > 1 ? " ×" + o.units : ""}) — ${o.address || "alamat belum diisi"}`;

        for (const m of members) {
          const tek = teknisiData.find(t => t.name === m.name);
          if (!tek?.phone) continue;
          if (!msgPerMember[m.name]) {
            msgPerMember[m.name] = { phone: tek.phone, lines: [], role: m.role };
          }
          msgPerMember[m.name].lines.push(jobLine);
        }
      }

      const names = Object.keys(msgPerMember);
      if (names.length === 0) { showNotif("⚠️ Tidak ada nomor HP teknisi/helper yang terdaftar"); return; }

      let sent = 0;
      for (const name of names) {
        const { phone, lines, role } = msgPerMember[name];
        const msg =
          `📋 *Jadwal ${date} — AClean*\n\n` +
          `Halo *${name}* (${role}), berikut job kamu hari ini:\n\n` +
          lines.join("\n") +
          `\n\nMohon siapkan alat & konfirmasi kehadiran. Terima kasih! 💪`;
        const ok = await sendWA(phone, msg);
        if (ok) sent++;
      }
      showNotif(`✅ WA terkirim ke ${sent} dari ${names.length} teknisi/helper`);
    } catch (e) {
      showNotif("❌ Gagal bulk dispatch: " + e.message);
    } finally {
      setBulkDispatching(false);
    }
  }

  // Conflict check realtime — pakai durasi aktual order ini
  const conflict = useMemo(() =>
    hasConflict(ordersData, form.teknisi, form.date, form.time, editId, form.service, form.units),
    [ordersData, form.teknisi, form.date, form.time, editId, form.service, form.units]
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
      team_slot: form.team_slot || null,
      source: "whatsapp",
      ...(form.customer_id ? { customer_id: form.customer_id } : {}),
      last_changed_by: auditUserName(),
    };

    try {
      if (editId) {
        const { error } = await supabase.from("orders").update(payload).eq("id", editId);
        if (error) throw error;
        // Update customer record if phone/address changed
        if (form.customer_id) {
          await supabase.from("customers").update({
            name: payload.customer,
            phone: payload.phone || null,
            address: payload.address || null,
          }).eq("id", form.customer_id);
        }
        setOrdersData(prev => prev.map(o => o.id === editId ? { ...o, ...payload } : o));
        showNotif("Order diperbarui");
        setEditId(null);
      } else {
        const id = "WA-" + Date.now();
        const { error } = await supabase.from("orders").insert({ ...payload, id });
        if (error) throw error;
        // Auto-save customer if not already linked
        if (!form.customer_id && payload.customer) {
          const { data: saved } = await supabase.from("customers").upsert(
            { name: payload.customer, phone: payload.phone || null, address: payload.address || null },
            { onConflict: "phone", ignoreDuplicates: false }
          ).select("id").single();
          if (saved?.id) {
            await supabase.from("orders").update({ customer_id: saved.id }).eq("id", id);
            setOrdersData(prev => prev.map(o => o.id === id ? { ...o, customer_id: saved.id } : o));
          }
        }
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
      team_slot: order.team_slot || "",
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
        const a = orders[i], b = orders[j];
        if (!a.time || !b.time) continue;
        const [h1, m1] = a.time.split(":").map(Number);
        const aStart = h1 * 60 + m1;
        const aEnd = aStart + Math.round(hitungDurasi(a.service || "Cleaning", a.units || 1) * 60);
        const [h2, m2] = b.time.split(":").map(Number);
        const bStart = h2 * 60 + m2;
        const bEnd = bStart + Math.round(hitungDurasi(b.service || "Cleaning", b.units || 1) * 60);
        if (aStart < bEnd && aEnd > bStart) return true;
      }
    }
    return false;
  }

  // ── Opsi B: update teknisi/helper inline tanpa buka form edit ──
  async function handleQuickAssign(order, field, value) {
    let update = { [field]: value || null, last_changed_by: auditUserName() };

    // Jika ganti team_slot → propagate teknisi & helper dari anggota slot baru ke order
    if (field === "team_slot" && value) {
      const slot = getSlotData(order.date, value);
      if (slot) {
        const members = slotMemberRoles(slot);
        const utama = members.find(m => m.role === "Teknisi") || members[0];
        const helpers = members.filter(m => m !== utama);
        update = {
          ...update,
          teknisi: utama?.name || null,
          helper: helpers[0]?.name || null,
          helper2: helpers[1]?.name || null,
          helper3: helpers[2]?.name || null,
        };
      }
    }

    const { error } = await supabase.from("orders").update(update).eq("id", order.id);
    if (error) return showNotif("Gagal update " + field + ": " + error.message);
    setOrdersData(prev => prev.map(o => o.id === order.id ? { ...o, ...update } : o));
  }

  // ── Inbox list — hanya today + ke depan; bila gridDate aktif, filter ke hari itu ──
  const inboxOrders = useMemo(() => {
    let list = ordersData.filter(o => {
      if (!o.date) return false;
      if (gridDate) return o.date === gridDate;                  // filter ke hari yang diklik di Time Grid
      if (o.date < TODAY) return false;                          // buang masa lalu
      if (o.status === "CANCELLED" && o.date < TODAY) return false;
      return true;
    });
    if (filterStatus !== "ALL") list = list.filter(o => o.status === filterStatus);
    if (filterTeam !== "ALL") list = list.filter(o => (o.team_slot || "") === filterTeam);
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
      const dateComp = (a.date || "").localeCompare(b.date || "");
      if (dateComp !== 0) return dateComp;
      return (a.time || "").localeCompare(b.time || "");
    });
  }, [ordersData, filterStatus, filterTeam, searchQ, TODAY, gridDate]);

  const inputStyle = {
    background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
    color: cs.text, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ═══ PANEL DAILY TEAM SLOTS ═══ */}
      <DailyTeamPanel
        slotDate={slotDate} setSlotDate={setSlotDate}
        TODAY={TODAY} TEAM_SLOTS={TEAM_SLOTS}
        activeTeknisi={activeTeknisi} teknisiData={teknisiData}
        availability={availability} toggleAvailability={toggleAvailability}
        getSlotData={getSlotData} slotMembers={slotMembers} slotMemberRoles={slotMemberRoles}
        saveSlot={saveSlot} confirmSlot={confirmSlot}
        slotLoading={slotLoading} dailySlots={dailySlots}
        ordersData={ordersData} teamPresets={teamPresets}
        onBulkDispatch={handleBulkDispatch} bulkDispatching={bulkDispatching}
      />

      {/* ═══ SAFETY NET PANEL ═══ */}
      <SafetyNetPanel
        slotDate={slotDate}
        dailySlots={dailySlots}
        availability={availability}
        ordersData={ordersData}
        teknisiData={teknisiData}
        supabase={supabase}
        showNotif={showNotif}
        onReassigned={(orderId, newTeknisi) => setOrdersData(prev =>
          prev.map(o => o.id === orderId ? { ...o, teknisi: newTeknisi } : o)
        )}
      />

      {/* ═══ FORM QUICK ENTRY ═══ */}
      <div style={{ background: cs.surface, border: "1px solid " + (editId ? cs.yellow : cs.border), borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: editId ? cs.yellow : cs.text, marginBottom: 16 }}>
          {editId ? "✏️ Edit Planning — " + editId : "➕ Tambah Planning Order"}
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

          {/* Team Slot */}
          <div>
            <label style={labelStyle}>Assign ke Tim</label>
            <select style={inputStyle} value={form.team_slot} onChange={e => setField("team_slot", e.target.value)}>
              <option value="">— Pilih tim —</option>
              {TEAM_SLOTS.map(s => {
                const slot = getSlotData(form.date || TODAY, s);
                const members = slotMembers(slot);
                const hasMembers = members.length > 0;
                return (
                  <option key={s} value={s}>
                    {s}{hasMembers ? " — " + members.join(", ") : " (kosong)"}
                  </option>
                );
              })}
            </select>
            {form.team_slot && (() => {
              const slot = getSlotData(form.date || TODAY, form.team_slot);
              const members = slotMemberRoles(slot);
              return members.length > 0 ? (
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>
                  {members.map(m => (
                    <span key={m.name} style={{ marginRight: 8 }}>
                      <span style={{ color: getTechColor(m.name, teknisiData), fontWeight: 600 }}>{m.name}</span>
                      <span style={{ color: cs.muted }}> ({m.role})</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: cs.yellow, marginTop: 3 }}>⚠️ Tim ini belum diisi hari {form.date || TODAY}</div>
              );
            })()}
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
        onDateChange={d => setGridDate(d)}
      />

      {/* ═══ DAFTAR ORDER INBOX (today + ke depan) ═══ */}
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              📋 Planning Order
              <span style={{ color: cs.muted, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>({inboxOrders.length})</span>
              {gridDate && (
                <span style={{ marginLeft: 10, background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  onClick={() => setGridDate(null)}>
                  📅 {gridDate} &nbsp;✕ hapus filter
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              {gridDate ? `Filter: ${gridDate} · klik "✕ hapus filter" untuk lihat semua` : "Hari ini & ke depan · klik hari di Time Grid untuk filter · CONFIRMED → naik ke Order Masuk"}
            </div>
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

        {/* Filter per Tim — chip buttons */}
        {(() => {
          // Kumpulkan semua team_slot yang ada di inboxOrders (sebelum filter tim)
          const teamsInView = TEAM_SLOTS.filter(s =>
            ordersData.some(o => {
              if (!o.date) return false;
              if (gridDate) return o.date === gridDate && o.team_slot === s;
              return o.date >= TODAY && o.team_slot === s && o.status !== "CANCELLED";
            })
          );
          if (teamsInView.length === 0) return null;
          return (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600, marginRight: 2 }}>Filter Tim:</span>
              <button
                onClick={() => setFilterTeam("ALL")}
                style={{
                  background: filterTeam === "ALL" ? cs.accent : cs.card,
                  color: filterTeam === "ALL" ? "#fff" : cs.muted,
                  border: "1px solid " + (filterTeam === "ALL" ? cs.accent : cs.border),
                  borderRadius: 20, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: filterTeam === "ALL" ? 700 : 400,
                }}>
                Semua Tim
              </button>
              {teamsInView.map(s => {
                // Hitung order & konflik untuk tim ini
                const teamOrders = inboxOrders.filter(o => o.team_slot === s);
                const hasConflict = teamOrders.some(o => {
                  if (!o.time || !o.teknisi) return false;
                  const same = teamOrders.filter(o2 => o2.teknisi === o.teknisi && o2.id !== o.id && o2.time);
                  return same.some(o2 => {
                    const [h1,m1] = o.time.split(":").map(Number);
                    const s1 = h1*60+m1, e1 = s1 + Math.round(hitungDurasi(o.service,o.units)*60);
                    const [h2,m2] = o2.time.split(":").map(Number);
                    const s2 = h2*60+m2, e2 = s2 + Math.round(hitungDurasi(o2.service,o2.units)*60);
                    return s1 < e2 && e1 > s2;
                  });
                });
                const isActive = filterTeam === s;
                return (
                  <button key={s}
                    onClick={() => setFilterTeam(isActive ? "ALL" : s)}
                    style={{
                      background: isActive ? (hasConflict ? cs.red : cs.green) : cs.card,
                      color: isActive ? "#fff" : hasConflict ? cs.red : cs.text,
                      border: "1px solid " + (hasConflict ? cs.red + (isActive ? "" : "88") : isActive ? cs.green : cs.border),
                      borderRadius: 20, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: isActive ? 700 : 400,
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                    {hasConflict && <span style={{ fontSize: 10 }}>⚠️</span>}
                    {s}
                    <span style={{
                      background: isActive ? "rgba(255,255,255,0.25)" : cs.border,
                      color: isActive ? "#fff" : cs.muted,
                      borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 800,
                    }}>{teamOrders.length}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

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
                {["Tgl & Jam", "Customer", "Layanan", "Tim", "Status", "Aksi"].map(h => (
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

                    {/* Tim — dropdown team_slot + preview anggota */}
                    <td style={{ padding: "8px 10px", minWidth: 160 }}>
                      <select value={o.team_slot || ""}
                        onChange={e => handleQuickAssign(o, "team_slot", e.target.value)}
                        style={{ ...ddStyle, color: o.team_slot ? cs.accent : cs.muted, borderColor: o.team_slot ? cs.accent + "66" : cs.border }}>
                        <option value="">— Pilih tim —</option>
                        {TEAM_SLOTS.map(s => {
                          const slot = getSlotData(o.date, s);
                          const members = slotMembers(slot);
                          return (
                            <option key={s} value={s}>
                              {s}{members.length > 0 ? " — " + members.join(", ") : ""}
                            </option>
                          );
                        })}
                      </select>
                      {o.team_slot && (() => {
                        const slot = getSlotData(o.date, o.team_slot);
                        const members = slotMemberRoles(slot);
                        if (members.length === 0) return (
                          <div style={{ color: cs.yellow, fontSize: 9, marginTop: 2 }}>⚠️ belum diisi</div>
                        );
                        return (
                          <div style={{ fontSize: 9, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 3 }}>
                            {members.map(m => (
                              <span key={m.name} style={{ color: getTechColor(m.name, teknisiData), fontWeight: 600 }}>
                                {m.name}
                              </span>
                            ))}
                            {slot.confirmed && <span style={{ color: cs.green, marginLeft: 2 }}>✓</span>}
                          </div>
                        );
                      })()}
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
                  <td colSpan={6} style={{ textAlign: "center", color: cs.muted, padding: 32, fontSize: 13 }}>
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
