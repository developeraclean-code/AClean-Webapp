-- 189 — Metode pembayaran quotation yang eksplisit dan dapat diaudit.
-- Existing quotation dianggap Transfer Full agar PDF lama tetap konsisten.

BEGIN;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'FULL_TRANSFER',
  ADD COLUMN IF NOT EXISTS down_payment_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_payment_method_check,
  DROP CONSTRAINT IF EXISTS quotations_down_payment_amount_check;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_payment_method_check
    CHECK (payment_method IN ('FULL_TRANSFER', 'DOWN_PAYMENT')),
  ADD CONSTRAINT quotations_down_payment_amount_check
    CHECK (
      down_payment_amount >= 0
      AND down_payment_amount <= total
      AND (
        (payment_method = 'FULL_TRANSFER' AND down_payment_amount = 0)
        OR (payment_method = 'DOWN_PAYMENT' AND down_payment_amount > 0)
      )
    );

COMMENT ON COLUMN public.quotations.payment_method IS
  'FULL_TRANSFER atau DOWN_PAYMENT; sumber kebenaran term pembayaran quotation.';
COMMENT ON COLUMN public.quotations.down_payment_amount IS
  'Nominal DP final dalam rupiah. Wajib 0 untuk FULL_TRANSFER dan >0 untuk DOWN_PAYMENT.';

COMMIT;
