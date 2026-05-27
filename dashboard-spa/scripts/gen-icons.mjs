#!/usr/bin/env node
// Generates PNG icons at PWA-required sizes (192, 512) from the source
// SVG. Run via `npm run gen-icons`. The SVG renders an emoji ninja on
// the dashboard's dark background — Chrome Android needs PNG fallbacks
// before it offers "Install app" instead of "Add to home screen".

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const srcSvg = readFileSync(resolve(publicDir, 'icon-192.svg'));

const sizes = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
];

for (const { size, name } of sizes) {
  const out = resolve(publicDir, name);
  const png = await sharp(srcSvg, { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(out, png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
