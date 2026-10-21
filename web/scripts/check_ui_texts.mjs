// Vérifie que chaque texte passé à L() a une traduction complète dans src/i18n/uiTexts.ts,
// que les placeholders {x} sont identiques dans toutes les langues et qu'aucune clé n'est orpheline.
// Usage : npm run check:i18n
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !p.endsWith(path.join('i18n', 'uiTexts.ts'))) files.push(p);
  }
};
walk(SRC);

const used = new Set();
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/\bL\(\s*("(?:[^"\\]|\\.)*")/g)) used.add(JSON.parse(m[1]));
}

const table = new Map();
for (const m of fs.readFileSync(path.join(SRC, 'i18n', 'uiTexts.ts'), 'utf8').matchAll(/^ {2}("(?:[^"\\]|\\.)*"): (\[.*\]),$/gm)) {
  table.set(JSON.parse(m[1]), JSON.parse(m[2]));
}

const fields = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const errors = [];
for (const k of used) if (!table.has(k)) errors.push(`sans traduction : ${k}`);
for (const [k, tr] of table) {
  if (!used.has(k)) errors.push(`clé orpheline : ${k}`);
  if (tr.length !== 3 || tr.some((t) => !t.trim())) errors.push(`traduction incomplète : ${k}`);
  else tr.forEach((t, i) => fields(t) !== fields(k) && errors.push(`placeholders (${['en', 'it', 'es'][i]}) : ${k}`));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK : ${used.size} textes traduits en anglais, italien et espagnol.`);
