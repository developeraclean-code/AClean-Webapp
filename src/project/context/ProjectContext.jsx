import React, { createContext, useContext, useState, useCallback } from "react";
import { initialData } from "../data/sampleData.js";

const Ctx = createContext(null);
export const useProject = () => useContext(Ctx);

export function ProjectProvider({ currentUser, children }) {
  const [db, setDb] = useState(() => initialData());
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

  // helpers (functional setters supaya tidak stale)
  const update = useCallback((fn) => setDb((cur) => { const next = { ...cur }; fn(next); return next; }), []);
  const updateProject = useCallback((pid, patch) => update((d) => { d.projects = d.projects.map((p) => (p.id === pid ? { ...p, ...patch } : p)); }), [update]);
  const toggleHold = useCallback((pid) => {
    const p = db.projects.find((x) => x.id === pid);
    if (!p) return;
    if (p.status === "SELESAI") return;
    if (p.status === "HOLD") updateProject(pid, { status: p._prev || "BERJALAN" });
    else updateProject(pid, { _prev: p.status, status: "HOLD" });
  }, [db.projects, updateProject]);

  const value = {
    db, setDb, update, updateProject, toggleHold,
    role, can, today,
    activeView, setActiveView,
    activeProject, setActiveProject,
    currentUser,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
