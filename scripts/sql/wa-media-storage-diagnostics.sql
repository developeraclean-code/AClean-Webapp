-- Read-only: recent WhaCenter media receipts, R2 references and chat preview links.
-- Deliberately omits phone numbers, message contents, media URLs and tokens.
SELECT receipt.created_at,
       receipt.id AS receipt_id,
       receipt.msg_type,
       receipt.intake_status,
       jsonb_typeof(receipt.payload->'media') AS media_field_type,
       coalesce(length(receipt.payload->>'media'),0)>0 AS media_field_present,
       job.id AS media_job_id,
       job.status AS media_status,
       job.category,
       job.r2_key IS NOT NULL AS r2_reference_saved,
       job.r2_url IS NOT NULL AS r2_url_saved,
       message.image_url IS NOT NULL AS chat_preview_linked,
       message.image_url=job.r2_url AS preview_matches_job
FROM public.wa_webhook_raw AS receipt
LEFT JOIN public.wa_messages AS message ON message.id::text=receipt.message_id
LEFT JOIN public.wa_payment_media_jobs AS job ON job.wa_message_id=receipt.message_id
WHERE receipt.created_at>now()-interval '2 hours'
  AND receipt.payload->>'provider'='whacenter'
  AND (receipt.msg_type IN ('image','document') OR coalesce(length(receipt.payload->>'media'),0)>0)
ORDER BY receipt.created_at DESC
LIMIT 30;
