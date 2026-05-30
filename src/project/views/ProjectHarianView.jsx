import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";
import { StatusPill } from "../components/Bits.jsx";
import Modal from "../components/Modal.jsx";

export default function ProjectHarianView() {
  const { db, can, today, update } = useProject();
  const { openForm, openContent, close, toast } = useModal();

  const findHarian = (pid, tgl) => db.harian.find((h) => h.projectId === pid && h.tanggal === tgl);
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";
  const projOptions = db.projects.map((p) => p.nama);

  const addPagi = () => openForm({
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
    onSubmit: (d) => {
      const pid = pidByName(d.projectId); const proj = db.projects.find((p) => p.id === pid) || {};
      if (proj.status === "HOLD") return toast("⏸ Project HOLD — laporan dijeda");
      if (proj.status === "SELESAI") return toast("Project sudah SELESAI");
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci — sudah diverifikasi");
      const matStr = (d.materialRows || []).map((r) => `${r.nama || ""} ${r.qty || ""} ${r.satuan || ""}`.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ") || "-";
      const chosen = d.alat || [];
      update((cur) => {
        chosen.forEach((nm) => { const t = cur.tools.find((x) => x.nama === nm); if (t) { t.lokasi = pid; t.status = "di lokasi"; } });
        let h = cur.harian.find((x) => x.projectId === pid && x.tanggal === today);
        if (!h) { h = { id: "h" + Date.now(), tanggal: today, projectId: pid, oleh: d.oleh, pagi: null, sore: null, status: "DRAFT" }; cur.harian = [h, ...cur.harian]; }
        else cur.harian = cur.harian.map((x) => x === h ? { ...x, pagi: { jam: d.jam, material: matStr, alat: chosen.join(", ") || "-", foto: d._photos }, oleh: d.oleh } : x);
        // ensure update (in case h was new, set pagi inline)
        cur.harian = cur.harian.map((x) => x.projectId === pid && x.tanggal === today ? { ...x, pagi: { jam: d.jam, material: matStr, alat: chosen.join(", ") || "-", foto: d._photos }, oleh: d.oleh } : x);
      });
      toast(`Laporan Pagi disimpan · ${chosen.length} alat → ${d.projectId}`);
    },
  });

  const addSore = () => openForm({
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
    onSubmit: (d) => {
      const pid = pidByName(d.projectId); const proj = db.projects.find((p) => p.id === pid) || {};
      if (proj.status === "HOLD") return toast("⏸ Project HOLD — laporan dijeda");
      if (proj.status === "SELESAI") return toast("Project sudah SELESAI");
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci — sudah diverifikasi");
      const matStr = (d.materialRows || []).map((r) => `${r.nama || ""} ${r.qty || ""} ${r.satuan || ""}`.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ") || "-";
      const chosen = d.alat || [];
      update((cur) => {
        chosen.forEach((nm) => { const t = cur.tools.find((x) => x.nama === nm); if (t) { t.lokasi = ""; t.status = "tersedia"; } });
        let h = cur.harian.find((x) => x.projectId === pid && x.tanggal === today);
        if (!h) { cur.harian = [{ id: "h" + Date.now(), tanggal: today, projectId: pid, oleh: d.oleh, pagi: null, sore: { jam: d.jam, progress: d.progress, material: matStr, alat: chosen.join(", ") || "-", foto: d._photos }, status: "SUBMITTED" }, ...cur.harian]; }
        else cur.harian = cur.harian.map((x) => x === h ? { ...x, oleh: d.oleh, sore: { jam: d.jam, progress: d.progress, material: matStr, alat: chosen.join(", ") || "-", foto: d._photos }, status: "SUBMITTED" } : x);
      });
      toast(`Laporan Sore terkirim · ${chosen.length} alat → gudang`);
    },
  });

  const setStatus = (id, st) => {
    update((cur) => { cur.harian = cur.harian.map((h) => (h.id === id ? { ...h, status: st } : h)); });
    toast(st === "VERIFIED" ? "Diverifikasi 🔒 hari ini terkunci" : "Laporan " + st);
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
                Foto ({s.foto}) · auto timestamp + GPS — R2: project/{h.projectId}/{h.tanggal.slice(0, 7)}/{sesi}/
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
                {Array.from({ length: Math.min(8, s.foto) }).map((_, i) => (
                  <div key={i} style={{ position: "relative", aspectRatio: 1, background: "linear-gradient(135deg,#1b2740,#0f1b30)", border: `1px solid ${cs.border}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 11, overflow: "hidden" }}>
                    foto
                    <span style={{ position: "absolute", left: 3, right: 3, bottom: 3, fontSize: 7.5, lineHeight: 1.25, background: "rgba(0,0,0,.6)", color: "#e2e8f0", borderRadius: 3, padding: "1px 3px", textAlign: "left" }}>
                      {h.tanggal.slice(5)} {s.jam}<br />📍-6.2,106.9
                    </span>
                  </div>
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const KV = ({ l, v }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span style={{ color: cs.muted }}>{l}</span><b>{v}</b></div>;
