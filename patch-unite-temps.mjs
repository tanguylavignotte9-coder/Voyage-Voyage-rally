#!/usr/bin/env node
// ============================================================================
// PATCH 4 - UNITE DE TEMPS DU MOTEUR (le moteur tourne a 30 ticks/s, pas 1)
// ============================================================================
// 4 corrections d'unites mesurees au banc, toutes du meme noeud racine:
//   1. Horloge client x30: apres 6 h reelles de course, le HUD affichait
//      20:00 au lieu de 14:00 (tick/3600 au lieu de tick/108000).
//   2. Departs echelonnes: les offsets etaient compares en ticks vs secondes
//      -> un intervalle de 60 s partait en 2 s (mesure: 3 voitures en 18 s).
//   3. Fatigue poussiere: +0,01/tick = +1080 pts/h -> boucle sommeil a 33 km
//      sur 12 h pour les profils prudentes/economes. Remplace par un
//      facteur x1,5 applique a la fatigue du moment (meme famille que
//      nuit x1,7 / meteo x1,3).
//   4. Duree du plein: 0,0042 h/L = 1 h 40 pour 400 L (mesure), alors que
//      le commentaire de la constante dit "≈15 min les 400 L" -> 0,000625.
//
// Protocole: chaque diff est ancre sur un texte AVANT unique. TOUTES les
// ancres sont verifiees avant toute ecriture; si une ancre manque (ou est
// en double), le script echoue et RIEN n'est ecrit.
// Usage: node patch-unite-temps.mjs (a la racine du repo)
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";

