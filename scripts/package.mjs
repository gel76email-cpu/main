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
await writeFile('artifacts/facebook-commenti-excel.zip', zipSync(await files('dist'), { level: 6 }));
console.log('Pacchetto creato: artifacts/facebook-commenti-excel.zip');
