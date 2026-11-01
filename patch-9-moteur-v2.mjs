#!/usr/bin/env node
// ============================================================================
// PATCH 9 — moteur v2 « continent » + carte 2D — Voyage Voyage Rally
// ============================================================================
// AUTO-SUFFISANT : les contenus sont embarqués dans des blocs
// // @@BEGIN <nom>@@ … // @@END <nom>@@ extraits de CE fichier lui-même.
//
// Usage  : node patch-9-moteur-v2.mjs [racine-du-dépôt]   (défaut : cwd)
// Garde-fous :
//   - chaque patch vérifie que son ancre est UNIQUE dans le fichier cible ;
//     sinon il s'arrête net AVANT d'écrire ce fichier ;
//   - rejouer sur un dépôt déjà patché échoue sur ancres introuvables : voulu.
// Ordre : continent.ts (nouveau) → world.ts → index engine → race.ts →
//         host.ts → index serveur → main.ts client → tests.
// ============================================================================

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(process.argv[2] || ".");
const SELF = fs.readFileSync(new URL(import.meta.url), "utf8");

function die(msg) {
  console.error("\n✗ PATCH 9 : " + msg);
  process.exit(1);
}

function block(name) {
  const begin = "// @@BEGIN " + name + "@@";
  const end = "// @@END " + name + "@@";
  const i = SELF.indexOf(begin);
  if (i < 0) die("bloc manquant dans le script : " + name);
  const j = SELF.indexOf(end, i);
  if (j < 0) die("fin de bloc manquante : " + name);
  return SELF.slice(i + begin.length, j).replace(/^\r?\n/, "");
}

function writeNew(rel, content) {
  if (!fs.existsSync(path.join(ROOT, "packages", "engine", "src", "world.ts"))) {
    die("packages/engine/src/world.ts introuvable — la racine donnée n'est pas celle du dépôt ?");
  }
  fs.writeFileSync(path.join(ROOT, rel), content);
  console.log("✓ nouveau fichier " + rel + " (" + content.length + " caractères)");
}

// Remplace l'ancre (doit être UNIQUE) par son substitut. Pour une insertion,
// le substitut réinclut l'ancre.
function patch(rel, anchor, replacement) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) die("fichier introuvable : " + rel);
  const src = fs.readFileSync(f, "utf8");
  const n = src.split(anchor).length - 1;
  if (n === 0) die("ancre introuvable dans " + rel + " :\n---\n" + anchor.slice(0, 300) + "\n---");
  if (n > 1) die("ancre présente " + n + "× dans " + rel + " (ambiguë) :\n---\n" + anchor.slice(0, 300) + "\n---");
  fs.writeFileSync(f, src.replace(anchor, replacement));
  console.log("✓ patch " + rel);
}

function append(rel, text) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) die("fichier introuvable : " + rel);
  fs.appendFileSync(f, text);
  console.log("✓ ajout en fin de " + rel);
}

console.log("PATCH 9 — moteur v2 continent + carte 2D");
console.log("Racine du dépôt : " + ROOT + "\n");

// ---------------------------------------------------------------------------
// 1. NOUVEAU MODULE : le générateur v2 complet (proto, itérations 1-16).
//    Aucun import de ./world (c'est world.ts qui importe continent.ts) ;
//    les types PathPoint/TrackWidth/BiomeZone sont copiés, structurellement
//    identiques à ceux de world.ts — le contrat World de types.ts s'applique.
// ---------------------------------------------------------------------------
writeNew("packages/engine/src/continent.ts", block("continent.ts"));
// ---------------------------------------------------------------------------
// 2. world.ts : mode "continent" dans WorldGenParams + aiguillage generateWorld.
// ---------------------------------------------------------------------------
patch("packages/engine/src/world.ts",
`export interface WorldGenParams {
  seed: number;
  targetHours: number;
  biomeWeights?: Partial<Record<Biome, number>>;
}`,
`export interface WorldGenParams {
  seed: number;
  targetHours: number;
  biomeWeights?: Partial<Record<Biome, number>>;
  /** Patch 9 : "line" (défaut — monde v1) ou "continent" (moteur v2, monde 2D). */
  mode?: "line" | "continent";
  /** En mode continent : la graine TEXTE (celle du proto, ex. "vvr-continent-1"). */
  seedText?: string;
}`);

patch("packages/engine/src/world.ts",
`import { Rng } from "./rng";`,
`import { Rng } from "./rng";
import { generateContinent } from "./continent";`);

patch("packages/engine/src/world.ts",
`export function generateWorld(params: WorldGenParams): World {
  const gen = new WorldGenerator(params);
  return gen.toWorld(params.seed);
}`,
`export function generateWorld(params: WorldGenParams): World {
  // Patch 9 : aiguillage moteur v1 / v2. En mode continent, targetHours et
  // biomeWeights sont ignorés (le monde 2D fait ~6 100 km ; la durée réelle
  // dépend du terrain).
  if (params.mode === "continent") {
    return generateContinent(params.seedText ?? String(params.seed));
  }
  const gen = new WorldGenerator(params);
  return gen.toWorld(params.seed);
}`);

// ---------------------------------------------------------------------------
// 3. engine/src/index.ts : export SÉLECTIF (pas de export * — TrackWidth/
//    PathPoint/BiomeZone de continent.ts entreraient en collision avec world.ts).
// ---------------------------------------------------------------------------
patch("packages/engine/src/index.ts",
`export * from "./race";`,
`export * from "./race";
// Patch 9 : continent exporté sélectivement (collision de types avec world.ts).
export { generateContinent, buildContinentMap, __resetContinentCache } from "./continent";
export type { ContinentMapPayload } from "./continent";`);

// ---------------------------------------------------------------------------
// 4. race.ts : RaceParams.mode propagé jusqu'à la génération.
// ---------------------------------------------------------------------------
patch("packages/engine/src/race.ts",
`  closureDelayHours: number;
  biomeWeights?: Partial<Record<string, number>>;
}`,
`  closureDelayHours: number;
  biomeWeights?: Partial<Record<string, number>>;
  /** Patch 9 : "line" (défaut) ou "continent". */
  mode?: "line" | "continent";
}`);

patch("packages/engine/src/race.ts",
`    this.world = generateWorld({ seed, targetHours: params.targetHours, biomeWeights: params.biomeWeights as any });`,
`    this.world = generateWorld({ seed, targetHours: params.targetHours, biomeWeights: params.biomeWeights as any, mode: params.mode, seedText: params.seedText });`);

// ---------------------------------------------------------------------------
// 5. host.ts : le restore doit régénérer dans le BON mode (sinon une course
//    continent restaurée par un redémarrage serveur retombe en monde v1).
//    Les snapshots v1 n'ont pas mode → undefined → generateWorld v1 : OK.
// ---------------------------------------------------------------------------
patch("packages/server/src/host.ts",
`      data.race.world = generateWorld({ seed, targetHours: data.config.targetHours });`,
`      data.race.world = generateWorld({ seed, targetHours: data.config.targetHours, mode: data.config.mode, seedText: data.config.seedText });`);

// ---------------------------------------------------------------------------
// 6. server/src/index.ts : CLI "create continent …", stateMsg porte le mode,
//    message get_continent, admin_reset préserve le mode.
// ---------------------------------------------------------------------------
patch("packages/server/src/index.ts",
`import { CarState, PlayerRule, TICK_SECONDS, findContradictions, weatherAt } from "../../engine";`,
`import { CarState, PlayerRule, TICK_SECONDS, findContradictions, weatherAt, buildContinentMap } from "../../engine";`);

patch("packages/server/src/index.ts",
`if (args[0] === "create") {
  config = {
    seedText: args[1] || Math.random().toString(36),
    targetHours: parseFloat(args[2] || "168"),
    startIntervalSeconds: parseInt(args[3] || "60", 10),
    programWindowMinutes: parseInt(args[4] || "60", 10),
    closureDelayHours: parseFloat(args[5] || "24"),
    accessCode: args[6] || "rally",
    adminCode: args[7] || "admin-" + Math.random().toString(36).slice(2, 6),
    adminPseudo: "admin",
  };
}`,
`if (args[0] === "create") {
  // Patch 9 : "create continent <graine> <durée_h> …" active le moteur v2.
  // L'ancienne forme "create <graine> …" reste le monde v1 (défaut "line").
  const isContinent = args[1] === "continent";
  const o = isContinent ? 1 : 0;
  config = {
    seedText: args[1 + o] || Math.random().toString(36),
    targetHours: parseFloat(args[2 + o] || "168"),
    startIntervalSeconds: parseInt(args[3 + o] || "60", 10),
    programWindowMinutes: parseInt(args[4 + o] || "60", 10),
    closureDelayHours: parseFloat(args[5 + o] || "24"),
    accessCode: args[6 + o] || "rally",
    adminCode: args[7 + o] || "admin-" + Math.random().toString(36).slice(2, 6),
    adminPseudo: "admin",
    mode: isContinent ? "continent" : "line",
  };
}`);

patch("packages/server/src/index.ts",
`    type: "state",
    tick: host.race.tick,
    started: host.race.started,`,
`    type: "state",
    tick: host.race.tick,
    started: host.race.started,
    // Patch 9 : le client sait s'il doit demander le payload continent.
    mode: host.config.mode || "line",`);

patch("packages/server/src/index.ts",
`      case "get_path_chunk": {
        // tracé par tronçons de 2 km — le client demande autour de sa position
        if (!host.race.world.points || host.race.world.points.length === 0) return;
        const fromKm = Math.max(0, msg.fromKm | 0);
        const toKm = fromKm + 4;
        const pts = host.race.world.points.filter((p: any) => p.km >= fromKm && p.km < toKm);
        ws.send(JSON.stringify({ type: "path_chunk", fromKm, points: pts }));
        break;
      }`,
`      case "get_path_chunk": {
        // tracé par tronçons de 2 km — le client demande autour de sa position
        if (!host.race.world.points || host.race.world.points.length === 0) return;
        const fromKm = Math.max(0, msg.fromKm | 0);
        const toKm = fromKm + 4;
        const pts = host.race.world.points.filter((p: any) => p.km >= fromKm && p.km < toKm);
        ws.send(JSON.stringify({ type: "path_chunk", fromKm, points: pts }));
        break;
      }
      case "get_continent": {
        // Patch 9 : payload 2D du continent pour l'onglet carte (~640 Ko, une
        // fois par client et par monde ; le cache serveur le sert instantanément)
        if (host.config.mode === "continent") {
          ws.send(JSON.stringify({ type: "continent", payload: buildContinentMap(host.config.seedText) }));
        }
        break;
      }`);

patch("packages/server/src/index.ts",
`          closureDelayHours: host.config.closureDelayHours,
          accessCode: host.config.accessCode,`,
`          closureDelayHours: host.config.closureDelayHours,
          accessCode: host.config.accessCode,
          mode: host.config.mode,`);

// ---------------------------------------------------------------------------
// 7. client/src/main.ts : réception du payload + carte 2D complète.
//    7a. openMap REMPLACÉ : demande le payload en mode continent, zoom/pan 2D.
//    (le bloc suivant insère aussi toutes les fonctions de rendu 2D)
// ---------------------------------------------------------------------------
patch("packages/client/src/main.ts",
`function openMap(): void {
  if (!state) return;
  mapCenterKm = null;
  $("fullscreen").style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = content.clientWidth - 20 || 900;
  c.height = (content.clientWidth - 20 || 900) * 0.55;
  c.style.cssText = "cursor:grab";
  content.appendChild(c);
  const ctxM = c.getContext("2d")!;
  const redraw = () => drawMap(ctxM, c.width, c.height);
  redraw();

  // molette = zoom autour du point souris
  c.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const old = mapZoomLevel;
    mapZoomLevel = Math.max(1, Math.min(40, mapZoomLevel * (e.deltaY > 0 ? 0.8 : 1.25)));
    if (mapZoomLevel === old) return;
    redraw();
  }, { passive: false });
  // drag = pan (déplace le focus en km le long du tracé)
  c.addEventListener("mousedown", (e: MouseEvent) => {
    mapDrag = { x: e.offsetX, y: e.offsetY };
    c.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    if (mapDrag) { mapDrag = null; c.style.cursor = "grab"; }
  });
  c.addEventListener("mousemove", (e: MouseEvent) => {
    if (!mapDrag) return;
    // pan en km: approx via la largeur visible = totalKm/zoom
    const dpx = e.offsetX - mapDrag.x;
    const dkm = -(dpx / c.width) * (state!.world.totalKm / mapZoomLevel);
    const cur = mapCenterKm ?? state!.cars.find((x) => x.playerId === myId)?.positionKm ?? 0;
    mapCenterKm = Math.max(0, Math.min(state!.world.totalKm, cur + dkm));
    mapDrag = { x: e.offsetX, y: e.offsetY };
    redraw();
  });
  c.addEventListener("dblclick", () => { mapCenterKm = null; redraw(); });
  // refresh périodique (voitures avancent)
  setInterval(() => {
    if ($("fullscreen").style.display === "block" && !mapDrag) redraw();
  }, 2000);
}
`,
`function openMap(): void {
  if (!state) return;
  // Patch 9 : en mode continent, demander le payload 2D (une fois par monde)
  if (continentMode && !continentPayload) send({ type: "get_continent" });
  mapCenterKm = null;
  continent2DCenter = null;
  $("fullscreen").style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = content.clientWidth - 20 || 900;
  c.height = (content.clientWidth - 20 || 900) * 0.55;
  c.style.cssText = "cursor:grab";
  content.appendChild(c);
  const ctxM = c.getContext("2d")!;
  const redraw = () => drawMap(ctxM, c.width, c.height);
  redraw();

  // molette = zoom autour du point souris (2D si payload continent)
  c.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    if (continentPayload) {
      const v = continentView(c.width, c.height);
      const kmX = (e.offsetX - v.mapX(0)) / v.k;
      const kmY = (e.offsetY - v.mapY(0)) / v.k;
      const oldZ = continent2DZoom;
      continent2DZoom = Math.max(1, Math.min(64, continent2DZoom * (e.deltaY > 0 ? 0.8 : 1.25)));
      if (continent2DZoom !== oldZ) {
        if (continent2DCenter) {
          continent2DCenter = {
            x: kmX - (kmX - continent2DCenter.x) * (oldZ / continent2DZoom),
            y: kmY - (kmY - continent2DCenter.y) * (oldZ / continent2DZoom),
          };
        }
        redraw();
      }
      return;
    }
    const old = mapZoomLevel;
    mapZoomLevel = Math.max(1, Math.min(40, mapZoomLevel * (e.deltaY > 0 ? 0.8 : 1.25)));
    if (mapZoomLevel === old) return;
    redraw();
  }, { passive: false });
  // drag = pan (2D : km du continent ; 1D : le long du tracé)
  c.addEventListener("mousedown", (e: MouseEvent) => {
    mapDrag = { x: e.offsetX, y: e.offsetY };
    c.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    if (mapDrag) { mapDrag = null; c.style.cursor = "grab"; }
  });
  c.addEventListener("mousemove", (e: MouseEvent) => {
    const drag = mapDrag;
    if (!drag) return;
    if (continentPayload) {
      const v = continentView(c.width, c.height);
      continent2DCenter = {
        x: v.cx - (e.offsetX - drag.x) / v.k,
        y: v.cy - (e.offsetY - drag.y) / v.k,
      };
      mapDrag = { x: e.offsetX, y: e.offsetY };
      redraw();
      return;
    }
    // pan en km: approx via la largeur visible = totalKm/zoom
    const dpx = e.offsetX - drag.x;
    const dkm = -(dpx / c.width) * (state!.world.totalKm / mapZoomLevel);
    const cur = mapCenterKm ?? state!.cars.find((x) => x.playerId === myId)?.positionKm ?? 0;
    mapCenterKm = Math.max(0, Math.min(state!.world.totalKm, cur + dkm));
    mapDrag = { x: e.offsetX, y: e.offsetY };
    redraw();
  });
  c.addEventListener("dblclick", () => {
    mapCenterKm = null;
    continent2DCenter = null; // recentre sur ma voiture
    redraw();
  });
  // refresh périodique (voitures avancent)
  setInterval(() => {
    if ($("fullscreen").style.display === "block" && !mapDrag) redraw();
  }, 2000);
}

// ===== PATCH 9 : carte 2D du continent (payload "continent" du serveur) =====
let continentPayload: any = null;             // payload reçu du serveur
let continentMode = false;                   // mode de la course (state.mode)
let continentOff: HTMLCanvasElement | null = null;                    // fond 250×250 prérendu
let continentRoute: { x: number; y: number; s: number }[] | null = null; // vraie géo + arc cumulé (km)
let continent2DCenter: { x: number; y: number } | null = null;        // pan 2D (km du continent)
let continent2DZoom = 1;                     // 1 = continent entier visible

// 8 zones climatiques du proto (indices de zonesB64 ; 255 = océan)
const ZONE2D_COLORS: string[] = [
  "#9fb8c8", // 0 boréal
  "#6fa05a", // 1 tempéré
  "#b0b470", // 2 steppe
  "#d9b36a", // 3 désert
  "#c2a45e", // 4 sahel
  "#3f8a52", // 5 tropical humide
  "#b9bcc2", // 6 haute montagne
  "#edf3f6", // 7 neiges éternelles
];

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64ToI16(b64: string): Int16Array {
  const u = b64ToU8(b64);
  return new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1);
}

// Décode le payload UNE fois : fond prérendu (zones + hillshade + eau + routes
// esquisse à 4 km/px) et itinéraire avec arc cumulé (pour projeter les km).
function continentPrepare(): void {
  if (!continentPayload || continentRoute) return;
  const P = continentPayload;
  const N = P.sizeKm / 4; // 250 px pour 1 000 km
  const relief = b64ToU8(P.reliefB64);
  const zones = b64ToU8(P.zonesB64);
  const water = b64ToU8(P.waterB64);
  const off = document.createElement("canvas");
  off.width = N;
  off.height = N;
  const g = off.getContext("2d")!;
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    let r = 0, gg = 0, b = 0;
    const wv = water[i];
    if (wv === 3 || zones[i] === 255) {
      r = 0x1d; gg = 0x3a; b = 0x55; // océan
    } else {
      const col = ZONE2D_COLORS[zones[i]] ?? "#b0b470";
      r = parseInt(col.slice(1, 3), 16);
      gg = parseInt(col.slice(3, 5), 16);
      b = parseInt(col.slice(5, 7), 16);
      const sh = 0.78 + (relief[i] / 255) * 0.5; // hillshade léger
      r *= sh; gg *= sh; b *= sh;
      if (wv === 2) { r = 0x2c; gg = 0x5a; b = 0x80; }       // lac
      else if (wv === 1) { r = 0x3d; gg = 0x6c; b = 0x8f; }  // rivière
    }
    const o = i * 4;
    img.data[o] = r;
    img.data[o + 1] = gg;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // réseau esquisse : gabarit sombre + cœur clair (itération 12bis du proto)
  const rv = b64ToI16(P.roadsB64);
  let p = 0;
  for (const npts of P.roadsCount as number[]) {
    if (p + npts * 2 > rv.length) break;
    g.beginPath();
    for (let i = 0; i < npts; i++) {
      const x = rv[p++] / 40, y = rv[p++] / 40; // (km × 10) → km → px (÷4)
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = "rgba(46,38,30,0.9)";
    g.lineWidth = 1.6;
    g.stroke();
    g.strokeStyle = "#f0e8d8";
    g.lineWidth = 0.7;
    g.stroke();
  }
  continentOff = off;
  // itinéraire du raid (vraie géométrie fine 250 m) + arc cumulé
  const r = b64ToI16(P.routeB64);
  const pts: { x: number; y: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i + 1 < r.length; i += 2) {
    const x = r[i] / 10, y = r[i + 1] / 10;
    if (pts.length) s += Math.hypot(x - pts[pts.length - 1].x, y - pts[pts.length - 1].y);
    pts.push({ x, y, s });
  }
  continentRoute = pts;
}

// km du guide → {x,y} sur la vraie géométrie fine (projection par arc).
// L'arc du tracé fin et l'arc du guide (totalKm) diffèrent de ~1-3 % : décalage
// géographique des voitures/stations de cet ordre, accepté au proto.
function routeAt(km: number): { x: number; y: number } {
  const RT = continentRoute!;
  if (!RT || RT.length === 0) return { x: 0, y: 0 };
  const total = state?.world.totalKm || continentPayload.totalKm || 1;
  const s = Math.max(0, Math.min(1, km / total)) * RT[RT.length - 1].s;
  let lo = 0, hi = RT.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (RT[mid].s < s) lo = mid + 1; else hi = mid;
  }
  const a = RT[Math.max(0, lo - 1)], b = RT[lo];
  const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Caméra 2D : suit ma voiture par défaut, pan/zoom utilisateur sinon.
function continentView(w: number, h: number): { k: number; cx: number; cy: number; mapX: (x: number) => number; mapY: (y: number) => number } {
  const P = continentPayload!;
  const side = Math.min(w - 40, h - 40);
  const k = side / (P.sizeKm / continent2DZoom);
  const myPos = state?.cars.find((c) => c.playerId === myId);
  const myPt = myPos ? routeAt(myPos.positionKm) : null;
  if (continent2DCenter === null && myPt) continent2DCenter = { x: myPt.x, y: myPt.y };
  const cx = continent2DCenter?.x ?? myPt?.x ?? P.sizeKm / 2;
  const cy = continent2DCenter?.y ?? myPt?.y ?? P.sizeKm / 2;
  return { k, cx, cy, mapX: (x: number) => w / 2 + (x - cx) * k, mapY: (y: number) => h / 2 + (y - cy) * k };
}

function drawContinentMap(m: CanvasRenderingContext2D, w: number, h: number): void {
  if (!state || !continentPayload) return;
  continentPrepare();
  if (!continentOff || !continentRoute || continentRoute.length === 0) return;
  const P = continentPayload;
  const RT = continentRoute;
  const v = continentView(w, h);
  const k = v.k;
  const mapX = v.mapX, mapY = v.mapY;

  m.fillStyle = "#14181f";
  m.fillRect(0, 0, w, h);
  m.imageSmoothingEnabled = true;
  m.drawImage(continentOff, mapX(0), mapY(0), P.sizeKm * k, P.sizeKm * k);

  // itinéraire : couloir translucide puis trait (itération 12bis)
  const step = Math.max(1, Math.floor(RT.length / 12000));
  m.beginPath();
  for (let i = 0; i < RT.length; i += step) {
    const x = mapX(RT[i].x), y = mapY(RT[i].y);
    if (i === 0) m.moveTo(x, y); else m.lineTo(x, y);
  }
  m.lineJoin = "round";
  m.lineCap = "round";
  m.strokeStyle = "rgba(255, 217, 90, 0.28)";
  m.lineWidth = 7;
  m.stroke();
  m.strokeStyle = "#ffd95a";
  m.lineWidth = 2.4;
  m.stroke();

  // localités (payload : km)
  m.font = "10px sans-serif";
  for (const city of P.cities ?? []) {
    if (city.size < 2 && continent2DZoom < 3) continue;
    const x = mapX(city.x), y = mapY(city.y);
    m.fillStyle = "#efe8dc";
    m.beginPath();
    m.arc(x, y, Math.min(4, 1.5 + city.size / 3), 0, Math.PI * 2);
    m.fill();
    if (continent2DZoom > 4) m.fillText(city.name, x + 6, y + 3);
  }
  if (continent2DZoom >= 2) {
    for (const p of P.pois ?? []) {
      const x = mapX(p.x), y = mapY(p.y);
      m.fillStyle = "#f2b134";
      m.fillRect(x - 1.5, y - 1.5, 3, 3);
      if (continent2DZoom > 6) {
        m.fillStyle = "#ffe08a";
        m.fillText(p.name, x + 5, y - 4);
      }
    }
  }

  // stations (km → projection sur la vraie géométrie)
  const iconSize = Math.min(16, Math.max(10, 14 / Math.sqrt(continent2DZoom)));
  m.font = iconSize + "px sans-serif";
  for (const s of state.world.stations) {
    const pos = routeAt(s.km);
    const x = mapX(pos.x), y = mapY(pos.y);
    m.fillStyle = "#fff";
    m.fillText("⛽", x - iconSize / 2, y - 8);
    if (s.hasHotel) m.fillText("🏨", x + iconSize / 2, y - 8);
    if (continent2DZoom > 2) {
      m.font = "9px sans-serif";
      m.fillText(s.name, x - 18, y - 22);
      m.font = iconSize + "px sans-serif";
    }
  }
  // villages (x,y en m dans le monde) + gués
  if (continent2DZoom > 1.5) {
    for (const vil of state.world.villages ?? []) {
      m.fillText("🏠", mapX(vil.x / 1000) - 5, mapY(vil.y / 1000) + 14);
    }
    for (const riv of state.world.rivers ?? []) {
      const x = mapX(riv.x / 1000), y = mapY(riv.y / 1000);
      m.fillStyle = "#9fd4ff";
      m.fillText("≈", x - 5, y + 6);
      if (continent2DZoom > 8) m.fillText(riv.name, x + 6, y - 4);
    }
  }
  // fronts météo
  const FRONT_COLORS2: Record<string, string> = {
    pluie_diluvienne: "rgba(80,120,220,0.35)", tempete_sable: "rgba(210,160,80,0.4)",
    canicule: "rgba(230,120,40,0.25)", froid_intense: "rgba(160,200,255,0.3)",
    brouillard: "rgba(200,200,200,0.3)", vent_fort: "rgba(150,180,160,0.25)",
    grele: "rgba(190,210,255,0.4)", piste_endommagee: "rgba(120,60,40,0.5)",
  };
  m.font = "10px sans-serif";
  for (const f of state.fronts ?? []) {
    if (state.tick < f.startTick || state.tick > f.endTick) continue;
    const pos = routeAt(f.km);
    const fx = mapX(pos.x), fy = mapY(pos.y);
    m.fillStyle = FRONT_COLORS2[f.kind] ?? "rgba(150,150,150,0.3)";
    const fr = Math.max(3, f.radiusKm * k);
    m.beginPath();
    m.arc(fx, fy, fr, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "#fff";
    m.fillText(WEATHER_ICON[f.kind] ?? "?", fx - 6, fy - fr - 4);
  }
  // voitures (projection par arc : décalage ~1-3 %, voir routeAt)
  for (const car of state.cars) {
    const pos = routeAt(car.positionKm);
    const x = mapX(pos.x), y = mapY(pos.y);
    m.fillStyle = car.color;
    m.beginPath();
    m.arc(x, y, 6, 0, Math.PI * 2);
    m.fill();
    m.strokeStyle = "#fff";
    m.lineWidth = 1.5;
    m.stroke();
    const pp = state.players.find((q) => q.id === car.playerId);
    m.fillStyle = "#fff";
    m.font = "11px sans-serif";
    m.fillText(pp?.pseudo ?? "", x + 9, y + 4);
  }
  const A = RT[0], B = RT[RT.length - 1];
  m.fillStyle = "#fff";
  m.font = "bold 13px sans-serif";
  m.fillText("A", mapX(A.x) - 4, mapY(A.y) - 10);
  m.fillText("B", mapX(B.x) - 4, mapY(B.y) - 10);
  m.fillStyle = "#888";
  m.font = "10px sans-serif";
  m.fillText("Zoom ×" + continent2DZoom.toFixed(1) + " — molette: zoom, glisser: déplacer, double-clic: suivre", 10, h - 10);
}`);

