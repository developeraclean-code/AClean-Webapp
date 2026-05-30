import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { initialData } from "../data/sampleData.js";
import { loadAll, api, genId, ASC } from "../data/projectApi.js";

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

export function ProjectProvider({ currentUser, children }) {
  const [db, setDb] = useState(() => initialData());
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [activeProject, setActiveProject] = useState(null);
  const role = currentUser?.role || "Owner";
  const can = {
    finance: role === "Owner",
    manage: role === "Owner" || role === "Admin",
    expenseInput: role === "Owner" || role === "Admin",
    verify: role === "Owner" || role === "Admin",
  };
  const today = new Date().toISOString().slice(0, 10);

  // ── load awal dari Supabase ───────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const data = await loadAll();
      setDb(data);
      setSyncError(null);
    } catch (e) {
      console.error("[Project] load gagal:", e);
      setSyncError(e.message || "Gagal memuat data Project");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => { setLoading(true); await reload(); if (alive) setLoading(false); })();
    return () => { alive = false; };
  }, [reload]);

  // ── helpers state lokal (optimistic) ──────────────────────────────────────
  const update = useCallback((fn) => setDb((cur) => { const next = { ...cur }; fn(next); return next; }), []);

  // jalankan persist; bila gagal → tampilkan error + muat ulang (revert optimistic)
  const guard = useCallback(async (promise) => {
    try { await promise; setSyncError(null); }
    catch (e) { console.error("[Project] simpan gagal:", e); setSyncError("Gagal menyimpan ke server — data dimuat ulang."); await reload(); }
  }, [reload]);

  // ── aksi generik (optimistic + persist) ───────────────────────────────────
  // tambah baris ke tabel; id di-generate bila belum ada
  const addRows = useCallback((key, rows) => {
    const withId = rows.map((r) => (r.id ? r : { ...r, id: genId(key[0]) }));
    update((cur) => { cur[key] = ASC[key] ? [...cur[key], ...withId] : [...withId, ...cur[key]]; });
    guard(api.insert(key, withId));
    return withId;
  }, [update, guard]);

  // patch beberapa baris sekaligus: updates = [{ id, ...patch }]
  const patchRows = useCallback((key, updates) => {
    update((cur) => { cur[key] = cur[key].map((r) => { const u = updates.find((x) => x.id === r.id); return u ? { ...r, ...u } : r; }); });
    guard(Promise.all(updates.map(({ id, ...patch }) => api.update(key, id, patch))));
  }, [update, guard]);

  const patchRow = useCallback((key, id, patch) => patchRows(key, [{ id, ...patch }]), [patchRows]);

  // ── aksi spesifik ─────────────────────────────────────────────────────────
  const updateProject = useCallback((pid, patch) => patchRow("projects", pid, patch), [patchRow]);

  const toggleHold = useCallback((pid) => {
    const p = db.projects.find((x) => x.id === pid);
    if (!p) return;
    if (p.status === "SELESAI") return;
    if (p.status === "HOLD") updateProject(pid, { status: p._prev || "BERJALAN" });
    else updateProject(pid, { _prev: p.status, status: "HOLD" });
  }, [db.projects, updateProject]);

  // alokasi material: materialUpdates = [{id, gudang}], alokasiRows = [{id?, materialId, projectId, qty}]
  const allocateMaterials = useCallback((materialUpdates, alokasiRows) => {
    const rows = alokasiRows.map((r) => (r.id ? r : { ...r, id: genId("a") }));
    update((cur) => {
      cur.materials = cur.materials.map((m) => { const u = materialUpdates.find((x) => x.id === m.id); return u ? { ...m, ...u } : m; });
      rows.forEach((r) => {
        const i = cur.alokasi.findIndex((a) => a.materialId === r.materialId && a.projectId === r.projectId);
        if (i >= 0) cur.alokasi = cur.alokasi.map((a, j) => (j === i ? { ...a, qty: r.qty, id: a.id } : a));
        else cur.alokasi = [...cur.alokasi, r];
      });
    });
    guard(Promise.all([
      ...materialUpdates.map(({ id, ...patch }) => api.update("materials", id, patch)),
      api.upsert("alokasi", rows, "material_id,project_id"),
    ]));
  }, [update, guard]);

  // upsert laporan harian (1/project/tanggal) + perubahan posisi alat
  const upsertHarian = useCallback((row, toolChanges = []) => {
    update((cur) => {
      const i = cur.harian.findIndex((h) => h.id === row.id || (h.projectId === row.projectId && h.tanggal === row.tanggal));
      if (i >= 0) cur.harian = cur.harian.map((h, j) => (j === i ? row : h));
      else cur.harian = [row, ...cur.harian];
      toolChanges.forEach((tc) => { cur.tools = cur.tools.map((t) => (t.id === tc.id ? { ...t, lokasi: tc.lokasi, status: tc.status } : t)); });
    });
    guard(Promise.all([
      api.upsert("harian", [row], "project_id,tanggal"),
      ...toolChanges.map((tc) => api.update("tools", tc.id, { lokasi: tc.lokasi, status: tc.status })),
    ]));
  }, [update, guard]);

  const value = {
    db, loading, syncError, reload,
    update, addRows, patchRow, patchRows,
    updateProject, toggleHold, allocateMaterials, upsertHarian,
    genId,
    role, can, today,
    activeView, setActiveView,
    activeProject, setActiveProject,
    currentUser,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
