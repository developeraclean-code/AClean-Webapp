import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";
import { EXP_CATS, fmtRp } from "../utils/constants.js";
import { MiniCard, Tag } from "../components/Bits.jsx";

export default function ProjectExpenseView() {
  const { db, role, can, today, addRows } = useProject();
  const { openForm, toast } = useModal();
  const [filterProj, setFilterProj] = useState("Semua");
  const [filterCat, setFilterCat] = useState("Semua");
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const projOpts = ["Semua", ...db.projects.map((p) => p.nama), "(umum)"];
  let rows = db.expenses.slice();
  if (filterProj !== "Semua") rows = rows.filter((e) => filterProj === "(umum)" ? !e.projectId : pName(db, e.projectId) === filterProj);
  if (filterCat !== "Semua") rows = rows.filter((e) => e.kategori === filterCat);
  const total = rows.reduce((s, e) => s + e.nominal, 0);
  const byCat = {}; rows.forEach((e) => byCat[e.kategori] = (byCat[e.kategori] || 0) + e.nominal);

  const addExpense = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
    title: "Catat Pengeluaran (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: db.projects.map((p) => p.nama) },
      { name: "rows", label: "Daftar Pengeluaran", type: "grid", hint: "isi banyak baris sekaligus → tersimpan per item terpisah",
        columns: [{ key: "kategori", label: "Kategori", type: "select", options: EXP_CATS }, { key: "ket", label: "Keterangan" }, { key: "nominal", label: "Nominal (Rp)", type: "number" }] },
    ],
    onSubmit: (d) => {
      const pid = pidByName(d.projectId);
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci");
      const rr = (d.rows || []).filter((r) => r.nominal);
      if (!rr.length) return toast("Isi minimal 1 baris bernominal");
      addRows("expenses", rr.map((r) => ({ tanggal: today, projectId: pid, kategori: r.kategori || EXP_CATS[0], ket: r.ket, nominal: +r.nominal, oleh: role })));
      toast(`${rr.length} pengeluaran tercatat`);
    },
  });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>
        <b>Admin boleh input</b> pengeluaran. Filter per project & kategori di bawah. Baris ber-🔒 = hari diverifikasi & terkunci.
      </div>
      <div style={{ ...S.between, marginBottom: 10 }}>
        <div style={S.row}>
          <span style={{ ...S.muted, fontSize: 12 }}>Project:</span>
          <select style={S.select} value={filterProj} onChange={(e) => setFilterProj(e.target.value)}>
            {projOpts.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </div>
        {can.expenseInput && <button style={S.btn()} onClick={addExpense}>+ Catat Pengeluaran</button>}
      </div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        {["Semua", ...EXP_CATS].map((c) => (
          <span key={c} style={S.chip(c === filterCat)} onClick={() => setFilterCat(c)}>{c}</span>
        ))}
      </div>
      <div style={{ ...S.row, marginBottom: 14, gap: 10 }}>
        <MiniCard label="Total Pengeluaran" value={fmtRp(total)} color="red" />
        <MiniCard label="Jumlah Transaksi" value={rows.length} />
        {Object.entries(byCat).map(([c, v]) => (<MiniCard key={c} label={c} value={fmtRp(v)} />))}
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Project</th>
            <th style={S.tableStyles.th}>Kategori</th><th style={S.tableStyles.th}>Keterangan</th>
            <th style={S.tableStyles.th}>Nominal</th><th style={S.tableStyles.th}>Oleh</th>
          </tr></thead>
          <tbody>
            {rows.length ? rows.map((e, i) => (
              <tr key={i}>
                <td style={S.tableStyles.td}>{e.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}>{pName(db, e.projectId)} {isLocked(db, e.projectId, e.tanggal) && <span style={S.pill("gray")}>🔒</span>}</td>
                <td style={S.tableStyles.td}><Tag>{e.kategori}</Tag></td>
                <td style={S.tableStyles.td}>{e.ket}</td>
                <td style={S.tableStyles.td}>{fmtRp(e.nominal)}</td>
                <td style={S.tableStyles.td}>{e.oleh}</td>
              </tr>
            )) : <tr><td colSpan={6} style={{ ...S.tableStyles.td, ...S.muted, textAlign: "center", padding: 18 }}>Tidak ada data untuk filter ini</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
