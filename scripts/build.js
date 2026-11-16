import { copyFile } from 'node:fs/promises';
import { build } from 'vite';

await build();

if (process.env.GITHUB_ACTIONS === 'true') {
  await copyFile('dist/index.html', 'dist/404.html');
}
