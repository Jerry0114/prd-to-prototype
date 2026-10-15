#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const skipped = new Set(['.git', 'node_modules', 'output', 'dist', 'coverage', 'test-results', 'playwright-report']);
const textTypes = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.html', '.css', '.svg', '.yaml', '.yml']);
const rules = [
  ['personal-home-path', /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[A-Za-z0-9_.-]+/],
  ['private-network', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['access-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/],
  ['url-credentials', /https?:\/\/[^\s/]+:[^\s/@]+@/],
  ['assigned-secret', /(?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["'][A-Za-z0-9_+/=-]{20,}["']/i],
];
let count = 0;
const failures = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (entry.isSymbolicLink()) { failures.push(`${relative}: symbolic-link`); continue; }
    if (entry.isDirectory()) { walk(full); continue; }
    if (/^\.env(?:\.|$)|^\.DS_Store$|\.(?:pem|key|p12|zip|tgz|log)$/i.test(entry.name)) { failures.push(`${relative}: excluded-artifact`); continue; }
    if (relative.endsWith('/annotations/manual-annotations.json') || /\/intermediate\/[^/]*report\.(?:md|json)$/.test(relative)) continue;
    if (!textTypes.has(path.extname(entry.name)) && !['LICENSE', 'marked.LICENSE', '.gitignore', '.gitattributes'].includes(entry.name)) {
      if (!/\.(?:png|jpg|webp)$/i.test(entry.name)) failures.push(`${relative}: unexpected-file-type`);
      continue;
    }
    count++;
    const source = fs.readFileSync(full, 'utf8');
    for (const [label, regex] of rules) if (regex.test(source)) failures.push(`${relative}: ${label}`);
  }
}
walk(root);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS: scanned ${count} text files; no configured sensitive patterns found. Images require visual review. Generated reports and manual annotation files are excluded.`);
