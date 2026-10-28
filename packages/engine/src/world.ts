import { Rng } from "./rng";
import {
  GEN_END_SHARE, GEN_WAYPOINT_MIN_STEP_M, GEN_LATERAL_SPREAD, GEN_LATERAL_STEP, GEN_PROG_MIN_SHARE,
  GEN_WET_COST_THRESHOLD, GEN_DETAIL_EXPONENT, GEN_DETAIL_GAIN, GEN_DETOUR_COST,
  GEN_HAIRPIN_MIN_DEFLECTION, GEN_HAIRPIN_MAX_SHARE, GEN_STRAIGHT_DRIFT_CORRECTION,
  GEN_CURV_PHASE_EASE, GEN_COUNTER_STEER, GEN_CONTINENTAL_MIN, GEN_CONTINENTAL_GAIN, GEN_ALT_BASE_SHARE,
} from "./calibration";
import { Biome, Station, TerrainSegment, TerrainType, World, WeatherFront } from "./types";

export interface WorldGenParams {
  seed: number;
  targetHours: number;
  biomeWeights?: Partial<Record<Biome, number>>;
}

// ============================================================================
// GÉNÉRATEUR DE MONDE — la route émerge du terrain.
//
// Principe (profond, émergent, crédible) :
//   1. Le RELIEF est la réalité première: un champ d'altitude fbm par biome
//      (chaînes de montagne, ergs, plaines, marécages bas).
//   2. La route est tracée par un GUIDE qui avance pas à pas (20 m) et choisit
//      sa direction parmi 7 options (devant ±60°) selon une COÛT :
//        - détour vers l'objectif (aller globalement vers B) ;
//        - PENTE à franchir (on préfère suivre les courbes de niveau, comme
//          les vraies pistes: elles serpentent dans les vallées) ;
//        - DIFFICULTÉ du terrain (bruit: on évite les marécages/dunes vives).
//      Le guide ne « tire » jamais un virage: chaque changement de direction
//      est la conséquence mesurée du terrain qu'il traverse.
//   3. Les LACETS ÉMERGENT: quand la pente requise pour avancer vers l'objectif
//      dépasse la pente franchissable (max ~12%), le guide bascule en mode
//      lacet — il traverse la pente en zigzag régulier, exactement comme les
//      vraies routes de col. Les épingles à 180° sont la géométrie du zigzag.
//   4. Chaque point porte les attributs réels: altitude, pente ‰, courbure,
//      biome, terrain, largeur. La simulation et le rendu lisent cette vérité.
// ============================================================================

const STEP_M = 20;

