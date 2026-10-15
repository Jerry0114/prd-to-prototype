#!/usr/bin/env node
// Optional artwork rebuild: install sharp in your tooling environment first.
// The Skill's runtime and tests do not depend on this renderer.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const sourceDir = __dirname;
  let svg = fs.readFileSync(path.join(sourceDir, 'hero-layout.svg'), 'utf8');
  for (const filename of ['hero-subject.png', 'prototype-proof.png']) {
    const bytes = fs.readFileSync(path.join(sourceDir, filename));
    svg = svg.replaceAll(`xlink:href="${filename}"`, `xlink:href="data:image/png;base64,${bytes.toString('base64')}"`);
  }
  const target = path.resolve(sourceDir, '../hero.png');
  await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile(target);
  console.log(`Rendered ${path.basename(target)} at 2400 × 1720`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