//    7b. StateMsg connaît le mode.
patch("packages/client/src/main.ts",
`  challenges: any[];
  mine: MyCar | null;
}`,
`  challenges: any[];
  mine: MyCar | null;
  mode?: string;
}`);

//    7c. le handler "state" mémorise le mode.
patch("packages/client/src/main.ts",
`      msg.pathChunk = pathChunks;
      state = msg;`,
`      msg.pathChunk = pathChunks;
      state = msg;
      continentMode = state.mode === "continent";`);

//    7d. réception du payload continent (avant le handler "hud").
patch("packages/client/src/main.ts",
`    if (msg.type === "hud") {`,
`    if (msg.type === "continent") {
      continentPayload = msg.payload;
      return;
    }
    if (msg.type === "hud") {`);

//    7e. world_reset invalide le payload.
patch("packages/client/src/main.ts",
`    if (msg.type === "world_reset") {
      pathChunks.clear();
      camInit = false;
      return;
    }`,
`    if (msg.type === "world_reset") {
      pathChunks.clear();
      // Patch 9 : nouveau monde → payload continent périmé
      continentPayload = null;
      continentRoute = null;
      continentOff = null;
      continent2DCenter = null;
      continentMode = false;
      camInit = false;
      return;
    }`);

//    7f. drawMap aiguille vers la carte 2D si le payload est là.
patch("packages/client/src/main.ts",
`function drawMap(m: CanvasRenderingContext2D, w: number, h: number): void {
  if (!state) return;
`,
`function drawMap(m: CanvasRenderingContext2D, w: number, h: number): void {
  if (!state) return;
  if (continentPayload) { drawContinentMap(m, w, h); return; }
`);

// ---------------------------------------------------------------------------
// 8. engine.test.ts : import + tests de contrat continent (3 générations ~6 s).
// ---------------------------------------------------------------------------
patch("packages/engine/src/engine.test.ts",
`import { CarState, DEFAULT_RULES, TICKS_PER_HOUR, OrganId, TerrainSegment } from "./types";`,
`import { CarState, DEFAULT_RULES, TICKS_PER_HOUR, OrganId, TerrainSegment } from "./types";
import { generateContinent, buildContinentMap, __resetContinentCache } from "./continent";`);

append("packages/engine/src/engine.test.ts", block("tests-continent"));

console.log(`
✓ PATCH 9 APPLIQUÉ.

ROUTINE DE VALIDATION (dans l'ordre, avant tout commit) :
  1. npx tsc -p packages/engine
     (le générateur v2 n'a jamais passé tsc --strict : corriger les any
      implicites / initialisations signalés, SANS toucher à la logique)
  2. npx tsc -p packages/server
  3. type-check du client :
     node node_modules/typescript/bin/tsc --noEmit --target ES2020 \\
       --lib ES2020,DOM --module none packages/client/src/main.ts
  4. npm test   (les tests continent ajoutent ~20 s : 3 générations)
  5. npm run build
  6. test manuel :
     node packages/server/dist/index.js create continent vvr-continent-1 120 60 60 24 rally
     → http://localhost:8080, ouvrir la carte : continent (8 zones + relief +
       eau), réseau esquisse, itinéraire jaune, localités, voitures.
     → 2e terminal, même graine : totalKm identique (déterminisme).

GREPS DE GARDE :
  grep -c "get_continent" packages/server/src/index.ts packages/client/src/main.ts   (≥1 partout)
  grep -n "mode" packages/server/src/host.ts           (restore passe mode+seedText)
  grep -c "offRelief" packages/engine/src/continent.ts (0 attendu)
  grep -n "create continent" packages/server/src/index.ts
`);

