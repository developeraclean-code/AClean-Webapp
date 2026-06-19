import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { pName } from "../utils/finance.js";
import { fmtRp } from "../utils/constants.js";
import { MiniCard, Tag } from "../components/Bits.jsx";

export default function ProjectPurchaseView() {
  const { db, can, today, addRows, deleteRow } = useProject();
  const { openForm, toast } = useModal();
  const [filterProj, setFilterProj] = useState("Semua");
  const [filterJenis, setFilterJenis] = useState("Semua");
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const projOpts = ["Semua", ...db.projects.map((p) => p.nama), "(umum)"];
  let rows = db.purchases.slice();
  if (filterProj !== "Semua") rows = rows.filter((x) => filterProj === "(umum)" ? !x.projectId : pName(db, x.projectId) === filterProj);
  if (filterJenis !== "Semua") rows = rows.filter((x) => x.jenis === filterJenis);
  const total = rows.reduce((s, x) => s + x.total, 0);
  const totMat = rows.filter((x) => x.jenis === "Material").reduce((s, x) => s + x.total, 0);
  const totAlat = rows.filter((x) => x.jenis === "Alat").reduce((s, x) => s + x.total, 0);

  const addPurchase = () => {
    openForm({
    title: "Catat Pembelian (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: ["(umum)", ...db.projects.map((p) => p.nama)] },
      { name: "rows", label: "Daftar Pembelian", type: "grid", hint: "tersimpan per item terpisah",
        columns: [
          { key: "jenis", label: "Jenis", type: "select", options: ["Material", "Alat"] },
          { key: "item", label: "Item" }, { key: "qty", label: "Qty" },
          { key: "satuan", label: "Satuan" }, { key: "total", label: "Total (Rp)", type: "number" },
        ] },
    ],
    onSubmit: (d) => {
      const pid = d.projectId === "(umum)" ? "" : pidByName(d.projectId);
      const rr = (d.rows || []).filter((r) => r.item);
      if (!rr.length) return toast("Isi minimal 1 baris ber-item");
      addRows("purchases", rr.map((r) => ({ tanggal: today, projectId: pid, jenis: r.jenis || "Material", item: r.item, qty: `${r.qty || ""} ${r.satuan || ""}`.trim(), total: +r.total, nota: true })));
      toast(`${rr.length} pembelian tercatat`);
    },
  });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>
        Pembelian material & alat → masuk Stok Gudang / Daftar Alat & tercatat di Keuangan. Filter per project & jenis di bawah.
      </div>
      <div style={{ ...S.between, marginBottom: 10 }}>
        <div style={S.row}>
          <span style={{ ...S.muted, fontSize: 12 }}>Project:</span>
          <select style={S.select} value={filterProj} onChange={(e) => setFilterProj(e.target.value)}>
            {projOpts.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </div>
        {can.expenseInput && <button style={S.btn()} onClick={addPurchase}>+ Catat Pembelian</button>}
      </div>
      <div style={{ ...S.row, marginBottom: 12 }}>
        {["Semua", "Material", "Alat"].map((c) => (
          <span key={c} style={S.chip(c === filterJenis)} onClick={() => setFilterJenis(c)}>{c}</span>
        ))}
      </div>
      <div style={{ ...S.row, marginBottom: 14, gap: 10 }}>
        <MiniCard label="Total Pembelian" value={fmtRp(total)} color="red" />
        <MiniCard label="Material" value={fmtRp(totMat)} color="accent" />
        <MiniCard label="Alat" value={fmtRp(totAlat)} color="yellow" />
        <MiniCard label="Jumlah Transaksi" value={rows.length} />
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Jenis</th>
            <th style={S.tableStyles.th}>Item</th><th style={S.tableStyles.th}>Qty</th>
            <th style={S.tableStyles.th}>Total</th><th style={S.tableStyles.th}>Project</th>
            <th style={S.tableStyles.th}>Nota</th>
            {can.delete && <th style={S.tableStyles.th}></th>}
          </tr></thead>
          <tbody>
            {rows.length ? rows.map((x, i) => (
              <tr key={i}>
                <td style={S.tableStyles.td}>{x.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}><span style={S.pill(x.jenis === "Alat" ? "yellow" : "accent")}>{x.jenis}</span></td>
                <td style={S.tableStyles.td}>{x.item}</td>
                <td style={S.tableStyles.td}>{x.qty}</td>
                <td style={S.tableStyles.td}>{fmtRp(x.total)}</td>
                <td style={S.tableStyles.td}>{pName(db, x.projectId)}</td>
                <td style={S.tableStyles.td}>{x.nota ? <Tag>📎 nota</Tag> : <span style={S.muted}>-</span>}</td>
                {can.delete && <td style={S.tableStyles.td}><button style={S.btnSm("ghost")} onClick={() => { if (window.confirm("Hapus pembelian ini?")) deleteRow("purchases", x.id); }}>🗑</button></td>}
              </tr>
            )) : <tr><td colSpan={can.delete ? 8 : 7} style={{ ...S.tableStyles.td, ...S.muted, textAlign: "center", padding: 18 }}>Tidak ada data untuk filter ini</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
