# ARA: review-first rollout

Local changes and validation, 7 October 2026 (WIB).

## Sumber aturan dan sinkronisasi

Aturan runtime utama ada di `src/lib/araPolicy.js` (versi 2026-10-07). Dokumen ini, SOP Admin, panduan WhatsApp dan CLAUDE.md menjelaskan aturan yang sama. File Markdown repo tidak dimuat otomatis sebagai Brain: `ara_brain.brain_md`/`brain_customer` serta `app_settings.ara_training_rules` tetap merupakan konfigurasi tambahan. Isinya tidak ditimpa pada perubahan lokal ini; aturan wajib server mengungguli contoh/Brain lama.

Setiap draf dan balasan customer ARA (template, hasil model maupun fallback) diakhiri penanda persis **`- Auto Reply by ARA -`**. Sistem menambahkannya sekali di batas keluaran sebelum disimpan/dikirim. Draf lama juga diberi penanda ketika ditampilkan/disalin. Balasan admin manual murni, chat internal ARA, invoice dan cron tidak dilabeli otomatis. Admin tetap dapat menyunting composer; pertahankan penanda bila mengirim draf ARA. Penanda bukan bukti pengiriman, pembacaan atau verifikasi pembayaran.

### Respons bukti transfer — wajib tinjau admin

Customer: “Ini saya sudah transfer DP, tolong dicek.”

> Terima kasih, Pak/Bu. Bukti transfernya perlu diverifikasi admin terlebih dahulu. Boleh diinformasikan atas nama siapa pembayarannya? Informasi ini membantu kami memverifikasi pengirim transfer.
>
> - Auto Reply by ARA -

Pertanyaan umum tentang rekening/tagihan tidak dianggap sebagai bukti transfer yang sudah diterima; minta referensi invoice/quotation untuk pemeriksaan admin.

### Respons komplain — wajib tinjau admin

Customer: “Kemarin baru dicuci, sekarang bocor lagi. Masih garansi kan?”

> Mohon maaf, Pak/Bu, atas ketidaknyamanannya sehingga AC-nya masih bermasalah. Boleh kirim foto atau video bagian yang bocor/kendala serta informasikan unit mana yang masih terkendala? Admin perlu memeriksa riwayat servis dan ketentuan garansinya sebelum memastikan tindak lanjut.
>
> - Auto Reply by ARA -

Kedua template tidak mengonfirmasi lunas, gratis garansi, jadwal kunjungan, atau bahwa eskalasi sudah dilakukan. Mode `auto_safe` tidak memperluas kedua respons menjadi kirim otomatis.

## Behavior

- Uploaded `ara_training_rules` is validated and used as bounded, relevant examples in internal ARA and customer drafts. This is prompt context, not model fine-tuning or automatic learning from all WhatsApp history.
- Server loads saved brain, training and live `harga_layanan`; client-provided brain/prices cannot override them. Missing configuration produces a visible error/review record.
- Internal ARA uses internal SOP when the saved brain is accidentally a customer SOP. Existing stored text is preserved. Built-in default no longer embeds old prices or automatic payment instructions.
- Regular scheduling ends at 18:00. Night requests require confirmation of available technician/helper assignments. ARA cannot confirm a slot from partial browser data.
- Internal `[ACTION]` output becomes proposals linking to the established modules. Chat never directly changes invoices, payments, stock, orders or expenses, and never sends WhatsApp. Invoice proposals go to Laporan Tim for actual verified reports including multi-team work.
- Aggregate internal context is explicitly partial; use Finance/Statistics for final business totals.

## Customer replies

Both existing chatbot/auto-reply switches still apply. Merely installing the code does not enable them.

`wa_ara_mode=review` is the default: all responses enter a separate review queue. Open WhatsApp, select a conversation, open **Draf ARA**, review, and copy into the message composer. Copying is not sending. The existing Send button/outbox handles delivery.

