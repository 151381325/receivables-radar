import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/site-build.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'radar-version-build-'));
  for (const path of ['src/assets', 'admin', 'privacy', 'terms']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'index.html'), '<link href="./src/styles.css"><script type="module" src="./src/main.js"></script>');
  for (const path of ['admin', 'privacy', 'terms']) await writeFile(join(root, path, 'index.html'), '<link href="../src/styles.css">');
  await writeFile(join(root, 'src/main.js'), "import './dependency.js';");
  await writeFile(join(root, 'src/dependency.js'), 'export const value = 1;');
  await writeFile(join(root, 'src/styles.css'), '.icon { background: url(./assets/icon.svg); }');
  await writeFile(join(root, 'src/assets/icon.svg'), '<svg/>');
  return root;
}

test('built HTML references a versioned full resource tree, including nested imports and CSS assets', async () => {
  const root = await fixture();
  await buildSite({ rootDirectory: root, outputDirectory: join(root, 'dist') });
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  const entry = html.match(/src="(\/assets\/[a-f0-9]{16}\/src\/main\.js)"/)?.[1];
  assert.ok(entry, 'entry module must have a content-versioned URL');
  assert.equal(await readFile(join(root, 'dist', entry, '../dependency.js'), 'utf8'), 'export const value = 1;');
  const prefix = entry.slice(0, -'main.js'.length);
  assert.ok(html.includes(`href="${prefix}styles.css"`));
  for (const page of ['admin', 'privacy', 'terms']) {
    assert.ok((await readFile(join(root, 'dist', page, 'index.html'), 'utf8')).includes(`href="${prefix}styles.css"`));
  }
  assert.equal(await readFile(join(root, 'dist', prefix, 'assets/icon.svg'), 'utf8'), '<svg/>');
  // Existing pages already open at deployment must still be able to fetch legacy URLs.
  assert.equal(await readFile(join(root, 'dist/src/dependency.js'), 'utf8'), 'export const value = 1;');
});

test('unchanged sources reuse URLs, a nested dependency edit changes all entry URLs', async () => {
  const root = await fixture();
  const build = async () => {
    await buildSite({ rootDirectory: root, outputDirectory: join(root, 'dist') });
    return readFile(join(root, 'dist/index.html'), 'utf8');
  };
  const first = await build();
  assert.equal(await build(), first);
  await writeFile(join(root, 'src/dependency.js'), 'export const value = 2;');
  assert.notEqual(await build(), first, 'transitive imports must not reuse cached old modules');
});
