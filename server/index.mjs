// Self-hosted entrypoint. Vercel keeps using its existing api/ entrypoints.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './http-app.mjs';
import { validateRuntimeConfig } from './runtime-config.mjs';
import unifiedHandler from '../api/[route].js';
import araChat from '../api/ara-chat.js';
import cronReminder from '../api/cron-reminder.js';
import expenseSubmit from '../api/expense-submit.js';
import uploadToolbag from '../api/upload-toolbag.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
validateRuntimeConfig();
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid');
const server = createAppServer({
  unifiedHandler,
  directHandlers: {
    'ara-chat': araChat,
    'cron-reminder': cronReminder,
    'expense-submit': expenseSubmit,
    'upload-toolbag': uploadToolbag,
  },
  staticDir: path.join(root, 'dist'),
});
server.listen(port, '0.0.0.0', () => console.log(`AClean self-host HTTP listening on ${port}`));
