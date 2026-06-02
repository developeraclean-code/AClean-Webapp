import { useState, useEffect, useMemo } from "react";
import { cs } from "../theme/cs.js";

// WaGroupMonitorView — Owner-only panel untuk monitor WA Group.
// Tab "Daftar Grup": whitelist + config per-grup
// Tab "Log Aktivitas": riwayat pesan dari grup yang dimonitor (filter type, group, date)
//
// Props:
// - currentUser
// - supabase
// - showNotif
// - showConfirm
// - auditUserName
export default function WaGroupMonitorView({ currentUser, supabase, showNotif, showConfirm, auditUserName, apiHeaders }) {
  const isOwner = currentUser?.role === "Owner";
  const [activeTab, setActiveTab] = useState("groups"); // groups | personal | discovery | logs

  // ── Personal chats (wa_conversations + wa_messages) ──
  const [convs, setConvs] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [selectedConv, setSelectedConv] = useState(null); // { phone, name }
  const [convMessages, setConvMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [convSearch, setConvSearch] = useState("");
  const fetchConversations = async () => {
    setLoadingConvs(true);
    try {
      const { data, error } = await supabase.from("wa_conversations")
        .select("phone,name,last_message,unread,updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setConvs(data || []);
    } catch (e) {
      showNotif("Gagal load chat: " + e.message, "error");
    } finally {
      setLoadingConvs(false);
    }
  };
  const openConv = async (conv) => {
    setSelectedConv(conv);
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase.from("wa_messages")
        .select("id,phone,name,role,content,image_url,created_at")
        .eq("phone", conv.phone)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setConvMessages((data || []).reverse());
    } catch (e) {
      showNotif("Gagal load thread: " + e.message, "error");
    } finally {
      setLoadingMessages(false);
    }
  };

  // ── State: daftar grup ──
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [addForm, setAddForm] = useState(null); // null = closed, object = open

  // ── State: logs ──
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilterType, setLogFilterType] = useState("all");
  const [logFilterGroup, setLogFilterGroup] = useState("all");
  const [logRange, setLogRange] = useState(7); // hari
  const [logFilterSource, setLogFilterSource] = useState("group"); // group | personal | all

  // ── Sync from Fonnte ──
  const [syncModal, setSyncModal] = useState(null); // null | { loading, groups, pickedIds }
  const [syncing, setSyncing] = useState(false);

  const fetchFonnteGroups = async (forceRefresh = false) => {
    setSyncing(true);
    setSyncModal({ loading: true, groups: [], pickedIds: new Set() });
    try {
      const headers = apiHeaders ? await apiHeaders() : {};
      const url = "/api/wa-groups?action=fonnte-list" + (forceRefresh ? "&refresh=1" : "");
      const res = await fetch(url, { method: "GET", headers });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) {
        // Tampilkan detail Fonnte error di modal
        setSyncModal({
          loading: false, groups: [], pickedIds: new Set(),
          errorMessage: json.error || "Unknown error",
          errorDetail: json.fonnte_reason || json.detail || null,
          errorRaw: json.fonnte_raw || null,
        });
        return;
      }
      const existing = new Set(groups.map(g => g.group_id));
      const list = (json.groups || []).map(g => ({
        ...g,
        already_whitelisted: existing.has(g.id),
      }));
      setSyncModal({ loading: false, groups: list, pickedIds: new Set() });
    } catch (e) {
      showNotif("Sync gagal: " + (e?.message || e), "error");
      setSyncModal(null);
    } finally {
      setSyncing(false);
    }
  };

  // ── Discovery: grup yang sempat kirim pesan tapi belum whitelisted ──
  const [discovery, setDiscovery] = useState([]);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const fetchDiscovery = async () => {
    setLoadingDiscovery(true);
    try {
      const { data, error } = await supabase.from("wa_group_discovery")
        .select("*")
        .eq("whitelisted", false)
        .order("last_seen", { ascending: false })
        .limit(100);
      if (error) throw error;
      setDiscovery(data || []);
    } catch (e) {
      showNotif("Gagal load discovery: " + e.message, "error");
    } finally {
      setLoadingDiscovery(false);
    }
  };

  const handleWhitelistDiscovered = async (item) => {
    const name = window.prompt("Beri nama grup ini (boleh apa saja):", `Grup ${(item.sample_sender_name || "WA").slice(0, 30)}`);
    if (!name?.trim()) return;
    try {
      const { error: e1 } = await supabase.from("wa_monitored_groups").upsert({
        group_id: item.group_id,
        group_name: name.trim(),
        description: `${item.message_count} pesan terdeteksi · sample: ${(item.sample_sender_name || "?")}`,
        enabled: true,
        capture_all: false,
        forward_to_owner: false,
        added_by: auditUserName?.() || currentUser?.name || "Unknown",
      });
      if (e1) throw e1;
      await supabase.from("wa_group_discovery").update({ whitelisted: true }).eq("group_id", item.group_id);
      showNotif("✅ Grup di-whitelist");
      fetchDiscovery();
      fetchGroups();
    } catch (e) {
      showNotif("Gagal whitelist: " + e.message, "error");
    }
  };

  // ── Webhook raw hits (debug) ──
  const [rawHits, setRawHits] = useState([]);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [expandedRawId, setExpandedRawId] = useState(null);
  const [hideStatusCb, setHideStatusCb] = useState(true);
  const fetchRawHits = async () => {
    setLoadingRaw(true);
    try {
      const { data, error } = await supabase.from("wa_webhook_raw")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setRawHits(data || []);
    } catch (e) {
      showNotif("Gagal load raw: " + e.message, "error");
    } finally {
      setLoadingRaw(false);
    }
  };

  useEffect(() => {
    if (activeTab === "discovery") { fetchDiscovery(); fetchRawHits(); }
    if (activeTab === "personal") { fetchConversations(); }
    /* eslint-disable-next-line */
  }, [activeTab]);

  // Filter convs by search
  const filteredConvs = useMemo(() => {
    const q = convSearch.toLowerCase().trim();
    if (!q) return convs;
    return convs.filter(c =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.phone || "").includes(q) ||
      (c.last_message || "").toLowerCase().includes(q)
    );
  }, [convs, convSearch]);

  const togglePickSync = (gid) => {
    setSyncModal(m => {
      if (!m) return m;
      const s = new Set(m.pickedIds);
      if (s.has(gid)) s.delete(gid); else s.add(gid);
      return { ...m, pickedIds: s };
    });
  };

  const handleBatchWhitelist = async () => {
    if (!syncModal || syncModal.pickedIds.size === 0) return;
    setSyncing(true);
    try {
      const picked = syncModal.groups.filter(g => syncModal.pickedIds.has(g.id));
      const rows = picked.map(g => ({
        group_id: g.id,
        group_name: g.name,
        description: g.member_count ? `${g.member_count} member` : null,
        enabled: true,
        capture_all: false,
        forward_to_owner: false,
        added_by: auditUserName?.() || currentUser?.name || "Unknown",
      }));
      const { error } = await supabase.from("wa_monitored_groups").upsert(rows);
      if (error) throw error;
      showNotif(`✅ ${rows.length} grup ditambahkan ke whitelist`);
      setSyncModal(null);
      fetchGroups();
    } catch (e) {
      showNotif("Batch save gagal: " + (e?.message || e), "error");
    } finally {
      setSyncing(false);
    }
  };

  // Fetch groups
  const fetchGroups = async () => {
    setLoadingGroups(true);
    try {
      const { data, error } = await supabase.from("wa_monitored_groups")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setGroups(data || []);
    } catch (e) {
      showNotif("Gagal load grup: " + e.message, "error");
    } finally {
      setLoadingGroups(false);
    }
  };

  // Fetch logs — merge dari wa_group_logs + wa_messages tergantung source filter
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const since = new Date(Date.now() - logRange * 86400000).toISOString();
      const tasks = [];
      if (logFilterSource === "group" || logFilterSource === "all") {
        let q = supabase.from("wa_group_logs")
          .select("id,sender_phone,sender_name,group_id,group_name,type,content,amount,parsed_ok,metadata,created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300);
        if (logFilterType !== "all") q = q.eq("type", logFilterType);
        if (logFilterGroup !== "all") q = q.eq("group_id", logFilterGroup);
        tasks.push(q.then(r => (r.data || []).map(x => ({ ...x, _source: "group" }))));
      }
      if (logFilterSource === "personal" || logFilterSource === "all") {
        const q = supabase.from("wa_messages")
          .select("id,phone,name,role,content,image_url,created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300);
        tasks.push(q.then(r => (r.data || []).map(x => ({
          id: x.id, sender_phone: x.phone, sender_name: x.name,
          group_id: null, group_name: null,
          type: x.role || "personal", content: x.content,
          image_url: x.image_url,
          parsed_ok: false, created_at: x.created_at,
          _source: "personal",
        }))));
      }
      const results = await Promise.all(tasks);
      const merged = results.flat().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 500);
      setLogs(merged);
    } catch (e) {
      showNotif("Gagal load log: " + e.message, "error");
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => { fetchGroups(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (activeTab === "logs") fetchLogs(); /* eslint-disable-next-line */ }, [activeTab, logFilterType, logFilterGroup, logRange, logFilterSource]);

  // ── Stats per grup (dari logs) ──
  const groupStats = useMemo(() => {
    const m = {};
    logs.forEach(l => {
      const k = l.group_id || "_unknown";
      if (!m[k]) m[k] = { total: 0, biaya: 0, laporan: 0, stok: 0, biaya_sum: 0 };
      m[k].total++;
      if (l.type === "biaya") { m[k].biaya++; m[k].biaya_sum += Number(l.amount || 0); }
      else if (l.type === "laporan") m[k].laporan++;
      else if (l.type === "stok_alert") m[k].stok++;
    });
    return m;
  }, [logs]);

  // ── Handlers ──
  const handleAddGroup = async (form) => {
    if (!form.group_id?.trim() || !form.group_name?.trim()) {
      return showNotif("Group ID & Nama wajib diisi", "error");
    }
    try {
      const payload = {
        group_id: form.group_id.trim(),
        group_name: form.group_name.trim(),
        description: form.description?.trim() || null,
        enabled: true,
        capture_all: !!form.capture_all,
        forward_to_owner: !!form.forward_to_owner,
        notify_keywords: form.notify_keywords ? form.notify_keywords.split(",").map(s => s.trim()).filter(Boolean) : null,
        added_by: auditUserName?.() || currentUser?.name || "Unknown",
      };
      const { error } = await supabase.from("wa_monitored_groups").upsert(payload);
      if (error) throw error;
      showNotif("✅ Grup ditambahkan");
      setAddForm(null);
      fetchGroups();
    } catch (e) {
      showNotif("Gagal simpan: " + e.message, "error");
    }
  };

  const handleToggleField = async (group, field) => {
    try {
      const { error } = await supabase.from("wa_monitored_groups")
        .update({ [field]: !group[field], updated_at: new Date().toISOString() })
        .eq("group_id", group.group_id);
      if (error) throw error;
      fetchGroups();
    } catch (e) {
      showNotif("Gagal update: " + e.message, "error");
    }
  };

  const handleDeleteGroup = (group) => {
    showConfirm?.({
      title: "Hapus grup dari monitor?",
      message: `Grup "${group.group_name}" tidak akan dimonitor lagi. Log historis tetap tersimpan di DB. Yakin?`,
      onConfirm: async () => {
        try {
          const { error } = await supabase.from("wa_monitored_groups").delete().eq("group_id", group.group_id);
          if (error) throw error;
          showNotif("Grup dihapus");
          fetchGroups();
        } catch (e) {
          showNotif("Gagal hapus: " + e.message, "error");
        }
      },
    });
  };

  if (!isOwner) {
    return (
      <div style={{ padding: 32, color: cs.muted, textAlign: "center" }}>
        Akses ditolak. Menu ini khusus Owner.
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: cs.text }}>📡 Monitor WA</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
          Pantau semua chat WA — personal & grup di satu tempat. Whitelist grup yang ingin di-track.
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid " + cs.border, paddingBottom: 0 }}>
        {[
          { key: "groups", label: "Daftar Grup", icon: "📋" },
          { key: "personal", label: "Personal", icon: "👤" },
          { key: "discovery", label: "Discovery", icon: "🔍" },
          { key: "logs", label: "Log Aktivitas", icon: "📥" },
        ].map(t => {
          const active = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              background: "transparent", border: "none", borderBottom: "2px solid " + (active ? cs.accent : "transparent"),
              padding: "10px 16px", color: active ? cs.accent : cs.muted, fontWeight: active ? 800 : 600,
              fontSize: 13, cursor: "pointer",
            }}>
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      {/* ─── TAB: Daftar Grup ─── */}
      {activeTab === "groups" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: cs.muted }}>
              {groups.length} grup terdaftar · {groups.filter(g => g.enabled).length} aktif
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={fetchFonnteGroups} disabled={syncing} style={{
                background: "#10b98122", border: "1px solid #10b98155", color: "#10b981", borderRadius: 8,
                padding: "8px 14px", fontSize: 12, cursor: syncing ? "not-allowed" : "pointer", fontWeight: 700,
                opacity: syncing ? 0.6 : 1,
              }}>
                {syncing ? "⏳ Sync..." : "🔄 Sync dari Fonnte"}
              </button>
              <button onClick={() => setAddForm({ group_id: "", group_name: "", description: "", capture_all: false, forward_to_owner: false, notify_keywords: "" })}
                style={{
                  background: cs.accent, border: "none", color: "#fff", borderRadius: 8,
                  padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700,
                }}>
                ➕ Tambah Manual
              </button>
            </div>
          </div>

          {/* Form tambah */}
          {addForm && (
            <div style={{ background: cs.card, border: "1px solid " + cs.accent + "44", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: cs.accent }}>Tambah Grup Baru</div>
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Group ID (dari Fonnte) *</div>
                  <input value={addForm.group_id} onChange={e => setAddForm(f => ({ ...f, group_id: e.target.value }))}
                    placeholder="cth: 1234567890-1234567890@g.us atau 1234567890"
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Nama Grup *</div>
                  <input value={addForm.group_name} onChange={e => setAddForm(f => ({ ...f, group_name: e.target.value }))}
                    placeholder="cth: Tim Teknisi AClean"
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Deskripsi (opsional)</div>
                  <input value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="cth: Grup operasional teknisi & helper"
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Notify Keywords (pisah koma, opsional)</div>
                  <input value={addForm.notify_keywords} onChange={e => setAddForm(f => ({ ...f, notify_keywords: e.target.value }))}
                    placeholder="cth: urgent, customer marah, kebocoran"
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none" }} />
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: cs.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={addForm.capture_all} onChange={e => setAddForm(f => ({ ...f, capture_all: e.target.checked }))} />
                    Capture ALL pesan (heavy)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: cs.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={addForm.forward_to_owner} onChange={e => setAddForm(f => ({ ...f, forward_to_owner: e.target.checked }))} />
                    Forward ke Owner via WA
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => setAddForm(null)} style={{
                  background: "transparent", border: "1px solid " + cs.border, color: cs.muted,
                  borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer",
                }}>Batal</button>
                <button onClick={() => handleAddGroup(addForm)} style={{
                  background: cs.accent, border: "none", color: "#fff",
                  borderRadius: 6, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700,
                }}>Simpan</button>
              </div>
            </div>
          )}

          {/* List grup */}
          {loadingGroups ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 40, fontSize: 12, background: cs.card, borderRadius: 10, border: "1px dashed " + cs.border }}>
              Belum ada grup. Klik <b>➕ Tambah Grup</b> untuk mulai monitor.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {groups.map(g => {
                const stats = groupStats[g.group_id] || {};
                return (
                  <div key={g.group_id} style={{
                    background: cs.card, border: "1px solid " + (g.enabled ? cs.border : cs.muted + "33"),
                    borderRadius: 10, padding: 14, opacity: g.enabled ? 1 : 0.55,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>{g.group_name}</div>
                        <div style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace", marginTop: 2, wordBreak: "break-all" }}>{g.group_id}</div>
                        {g.description && (
                          <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>{g.description}</div>
                        )}
                      </div>
                      <button onClick={() => handleDeleteGroup(g)} style={{
                        background: "#ef444418", border: "1px solid #ef444444", color: "#ef4444",
                        borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", flexShrink: 0,
                      }}>Hapus</button>
                    </div>

                    {/* Toggle controls */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {[
                        { key: "enabled", label: "Aktif", color: "#10b981" },
                        { key: "capture_all", label: "Capture all", color: "#a855f7" },
                        { key: "forward_to_owner", label: "Forward Owner", color: "#f59e0b" },
                      ].map(t => (
                        <button key={t.key} onClick={() => handleToggleField(g, t.key)} style={{
                          background: g[t.key] ? t.color + "22" : "transparent",
                          border: "1px solid " + (g[t.key] ? t.color + "55" : cs.border),
                          color: g[t.key] ? t.color : cs.muted,
                          borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700,
                        }}>
                          {g[t.key] ? "✓" : "○"} {t.label}
                        </button>
                      ))}
                    </div>

                    {g.notify_keywords && g.notify_keywords.length > 0 && (
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>
                        🔔 Keywords: {g.notify_keywords.join(", ")}
                      </div>
                    )}

                    {/* Stats kecil */}
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: cs.muted, paddingTop: 8, borderTop: "1px solid " + cs.border + "44" }}>
                      <span>📊 {logRange}h: <b style={{ color: cs.text }}>{stats.total || 0}</b> log</span>
                      <span>💰 <b style={{ color: cs.text }}>{stats.biaya || 0}</b> biaya{stats.biaya_sum ? ` (Rp${stats.biaya_sum.toLocaleString("id")})` : ""}</span>
                      <span>📝 <b style={{ color: cs.text }}>{stats.laporan || 0}</b> laporan</span>
                      <span>⚠️ <b style={{ color: cs.text }}>{stats.stok || 0}</b> stok</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: Log Aktivitas ─── */}
      {activeTab === "logs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Filter bar */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Source chips: All / Grup / Personal */}
            <div style={{ display: "flex", gap: 0, border: "1px solid " + cs.border, borderRadius: 6, overflow: "hidden" }}>
              {[
                { k: "all", l: "🌐 Semua" },
                { k: "group", l: "👥 Grup" },
                { k: "personal", l: "👤 Personal" },
              ].map(s => (
                <button key={s.k} onClick={() => setLogFilterSource(s.k)} style={{
                  background: logFilterSource === s.k ? cs.accent + "22" : "transparent",
                  border: "none", color: logFilterSource === s.k ? cs.accent : cs.muted,
                  padding: "6px 10px", fontSize: 11, cursor: "pointer", fontWeight: 700,
                }}>{s.l}</button>
              ))}
            </div>
            <select value={logRange} onChange={e => setLogRange(Number(e.target.value))} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 6, padding: "6px 10px", fontSize: 12, outline: "none",
            }}>
              <option value={1}>1 hari</option>
              <option value={7}>7 hari</option>
              <option value={30}>30 hari</option>
              <option value={90}>90 hari</option>
            </select>
            <select value={logFilterGroup} onChange={e => setLogFilterGroup(e.target.value)} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 6, padding: "6px 10px", fontSize: 12, outline: "none",
            }}>
              <option value="all">Semua grup</option>
              {groups.map(g => (
                <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
              ))}
            </select>
            <select value={logFilterType} onChange={e => setLogFilterType(e.target.value)} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 6, padding: "6px 10px", fontSize: 12, outline: "none",
            }}>
              <option value="all">Semua tipe</option>
              <option value="biaya">💰 Biaya</option>
              <option value="laporan">📝 Laporan</option>
              <option value="stok_alert">⚠️ Stok Alert</option>
              <option value="general">📥 General</option>
            </select>
            <button onClick={fetchLogs} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600,
            }}>🔄 Refresh</button>
            <span style={{ fontSize: 11, color: cs.muted, marginLeft: "auto" }}>{logs.length} log</span>
          </div>

          {/* Log list */}
          {loadingLogs ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 40, fontSize: 12, background: cs.card, borderRadius: 10, border: "1px dashed " + cs.border }}>
              Belum ada log untuk filter ini.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "65vh", overflowY: "auto" }}>
              {logs.map(l => {
                const isPersonal = l._source === "personal";
                const typeColor = {
                  biaya: "#10b981", laporan: "#3b82f6", stok_alert: "#f59e0b", general: cs.muted,
                  customer: cs.accent, admin: "#a855f7", assistant: "#a855f7",
                }[l.type] || cs.muted;
                const typeIcon = { biaya: "💰", laporan: "📝", stok_alert: "⚠️", general: "📥",
                  customer: "👤", admin: "💼", assistant: "🤖" }[l.type] || "📥";
                return (
                  <div key={l._source + l.id} style={{
                    background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, flexWrap: "wrap" }}>
                        <span style={{
                          background: isPersonal ? cs.muted + "22" : "#a855f722",
                          color: isPersonal ? cs.muted : "#a855f7",
                          padding: "2px 7px", borderRadius: 99, fontSize: 9, fontWeight: 800,
                        }}>{isPersonal ? "👤 personal" : "👥 grup"}</span>
                        <span style={{
                          background: typeColor + "22", color: typeColor, padding: "2px 7px",
                          borderRadius: 99, fontSize: 10, fontWeight: 700,
                        }}>{typeIcon} {l.type}</span>
                        {l.parsed_ok && (
                          <span style={{ background: "#10b98122", color: "#10b981", padding: "2px 6px", borderRadius: 99, fontSize: 9, fontWeight: 700 }}>✓ parsed</span>
                        )}
                        {l.amount && (
                          <span style={{ color: "#10b981", fontWeight: 700, fontSize: 11 }}>Rp{Number(l.amount).toLocaleString("id")}</span>
                        )}
                        {l.metadata?.keyword_match && (
                          <span style={{ background: "#f59e0b22", color: "#f59e0b", padding: "2px 6px", borderRadius: 99, fontSize: 9, fontWeight: 700 }}>🔔 keyword</span>
                        )}
                        {l.image_url && (
                          <a href={l.image_url} target="_blank" rel="noreferrer" style={{ background: cs.accent + "22", color: cs.accent, padding: "2px 6px", borderRadius: 99, fontSize: 9, fontWeight: 700, textDecoration: "none" }}>📷 foto</a>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: cs.muted, whiteSpace: "nowrap" }}>
                        {new Date(l.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: cs.text, lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 700 }}>{l.sender_name || l.sender_phone}</span>
                      {l.group_name && <span style={{ color: cs.muted }}> · {l.group_name}</span>}
                      <span style={{ color: cs.text }}>: {l.content}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: Personal ─── */}
      {activeTab === "personal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" value={convSearch} onChange={e => setConvSearch(e.target.value)}
              placeholder="🔍 Cari nama, nomor, atau isi pesan..."
              style={{
                flex: 1, background: cs.surface, border: "1px solid " + cs.border,
                borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 12, outline: "none",
              }} />
            <button onClick={fetchConversations} disabled={loadingConvs} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: loadingConvs ? "not-allowed" : "pointer", fontWeight: 600,
            }}>{loadingConvs ? "..." : "🔄"}</button>
            <span style={{ fontSize: 11, color: cs.muted }}>{filteredConvs.length} chat</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: selectedConv ? "320px 1fr" : "1fr", gap: 12, minHeight: 400 }}>
            {/* Chat list */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, overflowY: "auto", maxHeight: "70vh" }}>
              {loadingConvs ? (
                <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
              ) : filteredConvs.length === 0 ? (
                <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>
                  {convSearch ? "Tidak ada chat cocok." : "Belum ada chat personal."}
                </div>
              ) : (
                filteredConvs.map(c => {
                  const active = selectedConv?.phone === c.phone;
                  return (
                    <div key={c.phone} onClick={() => openConv(c)} style={{
                      padding: "10px 12px", cursor: "pointer",
                      background: active ? cs.accent + "12" : "transparent",
                      borderLeft: active ? "3px solid " + cs.accent : "3px solid transparent",
                      borderBottom: "1px solid " + cs.border + "33",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{c.name || c.phone}</span>
                        {c.unread > 0 && (
                          <span style={{ background: "#22c55e", color: "#fff", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 99 }}>{c.unread}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace", marginBottom: 4 }}>{c.phone}</div>
                      <div style={{ fontSize: 11, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(c.last_message || "(tidak ada pesan)").slice(0, 60)}
                      </div>
                      <div style={{ fontSize: 9, color: cs.muted, marginTop: 3 }}>
                        {c.updated_at ? new Date(c.updated_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : ""}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Thread view */}
            {selectedConv && (
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{selectedConv.name || selectedConv.phone}</div>
                    <div style={{ fontSize: 10, color: cs.muted }}>{selectedConv.phone}</div>
                  </div>
                  <button onClick={() => setSelectedConv(null)} style={{
                    background: "transparent", border: "none", color: cs.muted, fontSize: 18, cursor: "pointer",
                  }}>×</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {loadingMessages ? (
                    <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
                  ) : convMessages.length === 0 ? (
                    <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Belum ada pesan.</div>
                  ) : (
                    convMessages.map(m => {
                      const isMe = m.role === "admin" || m.role === "assistant";
                      return (
                        <div key={m.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start" }}>
                          <div style={{
                            maxWidth: "75%", background: isMe ? cs.accent + "22" : cs.surface,
                            border: "1px solid " + (isMe ? cs.accent + "44" : cs.border),
                            borderRadius: 10, padding: "8px 12px",
                          }}>
                            <div style={{ fontSize: 9, color: cs.muted, marginBottom: 2 }}>
                              {m.role || "?"} · {new Date(m.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            {m.image_url && (
                              <div style={{ marginBottom: 4 }}>
                                <a href={m.image_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: cs.accent }}>
                                  📷 Lihat foto
                                </a>
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: cs.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {m.content || "(kosong)"}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: Discovery ─── */}
      {activeTab === "discovery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* ── Webhook Recent Hits (Debug) ── */}
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>🔬 Webhook Recent Hits (Debug)</div>
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>
                  20 webhook terakhir yang diterima — termasuk yang reject di validasi. Cek <b>has_member</b> = true untuk grup.
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setHideStatusCb(s => !s)} style={{
                  background: hideStatusCb ? "transparent" : "#f59e0b22",
                  border: "1px solid " + (hideStatusCb ? cs.border : "#f59e0b55"),
                  color: hideStatusCb ? cs.muted : "#f59e0b",
                  borderRadius: 6, padding: "5px 10px", fontSize: 10, cursor: "pointer", fontWeight: 700,
                }}>{hideStatusCb ? "Tampilkan status" : "Sembunyikan status"}</button>
                <button onClick={fetchRawHits} disabled={loadingRaw} style={{
                  background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
                  borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: loadingRaw ? "not-allowed" : "pointer", fontWeight: 600,
                }}>{loadingRaw ? "..." : "🔄"}</button>
              </div>
            </div>
            {rawHits.length === 0 ? (
              <div style={{ textAlign: "center", color: cs.muted, padding: 20, fontSize: 11 }}>
                Belum ada webhook hit. Coba kirim pesan ke nomor AClean.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflowY: "auto" }}>
                {rawHits.filter(h => {
                  const p = h.payload || {};
                  const isStatus = !!(p.state || p.stateid) && !p.message && !p.sender;
                  return hideStatusCb ? !isStatus : true;
                }).map(h => {
                  const isExpanded = expandedRawId === h.id;
                  const p = h.payload || {};
                  // Klasifikasi: status callback vs incoming
                  const isStatusCallback = !!(p.state || p.stateid) && !p.message && !p.sender;
                  const kind = isStatusCallback ? "status" : (h.has_member ? "group" : "personal");
                  const badge = isStatusCallback
                    ? { label: "📊 STATUS", color: "#f59e0b" }
                    : kind === "group"
                      ? { label: "📡 GROUP", color: "#a855f7" }
                      : { label: "👤 personal", color: cs.muted };
                  return (
                    <div key={h.id} style={{
                      background: cs.surface, border: "1px solid " + badge.color + "55",
                      borderRadius: 6, padding: "6px 10px", fontSize: 11,
                      opacity: isStatusCallback ? 0.7 : 1,
                    }}>
                      <div onClick={() => setExpandedRawId(isExpanded ? null : h.id)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ background: badge.color + "22", color: badge.color, padding: "1px 6px", borderRadius: 99, fontSize: 9, fontWeight: 800 }}>{badge.label}</span>
                          {h.msg_type && !isStatusCallback && (
                            <span style={{ background: cs.accent + "22", color: cs.accent, padding: "1px 6px", borderRadius: 99, fontSize: 9, fontWeight: 700 }}>{h.msg_type}</span>
                          )}
                          {isStatusCallback ? (
                            <span style={{ color: cs.text, fontFamily: "monospace", fontSize: 10 }}>
                              state: <b>{p.state || "?"}</b>
                            </span>
                          ) : (
                            <span style={{ color: cs.text, fontFamily: "monospace", fontSize: 10 }}>
                              sender: <b>{(h.sender || "?").slice(0, 40)}{(h.sender || "").length > 40 ? "..." : ""}</b>
                            </span>
                          )}
                          {h.member && (
                            <span style={{ color: cs.muted, fontFamily: "monospace", fontSize: 10 }}>
                              member: {h.member.slice(0, 20)}
                            </span>
                          )}
                        </div>
                        <span style={{ color: cs.muted, fontSize: 10, whiteSpace: "nowrap" }}>
                          {new Date(h.created_at).toLocaleTimeString("id-ID")}
                        </span>
                      </div>
                      {isExpanded && (
                        <pre style={{ fontSize: 9, color: cs.muted, background: cs.card, padding: 6, borderRadius: 4, marginTop: 6, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(p, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: cs.muted }}>
              Grup yang sempat kirim pesan tapi BELUM di-whitelist. Klik "Whitelist" untuk mulai monitor.
            </div>
            <button onClick={fetchDiscovery} style={{
              background: cs.surface, border: "1px solid " + cs.border, color: cs.text,
              borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600,
            }}>🔄 Refresh</button>
          </div>
          {loadingDiscovery ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 30, fontSize: 12 }}>Memuat...</div>
          ) : discovery.length === 0 ? (
            <div style={{ textAlign: "center", color: cs.muted, padding: 40, fontSize: 12, background: cs.card, borderRadius: 10, border: "1px dashed " + cs.border }}>
              Belum ada grup tersembunyi terdeteksi.<br/>
              <span style={{ fontSize: 11 }}>Begitu ada pesan masuk dari grup yang belum whitelisted, group_id-nya akan muncul di sini.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {discovery.map(d => (
                <div key={d.group_id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace", wordBreak: "break-all" }}>{d.group_id}</div>
                      <div style={{ fontSize: 11, color: cs.text, marginTop: 4 }}>
                        Sample sender: <b>{d.sample_sender_name || "?"}</b> ({d.sample_sender_phone || "?"})
                      </div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 2, fontStyle: "italic" }}>
                        "{(d.sample_message || "").slice(0, 100)}{(d.sample_message || "").length > 100 ? "..." : ""}"
                      </div>
                    </div>
                    <button onClick={() => handleWhitelistDiscovered(d)} style={{
                      background: "#10b981", border: "none", color: "#fff", borderRadius: 6,
                      padding: "6px 12px", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0,
                    }}>+ Whitelist</button>
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, paddingTop: 6, borderTop: "1px solid " + cs.border + "33" }}>
                    📊 {d.message_count} pesan · First: {new Date(d.first_seen).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })} · Last: {new Date(d.last_seen).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Sync Modal ─── */}
      {syncModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }} onClick={() => !syncing && setSyncModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14,
            maxWidth: 600, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: cs.text }}>🔄 Sync Grup dari Fonnte</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                  Pilih grup mana yang mau di-whitelist & monitor
                </div>
              </div>
              <button onClick={() => setSyncModal(null)} disabled={syncing} style={{
                background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: syncing ? "not-allowed" : "pointer",
              }}>×</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {syncModal.loading ? (
                <div style={{ textAlign: "center", color: cs.muted, padding: 40, fontSize: 12 }}>
                  Memuat dari Fonnte API...
                </div>
              ) : syncModal.errorMessage ? (
                <div style={{ padding: 16, background: "#ef444412", border: "1px solid #ef444444", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>⚠️ {syncModal.errorMessage}</div>
                  {syncModal.errorDetail && (
                    <div style={{ fontSize: 12, color: cs.text }}>Detail: {syncModal.errorDetail}</div>
                  )}
                  {syncModal.errorRaw && (
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Raw response Fonnte:</div>
                      <pre style={{ fontSize: 10, color: cs.muted, background: cs.card, padding: 8, borderRadius: 6, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {JSON.stringify(syncModal.errorRaw, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button onClick={() => fetchFonnteGroups(true)} disabled={syncing} style={{
                      background: "#f59e0b22", border: "1px solid #f59e0b55", color: "#f59e0b",
                      borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: syncing ? "not-allowed" : "pointer", fontWeight: 700,
                    }}>
                      🔄 Force Refresh Cache Fonnte
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 8, lineHeight: 1.5 }}>
                    <b>Penjelasan:</b> Fonnte cache list grup. Kalau baru pertama, atau ada grup baru,
                    perlu force refresh dulu. ⚠️ Jangan sering-sering — bisa kena banned WA.
                    <br/><br/>
                    <b>Alternatif:</b> Buka tab <b>🔍 Discovery</b> — begitu ada pesan masuk dari grup,
                    group_id-nya akan ke-capture otomatis dan bisa di-whitelist 1 klik.
                  </div>
                </div>
              ) : syncModal.groups.length === 0 ? (
                <div style={{ textAlign: "center", color: cs.muted, padding: 40, fontSize: 12 }}>
                  Fonnte mengembalikan list kosong. Pastikan device terhubung & ada grup yang join.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {syncModal.groups.map(g => {
                    const picked = syncModal.pickedIds.has(g.id);
                    const disabled = g.already_whitelisted;
                    return (
                      <div key={g.id} onClick={() => !disabled && togglePickSync(g.id)}
                        style={{
                          background: picked ? cs.accent + "12" : cs.card,
                          border: "1px solid " + (picked ? cs.accent + "66" : cs.border),
                          borderRadius: 8, padding: "10px 12px",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                          display: "flex", gap: 10, alignItems: "center",
                        }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                          border: "2px solid " + (picked ? cs.accent : cs.border),
                          background: picked ? cs.accent : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: 12, fontWeight: 800,
                        }}>{picked ? "✓" : ""}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>
                            {g.name}
                            {g.already_whitelisted && (
                              <span style={{ marginLeft: 8, fontSize: 9, background: "#10b98122", color: "#10b981", padding: "2px 6px", borderRadius: 99, fontWeight: 700 }}>
                                ✓ sudah whitelisted
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace", marginTop: 2, wordBreak: "break-all" }}>{g.id}</div>
                          {g.member_count && (
                            <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>👥 {g.member_count} member</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: "12px 14px", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: cs.muted }}>
                {syncModal.pickedIds.size} dipilih dari {syncModal.groups.length}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSyncModal(null)} disabled={syncing} style={{
                  background: "transparent", border: "1px solid " + cs.border, color: cs.muted,
                  borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: syncing ? "not-allowed" : "pointer",
                }}>Batal</button>
                <button onClick={handleBatchWhitelist} disabled={syncing || syncModal.pickedIds.size === 0} style={{
                  background: cs.accent, border: "none", color: "#fff",
                  borderRadius: 8, padding: "8px 16px", fontSize: 12, cursor: syncing || syncModal.pickedIds.size === 0 ? "not-allowed" : "pointer", fontWeight: 700,
                  opacity: syncing || syncModal.pickedIds.size === 0 ? 0.5 : 1,
                }}>
                  {syncing ? "Menyimpan..." : `Whitelist ${syncModal.pickedIds.size} Grup`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
