import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPendingPaymentSuggestions, startPaymentInboxPolling } from "../lib/paymentInbox.js";

export function usePaymentInbox({ supabase, userId, enabled, onData, onNew, onFailure }) {
  const controller = useRef(null);
  const callbacks = useRef({ onData, onNew, onFailure });
  callbacks.current = { onData, onNew, onFailure };
  const [state, setState] = useState({ loading: false, error: null, updatedAt: null });
  useEffect(() => {
    setState({ loading: false, error: null, updatedAt: null });
    callbacks.current.onData?.([]); // Drop a previous user's financial inbox on role/session changes.
    if (!enabled || !userId) return;
    const poll = startPaymentInboxPolling({
      load: options => fetchPendingPaymentSuggestions(supabase, options),
      onData: rows => callbacks.current.onData?.(rows),
      onNew: rows => callbacks.current.onNew?.(rows),
      onState: update => {
        setState(previous => ({ ...previous, ...update }));
        if (update.failures === 3) callbacks.current.onFailure?.(update.error);
      },
    });
    controller.current = poll;
    return () => { poll.stop(); controller.current = null; };
  }, [supabase, userId, enabled]);
  const refresh = useCallback(() => controller.current?.refresh({ force: true }) ?? Promise.resolve(null), []);
  return { ...state, enabled, refresh };
}
