// Explicit, synthetic INFO event. Reads DSNs in memory; never prints credentials.
import {readFile} from 'node:fs/promises';
import * as Sentry from '@sentry/node';
import {sentryBeforeSend} from '../src/lib/sentryPrivacy.js';
const file=process.argv[2];if(!file)throw new Error('Pass the existing local environment file explicitly');
const source=await readFile(file,'utf8');const results=[];
for(const key of ['VITE_SENTRY_DSN','SENTRY_DSN']){
 const raw=source.match(new RegExp(`^${key}\\s*=\\s*(.*)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'');
 if(!raw){results.push({component:key,present:false});continue;}
 let status=null;
 Sentry.init({dsn:raw,environment:'connectivity-verification',release:'voucher-hardening-local',tracesSampleRate:0,sendDefaultPii:false,sendClientReports:false,beforeSend:sentryBeforeSend,defaultIntegrations:false,transportOptions:{keepAlive:false}});
 const client=Sentry.getClient();client.on('afterSendEvent',(_,response)=>{status=response?.statusCode||null;});
 const event_id=Sentry.captureMessage('AClean monitoring connectivity probe',{level:'info',tags:{component:'monitoring-connectivity-probe'}});
 const flushed=await Sentry.flush(10000);await Sentry.close(2000);
 results.push({component:key,event_id,http_status:status,flushed,ingestion_accepted:status===200});
}
console.log(JSON.stringify({scope:'synthetic local SDK probe to existing DSNs; does not prove production instrumentation or dashboard alerts',results},null,2));
if(results.some(r=>!r.ingestion_accepted))process.exitCode=1;
