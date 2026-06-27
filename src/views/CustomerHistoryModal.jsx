import { cs } from "../theme/cs.js";
import { buildCustomerHistory } from "../lib/customers.js";
import { statusLabel } from "../constants/status.js";

// Modal preview Riwayat Pekerjaan customer (read-only).
// Diekstrak dari App.jsx (Fase 0 refactor) — perilaku identik.
// `customer` = objek customer yg dipreview (null = tutup). `fotoSrc` dioper
// dari App.jsx (butuh proxy R2). Data riwayat dihitung via buildCustomerHistory.
export default function CustomerHistoryModal({
  customer, onClose,
  ordersData, laporanReports, invoicesData, customersData,
  fotoSrc,
}) {
  if (!customer) return null;
  const cu = customer;
  const hist = buildCustomerHistory(cu, ordersData, laporanReports, invoicesData, customersData);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000d", zIndex: 9998,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }}>
      <div style={{
        background: cs.surface, border: "1px solid " + cs.border,
        borderRadius: 18, width: "100%", maxWidth: 500, maxHeight: "88vh",
        display: "flex", flexDirection: "column", overflow: "hidden"
      }}>
        {/* Header */}
        <div style={{
          background: cs.card, padding: "14px 18px",
          borderBottom: "1px solid " + cs.border,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📋 Riwayat Pekerjaan</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{cu.name} · {hist.length}x servis</div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer" }}>×</button>
        </div>
        {/* Info lokasi */}
        <div style={{
          padding: "7px 18px", background: cs.accent + "08",
          borderBottom: "1px solid " + cs.border + "44", fontSize: 11, color: cs.muted
        }}>
          📍 {(cu.address || cu.area || "-").slice(0, 50)}
          {hist[0] && <span style={{ marginLeft: 12 }}>🕐 Terakhir: {hist[0].date}</span>}
        </div>
        {/* List history */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {hist.length === 0
            ? <div style={{ padding: "32px", textAlign: "center", color: cs.muted, fontSize: 13 }}>Belum ada riwayat servis</div>
            : hist.map((h, hi) => (
              <div key={hi} style={{ borderBottom: "1px solid " + cs.border + "33" }}>
                {/* Job header */}
                <div style={{
                  padding: "10px 18px", background: hi === 0 ? cs.accent + "08" : "transparent",
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start"
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>
                      {h.service}{h.type ? " — " + h.type : ""}
                    </div>
                    <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, display: "flex", gap: 10 }}>
                      <span>📅 {h.date}</span>
                      <span>👷 {h.teknisi || "-"}</span>
                      <span>🔧 {h.units} unit</span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, padding: "2px 7px", borderRadius: 99, flexShrink: 0,
                    background: (h.status === "COMPLETED" || h.status === "PAID" ? cs.green : cs.yellow) + "22",
                    color: (h.status === "COMPLETED" || h.status === "PAID" ? cs.green : cs.yellow), fontWeight: 700
                  }}>
                    {statusLabel?.[h.status] || h.status || "-"}
                  </span>
                </div>
                {/* Detail per unit AC */}
                {(h.unit_detail || []).length > 0 && (
                  <div style={{ margin: "0 18px 8px", background: cs.card, borderRadius: 8, padding: "8px 10px" }}>
                    {(h.unit_detail || []).map((u, ui) => (
                      <div key={ui} style={{
                        marginBottom: ui < h.unit_detail.length - 1 ? 6 : 0,
                        paddingBottom: ui < h.unit_detail.length - 1 ? 5 : 0,
                        borderBottom: ui < h.unit_detail.length - 1 ? "1px solid " + cs.border + "33" : "none"
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>
                          Unit {u.unit_no || ui + 1}: {u.tipe || u.label || "-"}{u.merk ? " · " + u.merk : ""}
                        </div>
                        {(u.pekerjaan || []).length > 0 && (
                          <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>🔨 {u.pekerjaan.join(", ")}</div>
                        )}
                        {(u.kondisi_setelah || []).length > 0 && (
                          <div style={{ fontSize: 10, color: cs.green, marginTop: 1 }}>✅ {u.kondisi_setelah.join(", ")}</div>
                        )}
                        {u.freon_ditambah > 0 && (
                          <div style={{ fontSize: 10, color: "#38bdf8", marginTop: 1 }}>❄️ Tekanan: {u.freon_ditambah} psi</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Catatan & Rekomendasi */}
                {(h.rekomendasi || h.catatan) && (
                  <div style={{ margin: "0 18px 8px", fontSize: 11 }}>
                    {h.catatan && <div style={{ color: cs.muted, marginBottom: 3 }}>📝 {h.catatan.slice(0, 100)}</div>}
                    {h.rekomendasi && (
                      <div style={{
                        color: "#7dd3fc", background: "#0ea5e910",
                        borderRadius: 6, padding: "4px 8px", fontStyle: "italic"
                      }}>
                        💡 {h.rekomendasi.slice(0, 120)}{h.rekomendasi.length > 120 ? "..." : ""}
                      </div>
                    )}
                  </div>
                )}
                {/* Foto dokumentasi */}
                {(h.foto_urls || []).length > 0 && (
                  <div style={{ padding: "0 18px 12px" }}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 5, fontWeight: 600 }}>📸 Foto ({h.foto_urls.length})</div>
                    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                      {(h.foto_urls || []).map((url, fi) => (
                        <img key={fi} src={fotoSrc(url)} alt={"Foto " + (fi + 1)}
                          onClick={() => window.open(fotoSrc(url), "_blank")}
                          onError={e => { e.target.style.display = "none"; }}
                          style={{
                            width: 90, height: 90, objectFit: "cover", flexShrink: 0,
                            borderRadius: 8, cursor: "pointer", border: "1px solid " + cs.border
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
        </div>
        {/* Footer */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid " + cs.border, background: cs.card }}>
          <button onClick={onClose}
            style={{
              width: "100%", padding: "10px", background: cs.surface,
              border: "1px solid " + cs.border, borderRadius: 10,
              color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13
            }}>Tutup</button>
        </div>
      </div>
    </div>
  );
}
