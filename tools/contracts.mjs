// Vertragskarte + Invarianten-Prüfung (Leitfaden §8.1, §8.3).
//
//   node tools/contracts.mjs           schreibt docs/contracts.md
//   node tools/contracts.mjs --check   prüft, ohne zu schreiben:
//       1. docs/contracts.md ist aktuell
//       2. Rechenkerne aus THREE_FREE importieren three weder direkt noch transitiv
//       3. Dateideckel: neue Dateien ≤ LINE_CAP, Bestandsdateien wachsen nicht
//
// Bewusst ohne Abhängigkeiten (kein TypeScript-Compiler): läuft überall, und die
// Ausgabe hängt nicht an einer Compiler-Version. Der Parser erwartet den Stil des
// Projekts — `export` in Spalte 0, Klassenmitglieder mit zwei Leerzeichen Einzug.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'docs/contracts.md';

// — Konfiguration ——————————————————————————————————————————————
// Agenten: THREE_FREE darf nur wachsen, CAP_BASELINE nur schrumpfen (AGENTS.md).

/** Rechenkerne, die in Worker, Main-Thread und Node identisch laufen müssen (§5). */
const THREE_FREE = [
  'src/frames/',
  'src/nav/',
  'src/camera/cameraTouch.ts',
  'src/terrain/tileGeometry.ts',
  'src/terrain/noise.ts',
  'src/math/rng.ts',
];

const LINE_CAP = 300;

/** Bestand über dem Deckel bei Einführung (v0.4.1). Wert = Obergrenze, nicht Ziel. */
const CAP_BASELINE = {
  'src/core/Engine.ts': 496,
  'src/terrain/TerrainProvider.ts': 442,
  'src/terrain/gpuTerrain.ts': 361,
  'src/terrain/tileGeometry.ts': 307,
};

// — Dateien einlesen ————————————————————————————————————————————

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const rel = posix.join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const files = walk('src');
const source = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));
const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

// — Importe ————————————————————————————————————————————————————

const IMPORT_RE = /^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function parseImports(text) {
  const result = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    if (m[1] === 'export' && !m[3]) continue; // `export 'x'` gibt es nicht; Schutz vor Fehltreffern
    result.push({ spec: m[4], typeOnly: Boolean(m[2]) });
  }
  return result;
}

function resolveLocal(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const cand of [base, base + '.ts', base + '.mjs', base + '/index.ts']) {
    if (source.has(cand)) return cand;
  }
  return existsSync(join(ROOT, base)) ? base : null; // z. B. catalog.json
}

const graph = new Map(); // datei → { local: [{file, typeOnly}], threeDirect: bool }
for (const f of files) {
  const imports = parseImports(source.get(f));
  graph.set(f, {
    local: imports
      .map((i) => ({ file: resolveLocal(f, i.spec), typeOnly: i.typeOnly }))
      .filter((i) => i.file),
    threeDirect: imports.some((i) => !i.typeOnly && (i.spec === 'three' || i.spec.startsWith('three/'))),
  });
}

/** Weg zu einem three-Import über Wert-Importe, oder null. Typ-Importe werden gelöscht und zählen nicht. */
function threePath(f, seen = new Set()) {
  const node = graph.get(f);
  if (!node || seen.has(f)) return null;
  seen.add(f);
  if (node.threeDirect) return [f];
  for (const dep of node.local) {
    if (dep.typeOnly) continue;
    const p = threePath(dep.file, seen);
    if (p) return [f, ...p];
  }
  return null;
}

// — Exporte ————————————————————————————————————————————————————

const squash = (s) => s.replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')').replace(/,\s*\)/g, ')').trim();

