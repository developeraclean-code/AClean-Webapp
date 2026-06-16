import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { calc, budget } from "../utils/finance.js";
import { fmtRp } from "../utils/constants.js";
import { StatusPill, Tag, Bar } from "../components/Bits.jsx";
import { pdf } from "@react-pdf/renderer";
import ProjectPaperPDF, { loadLogo } from "../components/ProjectPaperPDF.jsx";
import { supabase } from "../../supabaseClient.js";

export default function ProjectFinanceView() {
  const { db, can, activeProject, setActiveProject, addRows, deleteRow, appSettings } = useProject();
  const { openForm, toast } = useModal();

  // Download helper: render PDF → unduh
  const dl = async (node, filename) => {
    const blob = await pdf(node).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename.replace(/[^a-zA-Z0-9._-]/g, "_"); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  if (!can.finance) {
    return (
      <div style={{ padding: 22 }}>
        <div style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: 24, textAlign: "center", color: cs.red }}>
          🔒 Keuangan Project hanya untuk <b>Owner</b>.<br />
          <span style={{ ...S.muted, fontSize: 12 }}>Admin dapat menginput pengeluaran & pembelian, tetapi tidak melihat margin / nilai kontrak.</span>
        </div>
      </div>
    );
  }
  const p = db.projects.find((x) => x.id === activeProject);
  if (!p) return <div style={{ padding: 22, ...S.muted }}>Project tidak ditemukan.</div>;
  const k = calc(db, p.id); const b = budget(db, p.id);

  const addDP = () => openForm({
    title: "Tambah DP / Termin (isi beberapa sekaligus)",
    fields: [{ name: "rows", label: "DP / Termin", type: "grid", hint: "kolom: tanggal · keterangan · jumlah",
      columns: [{ key: "tanggal", label: "Tanggal", type: "date" }, { key: "ket", label: "Keterangan" }, { key: "jumlah", label: "Jumlah (Rp)", type: "number" }] }],
    onSubmit: (d) => {
      const rr = (d.rows || []).filter((r) => r.jumlah);
      if (!rr.length) return toast("Isi minimal 1 baris bernominal");
      addRows("dp", rr.map((r) => ({ projectId: p.id, tanggal: r.tanggal || new Date().toISOString().slice(0, 10), jumlah: +r.jumlah, ket: r.ket })));
      toast(`${rr.length} DP/termin dicatat`);
    },
  });

  const customerName = p.pic || p.nama;

  const cetakKwitansi = async (d, i) => {
    toast("⏳ Menyiapkan kwitansi…");
    const logoUrl = await loadLogo();
    await dl(
      <ProjectPaperPDF type="KWITANSI" project={p} appSettings={appSettings} logoUrl={logoUrl}
        kwitansi={{ nomor: `KW-${String(i + 1).padStart(3, "0")}`, tanggal: d.tanggal, jumlah: d.jumlah, ket: d.ket || `Pembayaran project ${p.nama}`, customer: customerName }} />,
      `Kwitansi_${p.nama}_${d.tanggal}.pdf`);
    toast("✅ Kwitansi diunduh");
  };

  const cetakInvoice = async () => {
    toast("⏳ Menyiapkan invoice…");
    const logoUrl = await loadLogo();
    await dl(
      <ProjectPaperPDF type="INVOICE" project={p} appSettings={appSettings} logoUrl={logoUrl}
        invoice={{ nomor: `INV-PRJ-${String(p.id).slice(-5)}`, tanggal: new Date().toISOString().slice(0, 10), customer: customerName, nilai: p.nilai, dpList: k.dpList, dpTotal: k.dpTotal, sisa: k.sisaTagihan }} />,
      `Invoice_${p.nama}.pdf`);
    toast("✅ Invoice diunduh");
  };

  const cetakRekap = async () => {
    toast("⏳ Menyiapkan rekap…");
    const logoUrl = await loadLogo();
    const { data: ba } = await supabase.from("project_daily_reports")
      .select("tanggal,teknisi_name,helper_names,pekerjaan,kendala")
      .eq("project_id", p.id).eq("status", "VERIFIED").order("tanggal", { ascending: false }).limit(200);
    const m = {};
    db.usage.filter((u) => u.projectId === p.id).forEach((u) => {
      const key = (u.material || "") + "|" + (u.satuan || "");
      if (!m[key]) m[key] = { nama: u.material, satuan: u.satuan || "", qty: 0 };
      m[key].qty += Number(u.qty) || 0;
    });
    await dl(
      <ProjectPaperPDF type="REKAP" project={p} appSettings={appSettings} logoUrl={logoUrl}
        rekap={{ beritaAcara: ba || [], usageSummary: Object.values(m) }} />,
      `Rekap_${p.nama}.pdf`);
    toast("✅ Rekap diunduh");
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={{ ...S.row, marginBottom: 14, justifyContent: "space-between" }}>
        <select style={S.select} value={activeProject} onChange={(e) => setActiveProject(e.target.value)}>
          {db.projects.map((x) => (<option key={x.id} value={x.id}>{x.nama}</option>))}
        </select>
        <div style={S.row}>
          <button style={S.btnSm("ghost")} onClick={cetakInvoice}>📄 Invoice</button>
          <button style={S.btnSm("ghost")} onClick={cetakRekap}>📊 Rekap PDF</button>
        </div>
      </div>
      {(b.warn || b.crit) && (
        <div style={S.alert(!b.crit)}>⚠️ <b>{b.crit ? "OVER BUDGET" : "Mendekati RAB (≥85%)"}</b> — biaya {fmtRp(k.aktualBiaya)} dari RAB {fmtRp(p.rab)} ({Math.round(b.ratio * 100)}%). Alert WA ke Owner.</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "16px 20px", background: "linear-gradient(135deg,#15233f,#0f1b30)", border: `1px solid ${cs.border}`, borderRadius: 14 }}>
        <div style={{ fontSize: 21, fontWeight: 800, color: cs.text }}>{p.nama}</div>
        <StatusPill s={p.status} />
        <span style={S.pill("accent")}>{p.progress}%</span>
        <div style={S.spacer} />
        <Tag>{p.kategori}</Tag><Tag>{p.lokasi}</Tag>
      </div>
      <div style={S.note}>Keuangan <b>terpisah penuh</b> dari bisnis utama. Estimasi profit dari RAB; aktual profit dihitung saat SELESAI.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        <Big><L>Nilai Kontrak</L><V>{fmtRp(p.nilai)}</V></Big>
        <Big><L>DP / Diterima</L><V color="green">{fmtRp(k.dpTotal)}</V><D>sisa tagihan {fmtRp(k.sisaTagihan)}</D></Big>
        <Big><L>Estimasi Profit (RAB)</L><V color="yellow">{fmtRp(k.estProfit)}</V><D>RAB {fmtRp(p.rab)}</D></Big>
        {p.status === "SELESAI" ? (
          <Big><L>Aktual Profit (final)</L><V color="green">{fmtRp(k.aktualProfit)}</V><D>biaya final {fmtRp(k.aktualBiaya)}</D></Big>
        ) : (
          <Big><L>Biaya Terpakai / RAB</L><V color={b.crit ? "red" : "yellow"}>{fmtRp(k.aktualBiaya)}</V><D>{Math.round(b.ratio * 100)}% dari RAB · profit final saat SELESAI</D></Big>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={S.card}>
          <div style={S.between}>
            <L>DP / Pembayaran Diterima</L>
            <button style={S.btnSm()} onClick={addDP}>+ DP / Termin</button>
          </div>
          <table style={{ ...S.tableStyles.table, marginTop: 8 }}>
            <thead><tr>
              <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Keterangan</th><th style={S.tableStyles.th}>Jumlah</th>
              <th style={S.tableStyles.th}></th>
            </tr></thead>
            <tbody>
              {k.dpList.map((d, i) => (
                <tr key={i}><td style={S.tableStyles.td}>{d.tanggal}</td><td style={S.tableStyles.td}>{d.ket}</td><td style={S.tableStyles.td}>{fmtRp(d.jumlah)}</td>
                <td style={S.tableStyles.td}><div style={S.row}>
                  <button style={S.btnSm("ghost")} title="Cetak kwitansi" onClick={() => cetakKwitansi(d, i)}>🧾</button>
                  {can.delete && <button style={S.btnSm("ghost")} onClick={() => { if (window.confirm("Hapus DP/termin ini?")) deleteRow("dp", d.id); }}>🗑</button>}
                </div></td>
                </tr>
              ))}
              <tr><td style={S.tableStyles.td}></td><td style={S.tableStyles.td}><b>Total diterima</b></td><td style={S.tableStyles.td}><b style={{ color: cs.green }}>{fmtRp(k.dpTotal)}</b></td><td style={S.tableStyles.td}></td></tr>
            </tbody>
          </table>
        </div>
        <div style={S.card}>
          <L>Pengeluaran per Kelompok</L>
          <table style={S.tableStyles.table}>
            <tbody>
              {Object.entries(k.byCat).map(([c, v]) => (
                <tr key={c}>
                  <td style={S.tableStyles.td}>{c}</td>
                  <td style={{ ...S.tableStyles.td, textAlign: "right" }}>{fmtRp(v)}</td>
                  <td style={{ ...S.tableStyles.td, width: 120 }}><Bar pct={k.aktualBiaya ? Math.round(v / k.aktualBiaya * 100) : 0} color={cs.red} /></td>
                </tr>
              ))}
              <tr><td style={S.tableStyles.td}><b>Total biaya</b></td><td style={{ ...S.tableStyles.td, textAlign: "right" }}><b style={{ color: cs.red }}>{fmtRp(k.aktualBiaya)}</b></td><td style={S.tableStyles.td}></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 14 }}>
        <L>Estimasi vs Aktual</L>
        <KV l="Estimasi biaya (RAB)" v={fmtRp(p.rab)} />
        <KV l="Aktual biaya (realisasi)" v={<span style={{ color: cs.red }}>{fmtRp(k.aktualBiaya)}</span>} />
        <KV l={p.status === "SELESAI" ? "Selisih (hemat/over)" : "Sisa RAB belum terpakai"}
            v={<span style={{ color: k.aktualBiaya <= p.rab ? cs.green : cs.red }}>{fmtRp(p.rab - k.aktualBiaya)}</span>} />
        <hr style={{ border: "none", borderTop: `1px solid ${cs.border}`, margin: "8px 0" }} />
        <KV l={<b>Estimasi profit</b>} v={<b style={{ color: cs.yellow }}>{fmtRp(k.estProfit)} ({Math.round(k.estProfit / p.nilai * 100)}%)</b>} />
        {p.status === "SELESAI"
          ? <KV l={<b>Aktual profit (final)</b>} v={<b style={{ color: cs.green }}>{fmtRp(k.aktualProfit)} ({Math.round(k.aktualProfit / p.nilai * 100)}%)</b>} />
          : <KV l={<b style={S.muted}>Aktual profit</b>} v={<span style={S.muted}>dihitung saat project SELESAI</span>} />}
      </div>
    </div>
  );
}

const Big = ({ children }) => <div style={{ ...S.card, padding: 20 }}>{children}</div>;
const L = ({ children }) => <h3 style={{ fontSize: 12, color: cs.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>{children}</h3>;
const V = ({ children, color }) => <div style={{ fontSize: 30, fontWeight: 800, color: S.colorOf(color) || cs.text }}>{children}</div>;
const D = ({ children }) => <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>{children}</div>;
const KV = ({ l, v }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span style={{ color: cs.muted }}>{l}</span>{v}</div>;
