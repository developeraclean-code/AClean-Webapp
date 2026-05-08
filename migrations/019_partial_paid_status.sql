-- Migration 019: Add PARTIAL_PAID to invoice status constraint
-- Tujuan: Mendukung tracking DP / cicilan secara eksplisit di status
-- Sebelumnya: PARTIAL_PAID dipakai di code tapi DB constraint reject → crash
--
-- Catatan: Ada 2 constraint berbeda di `invoices.status` (legacy + new),
-- keduanya harus diupdate untuk menerima PARTIAL_PAID.

-- ── chk_invoices_status (constraint baru) ──
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_status;

ALTER TABLE invoices ADD CONSTRAINT chk_invoices_status
  CHECK (status IS NULL OR status = ANY (ARRAY[
    'DRAFT'::text,
    'PENDING_APPROVAL'::text,
    'APPROVED'::text,
    'SENT'::text,
    'UNPAID'::text,
    'PARTIAL_PAID'::text,
    'PAID'::text,
    'OVERDUE'::text,
    'CANCELLED'::text
  ]));

-- ── invoices_status_check (constraint legacy) ──
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'DRAFT'::text,
    'PENDING'::text,
    'PENDING_APPROVAL'::text,
    'APPROVED'::text,
    'SENT'::text,
    'UNPAID'::text,
    'PARTIAL_PAID'::text,
    'PAID'::text,
    'OVERDUE'::text,
    'CANCELLED'::text
  ]));
