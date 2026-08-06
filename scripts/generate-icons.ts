import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const output = path.join(process.cwd(), 'public', 'icons');
await mkdir(output, { recursive: true });

type Color = [number, number, number, number];
const burgundy: Color = [122, 50, 31, 255];
const cream: Color = [255, 247, 233, 255];
const gold: Color = [227, 180, 95, 255];

function icon(size: number, maskable = false): Buffer {
  const image = new PNG({ width: size, height: size });
  const setPixel = (x: number, y: number, color: Color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (Math.floor(y) * size + Math.floor(x)) * 4;
    [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]] = color;
  };
  const fillRounded = (x: number, y: number, width: number, height: number, radius: number, color: Color) => {
    for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
      for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) {
        const nearX = Math.max(x + radius - px, 0, px - (x + width - radius));
        const nearY = Math.max(y + radius - py, 0, py - (y + height - radius));
        if (nearX * nearX + nearY * nearY <= radius * radius) setPixel(px, py, color);
      }
    }
  };
  fillRounded(0, 0, size, size, maskable ? 0 : size * 0.2, burgundy);
  const inset = size * (maskable ? 0.24 : 0.18);
  const bookWidth = size - inset * 2;
  fillRounded(inset, size * 0.23, bookWidth * 0.53, size * 0.55, size * 0.035, cream);
  fillRounded(inset + bookWidth * 0.49, size * 0.23, bookWidth * 0.51, size * 0.55, size * 0.035, gold);
  const stroke = Math.max(3, Math.round(size * 0.035));
  const drawLine = (x1: number, y1: number, x2: number, y2: number, color: Color) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + (x2 - x1) * step / steps;
      const y = y1 + (y2 - y1) * step / steps;
      fillRounded(x - stroke / 2, y - stroke / 2, stroke, stroke, stroke / 2, color);
    }
  };
  const noteX = inset + bookWidth * 0.27;
  drawLine(noteX, size * 0.37, noteX, size * 0.61, burgundy);
  drawLine(noteX, size * 0.37, noteX + size * 0.14, size * 0.34, burgundy);
  fillRounded(noteX - size * 0.09, size * 0.58, size * 0.11, size * 0.075, size * 0.04, burgundy);
  return PNG.sync.write(image);
}

for (const [filename, size, maskable] of [
  ['apple-touch-icon.png', 180, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
] as const) {
  await writeFile(path.join(output, filename), icon(size, maskable));
}

console.log('Vygenerovány PWA ikony 180, 192 a 512 px.');
