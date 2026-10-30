import { test } from "node:test";
import assert from "node:assert";
import { generateWorld, roadAhead } from "./world";
import { Rng, seedFromString } from "./rng";
import { Race, PRIME_HOUR } from "./race";
import { darknessFactor, computeSpeed, applyTrafficEffects, resolveContactFault, SimContext, TICK_SECONDS } from "./sim";
import { CAR_LEN_M } from "./calibration";
import { CarState, DEFAULT_RULES, TICKS_PER_HOUR } from "./types";

test("déterminisme: même graine = même monde", () => {
  const w1 = generateWorld({ seed: 42, targetHours: 10 });
  const w2 = generateWorld({ seed: 42, targetHours: 10 });
  assert.equal(w1.totalKm, w2.totalKm);
  assert.deepEqual(w1.stations, w2.stations);
  assert.deepEqual(w1.segments.slice(0, 5), w2.segments.slice(0, 5));
});

test("rng déterministe", () => {
  const r1 = new Rng(seedFromString("sahara"));
  const r2 = new Rng(seedFromString("sahara"));
  for (let i = 0; i < 10; i++) assert.equal(r1.next(), r2.next());
});

test("nuit progressive", () => {
  assert.equal(darknessFactor(12), 0);
  assert.equal(darknessFactor(23), 1);
  assert.equal(darknessFactor(3), 1);
  assert.ok(darknessFactor(20) > 0 && darknessFactor(20) < 1);
});

function mkCar(pace: any = "normale"): CarState {
  return {
    playerId: "x", color: "#333", positionKm: 0, fuel: 60, fuelCapacity: 60,
    organs: { moteur: 0, transmission: 0, pneus_av: 0, pneus_ar: 0, suspensions: 0, chassis: 0, freins: 0, refroidissement: 0 },
    fatigue: 0, speedKmh: 0, pace, risk: "normal", rules: [], settings: { tirePressure: 50, groundClearance: 50, engineMap: 50, startFuel: 60 },
    spareWheels: 1, budget: 1000, arrived: false, arrivalTime: null, finisherRank: null, forfait: false,
    allowAssist: true, immobilized: false, immobilizedReason: null, immobilizedUntil: null, truckCalledTick: null,
    crevaison: false, crevaisonOrgan: null, sleeping: 0, sleepPlace: null, stopped: false, stopUntilTick: null,
    stopWork: null, overtaking: "prudent", defending: false, offsetSeconds: 0, lateral: 0, maneuver: null, noPassUntilTick: 0, dailyKm: 0, dayStartTick: 0,
    dailyMaxSpeed: 0, mentalLog: [], towedBy: null, transactions: [],
    stats: { distance: 0, maxSpeed: 0, pannes: 0, depenses: 0, primes: 0, accidents: 0, depassements: 0 },
    gear: 1, rpm: 900, throttle: 0, brake: 0,
  };
}

