import { fileURLToPath } from 'node:url';
import { buildSite } from './site-build.mjs';

const result = await buildSite({
  rootDirectory: fileURLToPath(new URL('../', import.meta.url)),
  outputDirectory: fileURLToPath(new URL('../dist/', import.meta.url)),
});
console.log(`Built resource version: ${result.version}`);
