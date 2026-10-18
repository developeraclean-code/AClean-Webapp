import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
test('Owner sees a working toggle; staff do not receive configuration access', async ({ page }) => {
  const result = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import Panel from './src/views/FieldReportReminderSettings.jsx';
    function App(){const[enabled,setEnabled]=useState(false);const[role,setRole]=useState('Owner');return <main style={{maxWidth:700,margin:'auto'}}>
      <label>Role<select aria-label="Role" value={role} onChange={e=>setRole(e.target.value)}><option>Owner</option><option>Admin</option><option>Helper</option><option>Teknisi</option></select></label>
      <Panel currentUser={{role}} enabled={enabled} onToggle={setEnabled}/><output>{enabled?'SAVED_ON':'SAVED_OFF'}</output></main>};
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('https://field-report.test/')) external.push(r.url()); });
  await page.route('https://field-report.test/**', route => route.fulfill({ contentType: route.request().url().endsWith('.js') ? 'application/javascript' : 'text/html',
    body: route.request().url().endsWith('.js') ? result.outputFiles[0].text : '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>' }));
  await page.goto('https://field-report.test/');
  const toggle = page.getByRole('switch', { name: 'Pengingat laporan tim setelah 20.00' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('output')).toHaveText('SAVED_ON'); await toggle.click(); await expect(page.locator('output')).toHaveText('SAVED_OFF');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  for (const role of ['Admin', 'Helper', 'Teknisi']) { await page.getByLabel('Role', { exact: true }).selectOption(role); await expect(toggle).toHaveCount(0); }
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
