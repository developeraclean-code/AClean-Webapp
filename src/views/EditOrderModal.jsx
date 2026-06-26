import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { cs } from "../theme/cs.js";
import { statusColor, statusLabel } from "../constants/status.js";
import { updateOrder } from "../data/writes.js";

const inp = { width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 11px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" };
const lbl = { fontSize: 11, color: cs.muted, marginBottom: 3, display: "block", fontWeight: 600 };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" };
const secTitle = { fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 };

const ORDER_STATUSES = ["PENDING","CONFIRMED","DISPATCHED","ON_SITE","WORKING","REPORT_SUBMITTED","INVOICE_CREATED","INVOICE_APPROVED","PAID","COMPLETED","CANCELLED","RESCHEDULED"];

export default function EditOrderModal({
  open, onClose,
  editOrderItem,           // original order object
  ordersData = [],
  teknisiData = [],
  priceListData = [],
  effectiveServiceTypes = [],

  hitungJamSelesai, hitungDurasi,
  cekTeknisiAvailable, araSchedulingSuggest,
  cekTeknisiAvailableDB,
  sendWA, addAgentLog,
  auditUserName,
  appSettings = {},

  showNotif,
  setOrdersData,
}) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && editOrderItem) {
      setForm({ ...editOrderItem });
      setSaving(false);
    }
  }, [open, editOrderItem]);

  if (!open || !editOrderItem) return null;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Detect changed fields for badge
  const changed = [];
  if (form.teknisi !== editOrderItem.teknisi) changed.push("Teknisi");
  if (form.date !== editOrderItem.date) changed.push("Tanggal");
  if (form.time !== editOrderItem.time) changed.push("Jam");
  if (form.status !== editOrderItem.status) changed.push("Status");

  const jamSelesai = hitungJamSelesai
    ? hitungJamSelesai(form.time || "09:00", form.service || "Cleaning", form.units || 1)
    : "--:--";
  const dur = hitungDurasi
    ? hitungDurasi(form.service || "Cleaning", form.units || 1)
    : 0;

  const handleSave = async () => {
    // DB availability check jika teknisi/jadwal berubah
    const tekChanged = form.teknisi !== editOrderItem.teknisi;
    const dateChanged = form.date !== editOrderItem.date;
    const timeChanged = form.time !== editOrderItem.time;
    if (cekTeknisiAvailableDB && form.teknisi && (tekChanged || dateChanged || timeChanged)) {
      const dbCheck = await cekTeknisiAvailableDB(
        form.teknisi,
        form.date || editOrderItem.date,
        form.time || editOrderItem.time || "09:00",
        form.service || editOrderItem.service || "Cleaning",
        form.units || editOrderItem.units || 1
      );
      if (!dbCheck.ok && !dbCheck.reason?.includes(editOrderItem.id)) {
        showNotif("⚠️ " + (dbCheck.reason || form.teknisi + " tidak tersedia di jadwal tersebut"));
        return;
      }
    }

    setSaving(true);
    try {
      const timeEnd = hitungJamSelesai
        ? hitungJamSelesai(form.time || "09:00", form.service || "Cleaning", form.units || 1)
        : form.time_end;

      const updated = { ...editOrderItem, ...form, time_end: timeEnd };
      setOrdersData(prev => prev.map(o => o.id === editOrderItem.id ? updated : o));

      const dbUpd = {
        customer: form.customer, phone: form.phone,
        address: form.address, area: form.area || "",
        service: form.service, type: form.type || "",
        units: form.units, teknisi: form.teknisi,
        helper: form.helper || null,
        teknisi2: form.teknisi2 || null, helper2: form.helper2 || null,
        teknisi3: form.teknisi3 || null, helper3: form.helper3 || null,
        date: form.date, time: form.time, time_end: timeEnd,
        status: form.status, notes: form.notes || "",
      };

      const auditName = auditUserName ? auditUserName() : "Admin";
      const { error: eoErr } = await updateOrder(supabase, editOrderItem.id, dbUpd, auditName);

      // Sync schedule
      if (!eoErr) {
        try { await supabase.from("technician_schedule").delete().eq("order_id", editOrderItem.id); } catch { /* cleanup jadwal teknisi best-effort */ }
        if (form.teknisi && form.date) {
          try {
            await supabase.from("technician_schedule").insert({
              order_id: editOrderItem.id, teknisi: form.teknisi,
              date: form.date, time_start: form.time || "09:00", time_end: timeEnd, status: "ACTIVE",
            });
            if (addAgentLog) addAgentLog("SCHEDULE_SYNCED", `Schedule diupdate untuk ${editOrderItem.id}`, "SUCCESS");
          } catch { /* sinkron jadwal best-effort */ }
        }
      }

      if (eoErr) {
        showNotif("⚠️ Tersimpan lokal, sync DB gagal: " + eoErr.message);
      } else {
        if (addAgentLog) addAgentLog("ORDER_UPDATED", `Order ${editOrderItem.id} diedit — ${form.teknisi} ${form.date} ${form.time}`, "SUCCESS");
        // WA ke teknisi jika jadwal berubah
        if (sendWA && (tekChanged || dateChanged || timeChanged)) {
          const tek = teknisiData.find(t => t.name === form.teknisi);
          if (tek) {
            sendWA(tek.phone,
              `Halo ${form.teknisi}, ada *perubahan jadwal*:\n📋 ${editOrderItem.id} — ${form.customer || editOrderItem.customer}\n🔧 ${form.service} ${form.units} unit\n📅 ${form.date} jam ${form.time}–${timeEnd}\n📍 ${form.address || editOrderItem.address}\n${form.notes ? "📝 " + form.notes + "\n" : ""}Mohon konfirmasi. — ${appSettings.app_name || "AClean"}`
            );
          }
        }
        showNotif("✅ Order " + editOrderItem.id + " berhasil diupdate");
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 14px", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>✏️ Edit Order</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                <span style={{ color: cs.accent, fontFamily: "monospace", fontWeight: 700 }}>{editOrderItem.id}</span>
                {" · "}{editOrderItem.customer}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
          </div>
          {/* Change detection badges */}
          {changed.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {changed.map(c => (
                <span key={c} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow }}>
                  ✎ {c}
                </span>
              ))}
              <span style={{ fontSize: 10, color: cs.muted, padding: "2px 4px" }}>berubah — akan dicatat & WA dikirim</span>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Card 1: Data Customer */}
          <div style={card}>
            <div style={secTitle}>Data Customer</div>
            <div style={{ display: "grid", gap: 8 }}>
              {[["Nama Customer","customer","text"],["No. HP","phone","text"],["Alamat Lengkap","address","text"],["Area / Kota","area","text"]].map(([label, key, type]) => (
                <div key={key}>
                  <label style={lbl}>{label}</label>
                  <input type={type} value={form[key] || ""} onChange={e => set(key, e.target.value)} style={inp} />
                </div>
              ))}
            </div>
          </div>

          {/* Card 2: Detail Pekerjaan */}
          <div style={card}>
            <div style={secTitle}>Detail Pekerjaan</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl}>Layanan</label>
                <select value={form.service || "Cleaning"} onChange={e => set("service", e.target.value)} style={{ ...inp, background: cs.surface }}>
                  {effectiveServiceTypes.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Jumlah Unit</label>
                <input type="number" min="1" max="20" value={form.units || 1} onChange={e => set("units", parseInt(e.target.value) || 1)} style={{ ...inp, background: cs.surface }} />
              </div>
            </div>
            <div>
              <label style={lbl}>Tipe AC</label>
              <select value={form.type || ""} onChange={e => set("type", e.target.value)} style={{ ...inp, background: cs.surface }}>
                <option value="">Pilih Tipe...</option>
                {(priceListData || []).map(p => <option key={p.id || p.type} value={p.type}>{p.type}</option>)}
              </select>
            </div>
          </div>

          {/* Card 3: Jadwal & Tim */}
          <div style={card}>
            <div style={secTitle}>Jadwal & Tim</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl}>Tanggal</label>
                <input type="date" value={form.date || ""} onChange={e => set("date", e.target.value)} style={{ ...inp, background: cs.surface }} />
              </div>
              <div>
                <label style={lbl}>Jam Mulai</label>
                <input type="time" min="09:00" max="17:00" value={form.time || "09:00"} onChange={e => set("time", e.target.value)} style={{ ...inp, background: cs.surface }} />
              </div>
            </div>
            {form.date && form.time && (
              <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "22", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: cs.accent, marginBottom: 8 }}>
                ⏱ Estimasi selesai: <b>{jamSelesai}</b> WIB · {dur >= 8 ? "1 hari kerja" : dur + " jam"}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbl}>Teknisi</label>
                <select value={form.teknisi || ""} onChange={e => setForm(f => ({ ...f, teknisi: e.target.value, helper: "" }))}
                  style={{ ...inp, background: cs.surface }}>
                  <option value="">Pilih Teknisi...</option>
                  {teknisiData.filter(t => t.role === "Teknisi" || t.role === "Helper").map(t => {
                    const avail = cekTeknisiAvailable ? cekTeknisiAvailable(t.name, form.date || "", form.time || "09:00", form.service || "Cleaning", form.units || 1) : true;
                    return <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}{!avail ? " (penuh)" : ""}</option>;
                  })}
                </select>
              </div>
              <div>
                <label style={lbl}>Helper</label>
                <select value={form.helper || ""} onChange={e => set("helper", e.target.value)}
                  style={{ ...inp, background: cs.surface }}>
                  <option value="">Tidak ada</option>
                  {teknisiData.filter(t => t.active !== false && t.name !== form.teknisi).map(t => {
                    const { pref } = araSchedulingSuggest ? araSchedulingSuggest(form.date || "", form.service, form.units) : { pref: {} };
                    const roleTag = t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`;
                    return <option key={t.id} value={t.name}>{pref[form.teknisi] === t.name ? "★ " : ""}{t.name}{roleTag}</option>;
                  })}
                </select>
              </div>
            </div>
            {/* Tim Tambahan */}
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>👥 TIM TAMBAHAN (opsional)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["Teknisi ke-2","teknisi2"],["Helper ke-2","helper2"],["Teknisi ke-3","teknisi3"],["Helper ke-3","helper3"]].map(([lbl2, key]) => (
                  <div key={key}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 3 }}>{lbl2}</div>
                    <select value={form[key] || ""} onChange={e => set(key, e.target.value)}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12 }}>
                      <option value="">Tidak ada</option>
                      {teknisiData.filter(t => t.active !== false && t.name !== form.teknisi && t.name !== form.helper).map(t => {
                        const roleTag = t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`;
                        return <option key={t.id} value={t.name}>{t.name}{roleTag}</option>;
                      })}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 4: Status & Catatan */}
          <div style={card}>
            <div style={secTitle}>Status & Catatan</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>Status</label>
                <select value={form.status || "CONFIRMED"} onChange={e => set("status", e.target.value)}
                  style={{ ...inp, background: cs.surface, borderColor: statusColor[form.status] ? statusColor[form.status] + "66" : cs.border }}>
                  {ORDER_STATUSES.map(s => (
                    <option key={s} value={s}>{statusLabel[s] || s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Catatan Perubahan</label>
                <input value={form.notes || ""} onChange={e => set("notes", e.target.value)}
                  placeholder="Alasan perubahan..." style={{ ...inp, background: cs.surface }} />
              </div>
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} disabled={saving}
            style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            Batal
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 2, background: saving ? cs.yellow + "88" : "linear-gradient(135deg," + cs.yellow + ",#d97706)", border: "none", color: "#0a0f1e", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Menyimpan..." : "✓ Simpan Semua Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