/** Kommentare entfernen, damit sie nicht in Signaturen landen (`://` in URLs bleibt stehen). */
const stripComments = (line) => line.replace(/\/\*.*?\*\//g, '').replace(/(^|[^:])\/\/.*$/, '$1');

/**
 * Liest ab `start` bis zum Beginn des Rumpfs bzw. bis `;` — Typliterale in Rückgabetypen
 * bleiben erhalten. `valueMode` (für const/let): nur `=` oder `;` beendet, `{` nie.
 */
function readSignature(lines, start, valueMode = false) {
  let text = '';
  let paren = 0, brace = 0, angle = 0;
  for (let i = start; i < lines.length && i < start + 40; i++) {
    const line = stripComments(lines[i]);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '(') paren++;
      else if (ch === ')') paren--;
      else if (ch === '<') angle++;
      else if (ch === '>' && line[c - 1] !== '=') angle = Math.max(0, angle - 1);
      else if (ch === '{' && paren === 0 && angle === 0) {
        const prev = text.trimEnd().slice(-1);
        if (brace === 0 && !valueMode && !':|&,<(='.includes(prev)) return squash(text);
        brace++;
      } else if (ch === '}' && paren === 0) brace--;
      else if ((ch === ';' || (ch === '=' && line[c + 1] !== '>')) && paren === 0 && brace === 0 && angle === 0) {
        return squash(text);
      }
      text += ch;
    }
    text += ' ';
  }
  return squash(text);
}

/** Feldnamen eines Interface-Rumpfs, eine Ebene tief. */
function interfaceFields(lines, start) {
  const names = [];
  for (let i = start + 1; i < lines.length && !/^}/.test(lines[i]); i++) {
    const m = /^ {2}(readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*[:(]/.exec(lines[i]);
    if (m) names.push(m[2] + (m[3] ?? ''));
  }
  return names;
}

const MEMBER_SKIP = /^ {2}(private |protected |#|\/\/|\/\*|\*(?=[\s/])|})/;
const MEMBER_RE = /^ {2}((?:static |readonly |abstract |async |get |set |override )*)(?:\* ?)?([A-Za-z_$][\w$]*)(\?)?\s*(<|\(|:|=|;)/;

function classMembers(lines, start) {
  const members = [];
  for (let i = start + 1; i < lines.length && !/^}/.test(lines[i]); i++) {
    if (MEMBER_SKIP.test(lines[i])) continue;
    const m = MEMBER_RE.exec(lines[i]);
    if (!m) continue;
    const [, mods, name, opt, next] = m;
    if (next === '<' || next === '(') {
      members.push(readSignature(lines, i));
    } else if (next === ':') {
      members.push(readSignature(lines, i, true));
    } else {
      // Feld mit Initialisierer: Typ aus `new X(` ablesen, sonst nur der Name
      const ctor = /=\s*new\s+([\w.]+)/.exec(lines[i]);
      members.push(squash(`${mods}${name}${opt ?? ''}${ctor ? ': ' + ctor[1] : ''}`));
    }
  }
  return members;
}

function parseExports(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('export ')) continue;
    if (/^export\s+(type\s+)?(\*|\{)/.test(line)) { out.push({ head: squash(line.replace(/;$/, '')).replace(/^export\s+/, 'export ') }); continue; }
    const valueMode = /^export\s+(const|let|var)\s/.test(line);
    const head = readSignature(lines, i, valueMode).replace(/^export\s+(default\s+)?/, '');
    if (/^(abstract\s+)?class\s/.test(head)) out.push({ head, members: classMembers(lines, i) });
    else if (/^interface\s/.test(head)) out.push({ head: `${head} { ${interfaceFields(lines, i).join(', ')} }` });
    else out.push({ head });
  }
  return out;
}

// — Vertragskarte erzeugen ——————————————————————————————————————

const isThreeFree = (f) => THREE_FREE.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));

