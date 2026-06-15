import React, { useState, useEffect } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { supabase } from "../../supabaseClient.js";
import OfficeToolModal from "../../views/OfficeToolModal.jsx";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { calc, budget, daysLate, pName, weekSummary } from "../utils/finance.js";
import { fmtRp } from "../utils/constants.js";
import { StatusPill } from "../components/Bits.jsx";
import Modal from "../components/Modal.jsx";

export default function ProjectDetailView() {
  const { db, can, today, currentUser, activeProject, setActiveProject, setActiveView, toggleHold } = useProject();
  const { openContent, close, toast } = useModal();
  const [alatMode, setAlatMode] = useState(null); // 'bawa' | 'kembali'
  const [laporanTim, setLaporanTim] = useState([]);
  const [laporanLoading, setLaporanLoading] = useState(false);

  const p = db.projects.find((x) => x.id === activeProject);

  useEffect(() => {
    if (!p?.id) return;
    let alive = true;
    setLaporanLoading(true);
    (async () => {
      try {
        const { data: projOrders } = await supabase
          .from("orders").select("id,date")
          .eq("project_id", p.id).neq("status", "CANCELLED");
        const ids = (projOrders || []).map(o => o.id);
        if (!ids.length) { if (alive) { setLaporanTim([]); setLaporanLoading(false); } return; }
        const orderDateMap = Object.fromEntries((projOrders || []).map(o => [o.id, o.date]));
        const { data: reports } = await supabase
          .from("service_reports")
          .select("id,job_id,teknisi,status,submitted_at,catatan_global,total_units,foto_urls")
          .in("job_id", ids)
          .order("submitted_at", { ascending: false });
        if (alive) setLaporanTim((reports || []).map(r => ({ ...r, orderDate: orderDateMap[r.job_id] })));
      } catch (e) { console.error("[ProjectDetail] laporan fetch gagal:", e); }
      finally { if (alive) setLaporanLoading(false); }
    })();
    return () => { alive = false; };
  }, [p?.id]);

  if (!p) {
    return (
      <div style={{ padding: 22 }}>
        <div style={S.note}>Belum ada project terpilih. Buka <b>Daftar Project</b> dulu.</div>
        <button style={S.btn()} onClick={() => setActiveView("list")}>Buka Daftar Project</button>
      </div>
    );
  }
  const k = calc(db, p.id); const b = budget(db, p.id); const late = daysLate(p, today);
  const har = db.harian.filter((h) => h.projectId === p.id);
  const last = har[0];

  const handleHold = () => { toggleHold(p.id); toast(p.status === "HOLD" ? "Project dilanjutkan" : "Project di-HOLD — tim bebas untuk job reguler"); };

  const showWeekly = () => {
    const w = weekSummary(db, p.id, today);
    openContent({
      content: (
        <Modal wide onClose={close}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, margin: 0 }}>Ringkasan Mingguan</h3>
            <span style={S.tag}>untuk customer</span>
          </div>
          <div style={{ background: "#f8fafc", color: "#0f172a", borderRadius: 8, padding: "28px 30px", fontSize: 12.5, lineHeight: 1.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #0f172a", paddingBottom: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0a3a52" }}>AClean Service AC<small style={{ display: "block", fontWeight: 400, color: "#475569", fontSize: 10.5 }}>Laporan Progress Mingguan</small></div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#475569" }}>Periode<br />{w.ws} – {today}</div>
            </div>
            <h4 style={{ textAlign: "center", fontSize: 14, margin: "6px 0 2px" }}>{p.nama}</h4>
            <div style={{ textAlign: "center", color: "#475569", marginBottom: 14, fontSize: 11 }}>{p.kategori} · {p.lokasi}</div>
            <div style={{ display: "flex", gap: 24, marginBottom: 8 }}>
              <div><b>Progress keseluruhan</b><br />{p.progress}%</div>
              {can.finance && <div><b>Biaya minggu ini</b><br />{fmtRp(w.biaya)}</div>}
              <div><b>Dokumentasi</b><br />{w.foto} foto minggu ini</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }}>
              <thead><tr><th style={paperTh}>Tgl</th><th style={paperTh}>Progress Harian</th></tr></thead>
              <tbody>{w.progress.length ? w.progress.map((x, i) => (
                <tr key={i}><td style={{ ...paperTd, width: 60 }}>{x.tgl}</td><td style={paperTd}>{x.txt}</td></tr>
              )) : <tr><td colSpan={2} style={{ ...paperTd, color: "#64748b" }}>belum ada progress minggu ini</td></tr>}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
            <button style={S.btn("ghost")} onClick={close}>Tutup</button>
            <button style={S.btn()} onClick={() => { toast("(demo) kirim ke customer / PDF"); }}>Kirim / PDF</button>
          </div>
        </Modal>
      ),
    });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={{ ...S.row, marginBottom: 14 }}>
        <select style={S.select} value={activeProject} onChange={(e) => setActiveProject(e.target.value)}>
          {db.projects.map((x) => (<option key={x.id} value={x.id}>{x.nama}</option>))}
        </select>
      </div>

      <div style={{ ...S.sectionTitle, alignItems: "center" }}>
        <h2 style={S.sectionTitleH}>{p.nama}</h2>
        <StatusPill s={p.status} />
        <span style={S.pill("accent")}>{p.progress}%</span>
        {late > 0 && <span style={S.pill("red")}>telat {late} hari</span>}
        <div style={S.spacer} />
        {p.status !== "SELESAI" && can.manage && (
          <button style={S.btnSm(p.status === "HOLD" ? "green" : "ghost")} onClick={handleHold}>
            {p.status === "HOLD" ? "▶ Lanjutkan" : "⏸ Hold"}
          </button>
        )}
        <button style={S.btnSm("ghost")} onClick={showWeekly}>📄 Ringkasan Mingguan</button>
        <button style={S.btnSm("ghost")} onClick={() => setAlatMode("bawa")}>🛠 Bawa Alat</button>
        <button style={S.btnSm("ghost")} onClick={() => setAlatMode("kembali")}>↩️ Kembali Alat</button>
      </div>

      {alatMode && (
        <OfficeToolModal
          job={{ id: p.id, nama: p.nama }}
          scope="project"
          mode={alatMode}
          onClose={() => setAlatMode(null)}
          supabase={supabase}
          currentUser={currentUser}
          showNotif={toast}
        />
      )}

      {p.status === "HOLD" && (
        <div style={S.alert(true)}>⏸ <b>Project di-HOLD</b> — tim dibebaskan untuk job reguler & laporan harian dijeda sampai dilanjutkan.</div>
      )}
      {(b.warn || b.crit) && (
        <div style={S.alert(!b.crit)}>⚠️ <b>{b.crit ? "Over budget" : "Mendekati RAB"}</b> — biaya {fmtRp(k.aktualBiaya)} / RAB {fmtRp(p.rab)} ({Math.round(b.ratio * 100)}%). Alert terkirim ke Owner.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        <Card><L>Kategori</L><V>{p.kategori}</V><D>{p.lokasi} · Survey/start {p.mulai}</D></Card>
        <Card><L>Timeline</L><V>{p.mulai} → {p.target}</V></Card>
        {can.finance && <Card><L>Nilai / DP</L><V>{fmtRp(p.nilai)}</V><D>diterima {fmtRp(k.dpTotal)}</D></Card>}
        <Card><L>Tim di Lokasi</L><V>{p.tim?.join(", ")}</V><D>PIC: {p.pic}</D></Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {can.finance && (
          <div style={S.card}>
            <L>💰 Ringkas Keuangan</L>
            <KV l="Nilai kontrak" v={<b>{fmtRp(p.nilai)}</b>} />
            <KV l="DP diterima" v={<span style={{ color: cs.green }}>{fmtRp(k.dpTotal)}</span>} />
            <KV l="Sisa tagihan" v={<span style={{ color: cs.yellow }}>{fmtRp(k.sisaTagihan)}</span>} />
            <hr style={{ border: "none", borderTop: `1px solid ${cs.border}`, margin: "8px 0" }} />
            <KV l="Biaya terpakai" v={<span style={{ color: cs.red }}>{fmtRp(k.aktualBiaya)}</span>} />
            <KV l={<b>{p.status === "SELESAI" ? "Aktual profit" : "Estimasi profit (RAB)"}</b>}
                v={<b style={{ color: cs.green }}>{fmtRp(p.status === "SELESAI" ? k.aktualProfit : k.estProfit)}</b>} />
          </div>
        )}
        <div style={S.card}>
          <L>📦 Material Terpakai</L>
          <table style={S.tableStyles.table}>
            <tbody>
              {db.usage.filter((u) => u.projectId === p.id).map((u, i) => (
                <tr key={i}><td style={S.tableStyles.td}>{u.material}</td><td style={S.tableStyles.td}>{u.qty}</td></tr>
              )) || <tr><td style={{ ...S.tableStyles.td, ...S.muted }}>belum ada</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={S.card}>
          <L>🧰 Alat di Lokasi</L>
          <table style={S.tableStyles.table}>
            <tbody>
              {db.tools.filter((t) => t.lokasi === p.id).map((t) => (
                <tr key={t.id}><td style={S.tableStyles.td}>{t.nama}</td><td style={S.tableStyles.td}><span style={S.pill("accent")}>di lokasi</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...S.card, marginTop: 14 }}>
        <div style={S.between}>
          <L>📝 Laporan Harian</L>
          <button style={S.btnSm("ghost")} onClick={() => setActiveView("harian")}>Lihat semua</button>
        </div>
        <table style={{ ...S.tableStyles.table, marginTop: 8 }}>
          <thead><tr>
            <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Oleh</th>
            <th style={S.tableStyles.th}>🌅 Pagi</th><th style={S.tableStyles.th}>🌇 Sore</th>
            <th style={S.tableStyles.th}>Status</th>
          </tr></thead>
          <tbody>
            {har.slice(0, 3).map((h) => (
              <tr key={h.id}>
                <td style={S.tableStyles.td}>{h.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}>{h.oleh}</td>
                <td style={S.tableStyles.td}>{h.pagi ? `${h.pagi.material} · ${h.pagi.foto}📷` : <span style={S.muted}>-</span>}</td>
                <td style={S.tableStyles.td}>{h.sore ? `${h.sore.material} · ${h.sore.foto}📷` : <span style={S.muted}>-</span>}</td>
                <td style={S.tableStyles.td}><StatusPill s={h.status} /></td>
              </tr>
            ))}
            {!har.length && <tr><td colSpan={5} style={{ ...S.tableStyles.td, ...S.muted }}>belum ada</td></tr>}
          </tbody>
        </table>
        {last?.sore?.progress && (
          <p style={{ marginTop: 10, color: cs.text }}><b>Progress terakhir:</b> {last.sore.progress}</p>
        )}
      </div>

      <div style={{ ...S.card, marginTop: 14 }}>
        <L>👷 Laporan Tim Teknisi</L>
        {laporanLoading ? (
          <div style={{ color: cs.muted, fontSize: 12 }}>Memuat laporan...</div>
        ) : laporanTim.length === 0 ? (
          <div style={{ color: cs.muted, fontSize: 12 }}>Belum ada laporan masuk untuk project ini</div>
        ) : (
          <table style={{ ...S.tableStyles.table, marginTop: 8 }}>
            <thead><tr>
              <th style={S.tableStyles.th}>Tgl</th>
              <th style={S.tableStyles.th}>Teknisi</th>
              <th style={S.tableStyles.th}>Status</th>
              <th style={S.tableStyles.th}>Unit</th>
              <th style={S.tableStyles.th}>Catatan</th>
              <th style={S.tableStyles.th}>Foto</th>
            </tr></thead>
            <tbody>
              {laporanTim.map(r => (
                <tr key={r.id}>
                  <td style={S.tableStyles.td}>{(r.orderDate || "").slice(5)}</td>
                  <td style={S.tableStyles.td}>{r.teknisi || "—"}</td>
                  <td style={S.tableStyles.td}><StatusPill s={r.status} /></td>
                  <td style={S.tableStyles.td}>{r.total_units ?? "—"}</td>
                  <td style={S.tableStyles.td}>{r.catatan_global || "—"}</td>
                  <td style={S.tableStyles.td}>{(r.foto_urls || []).length}📷</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const Card = ({ children }) => <div style={S.card}>{children}</div>;
const L = ({ children }) => <h3 style={{ fontSize: 12, color: cs.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>{children}</h3>;
const V = ({ children }) => <div style={{ fontWeight: 700, color: cs.text }}>{children}</div>;
const D = ({ children }) => <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>{children}</div>;
const KV = ({ l, v }) => <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span style={{ color: cs.muted }}>{l}</span>{v}</div>;
const paperTh = { border: "1px solid #cbd5e1", padding: "6px 8px", background: "#e2e8f0", color: "#0f172a", fontSize: 12 };
const paperTd = { border: "1px solid #cbd5e1", padding: "6px 8px", color: "#0f172a", fontSize: 12 };