test("vitesse: dunes plus lentes que piste rapide", () => {
  const car = mkCar("normale");
  const vRapide = computeSpeed(car, { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" }, "clair", 0);
  const vDunes = computeSpeed(car, { km: 0, biome: "desert", terrain: "dunes", altitude: 0, slope: 0, width: "moyenne" }, "clair", 0);
  assert.ok(vDunes < vRapide * 0.7);
});

test("vitesse: pénalité nuit et fatigue", () => {
  const car = mkCar("normale");
  const seg = { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" } as any;
  const vDay = computeSpeed(car, seg, "clair", 0);
  const vNight = computeSpeed(car, seg, "clair", 1);
  const tired = mkCar("normale");
  tired.fatigue = 90;
  const vTired = computeSpeed(tired, seg, "clair", 0);
  assert.ok(vNight < vDay);
  assert.ok(vTired < vDay);
});

test("règles par défaut présentes (canaux 1-5)", () => {
  assert.equal(DEFAULT_RULES.length, 5);
  assert.deepEqual(DEFAULT_RULES.map((r) => r.channel), [1, 2, 3, 4, 5]);
  // canal 5: allure normale par défaut (le pilote roule en normale d'office)
  assert.equal(DEFAULT_RULES[4].action.kind, "allure");
  assert.equal((DEFAULT_RULES[4].action as any).level, "normale");
});

test("race: départ décalé et classement compensé", () => {
  const race = new Race({ seedText: "x", targetHours: 5, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.addPlayer("b", "Bob", "#222");
  race.start();
  const carA = race.cars.find((c) => c.playerId === "a")!;
  const carB = race.cars.find((c) => c.playerId === "b")!;
  assert.notEqual(carA.offsetSeconds, carB.offsetSeconds);
  assert.equal(Math.abs(carA.offsetSeconds - carB.offsetSeconds), 60);
});

test("race: pas de step avant départ", () => {
  const race = new Race({ seedText: "x", targetHours: 5, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  const before = race.tick;
  const kmBefore = race.cars[0].positionKm;
  race.step();
  race.step();
  assert.equal(race.tick, before);
  assert.equal(race.cars[0].positionKm, kmBefore);
  race.start();
  race.step();
  assert.equal(race.tick, before + 1);
  assert.ok(race.cars[0].positionKm >= kmBefore);
});

test("course: voiture sans règle avance en allure prudente", () => {
  const race = new Race({ seedText: "y", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.start();
  for (let i = 0; i < 3600 * 30; i++) race.step();
  const car = race.cars[0];
  assert.ok(car.positionKm > 10, `position=${car.positionKm}`);
  // la règle par défaut N\u00b05 impose allure normale; si le joueur la
  // désactive/supprime, le fallback prudent tient (doc \u00a75)
  assert.equal(car.pace, "normale");
});

test("immobilisation: camion appelable, 6h puis remorquage", () => {
  const race = new Race({ seedText: "z", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.start();
  const car = race.cars[0];
  car.fuel = 0;
  car.immobilized = true;
  car.immobilizedReason = "panne sèche";
  const kmAtStop = car.positionKm;
  race.callTruck("a");
  assert.notEqual(car.truckCalledTick, null);
  for (let i = 0; i < 3600 * 6 * 30; i++) race.step();
  assert.ok(!car.immobilized, "doit être remorqué après 6h");
  assert.ok(car.positionKm > kmAtStop, "doit avoir été remorqué vers l'avant");
});

test("forfait: classement à la distance, spectateur", () => {
  const race = new Race({ seedText: "w", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.addPlayer("b", "Bob", "#222");
  race.start();
  race.declareForfait("b");
  for (let i = 0; i < 600; i++) race.step();
  const bob = race.cars.find((c) => c.playerId === "b")!;
  assert.ok(bob.forfait);
  assert.equal(bob.positionKm, 0);
  assert.ok(race.standings()[0].playerId === "a");
});

test("conso: la descente économise, la montée coûte, avec plancher ralenti", () => {
  const { slopeConsumptionFactor } = require("./calibration");
  // plat
  assert.equal(slopeConsumptionFactor(0), 1);
  // montée 10 ‰ : +28 %
  assert.ok(Math.abs(slopeConsumptionFactor(10) - 1.28) < 0.001);
  // descente 10 ‰ : -22 %
  assert.ok(Math.abs(slopeConsumptionFactor(-10) - 0.78) < 0.001);
  // descente extrême : plancher ralenti, jamais zéro
  assert.equal(slopeConsumptionFactor(-30), 0.45);
  assert.ok(slopeConsumptionFactor(-100) >= 0.45);
  // monotonicité
  assert.ok(slopeConsumptionFactor(5) > slopeConsumptionFactor(0));
  assert.ok(slopeConsumptionFactor(-5) < slopeConsumptionFactor(0));
});

test("conso: intégration — une voiture économise réellement en descente", () => {
  const { Race } = require("./race");
  const { computeSpeed } = require("./sim");
  const car = mkCar("normale");
  const segUp = { km: 0, biome: "montagne", terrain: "piste_moyenne", altitude: 0, slope: 12, width: "moyenne" } as any;
  const segDown = { km: 0, biome: "montagne", terrain: "piste_moyenne", altitude: 0, slope: -12, width: "moyenne" } as any;
  const segFlat = { km: 0, biome: "steppe", terrain: "piste_moyenne", altitude: 0, slope: 0, width: "moyenne" } as any;
  const eff = require("./calibration").settingsEffects(car.settings);
  const consumption = (seg: any) =>
    (require("./calibration").FUEL_BASE_L_PER_100KM / 100) *
    require("./calibration").PACE_CONSUMPTION_FACTOR.normale *
    (require("./calibration").FUEL_TERRAIN_FACTOR[seg.terrain] ?? 1.3) *
    require("./calibration").slopeConsumptionFactor(seg.slope) *
    eff.consumption;
  const cUp = consumption(segUp);
  const cDown = consumption(segDown);
  const cFlat = consumption(segFlat);
  assert.ok(cUp > cFlat * 1.2, `montée ${cUp.toFixed(2)} > plat ${cFlat.toFixed(2)}`);
  assert.ok(cDown < cFlat * 0.85, `descente ${cDown.toFixed(2)} < plat ${cFlat.toFixed(2)}`);
  // et la descente reste plus rapide (le levier d'altitude du §4)
  assert.ok(computeSpeed(car, segDown, "clair", 0) > computeSpeed(car, segFlat, "clair", 0));
});


// ========== DÉPASSEMENT SPATIAL ==========

test("en tort: en virage l'EXTÉRIEUR est en tort, sur ligne droite le doublard", () => {
  const mkWorld = (curv: number) =>
    ({ points: Array.from({ length: 400 }, () => ({ curvature: curv })), segments: [] }) as any;
  const d = mkCar(); d.playerId = "d"; d.lateral = 2;   // déporté à gauche
  const c = mkCar(); c.playerId = "c"; c.lateral = 0;   // à la corde
  const gauche = { world: mkWorld(0.0025) } as any;      // virage à GAUCHE
  const droite = { world: mkWorld(-0.0025) } as any;    // virage à DROITE
  const ligneDroite = { world: mkWorld(0) } as any;
  assert.equal(resolveContactFault(d, c, gauche).playerId, "c", "virage gauche: l'extérieur (c) en tort");
  assert.equal(resolveContactFault(c, d, gauche).playerId, "c", "symétrique: même verdict quel que soit le point de vue");
  assert.equal(resolveContactFault(d, c, droite).playerId, "d", "virage droite: le doublard extérieur en tort");
  assert.equal(resolveContactFault(d, c, ligneDroite).playerId, "d", "ligne droite: le doublard en tort");
  c.defending = true;
  assert.equal(resolveContactFault(d, c, ligneDroite).playerId, "c", "ligne droite + défense active: le défenseur en tort");
  c.defending = false;
});

function driveOvertake(width: "large" | "moyenne" | "etroite", overtaking: "prudent" | "agressif" | "interdit" = "prudent", seed = "overtake-test") {
  const world = generateWorld({ seed: 42, targetHours: 10 });
  const seg = world.segments.find((s) => s.width === width)!;
  const km0 = seg.km + 0.5;
  const doublard = mkCar("attaque");
  doublard.playerId = "rapide"; doublard.positionKm = km0; doublard.speedKmh = 100;
  doublard.overtaking = overtaking; doublard.risk = "bas";
  const cible = mkCar("prudente");
  cible.playerId = "lente"; cible.positionKm = km0 + 0.06; cible.speedKmh = 70;
  const logs: { text: string; doublardKm: number; cibleKm: number }[] = [];
  const ctx: SimContext = {
    world, fronts: [], rng: new Rng(seedFromString(seed)), tick: 0, raceStartTick: 0,
    started: true, hourOfDay: () => 10, allCars: [doublard, cible],
    logGlobal: () => {},
  };
  for (let t = 0; t < 90 * 30 && (doublard.stats.depassements === 0 || doublard.maneuver !== null); t++) {
    ctx.tick = t;
    const vd = applyTrafficEffects(doublard, ctx, 100, 1, (txt) => logs.push({ text: txt, doublardKm: doublard.positionKm, cibleKm: cible.positionKm }));
    doublard.speedKmh = vd;
    doublard.positionKm += (vd / 3600) * TICK_SECONDS;
    const vc = applyTrafficEffects(cible, ctx, 70, 1, () => {});
    cible.speedKmh = vc;
    cible.positionKm += (vc / 3600) * TICK_SECONDS;
  }
  return { doublard, cible, logs };
}

test("dépassement: franchissement RÉEL, loggé une seule fois, jamais derrière", () => {
  const { doublard, logs } = driveOvertake("large");
  assert.equal(logs.length, 1, "un seul log");
  assert.ok(logs[0].text.includes("dépasse"));
  assert.equal(doublard.stats.depassements, 1);
  assert.ok(
    logs[0].doublardKm > logs[0].cibleKm + CAR_LEN_M / 1000 - 1e-9,
    "le log n'arrive qu'une longueur DEVANT la cible"
  );
  assert.equal(doublard.maneuver, null, "la manœuvre est terminée");
});

test("piste moyenne: la place existe réellement — dépassement possible", () => {
  const { doublard, logs } = driveOvertake("moyenne");
  assert.equal(logs.length, 1);
  assert.equal(doublard.stats.depassements, 1);
});

test("piste étroite: file indienne, aucune manœuvre", () => {
  const { doublard, cible, logs } = driveOvertake("etroite");
  assert.equal(doublard.maneuver, null, "aucune manœuvre initiée");
  assert.equal(logs.length, 0);
  assert.equal(doublard.stats.depassements, 0);
  assert.ok(doublard.positionKm < cible.positionKm, "toujours derrière");
  assert.ok(doublard.speedKmh <= 70.5, "le suiveur colle à la vitesse du meneur");
});

test("dépassement interdit: jamais de manœuvre, jamais de franchissement fantôme", () => {
  const { doublard, cible, logs } = driveOvertake("large", "interdit");
  assert.equal(doublard.maneuver, null);
  assert.equal(logs.length, 0);
  assert.ok(doublard.positionKm < cible.positionKm, "sans manœuvre, on ne TRAVERSE jamais un rival");
});

test("accrochage: impossible contre une voiture à l'arrêt (bas-côté)", () => {
  const world = generateWorld({ seed: 42, targetHours: 10 });
  const seg = world.segments.find((s) => s.width === "large")!;
  const doublard = mkCar("attaque");
  doublard.playerId = "rapide"; doublard.positionKm = seg.km + 0.5; doublard.speedKmh = 100;
  doublard.overtaking = "agressif"; doublard.risk = "haut";
  const cible = mkCar("prudente");
  cible.playerId = "arrete"; cible.positionKm = seg.km + 0.53; cible.speedKmh = 0; cible.stopped = true;
  const logs: string[] = [];
  const ctx: SimContext = {
    world, fronts: [], rng: new Rng(seedFromString("arrete-test")), tick: 0, raceStartTick: 0,
    started: true, hourOfDay: () => 10, allCars: [doublard, cible],
    logGlobal: () => {},
  };
  for (let t = 0; t < 60 * 30 && doublard.stats.depassements === 0; t++) {
    ctx.tick = t;
    const vd = applyTrafficEffects(doublard, ctx, 100, 1, (txt) => logs.push(txt));
    doublard.speedKmh = vd;
    doublard.positionKm += (vd / 3600) * TICK_SECONDS;
  }
  assert.equal(doublard.stats.depassements, 1, "on dépasse la voiture en panne");
  assert.equal(logs.filter((l) => l.includes("dépasse")).length, 1);
  assert.equal(doublard.stats.accidents, 0, "pas d'accrochage: la cible est à l'arrêt");
  assert.equal(cible.stats.accidents, 0);
  assert.equal(doublard.organs.chassis, 0);
  assert.equal(cible.organs.chassis, 0);
});

// ========== CONSCIENCE DE COURSE (fenêtre d'engagement) ==========

test("conscience: lecture du tracé devant (roadAhead)", () => {
  const fakeWorld = {
    segments: [
      { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" },
      { km: 5, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" },
      { km: 10, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
      { km: 15, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
      { km: 20, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
    ],
    points: Array.from({ length: 1500 }, () => ({ curvature: 0 })),
  } as any;
  assert.equal(roadAhead(fakeWorld, 0.5, 0.6).minWidth, "large", "fenêtre dans le large");
  assert.equal(roadAhead(fakeWorld, 9.4, 0.6).minWidth, "etroite", "fenêtre qui touche l'étroit");
  assert.ok(roadAhead(fakeWorld, 0.5, 0.6).maxCurve <= 0.15, "fenêtre plate");
});

test("conscience: on attend la fenêtre ouverte pour s'engager", () => {
  const mkFakeWorld = () => ({
    segments: [
      { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" },
      { km: 5, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" },
      { km: 10, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
      { km: 15, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
      { km: 20, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "etroite" },
    ],
    points: Array.from({ length: 1500 }, () => ({ curvature: 0 })),
  }) as any;
  const drive = (km0: number, ticks: number) => {
    const doublard = mkCar("attaque");
    doublard.playerId = "rapide"; doublard.positionKm = km0; doublard.speedKmh = 100;
    doublard.overtaking = "prudent"; doublard.risk = "bas";
    const cible = mkCar("prudente");
    cible.playerId = "lente"; cible.positionKm = km0 + 0.06; cible.speedKmh = 70;
    const ctx: SimContext = {
      world: mkFakeWorld(), fronts: [], rng: new Rng(seedFromString("fenetre")), tick: 0, raceStartTick: 0,
      started: true, hourOfDay: () => 10, allCars: [doublard, cible],
      logGlobal: () => {},
    };
    for (let t = 0; t < ticks && (doublard.stats.depassements === 0 || doublard.maneuver !== null); t++) {
      ctx.tick = t;
      const vd = applyTrafficEffects(doublard, ctx, 100, 1, () => {});
      doublard.speedKmh = vd;
      doublard.positionKm += (vd / 3600) * TICK_SECONDS;
      const vc = applyTrafficEffects(cible, ctx, 70, 1, () => {});
      cible.speedKmh = vc;
      cible.positionKm += (vc / 3600) * TICK_SECONDS;
    }
    return doublard;
  };
  // fenêtre fermée (un étroit arrive dans les 600 m): aucune manœuvre, on suit
  const attendant = drive(9.4, 300);
  assert.equal(attendant.maneuver, null, "fenêtre fermée: pas d'engagement");
  assert.equal(attendant.stats.depassements, 0, "fenêtre fermée: pas de dépassement");
  // fenêtre ouverte: la même situation (écart 60 m, cible plus lente) se débloque
  const passant = drive(0.5, 2700);
  assert.equal(passant.stats.depassements, 1, "fenêtre ouverte: le dépassement se fait");
  assert.equal(passant.maneuver, null, "manœuvre terminée");
});
