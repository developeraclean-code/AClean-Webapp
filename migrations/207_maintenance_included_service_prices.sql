-- Harga Rp0 yang disepakati sebagai bagian penawaran harus dibedakan dari
-- tarif kosong/belum diatur. Tidak mengubah tarif/ledger/kontrak yang sudah ada.
ALTER TABLE public.maintenance_client_prices
  ADD COLUMN IF NOT EXISTS included_in_service boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.maintenance_client_prices'::regclass
      AND conname = 'mcp_included_service_zero_price'
  ) THEN
    ALTER TABLE public.maintenance_client_prices
      ADD CONSTRAINT mcp_included_service_zero_price
      CHECK (NOT included_in_service OR
        (unit_price = 0 AND NULLIF(btrim(ac_type), '') IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.maintenance_client_prices.included_in_service IS
  'Explicit included-in-offer rate: zero charge with a specified AC type. False + zero remains unconfigured, not a free-service approval.';

NOTIFY pgrst, 'reload schema';
