import { useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import { SERVICE_TYPES } from "../constants/services.js";
import { normalizePhone } from "../lib/phone.js";
import { findCustomer } from "../lib/customers.js";

// Fast-entry pengganti tempel manual dari Google Keep/WA — parsing regex murni
// (tanpa AI/API apa pun), wajib 1 baris = 1 job dipisah "|" karena urutan field
// bebas-teks (seperti format Keep asli) tidak bisa diparsing reliable tanpa AI.
const PLACEHOLDER = `09:00 | Dedi | CV Harum Mandiri | Jl. Jombang Raya No 56 Pondok Aren | | Repair | Ganti instalasi pipa 4 meter
10:00 | Mulyadi+Boim | Ibu Tika | Sutera Narada 9/7 | 0811824880 | Cleaning | 6 AC
13:00 | Mulyadi+Boim | PT OCK Ina Sukses | Ruko Rutera Niaga 3 | 0898050227 | Cleaning | 3 AC`;

function normalizeJam(raw) {
  const m = (raw || "").trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}`;
}

function matchService(raw) {
  const s = (raw || "").trim();
  if (!s) return "Repair";
  return SERVICE_TYPES.find((t) => t.toLowerCase() === s.toLowerCase()) || "Repair";
}

function parseLine(line, lineNo) {
  const parts = line.split("|").map((s) => s.trim());
  const [jamRaw, timRaw, customer, alamat, telepon, jenisRaw, detail] = parts;
  if (!jamRaw || !timRaw || !customer) {
    return { lineNo, raw: line, error: "Jam | Teknisi | Customer wajib diisi (pisahkan kolom dengan |)" };
  }
  const time = normalizeJam(jamRaw);
  if (!time) return { lineNo, raw: line, error: `Format jam tidak valid: "${jamRaw}" (contoh: 9 atau 09:30)` };
  const [teknisi, helper] = timRaw.split("+").map((s) => s?.trim()).filter(Boolean);
  if (!teknisi) return { lineNo, raw: line, error: "Nama teknisi kosong" };
  return {
    lineNo, raw: line, error: null,
    time, teknisi, helper: helper || null,
    customer, address: alamat || null,
    phone: telepon ? normalizePhone(telepon) : null,
    service: matchService(jenisRaw), type: detail || null,
  };
}

function newOrderId() {
  return "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export default function QuickScheduleModal({
  open, onClose, TODAY, supabase, insertOrder, showNotif,
  customersData, setOrdersData, setCustomersData, auditUserName,
}) {
  const [date, setDate] = useState(TODAY);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => (
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => parseLine(line, i + 1))
  ), [text]);

  const validRows = rows.filter((r) => !r.error);
  const errorRows = rows.filter((r) => r.error);

  if (!open) return null;

  const inputStyle = {
    background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
    color: cs.text, padding: "8px 10px", fontSize: 13, width: "100%", outline: "none",
    boxSizing: "border-box",
  };

  async function handleSave() {
    if (validRows.length === 0) return showNotif("Tidak ada baris valid untuk disimpan", "error");
    setSaving(true);
    let success = 0, failed = 0;
    const created = [];
    for (const row of validRows) {
      const matched = row.phone ? findCustomer(customersData, row.phone, row.customer) : null;
      const payload = {
        id: newOrderId(),
        customer: row.customer,
        customer_id: matched?.id || null,
        phone: row.phone,
        address: row.address,
        service: row.service,
        type: row.type,
        units: 1,
        teknisi: row.teknisi,
        helper: row.helper,
        date,
        time: row.time,
        status: "PENDING",
        notes: null,
        dispatch: false,
        source: "quick_paste",
        last_changed_by: auditUserName?.() || null,
      };
      const { error } = await insertOrder(supabase, payload);
      if (error) { failed++; console.warn("Quick paste insert gagal:", row.raw, error.message); }
      else { success++; created.push({ ...payload, created_at: new Date().toISOString() }); }
    }
    if (created.length) setOrdersData((prev) => [...created, ...prev]);
    setSaving(false);
    showNotif(`✅ ${success} order dibuat${failed ? `, ${failed} gagal` : ""} dari Tempel Jadwal`);
    if (failed === 0) { setText(""); onClose(); }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: cs.surface, border: "1px solid " + cs.border, borderRadius: 12,
        padding: 20, maxWidth: 860, width: "100%", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>📋 Tempel Jadwal — Fast Entry</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14, lineHeight: 1.6 }}>
          1 baris = 1 job, pisahkan kolom dengan <b style={{ color: cs.text }}>|</b>:<br />
          <code style={{ color: cs.accent }}>Jam | Teknisi[+Helper] | Customer | Alamat | Telepon | Jenis Servis | Detail Pekerjaan</code><br />
          Kolom Alamat/Telepon/Jenis/Detail boleh dikosongkan (tetap pakai <b>|</b> sebagai pemisah). Jenis Servis default <b>Repair</b> kalau kosong/tidak cocok dengan {SERVICE_TYPES.join("/")}.
        </div>

        <div style={{ marginBottom: 12, maxWidth: 220 }}>
          <label style={{ fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 }}>Tanggal (untuk semua baris di bawah)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={8}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical", marginBottom: 14 }}
        />

        {rows.length > 0 && (
          <div style={{ border: "1px solid " + cs.border, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: cs.card }}>
                    {["#", "Jam", "Teknisi", "Helper", "Customer", "Alamat", "Telp", "Jenis", "Detail"].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: cs.muted, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.lineNo} style={{ borderTop: "1px solid " + cs.border, background: r.error ? cs.red + "10" : "transparent" }}>
                      {r.error ? (
                        <td colSpan={9} style={{ padding: "6px 8px", color: cs.red }}>
                          Baris {r.lineNo}: {r.error} — <span style={{ color: cs.muted, fontFamily: "monospace" }}>{r.raw}</span>
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: "6px 8px", color: cs.muted }}>{r.lineNo}</td>
                          <td style={{ padding: "6px 8px", color: cs.text }}>{r.time}</td>
                          <td style={{ padding: "6px 8px", color: cs.text }}>{r.teknisi}</td>
                          <td style={{ padding: "6px 8px", color: cs.text }}>{r.helper || "-"}</td>
                          <td style={{ padding: "6px 8px", color: cs.text }}>{r.customer}</td>
                          <td style={{ padding: "6px 8px", color: cs.muted, maxWidth: 180 }}>{r.address || "-"}</td>
                          <td style={{ padding: "6px 8px", color: cs.muted }}>{r.phone || "-"}</td>
                          <td style={{ padding: "6px 8px", color: cs.text }}>{r.service}</td>
                          <td style={{ padding: "6px 8px", color: cs.muted }}>{r.type || "-"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 12, color: cs.muted }}>
            {validRows.length} baris valid{errorRows.length ? `, ${errorRows.length} error` : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid " + cs.border, color: cs.muted, borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Batal</button>
            <button onClick={handleSave} disabled={saving || validRows.length === 0} style={{
              background: cs.accent, border: "none", color: "#fff", borderRadius: 6,
              padding: "8px 16px", fontSize: 12, cursor: saving || validRows.length === 0 ? "not-allowed" : "pointer",
              fontWeight: 700, opacity: saving || validRows.length === 0 ? 0.5 : 1,
            }}>{saving ? "Menyimpan..." : `Simpan ${validRows.length} Order`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