function render() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const md = [];
  md.push('# Vertragskarte');
  md.push('');
  md.push('> Erzeugt von `tools/contracts.mjs` — nicht von Hand bearbeiten. `npm run contracts` erneuert sie,');
  md.push('> `npm run check` schlägt fehl, wenn sie dem Code hinterherhinkt.');
  md.push('>');
  md.push('> **three:** `—` frei · `direkt` importiert three · `über X` hängt per Wert-Import an einer Datei, die three importiert.');
  md.push('> **Kern:** muss three-frei bleiben (geprüft). **Deckel:** `⚠` = Bestand über ' + LINE_CAP + ' Zeilen, darf nicht wachsen.');
  md.push('');
  md.push('| Datei | three | Kern | Deckel | hängt ab von |');
  md.push('|---|---|---|---|---|');
  for (const f of files) {
    const p = threePath(f);
    const three = !p ? '—' : p.length === 1 ? 'direkt' : 'über ' + p[1].replace(/^src\//, '').replace(/\.ts$/, '');
    const deps = [...new Set(graph.get(f).local.map((d) => d.file.replace(/^src\//, '').replace(/\.ts$/, '')))].sort();
    md.push(`| \`${f.replace(/^src\//, '')}\` | ${three} | ${isThreeFree(f) ? '✓' : ''} | ${CAP_BASELINE[f] ? '⚠' : ''} | ${deps.join(', ')} |`);
  }
  md.push('');
  md.push('## Prüfskripte');
  md.push('');
  for (const [name, cmd] of Object.entries(pkg.scripts)) md.push(`- \`npm run ${name}\` — \`${cmd}\``);
  md.push('');
  md.push('## Exporte');
  for (const f of files) {
    const exports = parseExports(source.get(f));
    if (!exports.length) continue;
    md.push('');
    md.push(`### \`${f.replace(/^src\//, '')}\``);
    md.push('');
    for (const e of exports) {
      md.push(`- \`${e.head}\``);
      for (const m of e.members ?? []) md.push(`  - \`${m}\``);
    }
  }
  md.push('');
  return md.join('\n');
}

// — Hauptprogramm ——————————————————————————————————————————————

const check = process.argv.includes('--check');
const text = render();
const problems = [];
const hints = [];

for (const f of files.filter(isThreeFree)) {
  const p = threePath(f);
  if (p) problems.push(`three-Freiheit verletzt: ${p.join(' → ')} → three`);
}
for (const p of THREE_FREE) {
  if (!files.some((f) => (p.endsWith('/') ? f.startsWith(p) : f === p))) problems.push(`THREE_FREE nennt ${p}, das existiert nicht`);
}
for (const f of files) {
  const n = lineCount(source.get(f));
  const cap = CAP_BASELINE[f] ?? LINE_CAP;
  if (n > cap) {
    problems.push(CAP_BASELINE[f]
      ? `Dateideckel: ${f} ist auf ${n} Zeilen gewachsen (Bestand ${cap}) — erst teilen, dann erweitern`
      : `Dateideckel: ${f} hat ${n} Zeilen (> ${LINE_CAP}) — teilen`);
  } else if (CAP_BASELINE[f] && n <= LINE_CAP) {
    hints.push(`${f} liegt jetzt bei ${n} Zeilen — Eintrag aus CAP_BASELINE entfernen`);
  } else if (CAP_BASELINE[f] && n < cap) {
    hints.push(`${f}: ${n} Zeilen — CAP_BASELINE darf auf ${n} gesenkt werden`);
  }
}
for (const f of Object.keys(CAP_BASELINE)) if (!source.has(f)) hints.push(`CAP_BASELINE nennt ${f}, das es nicht mehr gibt — Eintrag entfernen`);

if (check) {
  const current = existsSync(join(ROOT, OUT)) ? readFileSync(join(ROOT, OUT), 'utf8') : '';
  if (current !== text) problems.push(`${OUT} ist veraltet — \`npm run contracts\` ausführen und mit committen`);
} else {
  writeFileSync(join(ROOT, OUT), text);
  console.log(`${OUT} geschrieben (${files.length} Dateien)`);
}

for (const h of hints) console.log(`  Hinweis  ${h}`);
for (const p of problems) console.log(`  FEHLER   ${p}`);
if (check) console.log(problems.length ? `\ncontracts: ${problems.length} Problem(e)` : 'contracts: ok');
process.exit(problems.length && check ? 1 : 0);