// ---------------------------------------------------------------------------
// 9. BLOCS EMBARQUÉS — texte brut jamais évalué : il ne vit que pour être
//    relu dans CE fichier par block(). (template literal : le JS n'essaie pas
//    de parser son contenu ; les marqueurs @@ délimitent les extractions)
// ---------------------------------------------------------------------------
const EMBEDDED_BLOCKS = `
// @@BEGIN continent.ts@@
// ============================================================================
// CONTINENT — le monde 2D validé au banc (proto, 16 itérations) entre dans le
// moteur. Portage intégral du générateur du proto (carte "proto-carte-continent")
// en module du package engine : le continent 1 000 × 1 000 km (grille 1 km),
// le réseau routier en esquisse 4 km (chaikin, chirurgie des troncs dupliqués
// + échange de géométrie le long du parcours), le parcours du raid en VRAIE
// géométrie fine 250 m, et le guide 20 m (bruit latéral multi-octaves).
//
// Le moteur aval ne connaît QUE le contrat World de types.ts : points tous
// les 20 m, segments 5 km, stations, villages, biomeZones. Tout ce qui
// précède l'adaptateur ci-dessous est le code du proto, inchangé (validé
// sur les graines "vvr-continent-1" et "sahara-2026-vvr").
// ============================================================================


// ================================================================
// PROTO CARTE — Continent 1000×1000 km — Voyage Voyage Rally
// Prototype de calibration pour le chantier "refonte carte".
// Tout est procédural depuis la graine :
//   1. Relief : bruit fbm + masque continental + chaînes de montagne
//      (ridged noise placé par un bruit de "range").
//   2. Climat : bandes de latitude N→S avec ondulation (pas de lignes
//      droites), corrigées par l'altitude (montagne > neiges).
//   3. Hydrologie réelle : écoulement D8 vers l'aval + accumulation
//      (pluie par biome : les déserts n'ont que des oueds), lacs
//      endoréiques dans les cuvettes.
//   4. Villes : score climat/plaine (l'eau aide mais ne décide PAS seule),
//      puis les VILLAGES émergent le long du réseau routier (capillaires)
//      + quelques isolés (oasis/ranches), et les HAMEAUX naissent SUR les
//      routes — tailles variables, noms générés par culture.
//   5. Réseau routier : A* entre villes (coût pente + climat + gué/pont),
//      SINUOSITÉ par bruit de coût (routes qui ondulent en pays
//      habité, plus directes en désert profond / steppe).
//   6. Itinéraire du raid : le jeu est exclusivement SUR ROUTES → les
//      jambes A* suivent le réseau (coût ÷4 sur blocs routés) ; POI en
//      balayage angulaire depuis le sud = boucle ouverte, complétée par
//      insertion de villes jusqu'à la cible 4300+ km (le tracé A* 4 km
//      est une maquette ; le vrai moteur retracera au guide émergent
//      20 m, ×1,2-1,3 plus sinueux).
//   7. RÈGLE D'OR : l'itinéraire ne repasse JAMAIS au même endroit —
//      chaque jambe interdit ses blocs aux suivantes (recours orange,
//      rare, compté dans les stats).
// ================================================================

// ---------------- déterminisme ----------------
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

class Noise2D {
  private perm: Uint8Array;
  constructor(rnd: () => number) {
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = base[i];
      base[i] = base[j];
      base[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255];
  }
  private h(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }
  sample(x: number, y: number, scale: number): number {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = this.h(x0, y0);
    const b = this.h(x0 + 1, y0);
    const c = this.h(x0, y0 + 1);
    const d = this.h(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(x: number, y: number, baseScale: number, oct: number): number {
    let v = 0;
    let amp = 1;
    let sc = baseScale;
    let tot = 0;
    for (let o = 0; o < oct; o++) {
      v += this.sample(x, y, sc) * amp;
      tot += amp;
      amp *= 0.5;
      sc *= 0.45;
    }
    return v / tot;
  }
  ridged(x: number, y: number, baseScale: number, oct: number): number {
    let v = 0;
    let amp = 1;
    let sc = baseScale;
    let tot = 0;
    for (let o = 0; o < oct; o++) {
      const s = this.sample(x, y, sc);
      v += (1 - Math.abs(2 * s - 1)) * amp;
      tot += amp;
      amp *= 0.55;
      sc *= 0.45;
    }
    return v / tot;
  }
}

// ---------------- zones climatiques ----------------
interface Zone {
  key: string;
  label: string;
  color: string;
  pre: string[];
  suf: string[];
}
const ZONES: Zone[] = [
  {
    key: "boreal",
    label: "Boréal (nord froid)",
    color: "#9fb8c8",
    pre: ["Bal", "Kir", "Vard", "Hjor", "Snæ", "Ull", "Tor", "Kals", "Breg", "Nor", "Fjol", "Ryn", "Skav", "Grim", "Hal"],
    suf: ["vik", "dal", "fjord", "heim", "berg", "stad", "mark", "havn", "gard", "sund"],
  },
  {
    key: "tempere",
    label: "Tempéré",
    color: "#6fa05a",
    pre: ["Bel", "Aur", "Cham", "Cor", "Mont", "Vil", "Luc", "Riv", "Aire", "Bor", "Est", "Flor", "Gran", "Mira", "Ver"],
    suf: ["fort", "anne", "bourg", "ière", "ac", "ay", "val", "lieu", "court", "nesse"],
  },
  {
    key: "steppe",
    label: "Steppe",
    color: "#b0b470",
    pre: ["Kar", "Tash", "Bul", "Ula", "Ser", "Akt", "Kyz", "Ork", "Tur", "Bay", "Dzh", "Nam", "Arsl", "Kok", "Tal"],
    suf: ["gul", "ata", "bek", "kent", "tau", "orda", "sai", "bat", "aryk", "bashi"],
  },
  {
    key: "desert",
    label: "Désert",
    color: "#d9b36a",
    pre: ["Al-", "Bir", "Niz", "Ziz", "Gha", "Tan", "Sidi", "Wad", "Ham", "Tin", "Aye", "Kse", "Mah", "Sba", "Che"],
    suf: ["mer", "laou", "raf", "ane", "za", "ourt", "id", "jer", "al", "irat"],
  },
  {
    key: "sahel",
    label: "Steppe sèche (sahel)",
    color: "#c2a45e",
    pre: ["Ni", "Dor", "Mat", "Ban", "Gar", "Kan", "Tess", "Agu", "Bil", "Sok", "Fada", "Gou"],
    suf: ["noiro", "ma", "ou", "é", "tchou", "iba", "ounda", "ala", "ta", "ka"],
  },
  {
    key: "tropical",
    label: "Tropical humide",
    color: "#3f8a52",
    pre: ["Kin", "Ban", "Sou", "Nda", "Kou", "Lou", "Mat", "Dou", "Bam", "Tia", "Mbe", "Osse", "Sal", "Yam"],
    suf: ["dolo", "gara", "mba", "ssou", "kro", "ala", "engu", "ndi", "bala", "tou"],
  },
  {
    key: "montagne",
    label: "Haute montagne",
    color: "#b9bcc2",
    pre: ["Zar", "Kor", "Ter", "Van", "Sar", "Den"],
    suf: ["dagh", "mir", "stan", "ak", "kun", "zek"],
  },
  { key: "neige", label: "Neiges éternelles", color: "#edf3f6", pre: ["—"], suf: ["—"] },
];

// ---------------- constantes ----------------
const SIZE = 1000; // km (grille 1 km)
const N = SIZE * SIZE;
const BLOCK = 4; // blocs A* de 4 km
const NB = SIZE / BLOCK; // 250

interface Pt {
  x: number;
  y: number;
}
interface City extends Pt {
  name: string;
  size: number; // 0 capitale, 1 grande, 2 ville, 3 village
}
interface Poi extends Pt {
  name: string;
  kind: string;
}
interface Leg {
  pts: Pt[];
  km: number;
  fords: number;
  missing: boolean;
  relaxed: boolean; // recours : a dû réutiliser des blocs interdits (orange à l'écran)
  blocks: number[]; // blocs occupés (règle d'or : jamais repasser)
  fine?: Pt[] | null; // tracé raffiné 250 m — la VRAIE géométrie voiture
}
interface RoadPath {
  pts: Pt[];
  bridges: Pt[];
  main: boolean;
}
// Station essence / hôtel. Les DEUX réseaux sont indépendants :
// st/hot = niveau (0 absent, 1 petit, 2 standard, 3 grand).
interface Svc extends Pt {
  st: number; // station : 0 rien, 1 pompe-relais, 2 station, 3 grande station
  hot: number; // hôtel : 0 rien, 1 auberge, 2 hôtel, 3 grand hôtel
  road: number; // -1 = en localité (ou posé sur l'itinéraire), sinon index dans roads
  name: string;
}
// Service projeté sur le parcours du raid (position arc cumulée)
interface CourseSvc {
  km: number;
  st: number;
  hot: number;
  name: string;
}
interface WorldData {
  _seed: string;
  elev: Float32Array;
  clim: Uint8Array;
  ocean: Uint8Array;
  isRiver: Uint8Array;   // masque rivière par cellule 1 km (portage moteur)
  lakeMask: Uint8Array;  // masque lac par cellule 1 km
  cities: City[];
  roads: RoadPath[];
  pois: Poi[];
  legs: Leg[];
  totalKm: number;
  peak: number;
  riverKm: number;
  fords: number;
  bridges: number;
  lakes: Pt[];
  overlaps: number;
  fineKm: number; // longueur du tracé raffiné 250 m (la vraie géométrie)
  services: Svc[]; // stations & hôtels (villes + bord de route)
  courseSvc: CourseSvc[]; // services proches du parcours, triés par km
  svcGapMax: number; // plus longue section du parcours SANS station (km)
}

// ---------------- noms ----------------
function nameFor(zone: number, rnd: () => number): string {
  const z = ZONES[clamp(zone, 0, 5)];
  const p = z.pre[Math.floor(rnd() * z.pre.length)];
  const s = z.suf[Math.floor(rnd() * z.suf.length)];
  return p + s;
}

// ---------------- A* sur blocs 4 km ----------------
// tampons RÉUTILISÉS entre appels : allouer 4×62 500 cases à chacun des
// ~2 600 appels était le premier poste du GC (profile) ; les fills de
// remise à zéro restent, les valeurs calculées sont identiques.
let AS_DIST: Float32Array | null = null;
let AS_PREV: Int32Array | null = null;
let AS_CLOSED: Uint8Array | null = null;
let AS_HF: Float32Array | null = null;
function aStar(
  si: number,
  ti: number,
  bLand: Uint8Array,
  bElev: Float32Array,
  bClim: Uint8Array,
  bRiver: Uint8Array,
  road: boolean,
  sinN: Noise2D | null,
  roadBlocks: Uint8Array | null,
  banBlocks: Uint8Array | null,
  ex?: Set<number> | null,
  zoneBan?: Uint8Array | null,
  strictRoad?: boolean
): { pts: Pt[]; km: number; cross: Pt[] } | null {
  const M = NB * NB;
  if (!AS_DIST) {
    AS_DIST = new Float32Array(M);
    AS_PREV = new Int32Array(M);
    AS_CLOSED = new Uint8Array(M);
    AS_HF = new Float32Array(M);
  }
  const dist = AS_DIST.fill(Infinity);
  const prev = AS_PREV.fill(-1);
  const closed = AS_CLOSED.fill(0);
  const hfM = AS_HF.fill(NaN);
  const tx = ti % NB;
  const ty = (ti / NB) | 0;
  // heuristique PARESSEUSE : valeur identique au précalcul précédent, mais
  // calculée à la demande et mémoïsée dans hfM (Math.fround reproduit
  // l'arrondi float32 de l'ancien Float32Array → monde bit-à-bit identique).
  const hfOf = (i: number) => {
    const v = hfM[i];
    if (v === v) return v; // déjà calculée (≠ NaN)
    const h = Math.fround(Math.hypot(tx - (i % NB), ty - ((i / NB) | 0)) * (road ? 1.0 : 0.95));
    hfM[i] = h;
    return h;
  }; // < coût min réel : A* reste guidé
  const cf = [1.35, 1.0, 1.05, 1.2, 1.1, 1.45, 2.1, 2.6]; // boreal..neige
  const heap: number[] = [si];
  dist[si] = 0;
  const push = (idx: number) => {
    heap.push(idx);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      const fc = dist[heap[c]] + hfOf(heap[c]);
      const fp = dist[heap[p]] + hfOf(heap[p]);
      if (fp <= fc) break;
      const t = heap[p];
      heap[p] = heap[c];
      heap[c] = t;
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    if (heap.length > 0) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < heap.length && dist[heap[l]] + hfOf(heap[l]) < dist[heap[m]] + hfOf(heap[m])) m = l;
        if (r < heap.length && dist[heap[r]] + hfOf(heap[r]) < dist[heap[m]] + hfOf(heap[m])) m = r;
        if (m === p) break;
        const t = heap[m];
        heap[m] = heap[p];
        heap[p] = t;
        p = m;
      }
    }
    return top;
  };
  const D8X = [1, -1, 0, 0, 1, 1, -1, -1];
  const D8Y = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false;
  let guard = 0;
  while (heap.length > 0 && guard++ < 900000) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === ti) {
      found = true;
      break;
    }
    const cx = cur % NB;
    const cy = (cur / NB) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + D8X[d];
      const ny = cy + D8Y[d];
      if (nx < 0 || ny < 0 || nx >= NB || ny >= NB) continue;
      const ni = ny * NB + nx;
      if (!bLand[ni]) continue;
      // STRICTEMENT SUR LES VRAIES ROUTES (décision utilisateur : le raid
      // ne s'invente jamais de voie) : hors bloc routé, AUCUN passage.
      // Exception : la zone d'exemption 3×3 autour du POI de départ/arrivée
      // — une localité peut être posée juste à côté de la route ; le
      // raffinage 250 m raccroche le tracé à la vraie géométrie.
      if (strictRoad && roadBlocks && !roadBlocks[ni] && !(ex && ex.has(ni))) continue;
      // règle d'or : ne JAMAIS repasser au même endroit — les blocs déjà
      // utilisés deviennent un péage énorme (×50 ≈ 200 km de détour) plutôt
      // qu'une interdiction dure : une jambe ne les croise que si aucun
      // autre chemin n'existe, et elle devient "relaxed" (orange).
      // Une diagonale traverse aussi les 2 blocs de coin.
      // Exception : la petite zone autour des POI de départ/arrivée de CETTE
      // jambe — on arrive en ville et on en repart par le même couloir, ce
      // n'est pas un repassage (ex : ville au fond d'une vallée).
      const hit = banBlocks && (banBlocks[ni] || (d >= 4 && (banBlocks[cy * NB + nx] || banBlocks[ny * NB + cx])));
      const exHit =
        ex && (ex.has(ni) || (d >= 4 && (ex.has(cy * NB + nx) || ex.has(ny * NB + cx))));
      const banHit = !!hit && !exHit;
      // règle d'or (volet 2) : ne pas TRAVERSER une ville qui sera étape plus
      // tard — péage ×50 pour contourner les futures étapes (sauf goulot)
      const zoneHit =
        zoneBan && !exHit && (zoneBan[ni] || (d >= 4 && (zoneBan[cy * NB + nx] || zoneBan[ny * NB + cx])));
      const dH = Math.abs(bElev[ni] - bElev[cur]);
      let step = (d < 4 ? 1 : 1.4142) * cf[bClim[ni]] * (1 + dH * (road ? 0.08 : 0.014));
      if (bElev[ni] > 2200) step *= road ? 3 : 2;
      if (bRiver[ni]) step += road ? 12 : 3;
      if (banHit || zoneHit) step *= 50;
      // SINUOSITÉ : bruit de coût — les routes ondulent en pays habité
      // (tempéré/tropical/boréal), sont plus directes en steppe et quasi
      // rectilignes dans le désert profond (retour utilisateur)
      if (sinN) {
        // ATTENTION : le multiplicateur doit rester > 0 sinon Dijkstra casse
        // (coût négatif) — amp ≤ 0,7 garanti (1 - 0,7 = 0,3)
        const amp = bClim[ni] === 3 ? 0.15 : bClim[ni] === 2 ? 0.4 : bClim[ni] === 4 ? 0.35 : 0.7;
        step *= 1 + amp * ((sinN.fbm(nx, ny, 5, 2) - 0.5) * 2);
        // sinuosité MICRO (~8 km) : le relief de collines fait serpenter
        const ampM = bClim[ni] === 3 ? 0.06 : bClim[ni] === 2 ? 0.2 : 0.5;
        step *= 1 + ampM * ((sinN.fbm(nx, ny, 2, 1) - 0.5) * 2);
      }
      // le raid se court SUR ROUTES : blocs routés fortement préférés
      if (roadBlocks && roadBlocks[ni]) step *= 0.25;
      const nd = dist[cur] + step;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = cur;
        push(ni);
      }
    }
  }
  if (!found) return null;
  const blocks: number[] = [];
  let c = ti;
  while (c !== -1 && blocks.length < 100000) {
    blocks.push(c);
    if (c === si) break;
    c = prev[c];
  }
  blocks.reverse();
  const pts: Pt[] = [];
  let km = 0;
  const cross: Pt[] = [];
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    pts.push({ x: (b % NB) * BLOCK + BLOCK / 2, y: ((b / NB) | 0) * BLOCK + BLOCK / 2 });
    if (k > 0) {
      km += blocks[k - 1] % NB === b % NB || ((blocks[k - 1] / NB) | 0) === ((b / NB) | 0) ? BLOCK : BLOCK * 1.4142;
      const prevB = blocks[k - 1];
      if (bRiver[b] && !bRiver[prevB]) {
        cross.push(pts[k]);
      }
    }
  }
  return { pts, km, cross };
}

function chaikin(pts: Pt[], iters: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    const out: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

// ---------------- génération du continent ----------------
function generate(seedStr: string): WorldData {
  const seed = hashStr(seedStr || "vvr");
  const rnd = mulberry32(seed);
  const elevN = new Noise2D(mulberry32((seed ^ 0x9e3779b9) >>> 0));
  const climN = new Noise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const placN = new Noise2D(mulberry32((seed ^ 0xc2b2ae35) >>> 0));
  const sinN = new Noise2D(mulberry32((seed ^ 0x27d4eb2f) >>> 0));
  const microN = new Noise2D(mulberry32((seed ^ 0x165667b1) >>> 0));

  // --- 1. relief : continent + placement des chaînes par PERCENTILES ---
  // (seuils fixes = continents sans aucune montagne selon la graine ;
  // on garantit ~4-12 % de terrain montagneux quelle que soit la distribution)
  const elev = new Float32Array(N);
  const ocean = new Uint8Array(N);
  const clim = new Uint8Array(N);
  const cont = new Float32Array(N);
  const place = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const dEdge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      const mask = smoothstep(0, 90, dEdge);
      const base = elevN.fbm(x, y, 230, 4);
      const c = mask * (0.55 + 0.45 * (base - 0.5) * 2);
      cont[i] = c;
      place[i] = placN.fbm(x, y, 310, 3);
      if (c < 0.3) {
        ocean[i] = 1;
        elev[i] = 0;
        clim[i] = 255;
      }
    }
  }
  // ÉGALISATION D'HISTOGRAMME du placement : la distribution du bruit fbm
  // est très concentrée (les quantiles tombent dans le même seau selon la
  // graine). On mappe "place" sur son propre CDF → répartition uniforme,
  // les seuils 0,88/0,96 signifient EXACTEMENT « ramp 12 % / crêtes 4 % »
  // du continent, pour n'importe quelle graine.
  let landN = 0;
  const pBins = 1024;
  const pHist = new Uint32Array(pBins);
  for (let i = 0; i < N; i++) {
    if (!ocean[i]) {
      pHist[Math.min(pBins - 1, Math.floor(place[i] * pBins))]++;
      landN++;
    }
  }
  const cdf = new Float32Array(pBins + 1);
  let run = 0;
  for (let b = 0; b < pBins; b++) {
    run += pHist[b];
    cdf[b + 1] = run / Math.max(1, landN);
  }
  for (let i = 0; i < N; i++) {
    if (ocean[i]) continue;
    const h = (cont[i] - 0.3) / 0.7;
    const ridge = elevN.ridged(i % SIZE, (i / SIZE) | 0, 140, 3);
    const placeQ = cdf[Math.min(pBins - 1, Math.floor(place[i] * pBins))];
    const mMask = smoothstep(0.88, 0.96, placeQ);
    // socle alpin garanti par le placement + crêtes modulées par le ridge :
    // (sans socle, une graine dont les hauts "place" ont un ridge faible
    // n'avait que des moyennes montagnes — mesuré 2035 m)
    // relief MACRO (chaînes, 140-310 km) + INTERMÉDIAIRE (~60 km) +
    // MICRO-RELIEF (collines ~7 et ~3 km) : le réseau routier émerge de
    // ces trois échelles — une route qui n'a que du macro est monotone
    // à l'échelle de la voiture (retour utilisateur)
    elev[i] =
      25 +
      h * 320 +
      elevN.fbm(i % SIZE, (i / SIZE) | 0, 60, 2) * 140 +
      microN.fbm(i % SIZE, (i / SIZE) | 0, 7, 2) * 60 +
      mMask * (1100 + ridge * (900 + 1300 * h));
  }

  // --- 2. climat par latitude (ondulée) + altitude ---
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (ocean[i]) continue;
      const wob = (climN.fbm(x, y, 95, 3) - 0.5) * 170;
      const lat = y + wob;
      let z: number;
      if (lat < 150) z = 0;
      else if (lat < 400) z = 1;
      else if (lat < 560) z = 2;
      else if (lat < 790) z = 3;
      else if (lat < 880) z = 4;
      else z = 5;
      if (elev[i] > 1700) z = 6;
      if (elev[i] > 2850) z = 7;
      clim[i] = z;
    }
  }

  // --- 3. hydrologie : D8 + accumulation (tri par seaux d'altitude) ---
  const dir = new Int8Array(N).fill(-1);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (ocean[i]) continue;
      let bd = -1;
      let bs = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        const drop = elev[i] - elev[j] + (ocean[j] ? 1 : 0);
        const slope = drop / (d < 4 ? 1 : 1.4142);
        if (slope > bs) {
          bs = slope;
          bd = d;
        }
      }
      dir[i] = bd;
    }
  }
  // pluie par biome : les déserts n'alimentent presque rien
  const RAIN = [1.0, 1.3, 0.7, 0.12, 0.35, 1.9, 1.0, 0.8];
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) acc[i] = ocean[i] ? 0 : RAIN[clim[i] <= 7 ? clim[i] : 1];
  const NB_B = 520;
  const counts = new Uint32Array(NB_B);
  const q = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const b = ocean[i] ? 0 : Math.min(NB_B - 1, Math.floor(elev[i] / 8));
    q[i] = b;
    counts[b]++;
  }
  const offs = new Uint32Array(NB_B + 1);
  for (let b = NB_B - 1; b >= 0; b--) offs[b] = offs[b + 1] + counts[b + 1];
  const order = new Uint32Array(N);
  const cursor = Uint32Array.from(offs);
  for (let i = 0; i < N; i++) order[cursor[q[i]]++] = i;
  for (let k = 0; k < N; k++) {
    const i = order[k];
    const d = dir[i];
    if (d < 0) continue;
    const x = i % SIZE;
    const y = (i / SIZE) | 0;
    const j = (y + DY[d]) * SIZE + (x + DX[d]);
    acc[j] += acc[i];
  }

  // lacs endoréiques : cuvettes à gros bassin → petit remplissage local
  const lakeMask = new Uint8Array(N);
  const lakes: Pt[] = [];
  for (let k = 0; k < N; k++) {
    const i = order[k]; // ordre descendant : cuvette traitée après son bassin
    if (ocean[i] || dir[i] >= 0 || acc[i] < 1200 || lakeMask[i]) continue;
    const e0 = elev[i];
    const ix = i % SIZE;
    const iy = (i / SIZE) | 0;
    const qx: number[] = [ix];
    const qy: number[] = [iy];
    let cnt = 0;
    while (qx.length > 0 && cnt < 400) {
      const cx0 = qx.pop() as number;
      const cy0 = qy.pop() as number;
      for (let d = 0; d < 4; d++) {
        const nx = cx0 + DX[d];
        const ny = cy0 + DY[d];
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        if (ocean[j] || lakeMask[j] || elev[j] > e0 + 12 || Math.abs(nx - ix) > 20 || Math.abs(ny - iy) > 20) continue;
        lakeMask[j] = 1;
        qx.push(nx);
        qy.push(ny);
        cnt++;
      }
    }
    lakeMask[i] = 1;
    lakes.push({ x: ix, y: iy });
  }

  // distance aux rivières (pour l'erg : le cœur du désert)
  const isRiver = new Uint8Array(N);
  let riverKm = 0;
  for (let i = 0; i < N; i++) {
    if (!ocean[i] && !lakeMask[i] && acc[i] >= 280) {
      isRiver[i] = 1;
      riverKm++;
    }
  }
  const distR = new Int16Array(N).fill(-1);
  const bfsQ = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < N; i++) {
    if (isRiver[i] || lakeMask[i]) {
      distR[i] = 0;
      bfsQ[qt++] = i;
    }
  }
  while (qh < qt) {
    const i = bfsQ[qh++];
    const x = i % SIZE;
    const y = (i / SIZE) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const j = ny * SIZE + nx;
      if (ocean[j] || distR[j] >= 0) continue;
      distR[j] = distR[i] + 1;
      bfsQ[qt++] = j;
    }
  }

  // --- 4. villes (score eau/plaine/climat/côte) ---
  const CLIM_CITY = [0.05, 0.3, 0.13, 0.05, 0.1, 0.27, 0.02, 0];
  interface Cand {
    i: number;
    score: number;
  }
  const cands: Cand[] = [];
  for (let y = 3; y < SIZE - 3; y += 3) {
    for (let x = 3; x < SIZE - 3; x += 3) {
      const i = y * SIZE + x;
      if (ocean[i] || elev[i] > 1600) continue;
      let wmax = 0;
      let emax = 0;
      let emin = 99999;
      let coast = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const j = (y + dy) * SIZE + (x + dx);
          if (acc[j] > wmax) wmax = acc[j];
          if (ocean[j]) coast = 1;
          if (elev[j] > emax) emax = elev[j];
          if (elev[j] < emin) emin = elev[j];
        }
      }
      const wb = clamp(Math.log10(1 + wmax) / 4.5, 0, 1);
      const flat = emax - emin < 100 ? 0.07 : 0;
      const z = clim[i];
      // l'eau/côte AIDE mais ne décide plus seule (retour utilisateur) :
      // poids divisés ~2, le climat et la plaine pèsent davantage
      const score = CLIM_CITY[z <= 7 ? z : 1] + wb * 0.22 + coast * 0.06 + flat + rnd() * 0.12;
      cands.push({ i, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const cities: City[] = [];
  // RÉPARTITION GARANTIE PAR ZONE CLIMATIQUE (retour utilisateur) : sans
  // quotas, tout s'agglutinait en tempéré. Une grande ville PAR zone,
  // villes au quota d'habitabilité — l'eau n'est plus qu'un bonus.
  const HAB = [0.14, 0.26, 0.18, 0.07, 0.11, 0.24];
  const tryPlace = (c: Cand, size: number, minDist: number): boolean => {
    const x = c.i % SIZE;
    const y = (c.i / SIZE) | 0;
    for (const cc of cities) {
      if (Math.hypot(cc.x - x, cc.y - y) < minDist) return false;
    }
    cities.push({ x, y, name: nameFor(clim[c.i], rnd), size });
    return true;
  };
  const byZone: Cand[][] = [[], [], [], [], [], []];
  for (const c of cands) byZone[clamp(clim[c.i], 0, 5)].push(c);
  const pickQuota = (total: number, size: number, minDist: number, oneEach = false) => {
    const quota = HAB.map((v) => (oneEach ? 1 : Math.floor(v * total)));
    let left = total - quota.reduce((s, v) => s + v, 0);
    const frac = HAB.map((v, i) => ({ i, f: v * total - Math.floor(v * total) })).sort((a, b) => b.f - a.f);
    let fi = 0;
    while (left > 0) {
      quota[frac[fi % 6].i]++;
      left--;
      fi++;
    }
    for (let z = 0; z < 6; z++) {
      let taken = 0;
      for (const c of byZone[z]) {
        if (taken >= quota[z]) break;
        if (tryPlace(c, size, minDist)) taken++;
      }
    }
  };
  tryPlace(cands[0], 0, 0); // capitale au score global
  pickQuota(6, 1, 130, true); // une grande ville PAR zone
  pickQuota(26, 2, 52);
  // NB : les villages/hameaux émergent APRÈS le réseau routier (section 6b)
  const capitale = cities[0];

  // --- 5. blocs 4 km pour le pathfinding ---
  const bElev = new Float32Array(NB * NB);
  const bLand = new Uint8Array(NB * NB);
  const bRiver = new Uint8Array(NB * NB);
  const bClim = new Uint8Array(NB * NB);
  const bAcc = new Float32Array(NB * NB);
  for (let by = 0; by < NB; by++) {
    for (let bx = 0; bx < NB; bx++) {
      let land = 0;
      let river = 0;
      let esum = 0;
      let amax = 0;
      const ccnt = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          const j = (by * BLOCK + dy) * SIZE + (bx * BLOCK + dx);
          if (ocean[j]) continue;
          land++;
          esum += elev[j];
          if (isRiver[j] || lakeMask[j]) river++;
          if (acc[j] > amax) amax = acc[j];
          if (clim[j] <= 7) ccnt[clim[j]]++;
        }
      }
      const b = by * NB + bx;
      bLand[b] = land >= BLOCK * BLOCK * 0.5 ? 1 : 0;
      bElev[b] = land > 0 ? esum / land : 0;
      bRiver[b] = river > 0 ? 1 : 0;
      bAcc[b] = amax;
      let best = 1;
      let bc = -1;
      for (let z = 0; z < 8; z++) {
        if (ccnt[z] > bc) {
          bc = ccnt[z];
          best = z;
        }
      }
      bClim[b] = best;
    }
  }
  const fixBlock = (bx: number, by: number): number => {
    const b = clamp(by, 0, NB - 1) * NB + clamp(bx, 0, NB - 1);
    if (bLand[b]) return b;
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = clamp(bx + dx, 0, NB - 1);
          const ny = clamp(by + dy, 0, NB - 1);
          const nb = ny * NB + nx;
          if (bLand[nb]) return nb;
        }
      }
    }
    return b;
  };
  const cityBlock = (c: Pt): number => fixBlock((c.x / BLOCK) | 0, (c.y / BLOCK) | 0);

  // --- 6. réseau routier (A* entre villes) ---
  const roads: RoadPath[] = [];
  const roadKeys: (string | null)[] = []; // clé edgeSet parallèle (null = piste capillaire) — suit roads.splice
  const edgeSet = new Set<string>();
  const deg = new Map<string, number>();
  const addRoad = (a: City, b: City, main: boolean, preferRoad = true): boolean => {
    const key =
      a.x < b.x || (a.x === b.x && a.y < b.y) ? a.x + ":" + a.y + "-" + b.x + ":" + b.y : b.x + ":" + b.y + "-" + a.x + ":" + a.y;
    if (edgeSet.has(key)) return false;
    const r = aStar(cityBlock(a), cityBlock(b), bLand, bElev, bClim, bRiver, preferRoad, sinN, null, null);
    if (!r) return false;
    edgeSet.add(key);
    roadKeys.push(key);
    deg.set(a.x + ":" + a.y, (deg.get(a.x + ":" + a.y) || 0) + 1);
    deg.set(b.x + ":" + b.y, (deg.get(b.x + ":" + b.y) || 0) + 1);
    roads.push({ pts: chaikin(r.pts, 2), bridges: r.cross, main });
    return true;
  };
  const big = cities.filter((c) => c.size <= 1);
  for (const c of big) {
    const targets = cities
      .filter((o) => o !== c && o.size <= c.size)
      .sort((p, q2) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q2.x - c.x, q2.y - c.y))
      .slice(0, c.size === 0 ? 3 : 2);
    for (const t of targets) addRoad(c, t, true);
  }
  for (const c of cities.filter((c) => c.size === 2)) {
    const t = cities
      .filter((o) => o !== c && o.size <= 1)
      .sort((p, q2) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q2.x - c.x, q2.y - c.y))[0];
    if (t) addRoad(c, t, true);
  }
  // MAILLAGE (décision utilisateur : « boucles supplémentaires, réseau
  // maillé — mieux pour un raid ») : l'arbre capitale→grandes→villes laisse
  // des culs-de-sac partout ; ~14 liaisons entre villes proches créent des
  // boucles et de la redondance. Paires triées par distance, degré max 4.
  {
    const urb = cities.filter((c) => c.size <= 2);
    const pairs: { a: City; b: City; d: number }[] = [];
    for (let i = 0; i < urb.length; i++)
      for (let j = i + 1; j < urb.length; j++) {
        const d = Math.hypot(urb[i].x - urb[j].x, urb[i].y - urb[j].y);
        if (d < 260) pairs.push({ a: urb[i], b: urb[j], d });
      }
    pairs.sort((p, q2) => p.d - q2.d);
    let added = 0;
    for (const p of pairs) {
      if (added >= 14) break;
      const da = deg.get(p.a.x + ":" + p.a.y) || 0;
      const db = deg.get(p.b.x + ":" + p.b.y) || 0;
      if (da >= 4 || db >= 4) continue;
      if (addRoad(p.a, p.b, true)) added++;
    }
  }
  // --- 6b. VILLAGES & HAMEAUX : NUAGE TERRAIN ↔ RUBAN, le réseau découle
  // des lieux (décision utilisateur : « des POI dispersés en nuage et le
  // réseau routier en découlant »). Pays ancien (tempéré/boréal/tropical) :
  // le peuplement se lit sur le TERRAIN (eau, vallées) puis chaque lieu
  // tire sa piste capillaire. Désert/steppe/sahel : le ruban domine — l'eau
  // et la piste caravanière naissent ensemble. Quelques isolés (oasis).
  // aide au score mais ne décide plus seule (retour utilisateur). Tailles
  // variables : village (3) / hameau (4).
  const roadBlocks = new Uint8Array(NB * NB);
  const markRoads = (full?: boolean) => {
    // full = marque chaque bloc TRAVERSÉ (pas seulement les sommets : une
    // piste droite peut sauter des blocs sans sommet) — réservé au rebuild
    // FINAL avant l'itinéraire strict ; sans full, marquage par sommets
    // inchangé (le placement des localités en amont ne doit pas bouger).
    for (const r of roads) {
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1];
        const b = r.pts[i];
        if (!full) {
          const bx = clamp((a.x / BLOCK) | 0, 0, NB - 1);
          const by = clamp((a.y / BLOCK) | 0, 0, NB - 1);
          roadBlocks[by * NB + bx] = 1;
        } else {
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (BLOCK / 4)));
          for (let s = 0; s <= n; s++) {
            const bx = clamp((a.x + ((b.x - a.x) * s) / n) / BLOCK, 0, NB - 1) | 0;
            const by = clamp((a.y + ((b.y - a.y) * s) / n) / BLOCK, 0, NB - 1) | 0;
            roadBlocks[by * NB + bx] = 1;
          }
        }
      }
      if (!full && r.pts.length > 0) {
        const p = r.pts[r.pts.length - 1];
        const bx = clamp((p.x / BLOCK) | 0, 0, NB - 1);
        const by = clamp((p.y / BLOCK) | 0, 0, NB - 1);
        roadBlocks[by * NB + bx] = 1;
      }
    }
  };
  markRoads();
  const MB = NB * NB;
  const distRoad = new Int16Array(MB).fill(-1);
  const nearRoad = new Int32Array(MB).fill(-1);
  const bq = new Int32Array(MB);
  let bqh = 0;
  let bqt = 0;
  for (let b = 0; b < MB; b++) {
    if (roadBlocks[b]) {
      distRoad[b] = 0;
      nearRoad[b] = b;
      bq[bqt++] = b;
    }
  }
  while (bqh < bqt) {
    const b = bq[bqh++];
    const bx = b % NB;
    const by = (b / NB) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = bx + DX[d];
      const ny = by + DY[d];
      if (nx < 0 || ny < 0 || nx >= NB || ny >= NB) continue;
      const nb = ny * NB + nx;
      if (!bLand[nb] || distRoad[nb] >= 0) continue;
      distRoad[nb] = distRoad[b] + 1;
      nearRoad[nb] = nearRoad[b];
      bq[bqt++] = nb;
    }
  }
  const placeSettlements = (
    pool: { b: number; score: number }[],
    count: number,
    minDistKm: number,
    size: number,
    dens: number[] | null
  ) => {
    pool.sort((a, b) => b.score - a.score);
    // quota PAR ZONE (retour utilisateur) : les zones hostiles reçoivent
    // aussi leurs villages/hameaux au prorata d'une densité propre —
    // le score seul agglutinait tout en tempéré
    const sum = dens ? dens.reduce((s, v) => s + v, 0) : 0;
    const quota = dens ? dens.map((v) => Math.round((v / sum) * count)) : null;
    const taken = new Array(6).fill(0);
    let total = 0;
    for (const cand of pool) {
      if (total >= count) break;
      const z = clamp(bClim[cand.b], 0, 5);
      if (quota && taken[z] >= quota[z]) continue;
      const x = (cand.b % NB) * BLOCK + BLOCK / 2;
      const y = ((cand.b / NB) | 0) * BLOCK + BLOCK / 2;
      let ok = true;
      for (const cc of cities) {
        if (Math.hypot(cc.x - x, cc.y - y) < minDistKm) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      cities.push({ x, y, name: nameFor(bClim[cand.b], rnd), size });
      taken[z]++;
      total++;
    }
  };
  // villages riverains de la route (≤24 km) ; isolés au-delà de 56 km
  const poolR: { b: number; score: number }[] = [];
  const poolW: { b: number; score: number }[] = [];
  for (let b = 0; b < MB; b++) {
    if (!bLand[b] || nearRoad[b] < 0) continue;
    const water = clamp(Math.log10(1 + bAcc[b]) / 4.5, 0, 1);
    if (distRoad[b] >= 1 && distRoad[b] <= 6) {
      // village légèrement À CÔTÉ de la route (2 blocs ≈ 8 km idéaux) :
      // cela fait naître de vraies pistes capillaires
      poolR.push({ b, score: 1.2 - Math.abs(distRoad[b] - 2) * 0.12 + water * 0.2 + rnd() * 0.5 });
    } else if (distRoad[b] > 14) {
      poolW.push({ b, score: 0.4 + water * 0.6 + rnd() * 0.35 });
    }
  }
  // NUAGE TERRAIN (décision utilisateur : « des POI dispersés en nuage, le
  // réseau routier en découlant ») : candidats notés SANS AUCUNE référence
  // aux routes — eau, fond de vallée/terrain plat, bruit. La route viendra
  // APRÈS, par la piste capillaire. Légère pénalité au-delà de ~32 km du
  // réseau (les vrais isolés — oasis/puits — ont leur pool dédié).
  const poolC: { b: number; score: number }[] = [];
  for (let b = 0; b < MB; b++) {
    if (!bLand[b] || nearRoad[b] < 0) continue;
    const water = clamp(Math.log10(1 + bAcc[b]) / 4.5, 0, 1);
    const bx = b % NB;
    const by = (b / NB) | 0;
    let ds = 0;
    let dn = 0;
    for (let d = 0; d < 4; d++) {
      const nx = bx + DX[d];
      const ny = by + DY[d];
      if (nx < 0 || ny < 0 || nx >= NB || ny >= NB) continue;
      ds += Math.abs(bElev[ny * NB + nx] - bElev[b]);
      dn++;
    }
    const flat = clamp(1 - ds / (dn * 120), 0, 1); // fond de vallée / plat
    if (distRoad[b] > 18) continue; // ≤ ~72 km du réseau principal : au-delà, c'est le rôle des isolés
    const far = Math.max(0, distRoad[b] - 6) * 0.08; // la distance au réseau coûte cher
    poolC.push({ b, score: water * 0.5 + flat * 0.25 + rnd() * 0.3 - far });
  }
  // densités par zone [boréal, tempéré, steppe, désert, sahel, tropical] :
  // l'habité domine mais TOUTES les zones ont des villages (retour utilisateur)
  const VILL_DENS = [0.1, 0.28, 0.13, 0.11, 0.14, 0.24];
  const ISO_DENS = [0.1, 0.14, 0.16, 0.28, 0.2, 0.12]; // isolés = oasis/puits, désert & sahel en tête
  const HAM_DENS = [0.1, 0.28, 0.14, 0.11, 0.14, 0.23];
  // pondération NUAGE ↔ RUBAN par zone (décision utilisateur) : le pays
  // ancien (tempéré, boréal, tropical) se peuple depuis le TERRAIN, le
  // désert/sahel/steppe le long des pistes — l'eau et la route y naissent
  // ensemble, comme les pistes caravanières
  const CLOUD_V = [0.6, 0.8, 0.3, 0.15, 0.25, 0.7];
  const CLOUD_H = [0.4, 0.5, 0.2, 0.05, 0.15, 0.45];
  const densR = VILL_DENS.map((v, z) => v * (1 - CLOUD_V[z]));
  const densC = VILL_DENS.map((v, z) => v * CLOUD_V[z]);
  const densHr = HAM_DENS.map((v, z) => v * (1 - CLOUD_H[z]));
  const densHc = HAM_DENS.map((v, z) => v * CLOUD_H[z]);
  placeSettlements(poolR, Math.round(550 * densR.reduce((s, v) => s + v, 0)), 7, 3, densR);
  placeSettlements(poolC, Math.round(550 * densC.reduce((s, v) => s + v, 0)), 7, 3, densC);
  placeSettlements(poolW, 90, 13, 3, ISO_DENS);
  // hameaux du NUAGE : placés par le terrain, AVANT les pistes capillaires
  placeSettlements(poolC, Math.round(620 * densHc.reduce((s, v) => s + v, 0)), 4, 4, densHc);
  // pistes capillaires : chaque village (ruban, nuage, isolé) rejoint la
  // route la plus proche — LA ROUTE DÉCOULE DU LIEU, pas l'inverse
  for (const v of cities.filter((c) => c.size === 3)) {
    const vb = fixBlock((v.x / BLOCK) | 0, (v.y / BLOCK) | 0);
    const target = nearRoad[vb];
    if (target < 0 || target === vb) continue;
    const tr = aStar(vb, target, bLand, bElev, bClim, bRiver, true, sinN, null, null);
    if (tr) {
      roads.push({ pts: chaikin(tr.pts, 2), bridges: tr.cross, main: false });
      roadKeys.push(null);
    }
  }
  // MAILLAGE RURAL — TOILE D'ARRAIGNÉE (retour utilisateur : « crée de
  // nouvelles routes pour interconnecter les POI, comme une toile
  // d'araignée routière réaliste : grands axes entre grands POI, petites
  // routes/chemins entre petits POI »). Chaque village se relie à ses DEUX
  // localités les plus proches (≤45 km) — degré typique 3-4 (capillaire +
  // 2 liaisons) ; chemins directs par le terrain (preferRoad=false) pour
  // CRÉER de nouveaux couloirs au lieu de longer les axes existants.
  for (const v of cities.filter((c) => c.size === 3)) {
    const near = cities
      .filter((o) => o !== v && o.size <= 3)
      .map((o) => ({ o, d: Math.hypot(o.x - v.x, o.y - v.y) }))
      .filter((p) => p.d <= 45)
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(2, near.length); k++) addRoad(v, near[k].o, false, false);
  }
  // + hameaux du nuage (hors route) : leur piste aussi, dans la limite de
  // ~48 km (au-delà : lieu-dit sans desserte, il en existe)
  for (const v of cities.filter((c) => c.size === 4)) {
    const vb = fixBlock((v.x / BLOCK) | 0, (v.y / BLOCK) | 0);
    if (distRoad[vb] <= 0 || distRoad[vb] > 12) continue;
    const target = nearRoad[vb];
    if (target < 0 || target === vb) continue;
    const tr = aStar(vb, target, bLand, bElev, bClim, bRiver, true, sinN, null, null);
    if (tr) {
      roads.push({ pts: chaikin(tr.pts, 2), bridges: tr.cross, main: false });
      roadKeys.push(null);
    }
  }
  // + CHEMINS RURAUX : les hameaux du nuage se relient aussi au village le
  // plus proche (≤15 km) — les fermes/hameaux vivent en réseau local, plus
  // qu'un seul chemin d'entrée. Les hameaux sur route n'en ont pas besoin.
  for (const v of cities.filter((c) => c.size === 4)) {
    const vb = fixBlock((v.x / BLOCK) | 0, (v.y / BLOCK) | 0);
    if (distRoad[vb] <= 0) continue; // sur une route déjà
    let best: City | null = null;
    let bd = 15;
    for (const o of cities) {
      if (o.size !== 3) continue;
      const d = Math.hypot(o.x - v.x, o.y - v.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best) addRoad(v, best, false, false);
  }
  // --- 6c. CHECK CONNECTIVITÉ (retour utilisateur : « certains POI
  // proches très interconnectés avec des routes presque inutiles, et à
  // d'autres endroits 2 POI non connectés, la seule route est un immense
  // détour »). Graphe bloc (4 km) reconstruit du réseau réel, arcs
  // pondérés par la longueur VRAIE entre transitions de bloc (accumulateur
  // d'arc, pas seulement le dernier sous-segment) — sert aux deux passes :
  // élagage puis liaisons manquantes.
  const rawBlock = (p: { x: number; y: number }): number =>
    clamp((p.y / BLOCK) | 0, 0, NB - 1) * NB + clamp((p.x / BLOCK) | 0, 0, NB - 1);
  const connGraph = () => {
    const nid = new Map<number, number>();
    const ad: number[][] = [], aw: number[][] = [], ar: number[][] = [];
    const node = (b: number): number => {
      let n = nid.get(b);
      if (n === undefined) {
        n = ad.length;
        nid.set(b, n);
        ad.push([]);
        aw.push([]);
        ar.push([]);
      }
      return n;
    };
    roads.forEach((r, ri) => {
      let prev = node(rawBlock(r.pts[0]));
      let acc = 0;
      for (let i = 1; i < r.pts.length; i++) {
        acc += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
        const n = node(rawBlock(r.pts[i]));
        if (n !== prev) {
          ad[prev].push(n);
          aw[prev].push(acc);
          ar[prev].push(ri);
          ad[n].push(prev);
          aw[n].push(acc);
          ar[n].push(ri);
          prev = n;
          acc = 0;
        }
      }
    });
    return { nid, ad, aw, ar };
  };
  const CONN_INF = 1e9;
  // tas binaire (le balayage de candidats large explore des régions 10×
  // plus grandes que la fenêtre 25 km : le scan linéaire coûtait trop)
  const connDij = (
    g: ReturnType<typeof connGraph>,
    src: number,
    cap: number,
    excl: number,
  ): { d: Float64Array; prv: Int32Array; prr: Int32Array } => {
    const d = new Float64Array(g.ad.length).fill(CONN_INF);
    const prv = new Int32Array(g.ad.length).fill(-1);
    const prr = new Int32Array(g.ad.length).fill(-1);
    const hp: number[] = [src];
    const hf: number[] = [0];
    const up = () => {
      let c = hp.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hf[p] <= hf[c]) break;
        const tn = hp[p];
        hp[p] = hp[c];
        hp[c] = tn;
        const tf = hf[p];
        hf[p] = hf[c];
        hf[c] = tf;
        c = p;
      }
    };
    const down = () => {
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = l + 1;
        let m = p;
        if (l < hp.length && hf[l] < hf[m]) m = l;
        if (r < hp.length && hf[r] < hf[m]) m = r;
        if (m === p) break;
        const tn = hp[m];
        hp[m] = hp[p];
        hp[p] = tn;
        const tf = hf[m];
        hf[m] = hf[p];
        hf[p] = tf;
        p = m;
      }
    };
    d[src] = 0;
    prv[src] = src;
    while (hp.length) {
      const u = hp[0];
      const du = hf[0];
      hp[0] = hp[hp.length - 1];
      hf[0] = hf[hf.length - 1];
      hp.pop();
      hf.pop();
      down();
      if (du > d[u]) continue;
      for (let e = 0; e < g.ad[u].length; e++) {
        const v = g.ad[u][e];
        let w2 = g.aw[u][e];
        if (excl >= 0 && g.ar[u][e] === excl) w2 *= 100;
        const nd = du + w2;
        if (nd < d[v] && nd <= cap) {
          d[v] = nd;
          prv[v] = u;
          prr[v] = g.ar[u][e];
          hp.push(v);
          hf.push(nd);
          up();
        }
      }
    }
    return { d, prv, prr };
  };
  const connPrune = (protect: Set<number> | null): number => {
    const g = connGraph();
    const delSet = new Set<number>();
    const altRoads = new Map<number, number[]>(); // route → routes de son chemin alternatif
    const delPair = new Set<string>();
    roads.forEach((r, ri) => {
      if (r.main || (protect !== null && protect.has(ri))) return;
      let len = 0;
      for (let i = 1; i < r.pts.length; i++)
        len += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
      if (len < 9) return;
      const na = g.nid.get(rawBlock(r.pts[0]));
      const nb2 = g.nid.get(rawBlock(r.pts[r.pts.length - 1]));
      if (na === undefined || nb2 === undefined || na === nb2) return;
      const pk = na < nb2 ? na + "-" + nb2 : nb2 + "-" + na;
      if (delPair.has(pk)) return; // ne jamais élaguer deux fois la même paire
      const { d, prv, prr } = connDij(g, na, len * 1.25 + 8, ri);
      if (d[nb2] < CONN_INF && d[nb2] <= len * 1.15) {
        delSet.add(ri);
        delPair.add(pk);
        const used: number[] = [];
        let cur = nb2;
        while (cur !== na && cur >= 0) {
          if (prr[cur] >= 0) used.push(prr[cur]);
          cur = prv[cur];
        }
        altRoads.set(ri, used);
      }
    });
    // fixpoint : retirer du lot toute route dont l'alternative passe par
    // une autre route du lot — jusqu'à stabilité
    let changed = true;
    while (changed) {
      changed = false;
      for (const ri of Array.from(delSet)) {
        const used = altRoads.get(ri);
        if (used && used.some((x) => x !== ri && delSet.has(x))) {
          delSet.delete(ri);
          changed = true;
        }
      }
    }
    const del = Array.from(delSet).sort((a, b) => b - a);
    for (const k of del) {
      const rk2 = roadKeys[k];
      if (rk2) edgeSet.delete(rk2); // une route élaguée ne doit PAS verrouiller sa paire pour toujours
      roads.splice(k, 1);
      roadKeys.splice(k, 1);
    }
    return del.length;
  };
  // passe 1 — ÉLAGAGE : une route mineure ≥ 9 km dont le réseau offre déjà
  // une alternative ≤ 1,15× sans elle ne sert à rien, on la retire. Les
  // accès uniques (hameaux, isolés : sans alternative) sont gardés par
  // construction. POINT FIXE CONSERVATEUR : toutes les suppressions sont
  // d'abord décidées sur le même graphe, mais une route dont l'alternative
  // emprunte une autre route marquée est gardée — sinon deux routes
  // mutuellement justifiées disparaissent ensemble et creusent un trou
  // (défaut constaté au banc : paires à ×7 après élagage). On itère
  // jusqu'à stabilité : chaque suppression restante a une alternative qui
  // ne passe par aucune autre suppression. AVANT les hameaux-ruban : aucun
  // lieu ne peut rester sur une route effacée.
  connPrune(null);
  markRoads();
  // hameaux ruban : directement sur les routes
  const poolH: { b: number; score: number }[] = [];
  for (let b = 0; b < MB; b++) {
    if (roadBlocks[b] && bLand[b]) poolH.push({ b, score: rnd() });
  }
  placeSettlements(poolH, Math.round(560 * densHr.reduce((s, v) => s + v, 0)), 4, 4, densHr);
  // passe 2 — LIAISONS MANQUANTES (v2, retour utilisateur : « regarde
  // globalement » — la fenêtre 25 km laissait passer des frontières de
  // grappes entières : deux amas de villages voisins reliés par un couloir
  // lointain, détour ×7 ou pire). Deux boucles :
  //  · LARGE : fenêtre 3-90 km, critère = EXCÈS ABSOLU détour − à-vol >
  //    60 km (ce qui se VOIT sur la carte) ; injoignables sous le cap =
  //    pires candidates ; priorité par excès décroissant, budget 60,
  //    jusqu'à épuisement (max 4) — une liaison de frontière répare toute
  //    la matrice des paires voisines. Au-delà de 45 km, pas de liaison
  //    hameau↔hameau (une piste de 90 km entre deux fermes n'existe pas).
  //  · PROCHE : fenêtre 3-25 km à ratio > 2,2 (marché de proximité
  //    validé en itération 11) — APRÈS la large, qui peut avoir changé
  //    les plus courts chemins ; garantit le zoom proche propre.
  {
    const sNodes = (g: ReturnType<typeof connGraph>): number[] =>
      cities.map((c) => {
        const b = rawBlock(c);
        const n = g.nid.get(b);
        if (n !== undefined) return n;
        const bx = b % NB;
        const by = (b / NB) | 0;
        for (let r2 = 1; r2 <= 2; r2++)
          for (let dy = -r2; dy <= r2; dy++)
            for (let dx = -r2; dx <= r2; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r2) continue;
              const nb3 = g.nid.get(clamp(by + dy, 0, NB - 1) * NB + clamp(bx + dx, 0, NB - 1));
              if (nb3 !== undefined) return nb3;
            }
        return -1;
      });
    const wide = () => {
      const g = connGraph();
      const sN = sNodes(g);
      const pairs = new Map<number, number[]>();
      const maxEu = new Map<number, number>();
      for (let i = 0; i < cities.length; i++) {
        if (sN[i] < 0) continue;
        let m = 3;
        for (let j = i + 1; j < cities.length; j++) {
          if (sN[j] < 0 || sN[i] === sN[j]) continue;
          const eu = Math.hypot(cities[i].x - cities[j].x, cities[i].y - cities[j].y);
          if (eu < 3 || eu > 90) continue;
          const l = pairs.get(i);
          if (l) l.push(j);
          else pairs.set(i, [j]);
          if (eu > m) m = eu;
        }
        if (pairs.has(i)) maxEu.set(i, m);
      }
      const cand: { a: number; b: number; ex: number }[] = [];
      for (const [i, js] of pairs) {
        const cap = (maxEu.get(i) as number) + 62;
        const { d } = connDij(g, sN[i], cap, -1);
        for (const j of js) {
          const eu = Math.hypot(cities[i].x - cities[j].x, cities[i].y - cities[j].y);
          const net = d[sN[j]];
          const unreach = net >= CONN_INF;
          const ex = unreach ? cap - eu : net - eu;
          const sizeOK = eu <= 45 || Math.min(cities[i].size, cities[j].size) <= 3;
          if (ex > 60 && sizeOK) cand.push({ a: i, b: j, ex });
        }
      }
      cand.sort((p, q2) => q2.ex - p.ex);
      let linked = 0;
      for (const p2 of cand) {
        if (linked >= 60) break;
        if (addRoad(cities[p2.a], cities[p2.b], false, false)) linked++;
      }
      return linked;
    };
    const linkPass = (wideMax: number, closeMax: number): void => {
      for (let sweep = 0; sweep < wideMax; sweep++) if (wide() === 0) break;
      // boucle PROCHE : ratio > 2,2 à ≤ 25 km, cap modeste
      for (let sweep = 0; sweep < closeMax; sweep++) {      const g = connGraph();
      const sN = sNodes(g);
      const pairs = new Map<number, number[]>();
      for (let i = 0; i < cities.length; i++) {
        if (sN[i] < 0) continue;
        for (let j = i + 1; j < cities.length; j++) {
          if (sN[j] < 0 || sN[i] === sN[j]) continue;
          const eu = Math.hypot(cities[i].x - cities[j].x, cities[i].y - cities[j].y);
          if (eu < 3 || eu > 25) continue;
          const l = pairs.get(i);
          if (l) l.push(j);
          else pairs.set(i, [j]);
        }
      }
      const cand: { a: number; b: number; ex: number }[] = [];
      for (const [i, js] of pairs) {
        const { d } = connDij(g, sN[i], 62, -1);
        for (const j of js) {
          const eu = Math.hypot(cities[i].x - cities[j].x, cities[i].y - cities[j].y);
          const net = d[sN[j]];
          const est = net >= CONN_INF ? 62 / eu : net / eu;
          if (est > 2.2) cand.push({ a: i, b: j, ex: net >= CONN_INF ? 62 - eu : net - eu });
        }
      }
      cand.sort((p, q2) => q2.ex - p.ex);
      let linked = 0;
      for (const p2 of cand) {
        if (linked >= 50) break;
        if (addRoad(cities[p2.a], cities[p2.b], false, false)) linked++;
      }
        if (linked === 0) break;
      }
    };
    linkPass(6, 2);
    // passe 3 — ÉLAGAGE FINAL : les liaisons ajoutées rendent certaines
    // routes du maillage initial redondantes (alternative ≤ 1,15× par les
    // nouveaux couloirs) — on les retire. SAUF les routes qui portent un
    // hameau-ruban (posé sur la route, il deviendrait orphelin) ; les
    // hameaux du nuage gardent leur piste (accès unique, jamais éligible).
    {
      const g = connGraph();
      const protect = new Set<number>();
      for (const c of cities) {
        if (c.size !== 4) continue;
        const n = g.nid.get(rawBlock(c));
        if (n === undefined) continue;
        for (const ri of g.ar[n]) protect.add(ri);
      }
      connPrune(protect);
    }
    // passe 4 — RE-LIAISON post-élagage : l'élagage final peut dégrader
    // quelques paires (un chemin alternatif peut réutiliser une route
    // elle-même devenue redondante) ; les clés edgeSet nettoyées à la
    // suppression permettent de re-lier — dernier balayage court.
    linkPass(2, 1);
  }
  // RÉSEAU FINAL pour la contrainte stricte de l'itinéraire : sans ce
  // reset, roadBlocks garde la trace des routes ÉLAGUÉES (markRoads ne
  // fait qu'ajouter) — l'itinéraire strict circulerait sur des routes
  // fantômes supprimées. full = marquage segmentaire complet.
  roadBlocks.fill(0);
  markRoads(true);

  // --- 7. POI + itinéraire (balayage angulaire depuis le sud) ---
  let peak = 0;
  let peakI = -1;
  for (let i = 0; i < N; i++) {
    if (!ocean[i] && elev[i] > peak) {
      peak = elev[i];
      peakI = i;
    }
  }
  const pois: Poi[] = [{ ...capitale, kind: "départ" }];
  for (const c of cities.filter((c) => c.size === 1)) pois.push({ ...c, kind: "ville étape" });
  if (peakI >= 0)
    pois.push({ x: peakI % SIZE, y: (peakI / SIZE) | 0, name: "Mont " + nameFor(clim[peakI], rnd), kind: "sommet" });
  let ergI = -1;
  let ergD = 25;
  for (let i = 0; i < N; i += 5) {
    if (clim[i] === 3 && distR[i] > ergD) {
      ergD = distR[i];
      ergI = i;
    }
  }
  if (ergI >= 0) pois.push({ x: ergI % SIZE, y: (ergI / SIZE) | 0, name: "Erg " + nameFor(3, rnd), kind: "dunes" });
  let oaI = -1;
  let oaA = 400;
  for (let i = 0; i < N; i++) {
    if (clim[i] === 3 && isRiver[i] && acc[i] > oaA) {
      oaA = acc[i];
      oaI = i;
    }
  }
  if (oaI >= 0) pois.push({ x: oaI % SIZE, y: (oaI / SIZE) | 0, name: "Oasis de " + nameFor(3, rnd), kind: "oasis" });
  if (lakes.length > 0) {
    let lk = lakes[0];
    let la = 0;
    for (const l of lakes) {
      const ii = l.y * SIZE + l.x;
      if (acc[ii] > la) {
        la = acc[ii];
        lk = l;
      }
    }
    pois.push({ x: lk.x, y: lk.y, name: "Lac " + nameFor(clim[lk.y * SIZE + lk.x], rnd), kind: "lac" });
  }
  const villes = cities.filter((c) => c.size === 2);
  if (villes.length > 0) {
    const west = villes.reduce((a, b) => (a.x < b.x ? a : b));
    const north = villes.reduce((a, b) => (a.y < b.y ? a : b));
    pois.push({ ...west, kind: "ville étape" });
    if (north !== west) pois.push({ ...north, kind: "ville étape" });
  }
  // STRICTEMENT SUR ROUTES (décision utilisateur) : les étapes thématiques
  // (sommet, dunes, oasis, lac) sont posées sur leur site naturel —
  // parfois à 17-76 km de toute route. La course ne pouvant plus quitter
  // le réseau, chaque étape est RACCROCHÉE au point du réseau le plus
  // proche (le roadhead du mont, la piste au bord de l'erg) : l'étape
  // garde son nom, le site reste sur la carte, le tracé rallie son accès
  // routier — aucune voie n'est inventée.
  {
    const snapToRoad = (p: Poi, others: Poi[]): void => {
      // tous les points projetés du réseau, triés par distance au site
      const cand: { x: number; y: number; d: number }[] = [];
      for (const r of roads) {
        for (let i = 1; i < r.pts.length; i++) {
          const a = r.pts[i - 1];
          const b = r.pts[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const L2 = dx * dx + dy * dy || 1e-9;
          let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          cand.push({ x: a.x + t * dx, y: a.y + t * dy, d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) });
        }
      }
      cand.sort((u, v) => u.d - v.d);
      // premier point à ≥ 20 km de TOUTE autre étape — sinon deux étapes
      // fusionnent (jambe dégénérée de 0 km, mesuré : oasis ↔ arrivée)
      for (const c of cand) {
        let ok = true;
        for (const o of others) {
          if (Math.hypot(c.x - o.x, c.y - o.y) < 20) {
            ok = false;
            break;
          }
        }
        if (ok) {
          p.x = c.x;
          p.y = c.y;
          return;
        }
      }
      const c0 = cand[0];
      p.x = c0.x;
      p.y = c0.y;
    };
    for (const p of pois) {
      if (p.kind === "sommet" || p.kind === "dunes" || p.kind === "oasis" || p.kind === "lac")
        snapToRoad(p, pois.filter((q) => q !== p));
    }
  }
  // tri : balayage angulaire depuis le POI le plus au SUD
  if (pois.length > 2) {
    const cxm = pois.reduce((s, p) => s + p.x, 0) / pois.length;
    const cym = pois.reduce((s, p) => s + p.y, 0) / pois.length;
    const start = pois.reduce((a, b) => (a.y > b.y ? a : b));
    const a0 = Math.atan2(start.y - cym, start.x - cxm);
    const rest = pois.filter((p) => p !== start);
    rest.sort((p, q2) => {
      const ra = Math.atan2(p.y - cym, p.x - cxm) - a0;
      const rb = Math.atan2(q2.y - cym, q2.x - cxm) - a0;
      const na = ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const nb = ((rb % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return na - nb;
    });
    pois.length = 0;
    pois.push(start, ...rest);
  }
  // étiquettes réelles après réordonnancement : le POI le plus au sud est le
  // DÉPART, le dernier est l'ARRIVÉE (la capitale redevient "ville étape")
  pois.forEach((p) => {
    if (p.kind === "départ") p.kind = "ville étape";
  });
  pois[0].kind = "départ (sud)";
  pois[pois.length - 1].kind = "arrivée";
  // jambes A* coût raid — RÈGLE D'OR : l'itinéraire ne repasse JAMAIS au
  // même endroit. Chaque jambe bannit ses blocs pour toutes les suivantes
  // (y compris les diagonales, via les blocs de coin). STRICTEMENT SUR
  // ROUTES (décision utilisateur : aucune voie inventée) : les relâchements
  // se font dans cet ordre — péage des futures étapes d'abord, puis règle
  // d'or (recours orange) ; on ne sort JAMAIS du réseau routier. Une jambe
  // missing (dashed) = aucune route ne relie les deux étapes, réseau
  // lui-même déconnecté (ne devrait plus exister).
  const usedBlocks = new Uint8Array(NB * NB);
  const markBlocks = (raw: Pt[]): number[] => {
    const blocks: number[] = [];
    for (let k = 0; k < raw.length; k++) {
      const bx = clamp((raw[k].x / BLOCK) | 0, 0, NB - 1);
      const by = clamp((raw[k].y / BLOCK) | 0, 0, NB - 1);
      const b = by * NB + bx;
      if (blocks.length === 0 || blocks[blocks.length - 1] !== b) blocks.push(b);
      if (k > 0) {
        const pbx = clamp((raw[k - 1].x / BLOCK) | 0, 0, NB - 1);
        const pby = clamp((raw[k - 1].y / BLOCK) | 0, 0, NB - 1);
        if (pbx !== bx && pby !== by) {
          blocks.push(pby * NB + bx, by * NB + pbx); // blocs de coin des diagonales
        }
      }
    }
    for (const b of blocks) usedBlocks[b] = 1;
    return blocks;
  };
  const unmarkBlocks = (blocks: number[]) => {
    for (const b of blocks) usedBlocks[b] = 0;
  };
  const legBetween = (a: Poi, b: Poi): Leg => {
    // zone d'exemption : 3×3 blocs autour du départ et de l'arrivée
    const ex = new Set<number>();
    for (const p of [a, b]) {
      const bx = (p.x / BLOCK) | 0;
      const by = (p.y / BLOCK) | 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx >= 0 && ny >= 0 && nx < NB && ny < NB) ex.add(ny * NB + nx);
        }
    }
    // péage autour des AUTRES étapes (à venir ou déjà vues) : la route ne
    // doit pas traverser une ville qui sera étape plus tard (règle d'or)
    const zoneBan = new Uint8Array(NB * NB);
    for (const p of pois) {
      if (p === a || p === b) continue;
      const bx = (p.x / BLOCK) | 0;
      const by = (p.y / BLOCK) | 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx >= 0 && ny >= 0 && nx < NB && ny < NB) zoneBan[ny * NB + nx] = 1;
        }
    }
    let r = aStar(cityBlock(a), cityBlock(b), bLand, bElev, bClim, bRiver, false, sinN, roadBlocks, usedBlocks, ex, zoneBan, true);
    let relaxed = false;
    if (!r) {
      // 1er relâchement : péage des futures étapes levé (règle d'or et
      // routes strictes conservées) — la jambe traversera une future étape,
      // les blocs seront comptés au repassage par la jambe concernée
      r = aStar(cityBlock(a), cityBlock(b), bLand, bElev, bClim, bRiver, false, sinN, roadBlocks, usedBlocks, ex, undefined, true);
    }
    if (!r) {
      // 2e relâchement (dernier) : la règle d'or cède AVANT le réseau —
      // recours orange, toujours SUR ROUTES
      r = aStar(cityBlock(a), cityBlock(b), bLand, bElev, bClim, bRiver, false, sinN, roadBlocks, null, undefined, undefined, true);
      relaxed = !!r;
    }
    if (r) {
      // traversées de blocs déjà pris (hors zone POI = pas un repassage)
      let crossings = 0;
      for (let k = 1; k < r.pts.length; k++) {
        const bx = clamp((r.pts[k].x / BLOCK) | 0, 0, NB - 1);
        const by = clamp((r.pts[k].y / BLOCK) | 0, 0, NB - 1);
        if (usedBlocks[by * NB + bx] && !ex.has(by * NB + bx)) crossings++;
      }
      relaxed = relaxed || crossings > 0;
    }
    if (!r)
      return {
        pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
        km: Math.hypot(a.x - b.x, a.y - b.y),
        fords: 0,
        missing: true,
        relaxed: false,
        blocks: [],
      };
    const blocks = markBlocks(r.pts);
    return { pts: chaikin(r.pts, 2), km: r.km, fords: r.cross.length, missing: false, relaxed, blocks };
  };
  let legs: Leg[] = [];
  for (let k = 0; k + 1 < pois.length; k++) legs.push(legBetween(pois[k], pois[k + 1]));
  let totalKm = legs.reduce((s, l) => s + l.km, 0);
  // insertion d'étapes jusqu'à ~4300 km ET 30 points de passage (retour
  // utilisateur : « fait l'itinéraire en 30 points de passage ») — le
  // tracé A* sous-estime le sinueux moteur ; villes d'abord, villages
  // ensuite si le pool s'épuise ou refuse (règle d'or stricte)
  let insertions = 0;
  const pool = cities.filter(
    (c) => (c.size === 2 || c.size === 3) && !pois.some((p) => p.x === c.x && p.y === c.y)
  );
  // les villes d'abord (mieux équipées), les villages dans l'ordre du monde
  pool.sort((a, b) => a.size - b.size || b.y - a.y);
  while ((totalKm < 4300 || pois.length < 30) && insertions < 40 && pool.length > 0) {
    const v = pool.shift() as City;
    let bestGap = -1;
    let bestDetour = Infinity;
    for (let g = 0; g + 1 < pois.length; g++) {
      const detour =
        Math.hypot(pois[g].x - v.x, pois[g].y - v.y) +
        Math.hypot(v.x - pois[g + 1].x, v.y - pois[g + 1].y) -
        Math.hypot(pois[g].x - pois[g + 1].x, pois[g].y - pois[g + 1].y);
      if (detour < bestDetour) {
        bestDetour = detour;
        bestGap = g;
      }
    }
    if (bestGap < 0) break;
    if (bestDetour > 320) continue; // un village très excentré n'explose pas la course
    const removed = legs[bestGap];
    unmarkBlocks(removed.blocks); // l'ancienne jambe disparaît → ses blocs se libèrent
    // RÈGLE D'OR : refuser une ville dont la zone (3×3) chevauche le couloir
    // d'une autre jambe — s'y arrêter forcerait un repassage local
    let zoneBad = false;
    {
      const vx = (v.x / BLOCK) | 0;
      const vy = (v.y / BLOCK) | 0;
      for (let dx = -1; dx <= 1 && !zoneBad; dx++)
        for (let dy = -1; dy <= 1 && !zoneBad; dy++) {
          const nx = vx + dx;
          const ny = vy + dy;
          if (nx >= 0 && ny >= 0 && nx < NB && ny < NB && usedBlocks[ny * NB + nx]) zoneBad = true;
        }
    }
    if (zoneBad) {
      for (const b of removed.blocks) usedBlocks[b] = 1; // restauration
      continue;
    }
    const la = legBetween(pois[bestGap], v);
    const lb = legBetween(v, pois[bestGap + 1]);
    // RÈGLE D'OR : une insertion doit être 100 % stricte — on refuse les
    // jambes en recours (relaxed), sinon elle traverse des blocs interdits
    if (la.missing || lb.missing || la.relaxed || lb.relaxed) {
      unmarkBlocks(la.blocks); // ne jamais laisser des blocs fantômes marqués
      unmarkBlocks(lb.blocks);
      for (const b of removed.blocks) usedBlocks[b] = 1; // restauration
      continue;
    }
    pois.splice(bestGap + 1, 0, { ...v, kind: "ville étape" });
    legs.splice(bestGap, 1, la, lb);
    totalKm = legs.reduce((s, l) => s + l.km, 0);
    insertions++;
  }
  const fords = legs.reduce((s, l) => s + l.fords, 0);
  const bridges = roads.reduce((s, r) => s + r.bridges.length, 0);
  // métrique règle d'or : blocs réellement partagés par des jambes NON
  // consécutives (les jonctions POI entre jambes voisines sont normales)
  let overlaps = 0;
  {
    const sets = legs.map((l) => new Set(l.blocks));
    for (let a = 0; a < sets.length; a++)
      for (let b = a + 2; b < sets.length; b++)
        for (const x of sets[a]) if (sets[b].has(x)) overlaps++;
  }

  // --- 7b. RAFFINAGE 250 m : virages ÉMERGENTS (retour utilisateur :
  // vrais virages, 180°, S — un bruit latéral ne les crée jamais) ---
  // Dans un couloir de ±1,5 km autour du tracé 4 km, un A* à 250 m sur le
  // relief VOITURE (collines ~2 km ×32 m + mouvements ~600 m ×10 m posés
  // sur le relief continental) : coût de pente QUADRATIQUE par zone →
  // lacets (switchbacks) en montagne, contournement des lacs, S entre
  // collines — tout ça ÉMERGENT du terrain, pas ajouté par un bruit.
  // Règle d'or à l'échelle fine : les jambes déjà raffinées = péage ×50
  // (répulsion 500 m), exemption autour des POI de jonction.
  const carN = new Noise2D(mulberry32(hashStr(seedStr + ":car")));
  const SLOPE_ZONE = [700, 900, 500, 120, 400, 900, 2200, 2200]; // bor..trop + montagne/neige (désert : on trace droit)
  const CAR_OCT: { lam: number; amp: number }[] = [
    { lam: 2.0, amp: 55 }, // collines ~2 km × ~55 m (vrais obstacles à l'échelle voiture)
    { lam: 0.6, amp: 18 }, // mouvements ~600 m × ~18 m
  ];
  const REF_STEP_BASE = 0.25; // km — 250 m
  const REF_CORRIDOR_M = 1500; // demi-largeur du couloir
  const REF_BAN_M = 500; // répulsion règle d'or fine
  const carElev = (x: number, y: number): number => {
    const gx = clamp(x, 0, SIZE - 1.001);
    const gy = clamp(y, 0, SIZE - 1.001);
    const x0 = gx | 0;
    const y0 = gy | 0;
    const fx = gx - x0;
    const fy = gy - y0;
    const i00 = y0 * SIZE + x0;
    const e =
      elev[i00] * (1 - fx) * (1 - fy) +
      elev[i00 + 1] * fx * (1 - fy) +
      elev[i00 + SIZE] * (1 - fx) * fy +
      elev[i00 + SIZE + 1] * fx * fy;
    let car = 0;
    for (const o of CAR_OCT) car += (carN.fbm(x, y, o.lam, 2) - 0.5) * 2 * o.amp;
    return e + car;
  };
  // ondulation de coût ~1,2 km : sans elle, l'A* 250 m coupe les sinuosités
  // de la maquette (×0,86 mesuré) — le caractère sinueux par zone se garde ici
  const WIND_ZONE = [0.8, 1.2, 0.4, 0.06, 0.4, 1.2, 0.25, 0.25];
  const blockedAt = (x: number, y: number): boolean => {
    const i = clamp(Math.round(y), 0, SIZE - 1) * SIZE + clamp(Math.round(x), 0, SIZE - 1);
    return !!ocean[i] || !!lakeMask[i];
  };
  const RD8X = [1, -1, 0, 0, 1, 1, -1, -1];
  const RD8Y = [0, 0, 1, -1, 1, -1, 1, -1];
  const refineLeg = (coarse: Pt[], prior: Pt[][]): Pt[] | null => {
    if (coarse.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of coarse) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // pas adaptatif : 250 m, 500 m si la bbox explose (jambe diagonale)
    let step = REF_STEP_BASE;
    let marginM = REF_CORRIDOR_M + 750;
    if ((maxX - minX) * (maxY - minY) > 3200) step = 0.5;
    if ((maxX - minX) * (maxY - minY) > 16000) step = 1.0;
    const margin = marginM / 1000;
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;
    const gw = Math.ceil((maxX - minX) / step) + 1;
    const gh = Math.ceil((maxY - minY) / step) + 1;
    const gs = gw * gh;
    if (gs > 3.2e6) return null;
    const corridorC = Math.max(3, Math.round(REF_CORRIDOR_M / 1000 / step));
    const banC = Math.max(1, Math.round(REF_BAN_M / 1000 / step));
    const exC = Math.max(1, Math.round(1 / step)); // exemption ~1 km autour des jonctions
    const cellOf = (x: number, y: number) =>
      clamp(Math.round((y - minY) / step), 0, gh - 1) * gw + clamp(Math.round((x - minX) / step), 0, gw - 1);
    // distance de chamfrein au tracé grossier (en cellules)
    const INF = 1e9;
    const dcor = new Int32Array(gs).fill(INF);
    for (let i = 1; i < coarse.length; i++) {
      const a = coarse[i - 1];
      const b = coarse[i];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const nst = Math.max(1, Math.ceil(L / (step / 2)));
      for (let k = 0; k <= nst; k++) {
        const t = k / nst;
        dcor[cellOf(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)] = 0;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0) {
        for (let cy = 0; cy < gh; cy++)
          for (let cx = 0; cx < gw; cx++) {
            const c = cy * gw + cx;
            if (dcor[c] === 0) continue;
            let m = dcor[c];
            if (cx > 0) m = Math.min(m, dcor[c - 1] + 1);
            if (cy > 0) m = Math.min(m, dcor[c - gw] + 1);
            if (cx > 0 && cy > 0) m = Math.min(m, dcor[c - gw - 1] + 2);
            dcor[c] = m;
          }
      } else {
        for (let cy = gh - 1; cy >= 0; cy--)
          for (let cx = gw - 1; cx >= 0; cx--) {
            const c = cy * gw + cx;
            if (dcor[c] === 0) continue;
            let m = dcor[c];
            if (cx + 1 < gw) m = Math.min(m, dcor[c + 1] + 1);
            if (cy + 1 < gh) m = Math.min(m, dcor[c + gw] + 1);
            if (cx + 1 < gw && cy + 1 < gh) m = Math.min(m, dcor[c + gw + 1] + 2);
            dcor[c] = m;
          }
      }
    }
    // péage règle d'or fine : jambes déjà raffinées (dilatées de banC)
    const ban = new Uint8Array(gs);
    for (const fp of prior) {
      const stride = Math.max(1, Math.round(0.5 / step)); // un point tous les ~500 m
      for (let i = 0; i < fp.length; i += stride) {
        const c = cellOf(fp[i].x, fp[i].y);
        const cx = c % gw;
        const cy = (c / gw) | 0;
        for (let dy = -banC; dy <= banC; dy++)
          for (let dx = -banC; dx <= banC; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) ban[ny * gw + nx] = 1;
          }
      }
    }
    const si = cellOf(coarse[0].x, coarse[0].y);
    const ti = cellOf(coarse[coarse.length - 1].x, coarse[coarse.length - 1].y);
    // péage des villages du couloir : la route les frôle ou les contourne
    // (×6) — un village traversé de bout en bout n'est pas la norme
    const vtoll = new Uint8Array(gs);
    {
      const vr = Math.max(1, Math.round(0.25 / step)); // ~250 m
      for (const ct of cities) {
        if (ct.size !== 3) continue;
        if (ct.x < minX - 1 || ct.x > maxX + 1 || ct.y < minY - 1 || ct.y > maxY + 1) continue;
        const c = cellOf(ct.x, ct.y);
        const cx = c % gw;
        const cy = (c / gw) | 0;
        for (let dy = -vr; dy <= vr; dy++)
          for (let dx = -vr; dx <= vr; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) vtoll[ny * gw + nx] = 1;
          }
      }
    }
    // exemption ~1 km autour des jonctions POI
    for (const cc of [si, ti]) {
      const cx = cc % gw;
      const cy = (cc / gw) | 0;
      for (let dy = -exC; dy <= exC; dy++)
        for (let dx = -exC; dx <= exC; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) ban[ny * gw + nx] = 0;
        }
    }
    // ATTIRANCE RÉSEAU ROUTIER : le raid se joue SUR les routes (villages,
    // ponts, stations y vivent) — le tracé voiture doit rouler DESSUS, pas
    // à côté (retour utilisateur : « pourquoi une différence entre la
    // vraie route et le tracé ? »). Rastérisation des routes du couloir,
    // puis distance de chamfrein → bonus de coût à proximité.
    const rd = new Int32Array(gs).fill(INF);
    for (const r of roads) {
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1];
        const b = r.pts[i];
        if (
          Math.max(a.x, b.x) < minX - 2 ||
          Math.min(a.x, b.x) > maxX + 2 ||
          Math.max(a.y, b.y) < minY - 2 ||
          Math.min(a.y, b.y) > maxY + 2
        )
          continue;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const nst = Math.max(1, Math.ceil(L / (step / 2)));
        for (let k = 0; k <= nst; k++) {
          const t = k / nst;
          rd[cellOf(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)] = 0;
        }
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0) {
        for (let cy = 0; cy < gh; cy++)
          for (let cx = 0; cx < gw; cx++) {
            const c = cy * gw + cx;
            if (rd[c] === 0) continue;
            let m = rd[c];
            if (cx > 0) m = Math.min(m, rd[c - 1] + 1);
            if (cy > 0) m = Math.min(m, rd[c - gw] + 1);
            if (cx > 0 && cy > 0) m = Math.min(m, rd[c - gw - 1] + 2);
            rd[c] = m;
          }
      } else {
        for (let cy = gh - 1; cy >= 0; cy--)
          for (let cx = gw - 1; cx >= 0; cx--) {
            const c = cy * gw + cx;
            if (rd[c] === 0) continue;
            let m = rd[c];
            if (cx + 1 < gw) m = Math.min(m, rd[c + 1] + 1);
            if (cy + 1 < gh) m = Math.min(m, rd[c + gw] + 1);
            if (cx + 1 < gw && cy + 1 < gh) m = Math.min(m, rd[c + gw + 1] + 2);
            rd[c] = m;
          }
      }
    }
    // échantillonnage du couloir : altitude voiture + ondulation + franchissabilité
    const zc = new Uint8Array(gs);
    const passable = new Uint8Array(gs);
    const elevs = new Float32Array(gs);
    const winds = new Float32Array(gs).fill(1);
    const roadM = new Float32Array(gs).fill(1);
    for (let cy = 0; cy < gh; cy++)
      for (let cx = 0; cx < gw; cx++) {
        const c = cy * gw + cx;
        if (dcor[c] > corridorC) continue;
        const x = minX + cx * step;
        const y = minY + cy * step;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        if (blockedAt(x, y)) continue;
        passable[c] = 1;
        elevs[c] = carElev(x, y);
        const zz = clim[clamp(Math.round(y), 0, SIZE - 1) * SIZE + clamp(Math.round(x), 0, SIZE - 1)];
        zc[c] = zz;
        // ondulation de coût — JAMAIS négatif (piège itération 3 : un
        // multiplicateur <0 casse Dijkstra silencieusement)
        winds[c] = Math.max(0.3, 1 + WIND_ZONE[clamp(zz, 0, 7)] * (carN.sample(x, y, 0.9) - 0.5) * 2);
        // attirance route : ×0,28 sur la route, neutre au-delà de 1,2 km
        roadM[c] = 1 - 0.72 * smoothstep(1.2, 0, rd[c] * step);
      }
    if (!passable[si] || !passable[ti] || si === ti) return null;
    // A* 8 directions, coût = distance × (1 + K_zone × pente²) [+ péage ×50]
    const dist = new Float32Array(gs).fill(Infinity);
    const prev = new Int32Array(gs).fill(-1);
    const closed = new Uint8Array(gs);
    const hf = new Float32Array(gs);
    const tx = ti % gw;
    const ty = (ti / gw) | 0;
    for (let c = 0; c < gs; c++) {
      if (!passable[c]) continue;
      const cx = c % gw;
      const cy = (c / gw) | 0;
      hf[c] = (Math.abs(tx - cx) + Math.abs(ty - cy)) * step * 0.25; // faible : l'attirance route rend le coût < distance
    }
    const heap: number[] = [si];
    dist[si] = 0;
    const push = (idx: number) => {
      heap.push(idx);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        const fc = dist[heap[c]] + hf[heap[c]];
        const fp = dist[heap[p]] + hf[heap[p]];
        if (fp <= fc) break;
        const t = heap[p];
        heap[p] = heap[c];
        heap[c] = t;
        c = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop() as number;
      if (heap.length > 0) {
        heap[0] = last;
        let p = 0;
        for (;;) {
          const l = 2 * p + 1;
          const r = l + 1;
          let m = p;
          if (l < heap.length && dist[heap[l]] + hf[heap[l]] < dist[heap[m]] + hf[heap[m]]) m = l;
          if (r < heap.length && dist[heap[r]] + hf[heap[r]] < dist[heap[m]] + hf[heap[m]]) m = r;
          if (m === p) break;
          const t = heap[m];
          heap[m] = heap[p];
          heap[p] = t;
          p = m;
        }
      }
      return top;
    };
    let found = false;
    let guard = 0;
    const maxIter = gs * 3;
    while (heap.length > 0 && guard++ < maxIter) {
      const cur = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === ti) {
        found = true;
        break;
      }
      const cx = cur % gw;
      const cy = (cur / gw) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + RD8X[d];
        const ny = cy + RD8Y[d];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (!passable[ni] || closed[ni]) continue;
        const stepKm = d < 4 ? step : step * 1.4142;
        const slope = Math.abs(elevs[ni] - elevs[cur]) / (stepKm * 1000);
        let cost = stepKm * (1 + SLOPE_ZONE[clamp(zc[ni], 0, 7)] * slope * slope) * winds[ni] * roadM[ni];
        if (vtoll[ni]) cost *= 6; // on frôle les villages, on ne les traverse pas
        if (ban[ni]) cost *= 50;
        const nd = dist[cur] + cost;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = cur;
          push(ni);
        }
      }
    }
    if (!found) return null;
    const rp: Pt[] = [];
    let c = ti;
    while (c >= 0) {
      rp.push({ x: minX + (c % gw) * step, y: minY + ((c / gw) | 0) * step });
      if (c === si) break;
      c = prev[c];
    }
    if (rp.length < 2) return null;
    rp.reverse();
    rp[0] = { x: coarse[0].x, y: coarse[0].y };
    rp[rp.length - 1] = { x: coarse[coarse.length - 1].x, y: coarse[coarse.length - 1].y };
    return rp;
  };
  let fineKm = 0;
  const fines: Pt[][] = [];
  for (let li = 0; li < legs.length; li++) {
    const f = refineLeg(legs[li].pts, fines);
    legs[li].fine = f;
    if (f) {
      fines.push(f);
      for (let i = 1; i < f.length; i++) fineKm += Math.hypot(f[i].x - f[i - 1].x, f[i].y - f[i - 1].y);
    }
  }

  // --- 7bis. réseau stations & hôtels ---
  // Règles utilisateur : systématiques dans les villes (plus grands en ville
  // plus grande), PAS garantis dans les villages/hameaux (probabiliste), et
  // comblement des portions trop longues par des relais en bord de route à
  // INTERVALLE VARIABLE (tiré par zone climatique — le désert espacé mais
  // jamais vide, l'habité dense). rng DÉDIÉ : ne décale aucune autre suite.
  const svcRnd = mulberry32(hashStr(seedStr + ":services"));
  const services: Svc[] = [];
  for (const c of cities) {
    let st = 0;
    let hot = 0;
    if (c.size === 0) {
      st = 3;
      hot = 3;
    } else if (c.size === 1) {
      st = 3;
      hot = 2;
    } else if (c.size === 2) {
      st = 2;
      hot = 2;
    } else if (c.size === 3) {
      if (svcRnd() < 0.55) st = 1;
      if (svcRnd() < 0.35) hot = 1;
    } else {
      if (svcRnd() < 0.15) st = 1;
      if (svcRnd() < 0.1) hot = 1;
    }
    if (st || hot) services.push({ x: c.x, y: c.y, st, hot, road: -1, name: c.name });
  }
  const citySvc = services.slice(); // pour éviter un relais collé à une ville
  // intervalle variable par zone : [min, max] km entre deux relais routiers
  const SVC_GAP = (z: number): [number, number] => {
    if (z === 3) return [90, 160]; // désert profond : espacé mais jamais vide
    if (z === 2 || z === 4) return [60, 120]; // steppe, sahel
    if (z >= 6) return [50, 100]; // montagne
    return [40, 80]; // habité (boréal, tempéré, tropical)
  };
  roads.forEach((r, ri) => {
    const zAt = (i: number) =>
      clim[
        clamp(Math.round(r.pts[i].y), 0, SIZE - 1) * SIZE + clamp(Math.round(r.pts[i].x), 0, SIZE - 1)
      ];
    let s = 0;
    let last = 0;
    const [g0, g1] = SVC_GAP(zAt(0));
    let gap = g0 + svcRnd() * (g1 - g0);
    for (let i = 1; i < r.pts.length; i++) {
      s += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
      if (s - last < gap) continue;
      const px = r.pts[i].x;
      const py = r.pts[i].y;
      // pas de relais collé à une localité déjà équipée (3 km)
      let near = false;
      for (const cs of citySvc) {
        if (Math.hypot(cs.x - px, cs.y - py) < 3) {
          near = true;
          break;
        }
      }
      if (near) {
        last = s;
      } else {
        // décalé latéralement en bord de route (200-500 m), jamais dans l'eau
        const ddx = r.pts[i].x - r.pts[i - 1].x;
        const ddy = r.pts[i].y - r.pts[i - 1].y;
        const dl = Math.hypot(ddx, ddy) || 1;
        const side = svcRnd() < 0.5 ? 1 : -1;
        const off = 0.2 + svcRnd() * 0.3;
        let sx2 = px + (-ddy / dl) * side * off;
        let sy2 = py + (ddx / dl) * side * off;
        const oi = clamp(Math.round(sy2), 0, SIZE - 1) * SIZE + clamp(Math.round(sx2), 0, SIZE - 1);
        if (ocean[oi]) {
          sx2 = px;
          sy2 = py;
        }
        services.push({
          x: sx2,
          y: sy2,
          st: 1,
          hot: svcRnd() < 0.45 ? 1 : 0,
          road: ri,
          name: "Relais " + nameFor(zAt(i), svcRnd),
        });
        last = s;
      }
      const [n0, n1] = SVC_GAP(zAt(i));
      gap = n0 + svcRnd() * (n1 - n0);
    }
  });
  // services sur le PARCOURS : projection (≤1,5 km du tracé), km = arc cumulé
  const courseSvc: CourseSvc[] = [];
  const usedSvc = new Set<number>();
  let cumKm = 0;
  for (const leg of legs) {
    const P = leg.fine ?? leg.pts;
    let legLen = 0;
    const arc = new Float64Array(P.length);
    for (let i = 1; i < P.length; i++) {
      legLen += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      arc[i] = legLen;
    }
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (let i = 0; i < P.length; i += 4) {
      minX = Math.min(minX, P[i].x);
      minY = Math.min(minY, P[i].y);
      maxX = Math.max(maxX, P[i].x);
      maxY = Math.max(maxY, P[i].y);
    }
    for (let si = 0; si < services.length; si++) {
      if (usedSvc.has(si)) continue;
      const sv = services[si];
      if (sv.x < minX - 1.5 || sv.x > maxX + 1.5 || sv.y < minY - 1.5 || sv.y > maxY + 1.5) continue;
      let dmin = 1e9;
      let best = -1;
      for (let i = 0; i < P.length; i += 4) {
        const d = Math.hypot(P[i].x - sv.x, P[i].y - sv.y);
        if (d < dmin) {
          dmin = d;
          best = i;
        }
      }
      if (dmin <= 1.5 && best >= 0) {
        usedSvc.add(si);
        courseSvc.push({
          km: cumKm + (legLen > 0 ? (arc[best] / legLen) * leg.km : 0),
          st: sv.st,
          hot: sv.hot,
          name: sv.name,
        });
      }
    }
    cumKm += leg.km;
  }
  courseSvc.sort((a, b) => a.km - b.km);
  // plus longue section sans station ; si > 180 km (tracé coupant par le
  // désert loin des routes), on pose un relais au milieu du trou, sur place
  const gapMaxOf = (): number => {
    let g = 0;
    let prev = 0;
    for (const c of courseSvc) {
      if (c.st > 0) {
        g = Math.max(g, c.km - prev);
        prev = c.km;
      }
    }
    return Math.max(g, totalKm - prev);
  };
  const pointAtKm = (km: number): { x: number; y: number; z: number } | null => {
    let c = 0;
    for (const leg of legs) {
      if (km <= c + leg.km || leg === legs[legs.length - 1]) {
        const P = leg.fine ?? leg.pts;
        let legLen = 0;
        const arc: number[] = [];
        for (let i = 0; i < P.length; i++) {
          if (i > 0) legLen += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
          arc.push(legLen);
        }
        const target = ((km - c) / Math.max(0.001, leg.km)) * legLen;
        let i = 1;
        while (i < arc.length - 1 && arc[i] < target) i++;
        const zi =
          clim[
            clamp(Math.round(P[i].y), 0, SIZE - 1) * SIZE + clamp(Math.round(P[i].x), 0, SIZE - 1)
          ];
        return { x: P[i].x, y: P[i].y, z: zi };
      }
      c += leg.km;
    }
    return null;
  };
  for (let guard = 0; guard < 60 && gapMaxOf() > 180; guard++) {
    // trou le plus large entre deux stations → relais posé au milieu
    let prev = 0;
    let worstStart = 0;
    let worstLen = 0;
    for (const c of courseSvc) {
      if (c.st > 0) {
        if (c.km - prev > worstLen) {
          worstLen = c.km - prev;
          worstStart = prev;
        }
        prev = c.km;
      }
    }
    if (totalKm - prev > worstLen) {
      worstLen = totalKm - prev;
      worstStart = prev;
    }
    const pt = pointAtKm(worstStart + worstLen / 2);
    if (!pt) break;
    const sv: Svc = {
      x: pt.x,
      y: pt.y,
      st: 1,
      hot: svcRnd() < 0.45 ? 1 : 0,
      road: -1,
      name: "Relais " + nameFor(pt.z, svcRnd),
    };
    services.push(sv);
    courseSvc.push({
      km: worstStart + worstLen / 2,
      st: sv.st,
      hot: sv.hot,
      name: sv.name,
    });
    courseSvc.sort((a, b) => a.km - b.km);
  }
  const svcGapMax = gapMaxOf();
  // idem pour les HÔTELS : jamais plus de 300 km sans possibilité de dormir
  // (le joueur dort sinon en bivouac — possible, mais pas imposé 1000 km)
  const gapMaxHot = (): number => {
    let g = 0;
    let prev = 0;
    for (const c of courseSvc) {
      if (c.hot > 0) {
        g = Math.max(g, c.km - prev);
        prev = c.km;
      }
    }
    return Math.max(g, totalKm - prev);
  };
  for (let guard = 0; guard < 60 && gapMaxHot() > 300; guard++) {
    let prev = 0;
    let worstStart = 0;
    let worstLen = 0;
    for (const c of courseSvc) {
      if (c.hot > 0) {
        if (c.km - prev > worstLen) {
          worstLen = c.km - prev;
          worstStart = prev;
        }
        prev = c.km;
      }
    }
    if (totalKm - prev > worstLen) {
      worstLen = totalKm - prev;
      worstStart = prev;
    }
    const pt = pointAtKm(worstStart + worstLen / 2);
    if (!pt) break;
    const sv: Svc = {
      x: pt.x,
      y: pt.y,
      st: svcRnd() < 0.3 ? 1 : 0, // parfois une pompe avec, souvent hôtel seul
      hot: 1,
      road: -1,
      name: "Auberge " + nameFor(pt.z, svcRnd),
    };
    services.push(sv);
    courseSvc.push({
      km: worstStart + worstLen / 2,
      st: sv.st,
      hot: sv.hot,
      name: sv.name,
    });
    courseSvc.sort((a, b) => a.km - b.km);
  }

  // --- 7ter. FUSION DES TRONCS DUPLIQUÉS (un seul dessin par couloir) ---
  // Retour utilisateur : « certains se chevauchent pour rien au lieu
  // de n'en former qu'une ». Mesuré (2 graines) : 1 581/1 525 runs de
  // routes longeant une autre route à <350 m sur ≥2 km (23,7 Mm
  // cumulés côté esquisse, vvr) — capillaires et liaisons recalculent
  // le COULOIR optimal d'une route existante (extrémités voisines →
  // même A* en blocs 4 km) au lieu de FOURCHER sur elle. Fusion : tout
  // tronçon qui longe une route vivante n'est pas dessiné deux fois —
  // il est retiré et chaque bord de la coupe est RACCORDÉ au point le
  // plus proche de la route voisine (fourche naturelle en T) :
  // tronc aux extrémités ≥3 km, tronc au MILIEU ≥4 km (il crée deux
  // fourches et coupe la route en deux morceaux), route entièrement
  // couverte = doublon, elle disparaît. Sûr par construction : chaque
  // point retiré reste à <350 m d'une route conservée → aucune
  // localité ne peut être orphelinée (iso mesuré inchangé). Les
  // LONGUES routes d'abord : elles gardent leurs troncs, les courtes
  // fourchent ; l'état vivant est mis à jour à chaque coupe (une
  // voisine ne peut pas se couper sur des points déjà retirés → un
  // tronc reste toujours porté par exactement une route). L'itinéraire
  // du raid n'est PAS touché : les jambes sont calculées en amont sur
  // les blocs routés ; les routes-parcours sont ajoutées au 7quater
  // ci-dessous (la fusion ne doit PAS passer après lui : elle
  // couperait des esquisse que ses garde-fous gardent précisément pour
  // desservir des localités à >1,2 km du tracé fin). Mesuré vvr/sahara
  // après fusion : chevauchement <300 m entre esquisse 21,9/27,0 →
  // 1,9/1,8 Mm (le reste = fourches d'aboutissement et raccords du
  // parcours, plus aucun tronc >16 km) ; troncs au milieu ≥6 km
  // 81/129 → 2/1 ; réseau esquisse 57,1/60,5 → 44,4/44,2 Mm ; iso et
  // jambes inchangés ; ~0,9 s.
  {
    const fTH = 0.35; // km : deux routes à <350 m se lisent comme un doublon
    const fARC = 3; // km : tronc commun minimal aux extrémités
    const fARC_MID = 4; // km : tronc commun minimal au milieu (2 fourches)
    type FS = { r: number; k: number; x: number; y: number };
    const fIdx = new Map<number, FS[]>();
    const fSamples: FS[][] = [];
    for (let ri = 0; ri < roads.length; ri++) {
      const arr: FS[] = [];
      const pts = roads[ri].pts;
      for (let i = 0; i < pts.length; i++) {
        arr.push({ r: ri, k: arr.length, x: pts[i].x, y: pts[i].y });
        if (i + 1 < pts.length)
          arr.push({ r: ri, k: arr.length, x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 });
      }
      fSamples.push(arr);
      for (const s of arr) {
        const b = clamp((s.y / BLOCK) | 0, 0, NB - 1) * NB + clamp((s.x / BLOCK) | 0, 0, NB - 1);
        let a = fIdx.get(b);
        if (!a) {
          a = [];
          fIdx.set(b, a);
        }
        a.push(s);
      }
    }
    const fDead = roads.map((_, ri) => new Uint8Array(fSamples[ri].length));
    type FCut = { from: number; to: number; qA: Pt | null; qB: Pt | null };
    const fCuts = roads.map(() => [] as FCut[]);
    const fKm = roads.map((r) => {
      let L = 0;
      for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
      return L;
    });
    const fOrder = roads.map((_, ri) => ri).sort((a, b) => fKm[b] - fKm[a]);
    for (const ri of fOrder) {
      const arr = fSamples[ri];
      const dead = fDead[ri];
      const n = arr.length;
      let s0 = 0;
      let qA: Pt | null = null;
      let qB: Pt | null = null;
      const cnt = new Map<number, number>();
      const flush = (s1: number) => {
        if (s1 - s0 >= 2) {
          let arc = 0;
          for (let k = s0 + 1; k <= s1; k++) arc += Math.hypot(arr[k].x - arr[k - 1].x, arr[k].y - arr[k - 1].y);
          let bj = -1;
          let bn = 0;
          for (const [j, m] of cnt) if (m > bn) {
            bn = m;
            bj = j;
          }
          if (bj >= 0 && arc >= (s0 === 0 || s1 === n - 1 ? fARC : fARC_MID)) {
            for (let k = s0; k <= s1; k++) dead[k] = 1;
            fCuts[ri].push({ from: s0, to: s1, qA, qB });
          }
        }
        cnt.clear();
        qA = null;
        qB = null;
      };
      for (let k = 0; k < n; k++) {
        if (dead[k]) {
          flush(k - 1);
          continue;
        }
        const b0 = clamp((arr[k].y / BLOCK) | 0, 0, NB - 1) * NB + clamp((arr[k].x / BLOCK) | 0, 0, NB - 1);
        let bd = Infinity;
        let bj = -1;
        let bq: FS | null = null;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const a = fIdx.get(b0 + dy * NB + dx);
            if (!a) continue;
            for (const q of a) {
              if (q.r === ri || fDead[q.r][q.k]) continue;
              const d = Math.hypot(q.x - arr[k].x, q.y - arr[k].y);
              if (d < bd) {
                bd = d;
                bj = q.r;
                bq = q;
              }
            }
          }
        if (bd < fTH && bj >= 0) {
          if (cnt.size === 0) {
            s0 = k;
            qA = bq ? { x: bq.x, y: bq.y } : null;
          }
          qB = bq ? { x: bq.x, y: bq.y } : null;
          cnt.set(bj, (cnt.get(bj) ?? 0) + 1);
        } else flush(k - 1);
      }
      flush(n - 1);
    }
    // application in-place ; les ponts suivent leur morceau (la route
    // vivante a les siens à sa propre traversée) ; les clés des routes
    // disparues ne verrouillent plus leur paire ; un tronc au milieu
    // décalé coupe la route en deux morceaux, chacun ABOUTIT au point
    // le plus proche de la route voisine (carrefour en T réel)
    const fNewRoads: RoadPath[] = [];
    const fNewKeys: (string | null)[] = [];
    for (let ri = 0; ri < roads.length; ri++) {
      const pts0 = roads[ri].pts;
      const dead = fDead[ri];
      const cutBefore = new Map<number, FCut>(); // sommet v : tronc retiré juste avant → qB en tête
      const cutAfter = new Map<number, FCut>(); // dernier sommet vivant : tronc retiré juste après → qA en queue
      for (const c of fCuts[ri]) {
        cutAfter.set(Math.ceil(c.from / 2) - 1, c);
        cutBefore.set(Math.floor(c.to / 2) + 1, c);
      }
      const pieces: Pt[][] = [];
      let cur: Pt[] | null = null;
      let anyAlive = false;
      for (let m = 0; m < pts0.length; m++) {
        if (!dead[m * 2]) {
          anyAlive = true;
          if (!cur) {
            cur = [];
            const c = cutBefore.get(m);
            if (c && c.qB) cur.push(c.qB);
            pieces.push(cur);
          }
          cur.push(pts0[m]);
        } else if (cur) {
          const c = cutAfter.get(m - 1);
          if (c && c.qA) cur.push(c.qA);
          cur = null;
        }
      }
      if (!anyAlive || pieces.length === 0) {
        if (roadKeys[ri]) edgeSet.delete(roadKeys[ri]);
        continue;
      }
      let pushed = false;
      for (const pc of pieces) {
        if (pc.length < 2) continue;
        let L = 0;
        for (let i = 1; i < pc.length; i++) L += Math.hypot(pc[i].x - pc[i - 1].x, pc[i].y - pc[i - 1].y);
        if (L < 0.2) continue;
        const bridges = roads[ri].bridges.filter((b) => {
          for (const p of pc) if (Math.hypot(p.x - b.x, p.y - b.y) <= 1) return true;
          return false;
        });
        fNewRoads.push({ pts: pc, bridges, main: roads[ri].main });
        fNewKeys.push(roadKeys[ri]);
        pushed = true;
      }
      if (!pushed && roadKeys[ri]) edgeSet.delete(roadKeys[ri]);
    }
    roads.length = 0;
    roadKeys.length = 0;
    for (let k = 0; k < fNewRoads.length; k++) {
      roads.push(fNewRoads[k]);
      roadKeys.push(fNewKeys[k]);
    }
  }

  // --- 7quater. VRAIE GÉOMÉTRIE du réseau sur le parcours du raid ---
  // Retour utilisateur : « l'itinéraire ne survole pas tout le temps une
  // route ». Cause : deux résolutions cohabitaient — le réseau est une
  // esquisse 4 km (chaikin sur centres de blocs), l'itinéraire porte la
  // géométrie vraie 250 m : le jaune ondule à ±1,5 km de l'esquisse.
  // ÉCHANGE de géométrie (aucune route inventée, le monde ne change pas) :
  // les tronçons d'esquisse qui LONGENT le parcours sont retirés du dessin
  // et remplacés par la géométrie fine, qui devient une route du réseau à
  // part entière — itinéraire et route partagent la MÊME polyligne, à tout
  // zoom, décoché comme coché. Les routes qui CROISENT le parcours restent
  // (carrefour) ; les restes d'esquisse isolés entre deux tronçons remplacés
  // sont fusionnés ; chaque bout coupé est RACCORDÉ au point fin le plus
  // proche (index de blocs).
  {
    const fineAll: Pt[][] = [];
    for (const leg of legs) fineAll.push((leg.fine ?? leg.pts) as Pt[]);
    // blocs du parcours (avec coins de diagonales) pour la garde anti-collatéral
    const legBlockSet = new Set<number>();
    for (const leg of legs) for (const b of leg.blocks) legBlockSet.add(b);
    // index 4 km des points fins (voisins + carrefours)
    const fIdx = new Map<number, Pt[]>();
    const blockOf = (p: Pt) => clamp((p.y / BLOCK) | 0, 0, NB - 1) * NB + clamp((p.x / BLOCK) | 0, 0, NB - 1);
    for (const F of fineAll)
      for (let k = 0; k < F.length; k++) {
        const b = blockOf(F[k]);
        let arr = fIdx.get(b);
        if (!arr) {
          arr = [];
          fIdx.set(b, arr);
        }
        arr.push(F[k]);
      }
    const nearFine = (p: Pt): Pt | null => {
      const b0 = blockOf(p);
      let best: Pt | null = null;
      let bd = Infinity;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const arr = fIdx.get(b0 + dy * NB + dx);
          if (!arr) continue;
          for (const q of arr) {
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < bd) {
              bd = d;
              best = q;
            }
          }
        }
      return best;
    };
    // tampon 3 km autour des tracés fins (l'esquisse ondule jusqu'à
    // ~2,8 km du tracé fin — p99 mesuré : un tampon 1,4 km laissait 40 %
    // de l'esquisse en double ; disque ~3 km, stamps 0,5 km)
    const buf = new Uint8Array(SIZE * SIZE);
    const stamp = (x: number, y: number) => {
      const cx = Math.round(x);
      const cy = Math.round(y);
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 9) continue;
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx < 0 || gy < 0 || gx >= SIZE || gy >= SIZE) continue;
          buf[gy * SIZE + gx] = 1;
        }
    };
    for (const F of fineAll) for (let k = 0; k < F.length; k += 2) stamp(F[k].x, F[k].y);
    const inBuf = (p: Pt) => {
      const gx = clamp(Math.round(p.x), 0, SIZE - 1);
      const gy = clamp(Math.round(p.y), 0, SIZE - 1);
      return buf[gy * SIZE + gx] === 1;
    };
    // croisement réel avec un tracé fin ? (carrefour → on garde la route).
    // Le tracé fin BRUITÉ ondule autour de l'esquisse lissée et la croise
    // sans cesse : un simple test de croisement gardait 39 % des doublons
    // (279 runs sur 712, mesuré vvr). Un croisement n'est un CARREFOUR que
    // si les directions s'écartent d'au moins 25° — direction du fin lissée
    // sur ±2 km (±8 points) pour ignorer le bruit court-terme ; une route
    // qui abouche tangentiellement est coupée puis RACCORDÉE au fin (T).
    const cos25 = Math.cos((25 * Math.PI) / 180);
    const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const segCross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
      const o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
      const o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
      if (o1 * o2 >= 0) return false;
      const o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
      const o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
      return o3 * o4 < 0;
    };
    const crossesFine = (run: Pt[]): boolean => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of run) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      x0 -= 1;
      y0 -= 1;
      x1 += 1;
      y1 += 1;
      for (const F of fineAll)
        for (let k = 1; k < F.length; k++) {
          const p = F[k - 1];
          const q = F[k];
          if (Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1) continue;
          if (Math.max(p.y, q.y) < y0 || Math.min(p.y, q.y) > y1) continue;
          for (let i = 1; i < run.length; i++) {
            if (!segCross(run[i - 1], run[i], p, q)) continue;
            const ka = Math.max(0, k - 8);
            const kb = Math.min(F.length - 1, k + 8);
            const ux = run[i].x - run[i - 1].x;
            const uy = run[i].y - run[i - 1].y;
            const vx = F[kb].x - F[ka].x;
            const vy = F[kb].y - F[ka].y;
            const lu = Math.hypot(ux, uy) || 1e-9;
            const lv = Math.hypot(vx, vy) || 1e-9;
            if (Math.abs(ux * vx + uy * vy) / (lu * lv) < cos25) return true;
          }
        }
      return false;
    };
    const arcOf = (pts: Pt[], s: number, e: number): number => {
      let L = 0;
      for (let i = s + 1; i <= e; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return L;
    };
    // localités déjà DESSERVIES par le parcours (≤ 1,2 km du tracé fin) :
    // la route-parcours prend le relais, l'esquisse doublée peut
    // disparaître (27 % des doublons étaient gardés pour desserte alors
    // que le fin passe au même endroit, mesuré vvr)
    const cityOnFine = new Uint8Array(cities.length);
    for (let ci = 0; ci < cities.length; ci++) {
      const nf = nearFine(cities[ci]);
      if (nf && Math.hypot(nf.x - cities[ci].x, nf.y - cities[ci].y) <= 1.2) cityOnFine[ci] = 1;
    }
    const servesCity = (run: Pt[]): boolean => {
    // un tronçon qui passe près d'une localité NON desservie par le
    // parcours la DESSERT (village ruban posé sur la route, hameau en
    // bout de piste) : le supprimer orphelinerait le lieu (mesuré :
    // 5 localités à 2,3-2,9 km de toute route restante) — on le garde,
    // même s'il double le tracé fin. Limite connue et acceptée : une
    // localité du couloir à ~2,2 km de sa route (au-delà du seuil 1,5,
    // un seuil 2,2 ne la récupère pas non plus) finit à 2,24 km du
    // réseau — sous le pire du monde de base (2,83 et 3,01 km sans
    // aucune intervention de ce bloc)
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of run) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      x0 -= 1.5;
      y0 -= 1.5;
      x1 += 1.5;
      y1 += 1.5;
      for (let ci = 0; ci < cities.length; ci++) {
        const c = cities[ci];
        if (cityOnFine[ci]) continue;
        if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1];
          const b = run[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const L2 = dx * dx + dy * dy || 1e-9;
          let t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          if (Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy)) < 1.5) return true;
        }
      }
      return false;
    };
    const newRoads: RoadPath[] = [];
    const newKeys: (string | null)[] = [];
    for (let ri = 0; ri < roads.length; ri++) {
      const r = roads[ri];
      const pts = r.pts;
      if (pts.length < 2) {
        newRoads.push(r);
        newKeys.push(roadKeys[ri]);
        continue;
      }
      // tronçons contigus in/out tampon
      const inRun: boolean[] = pts.map((p) => inBuf(p));
      const parts: { s: number; e: number; inb: boolean; drop: boolean }[] = [];
      let i = 0;
      while (i < pts.length) {
        let j = i + 1;
        while (j < pts.length && inRun[j] === inRun[i]) j++;
        parts.push({ s: i, e: j - 1, inb: inRun[i], drop: false });
        i = j;
      }
      for (const pt2 of parts) {
        if (!pt2.inb || arcOf(pts, pt2.s, pt2.e) < 2.5) continue;
        // garde anti-collatéral : ≥ 80 % des sommets dans les blocs du
        // parcours (sinon c'est une route voisine, mesuré : ~5 % des runs
        // du tampon 3 km) ; et pas de croisement réel (carrefour conservé)
        const runPts = pts.slice(pt2.s, pt2.e + 1);
        let inB = 0;
        for (const p of runPts) if (legBlockSet.has(blockOf(p))) inB++;
        if (inB / runPts.length >= 0.8 && !crossesFine(runPts) && !servesCity(runPts)) pt2.drop = true;
      }
      // fusion : reste d'esquisse court coincé entre deux tronçons remplacés
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let pi = 0; pi < parts.length; pi++) {
          const pt2 = parts[pi];
          if (pt2.inb || pt2.drop) continue;
          const prev = pi > 0 ? parts[pi - 1] : null;
          const next = pi + 1 < parts.length ? parts[pi + 1] : null;
          if (prev && next && prev.drop && next.drop && arcOf(pts, pt2.s, pt2.e) < 2) {
            pt2.drop = true;
            moved = true;
          }
        }
        if (!moved) break;
      }
      // pièces conservées (indices contigus fusionnés) + raccords aux bouts coupés
      const kept: Pt[][] = [];
      let cur: Pt[] | null = null;
      for (let pi = 0; pi < parts.length; pi++) {
        const pt2 = parts[pi];
        if (pt2.drop) {
          cur = null;
          continue;
        }
        if (!cur) {
          cur = [];
          kept.push(cur);
          if (pt2.s > 0) {
            // ce bout touche un tronçon remplacé → raccord au tracé fin
            const nf = nearFine(pts[pt2.s]);
            if (nf) cur.push({ x: nf.x, y: nf.y });
          }
        }
        for (let k = pt2.s; k <= pt2.e; k++) cur.push(pts[k]);
        if (pi + 1 >= parts.length || parts[pi + 1].drop) {
          const nf = nearFine(pts[pt2.e]);
          if (nf) cur.push({ x: nf.x, y: nf.y });
        }
      }
      if (kept.length === 0) continue; // route entièrement remplacée par la vraie géométrie
      let pushedAny = false;
      for (const kp of kept) {
        if (kp.length < 2) continue;
        pushedAny = true;
        const nr: RoadPath = { pts: kp, bridges: [], main: r.main };
        // ponts conservés : hors tampon, affectés à la pièce la plus proche
        for (const b of r.bridges)
          if (!inBuf(b)) {
            let bj = 0;
            let bd = Infinity;
            for (let k = 0; k < kp.length; k++) {
              const d = Math.hypot(kp[k].x - b.x, kp[k].y - b.y);
              if (d < bd) {
                bd = d;
                bj = k;
              }
            }
            nr.bridges.push(kp[bj]);
          }
        newRoads.push(nr);
        newKeys.push(roadKeys[ri]);
      }
      if (!pushedAny) {
        // route entièrement dans le tampon : elle ne disparaît QUE si ses
        // deux extrémités sont SUR le parcours (simple doublon du tracé
        // fin) ET si elle ne dessert AUCUNE localité non couverte par le
        // parcours ; sinon elle DESSERT un lieu hors parcours (mesuré :
        // villages orphelins, dont 1 à 2,2 km de toute route restante) —
        // on la garde telle quelle
        const ea = nearFine(pts[0]);
        const eb = nearFine(pts[pts.length - 1]);
        const da = ea ? Math.hypot(ea.x - pts[0].x, ea.y - pts[0].y) : Infinity;
        const db = eb ? Math.hypot(eb.x - pts[pts.length - 1].x, eb.y - pts[pts.length - 1].y) : Infinity;
        if (da > 1.6 || db > 1.6 || servesCity(pts)) {
          newRoads.push(r);
          newKeys.push(roadKeys[ri]);
        }
      }
    }
    // le parcours devient une route du réseau : la vraie géométrie 250 m
    for (const F of fineAll) {
      if (F.length < 2) continue;
      newRoads.push({ pts: F.slice(), bridges: [], main: true });
      newKeys.push(null);
    }
    roads.length = 0;
    roadKeys.length = 0;
    for (let k = 0; k < newRoads.length; k++) {
      roads.push(newRoads[k]);
      roadKeys.push(newKeys[k]);
    }
  }

  // --- return du portage moteur : PAS de rendu offscreen (le client dessine
  // --- tout depuis le payload carte) ; isRiver/lakeMask partent avec le monde
  return {
    _seed: seedStr,
    elev,
    clim,
    ocean,
    cities,
    roads,
    pois,
    legs,
    totalKm,
    peak,
    riverKm,
    fords,
    bridges,
    lakes,
    overlaps,
    fineKm,
    services,
    courseSvc,
    svcGapMax,
    isRiver,
    lakeMask,
  };
}
// ---------------- guide 20 m : sinuosité à l'ÉCHELLE VOITURE ----------------
// Le tracé A* 4 km est une maquette : à l'échelle d'une voiture, la route
// doit onduler tous les ~100-300 m en pays habité (retour utilisateur :
// « des virages jusqu'à tous les 100 m, même moins, par endroits »),
// respirer en steppe/sahel et garder de longues lignes droites dans le
// désert profond. Le moteur retracera l'itinéraire en suivant CE bruit
// latéral multi-octaves (spécification mesurée au banc ci-dessous) —
// contrat 1D inchangé : positionKm suit l'arc du guide.
const GUIDE_STEP_M = 10; // résolution du proto (le moteur : pas guide 20 m)
const GUIDE_OCT: { lam: number; lane: number; amp: number[] }[] = [
  // déviation latérale (m) par octave — [boréal, tempéré, steppe, désert, sahel, tropical]
  // Les GROS virages (S, 180°, lacets) viennent du raffinage 250 m ; ce
  // bruit n'ajoute que le grain au volant (il survit au lissage de base)
  { lam: 1500, lane: 0.37, amp: [30, 36, 24, 14, 24, 34] }, // respiration entre collines
  { lam: 400, lane: 0.53, amp: [10, 12, 6, 3, 8, 11] }, // méandre
  { lam: 90, lane: 0.91, amp: [1.5, 1.8, 0.9, 0.3, 1.1, 1.7] }, // grandes courbes
  { lam: 60, lane: 0.17, amp: [1.4, 1.7, 1.0, 0.3, 1.2, 1.6] }, // virage
  { lam: 44, lane: 0.77, amp: [0.5, 0.6, 0.3, 0.1, 0.4, 0.6] }, // chicanes
];
const GUIDE_AMP_COL = (z: number): number => (z >= 6 ? 1 : clamp(z, 0, 5)); // montagne ≈ tempéré
interface Guide {
  pts: Pt[]; // coordonnées km, un point tous les GUIDE_STEP_M
  sM: number[]; // position arc (m) de chaque point
  kappa: Float64Array; // courbure lissée (rad/m) par point
  bendAt: number[]; // positions (m) des pics de virage (R ≤ 300 m, angle ≥ 10°)
  bendTurn: number[]; // changement de cap (degrés) de chaque virage
  bendSign: number[]; // signe de courbure (+1/-1) → les S = signes alternés
  nCurve: number; // courbes 10-45°
  nTurn: number; // virages 45-120°
  nHairpin: number; // épingles ≥ 120° (lacets, demi-tours)
  medianGap: number; // espacement médian entre virages (m)
  p10Gap: number; // espacement des 10 % les plus serrés (m)
  rMin: number; // rayon du passage le plus serré (m)
}
function buildGuide(pts: Pt[], noise: Noise2D, zoneAt: (x: number, y: number) => number): Guide {
  if (pts.length < 2) {
    const empty: Pt[] = [];
    return { pts: empty, sM: [], kappa: new Float64Array(0), bendAt: [], bendTurn: [], bendSign: [], nCurve: 0, nTurn: 0, nHairpin: 0, medianGap: 0, p10Gap: 0, rMin: 0 };
  }
  // 1. resampling le long de l'arc (km → pas GUIDE_STEP_M)
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const totalKm = cum[cum.length - 1] || 0.001;
  const n = Math.max(4, Math.ceil((totalKm * 1000) / GUIDE_STEP_M) + 1);
  const base: Pt[] = new Array(n);
  const sM: number[] = new Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = (i * GUIDE_STEP_M) / 1000; // km
    while (seg + 2 < cum.length && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 0 ? clamp((s - cum[seg]) / span, 0, 1) : 0;
    base[i] = {
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t,
    };
    sM[i] = i * GUIDE_STEP_M;
  }
  // 2b. lissage du tracé de base : la grille 8-directions du raffinage
  // produit une dent de scie (±22,5° tous les 250 m) — un box ±300 m
  // l'efface (gain ~0,04), garde les lacets 180° et les détours km,
  // et n'atteint PAS le bruit latéral (ajouté après, section 3)
  const bx2 = new Float64Array(n);
  const by2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    bx2[i] = base[i].x;
    by2[i] = base[i].y;
  }
  const W = Math.max(4, Math.round(200 / GUIDE_STEP_M));
  const boxPass = (src: Float64Array): Float64Array => {
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
    const outA = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - W);
      const hi = Math.min(n - 1, i + W);
      outA[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    return outA;
  };
  {
    let px = bx2;
    let py = by2;
    for (let pass = 0; pass < 2; pass++) {
      px = boxPass(px);
      py = boxPass(py);
    }
    for (let i = 0; i < n; i++) {
      bx2[i] = px[i];
      by2[i] = py[i];
    }
  }
  // normales au tracé lissé
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ia = Math.max(0, i - 1);
    const ib = Math.min(n - 1, i + 1);
    const dx = bx2[ib] - bx2[ia];
    const dy = by2[ib] - by2[ia];
    const l = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / l;
    ny[i] = dx / l;
  }
  // 3. déviation latérale = Σ octaves. L'amplitude suit la zone avec un
  // FONDU de 500 m aux frontières (un saut brutal de zone créerait un
  // virage-kink artificiel de R ~20 m au changement de biome)
  const STATION_M = 500;
  const nSt = Math.max(2, Math.ceil((n * GUIDE_STEP_M) / STATION_M) + 1);
  const stAmp: Float64Array[] = GUIDE_OCT.map((o) => {
    const st = new Float64Array(nSt);
    for (let q = 0; q < nSt; q++) {
      const bi = Math.min(n - 1, Math.round((q * STATION_M) / GUIDE_STEP_M));
      st[q] = o.amp[GUIDE_AMP_COL(zoneAt(base[bi].x, base[bi].y))];
    }
    return st;
  });
  const off = new Float64Array(n);
  for (let oi = 0; oi < GUIDE_OCT.length; oi++) {
    const o = GUIDE_OCT[oi];
    const st = stAmp[oi];
    for (let i = 0; i < n; i++) {
      const v = noise.sample(sM[i] / o.lam, o.lane, 1); // 1 période = lam mètres
      const t = sM[i] / STATION_M;
      const q0 = Math.min(nSt - 2, Math.floor(t));
      const f = clamp(t - q0, 0, 1);
      const A = st[q0] + (st[Math.min(nSt - 1, q0 + 1)] - st[q0]) * f;
      off[i] += (v - 0.5) * 2 * A;
    }
  }
  const sm = off;
  // 4. points finaux (km = m × 0,001)
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: bx2[i] + nx[i] * sm[i] * 0.001, y: by2[i] + ny[i] * sm[i] * 0.001 };
  // 5. courbure SIGNÉE (rad/m) pour classer les virages par angle,
  // |κ| lissé sur 30 m
  const dth = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const t1 = Math.atan2(out[i + 1].y - out[i].y, out[i + 1].x - out[i].x);
    const t0 = Math.atan2(out[i].y - out[i - 1].y, out[i].x - out[i - 1].x);
    let d = t1 - t0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    dth[i] = d / GUIDE_STEP_M;
  }
  const kappa = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) kappa[i] = (Math.abs(dth[i - 1]) + Math.abs(dth[i]) + Math.abs(dth[i + 1])) / 3;
  // 6. virages : pic de courbure R ≤ 300 m (NMS 30 m) ; l'ANGLE du virage
  // = somme de la courbure signée sur son étendue → courbe / virage / épingle
  const bendAt: number[] = [];
  const bendTurn: number[] = [];
  const bendSign: number[] = [];
  const TH = 1 / 300;
  for (let i = 3; i < n - 3; i++) {
    if (kappa[i] < TH) continue;
    let isPeak = true;
    for (let k = -3; k <= 3; k++) {
      const j = i + k;
      if (j >= 0 && j < n && kappa[j] > kappa[i]) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) continue;
    // étendue du virage : même SIGNES de courbure (sinon un S compte
    // pour deux demi-angles annulés) — chaque branche du S est un virage
    const sgn = dth[i] >= 0 ? 1 : -1;
    let a = i;
    let b = i;
    while (a > 1 && kappa[a] >= TH / 2 && (dth[a] >= 0 ? 1 : -1) === sgn) a--;
    while (b < n - 2 && kappa[b] >= TH / 2 && (dth[b] >= 0 ? 1 : -1) === sgn) b++;
    let sum = 0;
    for (let k = a; k <= b; k++) sum += dth[k] * GUIDE_STEP_M;
    const deg = (Math.abs(sum) * 180) / Math.PI;
    if (deg >= 10) {
      // vraie courbe/virage — les micro-ondulations < 10° ne comptent pas
      bendAt.push(sM[i]);
      bendTurn.push(deg);
      bendSign.push(sgn);
    }
    i += 3;
  }
  const gaps: number[] = [];
  for (let i = 1; i < bendAt.length; i++) gaps.push(bendAt[i] - bendAt[i - 1]);
  gaps.sort((a, b) => a - b);
  let kmax = 0;
  for (let i = 1; i < n - 1; i++) if (kappa[i] > kmax) kmax = kappa[i];
  let nCurve = 0;
  let nTurn = 0;
  let nHairpin = 0;
  for (const t of bendTurn) {
    if (t >= 120) nHairpin++;
    else if (t >= 45) nTurn++;
    else if (t >= 10) nCurve++;
  }
  return {
    pts: out,
    sM,
    kappa,
    bendAt,
    bendTurn,
    bendSign,
    nCurve,
    nTurn,
    nHairpin,
    medianGap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
    p10Gap: gaps.length ? gaps[Math.floor(gaps.length * 0.1)] : 0,
    rMin: kmax > 0 ? 1 / kmax : 0,
  };
}

// ============================================================================
// ADAPTATEUR DE CONTRAT — le continent 2D du proto devient un World du moteur
//
// Le proto génère un continent (grille 1 km, esquisse du réseau en blocs 4 km,
// géométrie fine 250 m du parcours du raid). Le moteur aval ne connaît QUE le
// contrat 1D de world.ts : points tous les 20 m + segments 5 km + stations.
// Cet adaptateur remplit EXACTEMENT ce contrat depuis les données du proto :
//   - le guide 20 m suit la VRAIE géométrie fine du raid (legs[].fine) avec
//     le bruit latéral multi-octaves du proto (buildGuide, validé au banc) ;
//   - altitude/pente réelles du relief (échantillonnage bilinéaire) ;
//   - biome : mapping 8 zones climatiques du proto → 4 Biome du moteur ;
//   - terrain : DÉRIVÉ du monde 2D (le proto n'a pas cette granularité) ;
//   - stations/villages/rivières projetés sur l'arc du guide (km GUIDE).
// ============================================================================

import { Biome, Station, TerrainSegment, TerrainType, World } from "./types";

// Types copiés de world.ts (pas d'import de world.ts : continent.ts est
// importé PAR world.ts — les types structurels restent assignables).
export type TrackWidth = "large" | "moyenne" | "etroite";
export interface PathPoint {
  x: number;
  y: number;
  km: number;
  alt: number;
  slopePermille: number;
  curvature: number;
  biome: Biome;
  terrain: TerrainType;
  width: TrackWidth;
}
export interface BiomeZone {
  startKm: number;
  endKm: number;
  biome: Biome;
}

const STEP_M = 20; // contrat moteur (le guide du proto est à 10 m → 1 point sur 2)

// ---- zones climatiques du proto (index clim) → Biome du moteur ----
// 0 boréal, 1 tempéré, 2 steppe, 3 désert, 4 sahel, 5 tropical, 6 montagne,
// 7 neiges. Le moteur n'a que 4 biomes (ils pilotent la météo SIG_WEIGHTS) :
//   boréal/tempéré/tropical → humide ; steppe/sahel → steppe ; désert →
//   desert ; montagne/neiges → montagne.
function biomeFor(zone: number): Biome {
  if (zone >= 6) return "montagne";
  if (zone === 3) return "desert";
  if (zone === 2 || zone === 4) return "steppe";
  return "humide";
}

// ---- terrain DÉRIVÉ du monde 2D (règles du portage, pas une donnée du proto)
// ---- rnd = microN du proto (même formule que la génération : déterministe)
function terrainFor(
  zone: number,
  biome: Biome,
  alt: number,
  slope: number,
  wet: number,
  rnd: number,
  macro: number
): TerrainType {
  if (biome === "montagne") {
    if (zone >= 7 || alt > 2200 || slope > 100) return "col";
    if (slope > 55) return "pierrier";
    return rnd < 0.55 ? "piste_mauvaise" : "pierrier";
  }
  if (biome === "desert") {
    if (slope > 60) return "pierrier";
    if (macro < 0.3) return "dunes"; // régions d'erg (~30 % du désert)
    if (macro < 0.55) return "regs"; // regs gravillonnés entre les ergs
    return slope < 8 ? "piste_rapide" : "piste_moyenne";
  }
  if (biome === "steppe") {
    if (slope > 45) return "pierrier";
    if (rnd < 0.14) return "piste_mauvaise";
    return slope < 10 ? "piste_rapide" : "piste_moyenne";
  }
  // humide (boréal/tempéré/tropical)
  if (wet > 0) return rnd < 0.5 ? "bourbier" : "marécage";
  if (slope > 70) return "piste_mauvaise";
  if (rnd < 0.22) return "piste_mauvaise";
  return rnd < 0.6 ? "piste_moyenne" : "piste_rapide";
}

// ---- altitude bilinéaire sur la grille elev (m, cellule 1 km) ----
function elevationAt(data: WorldData, x: number, y: number): number {
  const fx = clamp(x - 0.5, 0, SIZE - 1.001);
  const fy = clamp(y - 0.5, 0, SIZE - 1.001);
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * SIZE + x0;
  const e = data.elev;
  const a = e[i];
  const b = e[i + 1];
  const c = e[i + SIZE];
  const d = e[i + SIZE + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// ---- zone climatique (clim du proto, 255 = océan jamais atteint par le raid)
function zoneOf(data: WorldData, x: number, y: number): number {
  const xi = clamp(x | 0, 0, SIZE - 1);
  const yi = clamp(y | 0, 0, SIZE - 1);
  const z = data.clim[yi * SIZE + xi];
  return z > 7 ? 1 : z;
}

// ---- base64 sans Buffer (le moteur reste 100 % portable, même côté test) ----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}
function i16ToB64(vals: number[]): string {
  const bytes = new Uint8Array(vals.length * 2);
  for (let i = 0; i < vals.length; i++) {
    const v = Math.max(0, Math.min(32767, Math.round(vals[i])));
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >>> 8;
  }
  return b64Encode(bytes);
}

// ============================================================================
// LE CŒUR : continent → World (contrat 1D du moteur)
// ============================================================================
function continentToWorld(data: WorldData): World {
  const seedNum = hashStr(data._seed);
  // bruit de sinuosité du proto (même formule que generate → même tracé)
  const sinN = new Noise2D(mulberry32((seedNum ^ 0x27d4eb2f) >>> 0));
  const microN = new Noise2D(mulberry32((seedNum ^ 0x165667b1) >>> 0));
  const zoneAt = (x: number, y: number): number => zoneOf(data, x, y);

  // 1. VRAIE géométrie du raid : concat des tracés fins 250 m des jambes
  const fine: Pt[] = [];
  for (const leg of data.legs) {
    const P = leg.fine ?? leg.pts;
    for (const p of P) fine.push(p);
  }

  // 2. guide au pas 10 m du proto (bruit latéral multi-octaves + lissage
  //    des dents de scie du raffinage), puis 1 point sur 2 → pas 20 m
  const g = buildGuide(fine, sinN, zoneAt);
  const n10 = g.pts.length;
  const np = Math.max(2, Math.ceil(n10 / 2));
  const points: PathPoint[] = new Array(np);

  // courbure SIGNÉE lissée (le proto lisse |κ| pour compter les virages ;
  // le moteur veut κ signé en rad/m) sur la fenêtre ±1 pas de 10 m
  const gcurv = new Float64Array(n10);
  for (let i = 1; i < n10 - 1; i++) {
    // dth est interne au guide → recalcule la signée ici depuis les points
    const t1 = Math.atan2(g.pts[i + 1].y - g.pts[i].y, g.pts[i + 1].x - g.pts[i].x);
    const t0 = Math.atan2(g.pts[i].y - g.pts[i - 1].y, g.pts[i].x - g.pts[i - 1].x);
    let d = t1 - t0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    gcurv[i] = d / 10; // rad/m (pas du proto)
  }
  for (let i = 1; i < n10 - 2; i++) {
    gcurv[i] = (gcurv[i - 1] + gcurv[i] + gcurv[i + 1]) / 3;
  }

  // largeur locale (fenêtre ±100 m) — seuils RECALIBRÉS pour la sinuosité du
  // continent (mesuré 2 graines : |κ| points p50 0.0007, p90 0.0021, p99 0.0040 ;
  // les seuils du v1 — 0.0055/0.003 — donnaient 99 % "large", la largeur
  // ne vivait pas)
  const widthAt = (i10: number): TrackWidth => {
    let s = 0;
    let c = 0;
    for (let k = i10 - 10; k <= i10 + 10; k++) {
      if (k < 1 || k >= n10 - 1) continue;
      s += Math.abs(gcurv[k]);
      c++;
    }
    const m = c > 0 ? s / c : 0;
    return m > 0.0035 ? "etroite" : m > 0.0012 ? "moyenne" : "large";
  };

  // ceil : le dernier point porte totalKm — la monotonie de l'arc exige
  // totalKm ≥ au km réel du dernier échantillon (round le cassait)
  const totalKm = Math.ceil(g.sM[n10 - 1] / 1000);

  for (let i = 0; i < np; i++) {
    const i10 = Math.min(n10 - 1, i * 2);
    const p = g.pts[i10];
    const zone = zoneOf(data, p.x, p.y);
    const biome = biomeFor(zone);
    const alt = elevationAt(data, p.x, p.y);
    points[i] = {
      x: p.x * 1000, // km → m (contrat du moteur)
      y: p.y * 1000,
      km: i10 < n10 - 1 ? g.sM[i10] / 1000 : totalKm,
      alt,
      slopePermille: 0,
      curvature: i10 >= 1 && i10 < n10 - 1 ? gcurv[i10] : 0,
      biome,
      terrain: "piste_moyenne",
      width: widthAt(i10),
    };
  }
  // pente ‰ le long de la route (différence centrale sur ±20 m). Le relief
  // par cellules 1 km rend des gradients locaux très raides en crête quand
  // le guide la coupe de biais : clamp à ±450 ‰ (45 % — le pire d'un raid
  // en réception ; mesuré avant clamp : p99 = 61 ‰, ~0.02 % de points au-delà)
  for (let i = 1; i < np - 1; i++) {
    const d = points[i + 1].alt - points[i - 1].alt;
    const dd = (points[i + 1].km - points[i - 1].km) * 1000 || 40;
    const sl = (d / dd) * 1000;
    points[i].slopePermille = Math.max(-450, Math.min(450, sl));
  }
  points[0].slopePermille = points[1].slopePermille;
  points[np - 1].slopePermille = points[np - 2].slopePermille;

  // terrain dérivé (humidité = rivière/lac dans les ~2 km alentour →
  // bourbier/marécage ; microN du proto pour la répartition déterministe).
  // Dunes/regs : bruit MACRO (période ~55 km) — les ergs sont des RÉGIONS,
  // pas du bruit à la dizaine de mètres (mesuré : le bruit fin dispersait
  // les dunes et aucun segment n'en était majoritaire).
  for (let i = 0; i < np; i += 2) {
    const p = points[i];
    let wet = 0;
    const xi = clamp((p.x / 1000) | 0, 0, SIZE - 1);
    const yi = clamp((p.y / 1000) | 0, 0, SIZE - 1);
    for (let dy = -2; dy <= 2 && !wet; dy++) {
      for (let dx = -2; dx <= 2 && !wet; dx++) {
        const xj = xi + dx;
        const yj = yi + dy;
        if (xj < 0 || yj < 0 || xj >= SIZE || yj >= SIZE) continue;
        const j = yj * SIZE + xj;
        if (data.isRiver[j] || data.lakeMask[j]) wet = 1;
      }
    }
    const kx = p.x / 1000;
    const ky = p.y / 1000;
    const rnd = microN.sample(kx, ky, 3);
    const macro = microN.sample(kx, ky, 55);
    const t = terrainFor(zoneOf(data, kx, ky), p.biome, p.alt, Math.abs(p.slopePermille), wet, rnd, macro);
    points[i].terrain = t;
    if (i + 1 < np) points[i + 1].terrain = t;
  }

  // 3. index du guide par blocs 4 km → projections (stations/villes/étapes)
  const blkIdx = new Map<number, number[]>();
  for (let i = 0; i < np; i++) {
    const b = ((points[i].x / 4000) | 0) + ((points[i].y / 4000) | 0) * NB;
    let a = blkIdx.get(b);
    if (!a) {
      a = [];
      blkIdx.set(b, a);
    }
    a.push(i);
  }
  // distance au guide (km), scan des 9 blocs voisins — null si introuvable
  const kmOnGuide = (xKm: number, yKm: number): { km: number; dist: number } | null => {
    const bx = (xKm / BLOCK) | 0;
    const by = (yKm / BLOCK) | 0;
    let best = -1;
    let bd = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const a = blkIdx.get(bx + dx + (by + dy) * NB);
        if (!a) continue;
        for (const i of a) {
          const d = Math.hypot(points[i].x - xKm * 1000, points[i].y - yKm * 1000);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    return best < 0 ? null : { km: points[best].km, dist: bd / 1000 };
  };

  // 4. stations : les services (pompe/hôtel) projetés sur l'arc du guide
  const stations: Station[] = [];
  for (const sv of data.services) {
    const pr = kmOnGuide(sv.x, sv.y);
    if (!pr || pr.dist > 1.5) continue;
    if (sv.st === 0 && sv.hot === 0) continue;
    stations.push({ km: Math.round(pr.km * 10) / 10, name: sv.name, hasHotel: sv.hot > 0 });
  }
  stations.sort((a, b) => a.km - b.km);

  // 5. villages : les ÉTAPES du raid (traversed) + les localités ≤2 km du tracé
  const villages: World["villages"] = [];
  const seenNames = new Set<string>();
  for (const poi of data.pois) {
    const pr = kmOnGuide(poi.x, poi.y);
    if (!pr || pr.dist > 5) continue; // sécurité (mesuré : toujours < 3 km)
    villages.push({
      km: Math.round(pr.km * 10) / 10,
      x: poi.x * 1000,
      y: poi.y * 1000,
      name: poi.name,
      traversed: true,
    });
    seenNames.add(poi.name);
  }
  for (const c of data.cities) {
    if (seenNames.has(c.name)) continue;
    const pr = kmOnGuide(c.x, c.y);
    if (!pr || pr.dist > 2) continue;
    villages.push({
      km: Math.round(pr.km * 10) / 10,
      x: c.x * 1000,
      y: c.y * 1000,
      name: c.name,
      traversed: pr.dist < 0.5,
    });
  }
  villages.sort((a, b) => a.km - b.km);

  // 6. rivières croisées par le guide (gués : même détection que le proto —
  //    entrée dans une cellule rivière/lac ; doublons <3 km fusionnés)
  const rivers: World["rivers"] = [];
  const riverR = mulberry32(hashStr(data._seed + ":rivers"));
  let lastCell = -1;
  let lastKm = -10;
  for (let i = 0; i < np; i += 2) {
    const xi = clamp((points[i].x / 1000) | 0, 0, SIZE - 1);
    const yi = clamp((points[i].y / 1000) | 0, 0, SIZE - 1);
    const j = yi * SIZE + xi;
    const wet = data.isRiver[j] || data.lakeMask[j];
    if (!wet) {
      lastCell = -1;
      continue;
    }
    if (j === lastCell) continue;
    lastCell = j;
    if (points[i].km - lastKm < 3) continue; // la même oued serpente → 1 gué
    lastKm = points[i].km;
    rivers.push({
      km: Math.round(points[i].km * 10) / 10,
      x: points[i].x,
      y: points[i].y,
      name: "Oued " + nameFor(zoneOf(data, xi + 0.5, yi + 0.5), riverR),
    });
  }

  // 7. segments 5 km — copie conforme du v1 (agrégation des points 20 m)
  const segments: TerrainSegment[] = [];
  {
    const segKm = 5;
    for (let start = 0; start < totalKm; start += segKm) {
      const i0 = Math.floor((start * 1000) / STEP_M);
      const i1 = Math.max(i0 + 1, Math.floor(((start + segKm) * 1000) / STEP_M));
      const pts = points.slice(i0, i1);
      if (pts.length === 0) continue;
      const terrainCounts: Record<string, number> = {};
      let curvSum = 0;
      let altSum = 0;
      let slopeSum = 0;
      for (const p of pts) {
        terrainCounts[p.terrain] = (terrainCounts[p.terrain] ?? 0) + 1;
        curvSum += Math.abs(p.curvature);
        altSum += p.alt;
        slopeSum += p.slopePermille;
      }
      const terrain = (Object.entries(terrainCounts).sort((a, b) => b[1] - a[1])[0][0] as TerrainType);
      const meanAbsCurv = curvSum / pts.length;
      // largeur : seuils RECALIBRÉS pour le continent (mesuré : meanAbsCurv
      // par segment p50 0.0009, p75 0.0012, p90 0.0013, max 0.0037 — les
      // seuils du v1 laissaient 99.5 % des segments "large")
      const width: TrackWidth = meanAbsCurv > 0.00125 ? "etroite" : meanAbsCurv > 0.0007 ? "moyenne" : "large";
      segments.push({
        km: start,
        biome: pts[0].biome,
        terrain,
        altitude: altSum / pts.length,
        slope: slopeSum / pts.length,
        width,
      });
    }
  }

  // 8. zones de biome contiguës le long de l'arc (le client et la météo les
  //    lisent). Le guide qui longe une frontière de zone ou un seuil
  //    d'altitude crée des alternances de 1-3 km — du bruit pour la météo :
  //    les zones < 8 km sont absorbées par leur grande voisine (le biome
  //    retenu est celui de la plus étendue des deux).
  const biomeZones: BiomeZone[] = [];
  {
    let cur: BiomeZone | null = null;
    for (const p of points) {
      if (!cur || cur.biome !== p.biome) {
        if (cur) cur.endKm = p.km;
        cur = { startKm: p.km, endKm: totalKm, biome: p.biome };
        biomeZones.push(cur);
      }
    }
    biomeZones[biomeZones.length - 1].endKm = totalKm;
    // itérations de nettoyage : (1) zones consécutives de MÊME biome, (2)
    // micro-zones < 8 km absorbées par leur grande voisine (le biome retenu
    // est celui de la plus étendue des deux) — jusqu'à stabilisation
    const MIN_ZONE_KM = 8;
    let zs: BiomeZone[] = biomeZones.map((z) => ({ ...z }));
    for (let pass = 0; pass < 8; pass++) {
      const out: BiomeZone[] = [];
      let changed = false;
      for (const z of zs) {
        const prev = out.length > 0 ? out[out.length - 1] : null;
        const small = z.endKm - z.startKm < MIN_ZONE_KM;
        if (prev && (prev.biome === z.biome || small || prev.endKm - prev.startKm < MIN_ZONE_KM)) {
          if (z.endKm - z.startKm >= prev.endKm - prev.startKm) prev.biome = z.biome;
          prev.endKm = z.endKm;
          changed = true;
        } else {
          out.push(z);
        }
      }
      zs = out;
      if (!changed) break;
    }
    biomeZones.length = 0;
    biomeZones.push(...zs);
  }

  return {
    seed: seedNum,
    totalKm,
    stations,
    segments,
    villages,
    rivers,
    startName: data.pois.length > 0 ? data.pois[0].name : "Départ",
    endName: data.pois.length > 1 ? data.pois[data.pois.length - 1].name : "Arrivée",
    pathZ: [],
    points,
    biomeZones,
    bridges: [], // les ponts du raid : étiquette d'honnêteté du patch (gués partout)
  };
}

// ============================================================================
// PAYLOAD CARTE — condensé du continent pour l'onglet carte du client.
// Grilles au pas 4 km (250×250) en base64, polylignes Int16 au pas 100 m.
// ============================================================================
export interface ContinentMapPayload {
  seedText: string;
  sizeKm: number;
  totalKm: number;
  reliefB64: string; // Uint8 250×250 : altitude quantifiée (min-max du continent)
  zonesB64: string; // Uint8 250×250 : zone climatique 0-7, 255 = océan
  waterB64: string; // Uint8 250×250 : 0 rien, 1 rivière, 2 lac, 3 océan
  roadsB64: string; // Int16 LE : x*10,y*10 concaténés de toutes les routes
  roadsCount: number[]; // nb de points par route
  routeB64: string; // Int16 LE : x*10,y*10 de la VRAIE géométrie fine du raid
  cities: { name: string; x: number; y: number; size: number }[]; // km
  pois: { name: string; kind: string; x: number; y: number; km: number }[]; // km + km arc
}

function buildMapPayload(data: WorldData, world: World): ContinentMapPayload {
  const R = 4; // pas de grille (km)
  const G = SIZE / R; // 250
  let eMin = Infinity;
  let eMax = -Infinity;
  for (let i = 0; i < data.elev.length; i++) {
    const e = data.elev[i];
    if (data.ocean[i]) continue;
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
  }
  const relief = new Uint8Array(G * G);
  const zones = new Uint8Array(G * G);
  const water = new Uint8Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const gI = gy * G + gx;
      const cx = Math.min(SIZE - 1, gx * R + (R >> 1));
      const cy = Math.min(SIZE - 1, gy * R + (R >> 1));
      const i = cy * SIZE + cx;
      if (data.ocean[i]) {
        zones[gI] = 255;
        water[gI] = 3;
        relief[gI] = 0;
        continue;
      }
      relief[gI] = Math.round(((data.elev[i] - eMin) / Math.max(1, eMax - eMin)) * 255);
      zones[gI] = data.clim[i] > 7 ? 255 : data.clim[i];
      if (data.isRiver[i]) water[gI] = 1;
      else if (data.lakeMask[i]) water[gI] = 2;
    }
  }

  // routes (esquisse vivante, chirurgie 7ter/7quater incluse)
  const roadVals: number[] = [];
  const roadsCount: number[] = [];
  for (const r of data.roads) {
    if (r.pts.length < 2) continue;
    roadsCount.push(r.pts.length);
    for (const p of r.pts) {
      roadVals.push(p.x * 10, p.y * 10);
    }
  }

  // VRAIE géométrie du raid (concat des tracés fins 250 m)
  const routeVals: number[] = [];
  for (const leg of data.legs) {
    for (const p of leg.fine ?? leg.pts) routeVals.push(p.x * 10, p.y * 10);
  }

  const poisKm = new Map<string, number>();
  for (const v of world.villages) poisKm.set(v.name, v.km);

  return {
    seedText: data._seed,
    sizeKm: SIZE,
    totalKm: world.totalKm,
    reliefB64: b64Encode(relief),
    zonesB64: b64Encode(zones),
    waterB64: b64Encode(water),
    roadsB64: i16ToB64(roadVals),
    roadsCount,
    routeB64: i16ToB64(routeVals),
    cities: data.cities.map((c) => ({ name: c.name, x: c.x, y: c.y, size: c.size })),
    pois: data.pois.map((p) => ({
      name: p.name,
      kind: p.kind,
      x: p.x,
      y: p.y,
      km: poisKm.get(p.name) ?? 0,
    })),
  };
}

// ============================================================================
// API DU MODULE + cache (une génération ~5 s et ~40 Mo : le serveur demande
// le World (course) et le payload (carte) — le cache les partage par graine)
// ============================================================================
export interface ContinentCacheEntry {
  world: World;
  payload: ContinentMapPayload;
}
const continentCache = new Map<string, ContinentCacheEntry>();

function generateEntry(seedText: string): ContinentCacheEntry {
  const cached = continentCache.get(seedText);
  if (cached) return cached;
  const data = generate(seedText);
  const world = continentToWorld(data);
  const payload = buildMapPayload(data, world);
  const entry = { world, payload };
  continentCache.set(seedText, entry);
  if (continentCache.size > 2) {
    // LRU minimal : évacue la plus ancienne insertion
    const first = continentCache.keys().next().value;
    if (typeof first === "string") continentCache.delete(first);
  }
  return entry;
}

export function generateContinent(seedText: string): World {
  return generateEntry(seedText).world;
}

export function buildContinentMap(seedText: string): ContinentMapPayload {
  return generateEntry(seedText).payload;
}

/** Usage test uniquement : vide le cache (le test de déterminisme régénère vraiment). */
export function __resetContinentCache(): void {
  continentCache.clear();
}
// @@END continent.ts@@
// @@BEGIN tests-continent@@
// ===== PATCH 9 : contrat du monde continent (3 générations : ~20 s de tests) =====

test("continent: contrat World — pas 20 m, km monotone, aucun NaN", () => {
  __resetContinentCache();
  const w = generateContinent("vvr-continent-1");
  assert.ok(w.points.length > 100000, w.points.length + " points (attendu > 100 000)");
  const d0 = w.points[1].km - w.points[0].km;
  assert.ok(Math.abs(d0 - 0.02) < 1e-6, "pas de 20 m attendu, obtenu " + d0);
  const last = w.points[w.points.length - 1];
  for (let i = 0; i < w.points.length; i++) {
    const p = w.points[i];
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.km) && Number.isFinite(p.alt), "point " + i + " : coordonnée non finie");
    if (i > 0) assert.ok(p.km >= w.points[i - 1].km, "km non monotone au point " + i);
  }
  assert.equal(w.totalKm, Math.ceil(last.km));
  assert.ok(w.stations.length > 50, w.stations.length + " stations (attendu > 50)");
  for (let i = 1; i < w.stations.length; i++) {
    assert.ok(w.stations[i].km >= w.stations[i - 1].km, "stations non triées à " + i);
  }
  const coverEnd = w.biomeZones.reduce((mx, z) => Math.max(mx, z.endKm), 0);
  assert.ok(coverEnd >= last.km - 1, "biomeZones s'arrêtent à " + coverEnd + " km < " + last.km);
  for (const v of w.villages) {
    assert.ok(v.km >= -0.5 && v.km <= last.km + 1, "village hors bornes : " + v.name + " @" + v.km + " km");
  }
  assert.ok(w.segments.length > 1000, w.segments.length + " segments 5 km (attendu > 1000)");
});

test("continent: déterminisme — même graine = même monde (cache purgé)", () => {
  __resetContinentCache();
  const a = generateContinent("sahara-2026-vvr");
  __resetContinentCache();
  const b = generateContinent("sahara-2026-vvr");
  assert.equal(a.totalKm, b.totalKm);
  assert.equal(a.points.length, b.points.length);
  assert.equal(a.stations.length, b.stations.length);
  assert.equal(a.villages.length, b.villages.length);
  assert.equal(a.segments.length, b.segments.length);
  assert.equal(a.points[1000].x, b.points[1000].x);
  assert.equal(a.points[1000].alt, b.points[1000].alt);
});

test("continent: payload carte 2D (buildContinentMap, servi par le cache)", () => {
  const p = buildContinentMap("sahara-2026-vvr");
  assert.equal(p.sizeKm, 1000);
  assert.ok(p.totalKm > 5000 && p.totalKm < 7000, "totalKm incohérent : " + p.totalKm);
  assert.ok(p.routeB64.length > 1000, "routeB64 trop court");
  assert.ok(p.roadsCount.length > 1500, p.roadsCount.length + " routes (attendu > 1500)");
  assert.ok(p.cities.length > 1000, p.cities.length + " localités (attendu > 1000)");
});
// @@END tests-continent@@
`;
