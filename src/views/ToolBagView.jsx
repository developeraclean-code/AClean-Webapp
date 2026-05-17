import { memo, useState, useEffect, useCallback, Fragment } from "react";
import { cs } from "../theme/cs.js";

const BAGS = Array.from({ length: 10 }, (_, i) => `Tas ${i + 1}`);

const STATUS_COLOR = {
  OK: cs.green, WARNING: cs.yellow, CRITICAL: cs.red, ERROR: cs.muted
};
const STATUS_ICON = { OK: "✅", WARNING: "⚠️", CRITICAL: "🚨", ERROR: "❌" };

// Helper: dapat awal minggu (Senin) untuk tanggal tertentu
function getMondayOf(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateISO(d) { return d.toISOString().slice(0, 10); }

function ToolBagView({ supabase, currentUser, showNotif, showConfirm }) {
  const [weekStart, setWeekStart] = useState(getMondayOf(new Date()));
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedBag, setSelectedBag] = useState(null);
  const [checklistTemplate, setChecklistTemplate] = useState([]); // unique tools dari DB
  const [showManageModal, setShowManageModal] = useState(false);

  const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin";

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const loadChecks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tool_bag_checks")
      .select("*")
      .gte("checked_at", weekStart.toISOString())
      .lt("checked_at", weekEnd.toISOString())
      .order("checked_at", { ascending: false })
      .limit(500);
    if (!error) setChecks(data || []);
    else if (showNotif) showNotif("Gagal load data: " + error.message);
    setLoading(false);
  }, [supabase, weekStart, weekEnd, showNotif]);

  // Load checklist template (ambil unique tool dari Tas 1, asumsi semua tas punya checklist sama)
  const loadChecklist = useCallback(async () => {
    const { data, error } = await supabase
      .from("tool_bag_checklist")
      .select("tool_name,is_priority,qty_min")
      .eq("bag_id", "Tas 1")
      .order("is_priority", { ascending: false })
      .order("tool_name");
    if (!error) {
      setChecklistTemplate((data || []).map(t => ({ name: t.tool_name, is_priority: t.is_priority, qty_min: t.qty_min })));
    }
  }, [supabase]);

  useEffect(() => { loadChecks(); }, [loadChecks]);
  useEffect(() => { loadChecklist(); }, [loadChecklist]);

  // Hitung status per tas untuk minggu ini
  const bagSummary = BAGS.map(bagId => {
    const bagChecks = checks.filter(c => c.bag_id === bagId);
    const totalChecks = bagChecks.length;
    const criticalCount = bagChecks.filter(c => c.status === "CRITICAL").length;
    const warningCount = bagChecks.filter(c => c.status === "WARNING").length;
    const okCount = bagChecks.filter(c => c.status === "OK").length;
    const errorCount = bagChecks.filter(c => c.status === "ERROR").length;
    const lastCheck = bagChecks[0]; // sudah sorted desc
    const hasIssue = criticalCount > 0 || warningCount > 0;
    const overallStatus = totalChecks === 0 ? "NODATA"
      : criticalCount > 0 ? "CRITICAL"
      : warningCount > 0 ? "WARNING"
      : "OK";
    return { bagId, totalChecks, criticalCount, warningCount, okCount, errorCount, lastCheck, hasIssue, overallStatus };
  });

  const weekLabel = `${weekStart.toLocaleDateString("id-ID", { day:"numeric", month:"short" })} – ${new Date(weekEnd.getTime()-1).toLocaleDateString("id-ID", { day:"numeric", month:"short", year:"numeric" })}`;

  // Pindah minggu
  const goWeek = (delta) => {
    const newStart = new Date(weekStart);
    newStart.setDate(newStart.getDate() + delta * 7);
    setWeekStart(newStart);
    setSelectedBag(null);
  };

  // Statistik global minggu ini
  const totalThisWeek = checks.length;
  const issuesThisWeek = checks.filter(c => c.status === "CRITICAL" || c.status === "WARNING").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 22, color: cs.text }}>🎒 Tas Teknisi</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>
            Kirim foto ke WA AClean: <b>"Pagi Tas 1"</b>, <b>"Pulang Tas 5"</b>, dst (Tas 1 – Tas 10)
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isOwnerAdmin && (
            <button onClick={() => setShowManageModal(true)}
              style={{ padding: "8px 14px", background: cs.surface, color: cs.text, border: `1px solid ${cs.border}`, borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
              ✏️ Kelola Alat ({checklistTemplate.length})
            </button>
          )}
          <button onClick={loadChecks}
            style={{ padding: "8px 14px", background: cs.accent, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Week Navigator */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: "10px 14px" }}>
        <button onClick={() => goWeek(-1)}
          style={{ padding: "6px 12px", background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          ← Minggu Lalu
        </button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 700, color: cs.text }}>
          📅 {weekLabel}
        </div>
        <button onClick={() => goWeek(1)} disabled={weekEnd > new Date()}
          style={{ padding: "6px 12px", background: weekEnd > new Date() ? cs.surface + "44" : cs.surface, border: `1px solid ${cs.border}`, borderRadius: 8, color: weekEnd > new Date() ? cs.muted : cs.text, cursor: weekEnd > new Date() ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}>
          Minggu Depan →
        </button>
        <button onClick={() => { setWeekStart(getMondayOf(new Date())); setSelectedBag(null); }}
          style={{ padding: "6px 12px", background: cs.accent + "22", border: `1px solid ${cs.accent}44`, borderRadius: 8, color: cs.accent, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
          Hari Ini
        </button>
      </div>

      {/* Statistik */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {[
          { label: "Total Check", value: totalThisWeek, color: cs.accent },
          { label: "✅ OK", value: checks.filter(c => c.status === "OK").length, color: cs.green },
          { label: "⚠️ Issues", value: issuesThisWeek, color: issuesThisWeek > 0 ? cs.red : cs.muted },
          { label: "Tas Bermasalah", value: bagSummary.filter(b => b.hasIssue).length, color: bagSummary.filter(b => b.hasIssue).length > 0 ? cs.red : cs.green }
        ].map((s, i) => (
          <div key={i} style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Grid 10 Tas */}
      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginBottom: 12 }}>
          Status Semua Tas — Minggu Ini
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {bagSummary.map(b => {
            const isSelected = selectedBag === b.bagId;
            const accentColor = b.overallStatus === "NODATA" ? cs.muted
              : b.overallStatus === "CRITICAL" ? cs.red
              : b.overallStatus === "WARNING" ? cs.yellow
              : cs.green;
            return (
              <button key={b.bagId} onClick={() => setSelectedBag(isSelected ? null : b.bagId)}
                style={{
                  background: isSelected ? accentColor + "22" : cs.surface,
                  border: `2px solid ${isSelected ? accentColor : (b.hasIssue ? cs.red + "66" : cs.border)}`,
                  borderRadius: 12,
                  padding: 14,
                  cursor: "pointer",
                  textAlign: "left",
                  position: "relative",
                  transition: "all 0.15s"
                }}>
                {b.hasIssue && (
                  <div style={{ position: "absolute", top: 8, right: 8, fontSize: 18 }}>
                    {b.criticalCount > 0 ? "🚨" : "⚠️"}
                  </div>
                )}
                <div style={{ fontWeight: 800, fontSize: 16, color: cs.text, marginBottom: 6 }}>
                  🎒 {b.bagId}
                </div>
                {b.totalChecks === 0 ? (
                  <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>Belum ada check</div>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>
                      {b.totalChecks}× check
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 10 }}>
                      {b.okCount > 0 && (
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: cs.green + "22", color: cs.green, fontWeight: 600 }}>
                          ✅ {b.okCount}
                        </span>
                      )}
                      {b.warningCount > 0 && (
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: cs.yellow + "22", color: cs.yellow, fontWeight: 600 }}>
                          ⚠️ {b.warningCount}
                        </span>
                      )}
                      {b.criticalCount > 0 && (
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: cs.red + "22", color: cs.red, fontWeight: 700 }}>
                          🚨 {b.criticalCount}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail Tas Terpilih */}
      {selectedBag && (
        <BagDetail
          bagId={selectedBag}
          checks={checks.filter(c => c.bag_id === selectedBag)}
          checklistTemplate={checklistTemplate}
          onClose={() => setSelectedBag(null)}
        />
      )}

      {/* Modal Kelola Alat */}
      {showManageModal && (
        <ManageChecklistModal
          supabase={supabase}
          checklistTemplate={checklistTemplate}
          onClose={() => setShowManageModal(false)}
          onChanged={() => { loadChecklist(); }}
          showNotif={showNotif}
          showConfirm={showConfirm}
        />
      )}

      {!selectedBag && (
        <div style={{ background: cs.surface, border: `1px dashed ${cs.border}`, borderRadius: 12, padding: 18, textAlign: "center", fontSize: 12, color: cs.muted }}>
          💡 Klik salah satu tas di atas untuk lihat detail checklist & history minggu ini
        </div>
      )}

      {loading && <div style={{ textAlign: "center", color: cs.muted, fontSize: 12 }}>Loading...</div>}
    </div>
  );
}

function BagDetail({ bagId, checks, checklistTemplate, onClose }) {
  // Hitung untuk setiap alat: berapa kali ada/missing dalam minggu ini
  const toolStats = checklistTemplate.map(tool => {
    let foundCount = 0;
    let missingCount = 0;
    checks.forEach(c => {
      const found = (Array.isArray(c.tools_found) ? c.tools_found : []).some(t =>
        (t.name || "").toLowerCase() === tool.name.toLowerCase()
      );
      const missing = (Array.isArray(c.tools_missing) ? c.tools_missing : []).some(t =>
        (t.name || "").toLowerCase() === tool.name.toLowerCase()
      );
      if (found) foundCount++;
      if (missing) missingCount++;
    });
    return { ...tool, foundCount, missingCount };
  });

  const problemTools = toolStats.filter(t => t.missingCount > 0);
  const hasIssues = problemTools.length > 0;

  return (
    <div style={{ background: cs.card, border: `2px solid ${hasIssues ? cs.red + "66" : cs.border}`, borderRadius: 14, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${cs.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: hasIssues ? cs.red + "11" : cs.surface }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>🎒 Detail {bagId}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {checks.length} check minggu ini · {problemTools.length} alat bermasalah
          </div>
        </div>
        <button onClick={onClose}
          style={{ background: "none", border: `1px solid ${cs.border}`, color: cs.muted, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>
          ✕ Tutup
        </button>
      </div>

      {/* Warning banner jika ada issues */}
      {hasIssues && (
        <div style={{ padding: "10px 16px", background: cs.red + "22", borderBottom: `1px solid ${cs.red}44`, color: cs.red, fontSize: 12, fontWeight: 600 }}>
          🚨 Ada {problemTools.length} alat yang tidak lengkap dalam minggu ini — segera konfirmasi ke teknisi pemegang tas
        </div>
      )}

      {/* Checklist Alat */}
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Checklist {toolStats.length} Alat — Minggu Ini
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
          {toolStats.map(t => {
            const hasProblem = t.missingCount > 0;
            const color = hasProblem ? cs.red : (t.foundCount > 0 ? cs.green : cs.muted);
            return (
              <div key={t.name} style={{
                background: hasProblem ? cs.red + "11" : cs.surface,
                border: `1px solid ${hasProblem ? cs.red + "44" : cs.border}`,
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: cs.text, display: "flex", alignItems: "center", gap: 6 }}>
                    {t.is_priority && <span style={{ fontSize: 10 }}>🔴</span>}
                    {t.name}
                  </div>
                  {t.is_priority && (
                    <div style={{ fontSize: 9, color: cs.red, fontWeight: 700, marginTop: 1 }}>WAJIB</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {t.foundCount > 0 && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: cs.green + "22", color: cs.green, fontWeight: 600 }}>
                      ✓ {t.foundCount}×
                    </span>
                  )}
                  {t.missingCount > 0 && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: cs.red + "33", color: cs.red, fontWeight: 700 }}>
                      ✗ {t.missingCount}×
                    </span>
                  )}
                  {t.foundCount === 0 && t.missingCount === 0 && (
                    <span style={{ fontSize: 10, color: cs.muted }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History Check Minggu Ini */}
      <div style={{ borderTop: `1px solid ${cs.border}` }}>
        <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
          History Check Minggu Ini ({checks.length})
        </div>
        {checks.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: cs.muted, fontSize: 12, fontStyle: "italic" }}>
            Belum ada foto check untuk {bagId} minggu ini
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: cs.surface }}>
                  {["Tanggal","Sesi","Status","Alat Kurang","Foto"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c, i) => {
                  const missing = Array.isArray(c.tools_missing) ? c.tools_missing : [];
                  const priorityMissing = missing.filter(t => t.is_priority);
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${cs.border}`, background: i%2 === 0 ? "transparent" : cs.surface + "60" }}>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: cs.muted }}>
                        {new Date(c.checked_at).toLocaleDateString("id-ID", { weekday:"short", day:"numeric", month:"short" })}
                        <div style={{ fontSize: 10 }}>{new Date(c.checked_at).toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" })}</div>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4,
                          background: (c.session_type === "pagi" ? cs.accent : cs.yellow) + "22",
                          color: c.session_type === "pagi" ? cs.accent : cs.yellow, fontWeight: 600 }}>
                          {c.session_type === "pagi" ? "🌅 Pagi" : "🌇 Pulang"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6,
                          background: STATUS_COLOR[c.status] + "22", color: STATUS_COLOR[c.status],
                          border: `1px solid ${STATUS_COLOR[c.status]}44`, fontWeight: 700 }}>
                          {STATUS_ICON[c.status]} {c.status}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", fontSize: 11 }}>
                        {missing.length === 0 ? (
                          <span style={{ color: cs.green }}>Lengkap</span>
                        ) : (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {priorityMissing.map((t, idx) => (
                              <span key={idx} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: cs.red + "33", color: cs.red, fontWeight: 700 }}>
                                🔴 {t.name}
                              </span>
                            ))}
                            {missing.filter(t => !t.is_priority).slice(0, 3).map((t, idx) => (
                              <span key={idx} style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: cs.yellow + "22", color: cs.yellow, fontWeight: 600 }}>
                                🟡 {t.name}
                              </span>
                            ))}
                            {missing.filter(t => !t.is_priority).length > 3 && (
                              <span style={{ fontSize: 9, color: cs.muted }}>+{missing.filter(t => !t.is_priority).length - 3}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        {c.photo_url ? (
                          <a href={c.photo_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 10, color: cs.accent, textDecoration: "none" }}>📷 Lihat</a>
                        ) : <span style={{ color: cs.muted, fontSize: 10 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageChecklistModal({ supabase, checklistTemplate, onClose, onChanged, showNotif, showConfirm }) {
  const [editingTool, setEditingTool] = useState(null); // { name, is_priority, originalName } | null
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tambah alat baru ke SEMUA tas (10 tas × 1 alat = 10 inserts)
  const handleAdd = async () => {
    if (!newName.trim()) { showNotif?.("Nama alat wajib diisi"); return; }
    const name = newName.trim();
    if (checklistTemplate.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      showNotif?.("Alat sudah ada di checklist");
      return;
    }
    setSaving(true);
    const rows = BAGS.map(bag => ({
      bag_id: bag,
      tool_name: name,
      qty_min: 1,
      is_priority: newPriority
    }));
    const { error } = await supabase.from("tool_bag_checklist").insert(rows);
    setSaving(false);
    if (error) { showNotif?.("Gagal tambah: " + error.message); return; }
    showNotif?.("✅ Alat \"" + name + "\" ditambahkan ke semua tas");
    setNewName("");
    setNewPriority(false);
    onChanged?.();
  };

  // Edit alat: rename + toggle priority (update semua tas dengan tool_name lama)
  const handleSaveEdit = async () => {
    if (!editingTool) return;
    const newToolName = editingTool.name.trim();
    if (!newToolName) { showNotif?.("Nama alat tidak boleh kosong"); return; }
    setSaving(true);
    const { error } = await supabase.from("tool_bag_checklist")
      .update({ tool_name: newToolName, is_priority: editingTool.is_priority })
      .eq("tool_name", editingTool.originalName);
    setSaving(false);
    if (error) { showNotif?.("Gagal update: " + error.message); return; }
    showNotif?.("✏️ Alat diperbarui");
    setEditingTool(null);
    onChanged?.();
  };

  // Hapus alat dari semua tas
  const handleDelete = async (tool) => {
    const ok = showConfirm
      ? await showConfirm({ icon: "🗑️", title: "Hapus Alat?", danger: true,
          message: `Hapus "${tool.name}" dari checklist SEMUA tas (Tas 1 - Tas 10)? Tidak bisa dibatalkan.`,
          confirmText: "Hapus" })
      : window.confirm(`Hapus "${tool.name}" dari semua tas?`);
    if (!ok) return;
    const { error } = await supabase.from("tool_bag_checklist")
      .delete().eq("tool_name", tool.name);
    if (error) { showNotif?.("Gagal hapus: " + error.message); return; }
    showNotif?.("🗑️ Alat \"" + tool.name + "\" dihapus dari semua tas");
    onChanged?.();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14,
          width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto"
        }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${cs.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: cs.card, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: cs.text }}>✏️ Kelola Checklist Alat</div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
              Perubahan otomatis berlaku untuk semua tas (Tas 1 – Tas 10)
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: `1px solid ${cs.border}`, color: cs.muted, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>
            ✕ Tutup
          </button>
        </div>

        {/* Form Tambah */}
        <div style={{ padding: 16, borderBottom: `1px solid ${cs.border}`, background: cs.surface + "44" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
            ➕ Tambah Alat Baru
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nama alat (contoh: Bor Listrik)"
              style={{ flex: 1, minWidth: 200, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 13, outline: "none" }}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: cs.text, cursor: "pointer" }}>
              <input type="checkbox" checked={newPriority} onChange={e => setNewPriority(e.target.checked)} />
              🔴 WAJIB
            </label>
            <button onClick={handleAdd} disabled={saving || !newName.trim()}
              style={{ padding: "8px 16px", background: newName.trim() ? cs.green : cs.muted + "44", color: newName.trim() ? "#fff" : cs.muted, border: "none", borderRadius: 8, fontWeight: 700, cursor: newName.trim() && !saving ? "pointer" : "not-allowed", fontSize: 12 }}>
              {saving ? "..." : "+ Tambah"}
            </button>
          </div>
        </div>

        {/* List Alat Existing */}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Daftar Alat ({checklistTemplate.length})
          </div>
          {checklistTemplate.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: cs.muted, fontSize: 12, fontStyle: "italic" }}>
              Belum ada alat. Tambahkan via form di atas.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {checklistTemplate.map(tool => {
                const isEditing = editingTool?.originalName === tool.name;
                return (
                  <div key={tool.name} style={{
                    background: cs.surface,
                    border: `1px solid ${isEditing ? cs.accent : cs.border}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    display: "flex",
                    gap: 8,
                    alignItems: "center"
                  }}>
                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          value={editingTool.name}
                          onChange={e => setEditingTool({ ...editingTool, name: e.target.value })}
                          style={{ flex: 1, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 6, padding: "5px 10px", color: cs.text, fontSize: 13, outline: "none" }}
                          autoFocus
                        />
                        <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: cs.text, cursor: "pointer" }}>
                          <input type="checkbox" checked={editingTool.is_priority}
                            onChange={e => setEditingTool({ ...editingTool, is_priority: e.target.checked })} />
                          🔴
                        </label>
                        <button onClick={handleSaveEdit} disabled={saving}
                          style={{ padding: "5px 10px", background: cs.green, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                          {saving ? "..." : "Simpan"}
                        </button>
                        <button onClick={() => setEditingTool(null)}
                          style={{ padding: "5px 10px", background: cs.surface, color: cs.muted, border: `1px solid ${cs.border}`, borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: cs.text, display: "flex", alignItems: "center", gap: 6 }}>
                          {tool.is_priority && <span style={{ fontSize: 10 }}>🔴</span>}
                          {tool.name}
                          {tool.is_priority && (
                            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: cs.red + "22", color: cs.red, fontWeight: 700 }}>
                              WAJIB
                            </span>
                          )}
                        </div>
                        <button onClick={() => setEditingTool({ name: tool.name, originalName: tool.name, is_priority: tool.is_priority })}
                          style={{ padding: "5px 10px", background: cs.accent + "22", color: cs.accent, border: `1px solid ${cs.accent}44`, borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                          ✏️ Edit
                        </button>
                        <button onClick={() => handleDelete(tool)}
                          style={{ padding: "5px 10px", background: cs.red + "22", color: cs.red, border: `1px solid ${cs.red}44`, borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ToolBagView);
