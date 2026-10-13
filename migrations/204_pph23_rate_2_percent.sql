-- Tarif PPh 23 jasa untuk dokumen baru: 2%. Nominal PPh pada invoice/quotation
-- yang sudah tersimpan tidak diubah agar riwayat dan PDF historis tetap cocok.
BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES ('pph23_rate', '0.02')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
WHERE public.app_settings.value IS DISTINCT FROM EXCLUDED.value;

COMMIT;
