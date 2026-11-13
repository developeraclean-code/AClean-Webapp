import {it,expect} from 'vitest';
import {sentryBeforeSend,monitoringUrl} from '../sentryPrivacy.js';
it('strips capabilities, business details, local variables and identity from telemetry',()=>{
 const token='a'.repeat(48),secret='DO_NOT_TRANSMIT';
 const event={user:{email:secret},extra:{body:{phone:secret}},contexts:{auth:secret},request:{headers:{authorization:secret},data:secret,url:`https://app.aclean.id/status/${token}?key=${secret}`},message:secret,tags:{route:`/api/test?token=${secret}`,customer:secret},breadcrumbs:[{category:'console',message:secret},{category:'fetch',data:{url:`/api/test?token=${secret}`,body:secret}}],exception:{values:[{type:'Error',value:secret,stacktrace:{frames:[{filename:`https://app.aclean.id/assets/x.js?token=${secret}`,vars:{password:secret},context_line:secret}]}}]}};
 const safe=JSON.stringify(sentryBeforeSend(event));expect(safe).not.toContain(secret);expect(safe).not.toContain(token);expect(safe).toContain('/status/[REDACTED]');expect(event.user.email).toBe(secret);
});
it('normalizes relative and external URLs without queries or credentials',()=>{expect(monitoringUrl('/api/health?token=test')).toBe('/api/health');expect(monitoringUrl('https://u:p@fixture.invalid/a#secret')).toBe('https://fixture.invalid/a');});
