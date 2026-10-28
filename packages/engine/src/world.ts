import { Rng } from "./rng";
import {
  Biome,
  Station,
  TerrainSegment,
  TerrainType,
  World,
  WorldEvent,
  WeatherFront,
} from "./types";

export interface WorldGenParams {
  seed: number;
  targetHours: number;
  biomeWeights?: Partial<Record<Biome, number>>;
}

// ============================================================
// Générateur de monde — « le monde est le tracé »
//
// Le tracé est une POLYLIGNE 2D (x, y en mètres), construite par un
// modèle de conducteur : à chaque pas, le pilote visuel ajuste son cap
// pour suivre un itinéraire de référence à travers un paysage de
// bruit multi-octaves (altitude, difficulté). Les virages émergent
// de la négociation entre le cap voulu et la capacité de virage du
// terrain — pas de courbe cosmétique.
//
// Chaque point du tracé porte ses attributs réels : position, altitude,
// pente, courbure, biome, terrain, largeur. La simulation lit le tracé;
// le client le dessine. Une seule source de vérité.
// ============================================================

// Bruit de valeur 2D (hash bilinéaire interpolé) — déterministe, sans dépendance.
class ValueNoise2D {
  private perm: number[] = [];
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
  private hash2(x: number, y: number): number {
    const h = this.perm[(this.perm[x & 255] + y) & 255];
    return h / 255;
  }
  // valeur lissée en (x, y), coordonnées monde en mètres
  sample(x: number, y: number, scaleM: number): number {
    const fx = x / scaleM;
    const fy = y / scaleM;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = this.hash2(x0, y0), b = this.hash2(x0 + 1, y0);
    const c = this.hash2(x0, y0 + 1), d = this.hash2(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  // fbm: superposition d'octaves — paysage crédible
  fbm(x: number, y: number, baseScaleM: number, octaves: number): number {
    let v = 0, amp = 1, scale = baseScaleM, total = 0;
    for (let o = 0; o < octaves; o++) {
      v += this.sample(x, y, scale) * amp;
      total += amp;
      amp *= 0.5;
      scale *= 0.5;
    }
    return v / total;
  }
}

interface BiomeStyle {
  // capacité de virage: rayon de braquage typique en mètres ( petit = épingles )
  minTurnRadius: number;
  // variabilité de l'itinéraire de référence
  waypointJitter: number;
  // fréquence des changements de terrain (en km)
  terrainChangeKm: number;
  // probabilité d'un terrain lent par section
  slowChance: number;
  // vitesse caractéristique du biome
  characterKmh: number;
}

const BIOME_STYLES: Record<Biome, BiomeStyle> = {
  montagne: { minTurnRadius: 30, waypointJitter: 2500, terrainChangeKm: 3, slowChance: 0.55, characterKmh: 45 },
  desert: { minTurnRadius: 90, waypointJitter: 6000, terrainChangeKm: 6, slowChance: 0.4, characterKmh: 75 },
  steppe: { minTurnRadius: 220, waypointJitter: 12000, terrainChangeKm: 10, slowChance: 0.25, characterKmh: 100 },
  humide: { minTurnRadius: 60, waypointJitter: 3500, terrainChangeKm: 4, slowChance: 0.6, characterKmh: 50 },
};

const TERRAIN_BY_BIOME: Record<Biome, [TerrainType, number][]> = {
  desert: [["piste_moyenne", 0.3], ["regs", 0.25], ["dunes", 0.2], ["piste_mauvaise", 0.15], ["piste_rapide", 0.1]],
  montagne: [["piste_moyenne", 0.3], ["col", 0.25], ["piste_mauvaise", 0.25], ["pierrier", 0.2]],
  steppe: [["piste_rapide", 0.35], ["piste_moyenne", 0.4], ["piste_mauvaise", 0.25]],
  humide: [["piste_moyenne", 0.35], ["piste_rapide", 0.1], ["piste_mauvaise", 0.25], ["bourbier", 0.18], ["marécage", 0.12]],
};

export interface PathPoint {
  x: number;            // m depuis le départ (le long de l'itinéraire global)
  y: number;            // m — dévers latéral réel du tracé
  km: number;           // distance cumulée le long du tracé (km)
  alt: number;          // m
  slopePermille: number;
  curvature: number;     // 1/r en m^-1, signé (0 = droite)
  biome: Biome;
  terrain: TerrainType;
  width: "large" | "moyenne" | "etroite";
}

export interface BiomeZone {
  startKm: number;
  endKm: number;
  biome: Biome;
}

export class WorldGenerator {
  private rng: Rng;
  private noise: ValueNoise2D;
  totalKm: number;
  points: PathPoint[] = [];
  biomeZones: BiomeZone[] = [];
  stations: Station[] = [];
  villages: { km: number; x: number; y: number; name: string; traversed: boolean }[] = [];
  rivers: { km: number; x: number; y: number; name: string }[] = [];
  bridges: { km: number; x: number; y: number; name: string }[] = [];
  segments: TerrainSegment[] = [];

  constructor(params: WorldGenParams) {
    this.rng = new Rng(params.seed);
    this.noise = new ValueNoise2D(this.rng);
    // durée cible -> longueur (doc §4: ~40-60 km/h effectifs -> course 7j ≈ 7000-10000 km)
    this.totalKm = Math.round(params.targetHours * 50 * this.rng.range(0.85, 1.15));

    const weights: Record<Biome, number> = {
      desert: params.biomeWeights?.desert ?? 1,
      montagne: params.biomeWeights?.montagne ?? 1,
      steppe: params.biomeWeights?.steppe ?? 1,
      humide: params.biomeWeights?.humide ?? 1,
    };
    this.buildBiomeZones(weights);
    this.buildPath();
    this.assignTerrain();
    this.buildFeatures();
    this.buildSegments();
  }

  // ---------- zones de biomes ----------
  private buildBiomeZones(weights: Record<Biome, number>): void {
    const biomes: Biome[] = ["desert", "montagne", "steppe", "humide"];
    const wSum = biomes.reduce((s, b) => s + weights[b], 0);
    // découpage en zones: alterner les biomes, durée ∝ pondération, avec transitions
    let km = 0;
    let last: Biome | null = null;
    // ordre de départ aléatoire puis rotation garantie: chaque biome passe,
    // en quantité ∝ pondération. Nombre de zones fixe, longueurs réparties.
    const order: Biome[] = [];
    let r = this.rng.next() * wSum;
    let first: Biome = biomes[0];
    for (const cand of biomes) { r -= weights[cand]; if (r <= 0) { first = cand; break; } }
    for (let i = 0; i < biomes.length; i++) order.push(biomes[(biomes.indexOf(first) + i) % biomes.length]);
    const nZones = Math.max(8, Math.round(this.totalKm / 800));
    for (let i = 0; i < nZones && km < this.totalKm; i++) {
      const b = order[i % order.length];
      const share = weights[b] / wSum;
      const len = Math.max(150, Math.min(this.totalKm - km, (this.totalKm / nZones) * (share * biomes.length) * this.rng.range(0.7, 1.4)));
      this.biomeZones.push({ startKm: km, endKm: Math.min(this.totalKm, km + len), biome: b });
      km += len;
    }
    if (this.biomeZones.length === 0) this.biomeZones.push({ startKm: 0, endKm: this.totalKm, biome: "steppe" });
  }

  biomeAt(km: number): Biome {
    for (const z of this.biomeZones) if (km >= z.startKm && km < z.endKm) return z.biome;
    return this.biomeZones[this.biomeZones.length - 1].biome;
  }

  // altitude du paysage en (x, y) — la montagne barre la route, le désert ondule
  private landscapeAlt(x: number, y: number, biome: Biome): number {
    if (biome === "montagne") {
      return 300 + this.noise.fbm(x, y, 9000, 4) * 3200;
    } else if (biome === "desert") {
      return 100 + this.noise.fbm(x, y, 14000, 3) * 900;
    } else if (biome === "humide") {
      return 30 + this.noise.fbm(x, y, 11000, 3) * 400;
    }
    return 80 + this.noise.fbm(x, y, 16000, 3) * 600;
  }

  // ---------- construction du tracé par modèle de conducteur ----------
  private buildPath(): void {
    const STEP_M = 25;           // résolution du tracé: un point tous les 25 m
    const totalM = this.totalKm * 1000;
    // état du conducteur
    let x = 0, y = 0;
    let heading = 0;             // cap en radians
    let km = 0;
    let arcKm = 0;
    let curvatureSmooth = 0;

    // itinéraire de référence: série de waypoints que le conducteur cherche à rejoindre
    const waypoints: { x: number; y: number }[] = [];
    let wx = 0, wy = 8000;
    waypoints.push({ x: 0, y: 0 });
    while (Math.hypot(wx, wy) < totalM * 0.98) {
      const biome = this.biomeAt(Math.hypot(wx, wy) / 1000);
      const style = BIOME_STYLES[biome];
      const jitter = style.waypointJitter;
      const angle = this.rng.range(-0.7, 0.7);
      const dist = this.rng.range(3000, 9000);
      wx += Math.cos(angle) * dist;
      wy += Math.sin(angle) * dist + this.rng.range(-jitter, jitter);
      waypoints.push({ x: wx, y: wy });
    }

    let wpIdx = 0;
    for (let d = 0; d < totalM; d += STEP_M) {
      km = d / 1000; // position d'arc cible pour ce pas
      const biome = this.biomeAt(km);
      const style = BIOME_STYLES[biome];

      // waypoint cible: le prochain à portée
      while (wpIdx < waypoints.length - 1 &&
             Math.hypot(waypoints[wpIdx].x - x, waypoints[wpIdx].y - y) < 2000) {
        wpIdx++;
      }
      const target = waypoints[Math.min(wpIdx, waypoints.length - 1)];
      const toTarget = Math.atan2(target.y - y, target.x - x);

      // l'altitude locale influence la trajectoire: on évite les murs de montagne
      // (le bruit donne une « difficulté » que le conducteur contourne)
      const diff = this.noise.fbm(x, y, 5000, 3);
      const diffAngle = (diff - 0.5) * 1.2; // déviation douce

      // cap désiré: waypoint + contour des difficultés
      let desired = toTarget + diffAngle * (biome === "montagne" ? 0.8 : biome === "steppe" ? 0.15 : 0.4);
      // normalisation de l'écart de cap
      let err = desired - heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;

      // capacité de virage: rayon min du biome, un peu de variance
      const minRadius = style.minTurnRadius * this.rng.range(0.8, 1.5);
      const maxCurv = 1 / minRadius;
      // le conducteur tourne au maximum vers le cap désiré
      const turn = Math.max(-maxCurv * STEP_M, Math.min(maxCurv * STEP_M, err));
      const curvature = turn / STEP_M;
      heading += turn;

      // lissage de la courbure (suspension du modèle)
      curvatureSmooth = curvatureSmooth * 0.7 + curvature * 0.3;

      x += Math.cos(heading) * STEP_M;
      y += Math.sin(heading) * STEP_M;

      const alt = this.landscapeAlt(x, y, biome);
      const prev = this.points[this.points.length - 1];
      const slope = prev ? ((alt - prev.alt) / STEP_M) * 1000 : 0;
      this.points.push({
        x,                        // position 2D réelle
        y,
        km: km + STEP_M / 1000,
        alt,
        slopePermille: slope,
        curvature: curvatureSmooth,
        biome,
        terrain: "piste_moyenne", // assigné ensuite
        width: "moyenne",
      });
    }
  }

  // ---------- terrain & largeur ----------
  private assignTerrain(): void {
    let lastChangeKm = 0;
    let current: TerrainType = "piste_moyenne";
    for (const p of this.points) {
      const style = BIOME_STYLES[p.biome];
      if (p.km - lastChangeKm >= style.terrainChangeKm * this.rng.range(0.5, 1.5)) {
        // tirage pondéré
        const table = TERRAIN_BY_BIOME[p.biome];
        let r = this.rng.next();
        current = table[table.length - 1][0];
        for (const [t, w] of table) {
          r -= w;
          if (r <= 0) { current = t; break; }
        }
        lastChangeKm = p.km;
      }
      p.terrain = current;
      // largeur: sinueu et technique = étroit
      const absCurv = Math.abs(p.curvature);
      p.width = absCurv > 0.008 ? "etroite" : absCurv > 0.004 ? "moyenne" : "large";
    }
  }

  // ---------- stations, villages, rivières, ponts ----------
  private buildFeatures(): void {
    // stations: espacement 300-500 km, placées sur des sites logiques (altitude locale basse = point d'eau)
    let nextKm = 150;
    let idx = 1;
    while (nextKm < this.totalKm - 100) {
      const p = this.pointAtKm(nextKm);
      this.stations.push({ km: nextKm, name: `Station ${idx}`, hasHotel: this.rng.chance(0.4) });
      idx++;
      const biome = this.biomeAt(nextKm);
      nextKm += this.rng.range(300, 500) * (biome === "humide" ? 0.9 : 1);
    }
    this.stations.push({ km: this.totalKm, name: "Arrivée", hasHotel: true });

    // villages: le long des axes d'eau (altitude basse), traversés ou évités
    let vIdx = 1;
    let vKm = 40;
    while (vKm < this.totalKm) {
      const p = this.pointAtKm(vKm);
      const lowland = p && p.alt < 400;
      if (lowland || this.rng.chance(0.3)) {
        this.villages.push({ km: vKm, x: p.x, y: p.y, name: `Village ${vIdx}`, traversed: this.rng.chance(0.5) });
        vIdx++;
      }
      vKm += this.rng.range(80, 300);
    }

    // rivières: franchies par ponts uniquement (gués supprimés)
    let rIdx = 1;
    let rKm = 200;
    while (rKm < this.totalKm) {
      const p = this.pointAtKm(rKm);
      this.rivers.push({ km: rKm, x: p.x, y: p.y, name: `Rivière ${rIdx}` });
      this.bridges.push({ km: rKm, x: p.x, y: p.y, name: `Pont ${rIdx}` });
      rIdx++;
      rKm += this.rng.range(250, 600);
    }
  }

  private pointAtKm(km: number): PathPoint {
    const idx = Math.min(this.points.length - 1, Math.max(0, Math.round((km * 1000) / 25)));
    return this.points[idx];
  }

  // ---------- segments agrégés (compat simulation existante) ----------
  private buildSegments(): void {
    // un TerrainSegment tous les 5 km, agrégé depuis les points de tracé
    const segKm = 5;
    for (let start = 0; start < this.totalKm; start += segKm) {
      const pts = this.points.slice(
        Math.floor((start * 1000) / 25),
        Math.max(Math.floor((start * 1000) / 25) + 1, Math.floor(((start + segKm) * 1000) / 25))
      );
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
      const widths = pts.map((p) => p.width);
      const width = widths.sort()[Math.floor(widths.length / 2)] as "large" | "moyenne" | "etroite";
      this.segments.push({
        km: start,
        biome: pts[0].biome,
        terrain,
        altitude: altSum / pts.length,
        slope: slopeSum / pts.length,
        width,
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

// API compatible avec l'existant
export function generateWorld(params: WorldGenParams): World {
  const gen = new WorldGenerator(params);
  return gen.toWorld(params.seed);
}

// courbure max normalisée 0..1 au km donné (fenêtre 1 km)
export function curvatureAt(world: World, km: number, window = 1): number {
  const pts = world.points;
  if (!pts || pts.length === 0) return 0;
  const i0 = Math.max(0, Math.min(pts.length - 1, Math.floor(((km - window) * 1000) / 25)));
  const i1 = Math.max(0, Math.min(pts.length - 1, Math.floor(((km + window) * 1000) / 25)));
  let maxAbs = 0;
  for (let i = i0; i <= i1 && i < pts.length; i++) {
    const c = Math.abs(pts[i].curvature);
    if (c > maxAbs) maxAbs = c;
  }
  // rayon 60 m = virage très serré -> 1.0 ; rayon 400 m+ = droit
  return Math.min(1, maxAbs / (1 / 60));
}

// point du tracé au km (interpolation)
export function pathPointAt(world: World, km: number): PathPoint | null {
  const pts = world.points;
  if (!pts || pts.length === 0) return null;
  const fi = (km * 1000) / 25;
  const i0 = Math.max(0, Math.min(pts.length - 1, Math.floor(fi)));
  const i1 = Math.min(pts.length - 1, i0 + 1);
  const f = fi - i0;
  const a = pts[i0], b = pts[i1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    km,
    alt: a.alt + (b.alt - a.alt) * f,
    slopePermille: a.slopePermille + (b.slopePermille - a.slopePermille) * f,
    curvature: a.curvature + (b.curvature - a.curvature) * f,
    biome: f < 0.5 ? a.biome : b.biome,
    terrain: f < 0.5 ? a.terrain : b.terrain,
    width: f < 0.5 ? a.width : b.width,
  };
}

export function segmentAt(segments: TerrainSegment[], km: number): TerrainSegment {
  const segKm = 5;
  const idx = Math.min(segments.length - 1, Math.max(0, Math.floor(km / segKm)));
  return segments[idx];
}

export function nextStation(stations: Station[], km: number): Station | null {
  for (const s of stations) {
    if (s.km > km) return s;
  }
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
    const list = kinds[biome] ?? ["pluie_diluvienne", "vent_fort"];
    fronts.push({
      id: id++,
      kind: rng.pick(list),
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
    if (tick >= f.startTick && tick <= f.endTick && Math.abs(f.km - km) <= f.radiusKm) {
      return f.kind;
    }
  }
  return "clair";
}

export const AVG_SPEED_KMH = 50;
