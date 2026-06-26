import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { initialData } from "../data/sampleData.js";
import { loadAll, api, genId, ASC } from "../data/projectApi.js";
import { reportError } from "../../lib/reportError.js";

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

export function ProjectProvider({ currentUser, apiFetch, appSettings = {}, children }) {
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
    delete: role === "Owner",  // hapus data Project = Owner only (lewat endpoint service-key)
  };
  const today = new Date().toISOString().slice(0, 10);

  // ── load awal dari Supabase ───────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const data = await loadAll();
      setDb(data);
      setSyncError(null);
    } catch (e) {
      reportError("project.reload", e);
      setSyncError(e.message || "Gagal memuat data Project");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => { setLoading(true); await reload(); if (alive) setLoading(false); })();
    return () => { alive = false; };
  }, [reload]);

  // Default activeProject ke project pertama bila belum ada yang dipilih
  // (mis. user klik langsung "Keuangan Project"/"Detail Project" dari menu, belum lewat Daftar Project).
  useEffect(() => {
    if (!activeProject && db.projects.length) setActiveProject(db.projects[0].id);
  }, [db.projects, activeProject]);

  // ── helpers state lokal (optimistic) ──────────────────────────────────────
  const update = useCallback((fn) => setDb((cur) => { const next = { ...cur }; fn(next); return next; }), []);

  // jalankan persist; bila gagal → tampilkan error + muat ulang (revert optimistic)
  const guard = useCallback(async (promise) => {
    try { await promise; setSyncError(null); }
    catch (e) { reportError("project.guard.persist", e); setSyncError("Gagal menyimpan ke server — data dimuat ulang."); await reload(); }
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

  // ── hapus baris (lewat endpoint service-key; RLS anon tak punya hak DELETE) ──
  const deleteRow = useCallback(async (key, id) => {
    const prev = db[key];
    update((cur) => { cur[key] = cur[key].filter((r) => r.id !== id); });
    try {
      if (!apiFetch) throw new Error("apiFetch tidak tersedia");
      const res = await apiFetch("/api/project-delete", {
        method: "POST",
        body: JSON.stringify({ table: `project_${key}`, id }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      setSyncError(null);
      // hapus project/material → DB cascade (dp/harian/alokasi/dst) → muat ulang biar konsisten
      if (key === "projects" || key === "materials") await reload();
    } catch (e) {
      reportError("project.deleteRow", e, { key, id });
      setSyncError("Gagal menghapus: " + (e.message || e));
      update((cur) => { cur[key] = prev; });  // revert
    }
  }, [db, update, apiFetch, reload]);

  // ── upload foto ke R2 (lewat /api/upload-foto). files: [{name, dataUrl}] ──
  // return array URL proxy (/api/foto?key=...). Gagal upload → lempar error.
  const uploadPhotos = useCallback(async (files, folder) => {
    if (!files?.length) return [];
    if (!apiFetch) throw new Error("apiFetch tidak tersedia");
    const urls = [];
    for (const f of files) {
      const res = await apiFetch("/api/upload-foto", {
        method: "POST",
        body: JSON.stringify({ base64: f.dataUrl, filename: f.name || `foto_${Date.now()}.jpg`, folder, mimeType: "image/jpeg" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.key) throw new Error(d.error || `upload gagal HTTP ${res.status}`);
      urls.push(`/api/foto?key=${encodeURIComponent(d.key)}`);
    }
    return urls;
  }, [apiFetch]);

  const value = {
    db, loading, syncError, reload,
    update, addRows, patchRow, patchRows,
    updateProject, toggleHold, allocateMaterials, upsertHarian,
    deleteRow, uploadPhotos, genId,
    role, can, today,
    activeView, setActiveView,
    activeProject, setActiveProject,
    currentUser, appSettings,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
