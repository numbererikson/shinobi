import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inputArg, outputArg, sizeArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('usage: node scripts/svg-to-png.mjs <input.svg> <output.png> [size=240]');
  process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const size = Number(sizeArg ?? 240);

const svg = readFileSync(input);
await sharp(svg, { density: 300 })
  .resize(size, size, { fit: 'contain', background: { r: 15, g: 18, b: 22, alpha: 1 } })
  .png()
  .toFile(output);

console.log(`wrote ${output} at ${size}x${size}`);
