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
export default function WaGroupMonitorView({ currentUser, supabase, showNotif, showConfirm, auditUserName }) {
  const isOwner = currentUser?.role === "Owner";
  const [activeTab, setActiveTab] = useState("groups"); // groups | logs

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

  // Fetch logs
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const since = new Date(Date.now() - logRange * 86400000).toISOString();
      let q = supabase.from("wa_group_logs")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (logFilterType !== "all") q = q.eq("type", logFilterType);
      if (logFilterGroup !== "all") q = q.eq("group_id", logFilterGroup);
      const { data, error } = await q;
      if (error) throw error;
      setLogs(data || []);
    } catch (e) {
      showNotif("Gagal load log: " + e.message, "error");
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => { fetchGroups(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (activeTab === "logs") fetchLogs(); /* eslint-disable-next-line */ }, [activeTab, logFilterType, logFilterGroup, logRange]);

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
        <div style={{ fontSize: 18, fontWeight: 800, color: cs.text }}>📡 Monitor WA Group</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
          Whitelist grup yang dimonitor. Webhook skip semua grup yang tidak ada di daftar.
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid " + cs.border, paddingBottom: 0 }}>
        {[
          { key: "groups", label: "Daftar Grup", icon: "📋" },
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: cs.muted }}>
              {groups.length} grup terdaftar · {groups.filter(g => g.enabled).length} aktif
            </div>
            <button onClick={() => setAddForm({ group_id: "", group_name: "", description: "", capture_all: false, forward_to_owner: false, notify_keywords: "" })}
              style={{
                background: cs.accent, border: "none", color: "#fff", borderRadius: 8,
                padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700,
              }}>
              ➕ Tambah Grup
            </button>
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
                const typeColor = {
                  biaya: "#10b981", laporan: "#3b82f6", stok_alert: "#f59e0b", general: cs.muted,
                }[l.type] || cs.muted;
                const typeIcon = { biaya: "💰", laporan: "📝", stok_alert: "⚠️", general: "📥" }[l.type] || "📥";
                return (
                  <div key={l.id} style={{
                    background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
                    padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
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
                      </div>
                      <span style={{ fontSize: 10, color: cs.muted }}>
                        {new Date(l.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: cs.text, lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 700 }}>{l.sender_name}</span>
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
    </div>
  );
}
