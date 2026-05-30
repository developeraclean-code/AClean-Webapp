import React, { useState, lazy, Suspense } from "react";
import { cs } from "../theme/cs.js";

// Sub-app standalone untuk modul Project. App.jsx hanya melakukan lazy import +
// memasang route case. Semua logic project hidup di folder ini.
const ProjectDashboard    = lazy(() => import("./views/ProjectDashboard.jsx"));
const ProjectListView     = lazy(() => import("./views/ProjectListView.jsx"));
const ProjectDetailView   = lazy(() => import("./views/ProjectDetailView.jsx"));
const ProjectHarianView   = lazy(() => import("./views/ProjectHarianView.jsx"));
const ProjectMaterialView = lazy(() => import("./views/ProjectMaterialView.jsx"));
const ProjectUsageView    = lazy(() => import("./views/ProjectUsageView.jsx"));
const ProjectToolsView    = lazy(() => import("./views/ProjectToolsView.jsx"));
const ProjectExpenseView  = lazy(() => import("./views/ProjectExpenseView.jsx"));
const ProjectPurchaseView = lazy(() => import("./views/ProjectPurchaseView.jsx"));
const ProjectFinanceView  = lazy(() => import("./views/ProjectFinanceView.jsx"));
const ProjectDocsView     = lazy(() => import("./views/ProjectDocsView.jsx"));

const MENU = [
  { id: "dashboard", label: "Dashboard",            icon: "⬡" },
  { id: "list",      label: "Daftar Project",       icon: "📁" },
  { id: "detail",    label: "Detail Project",       icon: "🔎" },
  { id: "harian",    label: "Laporan Harian",       icon: "📝", group: "Lapangan" },
  { id: "material",  label: "Stok Material",        icon: "📦", group: "Material & Alat" },
  { id: "usage",     label: "Pemakaian Material",   icon: "🧮" },
  { id: "tools",     label: "Alat Kerja",           icon: "🧰" },
  { id: "expense",   label: "Pengeluaran Harian",   icon: "💸", group: "Keuangan" },
  { id: "purchase",  label: "Pembelian Mat & Alat", icon: "🛒" },
  { id: "finance",   label: "Keuangan Project",     icon: "💰", ownerOnly: true },
  { id: "docs",      label: "Dokumen / BAST",       icon: "📄", group: "Dokumen" },
];

const VIEWS = {
  dashboard: ProjectDashboard,
  list:      ProjectListView,
  detail:    ProjectDetailView,
  harian:    ProjectHarianView,
  material:  ProjectMaterialView,
  usage:     ProjectUsageView,
  tools:     ProjectToolsView,
  expense:   ProjectExpenseView,
  purchase:  ProjectPurchaseView,
  finance:   ProjectFinanceView,
  docs:      ProjectDocsView,
};

export default function ProjectApp({ currentUser, onBack }) {
  const [active, setActive] = useState("dashboard");
  const role = currentUser?.role || "Owner";
  const isOwner = role === "Owner";

  const allowed = MENU.filter(m => !m.ownerOnly || isOwner);
  const View = VIEWS[active] || ProjectDashboard;

  let lastGroup = null;
  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 60px)", background: cs.bg, margin: -20 }}>
      <aside style={{ width: 235, background: cs.surface, borderRight: `1px solid ${cs.border}`, padding: "16px 10px", flexShrink: 0 }}>
        <div style={{ padding: "6px 10px 14px", borderBottom: `1px solid ${cs.border}`, marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Modul Project</div>
          <div style={{ fontSize: 11, color: cs.muted }}>Standalone · {role}</div>
        </div>
        <nav>
          {allowed.map(m => {
            const showGroup = m.group && m.group !== lastGroup;
            if (m.group) lastGroup = m.group;
            const isActive = active === m.id;
            return (
              <React.Fragment key={m.id}>
                {showGroup && (
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: cs.muted, padding: "12px 12px 4px" }}>
                    {m.group}
                  </div>
                )}
                <button onClick={() => setActive(m.id)}
                  style={{
                    width: "100%", textAlign: "left",
                    background: isActive ? "#15233f" : "transparent",
                    border: "none", color: isActive ? cs.accent : cs.text,
                    padding: "9px 12px", borderRadius: 10, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10, fontSize: 13,
                    fontWeight: isActive ? 700 : 400, marginBottom: 2,
                  }}>
                  <span style={{ width: 18, textAlign: "center" }}>{m.icon}</span> {m.label}
                </button>
              </React.Fragment>
            );
          })}
          <div style={{ marginTop: 14, borderTop: `1px solid ${cs.border}`, paddingTop: 12 }}>
            <button onClick={onBack}
              style={{
                width: "100%", textAlign: "left", background: "transparent", border: "none",
                color: cs.muted, padding: "9px 12px", borderRadius: 10, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10, fontSize: 13,
              }}>
              <span style={{ width: 18, textAlign: "center" }}>←</span> Kembali ke App Utama
            </button>
          </div>
        </nav>
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <Suspense fallback={<div style={{ padding: 22, color: cs.muted }}>Memuat…</div>}>
          <View currentUser={currentUser} />
        </Suspense>
      </main>
    </div>
  );
}
