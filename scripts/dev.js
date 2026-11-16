import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const api = spawn(process.execPath, ['server/index.js'], {
  stdio: 'inherit',
  env: process.env,
});
const waitForApi = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (api.exitCode !== null) throw new Error(`Remint API exited with code ${api.exitCode}.`);
    try {
      const response = await fetch('http://127.0.0.1:4179/api/health');
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Remint API did not become ready within six seconds.');
};
let vite;
let closing = false;

try {
  await waitForApi();
  vite = await createServer({ server: { host: '127.0.0.1' } });
  await vite.listen();
  console.log('Remint is ready. Open the local URL above.');
} catch (error) {
  api.kill();
  throw error;
}

const shutdown = async () => {
  if (closing) return;
  closing = true;
  await vite.close();
  if (api.exitCode === null) api.kill();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
api.on('exit', (code) => {
  if (code && !closing) {
    console.error(`Remint API stopped unexpectedly (exit ${code}).`);
    shutdown();
  }
});
