import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWaConversations } from "../data/reads.js";
import { startWaConversationPolling } from "../lib/waConversationPolling.js";

export function useWaConversations({ supabase, enabled, onData }) {
  const controller = useRef(null), callback = useRef(onData);
  callback.current = onData;
  const [state, setState] = useState({ loading: false, error: "", updatedAt: null });
  useEffect(() => {
    if (!enabled) return;
    const poll = startWaConversationPolling({ load: async () => {
      const { data, error } = await fetchWaConversations(supabase, 100);
      if (error) throw new Error(error.message || "Gagal membaca percakapan");
      return data || [];
    }, onData: rows => callback.current(rows), onState: update => setState(previous => ({ ...previous, ...update })) });
    controller.current = poll;
    return () => { poll.stop(); controller.current = null; };
  }, [supabase, enabled]);
  const refresh = useCallback(() => controller.current?.refresh({ force: true }) ?? Promise.resolve({ skipped: true }), []);
  return { ...state, refresh };
}
