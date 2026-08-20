import { useState, useEffect } from "react";

// Hook generik: kembalikan `value` yang tertunda `delay` ms sejak perubahan
// terakhir (mis. tunda pencarian sampai user berhenti mengetik). Diekstrak dari
// App.jsx (de-monolith bertahap, 20 Agu 2026) — murni, tanpa kopling App.
export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}
