// Applied to frontend and backend events. Operational errors never need portal
// capabilities, business payloads, credentials, customer names or form contents.
export function monitoringUrl(value) {
  if(typeof value!=='string')return value;
  try {
    const absolute=/^https?:\/\//i.test(value),u=new URL(value,'https://monitoring.invalid');
    const path=u.pathname.replace(/\/(?:[a-f0-9]{48}|(?:mtk|ptk)_[a-z0-9]{40})(?=\/|$)/gi,'/[REDACTED]');
    return (absolute?u.origin:'')+path;
  } catch{return '[REDACTED]';}
}
export function sentryBeforeSend(event) {
  const result={...event};
  delete result.user;delete result.extra;delete result.contexts;delete result.fingerprint;delete result.transaction;
  if(result.request) result.request={method:result.request.method,url:monitoringUrl(result.request.url)};
  if(result.message)result.message='Application error';
  if(result.logentry)result.logentry={message:'Application error'};
  if(result.exception?.values)result.exception={...result.exception,values:result.exception.values.map(v=>({...v,value:v.type||'Application error',stacktrace:v.stacktrace?{...v.stacktrace,frames:v.stacktrace.frames?.map(f=>{
    const frame={...f,filename:monitoringUrl(f.filename),abs_path:monitoringUrl(f.abs_path)};
    delete frame.vars;delete frame.pre_context;delete frame.post_context;delete frame.context_line;return frame;
  })}:undefined}))};
  result.breadcrumbs=(result.breadcrumbs||[]).filter(b=>['fetch','xhr','http','navigation'].includes(b.category)).map(b=>({
    category:b.category,type:b.type,level:b.level,timestamp:b.timestamp,
    data:{method:b.data?.method,status_code:b.data?.status_code,url:monitoringUrl(b.data?.url),from:monitoringUrl(b.data?.from),to:monitoringUrl(b.data?.to)},
  }));
  // Do not attach application-defined tags: route is normalized separately.
  result.tags=result.tags?{route:monitoringUrl(result.tags.route),method:result.tags.method,component:result.tags.component}:undefined;
  return result;
}