const diffs = [
  {
    "file": "packages/engine/src/calibration.ts",
    "avant": "export const DUST_SPEED_FACTOR = 0.9;\nexport const DUST_FATIGUE_PER_TICK = 0.01;",
    "apres": "export const DUST_SPEED_FACTOR = 0.9;\n// POUSSIÈRE & FATIGUE: l'ancien DUST_FATIGUE_PER_TICK = 0,01 PAR TICK était\n// calibré comme si 1 tick = 1 s — à 30 ticks/s il valait +1080 points/h\n// (120× l'attaque!), et la boucle poussière->sommeil->poussière gelait les\n// voitures prudentes 11 h sur 12 (mesuré: 33 km en 12 h). La poussière est\n// désormais un MULTIPLICATEUR de la fatigue du moment, dans la famille des\n// facteurs nuit (x1,7) et météo (x1,3). Hypothèse x1,5, effet mesuré sur la\n// course de référence sahara-2026-vvr (bench 12 h post-patch).\nexport const DUST_FATIGUE_FACTOR = 1.5;"
  },
  {
    "file": "packages/engine/src/calibration.ts",
    "avant": "export const FUEL_TIME_H_PER_L = 0.0042;        // heures de plein par litre (≈15 min les 400 L)",
    "apres": "export const FUEL_TIME_H_PER_L = 0.000625;      // heures de plein par litre (≈15 min les 400 L)\n// (0,25 h / 400 L — conforme au commentaire ci-dessus et à FUEL_TIME_PER_PERCENT.\n// L'ancienne valeur 0,0042 h/L donnait 1 h 40 de plein: mesuré au banc, regulier\n// passait 1,5 h à la station pour un simple ravitaillement.)"
  },
  {
    "file": "packages/engine/src/sim.ts",
    "avant": "  DUST_GAP_KM, DUST_SPEED_FACTOR, DUST_FATIGUE_PER_TICK,",
    "apres": "  DUST_GAP_KM, DUST_SPEED_FACTOR, DUST_FATIGUE_FACTOR,"
  },
  {
    "file": "packages/engine/src/sim.ts",
    "avant": "      if (!car.maneuver && !other.immobilized) v = Math.min(v, other.speedKmh);\n      car.fatigue = Math.min(100, car.fatigue + DUST_FATIGUE_PER_TICK);\n      mental(car, ctx.tick, \"La poussière de celui de devant, je ne vois rien.\");",
    "apres": "      if (!car.maneuver && !other.immobilized) v = Math.min(v, other.speedKmh);\n      // marquer le tick de poussière: la fatigue du tick sera multipliée par\n      // DUST_FATIGUE_FACTOR (l'ancien ajout forfaitaire confondait ticks et\n      // secondes: 0,01/tick = +1080/h à 30 ticks/s)\n      car.dustTick = ctx.tick;\n      mental(car, ctx.tick, \"La poussière de celui de devant, je ne vois rien.\");"
  },
  {
    "file": "packages/engine/src/sim.ts",
    "avant": "  const fatigueRate =\n    FATIGUE_PER_HOUR[car.pace] *\n    (1 + darkness * (FATIGUE_NIGHT_FACTOR - 1)) *\n    (weather !== \"clair\" ? FATIGUE_WEATHER_FACTOR : 1);",
    "apres": "  const fatigueRate =\n    FATIGUE_PER_HOUR[car.pace] *\n    (1 + darkness * (FATIGUE_NIGHT_FACTOR - 1)) *\n    (weather !== \"clair\" ? FATIGUE_WEATHER_FACTOR : 1) *\n    (car.dustTick === ctx.tick ? DUST_FATIGUE_FACTOR : 1);"
  },
  {
    "file": "packages/engine/src/types.ts",
    "avant": "  noPassUntilTick: number;          // cooldown avant nouvelle tentative (échec/accrochage)",
    "apres": "  noPassUntilTick: number;          // cooldown avant nouvelle tentative (échec/accrochage)\n  dustTick: number;                 // dernier tick passé dans la poussière d'un rival"
  },
  {
    "file": "packages/engine/src/race.ts",
    "avant": "import { DEFAULT_RULES, CarState, World, WeatherFront, PlayerRule, TICKS_PER_HOUR, FUEL_CAPACITY_L, BUDGET_START } from \"./types\";",
    "apres": "import { DEFAULT_RULES, CarState, World, WeatherFront, PlayerRule, TICKS_PER_HOUR, TICKS_PER_SECOND, FUEL_CAPACITY_L, BUDGET_START } from \"./types\";"
  },
  {
    "file": "packages/engine/src/race.ts",
    "avant": "      lateral: 0,\n      maneuver: null,\n      noPassUntilTick: 0,",
    "apres": "      lateral: 0,\n      maneuver: null,\n      noPassUntilTick: 0,\n      dustTick: 0,"
  },
  {
    "file": "packages/engine/src/race.ts",
    "avant": "      if (this.tick - this.raceStartTick < car.offsetSeconds) continue;",
    "apres": "      // offsetSeconds est en SECONDES réelles: à 30 ticks/s, 60 s demandées\n      // valent 1800 ticks — l'ancienne comparaison directe ticks vs secondes\n      // faisait partir le peloton en 2 s au lieu de l'échelonnement voulu\n      // (mesuré: 10 voitures parties en 18 s avec startIntervalSeconds 60).\n      if ((this.tick - this.raceStartTick) / TICKS_PER_SECOND < car.offsetSeconds) continue;"
  },
  {
    "file": "packages/engine/src/race.ts",
    "avant": "      const aT = a.arrived ? (a.arrivalTime ?? 0) - a.offsetSeconds : Infinity;\n      const bT = b.arrived ? (b.arrivalTime ?? 0) - b.offsetSeconds : Infinity;",
    "apres": "      // compensation du handicap de départ en TICKS (offsetSeconds est en s)\n      const aT = a.arrived ? (a.arrivalTime ?? 0) - a.offsetSeconds * TICKS_PER_SECOND : Infinity;\n      const bT = b.arrived ? (b.arrivalTime ?? 0) - b.offsetSeconds * TICKS_PER_SECOND : Infinity;"
  },
  {
    "file": "packages/client/src/main.ts",
    "avant": "function hourOfDay(tick: number): number {\n  return (8 + tick / 3600) % 24;\n}",
    "apres": "// le serveur tourne à 30 ticks/s (TICKS_PER_HOUR = 108000): l'ancienne\n// conversion (1 tick = 1 s) faisait défiler l'horloge 30× trop vite — après\n// 6 h de course réelles l'écran affichait 20:00 alors qu'il était 14:00, et\n// la nuit visuelle tombait en plein après-midi moteur.\nconst TICKS_PER_HOUR = 108000;\n\nfunction hourOfDay(tick: number): number {\n  return (8 + tick / TICKS_PER_HOUR) % 24;\n}"
  },
  {
    "file": "packages/client/src/main.ts",
    "avant": "  $(\"day\").textContent = `Jour ${Math.floor(state.tick / 86400) + 1}`;",
    "apres": "  $(\"day\").textContent = `Jour ${Math.floor(state.tick / (TICKS_PER_HOUR * 24)) + 1}`;"
  },
  {
    "file": "packages/client/src/main.ts",
    "avant": "    const avg = state!.tick > 0 ? c.positionKm / (state!.tick / 3600) : 0;",
    "apres": "    const avg = state!.tick > 0 ? c.positionKm / (state!.tick / TICKS_PER_HOUR) : 0;"
  },
  {
    "file": "packages/client/src/main.ts",
    "avant": "      (f) => f.kind !== \"piste_endommagee\" && f.startTick <= state.tick + 12 * 3600 && f.endTick >= state.tick && Math.abs(f.km - myKm) < f.radiusKm + 120",
    "apres": "      // fenêtre de 12 h en TICKS (12 * 108000) — l'ancienne valeur 12 * 3600\n      // ticks ne couvrait que 24 minutes de course\n      (f) => f.kind !== \"piste_endommagee\" && f.startTick <= state.tick + 12 * TICKS_PER_HOUR && f.endTick >= state.tick && Math.abs(f.km - myKm) < f.radiusKm + 120"
  },
  {
    "file": "packages/engine/src/engine.test.ts",
    "avant": "    stopWork: null, overtaking: \"prudent\", defending: false, offsetSeconds: 0, lateral: 0, maneuver: null, noPassUntilTick: 0, dailyKm: 0, dayStartTick: 0,",
    "apres": "    stopWork: null, overtaking: \"prudent\", defending: false, offsetSeconds: 0, lateral: 0, maneuver: null, noPassUntilTick: 0, dustTick: 0, dailyKm: 0, dayStartTick: 0,"
  },
  {
    "file": "packages/engine/src/engine.test.ts",
    "avant": "  assert.ok(carC.brake > 0, \"lever de pied affiché dans le virage\");\n});",
    "apres": "  assert.ok(carC.brake > 0, \"lever de pied affiché dans le virage\");\n});\n\n// ========== UNITÉ DE TEMPS: le moteur tourne à 30 ticks/s, pas 1 ==========\n\ntest(\"départ échelonné: l'intervalle est en secondes réelles\", () => {\n  const race = new Race({ seedText: \"echel\", targetHours: 5, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });\n  race.addPlayer(\"a\", \"Alice\", \"#111\");\n  race.addPlayer(\"b\", \"Bob\", \"#222\");\n  race.addPlayer(\"c\", \"Carole\", \"#333\");\n  race.start();\n  const parOffset = (s: number) => race.cars.find((c) => c.offsetSeconds === s)!;\n  // 59 s de course: seule la voiture de offset 0 a bougé\n  for (let i = 0; i < 59 * 30; i++) race.step();\n  assert.ok(parOffset(0).positionKm > 0, \"la première voiture roule\");\n  assert.equal(parOffset(60).positionKm, 0, \"la deuxième n'a pas bougé avant 60 s\");\n  assert.equal(parOffset(120).positionKm, 0, \"la troisième non plus\");\n  // à 61 s: la deuxième part, la troisième attend encore\n  for (let i = 0; i < 2 * 30; i++) race.step();\n  assert.ok(parOffset(60).positionKm > 0, \"la deuxième part après 60 s\");\n  assert.equal(parOffset(120).positionKm, 0, \"la troisième attend son heure\");\n  // l'ancienne comparaison ticks/secondes les faisait partir en 2 s\n});\n\ntest(\"station: 400 L en 15 minutes (pas 1 h 40)\", () => {\n  const race = new Race({ seedText: \"plein\", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });\n  race.addPlayer(\"a\", \"Alice\", \"#111\");\n  race.start();\n  const car = race.cars[0];\n  const st = race.world.stations[0];\n  car.positionKm = st.km; // à la station\n  car.fuel = 0;           // 400 L à verser\n  car.rules = [{\n    channel: 2, enabled: true, conditions: [],\n    action: { kind: \"ravitaillement\", target: { kind: \"percent\", percent: 100 } },\n    effect: { kind: \"default\" }, mode: \"persistante\",\n  }];\n  const t0 = race.tick;\n  race.step();\n  assert.ok(car.stopWork && car.stopWork.fuelTarget !== null, \"ravitaillement engagé\");\n  const hours = (car.stopUntilTick! - t0) / TICKS_PER_HOUR;\n  // 400 L × 0,000625 h/L = 0,25 h = 15 min (l'ancienne constante 0,0042: 1,68 h)\n  assert.ok(Math.abs(hours - 0.25) < 0.02, `durée du plein = ${hours.toFixed(2)} h (attendu 0,25)`);\n});\n\ntest(\"poussière: fatigue ×1,5, pas +1080/h\", () => {\n  const race = new Race({ seedText: \"dust\", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });\n  race.addPlayer(\"lead\", \"Lead\", \"#111\");\n  race.addPlayer(\"suiveur\", \"Suiveur\", \"#222\");\n  race.start();\n  const lead = race.cars[0];\n  const sui = race.cars[1];\n  for (const c of race.cars) c.rules = [{\n    channel: 5, enabled: true, conditions: [], action: { kind: \"allure\", level: \"normale\" },\n    effect: { kind: \"default\" }, mode: \"persistante\",\n  }];\n  // le suiveur 10 m derrière: il reste dans la fenêtre de poussière (50 m)\n  lead.positionKm = 10;\n  sui.positionKm = 10 - 0.01;\n  for (let i = 0; i < 10 * 60 * 30; i++) race.step(); // 10 minutes de course\n  // suiveur: 5,5/h × 1,5 × (10/60) ≈ 1,4 points de fatigue\n  // (l'ancienne constante: +0,01/tick = +180 pts en 10 min → 100 plafonné)\n  assert.ok(sui.fatigue > 0.7 && sui.fatigue < 5, `fatigue suiveur ${sui.fatigue.toFixed(2)} (attendu ≈1,4)`);\n  assert.ok(sui.dustTick > 0, \"le suiveur a été marqué dans la poussière\");\n  assert.ok(lead.fatigue < sui.fatigue, \"le leader (sans poussière) fatigue moins\");\n});"
  }
];

