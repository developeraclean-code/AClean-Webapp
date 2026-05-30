import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { budget } from "../utils/finance.js";
import { CATS, fmtRp } from "../utils/constants.js";
import { Bar, StatusPill, Tag } from "../components/Bits.jsx";

export default function ProjectListView() {
  const { db, can, update, setActiveView, setActiveProject } = useProject();
  const { openForm, toast } = useModal();
  const [cats, setCats] = useState(CATS);
  const [filter, setFilter] = useState("Semua");

  const rows = db.projects.filter((p) => filter === "Semua" || p.kategori === filter);

  const goDetail = (pid) => { setActiveProject(pid); setActiveView("detail"); };

  const addProject = () => openForm({
    title: "Project Baru",
    fields: [
      { name: "nama", label: "Nama Project" },
      { name: "kategori", label: "Kategori", type: "select", options: cats },
      { name: "lokasi", label: "Lokasi" }, { name: "pic", label: "PIC" },
      { name: "nilai", label: "Nilai kontrak (Rp)", type: "number" },
      { name: "rab", label: "Estimasi biaya / RAB (Rp)", type: "number" },
      { name: "mulai", label: "Mulai", type: "date" },
      { name: "target", label: "Target selesai", type: "date" },
    ],
    onSubmit: (d) => {
      update((cur) => {
        cur.projects = [...cur.projects, {
          id: "p" + Date.now(), nama: d.nama, kategori: d.kategori, lokasi: d.lokasi,
          status: "BERJALAN", progress: 0, mulai: d.mulai, target: d.target,
          nilai: +d.nilai || 0, rab: +d.rab || 0, pic: d.pic, tim: [d.pic],
        }];
      });
      toast("Project ditambah");
    },
  });
  const addCategory = () => openForm({
    title: "Kategori Baru",
    fields: [{ name: "nama", label: "Nama kategori" }],
    onSubmit: (d) => { if (d.nama && !cats.includes(d.nama)) { setCats([...cats, d.nama]); toast("Kategori ditambah"); } },
  });

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>Klik baris project untuk buka <b>Detail</b>. Owner/Admin bisa <b>+ Project Baru</b>.</div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.row}>
          {["Semua", ...cats].map((c) => (
            <span key={c} style={S.chip(c === filter)} onClick={() => setFilter(c)}>{c}</span>
          ))}
          {can.manage && (
            <span style={{ ...S.chip(false), borderStyle: "dashed" }} onClick={addCategory}>+ Kategori</span>
          )}
        </div>
        {can.manage && <button style={S.btn()} onClick={addProject}>+ Project Baru</button>}
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Project</th><th style={S.tableStyles.th}>Kategori</th>
            <th style={S.tableStyles.th}>Lokasi</th><th style={S.tableStyles.th}>Tim</th>
            {can.finance && <th style={S.tableStyles.th}>Nilai</th>}
            <th style={S.tableStyles.th}>Progress</th><th style={S.tableStyles.th}>Status</th>
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const b = budget(db, p.id);
              const fill = p.status === "HOLD" ? cs.muted : p.progress >= 85 ? cs.green : p.progress < 50 ? cs.yellow : cs.accent;
              return (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => goDetail(p.id)}>
                  <td style={S.tableStyles.td}>
                    <b>{p.nama}</b>
                    <div style={{ ...S.muted, fontSize: 12 }}>
                      {p.mulai} → {p.target} {b.crit ? <span style={S.pill("red")}>over budget</span> : null}
                    </div>
                  </td>
                  <td style={S.tableStyles.td}><Tag>{p.kategori}</Tag></td>
                  <td style={S.tableStyles.td}>{p.lokasi}</td>
                  <td style={S.tableStyles.td}>{p.pic} +{(p.tim?.length || 1) - 1}</td>
                  {can.finance && <td style={S.tableStyles.td}>{fmtRp(p.nilai)}</td>}
                  <td style={S.tableStyles.td}>
                    <div style={{ width: 90 }}><Bar pct={p.progress} color={fill} /></div>
                  </td>
                  <td style={S.tableStyles.td}><StatusPill s={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