`wa_ara_mode=auto_safe` only automatically sends deterministic exact greetings and thanks. Model-generated replies, mixed intents, prices, booking, payment/DP, warranty, complaints, status and refunds require admin review. Uploaded training cannot expand this automatic-send allowance.

Customer prompts contain no other customer's records and no verified invoice/order status. High-risk intents get bounded acknowledgments or requests for details, never confirmations of settlement, free warranty, refunds or availability. Model replies are additionally checked for internal action tags, explicit success claims and unsupported price amounts. Supported price totals include unit price × quantity stated by the customer.

Review records are separate from `wa_messages`; drafts never become conversation history. Automatic delivery uses `claim_wa_send`/`finish_wa_send`, with one gateway attempt, checked acceptance, recorded uncertainty and replay suppression. Provider message ID is preferred; without it, fallback dedup includes sender, text and timestamp/five-minute bucket. Identical repeat text within that fallback bucket may be suppressed.

## Verification

- Unit/integration tests cover training failures, policy, internal role checks, API failures, duplicate clicks, no direct business mutations, current-message history duplication, kill switch, review-only behavior, 200 concurrent webhook replays, and 200 simulated customer workflows (20 scenario types × 10).
- Browser tests use real AraView/AraReviewPanel components with isolated synthetic data on desktop/mobile. No production connection or customer messages.
- Live Claude: 20 synthetic customer scenarios returned successfully. Initial output guards flagged a correct two-unit total and a refusal mentioning API keys; guards were corrected and regression-tested.
- Live OpenAI: 15 successful scenarios, then HTTP 429 `rate_limit_exceeded`; remaining five succeeded on a later invocation. This was a rate limit, not proof of exhausted billing credit. One conservative warranty-refusal guard was corrected and regression-tested.
- These model calls do not prove real-customer accuracy or WhatsApp delivery. No customer was contacted and production toggles/data were unchanged.

Commands:

```sh
npm run test:ara
npm run test:ara-200
npm test
npm run lint
npm run build
node scripts/evaluate-ara.mjs --live --provider=claude
node scripts/evaluate-ara.mjs --live --provider=openai
node scripts/evaluate-ara.mjs --live --provider=openai --from=15
node node_modules/@playwright/test/cli.js test --config=e2e/ara-review.config.js
npm run preview:ara
```

Live evaluation reads only provider keys from `.env.local`, uses synthetic data and disables production usage logging. It has API cost; it never calls Fonnte or writes Supabase.

## Deployment order and limits

1. Apply migration **196_ara_review_queue.sql** before enabling the changed customer path. It creates review storage with Owner/Admin SELECT and an authorized row-locked review RPC. It does not alter historical transactions or activate chatbot switches.
2. Deploy and verify admin access, helper denial, receiving one test message and draft visibility using an explicitly designated test number.
3. Start with **Tinjau Admin**. Evaluate reviewed drafts against actual conversations before using automatic greetings.

Migration 196 was applied to production on 7 October 2026, recorded as `20261007043032196`. Before commit, the DDL and review RPC were rehearsed in a rolled-back transaction on the production schema: Owner/Admin could read/resolve, Helper/Teknisi could not. No synthetic rows remain. `wa_ara_mode=review`; both chatbot/auto-reply toggles remain OFF. End-to-end webhook and real gateway delivery still need a designated test number after deployment. Failures in draft storage block automatic sending and are logged for Monitoring.

Latest local validation: 895 tests passed in 94 files; 200 simulated workflows with zero real WhatsApp sends; desktop/mobile review-and-signature tests passed; lint and production build passed. Twenty synthetic live scenarios per provider measure successful responses, not a statistically validated customer-answer accuracy percentage. Review-first is ready for controlled rollout; autonomous prices, booking, payments and warranty decisions remain out of scope.

This release deliberately does not enable broad autonomous customer replies or restore the removed bespoke ARA transaction mutations. Continued evaluation should measure factual accuracy, admin edits, handoff completion, queue latency and provider failures. No statistically measured 90% real-customer accuracy is claimed from 20 synthetic scenarios.
