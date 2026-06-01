-- Migration 054: Rate limiter terdistribusi via tabel Supabase (M-02)
-- Pengganti in-memory Map yang tidak efektif di serverless Vercel (tiap instance memori sendiri).
-- Dipakai oleh api/_auth.js checkRateLimit() bila Vercel KV tidak diset → gratis, pakai DB yang ada.
--
-- bucket_key = "<ip>:<windowStart>" → tiap window punya baris sendiri, jadi hitungan akurat & atomic.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key  text PRIMARY KEY,
  count       int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rlc_expires ON rate_limit_counters (expires_at);

-- RLS aktif tanpa policy anon = default deny. Backend pakai service key (bypass RLS).
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Fungsi atomic: increment counter untuk bucket, return count terbaru.
-- SECURITY DEFINER agar bisa tulis walau RLS aktif. Cleanup probabilistik (1%) supaya tabel ramping.
CREATE OR REPLACE FUNCTION rl_hit(p_key text, p_ttl int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c int;
BEGIN
  INSERT INTO rate_limit_counters (bucket_key, count, expires_at)
  VALUES (p_key, 1, now() + make_interval(secs => p_ttl))
  ON CONFLICT (bucket_key)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO c;

  IF random() < 0.01 THEN
    DELETE FROM rate_limit_counters WHERE expires_at < now();
  END IF;

  RETURN c;
END;
$$;

-- Hanya service_role (backend) yang boleh panggil — cegah anon membuat-buat baris.
REVOKE ALL ON FUNCTION rl_hit(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rl_hit(text, int) TO service_role;
