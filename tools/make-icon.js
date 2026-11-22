/* Génère l'icône de l'application : build/icon.png et build/icon.ico (256x256).
   Aucune dépendance : PNG écrit à la main (zlib) puis encapsulé en ICO.
   Usage : node tools/make-icon.js */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SS = 4; // suréchantillonnage pour l'anticrénelage
const BIG = SIZE * SS;

function roundedRect(x, y, w, h, r) {
  return function (px, py) {
    const dx = Math.max(x + r - px, 0, px - (x + w - r));
    const dy = Math.max(y + r - py, 0, py - (y + h - r));
    if (px < x || py < y || px > x + w || py > y + h) return false;
    return dx * dx + dy * dy <= r * r;
  };
}

function blend(dst, src, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[0] = dst[0] * (1 - a) + src[0] * a;
  dst[1] = dst[1] * (1 - a) + src[1] * a;
  dst[2] = dst[2] * (1 - a) + src[2] * a;
  dst[3] = dst[3] * (1 - a) + 1 * a;
}

function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

/* Éléments du dessin, dans l'ordre d'affichage. */
const plate = roundedRect(8, 8, 240, 240, 54);
const cards = [
  { x: 30, y: 62, w: 82, h: 58, color: [63, 140, 255] },
  { x: 144, y: 44, w: 82, h: 58, color: [55, 211, 155] },
  { x: 87, y: 158, w: 82, h: 58, color: [255, 181, 71] }
].map(function (c) {
  return Object.assign({}, c, { shape: roundedRect(c.x, c.y, c.w, c.h, 14) });
});

function wireDistance(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy)));
  const dx = px - (a[0] + vx * t);
  const dy = py - (a[1] + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

const wires = [
  [[112, 91], [128, 187]],
  [[144, 73], [169, 160]]
];

function sample(px, py) {
  const out = [0, 0, 0, 0];

  /* fond : carré arrondi en dégradé bleu nuit */
  if (plate(px, py)) {
    const t = Math.max(0, Math.min(1, (py - 8) / 240));
    blend(out, mix([36, 63, 110], [10, 17, 31], t), 1);
  } else {
    return out;
  }

  /* halo discret en haut à gauche */
  const halo = Math.max(0, 1 - Math.sqrt((px - 70) * (px - 70) + (py - 60) * (py - 60)) / 150);
  blend(out, [80, 140, 220], halo * 0.22);

  /* liaisons */
  for (let i = 0; i < wires.length; i++) {
    const d = wireDistance(px, py, wires[i][0], wires[i][1]);
    blend(out, [176, 205, 245], Math.max(0, 1 - Math.max(0, d - 4) / 1.6) * 0.85);
  }

  /* nœuds */
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card.shape(px, py)) continue;
    /* carte colorée avec un liseré clair en haut pour l'effet de relief */
    const highlight = Math.max(0, 1 - (py - card.y) / 12);
    blend(out, mix(card.color, [255, 255, 255], highlight * 0.35), 1);
    const groove = roundedRect(card.x + 14, card.y + 26, card.w - 28, 8, 4);
    if (groove(px, py)) blend(out, [13, 22, 38], 0.28);
  }

  /* broches rondes sur les bords des nœuds */
  const pins = [[112, 91], [128, 187], [144, 73], [169, 160], [196, 73], [196, 91]];
  for (let i = 0; i < pins.length; i++) {
    const dx = px - pins[i][0];
    const dy = py - pins[i][1];
    if (dx * dx + dy * dy <= 7 * 7) blend(out, [245, 249, 255], 1);
  }

  return out;
}

function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += c[3];
        }
      }
      const n = SS * SS;
      const o = (y * SIZE + x) * 4;
      const alpha = acc[3] / n;
      const scale = alpha > 0 ? 1 / (acc[3] / n) * (acc[3] / n) : 0;
      pixels[o] = Math.round(Math.min(255, (acc[0] / n) / (alpha || 1)));
      pixels[o + 1] = Math.round(Math.min(255, (acc[1] / n) / (alpha || 1)));
      pixels[o + 2] = Math.round(Math.min(255, (acc[2] / n) / (alpha || 1)));
      pixels[o + 3] = Math.round(alpha * 255);
      void scale;
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;   // 8 bits par canal
  header[9] = 6;   // RVBA
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;          // 256 px
  entry[1] = 0;          // 256 px
  entry[2] = 0;          // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);    // plans
  entry.writeUInt16LE(32, 6);   // bits par pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

const png = encodePng(render());
const ico = encodeIco(png);

[path.join(__dirname, '..', 'build'), path.join(__dirname, '..', 'src-tauri', 'icons')]
  .forEach(function (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'icon.png'), png);
    fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  });
console.log('Icônes écrites : build/ et src-tauri/icons/ (icon.png ' + png.length +
  ' octets, icon.ico)');
