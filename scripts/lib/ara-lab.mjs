import { randomUUID } from 'node:crypto';
import { processAraCustomer, generateCustomerReply } from '../../api/_ara-customer.js';
import { createAraMemoryDb } from './ara-fixtures.mjs';

// Same customer pipeline as production; all writes and delivery stay in memory.
export async function runLabTurn({ snapshot, message, history = [], generate, mode = 'review' }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 6000) throw new Error('Pesan wajib diisi, maksimal 6.000 karakter');
  if (!Array.isArray(history) || history.length > 20 || history.some(x => !['customer','ara'].includes(x.role) || typeof x.content !== 'string' || x.content.length > 6000)) throw new Error('Riwayat percakapan tidak valid');
  if (!['review','auto_safe'].includes(mode)) throw new Error('Mode tidak valid');
  const db = createAraMemoryDb({ mode, settings: { ...snapshot.settings, wa_ara_mode: mode, wa_chatbot_enabled: 'true', wa_autoreply_enabled: 'false' } });
  const original = db.from.bind(db);
  db.from = table => {
    if (!['ara_brain','price_list','wa_messages'].includes(table)) return original(table);
    const data = table === 'ara_brain' ? {value:snapshot.brain} : table === 'price_list' ? snapshot.prices : [...history].reverse();
    return { select(){return this;}, or(){return this;}, eq(){return this;}, order(){return this;}, limit(){return this;}, maybeSingle(){return this;}, then(resolve,reject){return Promise.resolve({data}).then(resolve,reject);} };
  };
  let source='template', providerError=null;
  const result=await processAraCustomer({db,phone:'628000000001',message:message.trim(),sourceKey:randomUUID(),chatbotOn:true,autoOn:false,
    generate:async args=>{ source='AI'; try{return await (generate || (opts=>generateCustomerReply({...opts,recordUsage:async()=>{}})))(args);}catch(e){source='fallback';providerError=e.message;throw e;} },
    deliver:async()=>({status:'ACCEPTED'}),
  });
  const row=db.reviews.get(result.review_id);
  return {reply:row.reply,intent:row.intent,reasons:row.reasons,source,providerError,provider:snapshot.settings.llm_provider || 'claude',disposition:result.replied?'Otomatis (simulasi, tidak terkirim ke WA)':'Draf — perlu review admin',mode};
}
