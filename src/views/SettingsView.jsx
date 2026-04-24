import { memo, useState } from "react";
import { cs } from "../theme/cs.js";

// ── Role config ──────────────────────────────────────────────────────────────
const ROLE_CFG = {
  Owner:   { icon: "👑", color: "#f59e0b" },
  Admin:   { icon: "🛠️", color: "#38bdf8" },
  Teknisi: { icon: "👷", color: "#22c55e" },
  Helper:  { icon: "🤝", color: "#a78bfa" },
};

// ── Section divider ──────────────────────────────────────────────────────────
function SectionLabel({ icon, label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      borderTop: "1px solid " + cs.border, paddingTop: 10, marginTop: 4,
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 800, color: cs.muted, textTransform: "uppercase", letterSpacing: "1.2px" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: cs.border }} />
    </div>
  );
}

// ── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20, ...style }}>
      {children}
    </div>
  );
}

// ── Card header row ──────────────────────────────────────────────────────────
function CardHeader({ icon, title, subtitle, badge, badgeColor }) {
  const bc = badgeColor || cs.green;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 26 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {badge && (
        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: bc + "22", color: bc, border: "1px solid " + bc + "44", fontWeight: 700, whiteSpace: "nowrap" }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── User Management Panel ────────────────────────────────────────────────────
function UserManagementPanel({ userAccounts, setUserAccounts, setTeknisiData, currentUser, setNewUserForm, setModalAddUser, setEditPwdTarget, setEditPwdForm, setModalEditPwd, showNotif, showConfirm, addAgentLog, _apiHeaders }) {
  const [tabFilter, setTabFilter] = useState("Semua");
  const tabs = ["Semua", "Owner", "Admin", "Teknisi", "Helper"];
  const filtered = tabFilter === "Semua" ? userAccounts : userAccounts.filter(u => u.role === tabFilter);

  const handleToggleActive = async (u) => {
    const willActivate = u.active === false;
    const label = willActivate ? "Aktifkan" : "Nonaktifkan";
    const ok = await showConfirm({ icon: willActivate ? "🔓" : "🔒", title: label + " akun?", danger: !willActivate, message: `${label} akun ${u.name}?\n${willActivate ? "User bisa login kembali." : "User tidak bisa login sampai diaktifkan."}`, confirmText: label });
    if (!ok) return;
    const callerRole = currentUser?.role || (() => {
      try { return JSON.parse(localStorage.getItem("localSession") || "{}")?.role || ""; } catch { return ""; }
    })();
    const res = await fetch("/api/manage-user", { method: "POST", headers: _apiHeaders(), body: JSON.stringify({ action: "toggle-active", userId: u.id, active: willActivate, callerRole }) });
    const data = await res.json();
    if (!data.ok) { showNotif("⚠️ " + (data.error || "Gagal")); return; }
    setUserAccounts(prev => prev.map(acc => acc.id === u.id ? { ...acc, active: willActivate } : acc));
    if (["Teknisi", "Helper"].includes(u.role) && setTeknisiData) {
      setTeknisiData(prev => prev.map(t => t.id === u.id ? { ...t, status: willActivate ? "active" : "inactive" } : t));
    }
    addAgentLog(willActivate ? "USER_ACTIVATED" : "USER_DEACTIVATED", `Akun ${u.name} ${willActivate ? "diaktifkan" : "dinonaktifkan"}`, "WARNING");
    showNotif((willActivate ? "🔓 Diaktifkan: " : "🔒 Dinonaktifkan: ") + u.name);
  };

  return (
    <Card>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>👥 Manajemen Akun Pengguna</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
            <span style={{ background: cs.accent + "22", color: cs.accent, borderRadius: 99, padding: "2px 8px", fontWeight: 700, marginRight: 6 }}>{userAccounts.length}</span>
            user terdaftar — tambah langsung aktif tanpa konfirmasi email
          </div>
        </div>
        <button
          onClick={() => { setNewUserForm({ name: "", email: "", role: "Teknisi", password: "", phone: "" }); setModalAddUser(true); }}
          style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
          + Tambah User
        </button>
      </div>

      {/* Tab filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {tabs.map(tab => {
          const count = tab === "Semua" ? userAccounts.length : userAccounts.filter(u => u.role === tab).length;
          const rc = ROLE_CFG[tab];
          const active = tabFilter === tab;
          return (
            <button key={tab} onClick={() => setTabFilter(tab)}
              style={{ background: active ? (rc?.color || cs.accent) + "20" : cs.surface, border: "1px solid " + (active ? (rc?.color || cs.accent) : cs.border), borderRadius: 99, padding: "5px 13px", cursor: "pointer", fontSize: 11, fontWeight: active ? 800 : 500, color: active ? (rc?.color || cs.accent) : cs.muted, transition: "all .15s" }}>
              {rc?.icon || ""} {tab}
              <span style={{ marginLeft: 5, background: active ? (rc?.color || cs.accent) + "33" : cs.border, color: active ? (rc?.color || cs.accent) : cs.muted, borderRadius: 99, padding: "0 6px", fontSize: 10, fontWeight: 800 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* User list */}
      <div style={{ display: "grid", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: "24px 0" }}>
            Tidak ada user dengan role {tabFilter}
          </div>
        )}
        {filtered.map(u => {
          const rc = ROLE_CFG[u.role] || { icon: "👤", color: cs.muted };
          const isActive = u.active !== false;
          return (
            <div key={u.id} style={{
              background: cs.surface,
              border: "1px solid " + (isActive ? cs.border : cs.red + "44"),
              borderRadius: 12, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 12,
              opacity: isActive ? 1 : 0.7, transition: "all .2s"
            }}>
              {/* Avatar */}
              <div style={{
                width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                background: "linear-gradient(135deg," + rc.color + "dd," + rc.color + "66)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 18, color: "#fff",
                boxShadow: "0 2px 8px " + rc.color + "44",
                opacity: isActive ? 1 : 0.5,
              }}>
                {(u.name || "?").charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, color: isActive ? cs.text : cs.muted, fontSize: 13 }}>{u.name}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: rc.color + "20", color: rc.color, fontWeight: 700, border: "1px solid " + rc.color + "30" }}>
                    {rc.icon} {u.role}
                  </span>
                  {!isActive && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: cs.red + "20", color: cs.red, fontWeight: 700 }}>🔒 Nonaktif</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.email || "—"}{u.phone ? " · " + u.phone : ""}{u.lastLogin ? " · Login: " + u.lastLogin : ""}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                {u.role !== "Owner" && (
                  <button onClick={() => { setNewUserForm({ ...u, password: "" }); setModalAddUser(true); }}
                    title="Edit"
                    style={{ background: cs.accent + "15", border: "1px solid " + cs.accent + "30", color: cs.accent, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✏️</button>
                )}
                {currentUser?.role === "Owner" && u.role !== "Owner" && (
                  <button onClick={() => { setEditPwdTarget({ id: u.id, name: u.name }); setEditPwdForm({ newPwd: "", confirmPwd: "" }); setModalEditPwd(true); }}
                    title="Ganti Password"
                    style={{ background: "#f59e0b15", border: "1px solid #f59e0b30", color: "#f59e0b", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>🔑</button>
                )}
                {u.role !== "Owner" && (
                  <button onClick={() => handleToggleActive(u)}
                    title={isActive ? "Nonaktifkan" : "Aktifkan"}
                    style={{ background: isActive ? cs.red + "15" : "#22c55e15", border: "1px solid " + (isActive ? cs.red : "#22c55e") + "40", color: isActive ? cs.red : "#22c55e", padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    {isActive ? "🔒" : "🔓"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Main SettingsView ────────────────────────────────────────────────────────
function SettingsView({
  currentUser, isMobile, appSettings, setAppSettings,
  waProvider, setWaProvider, waToken, setWaToken, waDevice, setWaDevice, waStatus, setWaStatus,
  llmProvider, setLlmProvider, llmModel, setLlmModel, llmApiKey, setLlmApiKey,
  ollamaUrl, setOllamaUrl, llmStatus, setLlmStatus,
  storageProvider, brainMd, brainMdCustomer,
  dbProvider, setDbProvider, cronJobs, setCronJobs,
  userAccounts, setUserAccounts, teknisiData, setTeknisiData,
  dbHealthData, setDbHealthData, dbHealthLoading, setDbHealthLoading,
  vacuumLoading, setVacuumLoading,
  setModalBrainEdit, setModalBrainCustomerEdit,
  setNewUserForm, setModalAddUser,
  setEditPwdTarget, setEditPwdForm, setModalEditPwd,
  showNotif, showConfirm, addAgentLog, _apiHeaders, _ls, supabase,
}) {

  // ── LLM Providers (Owner view: hanya Anthropic + Minimax) ─────────────────
  // Model dibatasi 1 per provider — otomatis terset saat ganti provider
  const LLM_PROVIDERS = [
    {
      id: "claude", label: "Anthropic Claude", icon: "🟣", default: true,
      defaultModel: "claude-haiku-4-5-20251001",
      models: ["claude-haiku-4-5-20251001"],
      fields: [{ k: "key", label: "API Key", ph: "sk-ant-api03-...", t: "password" }],
      guide: ["Buka console.anthropic.com", "API Keys → Create Key", "Copy key, paste di sini"],
      note: "Default ARA Brain · claude-haiku-4-5-20251001 — cepat & hemat kredit",
    },
    {
      id: "minimax", label: "Minimax", icon: "🟦", default: false,
      defaultModel: "MiniMax-M2.5",
      models: ["MiniMax-M2.5"],
      fields: [
        { k: "key", label: "API Key", ph: "eyJhbGci...", t: "password" },
        { k: "group_id", label: "Group ID", ph: "1234567890" },
      ],
      guide: ["Buka platform.minimaxi.com", "API → API Keys → Create", "Copy API Key & Group ID, paste di sini"],
      note: "MiniMax-M2.5",
    },
  ];

  // LLM Admin view (hanya pilih provider, tidak perlu konfigurasi key)
  const LLM_PROVIDERS_ADMIN = [
    { id: "minimax", label: "Minimax" },
    { id: "claude", label: "Anthropic Claude" },
    { id: "openai", label: "ChatGPT (OpenAI)" },
    { id: "groq", label: "Groq" },
    { id: "ollama", label: "Ollama (Lokal/Free)" },
  ];

  const activeLLM = LLM_PROVIDERS.find(p => p.id === llmProvider) || LLM_PROVIDERS[0];
  const waSC = waStatus === "connected" ? cs.green : waStatus === "testing" ? cs.yellow : cs.muted;
  const llmSC = llmStatus === "connected" ? cs.green : llmStatus === "testing" ? cs.yellow : cs.muted;

  const waStatusLabel = waStatus === "connected" ? "● Connected" : waStatus === "testing" ? "● Testing..." : "● Not Connected";
  const llmStatusLabel = llmStatus === "connected" ? "● Connected" : llmStatus === "testing" ? "● Testing..." : "● Not Connected";

  // Field getter/setter untuk Fonnte
  const waFieldMap = {
    token: { val: waToken, set: e => setWaToken(e.target.value) },
    device: { val: waDevice, set: e => setWaDevice(e.target.value) },
  };

  const FonnteFields = () => (
    <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
      {[
        { k: "token", label: "API Token", ph: "fnt_••••••••", t: "password" },
        { k: "device", label: "Device / No WA", ph: "6281299898937", t: "text" },
      ].map(f => {
        const val = waFieldMap[f.k]?.val || "";
        return (
          <div key={f.k}>
            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3, fontWeight: 600 }}>{f.label}</div>
            <input
              type={f.t || "text"} placeholder={f.ph} value={val}
              onChange={waFieldMap[f.k]?.set}
              style={{ width: "100%", background: cs.surface, border: "1px solid " + (val ? cs.green : cs.border), borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            {val && <div style={{ fontSize: 10, color: cs.green, marginTop: 3 }}>✓ {f.label} tersimpan</div>}
          </div>
        );
      })}
    </div>
  );

  const LLMFields = () => {
    const fields = activeLLM.fields;
    return (
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {fields.map(f => {
          const isKey = f.k === "key";
          const isGroupId = f.k === "group_id";
          const val = isKey ? llmApiKey : isGroupId ? (localStorage.getItem("llmGroupId") || "") : "";
          const setter = isKey ? (e => setLlmApiKey(e.target.value)) : isGroupId ? (e => localStorage.setItem("llmGroupId", e.target.value)) : undefined;
          return (
            <div key={f.k}>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3, fontWeight: 600 }}>{f.label}</div>
              <input
                type={f.t || "text"} placeholder={f.ph} value={val}
                onChange={setter}
                style={{ width: "100%", background: cs.surface, border: "1px solid " + (val ? cs.green : cs.border), borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
              {val && <div style={{ fontSize: 10, color: cs.green, marginTop: 3 }}>✓ {f.label} tersimpan</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const GuideBox = ({ guide, title }) => (
    <div style={{ background: "#0ea5e910", border: "1px solid #0ea5e930", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#7dd3fc", marginBottom: 6 }}>📋 {title}</div>
      {guide.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3, fontSize: 11, color: cs.muted }}>
          <span style={{ color: cs.accent, fontWeight: 800, minWidth: 14 }}>{i + 1}.</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );

  const testLLM = async () => {
    if (!llmApiKey && llmProvider !== "ollama") { showNotif("❌ Masukkan API Key dulu"); return; }
    setLlmStatus("testing");
    try {
      const type = llmProvider === "minimax" ? "minimax" : "llm";
      const r = await fetch("/api/test-connection?type=" + type, { headers: _apiHeaders() });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || d.message || "Test gagal");
      setLlmStatus("connected");
      showNotif("✅ Koneksi " + activeLLM.label + (llmModel ? " (" + llmModel + ")" : "") + " berhasil!");
    } catch (e) {
      setLlmStatus("not_connected");
      showNotif("❌ Koneksi gagal: " + e.message);
    }
  };

  const testWA = async () => {
    setWaStatus("testing");
    try {
      const r = await fetch("/api/test-connection", { method: "POST", headers: _apiHeaders(), body: JSON.stringify({ type: "wa", provider: "fonnte", token: waToken, device: waDevice }) });
      const d = await r.json();
      setWaStatus(d.success ? "connected" : "not_connected");
      showNotif(d.message);
    } catch (e) {
      setWaStatus("not_connected");
      showNotif("❌ " + e.message);
    }
  };

  const refreshDbHealth = async () => {
    setDbHealthLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_dead_rows_stats");
      if (error) throw new Error(error.message);
      if (data) setDbHealthData(data);
      else showNotif("⚠️ Data kosong — tidak ada tabel yang terdeteksi");
    } catch (e) {
      showNotif("❌ Gagal load health data: " + e.message);
    } finally {
      setDbHealthLoading(false);
    }
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>⚙️ Pengaturan Sistem</div>

      {/* ── ADMIN: info read-only, tidak bisa ubah provider ── */}
      {currentUser?.role === "Admin" && (() => {
        const providerLabel = llmProvider === "minimax" ? "Minimax" : llmProvider === "claude" ? "Anthropic Claude" : llmProvider;
        const modelLabel = llmModel || (llmProvider === "minimax" ? "MiniMax-M2.5" : "claude-haiku-4-5-20251001");
        return (
          <Card>
            <CardHeader icon="🤖" title="ARA Brain — Status" subtitle="Provider & model diatur oleh Owner"
              badge={llmStatusLabel} badgeColor={llmSC} />
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6, fontWeight: 600 }}>Provider Aktif</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: cs.text }}>{providerLabel}</div>
              <div style={{ fontSize: 11, color: cs.accent, marginTop: 4, fontFamily: "monospace" }}>{modelLabel}</div>
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>🔒 Hanya Owner yang dapat mengubah provider & model ARA</div>
            </div>
          </Card>
        );
      })()}

      {currentUser?.role !== "Owner" && (
        <div style={{ background: cs.red + "12", border: "1px solid " + cs.red + "33", borderRadius: 12, padding: "14px 18px", fontSize: 13, color: cs.red }}>
          🔒 Pengaturan lengkap hanya dapat diakses oleh Owner. Admin hanya bisa mengatur koneksi ARA di atas.
        </div>
      )}

      {currentUser?.role === "Owner" && (<>

        {/* ══ BISNIS ══════════════════════════════════════════════════════════ */}
        <SectionLabel icon="🏢" label="Bisnis" />

        {/* Informasi Perusahaan */}
        <Card>
          <CardHeader icon="🏢" title="Informasi Perusahaan & Rekening" subtitle="Data perusahaan yang tampil di invoice dan WA" />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            {[
              { key: "company_name", label: "Nama Perusahaan", ph: "Contoh: AClean Service", icon: "🏢" },
              { key: "company_addr", label: "Alamat Perusahaan", ph: "Jl. Sudirman No.1, Jakarta", icon: "📍" },
              { key: "wa_number", label: "No. WA Perusahaan", ph: "62812xxxxxxxx (tanpa +)", icon: "📱" },
              { key: "bank_name", label: "Nama Bank", ph: "Contoh: BCA", icon: "🏦" },
              { key: "bank_number", label: "No. Rekening", ph: "Contoh: 1234567890", icon: "💳" },
              { key: "bank_holder", label: "Atas Nama", ph: "Nama pemilik rekening", icon: "👤" },
            ].map(field => (
              <div key={field.key}>
                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 5, fontWeight: 600 }}>{field.icon} {field.label}</div>
                <input
                  value={appSettings[field.key] || ""}
                  onChange={e => setAppSettings(prev => ({ ...prev, [field.key]: e.target.value }))}
                  onBlur={async e => {
                    try { await supabase.from("app_settings").upsert({ key: field.key, value: e.target.value.trim() }, { onConflict: "key" }); }
                    catch (err) { console.warn("settings err:", err); }
                  }}
                  placeholder={field.ph}
                  style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
          <button
            onClick={async () => {
              try {
                await Promise.all(
                  ["company_name", "company_addr", "wa_number", "bank_name", "bank_number", "bank_holder"]
                    .map(k => supabase.from("app_settings").upsert({ key: k, value: appSettings[k] || "" }, { onConflict: "key" }))
                );
                showNotif("✅ Informasi perusahaan tersimpan!");
                addAgentLog("SETTINGS_SAVED", "Company info saved", "SUCCESS");
              } catch (e) { showNotif("❌ Gagal simpan: " + e.message); }
            }}
            style={{ marginTop: 14, padding: "9px 20px", borderRadius: 9, background: "linear-gradient(135deg," + cs.accent + ",#1d4ed8)", color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>
            💾 Simpan Perubahan
          </button>
        </Card>

        {/* WhatsApp — Fonnte only */}
        <Card>
          <CardHeader icon="📱" title="WhatsApp Gateway — Fonnte" subtitle="Gateway WA untuk kirim & terima pesan ARA"
            badge={waStatusLabel} badgeColor={waSC} />

          {/* Fonnte info badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#22c55e10", border: "1px solid #22c55e30", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>🟢</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>Fonnte</div>
              <div style={{ fontSize: 11, color: cs.muted }}>WA Gateway lokal Indonesia — aktif digunakan</div>
            </div>
            <span style={{ fontSize: 10, background: "#22c55e22", color: "#22c55e", border: "1px solid #22c55e44", borderRadius: 99, padding: "3px 9px", fontWeight: 800 }}>AKTIF</span>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>🔑 Kredensial Fonnte</div>
          <FonnteFields />

          <GuideBox guide={[
            "Login fonnte.com → menu Device",
            "Klik + Add Device, scan QR WA HP kamu",
            "Klik nama device → salin TOKEN di halaman detail device (bukan dari Profile!)",
            "Paste token di kolom API Token di sini → klik Test & Simpan",
            "Webhook (bot balas otomatis): butuh paket berbayar Fonnte",
          ]} title="Setup Fonnte" />

          {/* Webhook info */}
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 11, color: cs.muted }}>
            📥 Webhook URL untuk bot ARA (butuh paket berbayar Fonnte):<br />
            <span style={{ color: cs.accent, fontFamily: "monospace", fontSize: 12 }}>https://a-clean-webapp.vercel.app/api/fonnte-webhook</span>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={testWA}
              style={{ flex: 2, background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              {waStatus === "testing" ? "⏳ Testing..." : "🔌 Test & Simpan Koneksi"}
            </button>
            <button onClick={() => { setWaStatus("not_connected"); showNotif("Koneksi WA direset"); }}
              style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Reset</button>
          </div>
        </Card>

        {/* ══ AI & BRAIN ══════════════════════════════════════════════════════ */}
        <SectionLabel icon="🤖" label="AI & Brain" />

        {/* ARA Brain LLM */}
        <Card>
          <CardHeader icon="🤖" title="ARA Brain — LLM Provider" subtitle="Model AI yang menjalankan ARA · Minimax sebagai default"
            badge={llmStatusLabel} badgeColor={llmSC} />

          {/* Provider picker — 2 opsi saja */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            {LLM_PROVIDERS.map(p => (
              <div key={p.id} onClick={() => {
                setLlmProvider(p.id);
                setLlmModel(p.defaultModel); // auto-set model yang sesuai
                setLlmStatus("not_connected");
                const savedKey = _ls("llmApiKey_" + p.id, "") || _ls("llmApiKey", "");
                setLlmApiKey(savedKey);
              }}
                style={{
                  background: llmProvider === p.id ? cs.accent + "12" : cs.surface,
                  border: "2px solid " + (llmProvider === p.id ? cs.accent : cs.border),
                  borderRadius: 12, padding: "14px 10px", cursor: "pointer", textAlign: "center", position: "relative",
                  transition: "all .15s",
                }}>
                {p.default && (
                  <div style={{ position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)", background: cs.green, color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>DEFAULT</div>
                )}
                <div style={{ fontSize: 24, marginBottom: 5 }}>{p.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: llmProvider === p.id ? cs.accent : cs.text }}>{p.label}</div>
              </div>
            ))}
          </div>

          {/* Model selector */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Model</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {activeLLM.models.map(m => (
                <span key={m} onClick={() => setLlmModel(m)}
                  style={{ padding: "5px 11px", borderRadius: 7, background: llmModel === m ? cs.accent + "22" : cs.surface, border: "1px solid " + (llmModel === m ? cs.accent : cs.border), fontSize: 11, color: llmModel === m ? cs.accent : cs.muted, fontFamily: "monospace", cursor: "pointer" }}>
                  {m}
                </span>
              ))}
            </div>
            {activeLLM.note && <div style={{ marginTop: 6, fontSize: 11, color: cs.accent }}>💡 {activeLLM.note}</div>}
          </div>

          {/* Credential fields */}
          <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>🔑 Kredensial {activeLLM.label}</div>
          <LLMFields />
          <GuideBox guide={activeLLM.guide} title={"Cara dapat API Key — " + activeLLM.label} />

          {/* Brain.md preview */}
          <div style={{ background: cs.ara + "08", border: "1px solid " + cs.ara + "33", borderRadius: 11, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 800, color: cs.ara, fontSize: 13 }}>🧠 Brain.md — Memori ARA (Permanen)</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Tertanam di semua provider. Ganti LLM apapun, Brain.md tetap terbaca.</div>
              </div>
              <button onClick={() => setModalBrainEdit(true)}
                style={{ background: cs.ara + "22", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                ✏️ Edit Brain
              </button>
            </div>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 11, color: cs.muted, maxHeight: 120, overflow: "auto", fontFamily: "monospace", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {(typeof brainMd === "string" ? brainMd : "").slice(0, 500)}{(typeof brainMd === "string" && brainMd.length > 500) ? "..." : ""}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: cs.muted }}>
              <span>📝 {(typeof brainMd === "string" ? brainMd : "").split("\n").length} baris</span>
              <span>🔤 {typeof brainMd === "string" ? brainMd.length : 0} karakter</span>
              <span style={{ color: cs.green }}>✅ Dikirim ke {activeLLM.label}</span>
            </div>
          </div>

          {/* Brain Customer */}
          <div style={{ background: "#22c55e08", border: "1px solid #22c55e33", borderRadius: 11, padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 800, color: "#22c55e", fontSize: 13 }}>💬 Brain Customer — ARA WA Bot</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>System prompt khusus customer via WhatsApp — terpisah dari Brain internal.</div>
              </div>
              <button onClick={() => setModalBrainCustomerEdit(true)}
                style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                ✏️ Edit
              </button>
            </div>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 11, color: cs.muted, fontFamily: "monospace", maxHeight: 70, overflow: "hidden", lineHeight: 1.6 }}>
              {brainMdCustomer
                ? brainMdCustomer.slice(0, 300) + (brainMdCustomer.length > 300 ? "..." : "")
                : <span style={{ color: cs.yellow }}>⚠️ Belum diisi — klik Edit untuk mengisi Brain Customer Bot</span>
              }
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: cs.muted }}>
              <span>📝 {brainMdCustomer.split("\n").length} baris</span>
              <span>🔤 {brainMdCustomer.length} karakter</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={testLLM}
              style={{ flex: 2, background: "linear-gradient(135deg," + cs.ara + ",#7c3aed)", border: "none", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              {llmStatus === "testing" ? "⏳ Testing..." : "🔌 Test & Simpan — " + activeLLM.label}
            </button>
            <button onClick={() => { setLlmStatus("not_connected"); showNotif("Koneksi LLM direset"); }}
              style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Reset</button>
          </div>
        </Card>

        {/* ARA Training Rules */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>🧠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>ARA Training Rules</div>
              <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Upload file JSON training untuk melatih respons ARA — tersimpan di Supabase</div>
            </div>
            <a href="#" onClick={async (e) => {
              e.preventDefault();
              const { data: d } = await supabase.from("app_settings").select("value").eq("key", "ara_training_rules").single();
              if (d?.value) { const blob = new Blob([d.value], { type: "application/json" }); const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = "ara_rules.json"; a.click(); }
            }} style={{ fontSize: 11, color: cs.accent, textDecoration: "none" }}>⬇️ Download JSON</a>
          </div>

          {/* Stats */}
          {(() => {
            try {
              const raw = appSettings.ara_training_rules;
              if (!raw || raw === "{}") return null;
              const d = typeof raw === "string" ? JSON.parse(raw) : raw;
              const rules = (d.auto_reply_rules || []).length;
              const scenarios = (d.ara_training_scenarios || []).length;
              const troubles = (d.trouble_cases || []).length;
              if (!rules && !scenarios && !troubles) return null;
              return (
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  {[["🔁 Auto-Reply Rules", rules, cs.accent], ["🎭 Scenarios", scenarios, cs.green], ["⚠️ Trouble Cases", troubles, cs.yellow]].map(([label, count, color]) => (
                    <div key={label} style={{ background: color + "18", border: "1px solid " + color + "44", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: color, fontWeight: 700 }}>
                      {label}: {count}
                    </div>
                  ))}
                </div>
              );
            } catch (_) { return null; }
          })()}

          <div style={{ border: "2px dashed " + cs.border, borderRadius: 10, padding: 16, textAlign: "center", background: cs.surface }}>
            <div style={{ fontSize: 13, color: cs.muted, marginBottom: 10 }}>📂 Upload file JSON training</div>
            <input type="file" accept=".json" id="ara-training-upload" style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                showNotif("⏳ Membaca file training...");
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  const val = JSON.stringify(parsed);
                  await supabase.from("app_settings").upsert({ key: "ara_training_rules", value: val }, { onConflict: "key" });
                  setAppSettings(prev => ({ ...prev, ara_training_rules: val }));
                  const rules = (parsed.auto_reply_rules || []).length;
                  const sc = (parsed.ara_training_scenarios || []).length;
                  showNotif("✅ Training rules diupload: " + rules + " rules, " + sc + " scenarios");
                } catch (err) { showNotif("❌ Error baca file: " + err.message); }
                e.target.value = "";
              }} />
            <button onClick={() => document.getElementById("ara-training-upload").click()}
              style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: "10px 24px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              📤 Upload Training File
            </button>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>Format: .json (dari sheet "JSON Preview" di file Excel)</div>
          </div>

          <div style={{ marginTop: 12, padding: "10px 14px", background: cs.green + "12", border: "1px solid " + cs.green + "33", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16 }}>🔄</span>
            <div style={{ flex: 1, fontSize: 11, color: cs.muted }}>Rules yang diupload otomatis digunakan ARA saat membalas pesan WA.</div>
            <button onClick={async () => {
              const { data: d } = await supabase.from("app_settings").select("value").eq("key", "ara_training_rules").single();
              if (d?.value) { setAppSettings(prev => ({ ...prev, ara_training_rules: d.value })); showNotif("✅ Rules ARA disync dari Supabase"); }
            }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
              🔄 Sync
            </button>
          </div>
        </Card>

        {/* ══ OTOMASI ═════════════════════════════════════════════════════════ */}
        <SectionLabel icon="⚙️" label="Otomasi" />

        {/* WA Auto-Reply */}
        <Card>
          <CardHeader icon="💬" title="Pengaturan WA Auto-Reply" subtitle="Kontrol auto-reply & notifikasi masuk tanpa ubah kode" />
          {[
            { key: "wa_autoreply_enabled", label: "Auto-Reply Aktif", desc: "Balas pesan customer otomatis berdasarkan keyword (halo, harga, order, dll)", icon: "🤖" },
            { key: "wa_forward_to_owner", label: "Forward ke Owner", desc: "Teruskan semua pesan WA masuk ke nomor Owner sebagai notifikasi", icon: "📨" },
            { key: "wa_chatbot_enabled", label: "ARA Chatbot Customer", desc: "ARA balas WA customer secara AI (terima order, info harga, komplain). Keyword auto-reply tetap jadi fallback jika ARA gagal.", icon: "🧠" },
            { key: "wa_payment_detect", label: "Deteksi Bukti Bayar", desc: "Deteksi otomatis pesan/foto bukti transfer dari customer, beri notif konfirmasi ke admin", icon: "💳" },
            { key: "wa_cleanup_enabled", label: "Auto-Cleanup Chat (14 Hari)", desc: "Hapus otomatis riwayat chat WA yang lebih dari 14 hari. Phone dengan bukti bayar PENDING tetap dilindungi.", icon: "🗑️" },
          ].map(({ key, label, desc, icon }) => {
            const isOn = appSettings[key] === "true";
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid " + cs.border }}>
                <span style={{ fontSize: 18, minWidth: 24 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: isOn ? cs.text : cs.muted, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{desc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isOn ? cs.green : cs.muted, minWidth: 24 }}>{isOn ? "ON" : "OFF"}</span>
                  <div onClick={async () => {
                    const newVal = isOn ? "false" : "true";
                    setAppSettings(prev => ({ ...prev, [key]: newVal }));
                    await supabase.from("app_settings").upsert({ key, value: newVal }, { onConflict: "key" });
                    showNotif((isOn ? "⛔ " : "✅ ") + label + (isOn ? " dimatikan" : " diaktifkan"));
                  }}
                    style={{ width: 44, height: 24, borderRadius: 99, background: isOn ? "linear-gradient(135deg," + cs.green + ",#059669)" : cs.surface, border: "1px solid " + (isOn ? cs.green : cs.border), cursor: "pointer", position: "relative", transition: "all .2s" }}>
                    <div style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 2, left: isOn ? 22 : 2, transition: "left .2s", boxShadow: "0 1px 3px #0004" }} />
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: "10px 12px", background: cs.surface, borderRadius: 8, fontSize: 11, color: cs.muted }}>
            💡 <b>Mode aman:</b> Auto-Reply <b>OFF</b> + Forward <b>ON</b> = pesan diteruskan ke Owner, dibalas manual.
          </div>
        </Card>

        {/* Cron Jobs */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>⏰</span>
              <div>
                <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>Otomasi & Cron Jobs</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Tugas terjadwal otomatis — toggle ON/OFF untuk aktifkan</div>
              </div>
            </div>
            <button onClick={async () => {
              const newJob = { id: Date.now(), name: "Job Baru", icon: "⚙️", time: "09:00", days: "Setiap Hari", active: false, backendKey: null, task: "Deskripsi tugas..." };
              const upd = [...cronJobs, newJob];
              setCronJobs(upd);
              await supabase.from("app_settings").upsert({ key: "cron_jobs", value: JSON.stringify(upd) }, { onConflict: "key" });
            }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              + Tambah Job
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {cronJobs.map((job, idx) => (
              <div key={job.id} style={{ background: cs.surface, border: "1px solid " + (job.active ? cs.green + "66" : cs.border), borderRadius: 10, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center", opacity: job.active ? 1 : 0.65, transition: "all .2s" }}>
                <span style={{ fontSize: 20, minWidth: 28, textAlign: "center" }}>{job.icon || "⚙️"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: job.active ? cs.text : cs.muted, fontSize: 13, marginBottom: 2 }}>{job.name}</div>
                  <div style={{ fontSize: 11, color: cs.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>🕐 {job.time} WIB</span>
                    <span>·</span>
                    <span>📆 {job.days}</span>
                    <span>·</span>
                    <span>{job.task}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: job.active ? cs.green : cs.muted, minWidth: 24 }}>{job.active ? "ON" : "OFF"}</span>
                  <div onClick={async () => {
                    const upd = cronJobs.map((j, ii) => ii === idx ? { ...j, active: !j.active } : j);
                    setCronJobs(upd);
                    await supabase.from("app_settings").upsert({ key: "cron_jobs", value: JSON.stringify(upd) }, { onConflict: "key" });
                    if (job.backendKey) await supabase.from("app_settings").upsert({ key: job.backendKey, value: job.active ? "false" : "true" }, { onConflict: "key" });
                    showNotif((job.active ? "⛔ " : "✅ ") + job.name + (job.active ? " dimatikan" : " diaktifkan"));
                  }}
                    style={{ width: 44, height: 24, borderRadius: 99, background: job.active ? "linear-gradient(135deg," + cs.green + ",#059669)" : cs.surface, border: "1px solid " + (job.active ? cs.green : cs.border), cursor: "pointer", position: "relative", transition: "all .2s" }}>
                    <div style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 2, left: job.active ? 22 : 2, transition: "left .2s", boxShadow: "0 1px 3px #0004" }} />
                  </div>
                  {!job.backendKey && (
                    <button onClick={async () => {
                      const upd = cronJobs.filter((_, ii) => ii !== idx);
                      setCronJobs(upd);
                      await supabase.from("app_settings").upsert({ key: "cron_jobs", value: JSON.stringify(upd) }, { onConflict: "key" });
                    }} style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "10px 12px", background: cs.surface, borderRadius: 8, fontSize: 11, color: cs.muted }}>
            💡 Job dengan ikon kunci (📨 📊 ⚠️) terhubung ke backend cron server. Job custom (⚙️) hanya catatan jadwal.
          </div>
        </Card>

        {/* ══ SISTEM ══════════════════════════════════════════════════════════ */}
        <SectionLabel icon="🗄️" label="Sistem" />

        {/* Database — info only */}
        <Card>
          <CardHeader icon="🗄️" title="Database" subtitle="Provider database aktif yang digunakan sistem"
            badge="● Connected" badgeColor={cs.green} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>⚡</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>Supabase (PostgreSQL)</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Managed PostgreSQL · Real-time · Row Level Security aktif</div>
            </div>
            <span style={{ fontSize: 10, background: cs.green + "22", color: cs.green, border: "1px solid " + cs.green + "44", borderRadius: 99, padding: "3px 9px", fontWeight: 800 }}>AKTIF</span>
          </div>
          <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "10px 14px" }}>
            💡 Database terhubung via environment variable <span style={{ fontFamily: "monospace", color: cs.accent }}>VITE_SUPABASE_URL</span> dan <span style={{ fontFamily: "monospace", color: cs.accent }}>SUPABASE_SERVICE_KEY</span>. Untuk ganti provider database di kemudian hari, hubungi developer untuk migrasi backend.
          </div>
        </Card>

        {/* Storage — info only */}
        <Card>
          <CardHeader icon="☁️" title="File Storage" subtitle="Penyimpanan foto laporan, invoice PDF, bukti transfer"
            badge="● Cloudflare R2" badgeColor={cs.green} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>🟠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>Cloudflare R2</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>S3-compatible object storage · Zero egress fee · Global CDN</div>
            </div>
            <span style={{ fontSize: 10, background: cs.green + "22", color: cs.green, border: "1px solid " + cs.green + "44", borderRadius: 99, padding: "3px 9px", fontWeight: 800 }}>AKTIF</span>
          </div>
          <div style={{ fontSize: 11, color: cs.muted, background: cs.surface, borderRadius: 8, padding: "10px 14px" }}>
            💡 Konfigurasi R2 tersimpan di environment variable Vercel (<span style={{ fontFamily: "monospace", color: cs.accent }}>R2_ACCOUNT_ID</span>, <span style={{ fontFamily: "monospace", color: cs.accent }}>R2_ACCESS_KEY</span>, dll). Upload foto berjalan otomatis via <span style={{ fontFamily: "monospace", color: cs.accent }}>/api/upload-foto</span>.
          </div>
        </Card>

        {/* Database Health */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🧹</span>
              <div>
                <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>Database Health — Dead Rows</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Monitor dead rows yang memboroskan storage. VACUUM manual jika persentase tinggi.</div>
              </div>
            </div>
            <button onClick={refreshDbHealth}
              style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {dbHealthLoading ? "⏳ Loading..." : "🔄 Refresh Stats"}
            </button>
          </div>

          <div style={{ background: cs.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 14, border: "1px solid " + cs.border, fontSize: 11, color: cs.muted, lineHeight: 1.6 }}>
            💡 <b style={{ color: cs.text }}>Dead Rows:</b> Saat data dihapus/diupdate, PostgreSQL menandai data lama sebagai "dead" dulu — normal & aman. Data asli <b style={{ color: cs.green }}>TIDAK hilang</b>. VACUUM hanya bersihkan "bangkai" agar storage efisien. Jalankan jika persentase {">"} 50%.
          </div>

          {dbHealthData.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: cs.muted, fontSize: 12 }}>
              Klik "Refresh Stats" untuk melihat kondisi database
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {dbHealthData
                .filter(r => r.dead_rows > 0)
                .sort((a, b) => b.dead_rows - a.dead_rows)
                .map(r => {
                  const pct = r.live_rows > 0 ? Math.round(r.dead_rows / r.live_rows * 100) : r.dead_rows * 100;
                  const color = pct >= 200 ? cs.red : pct >= 80 ? cs.yellow : cs.green;
                  const label = pct >= 200 ? "Tinggi" : pct >= 80 ? "Sedang" : "Normal";
                  const isVacuuming = vacuumLoading[r.tablename];
                  return (
                    <div key={r.tablename} style={{ display: "flex", alignItems: "center", gap: 10, background: cs.surface, borderRadius: 8, padding: "8px 12px", border: "1px solid " + (pct >= 200 ? cs.red + "44" : pct >= 80 ? cs.yellow + "44" : cs.border) }}>
                      <div style={{ width: 150, fontWeight: 600, fontSize: 12, color: cs.text, fontFamily: "monospace" }}>{r.tablename}</div>
                      <div style={{ fontSize: 11, color: cs.muted, flex: 1 }}>
                        <span style={{ color: cs.green }}>✅ {r.live_rows} live</span>
                        <span style={{ margin: "0 6px", color: cs.border }}>|</span>
                        <span style={{ color }}>💀 {r.dead_rows} dead</span>
                        {r.last_autovacuum && (
                          <><span style={{ margin: "0 6px", color: cs.border }}>|</span>
                            <span>🕐 {new Date(r.last_autovacuum).toLocaleDateString("id-ID")}</span></>
                        )}
                      </div>
                      <div style={{ width: 90, height: 6, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: Math.min(100, pct) + "%", height: "100%", background: color, borderRadius: 99, transition: "width .3s" }} />
                      </div>
                      <div style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700, background: color + "22", color, minWidth: 60, textAlign: "center" }}>
                        {pct}% {label}
                      </div>
                      <button
                        disabled={isVacuuming || pct < 30}
                        onClick={async () => {
                          if (!await showConfirm({ icon: "🧹", title: "Jalankan VACUUM?", message: `VACUUM pada tabel "${r.tablename}" akan membersihkan ${r.dead_rows} dead rows.\n\n⚠️ Data aktif TIDAK akan terhapus.`, confirmText: "Ya, Bersihkan" })) return;
                          setVacuumLoading(prev => ({ ...prev, [r.tablename]: true }));
                          try {
                            const { error } = await supabase.rpc("manual_vacuum_table", { table_name: r.tablename });
                            if (error) throw new Error(error.message);
                            showNotif("✅ VACUUM selesai: " + r.tablename);
                            setTimeout(async () => {
                              const { data } = await supabase.rpc("get_dead_rows_stats");
                              if (data) setDbHealthData(data);
                            }, 1000);
                          } catch (e) {
                            showNotif("❌ VACUUM gagal: " + e.message);
                          } finally {
                            setVacuumLoading(prev => ({ ...prev, [r.tablename]: false }));
                          }
                        }}
                        style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: isVacuuming || pct < 30 ? "default" : "pointer", background: pct < 30 ? cs.surface : cs.accent + "22", border: "1px solid " + (pct < 30 ? cs.border : cs.accent + "44"), color: pct < 30 ? cs.muted : cs.accent, fontWeight: 600, opacity: isVacuuming ? 0.6 : 1, minWidth: 80 }}>
                        {isVacuuming ? "⏳ ..." : pct >= 30 ? "🧹 VACUUM" : "✅ OK"}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { color: cs.green, label: "Normal", desc: "< 80% — biarkan, autovacuum akan handle" },
              { color: cs.yellow, label: "Sedang", desc: "80–200% — perhatikan, VACUUM jika perlu" },
              { color: cs.red, label: "Tinggi", desc: "> 200% — disarankan VACUUM manual" },
            ].map(({ color, label, desc }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: cs.muted }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                <b style={{ color: cs.text }}>{label}:</b> {desc}
              </div>
            ))}
          </div>
        </Card>

        {/* ══ AKSES ═══════════════════════════════════════════════════════════ */}
        <SectionLabel icon="👥" label="Akses" />

        <UserManagementPanel
          userAccounts={userAccounts} setUserAccounts={setUserAccounts}
          setTeknisiData={setTeknisiData} currentUser={currentUser}
          setNewUserForm={setNewUserForm} setModalAddUser={setModalAddUser}
          setEditPwdTarget={setEditPwdTarget} setEditPwdForm={setEditPwdForm} setModalEditPwd={setModalEditPwd}
          showNotif={showNotif} showConfirm={showConfirm} addAgentLog={addAgentLog} _apiHeaders={_apiHeaders}
        />

      </>)}
    </div>
  );
}

export default memo(SettingsView);
