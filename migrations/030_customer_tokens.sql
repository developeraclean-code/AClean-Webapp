-- Tabel token untuk customer self-service portal
-- Token dikirim via WA saat dispatch, berlaku 7 hari

CREATE TABLE IF NOT EXISTS customer_tokens (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         text NOT NULL,
  token         text NOT NULL UNIQUE,
  customer_name text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz DEFAULT now(),
  last_used     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_customer_tokens_token ON customer_tokens(token);
CREATE INDEX IF NOT EXISTS idx_customer_tokens_phone ON customer_tokens(phone);

ALTER TABLE customer_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full" ON customer_tokens FOR ALL USING (true) WITH CHECK (true);
