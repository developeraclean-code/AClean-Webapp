import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
test('Owner can read findings and backup state; other roles cannot fetch or view it', async ({ page }) => {
  const result = await build({ stdin: { contents: `import React,{useState,useMemo} from 'react';import{createRoot}from'react-dom/client';
    import Panel from './src/views/RecoveryStatusPanel.jsx';
    window.rpcCalls=0;window.rpcMode='ok';
    function App(){const[role,setRole]=useState('Owner');const[refresh,setRefresh]=useState(0);
      const db=useMemo(()=>({rpc:async(name)=>{if(name!=='get_operational_recovery_status_216')throw Error('wrong RPC');window.rpcCalls++;
        return window.rpcMode==='fail'?{error:{message:'RPC unavailable'}}:{data:{audit:{checked_at:'2026-10-18T00:00:00Z',critical:1,actionable:1,
          findings:[{check:'inventory_negative',severity:'critical',n:1,sample:'SKU-SIMULASI'}]},backup:{at:'2026-10-18T00:00:00Z',tables:51,encrypted:true}}};}}),[]);
      return <main style={{maxWidth:700,margin:'auto',color:'#eee'}}><label>Role<select aria-label="Role" value={role} onChange={e=>setRole(e.target.value)}>
        {['Owner','Admin','Finance','Helper','Teknisi'].map(r=><option key={r}>{r}</option>)}</select></label>
        <button onClick={()=>setRefresh(n=>n+1)}>Refresh status</button><Panel currentUser={{role}} supabase={db} refreshKey={refresh}/></main>};
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('https://recovery.test/')) external.push(r.url()); });
  await page.route('https://recovery.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'application/javascript' : 'text/html',
    body: route.request().url().endsWith('.js') ? result.outputFiles[0].text : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f20"><div id="root"></div><script src="/bundle.js"></script></body></html>' }));
  await page.goto('https://recovery.test/');
  const panel = page.getByRole('region', { name: 'Audit dan pemulihan data' });
  await expect(panel).toContainText('inventory_negative: 1'); await expect(panel).toContainText('51 tabel');
  await expect(panel).toContainText('Tidak ada perbaikan data otomatis');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const calls = await page.evaluate(() => window.rpcCalls);
  for (const role of ['Admin','Finance','Helper','Teknisi']) {
    await page.getByLabel('Role', { exact: true }).selectOption(role); await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => window.rpcCalls)).toBe(calls);
  }
  await page.evaluate(() => {window.rpcMode='fail';});
  await page.getByLabel('Role', { exact: true }).selectOption('Owner');
  await expect(panel).toContainText('Status belum dapat dibaca'); await expect(panel).toContainText('216');
  await expect(panel).not.toContainText('inventory_negative');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