// --- Phase 1: verifier TOUTES les ancres avant de toucher au moindre fichier ---
const contents = new Map();
let ok = true;
for (const d of diffs) {
  if (!contents.has(d.file)) {
    try {
      contents.set(d.file, readFileSync(d.file, "utf8"));
    } catch (e) {
      console.error("X fichier introuvable: " + d.file + " (es-tu a la racine du repo ?)");
      ok = false;
      continue;
    }
  }
  const txt = contents.get(d.file);
  const n = txt.split(d.avant).length - 1;
  if (n === 0) {
    console.error("X " + d.file + ": ancre absente -- " + JSON.stringify(d.avant.slice(0, 80)));
    ok = false;
  } else if (n > 1) {
    console.error("X " + d.file + ": ancre presente " + n + " fois -- " + JSON.stringify(d.avant.slice(0, 80)));
    ok = false;
  }
}
if (!ok) {
  console.error("");
  console.error("ABANDON: ancres invalides, RIEN n a ete ecrit.");
  process.exit(1);
}

// --- Phase 2: application ---
const descs = {"10":"standings: compensation en ticks","11":"horloge: heure du jour","12":"horloge: jour affiche","13":"resultats: vitesse moyenne","14":"prevision a 12 h en ticks","15":"mkCar: dustTick: 0","16":"3 nouveaux tests (echelonne, plein 15 min, poussiere x1,5)","01":"poussiere: facteur x1,5 (anciennement +0,01/tick)","02":"plein: 0,000625 h/L = 15 min les 400 L (anciennement 0,0042 = 1 h 40)","03":"import DUST_FATIGUE_FACTOR","04":"branche poussiere: marque dustTick au lieu d ajouter la fatigue","05":"fatigueRate multiplie par 1,5 si poussiere ce tick","06":"champ CarState.dustTick","07":"import TICKS_PER_SECOND","08":"init dustTick: 0","09":"depart echelonne en secondes reelles"};
let i = 0;
for (const d of diffs) {
  const txt = contents.get(d.file).replace(d.avant, d.apres);
  contents.set(d.file, txt); // crucial: les diffs suivants sur le MEME fichier partent du contenu deja patche
  writeFileSync(d.file, txt);
  i++;
  console.log("OK [" + String(i).padStart(2, "0") + "] " + d.file + " -- " + descs[i < 10 ? "0" + i : String(i)]);
}
console.log("");
console.log(diffs.length + " diffs appliques. Verifications de routine attendues:");
console.log("  - node node_modules/typescript/bin/tsc -p packages/engine/tsconfig.json  -> 0 erreur");
console.log("  - node --test packages/engine/dist/engine.test.js  -> 25/25 (22 + 3 nouveaux)");
console.log("  - node scripts/build-client.js && node node_modules/typescript/bin/tsc -p packages/server/tsconfig.json");