// Bruit de valeur 2D interpolé (déterministe, sans dépendance).
class Noise2D {
  private perm: number[];
  constructor(rng: Rng) {
    this.perm = new Array(512);
    const base = new Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [base[i], base[j]] = [base[j], base[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255];
  }
  private h(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }
  sample(x: number, y: number, scale: number): number {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = this.h(x0, y0), b = this.h(x0 + 1, y0);
    const c = this.h(x0, y0 + 1), d = this.h(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(x: number, y: number, baseScale: number, octaves: number): number {
    let v = 0, amp = 1, scale = baseScale, total = 0;
    for (let o = 0; o < octaves; o++) {
      v += this.sample(x, y, scale) * amp;
      total += amp;
      amp *= 0.5;
      scale *= 0.45;
    }
    return v / total;
  }
}

// ---- caractéristiques du biome pour le relief et les coûts ----
interface BiomeRelief {
  altBase: number;        // altitude de base (m)
  amp: number;           // amplitude du relief (m)
  scale: number;         // échelle du relief (m — petite = escarpé)
  maxSlope: number;      // pente maximale que la piste franchit (fraction)
  costWet: number;       // poids du coût « difficulté » (éviter les mauvais terrains)
  terrainWeights: [TerrainType, number][];
}

const BIOME_RELIEF: Record<Biome, BiomeRelief> = {
  montagne: { altBase: 600, amp: 2400, scale: 15000, maxSlope: 0.12, costWet: 0.6,
    terrainWeights: [["piste_moyenne", 0.3], ["col", 0.25], ["piste_mauvaise", 0.25], ["pierrier", 0.2]] },
  desert: { altBase: 150, amp: 700, scale: 9000, maxSlope: 0.09, costWet: 1.0,
    terrainWeights: [["piste_moyenne", 0.3], ["regs", 0.25], ["dunes", 0.2], ["piste_mauvaise", 0.15], ["piste_rapide", 0.1]] },
  steppe: { altBase: 100, amp: 350, scale: 25000, maxSlope: 0.06, costWet: 0.4,
    terrainWeights: [["piste_rapide", 0.35], ["piste_moyenne", 0.4], ["piste_mauvaise", 0.25]] },
  humide: { altBase: 60, amp: 200, scale: 7000, maxSlope: 0.07, costWet: 1.6,
    terrainWeights: [["piste_moyenne", 0.35], ["piste_mauvaise", 0.25], ["bourbier", 0.2], ["marécage", 0.12], ["piste_rapide", 0.08]] },
};

export interface PathPoint {
  x: number;             // m (position réelle)
  y: number;             // m
  km: number;            // longueur d'arc cumulée
  alt: number;           // m
  slopePermille: number;  // pente le long de la route (‰)
  curvature: number;     // 1/m, signée
  biome: Biome;
  terrain: TerrainType;
  width: "large" | "moyenne" | "etroite";
}

export interface BiomeZone { startKm: number; endKm: number; biome: Biome; }

export class WorldGenerator {
  rng: Rng;
  noise: Noise2D;
  wetNoise: Noise2D;
  detailNoise: Noise2D;
  totalKm: number;
  points: PathPoint[] = [];
  biomeZones: BiomeZone[] = [];
  stations: Station[] = [];
  villages: { km: number; x: number; y: number; name: string; traversed: boolean }[] = [];
  rivers: { km: number; x: number; y: number; name: string }[] = [];
  bridges: { km: number; x: number; y: number; name: string }[] = [];
  segments: TerrainSegment[] = [];
  private altCache = new Map<string, number>();
  private endX: number;
  private endY: number;

  constructor(params: WorldGenParams) {
    this.rng = new Rng(params.seed);
    this.noise = new Noise2D(this.rng);
    // deuxième bruit indépendant pour la difficulté (détaché du relief)
    this.wetNoise = new Noise2D(this.rng);
    // aspérités à l'échelle des virages (100-800 m): le guide les contourne —
    // c'est là que les virages émergent, sans casser les pentes réelles.
    this.detailNoise = new Noise2D(this.rng);
    this.totalKm = Math.round(params.targetHours * 50 * this.rng.range(0.85, 1.15));

    // Les zones de biomes sont une BANDE NORD-SUD: le tracé A→B les traverse
    // toutes — la séquence émerge de la géographie, pas d'un ordre tiré.
    const weights: Record<Biome, number> = {
      desert: params.biomeWeights?.desert ?? 1,
      montagne: params.biomeWeights?.montagne ?? 1,
      steppe: params.biomeWeights?.steppe ?? 1,
      humide: params.biomeWeights?.humide ?? 1,
    };
    // bandes successives le long de l'axe, ordre de départ aléatoire, rotation garantie
    const biomes: Biome[] = ["desert", "montagne", "steppe", "humide"];
    let r = this.rng.next();
    let first = biomes[0];
    const wSum = biomes.reduce((s, b) => s + weights[b], 0);
    for (const b of biomes) { r -= weights[b] / wSum; if (r <= 0) { first = b; break; } }
    // La course DÉMARRE EN STEPPE (première zone = steppe): départ roulant,
    // la montagne arrive plus tard — la course se corse progressivement.
    const order: Biome[] = ["steppe"];
    const suite: Biome[] = biomes.filter((b) => b !== "steppe");
    const startIdx = suite.indexOf(first) >= 0 ? suite.indexOf(first) : 0;
    for (let i = 0; i < suite.length; i++) order.push(suite[(startIdx + i) % suite.length]);
    // distance totale à couvrir: proportionnelle aux pondérations
    let acc = 0;
    let cursor = 0;
    for (let i = 0; i < order.length; i++) {
      acc += weights[order[i]] / wSum;
      const endKm = Math.round(this.totalKm * acc);
      this.biomeZones.push({ startKm: cursor, endKm, biome: order[i] });
      cursor = endKm;
    }
    // A et B: la distance à vol d'oiseau est étirée pour que l'arc final
    // converge vers la longueur cible — calibration itérative: on trace une
    // première fois, on mesure le ratio arc/vol-d'oiseau, on replace B.
    // (le sinueux émergent d'une piste fait 1,2-1,4× le vol d'oiseau)
    this.endX = this.totalKm * 1000 * GEN_END_SHARE;
    this.endY = this.rng.range(-0.15, 0.15) * this.endX;

    this.buildPath();
    // la longueur de course EST la longueur du tracé généré
    const realKm = this.points[this.points.length - 1].km;
    this.totalKm = Math.round(realKm);
    this.biomeZones.forEach((z) => { z.endKm = Math.min(z.endKm, this.totalKm); });
    // purge des zones vidées par la troncature (bornes inversées)
    this.biomeZones = this.biomeZones.filter((z) => z.endKm > z.startKm);
    this.assignTerrain();
    this.buildFeatures();
    this.buildSegments();
  }

  private km0(x: number, y: number, totalM: number, totalKm: number): number {
    return (Math.hypot(x, y) / totalM) * totalKm;
  }

  // facteur d'errance latérale par biome (steppe = droite, montagne = serpente)
  private biomeLateralFactor(km: number): number {
    const b = this.biomeAt(km);
    return b === "steppe" ? 0.35 : b === "montagne" ? 1.4 : b === "humide" ? 1.0 : 0.8;
  }

  private cfgOf(b: Biome): BiomeRelief { return BIOME_RELIEF[b]; }

  biomeAt(km: number): Biome {
    for (const z of this.biomeZones) if (km >= z.startKm && km < z.endKm) return z.biome;
    return this.biomeZones[this.biomeZones.length - 1].biome;
  }

  // altitude du paysage — LISSÉE à grande échelle: on échantillonne le bruit
  // avec des octaves graves uniquement et sur une grille éparsée interpolée.
  // Résultat: des collines et vallées réelles (pentes 5-80‰), pas du grésil.
  private altCell(x: number, y: number): number {
    const gx = Math.floor(x / 500), gy = Math.floor(y / 500);
    const key = gx + "," + gy;
    const cached = this.altCache.get(key);
    if (cached !== undefined) return cached;
    const km = (Math.hypot(gx * 500, gy * 500) / (this.totalKm * 1000)) * this.totalKm;
    const biome = this.biomeAt(km);
    const cfg = BIOME_RELIEF[biome];
    // 2 octaves graves seulement (le détail fin est l'ennemi des pentes réelles)
    const n = this.noise.fbm(gx * 500, gy * 500, cfg.scale, 2);
    const base = cfg.altBase + (n - 0.5) * 2 * cfg.amp;
    const t = Math.min(1, Math.hypot(gx * 500, gy * 500) / (this.totalKm * 1000));
    const alt = Math.max(0, base * (GEN_CONTINENTAL_MIN + GEN_CONTINENTAL_GAIN * t) + cfg.altBase * GEN_ALT_BASE_SHARE);
    if (this.altCache.size < 400000) this.altCache.set(key, alt);
    return alt;
  }
  // altitude du paysage: interpolation bilinéaire entre cellules de 500 m —
  // collines et vallées continues (pentes 5-80‰), pas de marches d'escalier.
  altAt(x: number, y: number): number {
    const fx = x / 500, fy = y / 500;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = this.altCell(x0 * 500, y0 * 500);
    const b = this.altCell((x0 + 1) * 500, y0 * 500);
    const c = this.altCell(x0 * 500, (y0 + 1) * 500);
    const d = this.altCell((x0 + 1) * 500, (y0 + 1) * 500);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  // difficulté du sol (1 = difficile): marécages, dunes vives — à éviter
  wetnessAt(x: number, y: number): number {
    return this.wetNoise.fbm(x * 1.7, y * 1.7, 6000, 3);
  }

  // ---------- tracé: guide émergent à deux niveaux ----------
  // Niveau 1 (stratégique): une chaîne de WAYPOINTS espacés de ~8 km mène de A
  //   à B. Chaque waypoint est choisi parmi des candidats qui progressent vers
  //   B en évitant les zones trop difficiles (pente inter-wpt trop forte).
  //   — comme un planificateur d'itinéraire qui choisit les vallées et les cols.
  // Niveau 2 (tactique): entre deux waypoints, le GUIDE avance pas à pas (20 m)
  //   et choisit sa direction par le relief local (suivre les courbes de niveau,
  //   éviter le mauvais sol). Les virages émergent de cette négociation.
  // Les LACETS émergent d'eux-mêmes: quand un waypoint est en hauteur, la pente
  //   locale force le guide à traverser en zigzag — pas de virage tiré au hasard.
  private buildPath(): void {
    const totalM = this.totalKm * 1000;
    const end = { x: this.endX, y: this.endY };

    // --- niveau 1: chaîne de waypoints (8 km) avec errance latérale ---
    // L'itinéraire visite des points d'intérêt écartés de l'axe direct:
    // l'errance latérale (marche aléatoire bornée, calibrée par biome) fait
    // CHANGER le cap d'un waypoint à l'autre. INVARIANT: progression vers B.
    const wpts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    let cx = 0, cy = 0;
    let lateral = 0;
    let guard = 0;
    const WPT_SPACING = 8000;
    while (Math.hypot(end.x - cx, end.y - cy) > 2000 && guard++ < 4000) {
      const distNow = Math.hypot(end.x - cx, end.y - cy);
      const stepW = Math.min(WPT_SPACING, Math.max(GEN_WAYPOINT_MIN_STEP_M, distNow * GEN_END_SHARE));
      const toEnd = Math.atan2(end.y - cy, end.x - cx);
      const kmHere = this.km0(cx, cy, totalM, this.totalKm);
      const latFactor = this.biomeLateralFactor(kmHere);
      lateral = Math.max(-1.6, Math.min(1.6, lateral + this.rng.range(-0.55, 0.55) * latFactor));
      const perpX = -Math.sin(toEnd), perpY = Math.cos(toEnd);
      let best: { x: number; y: number; c: number } | null = null;
      for (let k = -2; k <= 2; k++) {
        const off = (lateral + k * GEN_LATERAL_STEP) * stepW * GEN_LATERAL_SPREAD;
        const nx = cx + Math.cos(toEnd) * stepW + perpX * off;
        const ny = cy + Math.sin(toEnd) * stepW + perpY * off;
        if (Math.hypot(end.x - nx, end.y - ny) > distNow - stepW * GEN_PROG_MIN_SHARE) continue;
        const cfg = BIOME_RELIEF[this.biomeAt(kmHere)];
        const wet = this.wetnessAt(nx, ny);
        const detail = this.detailNoise.fbm(nx, ny, 350, 2);
        const c = Math.max(0, wet - GEN_WET_COST_THRESHOLD) * cfg.costWet + Math.pow(Math.abs(detail - 0.5) * 2, GEN_DETAIL_EXPONENT) * GEN_DETAIL_GAIN + Math.abs(k) * GEN_DETOUR_COST;
        if (!best || c < best.c) best = { x: nx, y: ny, c };
      }
      if (!best) best = { x: cx + Math.cos(toEnd) * stepW, y: cy + Math.sin(toEnd) * stepW, c: 0 };
      cx = best.x; cy = best.y;
      wpts.push({ x: cx, y: cy });
    }
    wpts.push({ x: end.x, y: end.y });

    // --- niveau 2: le guide suit un CAP SINUEUX (le tracé vit) ---
    // Conception: le cap désiré = direction waypoint + SERPENTEMENT (bruit
    // multi-échelle fonction de l'ARC, calibré par biome). Le guide POURSUIT
    // ce cap — la pente et le sol ne sont que des VETOS (on évite le
    // franchissable-impossible), jamais des critères lissants qui tueraient
    // les virages en moyennant. Les virages sont dans le cap lui-même.
    let x = 0, y = 0;
    let heading = 0;
    let km = 0;
    let wpIdx = 1;

    // ===== MACHINE À ÉTATS DE CONDUITE: le rythme d'une vraie spéciale =====
    // DROITE (cap verrouillé, la route va droit) -> CLOTHOÏDE (la courbure
    // monte progressivement) -> VIRAGE (arc de rayon franc, constant) ->
    // CLOTHOÏDE (la courbure retombe) -> DROITE... Distribution BIMODALE:
    // pas d'ondulation continue molle, un enchaînement droites/virages nets.
    // Le tirage des virages (fréquence, rayon, déflexion) suit le biome:
    // montagne = serré et fréquent, steppe = rare et ouvert.
    const PACE = {
      montagne: { straightMin: 40, straightMax: 260, radiusMin: 25, radiusMax: 70, turnChance: 0.8, hairpinChance: 0.22 },
      humide:   { straightMin: 60, straightMax: 300, radiusMin: 30, radiusMax: 90, turnChance: 0.65, hairpinChance: 0.12 },
      desert:   { straightMin: 80, straightMax: 500, radiusMin: 45, radiusMax: 140, turnChance: 0.55, hairpinChance: 0.06 },
      steppe:   { straightMin: 200, straightMax: 1400, radiusMin: 80, radiusMax: 260, turnChance: 0.4, hairpinChance: 0.02 },
    } as const;

    // ===== SÉCURITÉ ANTI-CROISEMENT =====
    // Grille spatiale des points déjà tracés (cellules de 60 m). Avant
    // d'accepter un pas, on vérifie qu'il ne s'approche pas d'un segment
    // antérieur du tracé à moins de MIN_SEP m — sinon on dévie le cap.
    // (les épingles serrées restent possibles: 60 m de gabarit)
    const MIN_SEP = 30; // deux pistes parallèles ne se touchent jamais; les lacets légitimes passent
    const CELL = 60;
    const grid = new Map<string, { x: number; y: number; km: number }[]>();
    const cellKey = (gx: number, gy: number) => gx + "," + gy;
    const register = (pt: { x: number; y: number; km: number }) => {
      const gx = Math.floor(pt.x / CELL), gy = Math.floor(pt.y / CELL);
      const key = cellKey(gx, gy);
      let arr = grid.get(key);
      if (!arr) { arr = []; grid.set(key, arr); }
      arr.push(pt);
    };
    // trop proche d'un segment ANTÉRIEUR (km éloigné du nôtre)?
    const tooClose = (px: number, py: number, myKm: number): boolean => {
      const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        for (let cy = gy - 1; cy <= gy + 1; cy++) {
          const arr = grid.get(cellKey(cx, cy));
          if (!arr) continue;
          for (const pt of arr) {
            if (Math.abs(pt.km - myKm) < 0.35) continue; // nos voisins immédiats (une épingle fait ~0.3 km d'arc)
            if (Math.hypot(pt.x - px, pt.y - py) < MIN_SEP) return true;
          }
        }
      }
      return false;
    };

    type Phase = { kind: "straight" | "entry" | "turn" | "exit"; remaining: number; targetCurv: number; turnLen: number };
    let phase: Phase = { kind: "straight", remaining: this.rng.range(60, 200), targetCurv: 0, turnLen: 0 };
    let curv = 0;      // courbure courante (lissée par les clothoïdes)
    let turnSign = 1;

    const newStraight = (b: Biome): number => this.rng.range(PACE[b].straightMin, PACE[b].straightMax);

    while (Math.hypot(end.x - x, end.y - y) > 2500 && this.points.length < (totalM / STEP_M) * 2.2) {
      const step = STEP_M;
      const biome = this.biomeAt(km);
      const pace = PACE[biome];

      // waypoint actif (direction générale)
      while (wpIdx < wpts.length - 1 && Math.hypot(wpts[wpIdx].x - x, wpts[wpIdx].y - y) < 2000) wpIdx++;
      const wp = wpts[Math.min(wpIdx, wpts.length - 1)];
      const toWp = Math.atan2(wp.y - y, wp.x - x);

      // --- avancer la machine d'états ---
      phase.remaining -= step;
      if (phase.remaining <= 0) {
        if (phase.kind === "straight") {
          // tirer un virage? (fréquence par biome)
          if (this.rng.chance(pace.turnChance)) {
            // rayon franc + déflexion; l'épingle élargit la déflexion
            const radius = this.rng.range(pace.radiusMin, pace.radiusMax);
            let defl = this.rng.range(0.45, 1.75); // 25°-100°
            if (this.rng.chance(pace.hairpinChance)) defl = this.rng.range(GEN_HAIRPIN_MIN_DEFLECTION, Math.PI * GEN_HAIRPIN_MAX_SHARE);
            turnSign = this.rng.chance(0.5) ? 1 : -1;
            // biais: le virage tourne de préférence vers le waypoint
            let err = toWp - heading;
            while (err > Math.PI) err -= 2 * Math.PI;
            while (err < -Math.PI) err += 2 * Math.PI;
            if (Math.abs(err) > 0.25) turnSign = err > 0 ? 1 : -1;
            const target = (1 / radius) * turnSign;
            const clothLen = 40; // 40 m d'entrée/sortie
            phase = { kind: "entry", remaining: clothLen, targetCurv: target, turnLen: Math.max(clothLen * 2, radius * defl) };
          } else {
            phase.remaining = newStraight(biome);
          }
        } else if (phase.kind === "entry") {
          phase = { kind: "turn", remaining: phase.turnLen, targetCurv: phase.targetCurv, turnLen: phase.turnLen };
        } else if (phase.kind === "turn") {
          phase = { kind: "exit", remaining: 40, targetCurv: 0, turnLen: 0 };
        } else {
          phase = { kind: "straight", remaining: newStraight(biome), targetCurv: 0, turnLen: 0 };
        }
      }
      // DÉRIVE CONTRÔLÉE: pendant les droites, une correction douce aligne le
      // cap sur le waypoint (les virages jouent, l'itinéraire ne diverge pas).
      if (phase.kind === "straight") {
        let err = toWp - heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        heading += err * GEN_STRAIGHT_DRIFT_CORRECTION;
      }

      // --- courbure de la phase (clothoïdes = montée/descente progressive) ---
      const ease = 0.18 + 0.82 * Math.min(1, step / 25);
      if (phase.kind === "straight") curv = curv * (1 - ease);
      else if (phase.kind === "entry") curv += (phase.targetCurv - curv) * ease;
      else if (phase.kind === "turn") curv += (phase.targetCurv - curv) * GEN_CURV_PHASE_EASE;
      else curv += (0 - curv) * ease;

      // VETO relief: si la courbure actuelle mène à du franchissable-impossible,
      // l'inverser brièvement (le relief esquive, il ne lisse pas)
      const altHere = this.altAt(x, y);
      const aheadOK = (c: number) => {
        const px = x + Math.cos(heading + c * 40) * 40;
        const py = y + Math.sin(heading + c * 40) * 40;
        const slope = Math.abs(this.altAt(px, py) - altHere) / 40;
        const wet = this.wetnessAt(px, py);
        return slope <= this.cfgOf(biome).maxSlope * 1.2 && wet < 0.8;
      };
      if (phase.kind === "turn" && !aheadOK(curv)) {
        curv = -curv * GEN_COUNTER_STEER;
        phase.targetCurv = curv;
      }

      heading += curv * step;

      // INVARIANT DE PROGRESSION: le pas ne doit jamais S'ÉLOIGNER de B.
      // (antidote structurel aux boucles: une piste de rally va toujours
      // globalement de A vers B, ses virages ne la font jamais reculer)
      {
        const distNow = Math.hypot(end.x - x, end.y - y);
        const candX = x + Math.cos(heading) * step;
        const candY = y + Math.sin(heading) * step;
        const distCand = Math.hypot(end.x - candX, end.y - candY);
        if (distCand > distNow) {
          // ce pas éloigne de B: chercher le cap le plus proche qui rapproche
          let fixed = false;
          for (const dv of [0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2]) {
            const cand = heading + dv;
            const px2 = x + Math.cos(cand) * step;
            const py2 = y + Math.sin(cand) * step;
            if (Math.hypot(end.x - px2, end.y - py2) < distNow) { heading = cand; fixed = true; break; }
          }
        }
      }
      // SÉCURITÉ ANTI-CROISEMENT: le pas IMMÉDIAT ne doit s'approcher d'aucun
      // segment antérieur à moins de MIN_SEP. Cap dégagé le plus proche sinon.
      if (tooClose(x + Math.cos(heading) * step, y + Math.sin(heading) * step, km)) {
        let deviated = false;
        for (const dv of [0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4]) {
          const cand = heading + dv;
          const nx = x + Math.cos(cand) * step;
          const ny = y + Math.sin(cand) * step;
          if (!tooClose(nx, ny, km) && !tooClose(nx + Math.cos(cand) * step * 2, ny + Math.sin(cand) * step * 2, km)) {
            heading = cand;
            deviated = true;
            break;
          }
        }
        if (!deviated) {
          // totalement encerclé: la piste ne peut pas continuer ici — terminer
          break;
        }
      }

      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
      km += step / 1000;
      register({ x, y, km });

      // altitude LE LONG DE LA ROUTE: la piste suit le terrain mais une
      // vraie piste ne dépasse pas ~150‰ (au-delà, elle traverse en lacet).
      const altRaw = this.altAt(x, y);
      const prev = this.points[this.points.length - 1];
      let alt = altRaw;
      if (prev) {
        const maxRise = 0.15 * step; // 150‰ par pas
        alt = Math.max(prev.alt - maxRise, Math.min(prev.alt + maxRise, altRaw));
      }
      const slopePermille = prev ? ((alt - prev.alt) / step) * 1000 : 0;
      this.points.push({
        x, y, km, alt, slopePermille, curvature: curv,
        biome, terrain: "piste_moyenne", width: "moyenne",
      });
    }
  }

  // ---------- terrain & largeur ----------
  private assignTerrain(): void {
    let lastChangeKm = -10;
    let current: TerrainType = "piste_moyenne";
    for (const p of this.points) {
      const cfg = BIOME_RELIEF[p.biome];
      if (p.km - lastChangeKm >= this.rng.range(2, 8)) {
        const table = cfg.terrainWeights;
        let r = this.rng.next();
        current = table[table.length - 1][0];
        for (const [t, w] of table) { r -= w; if (r <= 0) { current = t; break; } }
        lastChangeKm = p.km;
      }
      p.terrain = current;
      const absCurv = Math.abs(p.curvature);
      p.width = absCurv > 0.012 ? "etroite" : absCurv > 0.006 ? "moyenne" : "large";
    }
  }

  // ---------- stations, villages, rivières, ponts ----------
  private buildFeatures(): void {
    let nextKm = 120;
    let idx = 1;
    while (nextKm < this.totalKm - 100) {
      const p = this.pointAtKm(nextKm);
      this.stations.push({ km: nextKm, name: `Station ${idx}`, hasHotel: this.rng.chance(0.4) });
      idx++;
      nextKm += this.rng.range(300, 500);
    }
    this.stations.push({ km: this.totalKm, name: "Arrivée", hasHotel: true });

    let vIdx = 1, vKm = 50;
    while (vKm < this.totalKm) {
      const p = this.pointAtKm(vKm);
      if (p && p.alt < 500) {
        this.villages.push({ km: vKm, x: p.x, y: p.y, name: `Village ${vIdx}`, traversed: this.rng.chance(0.5) });
        vIdx++;
      }
      vKm += this.rng.range(80, 300);
    }

    let rIdx = 1, rKm = 180;
    while (rKm < this.totalKm) {
      const p = this.pointAtKm(rKm);
      this.rivers.push({ km: rKm, x: p.x, y: p.y, name: `Rivière ${rIdx}` });
      this.bridges.push({ km: rKm, x: p.x, y: p.y, name: `Pont ${rIdx}` });
      rIdx++;
      rKm += this.rng.range(250, 600);
    }
  }

  private pointAtKm(km: number): PathPoint {
    const idx = Math.min(this.points.length - 1, Math.max(0, Math.round((km * 1000) / STEP_M)));
    return this.points[idx];
  }

  // ---------- segments agrégés ----------
  private buildSegments(): void {
    const segKm = 5;
    for (let start = 0; start < this.totalKm; start += segKm) {
      const i0 = Math.floor((start * 1000) / STEP_M);
      const i1 = Math.max(i0 + 1, Math.floor(((start + segKm) * 1000) / STEP_M));
      const pts = this.points.slice(i0, i1);
      if (pts.length === 0) continue;
      const terrainCounts: Record<string, number> = {};
      let curvSum = 0, altSum = 0, slopeSum = 0;
      for (const p of pts) {
        terrainCounts[p.terrain] = (terrainCounts[p.terrain] ?? 0) + 1;
        curvSum += Math.abs(p.curvature);
        altSum += p.alt;
        slopeSum += p.slopePermille;
      }
      const terrain = Object.entries(terrainCounts).sort((a, b) => b[1] - a[1])[0][0] as TerrainType;
      const widths = pts.map((p) => p.width).sort();
      this.segments.push({
        km: start,
        biome: pts[0].biome,
        terrain,
        altitude: altSum / pts.length,
        slope: slopeSum / pts.length,
        width: widths[Math.floor(widths.length / 2)] as any,
      });
    }
  }

  toWorld(seed: number): World {
    return {
      seed,
      totalKm: this.totalKm,
      stations: this.stations,
      segments: this.segments,
      villages: this.villages,
      rivers: this.rivers,
      startName: "Départ",
      endName: "Arrivée",
      pathZ: [],
      points: this.points,
      biomeZones: this.biomeZones,
      bridges: this.bridges,
    };
  }
}

export function generateWorld(params: WorldGenParams): World {
  const gen = new WorldGenerator(params);
  return gen.toWorld(params.seed);
}

export function curvatureAt(world: World, km: number, window = 0.12): number {
  // MOYENNE de courbure sur ±120 m (la portion que la voiture traverse
  // réellement) — pas le max à 1 km à la ronde.
  const pts = world.points;
  if (!pts || pts.length === 0) return 0;
  const i0 = Math.max(0, Math.min(pts.length - 1, Math.floor(((km - window) * 1000) / STEP_M)));
  const i1 = Math.max(0, Math.min(pts.length - 1, Math.floor(((km + window) * 1000) / STEP_M)));
  let sum = 0, n = 0;
  for (let i = i0; i <= i1 && i < pts.length; i++) {
    sum += Math.abs(pts[i].curvature);
    n++;
  }
  if (n === 0) return 0;
  return Math.min(1, (sum / n) / (1 / 90));
}

export function segmentAt(segments: TerrainSegment[], km: number): TerrainSegment {
  const segKm = 5;
  const idx = Math.min(segments.length - 1, Math.max(0, Math.floor(km / segKm)));
  return segments[idx];
}

export function nextStation(stations: Station[], km: number): Station | null {
  for (const s of stations) if (s.km > km) return s;
  return null;
}

export function generateWeatherFronts(world: World, rng: Rng, ticksPerHour: number): WeatherFront[] {
  const fronts: WeatherFront[] = [];
  let id = 1;
  const totalTicks = (world.totalKm / 50) * ticksPerHour;
  for (let t = 0; t < totalTicks; t += rng.int(ticksPerHour, ticksPerHour * 4)) {
    const km = rng.range(0, world.totalKm);
    const biome = segmentAt(world.segments, km).biome;
    const kinds: Record<string, WeatherFront["kind"][]> = {
      desert: ["tempete_sable", "canicule", "vent_fort", "brouillard"],
      montagne: ["froid_intense", "grele", "pluie_diluvienne", "vent_fort", "brouillard"],
      steppe: ["pluie_diluvienne", "vent_fort", "canicule", "brouillard", "grele"],
      humide: ["pluie_diluvienne", "brouillard", "froid_intense", "vent_fort"],
    };
    fronts.push({
      id: id++,
      kind: rng.pick(kinds[biome] ?? ["pluie_diluvienne", "vent_fort"]),
      km,
      speedKmPerTick: rng.range(-0.02, 0.02) / 30,
      radiusKm: rng.range(30, 100),
      startTick: t,
      endTick: t + rng.int(ticksPerHour, ticksPerHour * 4),
    });
  }
  const damaged: WeatherFront[] = [];
  for (let i = 0; i < Math.max(2, Math.floor(world.totalKm / 800)); i++) {
    const km = rng.range(50, world.totalKm - 50);
    damaged.push({
      id: id++,
      kind: "piste_endommagee" as any,
      km,
      speedKmPerTick: 0,
      radiusKm: rng.range(1, 4),
      startTick: 0,
      endTick: Number.MAX_SAFE_INTEGER,
    });
  }
  return fronts.concat(damaged);
}

export function weatherAt(fronts: WeatherFront[], tick: number, km: number): WeatherFront["kind"] {
  for (const f of fronts) {
    if (tick >= f.startTick && tick <= f.endTick && Math.abs(f.km - km) <= f.radiusKm) return f.kind;
  }
  return "clair";
}

export const AVG_SPEED_KMH = 50;
