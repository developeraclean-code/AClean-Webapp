import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { calc, budget, daysLate, overBudgetProjects, pName } from "../utils/finance.js";
import { fmtRp } from "../utils/constants.js";
import { Bar } from "../components/Bits.jsx";

export default function ProjectDashboard() {
  const { db, can, today, patchRow } = useProject();
  const { toast } = useModal();

  const active = db.projects.filter((p) => p.status === "BERJALAN" || p.status === "FINISHING");
  const held = db.projects.filter((p) => p.status === "HOLD");
  const progressList = [...active, ...held];
  const totNilai = db.projects.reduce((s, p) => s + p.nilai, 0);
  let totBiaya = 0, totEst = 0;
  db.projects.forEach((p) => { const k = calc(db, p.id); totBiaya += k.aktualBiaya; totEst += k.estProfit; });
  const dpTot = db.dp.reduce((s, d) => s + d.jumlah, 0);
  const ob = overBudgetProjects(db);
  const telat = db.projects.filter((p) => daysLate(p, today) > 0);
  const unver = db.harian.filter((h) => h.status === "SUBMITTED");

  const verify = (id) => { patchRow("harian", id, { status: "VERIFIED" }); toast("Diverifikasi 🔒 hari ini terkunci"); };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Dashboard Project</h2></div>

      {(telat.length + ob.length + unver.length) > 0 && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h3 style={{ fontSize: 12, color: cs.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>
            ⚠️ Butuh Perhatian ({telat.length + ob.length + unver.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {telat.map((p) => (
              <Item key={"t" + p.id}>⏰ <b>{p.nama}</b> — telat {daysLate(p, today)} hari dari target</Item>
            ))}
            {can.finance && ob.map((p) => { const b = budget(db, p.id); return (
              <Item key={"o" + p.id}>💸 <b>{p.nama}</b> — {b.crit ? "OVER BUDGET" : "≥85% RAB"} ({Math.round(b.ratio * 100)}%) · alert WA ke Owner</Item>
            ); })}
            {unver.map((h) => (
              <Item key={"u" + h.id}>
                📝 Laporan <b>{pName(db, h.projectId)}</b> ({h.oleh}, {h.tanggal.slice(5)}) belum diverifikasi
                <span style={S.spacer} />
                {can.verify && <button style={S.btnSm("green")} onClick={() => verify(h.id)}>Verify</button>}
              </Item>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        <Card><Label>Project Aktif</Label><Val color="accent">{active.length}</Val><Delta>{held.length} hold · {db.projects.length} total</Delta></Card>
        {can.finance && <Card><Label>DP / Pembayaran Diterima</Label><Val>{fmtRp(dpTot)}</Val><Delta>dari {fmtRp(totNilai)} nilai kontrak</Delta></Card>}
        {can.finance && <Card><Label>Biaya Terealisasi</Label><Val color="red">{fmtRp(totBiaya)}</Val></Card>}
        {can.finance && <Card><Label>Estimasi Profit (RAB)</Label><Val color="green">{fmtRp(totEst)}</Val></Card>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={S.card}>
          <Label>Progress Project</Label>
          {progressList.map((p) => {
            const b = budget(db, p.id); const hold = p.status === "HOLD";
            const fill = hold ? cs.muted : p.progress >= 85 ? cs.green : p.progress < 50 ? cs.yellow : cs.accent;
            return (
              <div key={p.id} style={{ marginTop: 12 }}>
                <div style={S.between}>
                  <span>{p.nama} {hold ? <span style={S.pill("gray")}>⏸ HOLD</span> : b.crit ? <span style={S.pill("red")}>over budget</span> : b.warn ? <span style={S.pill("yellow")}>≥85% RAB</span> : null}</span>
                  <span style={S.muted}>{p.progress}%</span>
                </div>
                <Bar pct={p.progress} color={fill} />
              </div>
            );
          })}
        </div>
        <div style={S.card}>
          <Label>Laporan Harian Terbaru</Label>
          <table style={S.tableStyles.table}>
            <tbody>
              {db.harian.slice(0, 4).map((h) => (
                <tr key={h.id}>
                  <td style={S.tableStyles.td}>
                    {pName(db, h.projectId)}
                    <div style={{ ...S.muted, fontSize: 12 }}>{h.oleh} · 🌅{h.pagi?.foto || 0} 🌇{h.sore?.foto || 0} foto</div>
                  </td>
                  <td style={S.tableStyles.td}><span style={S.pill(h.status === "VERIFIED" ? "green" : h.status === "REVISI" ? "red" : "yellow")}>{h.status}</span></td>
                  <td style={{ ...S.tableStyles.td, ...S.muted }}>{h.tanggal.slice(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const Item = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "7px 10px", borderRadius: 9, background: "#0f1b30", border: `1px solid ${cs.border}` }}>{children}</div>
);
const Card = ({ children }) => <div style={S.card}>{children}</div>;
const Label = ({ children }) => <h3 style={{ fontSize: 12, color: cs.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>{children}</h3>;
const Val = ({ children, color }) => <div style={{ fontSize: 22, fontWeight: 800, color: S.colorOf(color) || cs.text }}>{children}</div>;
const Delta = ({ children }) => <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>{children}</div>;
