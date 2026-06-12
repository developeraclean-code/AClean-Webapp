import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { pName } from "../utils/finance.js";

const UMUM = "(Umum / Gudang)";
const STATUS_OPT = ["tersedia", "di lokasi", "servis"];

export default function ProjectToolsView() {
  const { db, can, addRows, patchRow, deleteRow } = useProject();
  const { openForm, toast } = useModal();

  const projOptions = db.projects.map((p) => p.nama);
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const addTool = () => openForm({
    title: "Alat Baru (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Untuk Project", type: "select", options: [UMUM, ...projOptions], hint: "pilih project tujuan, atau Umum/Gudang" },
      { name: "rows", label: "Alat Baru", type: "grid", hint: "tambah beberapa alat sekaligus",
        columns: [{ key: "nama", label: "Nama Alat" }, { key: "jumlah", label: "Jumlah", type: "number" }] },
    ],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.nama);
      if (!rows.length) return toast("Isi minimal 1 baris");
      const pid = d.projectId === UMUM ? "" : pidByName(d.projectId);
      addRows("tools", rows.map((r, i) => ({ id: "t" + Date.now() + i, nama: r.nama, jumlah: +r.jumlah || 1, status: "tersedia", lokasi: "", projectId: pid })));
      toast(`${rows.length} alat ditambah${pid ? " → " + pName(db, pid) : ""}`);
    },
  });

  const editTool = (t) => openForm({
    title: `Edit Alat — ${t.nama}`,
    fields: [
      { name: "nama", label: "Nama Alat", val: t.nama },
      { name: "jumlah", label: "Jumlah", type: "number", val: t.jumlah },
      { name: "projectId", label: "Untuk Project", type: "select", options: [UMUM, ...projOptions], val: t.projectId ? pName(db, t.projectId) : UMUM },
      { name: "status", label: "Status", type: "select", options: STATUS_OPT, val: t.status },
    ],
    onSubmit: (d) => {
      if (!d.nama) return toast("Nama alat wajib diisi");
      const pid = d.projectId === UMUM ? "" : pidByName(d.projectId);
      patchRow("tools", t.id, { nama: d.nama, jumlah: +d.jumlah || 1, projectId: pid, status: d.status || t.status });
      toast("Alat diperbarui");
    },
  });

  // Kelompokkan per project: { pid → [tools] }, pid "" = Umum/Gudang
  const groups = [{ pid: "", label: "Umum / Gudang", tools: [] }, ...db.projects.map((p) => ({ pid: p.id, label: p.nama, tools: [] }))];
  db.tools.forEach((t) => {
    const g = groups.find((x) => x.pid === (t.projectId || "")) || groups[0];
    g.tools.push(t);
  });
  const shown = groups.filter((g) => g.tools.length > 0);
  const colCount = 4 + (can.manage ? 1 : 0) + (can.delete && !can.manage ? 1 : 0);

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>Alat kerja Project dibawa <b>terpisah</b> dari Tas Teknisi reguler. Dikelompokkan <b>per project</b> — tiap project beda kebutuhan alat.</div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Alat Kerja Project</h2></div>
        {can.manage && <button style={S.btn()} onClick={addTool}>+ Alat</button>}
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Alat</th><th style={S.tableStyles.th}>Jumlah</th>
            <th style={S.tableStyles.th}>Status</th><th style={S.tableStyles.th}>Posisi</th>
            {(can.manage || can.delete) && <th style={S.tableStyles.th}>Aksi</th>}
          </tr></thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={colCount} style={{ ...S.tableStyles.td, color: cs.muted, textAlign: "center", padding: 20 }}>Belum ada alat. Klik + Alat.</td></tr>
            ) : shown.map((g) => (
              <React.Fragment key={g.pid || "umum"}>
                <tr><td colSpan={colCount} style={{ background: "#0f1b30", color: cs.ara, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", padding: "9px 12px" }}>{g.label} · {g.tools.length} alat</td></tr>
                {g.tools.map((t) => (
                  <tr key={t.id}>
                    <td style={S.tableStyles.td}>{t.nama}</td>
                    <td style={S.tableStyles.td}>{t.jumlah}</td>
                    <td style={S.tableStyles.td}>
                      <span style={S.pill(t.status === "servis" ? "yellow" : t.status === "di lokasi" ? "accent" : "green")}>{t.status}</span>
                    </td>
                    <td style={S.tableStyles.td}>{t.lokasi ? pName(db, t.lokasi) : "gudang"}</td>
                    {(can.manage || can.delete) && (
                      <td style={S.tableStyles.td}><div style={S.row}>
                        {can.manage && <button style={S.btnSm("ghost")} title="Edit alat" onClick={() => editTool(t)}>✏️</button>}
                        {can.delete && <button style={S.btnSm("ghost")} onClick={() => { if (window.confirm(`Hapus alat "${t.nama}"?`)) deleteRow("tools", t.id); }}>🗑</button>}
                      </div></td>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
