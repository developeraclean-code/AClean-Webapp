// Dry run by default. --apply restores review suggestions only: no payment ledger,
// invoice status changes, AI calls, or WhatsApp messages. Requires migration 197.
import fs from 'node:fs';
import { ensurePaymentSuggestion, findPaymentInvoiceMatch, findSettledPaymentMedia, normalizePaymentClassification, updatePaymentMediaJob } from '../api/_payment-media.js';
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if(m && !(m[1] in process.env)) process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
  }
}
const supabaseUrl=process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_KEY;
if(!supabaseUrl || !serviceKey)throw new Error('Missing Supabase configuration');
const apply=process.argv.includes('--apply');
const jobAt=process.argv.indexOf('--job');
const jobId=jobAt<0 ? null : process.argv[jobAt+1];
if(jobAt>=0 && !/^[0-9a-f-]{36}$/i.test(jobId || ''))throw new Error('--job requires a media job UUID');
const headers={apikey:serviceKey,Authorization:`Bearer ${serviceKey}`};
const get=async path=>{
  const r=await fetch(`${supabaseUrl}/rest/v1/${path}`,{headers,signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`Read failed ${r.status}`);
  return r.json();
};
const jobs=[];
for(let offset=0;;offset+=200){
  const rows=await get(`wa_payment_media_jobs?select=*&category=eq.bukti_transfer&r2_url=not.is.null&status=in.(STORED,FAILED_RETRYABLE,FAILED_PERMANENT)${jobId ? `&id=eq.${jobId}` : ''}&order=created_at,id&limit=200&offset=${offset}`);
  jobs.push(...rows);if(rows.length<200)break;
}
const summary={apply,examined:jobs.length,eligible:0,restored:0,existing:0,alreadySettled:0,settledClosed:0,noOpenInvoice:0,failed:0};
for(const job of jobs){
  const existing=await get(`payment_suggestions?select=id,status&or=(media_job_id.eq.${job.id},image_url.eq.${encodeURIComponent(job.r2_url)})&limit=1`);
  if(existing.length){summary.existing++;continue;}
  const settled=await findSettledPaymentMedia({supabaseUrl,serviceKey,job});
  if(settled){
    summary.alreadySettled++;
    if(apply){
      const saved=await updatePaymentMediaJob({supabaseUrl,serviceKey,id:job.id,patch:{status:'DONE',invoice_id:settled.id,last_error:null,next_retry_at:null}});
      if(saved.ok)summary.settledClosed++;else summary.failed++;
    }
    continue;
  }
  const invoiceMatch=await findPaymentInvoiceMatch({supabaseUrl,serviceKey,phone:job.phone,amount:job.transfer_amount});
  // Historical receipts without an open invoice need manual reconciliation.
  if(!invoiceMatch.candidates.length){summary.noOpenInvoice++;continue;}
  summary.eligible++;
  if(!apply)continue;
  const result=await ensurePaymentSuggestion({supabaseUrl,serviceKey,job,classification:normalizePaymentClassification(job),invoiceMatch});
  if(!result.ok){summary.failed++;console.error(JSON.stringify({job:job.id,error:result.error}));continue;}
  const saved=await updatePaymentMediaJob({supabaseUrl,serviceKey,id:job.id,patch:{status:'DONE',invoice_id:result.invoice?.id || null,last_error:null,next_retry_at:null}});
  if(!saved.ok){summary.failed++;console.error(JSON.stringify({job:job.id,error:saved.error}));continue;}
  summary.restored++;console.log(JSON.stringify({restored:job.id,match:invoiceMatch.kind}));
}
console.log(JSON.stringify(summary));
if(summary.failed)process.exitCode=1;
