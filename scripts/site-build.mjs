import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export async function buildSite({ rootDirectory, outputDirectory }) {
  // Only replace our generated dist directory, never a source or workspace root.
  if (resolve(outputDirectory) !== resolve(rootDirectory, 'dist')) throw new Error('Build output must be the project dist directory');
  const sourceDirectory = join(rootDirectory, 'src');
  const hash = createHash('sha256');
  async function hashTree(directory, prefix = '') {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await hashTree(join(directory, entry.name), `${path}/`);
      else if (entry.isFile()) {
        const bytes = await readFile(join(directory, entry.name));
        hash.update(JSON.stringify([path, bytes.length]) + '\n');
        hash.update(bytes);
      } else throw new Error(`Unsupported build input: ${path}`);
    }
  }
  await hashTree(sourceDirectory);
  const version = hash.digest('hex').slice(0, 16);
  const resourcePrefix = `/assets/${version}/src/`;
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const path of ['src', 'admin', 'privacy', 'terms']) {
    await cp(join(rootDirectory, path), join(outputDirectory, path), { recursive: true });
  }
  // Moving the whole tree versions transitive module imports and CSS images too.
  await cp(sourceDirectory, join(outputDirectory, 'assets', version, 'src'), { recursive: true });
  for (const page of ['index.html', 'admin/index.html', 'privacy/index.html', 'terms/index.html']) {
    const html = await readFile(join(rootDirectory, page), 'utf8');
    await writeFile(join(outputDirectory, page), html.replace(/((?:src|href)=["'])(?:\.\/|\.\.\/)src\//g, `$1${resourcePrefix}`));
  }
  return { version, resourcePrefix };
}
