import { copyFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = await mkdtemp(join(tmpdir(), 'lifelog-cloudrun-'));

async function copy(relativePath) {
  const target = join(stage, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, relativePath), target);
}

async function copySource(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await copySource(path);
    if (entry.isFile() && ['.ts', '.sql', '.json'].includes(extname(entry.name))) await copy(path);
  }
}

for (const file of [
  'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json',
  'apps/server/package.json', 'apps/server/tsconfig.json', 'apps/server/tsconfig.build.json',
  'apps/web/package.json',
]) {
  await copy(file);
}
await copySource('apps/server/src');
await copySource('apps/server/migrations');
console.log(stage);
