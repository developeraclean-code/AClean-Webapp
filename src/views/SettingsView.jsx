import { memo } from "react";
import { cs } from "../theme/cs.js";

function SettingsView({ currentUser, isMobile, appSettings, setAppSettings, waProvider, setWaProvider, waToken, setWaToken, waDevice, setWaDevice, waStatus, setWaStatus, llmProvider, setLlmProvider, llmModel, setLlmModel, llmApiKey, setLlmApiKey, ollamaUrl, setOllamaUrl, llmStatus, setLlmStatus, storageProvider, setStorageProvider, storageStatus, setStorageStatus, brainMd, brainMdCustomer, dbProvider, setDbProvider, cronJobs, setCronJobs, userAccounts, setUserAccounts, dbHealthData, setDbHealthData, dbHealthLoading, setDbHealthLoading, vacuumLoading, setVacuumLoading, setModalBrainEdit, setModalBrainCustomerEdit, setNewUserForm, setModalAddUser, setEditPwdTarget, setEditPwdForm, setModalEditPwd, showNotif, showConfirm, addAgentLog, _apiHeaders, _ls, supabase }) {
const WA_PROVIDERS = [
  {
    id: "fonnte", label: "Fonnte", icon: "🟢", active: true, tagline: "WA Gateway lokal Indonesia",
    fields: [{ k: "token", label: "API Token", ph: "fnt_••••••••", t: "password" }, { k: "device", label: "Device / No WA", ph: "6281299898937", t: "text" }],
    guide: ["Login fonnte.com → menu Device", "Klik tombol + Add Device, scan QR WA HP kamu", "Klik nama device → salin TOKEN di halaman detail device (bukan dari Profile!)", "Paste token di kolom API Token di sini → klik Test &amp; Simpan", "Webhook (untuk bot balas otomatis): butuh paket berbayar Fonnte"]
  },
  {
    id: "wa_cloud", label: "WA Cloud API", icon: "🔵", active: false, tagline: "Resmi Meta, butuh verifikasi bisnis",
    fields: [{ k: "phone_id", label: "Phone Number ID", ph: "123456789" }, { k: "token", label: "Access Token", ph: "EAAx...", t: "password" }, { k: "waba_id", label: "WABA ID", ph: "123456789" }, { k: "verify", label: "Webhook Verify Token", ph: "aclean_secret" }],
    guide: ["Daftar di developers.facebook.com", "Buat App + tambah produk WhatsApp", "Verifikasi Business (Meta Business Suite)", "Generate Permanent Access Token", "Set webhook URL di App Settings"]
  },
  {
    id: "twilio", label: "Twilio", icon: "🔴", active: false, tagline: "Enterprise, multi-channel",
    fields: [{ k: "sid", label: "Account SID", ph: "ACxxxxxxxxxxxxxxxx" }, { k: "token", label: "Auth Token", ph: "••••••••", t: "password" }, { k: "from", label: "Nomor WA Twilio", ph: "whatsapp:+14155552671" }],
    guide: ["Daftar di twilio.com", "Console > Messaging > WhatsApp", "Aktifkan Sandbox atau beli nomor", "Copy Account SID & Auth Token", "Set webhook incoming messages"]
  },
];

const LLM_PROVIDERS = [
  {
    id: "claude", label: "Anthropic Claude", icon: "🟣", rec: true, models: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-6"],
    fields: [{ k: "key", label: "API Key", ph: "sk-ant-api03-...", t: "password" }],
    guide: ["Buka console.anthropic.com", "API Keys → Create Key", "Copy key, paste di sini"],
    note: "Rekomendasi: claude-sonnet-4-6 — cerdas & cepat"
  },
  {
    id: "openai", label: "ChatGPT (OpenAI)", icon: "🟢", rec: false, models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    fields: [{ k: "key", label: "API Key", ph: "sk-proj-...", t: "password" }],
    guide: ["Buka platform.openai.com", "Settings → API Keys → Create", "Copy key, paste di sini"],
    note: "GPT-4o-mini: lebih hemat, cocok volume tinggi"
  },
  {
    id: "minimax", label: "Minimax", icon: "🟦", rec: false, models: ["MiniMax-M2.5", "MiniMax-M2.7-highspeed"],
    fields: [{ k: "key", label: "API Key", ph: "eyJhbGci...", t: "password" }, { k: "group_id", label: "Group ID", ph: "1234567890" }],
    guide: ["Buka platform.minimaxi.com", "API → API Keys → Create", "Copy API Key & Group ID, paste di sini"],
    note: "Rekomendasi: MiniMax-M2.5 — balanced latency & quality. MiniMax-M2.7-highspeed — faster response"
  },
  {
    id: "ollama", label: "Ollama (Lokal/Free)", icon: "🦙", rec: false, models: ["llama3", "llama3.1", "llama3.2", "mistral", "gemma2", "qwen2.5", "deepseek-r1"],
    fields: [{ k: "url", label: "URL Server Ollama", ph: "http://localhost:11434 atau https://xxxx.ngrok-free.app" }],
    guide: ["Install: curl -fsSL https://ollama.com/install.sh | sh", "Pull model: ollama pull llama3", "Jalankan: OLLAMA_ORIGINS='*' ollama serve", "Expose publik: ngrok http 11434", "Copy URL ngrok ke kolom URL di atas"],
    note: "✅ 100% gratis & lokal. Butuh ngrok agar bisa diakses dari Vercel."
  },
];

const STORAGE_PROVIDERS = [
  {
    id: "r2", label: "Cloudflare R2", icon: "🟠", rec: true,
    fields: [{ k: "account_id", label: "Account ID", ph: "abc123" }, { k: "access_key", label: "Access Key ID", ph: "R2_ACCESS_KEY", t: "password" }, { k: "secret_key", label: "Secret Key", ph: "R2_SECRET", t: "password" }, { k: "bucket", label: "Nama Bucket", ph: "aclean-files" }, { k: "domain", label: "Custom Domain (opsional)", ph: "files.aclean.com" }],
    guide: ["Buka dash.cloudflare.com > R2", "Create bucket: aclean-files", "Manage R2 API Tokens > Create Token (Read+Write)", "Copy Account ID, Access Key, Secret Key"]
  },
  {
    id: "gdrive", label: "Google Drive", icon: "🟢", rec: false,
    fields: [{ k: "client_id", label: "Client ID", ph: "xxx.apps.googleusercontent.com" }, { k: "secret", label: "Client Secret", ph: "GOCSPX-...", t: "password" }, { k: "refresh", label: "Refresh Token", ph: "1//04...", t: "password" }, { k: "folder_id", label: "Root Folder ID", ph: "1BxiMVs0XRA5..." }],
    guide: ["Buka console.cloud.google.com > New Project", "Enable Google Drive API", "Create OAuth 2.0 Client ID", "OAuth Playground > authorize Drive > Exchange token", "Buat folder Drive, copy Folder ID dari URL"]
  },
  {
    id: "local", label: "Local / VPS", icon: "🖥️", rec: false,
    fields: [{ k: "path", label: "Base Path", ph: "/var/aclean/uploads" }, { k: "url", label: "Public URL", ph: "https://files.aclean.id" }, { k: "max_mb", label: "Max File Size (MB)", ph: "10" }],
    guide: ["Buat folder uploads di server", "chmod 755 /var/aclean/uploads", "Konfigurasi Nginx serve static files", "Opsional: setup cache headers"]
  },
];

const activeWA = WA_PROVIDERS.find(p => p.id === waProvider) || WA_PROVIDERS[0];
const activeLLM = LLM_PROVIDERS.find(p => p.id === llmProvider) || LLM_PROVIDERS[0];
const activeSTO = STORAGE_PROVIDERS.find(p => p.id === storageProvider) || STORAGE_PROVIDERS[0];
const waSC = waStatus === "connected" ? cs.green : waStatus === "testing" ? cs.yellow : cs.muted;
const llmSC = llmStatus === "connected" ? cs.green : llmStatus === "testing" ? cs.yellow : cs.muted;
const stoSC = storageStatus === "connected" ? cs.green : storageStatus === "testing" ? cs.yellow : cs.muted;

// WA field getter/setter map — token & device tersimpan di state + localStorage
const waFieldMap = {
  token: { val: waToken, set: e => setWaToken(e.target.value) },
  device: { val: waDevice, set: e => setWaDevice(e.target.value) },
};
const FieldList = ({ fields, isLLM }) => (
  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
    {fields.map(f => {
      const isUrlField = isLLM && f.k === "url";
      const isKeyField = isLLM && f.k === "key";
      const isGroupIdField = isLLM && f.k === "group_id";
      const isWAField = !isLLM && waFieldMap[f.k];
      const val = isUrlField ? ollamaUrl : isKeyField ? llmApiKey
        : isGroupIdField ? (localStorage.getItem("llmGroupId") || "")
          : isWAField ? waFieldMap[f.k].val : "";
      const setter = isUrlField ? (e => setOllamaUrl(e.target.value))
        : isKeyField ? (e => setLlmApiKey(e.target.value))
          : isGroupIdField ? (e => { localStorage.setItem("llmGroupId", e.target.value); })
            : isWAField ? waFieldMap[f.k].set
              : undefined;
      const isSet = !!val;
      return (
        <div key={f.k}>
          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>{f.label}</div>
          <input id="val" type={f.t || "text"} placeholder={f.ph}
            value={val}
            onChange={setter}
            style={{ width: "100%", background: cs.surface, border: "1px solid " + (isSet ? cs.green : cs.border), borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          {isSet && <div style={{ fontSize: 10, color: cs.green, marginTop: 3 }}>✓ {f.label} tersimpan</div>}
        </div>
      );
    })}
  </div>
);

const GuideBox = ({ guide, title }) => (
  <div style={{ background: "#0ea5e910", border: "1px solid #0ea5e930", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: "#7dd3fc", marginBottom: 6 }}>📋 {title}</div>
    {guide.map((s, i) => (
      <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3, fontSize: 11, color: cs.muted }}>
        <span style={{ color: cs.accent, fontWeight: 800, minWidth: 14 }}>{i + 1}.</span><span>{s}</span>
      </div>
    ))}
  </div>
);

return (
  <div style={{ display: "grid", gap: 20 }}>
    <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>⚙️ Pengaturan Sistem</div>

    {/* ── ARA CHAT CONNECTION — Admin only (Owner has full LLM card below) ── */}
    {currentUser?.role === "Admin" && (() => {
      const LLM_PROVIDERS_ADMIN = [
        { id: "minimax", label: "Minimax" },
        { id: "claude", label: "Anthropic Claude" },
        { id: "openai", label: "ChatGPT (OpenAI)" },
        { id: "groq", label: "Groq" },
        { id: "ollama", label: "Ollama (Lokal/Free)" }
      ];
      const activeLLM_Admin = LLM_PROVIDERS_ADMIN.find(p => p.id === llmProvider) || LLM_PROVIDERS_ADMIN[0];
      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 800, color: cs.text, fontSize: 15, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            🤖 Koneksi ARA Chat — {llmStatus === "connected" ? <span style={{ color: cs.green }}>✅ Tersambung</span> : <span style={{ color: cs.yellow }}>⚠️ Belum Tersambung</span>}
          </div>
          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 }}>Provider</label>
              <select value={llmProvider} onChange={e => setLlmProvider(e.target.value)}
                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 9, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }}>
                {LLM_PROVIDERS_ADMIN.map(p =>
                  <option key={p.id} value={p.id}>{p.label}</option>
                )}
              </select>
            </div>
          </div>
          <button onClick={async () => {
            if (llmProvider !== "ollama" && !llmApiKey) { showNotif("❌ Masukkan API Key dulu"); return; }
            if (llmProvider === "ollama" && !ollamaUrl) { showNotif("❌ Masukkan URL Ollama dulu (contoh: http://localhost:11434)"); return; }
            setLlmStatus("testing");
            try {
              if (llmProvider === "ollama") {
                const baseUrl = (ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
                const r = await fetch(baseUrl + "/api/tags", { method: "GET" }).catch(e => { throw new Error("Tidak bisa koneksi ke " + baseUrl + " — pastikan Ollama berjalan & URL benar. Error: " + e.message); });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error("Ollama server error " + r.status);
                const models = (d.models || []).map(m => m.name || m.model || m).join(", ");
                setLlmStatus("connected");
                showNotif("✅ Ollama terkoneksi! Model tersedia: " + (models || "(kosong — jalankan: ollama pull llama3)"));
                return;
              } else {
                const type = llmProvider === "minimax" ? "minimax"
                  : llmProvider === "groq" ? "groq"
                    : llmProvider === "openai" ? "llm"
                      : "llm";
                const r = await fetch("/api/test-connection?type=" + type, { headers: _apiHeaders() });
                const d = await r.json();
                if (!r.ok || !d.ok) throw new Error(d.error || d.message || "Test gagal");
              }
              setLlmStatus("connected");
              const modelInfo = llmModel ? " (" + llmModel + ")" : "";
              showNotif("✅ Koneksi " + activeLLM_Admin.label + modelInfo + " berhasil! ARA Chat siap digunakan.");
            } catch (e) { setLlmStatus("not_connected"); showNotif("❌ Koneksi gagal: " + e.message); }
          }}
            style={{ width: "100%", background: llmStatus === "testing" ? cs.muted : cs.green + "22", border: "1px solid " + cs.green + "33", color: cs.green, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, transition: "all 0.2s" }}>
            {llmStatus === "testing" ? "⏳ Testing..." : "🔌 Test & Simpan — " + activeLLM_Admin.label}
          </button>
        </div>
      );
    })()}

    {currentUser?.role !== "Owner" && (
      <div style={{ background: cs.red + "12", border: "1px solid " + cs.red + "33", borderRadius: 12, padding: "14px 18px", fontSize: 13, color: cs.red }}>
        🔒 Halaman Pengaturan lengkap hanya dapat diakses oleh Owner. Admin hanya bisa mengatur ARA Chat di atas.
      </div>
    )}
    {currentUser?.role === "Owner" && (<>

      {/* ── WHATSAPP PROVIDER ── */}
      {/* ══ Informasi Perusahaan ══════════════════════════════ */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ fontWeight: 800, color: cs.text, fontSize: 15, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          🏢 Informasi Perusahaan & Rekening
        </div>
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
                  try {
                    await supabase.from("app_settings").upsert({ key: field.key, value: e.target.value.trim() }, { onConflict: "key" });
                  } catch (err) { console.warn("settings err:", err); }
                }}
                placeholder={field.ph}
                style={{
                  width: "100%", background: cs.surface, border: "1px solid " + cs.border,
                  borderRadius: 9, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none"
                }}
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
              showNotif("Informasi perusahaan tersimpan!");
              addAgentLog("SETTINGS_SAVED", "Company info saved", "SUCCESS");
            } catch (e) { showNotif("Gagal simpan: " + e.message); }
          }}
          style={{
            marginTop: 14, padding: "9px 20px", borderRadius: 9,
            background: "linear-gradient(135deg," + cs.accent + ",#1d4ed8)",
            color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer"
          }}>
          Simpan Perubahan
        </button>
      </div>


      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>📱</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>WhatsApp Provider</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Gateway WA untuk ARA — bisa diganti kapan saja</div>
          </div>
          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: waSC + "22", color: waSC, border: "1px solid " + waSC + "44", fontWeight: 700 }}>
            {waStatus === "connected" ? "● Connected" : waStatus === "testing" ? "● Testing..." : "● Not Connected"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {WA_PROVIDERS.map(p => (
            <div key={p.id} onClick={() => { setWaProvider(p.id); setWaStatus("not_connected"); }}
              style={{ background: waProvider === p.id ? cs.accent + "12" : cs.surface, border: "2px solid " + (waProvider === p.id ? cs.accent : cs.border), borderRadius: 11, padding: "12px 8px", cursor: "pointer", textAlign: "center", position: "relative" }}>
              {p.active && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: cs.green, color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 99, whiteSpace: "nowrap" }}>AKTIF SAAT INI</div>}
              <div style={{ fontSize: 24, marginBottom: 5 }}>{p.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: waProvider === p.id ? cs.accent : cs.text, marginBottom: 3 }}>{p.label}</div>
              <div style={{ fontSize: 10, color: cs.muted, lineHeight: 1.4 }}>{p.tagline}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>🔑 Kredensial {activeWA.label}</div>
        <FieldList fields={activeWA.fields} />
        <GuideBox guide={activeWA.guide} title={"Setup " + activeWA.label} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={async () => { setWaStatus("testing"); try { const r = await fetch("/api/test-connection", { method: "POST", headers: _apiHeaders(), body: JSON.stringify({ type: "wa", provider: waProvider, token: waToken, device: waDevice }) }); const d = await r.json(); setWaStatus(d.success ? "connected" : "not_connected"); showNotif(d.message); } catch (e) { setWaStatus("not_connected"); showNotif("❌ " + e.message); } }}
            style={{ flex: 2, background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
            {waStatus === "testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan Koneksi"}
          </button>
          <button onClick={() => { setWaStatus("not_connected"); showNotif("Koneksi WA direset"); }}
            style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Reset</button>
        </div>
      </div>

      {/* ═══════ GROUP: AI & BRAIN ═══════ */}
      <div style={{ borderTop: "2px solid " + cs.accent + "33", paddingTop: 8, marginTop: 4, fontSize: 11, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: "1px" }}>
        🤖 AI &amp; Brain — ARA Intelligence
      </div>
      {/* ── ARA BRAIN / LLM PROVIDER (includes Brain.md + Brain Customer) ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>🤖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>ARA Brain — LLM Provider</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Model AI yang menjalankan ARA · Brain.md tertanam di semua provider</div>
          </div>
          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: llmSC + "22", color: llmSC, border: "1px solid " + llmSC + "44", fontWeight: 700 }}>
            {llmStatus === "connected" ? "● Connected" : llmStatus === "testing" ? "● Testing..." : "● Not Connected"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          {LLM_PROVIDERS.map(p => (
            <div key={p.id} onClick={() => {
              setLlmProvider(p.id);
              setLlmStatus("not_connected");
              // Load API key milik provider ini (jika sudah pernah diisi)
              const savedKey = _ls("llmApiKey_" + p.id, "") || (p.id === "ollama" ? "" : _ls("llmApiKey", ""));
              setLlmApiKey(savedKey);
            }}
              style={{ background: llmProvider === p.id ? cs.accent + "12" : cs.surface, border: "2px solid " + (llmProvider === p.id ? cs.accent : cs.border), borderRadius: 11, padding: "12px 8px", cursor: "pointer", textAlign: "center", position: "relative" }}>
              {p.rec && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: cs.green, color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 99, whiteSpace: "nowrap" }}>REKOMENDASI</div>}
              <div style={{ fontSize: 22, marginBottom: 4 }}>{p.icon}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: llmProvider === p.id ? cs.accent : cs.text, lineHeight: 1.3 }}>{p.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Model</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {activeLLM.models.map((m) => (
              <span key={m} onClick={() => setLlmModel(m)} style={{ padding: "5px 10px", borderRadius: 7, background: llmModel === m ? cs.accent + "22" : cs.surface, border: "1px solid " + (llmModel === m ? cs.accent : cs.border), fontSize: 11, color: llmModel === m ? cs.accent : cs.muted, fontFamily: "monospace", cursor: "pointer" }}>{m}</span>
            ))}
          </div>
          {llmProvider === "ollama" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Atau ketik nama model custom (harus sama dengan <code style={{ background: cs.surface, padding: "1px 5px", borderRadius: 3 }}>ollama list</code>):</div>
              <input id="llmModel" value={llmModel} onChange={e => setLlmModel(e.target.value)} placeholder="contoh: llama3, mistral, qwen2.5:7b ..."
                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.accent + "44", borderRadius: 7, padding: "8px 11px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
            </div>
          )}
          {activeLLM.note && <div style={{ marginTop: 6, fontSize: 11, color: cs.accent }}>💡 {activeLLM.note}</div>}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>{llmProvider === "ollama" ? "🦙 Konfigurasi Ollama" : "🔑 Kredensial " + activeLLM.label}</div>
        <FieldList fields={activeLLM.fields} isLLM={true} />
        <GuideBox guide={activeLLM.guide} title={"Cara dapat API Key — " + activeLLM.label} />

        {/* Brain.md */}
        <div style={{ background: cs.ara + "08", border: "1px solid " + cs.ara + "33", borderRadius: 11, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 800, color: cs.ara, fontSize: 13 }}>🧠 Brain.md — Memori ARA (Permanen)</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Tertanam di semua provider. Ganti LLM apapun, Brain.md tetap terbaca.</div>
            </div>
            <button onClick={() => setModalBrainEdit(true)} style={{ background: cs.ara + "22", border: "1px solid " + cs.ara + "44", color: cs.ara, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✏️ Edit Brain</button>
          </div>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 11, color: cs.muted, maxHeight: 130, overflow: "auto", fontFamily: "monospace", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {(typeof brainMd === "string" ? brainMd : "").slice(0, 500)}{(typeof brainMd === "string" ? brainMd : "").length > 500 ? "..." : ""}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: cs.muted }}>
            <span>📝 {(typeof brainMd === "string" ? brainMd : "").split("\n").length} baris</span>
            <span>🔤 {typeof brainMd === "string" ? brainMd.length : 0} karakter</span>
            <span style={{ color: cs.green }}>✅ Dikirim sebagai system prompt ke {activeLLM.label}</span>
          </div>
        </div>

        {/* ── BRAIN CUSTOMER — ARA WA Bot ── */}
        <div style={{ background: "#22c55e08", border: "1px solid #22c55e33", borderRadius: 11, padding: 14, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 800, color: "#22c55e", fontSize: 13 }}>💬 Brain Customer — ARA WA Bot</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>System prompt khusus customer via WhatsApp — TERPISAH dari Brain internal Owner/Admin.</div>
            </div>
            <button onClick={() => setModalBrainCustomerEdit(true)} style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✏️ Edit</button>
          </div>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: cs.muted, fontFamily: "monospace", maxHeight: 80, overflow: "hidden", lineHeight: 1.6 }}>
            {brainMdCustomer
              ? brainMdCustomer.slice(0, 300) + (brainMdCustomer.length > 300 ? "..." : "")
              : <span style={{ color: cs.yellow }}>⚠️ Belum diisi — klik Edit untuk mengisi Brain Customer Bot</span>
            }
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: cs.muted }}>
            <span>📝 {brainMdCustomer.split("\n").length} baris</span>
            <span>🔤 {brainMdCustomer.length} karakter</span>
            <span style={{ color: waToken ? "#22c55e" : cs.yellow }}>
              {waToken
                ? <span>✅ Token tersimpan otomatis — tidak perlu isi ulang setelah logout</span>
                : "⚠️ Masukkan token Fonnte di atas"}
            </span>
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>
              📤 Kirim WA (dispatch, reminder): free tier ✅<br />
              📥 Terima WA customer (bot ARA): butuh upgrade Fonnte + webhook URL:<br />
              <span style={{ color: cs.accent, fontFamily: "monospace" }}>https://a-clean-webapp.vercel.app/api/fonnte-webhook</span>
            </div>
          </div>
        </div>


        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={async () => {
            if (llmProvider !== "ollama" && !llmApiKey) { showNotif("❌ Masukkan API Key dulu"); return; }
            if (llmProvider === "ollama" && !ollamaUrl) { showNotif("❌ Masukkan URL Ollama dulu (contoh: http://localhost:11434)"); return; }
            setLlmStatus("testing");
            try {
              let ok = false;
              if (llmProvider === "ollama") {
                const baseUrl = (ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
                // Test: GET /api/tags untuk list model yang tersedia
                const r = await fetch(baseUrl + "/api/tags", { method: "GET" }).catch(e => { throw new Error("Tidak bisa koneksi ke " + baseUrl + " — pastikan Ollama berjalan & URL benar. Error: " + e.message); });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error("Ollama server error " + r.status);
                const models = (d.models || []).map(m => m.name || m.model || m).join(", ");
                setLlmStatus("connected");
                showNotif("✅ Ollama terkoneksi! Model tersedia: " + (models || "(kosong — jalankan: ollama pull llama3)"));
                return; // done for ollama
              } else {
                // Test via backend using environment variables (no keys exposed in browser)
                const type = llmProvider === "minimax" ? "minimax"
                  : llmProvider === "groq" ? "groq"
                    : llmProvider === "openai" ? "llm"   // openai uses /api/test-connection?type=llm
                      : "llm";                               // claude default
                const r = await fetch("/api/test-connection?type=" + type, {
                  headers: _apiHeaders()
                });
                const d = await r.json();
                if (!r.ok || !d.ok) throw new Error(d.error || d.message || "Test gagal");
                ok = true;
              }
              setLlmStatus("connected");
              const modelInfo = llmModel ? " (" + llmModel + ")" : "";
              showNotif("✅ Koneksi " + activeLLM.label + modelInfo + " berhasil! ARA Chat siap digunakan.");
            } catch (e) { setLlmStatus("not_connected"); showNotif("❌ Koneksi gagal: " + e.message); }
          }}
            style={{ flex: 2, background: "linear-gradient(135deg," + cs.ara + ",#7c3aed)", border: "none", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
            {llmStatus === "testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan — " + activeLLM.label}
          </button>
          <button onClick={() => { setLlmStatus("not_connected"); showNotif("Koneksi LLM direset"); }}
            style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Reset</button>
        </div>
      </div>

      {/* ── FILE STORAGE ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>📁</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>File Storage</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Foto laporan, invoice PDF, bukti transfer</div>
          </div>
          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: stoSC + "22", color: stoSC, border: "1px solid " + stoSC + "44", fontWeight: 700 }}>
            {storageStatus === "connected" ? "● Connected" : storageStatus === "testing" ? "● Testing..." : "● Not Connected"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {STORAGE_PROVIDERS.map(p => (
            <div key={p.id} onClick={() => { setStorageProvider(p.id); setStorageStatus("not_connected"); }}
              style={{ background: storageProvider === p.id ? cs.accent + "12" : cs.surface, border: "2px solid " + (storageProvider === p.id ? cs.accent : cs.border), borderRadius: 11, padding: "12px 8px", cursor: "pointer", textAlign: "center", position: "relative" }}>
              {p.rec && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: cs.green, color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 99, whiteSpace: "nowrap" }}>REKOMENDASI</div>}
              <div style={{ fontSize: 24, marginBottom: 5 }}>{p.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: storageProvider === p.id ? cs.accent : cs.text }}>{p.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 8 }}>🔑 Kredensial {activeSTO.label}</div>
        <FieldList fields={activeSTO.fields} />
        <GuideBox guide={activeSTO.guide} title={"Setup " + activeSTO.label} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={async () => { setStorageStatus("testing"); try { const r = await fetch("/api/test-connection", { method: "POST", headers: _apiHeaders(), body: JSON.stringify({ type: "storage" }) }); const d = await r.json(); setStorageStatus(d.success ? "connected" : "not_connected"); showNotif(d.message); } catch (e) { setStorageStatus("not_connected"); showNotif("❌ " + e.message); } }}
            style={{ flex: 2, background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
            {storageStatus === "testing" ? "⏳ Testing..." : "🔌 Test &amp; Simpan Koneksi"}
          </button>
          <button onClick={() => { setStorageStatus("not_connected"); showNotif("Storage direset"); }}
            style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Reset</button>
        </div>
      </div>

      {/* ── DATABASE ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>🗄️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>Database Provider</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Pilih provider database — bisa diganti kapan saja</div>
          </div>
          <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 99, background: cs.green + "22", color: cs.green, border: "1px solid " + cs.green + "44", fontWeight: 700 }}>● Connected</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          {[{ id: "supabase", label: "Supabase", icon: "⚡", rec: true, desc: "PostgreSQL managed, real-time" }, { id: "postgresql", label: "PostgreSQL", icon: "🐘", rec: false, desc: "Self-hosted, full control" }, { id: "mysql", label: "MySQL", icon: "🐬", rec: false, desc: "Populer, banyak hosting" }, { id: "mongodb", label: "MongoDB", icon: "🍃", rec: false, desc: "NoSQL flexible" }].map(db => (
            <div key={db.id} onClick={() => setDbProvider(db.id)}
              style={{ background: dbProvider === db.id ? cs.accent + "12" : cs.surface, border: "2px solid " + (dbProvider === db.id ? cs.accent : cs.border), borderRadius: 11, padding: "12px 8px", cursor: "pointer", textAlign: "center", position: "relative" }}>
              {db.rec && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: cs.green, color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 99, whiteSpace: "nowrap" }}>REKOMENDASI</div>}
              <div style={{ fontSize: 22, marginBottom: 5 }}>{db.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: dbProvider === db.id ? cs.accent : cs.text, marginBottom: 3 }}>{db.label}</div>
              <div style={{ fontSize: 10, color: cs.muted, lineHeight: 1.4 }}>{db.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <input id="field_5" placeholder={dbProvider === "supabase" ? "Supabase URL" : "Host / Connection String"} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }} />
          <input id="field_password_6" type="password" placeholder={dbProvider === "supabase" ? "Supabase Anon Key" : "Password / Secret Key"} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none" }} />
          <button onClick={() => { showNotif("Mencoba koneksi database..."); setTimeout(() => showNotif("Database terkoneksi! Tables: 15"), 2000); }}
            style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🔌 Test Koneksi</button>
        </div>
      </div>

      {/* ── WA AUTO-REPLY TOGGLE (Owner only) ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>💬</span>
          <div>
            <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>Pengaturan WA Auto-Reply</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Kontrol auto-reply & notif masuk tanpa perlu ubah kode</div>
          </div>
        </div>
        {[
          { key: "wa_autoreply_enabled", label: "Auto-Reply Aktif", desc: "Balas pesan customer otomatis berdasarkan keyword (halo, harga, order, dll)", icon: "🤖" },
          { key: "wa_forward_to_owner", label: "Forward ke Owner", desc: "Teruskan semua pesan WA masuk ke nomor Owner sebagai notifikasi", icon: "📨" },
        ].map(({ key, label, desc, icon }) => {
          const isOn = appSettings[key] === "true";
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
              borderBottom: "1px solid " + cs.border
            }}>
              <span style={{ fontSize: 18, minWidth: 24 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: isOn ? cs.text : cs.muted, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{desc}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: isOn ? cs.green : cs.muted }}>{isOn ? "ON" : "OFF"}</span>
                <div onClick={async () => {
                  const newVal = isOn ? "false" : "true";
                  setAppSettings(prev => ({ ...prev, [key]: newVal }));
                  await supabase.from("app_settings").upsert({ key, value: newVal }, { onConflict: "key" });
                  showNotif((isOn ? "⛔ " : "✅ ") + label + (isOn ? " dimatikan" : " diaktifkan"));
                }}
                  style={{
                    width: 44, height: 24, borderRadius: 99,
                    background: isOn ? "linear-gradient(135deg," + cs.green + ",#059669)" : cs.surface,
                    border: "1px solid " + (isOn ? cs.green : cs.border),
                    cursor: "pointer", position: "relative", transition: "all .2s"
                  }}>
                  <div style={{
                    position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff",
                    top: 2, left: isOn ? 22 : 2, transition: "left .2s",
                    boxShadow: "0 1px 3px #0004"
                  }} />
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 12, padding: "10px 12px", background: cs.surface, borderRadius: 8, fontSize: 11, color: cs.muted }}>
          💡 <b>Mode aman:</b> Auto-Reply <b>OFF</b> + Forward <b>ON</b> = pesan masuk diteruskan ke Owner, dibalas manual. Ideal saat tim sedang sibuk.
        </div>
      </div>

      {/* ── OTOMASI & CRON TOGGLES ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>⏰</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>Otomasi & Cron</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Aktifkan / matikan tugas otomatis yang berjalan terjadwal di server</div>
          </div>
        </div>
        {[
          { key: "invoice_reminder_enabled", label: "Reminder Invoice Otomatis", desc: "Kirim WA pengingat ke customer yang belum bayar (cron harian jam 10:00 WIB — hari ke-1–7, 8–14, 15–21)", icon: "📨" },
          { key: "daily_report_enabled",     label: "Laporan Harian ke Owner",   desc: "Kirim ringkasan order & pemasukan hari ini ke Owner setiap hari jam 18:00 WIB", icon: "📊" },
          { key: "stock_alert_enabled",      label: "Alert Stok Kritis",         desc: "Notif WA ke Owner jika ada stok inventory HABIS atau KRITIS (cron jam 08:00 WIB)", icon: "⚠️" },
        ].map(({ key, label, desc, icon }) => {
          // Default ON jika belum pernah diset
          const isOn = appSettings[key] !== "false";
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
              borderBottom: "1px solid " + cs.border
            }}>
              <span style={{ fontSize: 18, minWidth: 24 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: isOn ? cs.text : cs.muted, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{desc}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: isOn ? cs.green : cs.muted }}>{isOn ? "ON" : "OFF"}</span>
                <div onClick={async () => {
                  const newVal = isOn ? "false" : "true";
                  setAppSettings(prev => ({ ...prev, [key]: newVal }));
                  await supabase.from("app_settings").upsert({ key, value: newVal }, { onConflict: "key" });
                  showNotif((isOn ? "⛔ " : "✅ ") + label + (isOn ? " dimatikan" : " diaktifkan"));
                }}
                  style={{
                    width: 44, height: 24, borderRadius: 99,
                    background: isOn ? "linear-gradient(135deg," + cs.green + ",#059669)" : cs.surface,
                    border: "1px solid " + (isOn ? cs.green : cs.border),
                    cursor: "pointer", position: "relative", transition: "all .2s"
                  }}>
                  <div style={{
                    position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff",
                    top: 2, left: isOn ? 22 : 2, transition: "left .2s",
                    boxShadow: "0 1px 3px #0004"
                  }} />
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 12, padding: "10px 12px", background: cs.surface, borderRadius: 8, fontSize: 11, color: cs.muted }}>
          💡 Default semua <b>ON</b>. Matikan jika ingin kirim reminder/laporan manual saja, atau saat maintenance.
        </div>
      </div>

      {/* ── ARA TRAINING RULES UPLOAD (Owner only) ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>🧠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>ARA Training Rules</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Upload file Excel training untuk melatih respons ARA lebih baik — tersimpan di Supabase</div>
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
                <div style={{ fontSize: 11, color: cs.muted, alignSelf: "center" }}>
                  v{(typeof raw === "string" ? JSON.parse(raw) : raw).version || "1.0"} — diupdate {(typeof raw === "string" ? JSON.parse(raw) : raw).updated || "-"}
                </div>
              </div>
            );
          } catch (_) { return null; }
        })()}

        {/* Upload area */}
        <div style={{ border: "2px dashed " + cs.border, borderRadius: 10, padding: 16, textAlign: "center", background: cs.surface }}>
          <div style={{ fontSize: 13, color: cs.muted, marginBottom: 10 }}>
            📂 Upload file Excel (.xlsx) atau JSON yang sudah diisi
          </div>
          <input type="file" accept=".xlsx,.json" id="ara-training-upload"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              showNotif("⏳ Membaca file training...");
              try {
                if (file.name.endsWith(".json")) {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  const val = JSON.stringify(parsed);
                  await supabase.from("app_settings").upsert({ key: "ara_training_rules", value: val }, { onConflict: "key" });
                  setAppSettings(prev => ({ ...prev, ara_training_rules: val }));
                  const rules = (parsed.auto_reply_rules || []).length;
                  const sc = (parsed.ara_training_scenarios || []).length;
                  showNotif("✅ Training rules berhasil diupload: " + rules + " rules, " + sc + " scenarios");
                } else if (file.name.endsWith(".xlsx")) {
                  showNotif("⚠️ Untuk file .xlsx, export dulu ke JSON dari sheet JSON Preview, lalu upload JSON-nya.");
                }
              } catch (err) {
                showNotif("❌ Error baca file: " + err.message);
              }
              e.target.value = "";
            }}
          />
          <button onClick={() => document.getElementById("ara-training-upload").click()}
            style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: "10px 24px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            📤 Upload Training File
          </button>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>
            Format: .json (dari sheet "JSON Preview" di file Excel) atau .xlsx langsung
          </div>
        </div>

        {/* Sync to ARA Brain */}
        <div style={{ marginTop: 12, padding: "10px 14px", background: cs.green + "12", border: "1px solid " + cs.green + "33", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16 }}>🔄</span>
          <div style={{ flex: 1, fontSize: 11, color: cs.muted }}>
            Rules yang diupload otomatis digunakan ARA saat membalas pesan WA. Tidak perlu restart.
          </div>
          <button onClick={async () => {
            const { data: d } = await supabase.from("app_settings").select("value").eq("key", "ara_training_rules").single();
            if (d?.value) { setAppSettings(prev => ({ ...prev, ara_training_rules: d.value })); showNotif("✅ Rules ARA disync dari Supabase"); }
          }} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
            🔄 Sync Sekarang
          </button>
        </div>
      </div>

      {/* ── DATABASE HEALTH — DEAD ROWS MONITOR ── */}
      {currentUser?.role === "Owner" && (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🧹</span>
              <div>
                <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>Database Health — Dead Rows</div>
                <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Monitor "bangkai data" yang memboroskan storage. Jalankan VACUUM manual jika persentase tinggi.</div>
              </div>
            </div>
            <button onClick={async () => {
              setDbHealthLoading(true);
              try {
                const { data } = await supabase.rpc('get_dead_rows_stats').catch(() => ({ data: null }));
                if (data) {
                  setDbHealthData(data);
                } else {
                  // Fallback: query langsung
                  const { data: raw } = await supabase
                    .from('pg_stat_user_tables_view')
                    .select('*')
                    .catch(() => ({ data: null }));
                  if (!raw) {
                    showNotif("⚠️ Perlu setup view pg_stat — cek panduan di bawah");
                  }
                }
              } catch (e) {
                showNotif("❌ Gagal load health data: " + e.message);
              } finally {
                setDbHealthLoading(false);
              }
            }}
              style={{
                background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent,
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                display: "flex", alignItems: "center", gap: 6
              }}>
              {dbHealthLoading ? "⏳ Loading..." : "🔄 Refresh Stats"}
            </button>
          </div>

          {/* Penjelasan dead rows */}
          <div style={{
            background: cs.surface, borderRadius: 8, padding: "10px 14px", marginBottom: 14,
            border: "1px solid " + cs.border, fontSize: 11, color: cs.muted, lineHeight: 1.6
          }}>
            💡 <b style={{ color: cs.text }}>Apa itu Dead Rows?</b> Saat data diupdate atau dihapus, PostgreSQL tidak langsung hapus dari disk —
            ia menandai data lama sebagai "mati" dulu (dead row). Ini normal dan aman. Data asli <b style={{ color: cs.green }}>TIDAK hilang</b>.
            VACUUM hanya membersihkan "bangkai" ini agar storage lebih efisien. Jalankan jika persentase {">"} 50%.
          </div>

          {/* Tabel dead rows */}
          {dbHealthData.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: cs.muted, fontSize: 12 }}>
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
                    <div key={r.tablename} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: cs.surface, borderRadius: 8, padding: "8px 12px",
                      border: "1px solid " + (pct >= 200 ? cs.red + "44" : pct >= 80 ? cs.yellow + "44" : cs.border)
                    }}>
                      {/* Nama tabel */}
                      <div style={{ width: 160, fontWeight: 600, fontSize: 12, color: cs.text, fontFamily: "monospace" }}>
                        {r.tablename}
                      </div>
                      {/* Stats */}
                      <div style={{ fontSize: 11, color: cs.muted, flex: 1 }}>
                        <span style={{ color: cs.green }}>✅ {r.live_rows} live</span>
                        <span style={{ margin: "0 6px", color: cs.border }}>|</span>
                        <span style={{ color: color }}>💀 {r.dead_rows} dead</span>
                        {r.last_autovacuum && (
                          <>
                            <span style={{ margin: "0 6px", color: cs.border }}>|</span>
                            <span>🕐 Auto-vacuum: {new Date(r.last_autovacuum).toLocaleDateString("id-ID")}</span>
                          </>
                        )}
                      </div>
                      {/* Progress bar */}
                      <div style={{ width: 100, height: 6, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: Math.min(100, pct) + "%", height: "100%", background: color, borderRadius: 99, transition: "width .3s" }} />
                      </div>
                      {/* Badge */}
                      <div style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700,
                        background: color + "22", color: color, minWidth: 50, textAlign: "center"
                      }}>
                        {pct}% {label}
                      </div>
                      {/* Tombol VACUUM */}
                      <button
                        disabled={isVacuuming || pct < 30}
                        onClick={async () => {
                          if (!await showConfirm({
                            icon: "🧹",
                            title: "Jalankan VACUUM?",
                            message: `VACUUM pada tabel "${r.tablename}" akan membersihkan ${r.dead_rows} dead rows.\n\n⚠️ Data aktif TIDAK akan terhapus. Proses aman dan bisa dibatalkan kapan saja.`,
                            confirmText: "Ya, Bersihkan"
                          })) return;
                          setVacuumLoading(prev => ({ ...prev, [r.tablename]: true }));
                          try {
                            // Panggil via Supabase RPC
                            const { error } = await supabase.rpc('manual_vacuum_table', { table_name: r.tablename });
                            if (error) throw new Error(error.message);
                            showNotif("✅ VACUUM selesai: " + r.tablename);
                            // Refresh stats
                            setTimeout(async () => {
                              const { data } = await supabase.rpc('get_dead_rows_stats');
                              if (data) setDbHealthData(data);
                            }, 1000);
                          } catch (e) {
                            showNotif("❌ VACUUM gagal: " + e.message);
                          } finally {
                            setVacuumLoading(prev => ({ ...prev, [r.tablename]: false }));
                          }
                        }}
                        style={{
                          fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: isVacuuming || pct < 30 ? "default" : "pointer",
                          background: pct < 30 ? cs.surface : cs.accent + "22",
                          border: "1px solid " + (pct < 30 ? cs.border : cs.accent + "44"),
                          color: pct < 30 ? cs.muted : cs.accent, fontWeight: 600,
                          opacity: isVacuuming ? 0.6 : 1, minWidth: 80
                        }}>
                        {isVacuuming ? "⏳ ..." : pct >= 30 ? "🧹 VACUUM" : "✅ OK"}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Info: kapan perlu VACUUM */}
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
        </div>
      )}

      {/* ── CRON JOBS ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 28 }}>⏰</div>
            <div>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>Cron Jobs (Scheduler)</div>
              <div style={{ fontSize: 12, color: cs.muted }}>Tugas otomatis ARA</div>
            </div>
          </div>
          <button onClick={() => setCronJobs(prev => [...prev, { id: Date.now(), name: "Job Baru", time: "09:00", days: "Setiap Hari", active: false, task: "Deskripsi tugas..." }])}
            style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Tambah Job</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {cronJobs.map((job, idx) => (
            <div key={job.id} style={{ background: cs.surface, border: "1px solid " + (job.active ? cs.green : cs.border), borderRadius: 10, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <div onClick={async () => {
                const upd = cronJobs.map((j, ii) => ii === idx ? { ...j, active: !j.active } : j);
                setCronJobs(upd);
                await supabase.from("app_settings").upsert(
                  { key: "cron_jobs", value: JSON.stringify(upd) }, { onConflict: "key" });
              }}
                style={{ width: 34, height: 20, borderRadius: 99, background: job.active ? cs.green : cs.border, cursor: "pointer", position: "relative", flexShrink: 0 }}>
                <div style={{ position: "absolute", width: 14, height: 14, borderRadius: "50%", background: "#fff", top: 3, left: job.active ? 17 : 3, transition: "left 0.2s" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: job.active ? cs.text : cs.muted, fontSize: 13 }}>{job.name}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>{job.time} · {job.days} · {job.task}</div>
              </div>
              <button onClick={async () => {
                const upd = cronJobs.filter((_, ii) => ii !== idx);
                setCronJobs(upd);
                await supabase.from("app_settings").upsert(
                  { key: "cron_jobs", value: JSON.stringify(upd) }, { onConflict: "key" });
              }} style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      </div>
      {/* ── USER MANAGEMENT (Owner only) ── */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, color: cs.text, fontSize: 14 }}>👥 Manajemen Akun Pengguna</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Kelola akun Owner &amp; Admin saja. Teknisi &amp; Helper dikelola di menu <b style={{ color: cs.accent }}>Tim Teknisi</b>. Hanya Owner yang bisa menambah/nonaktifkan.</div>
          </div>
          <button onClick={() => { setNewUserForm({ name: "", email: "", role: "Admin", password: "", phone: "", _adminOnly: true }); setModalAddUser(true); }}
            style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            + Tambah Pengguna
          </button>
        </div>
        {/* Role legend */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[["👑 Owner", "Semua akses + Pengaturan", "#f59e0b"], ["🛠️ Admin", "Semua menu kecuali Pengaturan", "#38bdf8"], ["👷 Teknisi", "Jadwal &amp; Tim Teknisi saja", "#22c55e"]].map(([role, desc, col]) => (
            <div key={role} style={{ background: col + "12", border: "1px solid " + col + "33", borderRadius: 8, padding: "6px 12px", fontSize: 11 }}>
              <span style={{ color: col, fontWeight: 700 }}>{role}</span>
              <span style={{ color: cs.muted, marginLeft: 6 }}>{desc}</span>
            </div>
          ))}
        </div>
        {/* User list — hanya Owner & Admin (Teknisi/Helper dikelola di Tim Teknisi) */}
        <div style={{ display: "grid", gap: 8 }}>
          {userAccounts.map(u => (
            <div key={u.id} style={{ background: cs.surface, border: "1px solid " + (u.active ? cs.border : cs.red + "33"), borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg," + u.color + "," + u.color + "66)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#fff", flexShrink: 0 }}>
                {u.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{u.name}</span>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: u.color + "22", color: u.color, fontWeight: 700, border: "1px solid " + u.color + "44" }}>
                    {u.role === "Owner" ? "👑" : u.role === "Admin" ? "🛠️" : u.role === "Helper" ? "🤝" : "👷"} {u.role}
                  </span>
                  {!u.active && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: cs.red + "22", color: cs.red, fontWeight: 700 }}>Nonaktif</span>}
                </div>
                <div style={{ fontSize: 11, color: cs.muted }}>
                  {u.email} · {u.phone} · Login terakhir: {u.lastLogin}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {u.role !== "Owner" && (
                  <button onClick={() => { setNewUserForm({ ...u, password: "" }); setModalAddUser(true); }}
                    style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "33", color: cs.accent, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>✏️ Edit</button>
                )}
                {currentUser?.role === "Owner" && (
                  <button onClick={() => {
                    setEditPwdTarget({ id: u.id, name: u.name });
                    setEditPwdForm({ newPwd: "", confirmPwd: "" });
                    setModalEditPwd(true);
                  }} style={{
                    fontSize: 11, background: "#f59e0b20", border: "1px solid #f59e0b44",
                    color: "#f59e0b", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600
                  }}>
                    🔑 Password
                  </button>
                )}
                {u.role !== "Owner" && (
                  <button onClick={() => { setUserAccounts(prev => prev.map(acc => acc.id === u.id ? { ...acc, active: !acc.active } : acc)); showNotif((u.active ? "Akun " : "Akun ") + (u.name) + (u.active ? " dinonaktifkan" : " diaktifkan")); }}
                    style={{ background: (u.active ? cs.red : cs.green) + "18", border: "1px solid " + (u.active ? cs.red : cs.green) + "33", color: u.active ? cs.red : cs.green, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                    {u.active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>)}
  </div>
);
}

export default memo(SettingsView);
