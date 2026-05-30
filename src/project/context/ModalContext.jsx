import React, { createContext, useContext, useState, useCallback } from "react";

const Ctx = createContext(null);
export const useModal = () => useContext(Ctx);

// Modal generic + toast. openForm({title, fields, onSubmit, wide?}).
// openContent({content, wide?}) untuk modal isi custom.
export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null); // { kind:'form'|'content', ...config }
  const [toast, setToast] = useState(null);

  const close = useCallback(() => setModal(null), []);
  const openForm = useCallback((cfg) => setModal({ kind: "form", ...cfg }), []);
  const openContent = useCallback((cfg) => setModal({ kind: "content", ...cfg }), []);

  const showToast = useCallback((msg, dur = 1900) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), dur);
  }, []);

  return (
    <Ctx.Provider value={{ modal, openForm, openContent, close, toast: showToast }}>
      {children}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "#22c55e", color: "#04121f", fontWeight: 700, padding: "10px 18px", borderRadius: 10, zIndex: 80, fontSize: 13 }}>
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
