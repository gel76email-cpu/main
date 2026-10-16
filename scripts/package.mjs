import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

async function files(directory, prefix = '') {
  const entries = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    if (item.isDirectory()) Object.assign(entries, await files(`${directory}/${item.name}`, `${relative}/`));
    else entries[relative] = await readFile(`${directory}/${item.name}`);
  }
  return entries;
}
await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = zipSync(await files('dist'), { level: 6 });
await writeFile('artifacts/facebook-commenti-excel.zip', archive);
await writeFile(`artifacts/facebook-commenti-excel-${version}.zip`, archive);
console.log(`Pacchetti creati: artifacts/facebook-commenti-excel.zip e artifacts/facebook-commenti-excel-${version}.zip`);
