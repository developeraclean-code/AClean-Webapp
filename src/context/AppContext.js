import { createContext, useContext } from "react";

// Shared app-wide context — ubiquitous props that nearly every view needs
// Reduces props drilling for: currentUser, supabase, UI helpers, fmt, TODAY
export const AppContext = createContext(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppContext.Provider");
  return ctx;
}
