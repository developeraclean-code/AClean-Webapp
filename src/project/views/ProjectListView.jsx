import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { budget } from "../utils/finance.js";
import { CATS, fmtRp } from "../utils/constants.js";
import { Bar, StatusPill, Tag } from "../components/Bits.jsx";
import Modal from "../components/Modal.jsx";

const genToken = () => "ptk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

export default function ProjectListView() {
  const { db, can, addRows, deleteRow, updateProject, setActiveView, setActiveProject } = useProject();
  const { openForm, openContent, close, toast } = useModal();

  const managePortal = (p) => openContent({ content: <PortalManager p={p} updateProject={updateProject} close={close} toast={toast} /> });
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
      if (!d.nama) { toast("Nama project wajib diisi"); return; }
      const newId = "p" + Date.now();
      addRows("projects", [{
        id: newId, nama: d.nama, kategori: d.kategori, lokasi: d.lokasi,
        status: "BERJALAN", progress: 0, mulai: d.mulai, target: d.target,
        nilai: +d.nilai || 0, rab: +d.rab || 0, pic: d.pic, tim: [d.pic],
      }]);
      setActiveProject(newId);
      toast("Project ditambah — buka Detail untuk lihat");
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
            {(can.manage || can.delete) && <th style={S.tableStyles.th}>Aksi</th>}
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
                  {(can.manage || can.delete) && (
                    <td style={S.tableStyles.td}>
                      <div style={S.row}>
                        {can.manage && (
                          <button style={S.btnSm(p.tokenActive ? "green" : "ghost")} title="Portal customer" onClick={(e) => { e.stopPropagation(); managePortal(p); }}>
                            🔗 Portal{p.tokenActive ? " ●" : ""}
                          </button>
                        )}
                        {can.delete && (
                          <button style={S.btnSm("ghost")} onClick={(e) => { e.stopPropagation(); if (window.confirm(`Hapus project "${p.nama}" beserta semua data terkait (DP, laporan, dll)?`)) deleteRow("projects", p.id); }}>🗑</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Manajemen portal customer per-project (Owner/Admin) ──
function PortalManager({ p, updateProject, close, toast }) {
  const [token, setToken] = useState(p.portalToken || "");
  const [active, setActive] = useState(!!p.tokenActive);
  // Format seragam semua portal: https://status.aclean.id/status/<token>
  const link = token ? `https://status.aclean.id/status/${token}` : "";

  const generate = () => {
    const t = genToken();
    setToken(t); setActive(true);
    updateProject(p.id, { portalToken: t, tokenActive: true });
    toast("Link portal dibuat & diaktifkan");
  };
  const toggle = () => {
    const next = !active;
    setActive(next);
    updateProject(p.id, { tokenActive: next });
    toast(next ? "Portal diaktifkan" : "Portal dinonaktifkan");
  };
  const copy = () => { try { navigator.clipboard.writeText(link); toast("Link disalin"); } catch { toast("Gagal menyalin — salin manual"); } };

  return (
    <Modal onClose={close}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 6 }}>🔗 Portal Customer — {p.nama}</h3>
      <p style={{ ...S.muted, fontSize: 12.5, marginBottom: 14 }}>
        Customer bisa pantau progres harian, pemakaian material & foto. Hanya laporan harian
        ber-status <b>VERIFIED</b> (klik <b>Verify</b> di Laporan Harian) yang tampil — layer pengaman approval.
      </p>

      {!token ? (
        <button style={S.btn()} onClick={generate}>Buat Link Portal</button>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: active ? cs.green : cs.muted }}>
              {active ? "● Aktif" : "○ Nonaktif"}
            </span>
            <button style={S.btnSm(active ? "ghost" : "green")} onClick={toggle}>{active ? "Nonaktifkan" : "Aktifkan"}</button>
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Link untuk customer:</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()}
              style={{ flex: 1, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12 }} />
            <button style={S.btnSm("primary")} onClick={copy}>Salin</button>
          </div>
          {!active && <p style={{ ...S.muted, fontSize: 11, marginTop: 8 }}>⚠️ Portal nonaktif — link tidak bisa diakses customer sampai diaktifkan.</p>}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button style={S.btn("ghost")} onClick={close}>Tutup</button>
      </div>
    </Modal>
  );
}
