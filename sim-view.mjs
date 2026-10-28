// SIMULATION DE LA VUE UTILISATEUR: reproduit le rendu caméra en PNG.
import { generateWorld } from "./packages/engine/dist/world.js";
import fs from "fs";
import zlib from "zlib";

const W = 1200, H = 800;
const PXM = W / 40; // 30 px/m — la nouvelle échelle

const w = generateWorld({ seed: 12345, targetHours: 168 });
const pts = w.points;

function pathPoint(k) {
  const i = Math.max(0, Math.min(pts.length - 1, Math.round((k * 1000) / 20)));
  return pts[i];
}

function renderFrame(kmCenter, file) {
  const me = pathPoint(kmCenter);
  const ahead = pathPoint(kmCenter + 0.006);
  const carAngle = Math.atan2(ahead.y - me.y, ahead.x - me.x);

  // caméra: même lissage que le client (supposée alignée ici)
  const camX = me.x, camY = me.y, camAngle = carAngle;
  const W2S = (x, y) => {
    const dx = x - camX, dy = y - camY;
    const rx = dx * Math.cos(-camAngle) - dy * Math.sin(-camAngle);
    const ry = dx * Math.sin(-camAngle) + dy * Math.cos(-camAngle);
    return [W / 2 + rx * PXM, H * 0.7 + ry * PXM];
  };

  // bitmap RGBA simple (fond sable désert)
  const grid = new Uint8Array(W * H * 3);
  const setpx = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 3;
    grid[i] = c[0]; grid[i + 1] = c[1]; grid[i + 2] = c[2];
  };
  const fill = (c) => { for (let i = 0; i < grid.length; i += 3) { grid[i] = c[0]; grid[i + 1] = c[1]; grid[i + 2] = c[2]; } };
  fill([201, 169, 106]); // sable désert

  const half = 0.16;
  // ROUTE (bande)
  const drawLine = (ptsList, widthM, color) => {
    for (let i = 0; i < ptsList.length - 1; i++) {
      const [x0, y0] = W2S(ptsList[i].x, ptsList[i].y);
      const [x1, y1] = W2S(ptsList[i + 1].x, ptsList[i + 1].y);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      const n = Math.max(1, Math.round(widthM * PXM / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const a = Math.atan2(y1 - y0, x1 - x0);
        for (let k = -n; k <= n; k++) {
          setpx(x + Math.sin(a) * k, y - Math.cos(a) * k, color);
        }
      }
    }
  };
  const path = [];
  for (let k = kmCenter - half; k <= kmCenter + half; k += 0.002) path.push(pathPoint(k));
  drawLine(path, 13, [107, 91, 67]);      // piste
  drawLine(path, 13 + 2 * 1.6, [180, 160, 120].map(v => v * 0.9)); // accotement dessiné en dessous

  // ligne centrale pointillée
  for (let k = Math.floor((kmCenter - half) * 10) / 10; k < kmCenter + half; k += 0.007) {
    const p = pathPoint(k);
    const [x, y] = W2S(p.x, p.y);
    const p2 = pathPoint(k + 0.003);
    const [x2, y2] = W2S(p2.x, p2.y);
    const a = Math.atan2(y2 - y, x2 - x);
    for (let d = 0; d < Math.hypot(x2 - x, y2 - y); d++) {
      setpx(x + Math.cos(a) * d, y + Math.sin(a) * d, [230, 220, 190]);
    }
  }

  // décors: 2 rangées hashées
  const hash = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };
  for (let dm = Math.floor((kmCenter - half) * 100); dm <= (kmCenter + half) * 100; dm += 10) {
    const k = dm / 1000;
    const p = pathPoint(k);
    for (let row = 0; row < 2; row++) {
      const idx = Math.round(dm / 10) * 2 + row;
      const r1 = hash(idx * 3 + 1), r2 = hash(idx * 7 + 2), r3 = hash(idx * 11 + 3);
      if (r3 < 0.32) continue;
      const side = r2 < 0.5 ? -1 : 1;
      const dist = row === 0 ? 6.5 + 6 + r1 * 30 : 6.5 + 38 + r1 * 70;
      const pA = pathPoint(k - 0.002), pB = pathPoint(k + 0.002);
      const a = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      const dx = p.x - Math.sin(a) * side * dist, dy = p.y + Math.cos(a) * side * dist;
      const [sx, sy] = W2S(dx, dy);
      const sz = (0.9 + r1 * 2.4) * PXM;
      for (let yy = -sz * 0.7; yy <= sz * 0.7; yy++)
        for (let xx = -sz; xx <= sz; xx++)
          if ((xx / sz) ** 2 + (yy / (sz * 0.7)) ** 2 <= 1) setpx(sx + xx, sy + yy, row ? [85, 76, 61] : [95, 85, 68]);
    }
  }

  // VOITURE: orientée selon la tangente locale (comme le vrai client)
  const [cx, cy] = W2S(me.x, me.y);
  const L = 2.3, Wd = 1.05;
  const localAng = carAngle - camAngle; // ≈0 (caméra alignée)
  for (let yy = -Wd * PXM; yy <= Wd * PXM; yy++) {
    for (let xx = -L * PXM; xx <= L * PXM; xx++) {
      const lx = xx / PXM, ly = yy / PXM;
      const inBody = Math.abs(lx) <= L && Math.abs(ly) <= Wd;
      const windshield = lx > L * 0.1 && lx < L * 0.65 && Math.abs(ly) < Wd * 0.72;
      if (inBody) setpx(cx + xx, cy + yy, windshield ? [150, 200, 235] : [204, 51, 51]);
    }
  }
  // ornières: traces de roues
  for (const side of [-1, 1]) {
    for (let k2 = kmCenter - half; k2 <= kmCenter + half; k2 += 0.001) {
      const pp = pathPoint(k2), pa = pathPoint(k2 - 0.002), pb = pathPoint(k2 + 0.002);
      if (!pp || !pa || !pb) continue;
      const a = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      const ox = pp.x - Math.sin(a) * 6.5 * 0.45 * side;
      const oy = pp.y + Math.cos(a) * 6.5 * 0.45 * side;
      const [sx, sy] = W2S(ox, oy);
      setpx(sx, sy, [40, 32, 22]);
      setpx(sx + 1, sy, [40, 32, 22]);
    }
  }
  // piquets tous les 20 m
  for (let dm = Math.floor((kmCenter - half) * 50) * 20; dm <= (kmCenter + half) * 1000; dm += 20) {
    const k = dm / 1000;
    const pp = pathPoint(k), pa = pathPoint(k - 0.002), pb = pathPoint(k + 0.002);
    if (!pp || !pa || !pb) continue;
    const a = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    for (const side of [-1, 1]) {
      const dx = pp.x - Math.sin(a) * (6.5 + 2.5) * side;
      const dy = pp.y + Math.cos(a) * (6.5 + 2.5) * side;
      const [sx, sy] = W2S(dx, dy);
      for (let hgt = 0; hgt < 1.4 * PXM; hgt++) {
        for (let wdt = -0.12 * PXM; wdt <= 0.12 * PXM; wdt++) {
          setpx(sx + wdt, sy - hgt, side < 0 ? [240, 235, 220] : [200, 60, 40]);
        }
      }
    }
  }

  // PNG encode
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
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log(file, "écrit");
}

// ligne droite (km 6000) et virage (trouver un fort virage vers km 4300-4500)
let turnKm = 4400;
for (let i = Math.floor(4300 * 50); i < 4600 * 50; i++) {
  if (Math.abs(pts[i].curvature) > 1 / 120) { turnKm = pts[i].km; break; }
}
renderFrame(6000, "vue-ligne-droite.png");
renderFrame(turnKm, "vue-virage.png");
console.log("virage choisi au km", turnKm.toFixed(2));
