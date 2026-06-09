import { useState, useMemo, useCallback, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { SERVICE_TYPES } from "../constants/services.js";
import { statusColor, statusLabel } from "../constants/status.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { getTechColor } from "../lib/techColor.js";
import { detectContinuationCandidates, calcContinuationDayNum } from "../lib/orders.js";

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
  if (!timeStr || timeStr === "00:00" || timeStr === "00:00:00") return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (h === 0 && m === 0) return null; // jam belum diisi, anggap kosong
  return h * 60 + m;
}

function hasValidTime(timeStr) {
  return toMinutes(timeStr) !== null;
}

// ── Conflict detection: pakai durasi aktual, bukan ±1 jam flat ──
function hasConflict(orders, teknisi, date, time, excludeId = null, service = "Cleaning", units = 1, timeEnd = null) {
  if (!teknisi || !date || !hasValidTime(time)) return null;
  const startMin = toMinutes(time);
  const timeEndMin = toMinutes(timeEnd);
  const durMin = (timeEndMin !== null && timeEndMin > startMin)
    ? timeEndMin - startMin
    : Math.round(hitungDurasi(service, units) * 60);
  const endMin = startMin + durMin;
  const conflicts = orders.filter(o => {
    if (o.id === excludeId) return false;
    if (o.teknisi !== teknisi && o.teknisi2 !== teknisi) return false;
    if (o.date !== date) return false;
    if (!hasValidTime(o.time)) return false;
    if (!["PENDING","CONFIRMED","DISPATCHED","IN_PROGRESS","ON_SITE"].includes(o.status)) return false;
    const oStartMin = toMinutes(o.time);
    const oTimeEndMin = toMinutes(o.time_end);
    const oDurMin = (oTimeEndMin !== null && oTimeEndMin > oStartMin)
      ? oTimeEndMin - oStartMin
      : Math.round(hitungDurasi(o.service || "Cleaning", o.units || 1) * 60);
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
            // Job selesai (REPORT_SUBMITTED/COMPLETED/dst) tetap ditampilkan tapi redup (lihat isDone),
            // agar grid tidak terlihat kosong saat siang. Hanya CANCELLED yang disembunyikan.
            const tekOrders = dayOrders.filter(o =>
              hasValidTime(o.time) && o.teknisi === tek && o.status !== "CANCELLED"
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
                    // Pakai time_end manual jika ada, fallback ke durasi otomatis
                    const timeEndMin = toMinutes(o.time_end);
                    const durMin = (timeEndMin !== null && timeEndMin > startMin)
                      ? timeEndMin - startMin
                      : Math.round(hitungDurasi(o.service, o.units) * 60);
                    const endMin = startMin + durMin;

                    // Clamp ke grid
                    const leftPct = minToPercent(startMin);
                    const widthPct = minToPercent(endMin) - leftPct;

                    // Job yang sudah selesai/jalan ke tahap akhir → tampil redup, tidak ikut cek konflik
                    const isDone = ["REPORT_SUBMITTED","COMPLETED","VERIFIED","INVOICE_APPROVED","PAID","INVOICED"].includes(o.status);

                    // Konflik: overlap dengan order AKTIF lain di teknisi yang sama (job selesai diabaikan)
                    const isConflict = !isDone && tekOrders.some(o2 => {
                      if (o2.id === o.id) return false;
                      if (["REPORT_SUBMITTED","COMPLETED","VERIFIED","INVOICE_APPROVED","PAID","INVOICED","CANCELLED"].includes(o2.status)) return false;
                      const s2 = toMinutes(o2.time);
                      if (s2 === null) return false;
                      const t2End = toMinutes(o2.time_end);
                      const e2 = (t2End !== null && t2End > s2)
                        ? t2End
                        : s2 + Math.round(hitungDurasi(o2.service, o2.units) * 60);
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
                          background: isDone ? cs.muted + "1f" : (isConflict ? cs.red + "33" : color + "28"),
                          border: "2px solid " + (isDone ? cs.border : (isConflict ? cs.red + "99" : color + "88")),
                          borderRadius: 6,
                          cursor: "pointer",
                          overflow: "hidden",
                          display: "flex", flexDirection: "column", justifyContent: "center",
                          padding: "0 5px",
                          opacity: isDone ? 0.5 : 1,
                          zIndex: isConflict ? 2 : 1,
                          boxSizing: "border-box",
                        }}>
                        <div style={{ color: isDone ? cs.muted : color, fontWeight: 800, fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isDone && "✓ "}{o.time?.slice(0,5)}–{endStr}
                          {isConflict && " ⚠️"}
                        </div>
                        <div style={{ color: cs.text, fontWeight: 700, fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: isDone ? "line-through" : "none" }}>
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
              (!o.teknisi || !hasValidTime(o.time)) &&
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

const INBOX_STATUSES = ["PENDING", "CONFIRMED", "CONTINUED", "CANCELLED"];
const WEEK_DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const DAY_NAMES  = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

// ─────────────────────────────────────────────
// Panel Isi Tim Harian (Team 01–10)
// ─────────────────────────────────────────────
function DailyTeamPanel({ slotDate, setSlotDate, TODAY, TEAM_SLOTS, activeTeknisi, teknisiData, availability, setAvailabilityStatus, getSlotData, slotMembers, slotMemberRoles, saveSlot, confirmSlot, slotLoading, dailySlots, ordersData, teamPresets, onBulkDispatch, bulkDispatching }) {

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
  function availRec(name, date) {
    return availability.find(a => a.teknisi === name && a.date === date);
  }
  const STATUS_META = {
    AUTO:    { label: "Auto",    color: "#64748b", emoji: "⚪" },
    STANDBY: { label: "Standby", color: "#3b82f6", emoji: "🔵" },
    IJIN:    { label: "Ijin",    color: "#f59e0b", emoji: "🟡" },
    SAKIT:   { label: "Sakit",   color: "#fb923c", emoji: "🟠" },
    ALPA:    { label: "Alpa",    color: "#ef4444", emoji: "🔴" },
  };
  const [availEditor, setAvailEditor] = useState(null);

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

      {/* Kehadiran individu — hybrid: auto dari orders + override per status */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6, fontWeight: 600 }}>
          Kehadiran {slotDate} — klik nama untuk set status:
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {activeTeknisi.map(t => {
            const rec = availRec(t.name, slotDate);
            const status = rec?.status || "AUTO";
            const meta = STATUS_META[status] || STATUS_META.AUTO;
            const color = getTechColor(t.name, teknisiData);
            const isOverride = status !== "AUTO";
            // Ijin/Sakit/Alpa = tidak hadir → tampil "off"/abu-abu (redup, dicoret)
            const isAbsent = ["IJIN", "SAKIT", "ALPA"].includes(status);
            return (
              <button key={t.name}
                title={rec?.reason ? `${meta.label} — ${rec.reason}` : meta.label}
                onClick={() => setAvailEditor({ name: t.name, date: slotDate, status, reason: rec?.reason || "" })}
                style={{ display: "flex", alignItems: "center", gap: 6, background: isAbsent ? cs.card : isOverride ? meta.color + "22" : color + "18", border: "2px solid " + (isAbsent ? cs.border : isOverride ? meta.color : color), borderRadius: 8, padding: "5px 10px", cursor: "pointer", transition: "all 0.15s", opacity: isAbsent ? 0.5 : 1 }}>
                <span style={{ fontSize: 12, filter: isAbsent ? "grayscale(1)" : "none" }}>{meta.emoji}</span>
                <span style={{ color: isAbsent ? cs.muted : isOverride ? meta.color : color, fontWeight: 700, fontSize: 11, textDecoration: isAbsent ? "line-through" : "none" }}>{t.name}</span>
                <span style={{ fontSize: 9, color: isAbsent ? cs.muted : meta.color, fontWeight: 600 }}>{meta.label}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: cs.muted, marginTop: 5 }}>
          ⚪ Auto (ikut order) · 🔵 Standby +1 hari · 🟡 Ijin / 🟠 Sakit / 🔴 Alpa = −1 hari payroll
        </div>
      </div>

      {/* Popover editor status kehadiran */}
      {availEditor && (
        <div onClick={() => setAvailEditor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 12, padding: 20, width: 340 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text, marginBottom: 2 }}>
              Status Kehadiran — {availEditor.name}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 14 }}>{availEditor.date}</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {["AUTO","STANDBY","IJIN","SAKIT","ALPA"].map(s => {
                const m = STATUS_META[s];
                const sel = availEditor.status === s;
                return (
                  <button key={s} onClick={() => setAvailEditor(p => ({ ...p, status: s }))}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 7, border: "2px solid " + (sel ? m.color : cs.border), background: sel ? m.color + "22" : cs.card, color: cs.text, cursor: "pointer", textAlign: "left", fontSize: 12, fontWeight: sel ? 700 : 400 }}>
                    <span style={{ fontSize: 14 }}>{m.emoji}</span>
                    <span style={{ flex: 1 }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: m.color }}>
                      {s === "AUTO" ? "ikut count order" : s === "STANDBY" ? "+1 hari kerja" : "−1 hari kerja"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Catatan (opsional)</div>
              <input value={availEditor.reason}
                onChange={e => setAvailEditor(p => ({ ...p, reason: e.target.value }))}
                placeholder="contoh: izin acara keluarga"
                style={{ width: "100%", padding: "7px 9px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12, boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setAvailEditor(null)}
                style={{ padding: "7px 14px", borderRadius: 6, background: "transparent", border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 12 }}>
                Batal
              </button>
              <button onClick={async () => {
                  await setAvailabilityStatus(availEditor.name, availEditor.date, availEditor.status, availEditor.reason);
                  setAvailEditor(null);
                }}
                style={{ padding: "7px 18px", borderRadius: 6, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}


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
function SafetyNetPanel({ slotDate, dailySlots, availability, ordersData, teknisiData, supabase, showNotif, onReassigned, apiHeaders }) {
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
      const msg = `Halo *${order.customer}* 👋\n\nKami perlu informasikan bahwa jadwal service AC Anda hari ini mengalami perubahan jadwal karena teknisi kami berhalangan hadir.\n\nTim kami akan segera menghubungi Anda untuk penjadwalan ulang. Mohon maaf atas ketidaknyamanannya 🙏\n\n— AClean Service`;
      const headers = apiHeaders ? await apiHeaders() : { "Content-Type": "application/json" };
      const r = await fetch("/api/send-wa", {
        method: "POST",
        headers,
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

// Minimal 10 slot tim; tim ekstra (>10) ditambah dinamis dari team_presets
const TEAM_SLOTS_BASE = Array.from({ length: 10 }, (_, i) => `Team ${String(i + 1).padStart(2, "0")}`);
const MEMBER_ROLES = ["teknisi", "helper"];
const EMPTY_SLOT = { member1: "", member1_role: "teknisi", member2: "", member2_role: "helper", member3: "", member3_role: "helper", member4: "", member4_role: "helper", confirmed: false };

const EMPTY_FORM = {
  customer: "", phone: "", service: "Cleaning", type: "", address: "", date: "", time: "09:00",
  time_end: "10:00", team_slot: "", notes: "", status: "PENDING", units: 1,
  customer_id: null,
};

export default function OrderInboxView({ ordersData, setOrdersData, customersData, setCustomersData, teknisiData, currentUser, supabase, showNotif, showConfirm, auditUserName, TODAY, sendWA, showUndoToast, insertOrder, apiHeaders }) {
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

  // Slot tim aktif: base 10 + tim ekstra dari preset, urut by nomor
  const TEAM_SLOTS = useMemo(() => {
    const all = Array.from(new Set([...TEAM_SLOTS_BASE, ...Object.keys(teamPresets)]));
    return all.sort((a, b) =>
      (parseInt(a.match(/\d+/)?.[0] || "0", 10)) - (parseInt(b.match(/\d+/)?.[0] || "0", 10))
    );
  }, [teamPresets]);

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

  // Upsert slot ke DB + auto-propagate ke orders dgn team_slot ini
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

    // Auto-propagate teknisi/helper ke semua orders dgn team_slot ini
    // (jaring untuk order yang dibuat sebelum slot diisi atau saat backfill member)
    const members = slotMemberRoles(data);
    if (members.length > 0) {
      const utama = members.find(m => (m.role || "").toLowerCase() === "teknisi") || members[0];
      const helpers = members.filter(m => m !== utama);
      const propagatePayload = {
        teknisi: utama.name,
        helper:  helpers[0]?.name || null,
        helper2: helpers[1]?.name || null,
        helper3: helpers[2]?.name || null,
        last_changed_by: auditUserName(),
      };
      await supabase.from("orders")
        .update(propagatePayload)
        .eq("date", date).eq("team_slot", slotName)
        .neq("status", "CANCELLED");
      setOrdersData(prev => prev.map(o =>
        o.date === date && o.team_slot === slotName && o.status !== "CANCELLED"
          ? { ...o, ...propagatePayload }
          : o
      ));
    }

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


  // Set status kehadiran individu — hybrid attendance
  // status: "AUTO"|null = auto (dari orders), "STANDBY" = +1 hari, "IJIN"|"SAKIT"|"ALPA" = −1 hari
  async function setAvailabilityStatus(name, date, status, reason) {
    const dbStatus = (!status || status === "AUTO") ? null : status;
    const is_available = !["IJIN","SAKIT","ALPA"].includes(dbStatus);
    const { error } = await supabase.from("technician_availability")
      .upsert({ date, teknisi: name, status: dbStatus, reason: reason || null, is_available, updated_at: new Date().toISOString() },
        { onConflict: "date,teknisi" });
    if (error) return showNotif("Gagal: " + error.message);
    setAvailability(prev => {
      const idx = prev.findIndex(a => a.teknisi === name && a.date === date);
      const row = { teknisi: name, date, status: dbStatus, reason: reason || null, is_available };
      return idx >= 0
        ? prev.map((a, i) => i === idx ? { ...a, ...row } : a)
        : [...prev, row];
    });
  }

  // ── Multi-hari: state saat form diisi sebagai lanjutan order lain ──
  const [continuationFrom, setContinuationFrom] = useState(null); // order induk
  const [continuationDismissed, setContinuationDismissed] = useState(false);

  // Auto-detect pekerjaan lanjutan berdasarkan no HP
  const autoDetectedJobs = useMemo(() => {
    if (editId || continuationFrom) return [];
    return detectContinuationCandidates(ordersData, form.phone);
  }, [form.phone, ordersData, editId, continuationFrom]);

  // Reset dismissed state saat phone berubah
  useEffect(() => { setContinuationDismissed(false); }, [form.phone]);

  // Buat order lanjutan — pre-fill form dari parent, tambah 1 hari, kosongkan tim
  function handleCreateContinuation(parentOrder) {
    // Hitung tanggal berikutnya yang belum ada child di hari itu
    // Hanya hitung child MULTI-DAY (skip Complain→Repair child yang non-multi-day)
    const existingDays = ordersData
      .filter(o => (o.parent_job_id === parentOrder.id && o.is_multi_day) || o.id === parentOrder.id)
      .map(o => o.date)
      .sort();
    const lastDate = existingDays[existingDays.length - 1] || parentOrder.date;
    const next = new Date(lastDate);
    next.setDate(next.getDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);

    const dayNum = existingDays.length + 1; // hari ke-N berikutnya

    setContinuationFrom({ ...parentOrder, _dayNum: dayNum });
    setEditId(null);
    setForm({
      customer: parentOrder.customer || "",
      phone: parentOrder.phone || "",
      service: parentOrder.service || "Cleaning",
      type: parentOrder.type || "",
      address: parentOrder.address || "",
      date: nextDate,
      time: parentOrder.time ? parentOrder.time.slice(0, 5) : "09:00",
      time_end: parentOrder.time_end ? parentOrder.time_end.slice(0, 5) : calcTimeEnd(parentOrder.time || "09:00", parentOrder.service || "Cleaning", parentOrder.units || 1),
      team_slot: "",
      notes: parentOrder.notes || "",
      status: "PENDING",
      units: parentOrder.units || 1,
      customer_id: parentOrder.customer_id || null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Bulk WA ke semua teknisi & helper hari ini ──
  const [bulkDispatching, setBulkDispatching] = useState(false);

  async function handleBulkDispatch(date) {
    if (!sendWA) { showNotif("⚠️ sendWA tidak tersedia"); return; }
    setBulkDispatching(true);
    try {
      // Ambil semua order hari itu yang confirmed/pending (bukan cancelled)
      // Filter jam 09:00–17:00 & urutkan berdasarkan jam
      const dayOrders = ordersData
        .filter(o => {
          if (o.date !== date) return false;
          if (["CANCELLED", "COMPLETED", "INVOICED"].includes(o.status)) return false;
          const min = toMinutes(o.time);
          if (min === null) return true; // belum ada jam, tetap ikut
          return min >= 9 * 60 && min <= 17 * 60;
        })
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      if (dayOrders.length === 0) { showNotif("Tidak ada order aktif di tanggal ini"); return; }

      // Kumpulkan pesan per anggota (teknisi & helper), group by nama
      const msgPerMember = {}; // name → { phone, lines[] }

      for (const o of dayOrders) {
        const members = [
          { name: o.teknisi,  role: "Teknisi" },
          { name: o.teknisi2, role: "Teknisi" },
          { name: o.teknisi3, role: "Teknisi" },
          { name: o.helper,   role: "Helper" },
          { name: o.helper2,  role: "Helper" },
          { name: o.helper3,  role: "Helper" },
        ].filter(m => m.name);

        // Komposisi tim untuk job ini (teknisi + helper yg bertugas) — dilampirkan
        // ke tiap anggota agar tahu siapa rekan satu timnya hari itu.
        const teknisiNames = [o.teknisi, o.teknisi2, o.teknisi3].filter(Boolean);
        const helperNames  = [o.helper, o.helper2, o.helper3].filter(Boolean);
        const teamStr = [
          teknisiNames.length ? `Teknisi: ${teknisiNames.join(", ")}` : null,
          helperNames.length  ? `Helper: ${helperNames.join(", ")}`   : null,
        ].filter(Boolean).join(" · ");

        const jobLine = `• ${o.time?.slice(0,5) || "—:——"} ${o.customer} (${o.service}${o.units > 1 ? " ×" + o.units : ""}) — ${o.address || "alamat belum diisi"}`
          + (teamStr ? `\n   👥 ${teamStr}` : "");

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
    hasConflict(ordersData, form.teknisi, form.date, form.time, editId, form.service, form.units, form.time_end),
    [ordersData, form.teknisi, form.date, form.time, form.time_end, editId, form.service, form.units]
  );

  // Server-side lookup by phone — anti miss customer di luar limit fetchCustomers
  const [serverCustMatches, setServerCustMatches] = useState({ key: "", rows: [] });
  // WA phone validation — warning kalau phone tidak ada riwayat chat tapi ada nomor mirip
  const [phoneCheck, setPhoneCheck] = useState(null);
  // shape: { inputPhone, similar: [{phone, name, last_chat, msg_count}], onProceed, onPickSuggestion }

  async function checkWAPhone(phoneNorm) {
    if (!phoneNorm || phoneNorm.length < 9) return { exact: { found: false }, similar: [] };
    const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    // Exact
    const exactRes = await supabase.from("wa_messages")
      .select("phone,name,created_at", { count: "exact" })
      .eq("phone", phoneNorm)
      .gte("created_at", ninetyAgo)
      .order("created_at", { ascending: false })
      .limit(1);
    const exactFound = (exactRes.count || 0) > 0;
    const exactInfo = exactFound
      ? { found: true, name: exactRes.data?.[0]?.name || null, last_chat: exactRes.data?.[0]?.created_at, msg_count: exactRes.count }
      : { found: false };
    // Similar — last 6 digit substring match, exclude phone itself
    let similar = [];
    if (!exactFound) {
      const last6 = phoneNorm.slice(-6);
      const candRes = await supabase.from("wa_messages")
        .select("phone,name,created_at")
        .ilike("phone", `%${last6}%`)
        .neq("phone", phoneNorm)
        .gte("created_at", ninetyAgo)
        .order("created_at", { ascending: false })
        .limit(200);
      const cands = candRes.data || [];
      const map = {};
      for (const m of cands) {
        const p = m.phone;
        if (!map[p]) map[p] = { phone: p, name: m.name || null, last_chat: m.created_at, msg_count: 0 };
        map[p].msg_count++;
        if (m.created_at > map[p].last_chat) map[p].last_chat = m.created_at;
        if (m.name && !map[p].name) map[p].name = m.name;
      }
      similar = Object.values(map)
        .filter(p => p.msg_count >= 3)
        .sort((a, b) => b.msg_count - a.msg_count)
        .slice(0, 5);
    }
    return { exact: exactInfo, similar };
  }
  useEffect(() => {
    const rawPhone = (form.phone || "").replace(/\D/g, "");
    const custIsNum = /^[0-9+]/.test(form.customer.trim());
    const rawCustNum = custIsNum ? form.customer.replace(/\D/g, "") : "";
    const candidate = rawPhone.length >= 8 ? form.phone : (rawCustNum.length >= 8 ? form.customer : "");
    if (!candidate) { setServerCustMatches(prev => prev.rows.length ? { key: "", rows: [] } : prev); return; }
    const norm = normalizePhone(candidate);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("customers")
          .select("id,name,phone,address,area,total_orders,last_service")
          .eq("phone", norm).limit(20);
        if (cancelled) return;
        setServerCustMatches({ key: norm, rows: (!error && data) ? data : [] });
      } catch (e) { if (!cancelled) setServerCustMatches({ key: norm, rows: [] }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.phone, form.customer, supabase]);

  // Gabungkan match client + server (dedupe by id)
  const mergeMatches = useCallback((clientRows, serverRows) => {
    const m = new Map();
    [...clientRows, ...serverRows].forEach(c => { if (c?.id) m.set(c.id, c); });
    return Array.from(m.values());
  }, []);

  // Autocomplete: cari by nama ATAU nomor WA
  const customerSuggest = useMemo(() => {
    const raw = form.customer.trim();
    if (raw.length < 2) return [];
    const q = raw.toLowerCase();
    const isPhone = /^[0-9+]/.test(raw);
    const client = (customersData || []).filter(c =>
      isPhone
        ? (c.phone || "").replace(/\D/g, "").includes(raw.replace(/\D/g, ""))
        : c.name?.toLowerCase().includes(q) || (c.phone || "").includes(q)
    );
    const server = (isPhone && serverCustMatches.key === normalizePhone(raw)) ? serverCustMatches.rows : [];
    return mergeMatches(client, server).slice(0, 6);
  }, [form.customer, customersData, serverCustMatches, mergeMatches]);

  // Lookup nomor WA di field phone → suggest customer
  const phoneSuggest = useMemo(() => {
    const raw = form.phone.replace(/\D/g, "");
    if (raw.length < 5) return [];
    const client = (customersData || []).filter(c => (c.phone || "").replace(/\D/g, "").includes(raw));
    const server = serverCustMatches.key === normalizePhone(form.phone) ? serverCustMatches.rows : [];
    return mergeMatches(client, server).slice(0, 4);
  }, [form.phone, customersData, serverCustMatches, mergeMatches]);

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

  async function handleSave(opts = {}) {
    if (!form.customer.trim()) return showNotif("Nama customer wajib diisi", "error");
    if (!form.date) return showNotif("Tanggal wajib diisi", "error");
    if (!form.service) return showNotif("Layanan wajib diisi", "error");
    // Phone WAJIB — tanpa phone, customer baru tidak bisa dibuat & invoice/penagihan
    // tidak bisa di-track. Lebih baik blok di sini daripada bikin orphan data.
    const phoneNorm = normalizePhone(form.phone || "");
    if (!phoneNorm || phoneNorm.length < 10) {
      return showNotif("⚠ No. HP customer wajib diisi (min 10 digit). Tanpa nomor, customer baru tidak bisa dibuat & invoice/penagihan tidak bisa di-track.", "error");
    }

    // WA phone validation — soft warning kalau phone tidak ada chat WA tapi ada no mirip
    // Skip kalau user sudah konfirmasi "Lanjutkan dengan no ini" atau saat edit
    if (!opts.skipWAValidate && !editId) {
      try {
        const waCheck = await checkWAPhone(phoneNorm);
        if (!waCheck.exact.found && waCheck.similar.length > 0) {
          setPhoneCheck({
            inputPhone: phoneNorm,
            similar: waCheck.similar,
            onProceed: () => { setPhoneCheck(null); handleSave({ skipWAValidate: true }); },
            onPickSuggestion: (sugPhone, sugName) => {
              setForm(f => ({
                ...f,
                phone: sugPhone,
                ...(sugName && !f.customer.trim() ? { customer: sugName } : {}),
              }));
              setPhoneCheck(null);
            },
            onCancel: () => setPhoneCheck(null),
          });
          return;
        }
      } catch (e) {
        console.warn("[WA_PHONE_VALIDATE]", e?.message || e);
        // gagal validasi — jangan blok save
      }
    }

    setSaving(true);

    // Auto-populate teknisi & helper dari team_slot
    // Prioritas: slot harian → teamPresets → null
    let autoTeknisi = form.teknisi || null;
    let autoHelper = null, autoHelper2 = null, autoHelper3 = null;
    if (form.team_slot) {
      const slot = getSlotData(form.date, form.team_slot);
      const members = slotMemberRoles(slot);
      if (members.length > 0) {
        const utama = members.find(m => (m.role || "").toLowerCase() === "teknisi") || members[0];
        const helpers = members.filter(m => m !== utama);
        autoTeknisi = autoTeknisi || utama?.name || null;
        autoHelper = helpers[0]?.name || null;
        autoHelper2 = helpers[1]?.name || null;
        autoHelper3 = helpers[2]?.name || null;
      } else if (teamPresets[form.team_slot]) {
        // Fallback ke preset bila slot harian belum diisi
        autoTeknisi = autoTeknisi || teamPresets[form.team_slot];
      }
    }

    const payload = {
      customer: form.customer.trim(),
      phone: normalizePhone(form.phone),
      service: form.service,
      type: form.type || null,
      address: form.address.trim() || null,
      date: form.date,
      time: form.time || "09:00",
      teknisi: autoTeknisi,
      helper: autoHelper,
      helper2: autoHelper2,
      helper3: autoHelper3,
      notes: form.notes.trim() || null,
      status: form.status,
      units: Number(form.units) || 1,
      time_end: form.time_end || calcTimeEnd(form.time, form.service, form.units),
      team_slot: form.team_slot || null,
      source: "whatsapp",
      ...(form.customer_id ? { customer_id: form.customer_id } : {}),
      last_changed_by: auditUserName(),
      // Multi-hari: tandai jika ini order lanjutan
      ...(continuationFrom ? {
        parent_job_id: continuationFrom.id,
        is_multi_day: true,
        day_number: continuationFrom._dayNum || 2,
      } : {}),
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

        // Jika ini order lanjutan: update parent jadi CONTINUED + tandai is_multi_day
        if (continuationFrom) {
          const parentId = continuationFrom.id;
          // Update parent
          const { error: pErr } = await supabase.from("orders")
            .update({ status: "CONTINUED", is_multi_day: true, day_number: 1 })
            .eq("id", parentId);
          if (pErr) console.warn("Update parent multi-day failed:", pErr.message);

          // Tandai sibling multi-day yang sudah ada (bulk via .in untuk konsisten)
          // Filter: hanya sibling MULTI-DAY (skip Repair-from-Complain yang non-multi-day)
          const siblingIds = ordersData
            .filter(o => o.parent_job_id === parentId && o.is_multi_day)
            .map(o => o.id);
          if (siblingIds.length > 0) {
            const { error: sErr } = await supabase.from("orders")
              .update({ is_multi_day: true })
              .in("id", siblingIds);
            if (sErr) console.warn("Update sibling multi-day failed:", sErr.message);
          }

          // State update lokal
          setOrdersData(prev => prev.map(o => {
            if (o.id === parentId) return { ...o, status: "CONTINUED", is_multi_day: true, day_number: 1 };
            if (siblingIds.includes(o.id)) return { ...o, is_multi_day: true };
            return o;
          }));
          setContinuationFrom(null);
        }

        // Auto-save customer if not already linked.
        // Cek existing dulu (by phone+name) agar TIDAK overwrite stats customer lama.
        if (!form.customer_id && payload.customer && payload.phone) {
          const orderDate = payload.date || new Date().toISOString().slice(0, 10);
          let saved = null;
          // 1. Cari existing by (phone, name)
          const { data: existRows } = await supabase.from("customers")
            .select("id,name,phone,address,area,total_orders,last_service")
            .eq("phone", payload.phone).eq("name", payload.customer).limit(1);
          if (existRows && existRows.length) {
            // Existing → hanya bump stats, jangan overwrite nama/alamat/joined
            const ex = existRows[0];
            const newTotal = (ex.total_orders || 0) + 1;
            const { data: upd } = await supabase.from("customers")
              .update({ total_orders: newTotal, last_service: orderDate })
              .eq("id", ex.id).select().single();
            saved = upd || { ...ex, total_orders: newTotal, last_service: orderDate };
          } else {
            // Baru → insert
            const { data: ins } = await supabase.from("customers").insert({
              name: payload.customer,
              phone: payload.phone,
              address: payload.address || null,
              notes: "",
              is_vip: false,
              total_orders: 1,
              joined_date: orderDate,
              last_service: orderDate,
            }).select().single();
            saved = ins;
          }
          if (saved?.id) {
            await supabase.from("orders").update({ customer_id: saved.id }).eq("id", id);
            setOrdersData(prev => prev.map(o => o.id === id ? { ...o, customer_id: saved.id } : o));
            setCustomersData(prev => {
              const exists = prev.find(c => c.id === saved.id);
              if (exists) return prev.map(c => c.id === saved.id ? { ...c, ...saved } : c);
              return [...prev, saved];
            });
          }
        }
        setOrdersData(prev => [{ ...payload, id, created_at: new Date().toISOString() }, ...prev]);
        showNotif(continuationFrom ? `✅ Order lanjutan Hari ${payload.day_number} dibuat` : "Order masuk disimpan");
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
    setContinuationFrom(null);
    setContinuationDismissed(false);
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
    const childOrders = ordersData.filter(o => o.parent_job_id === order.id && o.is_multi_day);
    const isMultiDayParent = childOrders.length > 0;

    let cascadeMessage = `Hapus order ${order.customer} (${order.date})?`;
    if (isMultiDayParent) {
      cascadeMessage = `⚠️ Order ini adalah INDUK dari pekerjaan ${childOrders.length + 1} hari.\n\n`
        + `Jika dihapus, ${childOrders.length} order lanjutan di hari berikutnya juga akan ikut dihapus:\n`
        + childOrders.map(c => `  • ${c.id} (${c.date})`).join("\n")
        + `\n\nLanjutkan?`;
    }

    const ok = await showConfirm({
      icon: "🗑",
      title: isMultiDayParent ? "Hapus Pekerjaan Multi-Hari?" : "Hapus Order?",
      message: cascadeMessage,
      confirmText: isMultiDayParent ? `Hapus Semua (${childOrders.length + 1} order)` : "Hapus",
    });
    if (!ok) return;

    // Simpan snapshot untuk undo (parent + children)
    const allDeleted = [order, ...childOrders];

    // Hapus child dulu
    if (isMultiDayParent) {
      const childIds = childOrders.map(c => c.id);
      await supabase.from("orders").update({ last_changed_by: auditUserName() }).in("id", childIds);
      const { error: cErr } = await supabase.from("orders").delete().in("id", childIds);
      if (cErr) return showNotif("Gagal hapus order lanjutan: " + cErr.message);
      setOrdersData(prev => prev.filter(o => !childIds.includes(o.id)));
    }

    await supabase.from("orders").update({ last_changed_by: auditUserName() }).eq("id", order.id);
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) return showNotif("Gagal hapus: " + error.message);
    setOrdersData(prev => prev.filter(o => o.id !== order.id));

    // Undo toast 10 detik — re-insert semua yang dihapus
    const label = isMultiDayParent
      ? `${childOrders.length + 1} order multi-hari "${order.customer}" dihapus`
      : `Order "${order.customer}" (${order.date}) dihapus`;

    showUndoToast?.(label, async () => {
      // Re-insert dari snapshot, urut parent dulu lalu child (FK constraint)
      for (const o of allDeleted) {
        const { last_changed_by: _, ...clean } = o;
        await supabase.from("orders").insert(clean);
      }
      setOrdersData(prev => [...allDeleted, ...prev]);
      showNotif(`↩ ${allDeleted.length} order dikembalikan`);
    });
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
        if (!hasValidTime(a.time) || !hasValidTime(b.time)) continue;
        const aStart = toMinutes(a.time);
        const aEnd = aStart + Math.round(hitungDurasi(a.service || "Cleaning", a.units || 1) * 60);
        const bStart = toMinutes(b.time);
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
    // Prioritas: slot harian → teamPresets
    if (field === "team_slot" && value) {
      const slot = getSlotData(order.date, value);
      const members = slot ? slotMemberRoles(slot) : [];
      if (members.length > 0) {
        const utama = members.find(m => (m.role || "").toLowerCase() === "teknisi") || members[0];
        const helpers = members.filter(m => m !== utama);
        update = {
          ...update,
          teknisi: utama?.name || null,
          helper: helpers[0]?.name || null,
          helper2: helpers[1]?.name || null,
          helper3: helpers[2]?.name || null,
        };
      } else if (teamPresets[value]) {
        // Fallback ke preset
        update = { ...update, teknisi: teamPresets[value], helper: null, helper2: null, helper3: null };
      } else {
        showNotif("⚠️ Tim " + value + " belum punya anggota & belum ada preset", "warning");
      }
    }
    // Jika clear team_slot → reset teknisi & helper juga
    if (field === "team_slot" && !value) {
      update = { ...update, teknisi: null, helper: null, helper2: null, helper3: null };
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
        availability={availability} setAvailabilityStatus={setAvailabilityStatus}
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
        apiHeaders={apiHeaders}
        onReassigned={(orderId, newTeknisi) => setOrdersData(prev =>
          prev.map(o => o.id === orderId ? { ...o, teknisi: newTeknisi } : o)
        )}
      />

      {/* ═══ FORM QUICK ENTRY ═══ */}
      <div style={{ background: cs.surface, border: "1px solid " + (editId ? cs.yellow : continuationFrom ? "#f97316" : cs.border), borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: editId ? cs.yellow : continuationFrom ? "#f97316" : cs.text, marginBottom: continuationFrom ? 8 : 16 }}>
          {editId ? "✏️ Edit Planning — " + editId : continuationFrom ? `🔗 Buat Order Lanjutan (Hari ${continuationFrom._dayNum})` : "➕ Tambah Planning Order"}
        </div>

        {/* Banner: order lanjutan dari parent */}
        {continuationFrom && (
          <div style={{ background: "#f9731618", border: "1px solid #f9731666", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#f97316", fontWeight: 700 }}>🔗 Lanjutan dari:</span>
            <span style={{ color: cs.text }}>{continuationFrom.customer} — {continuationFrom.date} ({continuationFrom.service})</span>
            <span style={{ color: cs.muted, fontSize: 11 }}>ID: {continuationFrom.id}</span>
            <button onClick={handleCancelEdit}
              style={{ background: "transparent", border: "none", color: cs.muted, cursor: "pointer", fontSize: 11, marginLeft: "auto" }}>✕ Batal</button>
          </div>
        )}

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
              style={{ ...inputStyle, borderColor: form.customer_id ? cs.green + "88" : cs.border, fontFamily: "monospace" }}
              value={form.phone}
              onChange={e => {
                const norm = normalizePhone(e.target.value) || e.target.value;
                setField("phone", norm);
                if (form.customer_id) setField("customer_id", null);
              }}
              placeholder="08xx (auto-format ke 628xxx)" />
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

          {/* Auto-detect pekerjaan lanjutan */}
          {autoDetectedJobs.length > 0 && !continuationDismissed && (
            <div style={{ background: "#f59e0b14", border: "1px solid #f59e0b44", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", background: "#f59e0b1a", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15 }}>🔗</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b" }}>Terdeteksi Pekerjaan Belum Selesai</div>
                  <div style={{ fontSize: 11, color: "#fbbf24" }}>Customer ini punya {autoDetectedJobs.length} job aktif dalam 3 hari terakhir. Lanjutan?</div>
                </div>
              </div>
              {autoDetectedJobs.map(o => (
                <div key={o.id} style={{ padding: "9px 14px", borderTop: "1px solid #f59e0b22", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: "#fbbf24", fontFamily: "monospace" }}>{o.id}</span>
                    <span style={{ color: "#94a3b8", marginLeft: 8 }}>{o.date} · {o.service} {o.units}u · {o.teknisi || "—"}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 7px", borderRadius: 99, background: "#f59e0b22", color: "#fbbf24" }}>{o.status}</span>
                  </div>
                  <button
                    onClick={() => {
                      setContinuationFrom({ ...o, _dayNum: calcContinuationDayNum(ordersData, o.id) });
                    }}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#0a0f1e", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Ya, Lanjutan
                  </button>
                </div>
              ))}
              <div style={{ padding: "8px 14px", borderTop: "1px solid #f59e0b22", display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setContinuationDismissed(true)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #64748b44", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer" }}>
                  Tidak, Job Baru
                </button>
              </div>
            </div>
          )}

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
              {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
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
          <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
            📋 Planning Order
            <span style={{ color: cs.muted, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>({inboxOrders.length})</span>
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

        {/* Filter per Hari — chip buttons */}
        {(() => {
          // Buat chip untuk 7 hari ke depan yang ada order-nya
          const DAY_LABELS = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
          const dayChips = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(TODAY); d.setDate(d.getDate() + i);
            const iso = d.toISOString().slice(0, 10);
            const count = ordersData.filter(o => o.date === iso && o.status !== "CANCELLED").length;
            const label = i === 0 ? "Hari Ini" : i === 1 ? "Besok" : DAY_LABELS[d.getDay()] + " " + d.getDate();
            return { iso, label, count };
          }).filter(c => c.count > 0);
          return (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600, marginRight: 2 }}>Filter Hari:</span>
              <button
                onClick={() => setGridDate(null)}
                style={{
                  background: !gridDate ? cs.accent : cs.card,
                  color: !gridDate ? "#fff" : cs.muted,
                  border: "1px solid " + (!gridDate ? cs.accent : cs.border),
                  borderRadius: 20, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: !gridDate ? 700 : 400,
                }}>
                Semua
              </button>
              {dayChips.map(({ iso, label, count }) => {
                const isActive = gridDate === iso;
                return (
                  <button key={iso}
                    onClick={() => setGridDate(isActive ? null : iso)}
                    style={{
                      background: isActive ? cs.accent : cs.card,
                      color: isActive ? "#fff" : iso === TODAY ? cs.accent : cs.text,
                      border: "1px solid " + (isActive ? cs.accent : iso === TODAY ? cs.accent + "66" : cs.border),
                      borderRadius: 20, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: isActive ? 700 : iso === TODAY ? 600 : 400,
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                    {label}
                    <span style={{
                      background: isActive ? "rgba(255,255,255,0.25)" : cs.border,
                      color: isActive ? "#fff" : cs.muted,
                      borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 800,
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

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
                    background: isEditing ? cs.yellow + "08" : isCancelled ? cs.red + "06" : (o.parent_job_id && o.is_multi_day) ? "#f9731608" : isToday ? cs.accent + "06" : "transparent",
                    opacity: isCancelled ? 0.6 : 1,
                    borderLeft: (o.parent_job_id && o.is_multi_day) ? "3px solid #f9731688" : o.is_multi_day ? "3px solid #f9731644" : "3px solid transparent",
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
                      {o.is_multi_day && (
                        <div style={{ fontSize: 10, color: "#f97316", fontWeight: 700, marginTop: 2 }}>
                          {(o.parent_job_id && o.is_multi_day) ? `🔗 Lanjutan Hari ${o.day_number || "?"}` : "📋 Multi-Hari"}
                        </div>
                      )}
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
                      {/* Badge hari ke-N untuk order multi-hari */}
                      {o.is_multi_day && (
                        <div style={{ fontSize: 10, color: "#f97316", fontWeight: 700, marginBottom: 4 }}>
                          {(o.parent_job_id && o.is_multi_day) ? `🔗 Hari ${o.day_number || "?"}` : `📋 Induk (${ordersData.filter(c => c.parent_job_id === o.id && c.is_multi_day).length + 1} hari)`}
                        </div>
                      )}
                      <button onClick={() => handleEdit(o)}
                        style={{ background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", marginRight: 4, fontWeight: 600 }}>
                        Edit
                      </button>
                      {/* Tombol Buat Order Lanjutan — hanya muncul untuk order yang bisa dilanjutkan
                          Skip child multi-day, tapi non-multi-day (mis. Repair dari Complain) tetap bisa di-lanjutkan */}
                      {!(o.parent_job_id && o.is_multi_day) && !["CANCELLED", "COMPLETED", "PAID"].includes(o.status) && (
                        <button onClick={() => handleCreateContinuation(o)}
                          style={{ background: "#f9731618", color: "#f97316", border: "1px solid #f9731644", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", marginRight: 4, fontWeight: 600 }}>
                          +Lanjutan
                        </button>
                      )}
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

      {/* ── Modal: WA Phone Validation Warning ── */}
      {phoneCheck && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }} onClick={phoneCheck.onCancel}>
          <div onClick={e => e.stopPropagation()} style={{
            background: cs.surface, border: "1px solid " + cs.border, borderRadius: 12,
            padding: 20, maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: cs.text }}>Cek Nomor HP — Mungkin Typo?</div>
            </div>
            <div style={{ fontSize: 13, color: cs.muted, marginBottom: 14, lineHeight: 1.5 }}>
              Nomor <b style={{ color: cs.text, fontFamily: "monospace" }}>{phoneCheck.inputPhone}</b> belum
              pernah chat dengan WA bisnis AClean. Tapi nomor mirip di bawah punya riwayat chat aktif —
              kemungkinan typo:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {phoneCheck.similar.map(s => (
                <button key={s.phone} onClick={() => phoneCheck.onPickSuggestion(s.phone, s.name)} style={{
                  background: cs.accent + "12", border: "1px solid " + cs.accent + "55",
                  borderRadius: 8, padding: "10px 12px", cursor: "pointer", textAlign: "left",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: cs.accent, fontSize: 14 }}>
                      {s.phone}
                    </span>
                    <span style={{ fontSize: 11, color: cs.text }}>
                      {s.name || "(tanpa nama)"} · {s.msg_count} pesan · last: {(s.last_chat || "").slice(0, 10)}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: cs.muted, whiteSpace: "nowrap" }}>Pakai ini ↗</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={phoneCheck.onCancel} style={{
                background: "transparent", border: "1px solid " + cs.border, color: cs.muted,
                borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600,
              }}>Batal</button>
              <button onClick={phoneCheck.onProceed} style={{
                background: cs.yellow + "22", border: "1px solid " + cs.yellow + "66", color: cs.yellow,
                borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700,
              }}>Lanjutkan dengan {phoneCheck.inputPhone}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
