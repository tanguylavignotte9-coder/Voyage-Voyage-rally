// PREUVE VISUELLE: la caméra est-elle derrière la voiture?
// Reproduit le pipeline exact du client et rend une frame PNG.
import { generateWorld } from "./packages/engine/dist/world.js";
import fs from "fs";
import zlib from "zlib";

const W = 1200, H = 800;
const camZoom = 0.55;
const PXM = (W / 40) * camZoom;

const w = generateWorld({ seed: 12345, targetHours: 168 });
const pts = w.points;

function pathPoint(k) {
  const i1 = Math.max(0, Math.min(pts.length - 1, Math.round((k * 1000) / 20)));
  const i0 = Math.max(0, i1 - 1), i2 = Math.min(pts.length - 1, i1 + 1), i3 = Math.min(pts.length - 1, i1 + 2);
  const t = (k * 1000 / 20) - i1;
  const cm = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  return { x: cm(pts[i0].x, pts[i1].x, pts[i2].x, pts[i3].x, t), y: cm(pts[i0].y, pts[i1].y, pts[i2].y, pts[i3].y, t) };
}

// === pipeline client exact ===
let camX = 0, camY = 0, camAngle = 0, camInit = false, racingOffset = 0;
const km = 6500;
const meRoad = pathPoint(km);
const meAhead = pathPoint(km + 0.006);
const carAngle = Math.atan2(meAhead.y - meRoad.y, meAhead.x - meRoad.x);

// (racing line omise pour la preuve caméra: me = meRoad)
const me = meRoad;

const targetX = me.x, targetY = me.y;
if (!camInit) { camX = targetX; camY = targetY; camAngle = carAngle; camInit = true; }
camX += (targetX - camX) * 0.10;
camY += (targetY - camY) * 0.10;
camAngle = carAngle;

const viewAngle = camAngle + Math.PI / 2;
const cosV = Math.cos(-viewAngle), sinV = Math.sin(-viewAngle);
const W2S = (x, y) => {
  const dx = x - camX, dy = y - camY;
  const rx = dx * cosV - dy * sinV;
  const ry = dx * sinV + dy * cosV;
  return [W / 2 + rx * PXM, H * 0.70 + ry * PXM];
};

// === image ===
const grid = new Uint8Array(W * H * 3);
const setpx = (x, y, c) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  grid[i] = c[0]; grid[i + 1] = c[1]; grid[i + 2] = c[2];
};
for (let i = 0; i < grid.length; i += 3) { grid[i] = 201; grid[i + 1] = 169; grid[i + 2] = 106; }

// route sur ±1 km
const half = 1.0;
const path = [];
for (let k = km - half; k <= km + half; k += 0.004) path.push(pathPoint(k));
const drawBand = (widthM, color) => {
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = W2S(path[i].x, path[i].y);
    const [x1, y1] = W2S(path[i + 1].x, path[i + 1].y);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const n = Math.max(1, Math.round(widthM * PXM / 2));
    const a = Math.atan2(y1 - y0, x1 - x0);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (let k2 = -n; k2 <= n; k2++) setpx(x + Math.sin(a) * k2, y - Math.cos(a) * k2, color);
    }
  }
};
drawBand(13 + 3.2, [162, 144, 108]);
drawBand(13, [107, 91, 67]);

// marqueurs: FLÈCHE ROUGE = voiture, marqueur 100m devant (vert), 100m derrière (bleu)
const [carSx, carSy] = W2S(me.x, me.y);
const ahead100 = pathPoint(km + 0.1);
const behind100 = pathPoint(km - 0.1);
const [ax, ay] = W2S(ahead100.x, ahead100.y);
const [bx, by] = W2S(behind100.x, behind100.y);
for (let yy = -20; yy <= 20; yy++) for (let xx = -40; xx <= 40; xx++) {
  if (Math.abs(xx) <= 40 && Math.abs(yy) <= 20) setpx(carSx + xx, carSy + yy, [204, 51, 51]);
}
for (let r = 0; r < 12; r++) for (let a2 = 0; a2 < 360; a2 += 5) {
  setpx(ax + Math.cos(a2) * r, ay + Math.sin(a2) * r, [50, 200, 80]);
  setpx(bx + Math.cos(a2) * r, by + Math.sin(a2) * r, [60, 120, 255]);
}

const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    raw[o++] = grid[i]; raw[o++] = grid[i + 1]; raw[o++] = grid[i + 2];
  }
}
const chunk = (t, d) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync("cam-proof.png", Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
console.log("voiture (rouge) écran:", carSx.toFixed(0), ",", carSy.toFixed(0));
console.log("point +100m devant (vert):", ax.toFixed(0), ",", ay.toFixed(0));
console.log("point -100m derrière (bleu):", bx.toFixed(0), ",", by.toFixed(0));
console.log("écran:", W, "x", H, "| la route doit s'étendre du bas (voiture) vers le HAUT (vert au-dessus du rouge)");
