import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { pName } from "../utils/finance.js";

export default function ProjectToolsView() {
  const { db, can, addRows, deleteRow } = useProject();
  const { openForm, toast } = useModal();

  const addTool = () => openForm({
    title: "Alat Baru (isi beberapa sekaligus)",
    fields: [{ name: "rows", label: "Alat Baru", type: "grid", hint: "tambah beberapa alat sekaligus",
      columns: [{ key: "nama", label: "Nama Alat" }, { key: "jumlah", label: "Jumlah", type: "number" }] }],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.nama);
      if (!rows.length) return toast("Isi minimal 1 baris");
      addRows("tools", rows.map((r, i) => ({ id: "t" + Date.now() + i, nama: r.nama, jumlah: +r.jumlah || 1, status: "tersedia", lokasi: "" })));
      toast(`${rows.length} alat ditambah`);
    },
  });

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>Alat kerja Project dibawa <b>terpisah</b> dari Tas Teknisi reguler.</div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Alat Kerja Project</h2></div>
        {can.manage && <button style={S.btn()} onClick={addTool}>+ Alat</button>}
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Alat</th><th style={S.tableStyles.th}>Jumlah</th>
            <th style={S.tableStyles.th}>Status</th><th style={S.tableStyles.th}>Posisi</th>
            {can.delete && <th style={S.tableStyles.th}></th>}
          </tr></thead>
          <tbody>
            {db.tools.map((t) => (
              <tr key={t.id}>
                <td style={S.tableStyles.td}>{t.nama}</td>
                <td style={S.tableStyles.td}>{t.jumlah}</td>
                <td style={S.tableStyles.td}>
                  <span style={S.pill(t.status === "servis" ? "yellow" : t.status === "di lokasi" ? "accent" : "green")}>{t.status}</span>
                </td>
                <td style={S.tableStyles.td}>{t.lokasi ? pName(db, t.lokasi) : "gudang"}</td>
                {can.delete && <td style={S.tableStyles.td}><button style={S.btnSm("ghost")} onClick={() => { if (window.confirm(`Hapus alat "${t.nama}"?`)) deleteRow("tools", t.id); }}>🗑</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
