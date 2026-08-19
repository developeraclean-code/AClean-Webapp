// Popup pilih-unit saat admin membuat order untuk klien maintenance dari Planning
// Order. Tujuan: repair/complain nyangkut ke unit SPESIFIK → riwayat & frekuensi
// unit akurat (temuan audit 19 Agu 2026: 9 job repair/complain lahir tanpa unit).
//
// Perilaku (keputusan Owner 19 Agu 2026):
// - Default centang CERDAS per jenis servis: Cleaning/Maintenance = semua unit
//   ke-centang (memang cuci semua); Repair/Complain/lainnya = kosong (admin pilih
//   unit yang bermasalah).
// - "Lewati" selalu boleh (non-blocking). Untuk Repair/Complain ada PERINGATAN
//   bahwa riwayat unit tak terekam bila dilewati.
// - unit_ids terpilih → orders.maintenance_unit_ids → laporan teknisi hal 1/4
//   sudah auto-terisi (openLaporanModal.js). Loop nutup.
import { useState, useEffect, useMemo } from "react";
import { cs } from "../theme/cs.js";
import { daysUntil } from "../lib/dateTime.js";

// Jenis servis yang default-nya centang SEMUA unit (pekerjaan menyeluruh).
const SERVICE_ALL_DEFAULT = new Set(["cleaning", "maintenance"]);
// Jenis yang idealnya menunjuk unit spesifik → beri peringatan bila dilewati.
const SERVICE_NEEDS_UNIT = new Set(["repair", "complain"]);

export default function MaintUnitPickerModal({ client, serviceType, apiHeaders, onConfirm, onSkip, showNotif }) {
  const svc = String(serviceType || "").trim().toLowerCase();
  const allByDefault = SERVICE_ALL_DEFAULT.has(svc);
  const needsUnit = SERVICE_NEEDS_UNIT.has(svc);

  const [units, setUnits] = useState(null); // null = loading
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const headers = apiHeaders ? await apiHeaders() : { "Content-Type": "application/json" };
        const r = await fetch("/api/maintenance", {
          method: "POST", headers,
          body: JSON.stringify({ action: "list-units", client_id: client.id }),
        });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setErr(j.error || "Gagal memuat unit"); setUnits([]); return; }
        // Hanya unit aktif yang relevan untuk pekerjaan; retired/rusak disembunyikan.
        const list = (j.units || []).filter(u => (u.status || "active") === "active");
        setUnits(list);
        if (allByDefault) setPicked(new Set(list.map(u => u.id)));
      } catch (e) {
        if (alive) { setErr(e?.message || "Gagal memuat unit"); setUnits([]); }
      }
    })();
    return () => { alive = false; };
  }, [client.id, apiHeaders, allByDefault]);

  const filtered = useMemo(() => {
    const list = units || [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(u =>
      picked.has(u.id) ||
      `${u.unit_code || ""} ${u.location || ""} ${u.brand || ""}`.toLowerCase().includes(s));
  }, [units, q, picked]);

  const toggle = (id) => setPicked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const allIds = (units || []).map(u => u.id);
  const allPicked = allIds.length > 0 && picked.size === allIds.length;

  const btn = (bg, fg) => ({ flex: 1, background: bg, color: fg, border: "none", borderRadius: 9, padding: "12px", cursor: "pointer", fontWeight: 700, fontSize: 13 });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onSkip}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: cs.bg || cs.surface, border: "1px solid " + cs.border, borderRadius: 16, width: "100%", maxWidth: 620, maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid " + cs.border }}>
          <div style={{ fontWeight: 800, color: cs.text, fontSize: 15 }}>🏢 Pilih Unit yang Dikerjakan</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
            {client.name} · {serviceType || "servis"}
          </div>
          <div style={{ fontSize: 11, color: needsUnit ? (cs.yellow || "#eab308") : cs.muted, marginTop: 6 }}>
            {needsUnit
              ? "Repair/Complain sebaiknya menunjuk unit spesifik agar riwayat & frekuensi unit terekam."
              : "Pekerjaan menyeluruh — semua unit ter-centang otomatis. Hapus centang yang tidak dikerjakan."}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "12px 18px", overflowY: "auto", flex: 1 }}>
          {units === null ? (
            <div style={{ color: cs.muted, fontSize: 13, padding: 20, textAlign: "center" }}>⏳ Memuat unit…</div>
          ) : err ? (
            <div style={{ color: cs.red, fontSize: 12, padding: 12 }}>❌ {err}</div>
          ) : units.length === 0 ? (
            <div style={{ color: cs.muted, fontSize: 12, padding: 12, fontStyle: "italic" }}>
              Belum ada unit terdaftar untuk klien ini. Lewati — teknisi bisa tambah unit saat lapor.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari kode / lokasi / merk…"
                  style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }} />
                <button onClick={() => setPicked(allPicked ? new Set() : new Set(allIds))}
                  style={{ background: "transparent", border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "8px 10px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {allPicked ? "Hapus semua" : "Pilih semua"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 8 }}>
                {filtered.map(u => {
                  const on = picked.has(u.id);
                  const d = daysUntil(u.next_service_date);
                  const overdue = d !== null && d < 0;
                  return (
                    <div key={u.id} onClick={() => toggle(u.id)}
                      style={{ background: on ? cs.green + "12" : cs.card, border: "2px solid " + (on ? cs.green : cs.border), borderRadius: 10, padding: 9, cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13 }}>{on ? "☑️" : "⬜"}</span>
                        <b style={{ color: cs.text, fontSize: 13 }}>{u.unit_code}</b>
                        {overdue && <span style={{ background: cs.red + "22", color: cs.red, padding: "1px 6px", borderRadius: 999, fontSize: 9, fontWeight: 700 }}>PM lewat</span>}
                      </div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>
                        {u.location && <div>📍 {u.location}</div>}
                        <div>{u.brand || "—"}{u.capacity_pk ? ` ${u.capacity_pk}PK` : ""}{u.ac_type ? ` · ${u.ac_type}` : ""}</div>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && <div style={{ color: cs.muted, fontSize: 12, fontStyle: "italic", padding: 8 }}>Tidak ada unit cocok "{q}".</div>}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid " + cs.border }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: picked.size ? cs.green : cs.muted, marginBottom: 8 }}>
            {picked.size} unit dipilih
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => {
                if (needsUnit) {
                  showNotif?.("⚠️ Order disimpan tanpa unit — riwayat unit untuk pekerjaan ini tak akan terekam. Teknisi pilih unit saat lapor.");
                }
                onSkip();
              }}
              style={btn("transparent", cs.muted)}
              title={needsUnit ? "Riwayat unit tak terekam untuk repair/complain" : "Teknisi pilih unit saat mengisi laporan"}>
              Lewati {needsUnit ? "⚠️" : ""}
            </button>
            <button onClick={() => {
                if (picked.size === 0) { onSkip(); return; }
                onConfirm([...picked]);
              }}
              style={btn(picked.size ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)" : cs.border, picked.size ? "#0a0f1e" : cs.muted)}>
              Simpan dengan {picked.size} unit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
