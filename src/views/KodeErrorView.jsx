import { useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import { KODE_ERROR_BRANDS, KODE_ERROR_DATA } from "../constants/kodeError.js";

// KodeErrorView — referensi kode error AC per brand (Daikin/Gree/Panasonic/Midea/Sharp).
// Data statis dari src/constants/kodeError.js. Semua role boleh akses (referensi teknis).
// Tiap kode: Kode · Keterangan · Cek Kendala · Kemungkinan Kerusakan.

export default function KodeErrorView() {
  const [brand, setBrand] = useState("daikin");
  const [q, setQ] = useState("");

  const list = KODE_ERROR_DATA[brand] || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((e) =>
      e.kode.toLowerCase().includes(s) ||
      e.keterangan.toLowerCase().includes(s) ||
      e.cek_kendala.some((x) => x.toLowerCase().includes(s)) ||
      e.kemungkinan_kerusakan.some((x) => x.toLowerCase().includes(s))
    );
  }, [list, q]);

  const brandLabel = KODE_ERROR_BRANDS.find((b) => b.key === brand)?.label || "";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>🚨 Kode Error AC</div>
        <div style={{ fontSize: 13, color: cs.muted, marginTop: 2 }}>
          Referensi kode error + cara cek & kemungkinan kerusakan per merk.
        </div>
      </div>

      {/* Sub-kategori brand */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {KODE_ERROR_BRANDS.map((b) => {
          const active = brand === b.key;
          return (
            <button key={b.key} onClick={() => { setBrand(b.key); setQ(""); }}
              style={{
                padding: "8px 14px", borderRadius: 99, cursor: "pointer", fontSize: 13, fontWeight: 700,
                border: "1px solid " + (active ? cs.accent : cs.border),
                background: active ? cs.accent : cs.surface,
                color: active ? "#0a0f1e" : cs.muted,
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <span>{b.icon}</span>{b.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={`Cari kode / gejala di ${brandLabel}… (mis. "E5", "kompresor")`}
        style={{ width: "100%", boxSizing: "border-box", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 13px", color: cs.text, fontSize: 13, outline: "none", marginBottom: 12 }} />

      {/* Disclaimer */}
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: cs.yellow + "10", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "9px 12px", marginBottom: 14 }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <div style={{ fontSize: 11.5, color: cs.yellow, lineHeight: 1.5 }}>
          Kode & pola bisa berbeda antar seri/model dalam 1 merk. Untuk kasus kritis, cross-check ke manual servis resmi unit tersebut.
        </div>
      </div>

      <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>
        {filtered.length} kode {q ? "cocok" : "umum"} · {brandLabel}
      </div>

      {/* Daftar kode */}
      <div style={{ display: "grid", gap: 12 }}>
        {filtered.length === 0 ? (
          <div style={{ background: cs.surface, border: "1px dashed " + cs.border, borderRadius: 12, padding: 20, textAlign: "center", fontSize: 12.5, color: cs.muted }}>
            Tidak ada kode yang cocok dengan "{q}" di {brandLabel}.
          </div>
        ) : filtered.map((e) => <ErrorCard key={e.kode} entry={e} />)}
      </div>
    </div>
  );
}

const sectionHead = { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, display: "flex", alignItems: "center", gap: 5 };
const liStyle = { fontSize: 12.5, color: cs.text, lineHeight: 1.5, display: "flex", gap: 7, alignItems: "flex-start" };

function ErrorCard({ entry }) {
  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
      {/* Header: kode + keterangan */}
      <div style={{ padding: "12px 14px", background: cs.red + "10", borderBottom: "1px solid " + cs.red + "26", display: "flex", gap: 11, alignItems: "flex-start" }}>
        <span style={{ flex: "none", background: cs.red, color: "#fff", fontWeight: 800, fontSize: 14, borderRadius: 8, padding: "5px 11px", letterSpacing: 0.3 }}>
          {entry.kode}
        </span>
        <div style={{ fontSize: 13, color: cs.text, fontWeight: 600, lineHeight: 1.45, paddingTop: 2 }}>
          {entry.keterangan}
        </div>
      </div>

      {/* Body: cek kendala + kemungkinan kerusakan */}
      <div style={{ padding: "12px 14px", display: "grid", gap: 13 }}>
        <div>
          <div style={{ ...sectionHead, color: cs.accent }}>🔍 Cek Kendala</div>
          <div style={{ display: "grid", gap: 4 }}>
            {entry.cek_kendala.map((c, i) => (
              <div key={i} style={liStyle}><span style={{ color: cs.accent, flex: "none" }}>›</span><span>{c}</span></div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ ...sectionHead, color: cs.yellow }}>🔧 Kemungkinan Kerusakan</div>
          <div style={{ display: "grid", gap: 4 }}>
            {entry.kemungkinan_kerusakan.map((k, i) => (
              <div key={i} style={liStyle}><span style={{ color: cs.yellow, flex: "none" }}>›</span><span>{k}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
