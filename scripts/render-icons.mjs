// Electron main script (run via scripts/build-icons.mjs): renders assets/icon.svg into PNGs at
// every Windows icon size using Chromium's own SVG renderer, then packs them into assets/icon.ico.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/**
 * ICO container with PNG-compressed entries (supported since Windows Vista).
 * Layout: 6-byte header, one 16-byte directory entry per image, then the PNG data.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL('about:blank');

    // Draw the SVG into a canvas at each exact pixel size (independent of screen scaling).
    const dataUrls = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
      await img.decode();
      return ${JSON.stringify(ICO_SIZES)}.map((size) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        return canvas.toDataURL('image/png');
      });
    })()`);

    const images = dataUrls.map((url, i) => ({
      size: ICO_SIZES[i],
      png: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
    }));
    fs.writeFileSync(path.join(assets, 'icon.ico'), buildIco(images));
    fs.writeFileSync(path.join(assets, 'icon-256.png'), images.at(-1).png);
    // The browser tab icon is the same SVG; copy it so the two never drift apart.
    fs.mkdirSync(path.join(root, 'client', 'public'), { recursive: true });
    fs.copyFileSync(path.join(assets, 'icon.svg'), path.join(root, 'client', 'public', 'favicon.svg'));
    console.log(
      `icons: wrote assets/icon.ico (${images.map((i) => i.size).join(', ')} px), assets/icon-256.png and client/public/favicon.svg`,
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(`icons: failed: ${error instanceof Error ? error.message : error}`);
    app.exit(1);
  });
