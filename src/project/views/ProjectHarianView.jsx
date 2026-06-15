import React, { useState, useEffect, useCallback } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";
import { StatusPill } from "../components/Bits.jsx";
import Modal from "../components/Modal.jsx";
import { supabase } from "../../supabaseClient.js";

export default function ProjectHarianView() {
  const { db, can, today, upsertHarian, patchRow, uploadPhotos, deleteRow } = useProject();
  const { openForm, openContent, close, toast } = useModal();
  const [activeTab, setActiveTab] = useState("harian");

  const findHarian = (pid, tgl) => db.harian.find((h) => h.projectId === pid && h.tanggal === tgl);
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";
  const projOptions = db.projects.map((p) => p.nama);

  const addPagi = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
    title: "🌅 Laporan Pagi (Berangkat)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: projOptions },
      { name: "oleh", label: "Dicatat oleh" },
      { name: "jam", label: "Jam berangkat", type: "time", val: "07:30" },
      { name: "materialRows", label: "Material dibawa", type: "grid", hint: "kolom: nama · qty · satuan",
        columns: [{ key: "nama", label: "Nama Material" }, { key: "qty", label: "Qty", type: "number" }, { key: "satuan", label: "Satuan" }] },
      { name: "alat", label: "Alat dibawa (pilih dari gudang)", type: "checks",
        options: db.tools.filter((t) => t.lokasi === "" && t.status === "tersedia").map((t) => t.nama) },
      { name: "foto", label: "Foto kondisi berangkat", type: "photo" },
    ],
    onSubmit: async (d) => {
      const pid = pidByName(d.projectId); const proj = db.projects.find((p) => p.id === pid) || {};
      if (proj.status === "HOLD") return toast("⏸ Project HOLD — laporan dijeda");
      if (proj.status === "SELESAI") return toast("Project sudah SELESAI");
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci — sudah diverifikasi");
      const matStr = (d.materialRows || []).map((r) => `${r.nama || ""} ${r.qty || ""} ${r.satuan || ""}`.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ") || "-";
      const chosen = d.alat || [];
      let fotos = [];
      if ((d.foto || []).length) { toast("⏳ Mengupload foto…"); try { fotos = await uploadPhotos(d.foto, `project/${pid}/${today.slice(0, 7)}/pagi`); } catch (e) { toast("⚠️ Foto gagal diupload — laporan tetap disimpan"); } }
      const pagi = { jam: d.jam, material: matStr, alat: chosen.join(", ") || "-", foto: fotos.length, fotos };
      const existing = db.harian.find((x) => x.projectId === pid && x.tanggal === today);
      const row = existing
        ? { ...existing, oleh: d.oleh, pagi }
        : { id: "h" + Date.now(), tanggal: today, projectId: pid, oleh: d.oleh, pagi, sore: null, status: "DRAFT" };
      const toolChanges = chosen.map((nm) => { const t = db.tools.find((x) => x.nama === nm); return t ? { id: t.id, lokasi: pid, status: "di lokasi" } : null; }).filter(Boolean);
      upsertHarian(row, toolChanges);
      toast(`Laporan Pagi disimpan · ${fotos.length} foto · ${chosen.length} alat`);
    },
  });
  };

  const addSore = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
    title: "🌇 Laporan Sore (Pulang)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: projOptions },
      { name: "oleh", label: "Dicatat oleh" },
      { name: "jam", label: "Jam pulang", type: "time", val: "16:30" },
      { name: "progress", label: "Progress pengerjaan hari ini", type: "textarea" },
      { name: "materialRows", label: "Material sisa dibawa pulang", type: "grid", hint: "kolom: nama · qty · satuan",
        columns: [{ key: "nama", label: "Nama Material" }, { key: "qty", label: "Qty", type: "number" }, { key: "satuan", label: "Satuan" }] },
      { name: "alat", label: "Alat dibawa pulang (pilih yang di lokasi)", type: "checks",
        options: db.tools.filter((t) => t.status === "di lokasi").map((t) => t.nama) },
      { name: "foto", label: "Foto pekerjaan / kondisi pulang", type: "photo" },
    ],
    onSubmit: async (d) => {
      const pid = pidByName(d.projectId); const proj = db.projects.find((p) => p.id === pid) || {};
      if (proj.status === "HOLD") return toast("⏸ Project HOLD — laporan dijeda");
      if (proj.status === "SELESAI") return toast("Project sudah SELESAI");
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci — sudah diverifikasi");
      const matStr = (d.materialRows || []).map((r) => `${r.nama || ""} ${r.qty || ""} ${r.satuan || ""}`.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ") || "-";
      const chosen = d.alat || [];
      let fotos = [];
      if ((d.foto || []).length) { toast("⏳ Mengupload foto…"); try { fotos = await uploadPhotos(d.foto, `project/${pid}/${today.slice(0, 7)}/sore`); } catch (e) { toast("⚠️ Foto gagal diupload — laporan tetap disimpan"); } }
      const sore = { jam: d.jam, progress: d.progress, material: matStr, alat: chosen.join(", ") || "-", foto: fotos.length, fotos };
      const existing = db.harian.find((x) => x.projectId === pid && x.tanggal === today);
      const row = existing
        ? { ...existing, oleh: d.oleh, sore, status: "SUBMITTED" }
        : { id: "h" + Date.now(), tanggal: today, projectId: pid, oleh: d.oleh, pagi: null, sore, status: "SUBMITTED" };
      const toolChanges = chosen.map((nm) => { const t = db.tools.find((x) => x.nama === nm); return t ? { id: t.id, lokasi: "", status: "tersedia" } : null; }).filter(Boolean);
      upsertHarian(row, toolChanges);
      toast(`Laporan Sore terkirim · ${fotos.length} foto · ${chosen.length} alat → gudang`);
    },
  });
  };

  const setStatus = (id, st) => {
    patchRow("harian", id, { status: st });
    toast(st === "VERIFIED" ? "Diverifikasi 🔒 terkunci & tampil di portal customer" : "Laporan " + st);
  };

  const viewSession = (h, sesi) => {
    const s = h[sesi];
    openContent({
      content: (
        <Modal onClose={close}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 14 }}>
            {sesi === "pagi" ? "🌅 Laporan Pagi" : "🌇 Laporan Sore"} — {pName(db, h.projectId)} · {h.tanggal}
          </h3>
          {!s ? <p style={S.muted}>Sesi ini belum diisi.</p> : (
            <>
              {sesi === "pagi" ? (
                <>
                  <KV l="Jam berangkat" v={s.jam} />
                  <KV l="Material dibawa" v={s.material || "-"} />
                  <KV l="Alat dibawa" v={s.alat || "-"} />
                </>
              ) : (
                <>
                  <KV l="Jam pulang" v={s.jam} />
                  <p style={{ margin: "8px 0", color: cs.text }}><b>Progress:</b> {s.progress || "-"}</p>
                  <KV l="Material dibawa pulang" v={s.material || "-"} />
                  <KV l="Alat dibawa pulang" v={s.alat || "-"} />
                </>
              )}
              <div style={{ margin: "10px 0 4px", color: cs.muted, fontSize: 12 }}>
                Foto ({s.foto || 0}) · R2: project/{h.projectId}/{h.tanggal.slice(0, 7)}/{sesi}/
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
                {(s.fotos && s.fotos.length) ? s.fotos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" style={{ aspectRatio: 1, borderRadius: 10, overflow: "hidden", border: `1px solid ${cs.border}`, display: "block" }}>
                    <img alt={`foto ${i + 1}`} src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </a>
                )) : Array.from({ length: Math.min(8, s.foto || 0) }).map((_, i) => (
                  <div key={i} style={{ position: "relative", aspectRatio: 1, background: "linear-gradient(135deg,#1b2740,#0f1b30)", border: `1px solid ${cs.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 11 }}>foto</div>
                ))}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
            <button style={S.btn("ghost")} onClick={close}>Tutup</button>
          </div>
        </Modal>
      ),
    });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, background: cs.surface, borderRadius: 10, padding: 4, width: "fit-content", marginBottom: 20 }}>
        {[
          { id: "harian", label: "📋 Laporan Harian (Pagi/Sore)" },
          { id: "berita_acara", label: "📝 Berita Acara Harian" },
        ].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 700,
            cursor: "pointer", background: activeTab === t.id ? cs.accent : "transparent",
            color: activeTab === t.id ? "#fff" : cs.muted,
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === "harian" && (
        <>
          <div style={S.note}>
            1 laporan / hari / project. <b>Alat dipilih dari daftar</b> (bukan ketik) → posisi alat akurat di <b>Alat Kerja</b>. Foto per sesi di <b>R2</b>.
          </div>
          <div style={{ ...S.between, marginBottom: 14 }}>
            <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Laporan Harian</h2></div>
            <div style={S.row}>
              <button style={S.btn("sun")} onClick={addPagi}>🌅 + Laporan Pagi</button>
              <button style={S.btn("moon")} onClick={addSore}>🌇 + Laporan Sore</button>
            </div>
          </div>
          <div style={S.cardZero}>
            <table style={S.tableStyles.table}>
              <thead><tr>
                <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Project</th><th style={S.tableStyles.th}>Oleh</th>
                <th style={S.tableStyles.th}>🌅 Pagi</th><th style={S.tableStyles.th}>🌇 Sore</th>
                <th style={S.tableStyles.th}>Status</th><th style={S.tableStyles.th}>Aksi</th>
              </tr></thead>
              <tbody>
                {db.harian.map((h) => (
                  <tr key={h.id}>
                    <td style={S.tableStyles.td}>{h.tanggal.slice(5)}</td>
                    <td style={S.tableStyles.td}>{pName(db, h.projectId)}</td>
                    <td style={S.tableStyles.td}>{h.oleh}</td>
                    <td style={S.tableStyles.td}>{h.pagi ? <span style={S.pill("accent")}>{h.pagi.foto}📷</span> : <span style={S.muted}>belum</span>}</td>
                    <td style={S.tableStyles.td}>{h.sore ? <span style={S.pill("ara")}>{h.sore.foto}📷</span> : <span style={S.muted}>belum</span>}</td>
                    <td style={S.tableStyles.td}><StatusPill s={h.status} /></td>
                    <td style={S.tableStyles.td}>
                      <div style={S.row}>
                        <button style={S.btnSm("ghost")} onClick={() => viewSession(h, "pagi")}>Detail Pagi</button>
                        <button style={S.btnSm("ghost")} onClick={() => viewSession(h, "sore")}>Detail Sore</button>
                        {h.status === "SUBMITTED" && can.verify && (
                          <button style={S.btnSm("green")} onClick={() => setStatus(h.id, "VERIFIED")}>Verify</button>
                        )}
                        {can.delete && (
                          <button style={S.btnSm("ghost")} onClick={() => { if (window.confirm("Hapus laporan harian ini?")) deleteRow("harian", h.id); }}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === "berita_acara" && (
        <BeritaAcaraTab db={db} can={can} toast={toast} />
      )}
    </div>
  );
}

// ── Tab Berita Acara Harian (dari project_daily_reports) ──
function BeritaAcaraTab({ db, can, toast }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterPid, setFilterPid] = useState("all");
  const [viewRow, setViewRow] = useState(null);
  const [busy, setBusy]       = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("project_daily_reports")
      .select("*")
      .order("tanggal", { ascending: false })
      .limit(200);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const projName = (pid) => (db.projects.find((p) => p.id === pid) || {}).nama || pid;

  const verify = async (row, newStatus, note) => {
    setBusy(row.id);
    const { error } = await supabase
      .from("project_daily_reports")
      .update({ status: newStatus, revision_note: note || null, verified_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) { toast("❌ Gagal: " + error.message); }
    else { toast(newStatus === "VERIFIED" ? "✅ Diverifikasi" : "↩ Revisi diminta"); await load(); }
    setBusy("");
    setViewRow(null);
  };

  const filtered = filterPid === "all" ? rows : rows.filter(r => r.project_id === filterPid);
  const statusColor = { PENDING: "#f59e0b", VERIFIED: "#10b981", REVISION: "#ef4444" };

  return (
    <div>
      {/* Filter project */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: cs.muted }}>Filter:</span>
        {[{ id: "all", nama: "Semua Project" }, ...db.projects].map((p) => (
          <button key={p.id} onClick={() => setFilterPid(p.id)} style={{
            padding: "5px 12px", borderRadius: 8, border: `1px solid ${filterPid === p.id ? cs.accent : cs.border}`,
            background: filterPid === p.id ? cs.accent + "22" : "transparent",
            color: filterPid === p.id ? cs.accent : cs.muted, fontSize: 12, cursor: "pointer",
          }}>{p.nama}</button>
        ))}
        <button onClick={load} style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 8, border: `1px solid ${cs.border}`, background: "transparent", color: cs.muted, fontSize: 11, cursor: "pointer" }}>🔄 Refresh</button>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: cs.muted }}>Memuat…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: cs.muted, background: cs.card, borderRadius: 12, border: `1px solid ${cs.border}` }}>
          Belum ada berita acara. Teknisi submit lewat menu <b>Laporan Saya</b> pada job project.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((r) => (
            <div key={r.id} style={{ background: cs.card, border: `1px solid ${r.status === "VERIFIED" ? cs.green + "66" : r.status === "REVISION" ? "#ef444444" : cs.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>{projName(r.project_id)}</div>
                  <div style={{ fontSize: 12, color: cs.muted }}>
                    {r.tanggal} · {r.teknisi_name || "—"}
                    {(r.helper_names || []).length > 0 && ` + ${r.helper_names.join(", ")}`}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor[r.status] || cs.muted, background: (statusColor[r.status] || cs.muted) + "22", padding: "3px 8px", borderRadius: 6 }}>
                  {r.status}
                </span>
              </div>

              <div style={{ fontSize: 13, color: cs.text, marginBottom: 6, background: cs.surface, borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}>
                <b style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 2 }}>Pekerjaan:</b>
                {r.pekerjaan}
              </div>

              {r.kendala && (
                <div style={{ fontSize: 12, color: "#f59e0b", background: "#f59e0b11", borderRadius: 8, padding: "6px 10px", marginBottom: 6 }}>
                  ⚠️ <b>Kendala:</b> {r.kendala}
                </div>
              )}

              {r.revision_note && r.status === "REVISION" && (
                <div style={{ fontSize: 12, color: "#ef4444", background: "#ef444411", borderRadius: 8, padding: "6px 10px", marginBottom: 6 }}>
                  ↩ <b>Catatan revisi:</b> {r.revision_note}
                </div>
              )}

              {/* Foto grid */}
              {(r.foto_urls || []).length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, marginBottom: 8 }}>
                  {(r.foto_urls || []).slice(0, 20).map((url, i) => (
                    <a key={i} href={`/api/foto?key=${encodeURIComponent(url.includes("?key=") ? url.split("?key=")[1] : url)}`} target="_blank" rel="noreferrer"
                       style={{ aspectRatio: 1, borderRadius: 8, overflow: "hidden", border: `1px solid ${cs.border}`, display: "block" }}>
                      <img src={`/api/foto?key=${encodeURIComponent(url.includes("?key=") ? url.split("?key=")[1] : url)}`}
                        alt={`foto ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={e => { e.target.src = url; }} />
                    </a>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: cs.muted }}>
                  {(r.foto_urls || []).length} foto · {r.order_id || "—"} · submit {r.submitted_at ? new Date(r.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </div>
                {can.verify && r.status === "PENDING" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button disabled={busy === r.id} onClick={() => setViewRow(r)}
                      style={{ padding: "5px 14px", borderRadius: 8, border: `1px solid ${cs.border}`, background: "transparent", color: cs.muted, fontSize: 12, cursor: "pointer" }}>
                      Detail
                    </button>
                    <button disabled={busy === r.id} onClick={() => verify(r, "VERIFIED")}
                      style={{ padding: "5px 14px", borderRadius: 8, border: "none", background: cs.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      ✓ Verifikasi
                    </button>
                    <button disabled={busy === r.id} onClick={() => setViewRow({ ...r, _askRevision: true })}
                      style={{ padding: "5px 14px", borderRadius: 8, border: `1px solid #ef444466`, background: "transparent", color: "#ef4444", fontSize: 12, cursor: "pointer" }}>
                      ↩ Revisi
                    </button>
                  </div>
                )}
                {r.status !== "PENDING" && (
                  <div style={{ fontSize: 11, color: cs.muted }}>
                    {r.status === "VERIFIED" ? `✓ ${r.verified_at ? new Date(r.verified_at).toLocaleDateString("id-ID") : ""}` : ""}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal detail + verifikasi / revisi */}
      {viewRow && (
        <RevisiModal row={viewRow} onClose={() => setViewRow(null)} onVerify={verify} busy={busy} />
      )}
    </div>
  );
}

function RevisiModal({ row, onClose, onVerify, busy }) {
  const [note, setNote] = useState("");
  const isRevisi = row._askRevision;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: cs.surface, borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: cs.text, marginBottom: 12 }}>
          {isRevisi ? "↩ Minta Revisi" : "📋 Detail Berita Acara"}
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>{row.tanggal} · {row.teknisi_name}</div>
        <div style={{ background: cs.card, borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 13, color: cs.text, lineHeight: 1.5 }}>
          <b style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 2 }}>Pekerjaan:</b>{row.pekerjaan}
        </div>
        {row.kendala && (
          <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 10 }}>⚠️ <b>Kendala:</b> {row.kendala}</div>
        )}
        {(row.foto_urls || []).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6, marginBottom: 12 }}>
            {(row.foto_urls || []).map((url, i) => {
              const proxyUrl = `/api/foto?key=${encodeURIComponent(url.includes("?key=") ? url.split("?key=")[1] : url)}`;
              return (
                <a key={i} href={proxyUrl} target="_blank" rel="noreferrer" style={{ aspectRatio: 1, borderRadius: 8, overflow: "hidden", border: `1px solid ${cs.border}`, display: "block" }}>
                  <img src={proxyUrl} alt={`f${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.target.src = url; }} />
                </a>
              );
            })}
          </div>
        )}
        {isRevisi && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: cs.muted, display: "block", marginBottom: 4 }}>Catatan untuk teknisi <span style={{ color: "#ef4444" }}>*</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Jelaskan apa yang perlu diperbaiki..."
              style={{ width: "100%", background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, resize: "vertical", boxSizing: "border-box", outline: "none", fontFamily: "inherit" }} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "10px 0", borderRadius: 9, border: `1px solid ${cs.border}`, background: "transparent", color: cs.muted, cursor: "pointer", fontWeight: 600 }}>Tutup</button>
          {isRevisi ? (
            <button disabled={!note.trim() || busy === row.id} onClick={() => onVerify(row, "REVISION", note)}
              style={{ padding: "10px 0", borderRadius: 9, border: "none", background: !note.trim() ? cs.border : "#ef4444", color: "#fff", cursor: !note.trim() ? "not-allowed" : "pointer", fontWeight: 800 }}>
              ↩ Kirim Revisi
            </button>
          ) : (
            <button disabled={busy === row.id} onClick={() => onVerify(row, "VERIFIED")}
              style={{ padding: "10px 0", borderRadius: 9, border: "none", background: cs.green, color: "#fff", cursor: "pointer", fontWeight: 800 }}>
              ✓ Verifikasi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const KV = ({ l, v }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span style={{ color: cs.muted }}>{l}</span><b>{v}</b></div>;
