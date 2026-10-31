import { test } from "node:test";
import assert from "node:assert";
import { generateWorld, roadAhead, segmentAt, curvatureAt } from "./world";
import { Rng, seedFromString } from "./rng";
import { Race, PRIME_HOUR } from "./race";
import { darknessFactor, computeSpeed, applyTrafficEffects, resolveContactFault, SimContext, TICK_SECONDS, buildVariables, cornerLimitAt, powerGearFor } from "./sim";
import { CAR_LEN_M, GEAR_RATIOS, GEAR_FINAL_DRIVE, WHEEL_RADIUS_M, ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM, wearFactor } from "./calibration";
import { CarState, DEFAULT_RULES, TICKS_PER_HOUR, OrganId, TerrainSegment } from "./types";

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
    stopWork: null, overtaking: "prudent", defending: false, offsetSeconds: 0, lateral: 0, maneuver: null, noPassUntilTick: 0, dustTick: 0, dailyKm: 0, dayStartTick: 0,
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

// ========== HUD MOTEUR: régime et rapport suivent la vitesse tenue ==========
// (patch 7: computeSpeed ne touche plus aux champs HUD — c'est dynamicSpeed,
// appelé par tickCarInternal via race.step(), qui met gear/rpm/pédales à jour;
// le test passe donc par la course réelle, pas par l'équilibre statique)

test("hud moteur: régime et rapport suivent la vitesse réellement tenue", () => {
  const race = new Race({ seedText: "hud-moteur", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("pilote", "Pilote", "#111");
  race.start();
  const car = race.cars[0];
  car.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
  for (let i = 0; i < 2 * 60 * 30; i++) race.step(); // 2 min de course
  assert.ok(car.speedKmh > 25, `la voiture roule (${car.speedKmh.toFixed(0)} km/h)`);
  // rapport et régime exposés = ceux de la vitesse TENUE (le rapport de FORCE,
  // celui qui pousse — en 6e à 918 tr/min la voiture n'accélérait pas)
  const vMs = car.speedKmh / 3.6;
  const gi = powerGearFor(vMs);
  const expected = Math.max(ENGINE_IDLE_RPM, (vMs / WHEEL_RADIUS_M) * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI));
  assert.equal(car.gear, gi + 1, "rapport affiché = rapport tenu");
  assert.ok(Math.abs(car.rpm - expected) < 1, `régime affiché = régime tenu (${car.rpm.toFixed(0)} vs ${expected.toFixed(0)})`);
  assert.ok(car.throttle >= 0 && car.throttle <= 1, `pédale d'accélérateur dans [0,1] (${car.throttle.toFixed(2)})`);
  assert.ok(car.brake >= 0 && car.brake <= 1, `pédale de frein dans [0,1] (${car.brake.toFixed(2)})`);
});
test("usure → performance: wearFactor (rien sous 70%, -30% à 100%)", () => {
  assert.equal(wearFactor(0), 1);
  assert.equal(wearFactor(69.9), 1);
  assert.equal(wearFactor(70), 1, "seuil exact: encore aucun effet");
  assert.ok(Math.abs(wearFactor(85) - (1 - 0.30 * 15 / 30)) < 1e-9, "85%: -15%");
  assert.ok(Math.abs(wearFactor(100) - 0.70) < 1e-9, "malus max -30% à 100% (décision: linéaire après 70%)");
});

test("usure → performance: une voiture usée roule plus lentement", () => {
  const seg: TerrainSegment = { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" };
  const neuf = mkCar("soutenue");
  const vNeuf = computeSpeed(neuf, seg, "clair", 0);
  const usee = mkCar("soutenue");
  for (const o of ["moteur", "transmission", "pneus_av", "pneus_ar", "freins", "suspensions"] as OrganId[]) usee.organs[o] = 50;
  assert.ok(Math.abs(computeSpeed(usee, seg, "clair", 0) - vNeuf) < 0.5, "usure 50% sur tout: AUCUNE dégradation");
  for (const o of ["moteur", "transmission", "pneus_av", "pneus_ar", "freins", "suspensions"] as OrganId[]) usee.organs[o] = 100;
  const vMorte = computeSpeed(usee, seg, "clair", 0);
  // avant ce patch: moteur 95% roulait à 190,2 km/h identique au neuf.
  // Sur LIGNE DROITE RAPIDE le malus puissance -30% donne ~-15% de vitesse
  // top (l'aéro en v² amortit) — mesuré: 172,4 vs 202,7. En virage et sur
  // terrain dur, adhérence/roulement dégradés pèsent bien davantage.
  assert.ok(vMorte < vNeuf * 0.88, `tout usé à 100%: ${vMorte.toFixed(1)} vs ${vNeuf.toFixed(1)} km/h`);
  assert.ok(vMorte > vNeuf * 0.4, "dégradée mais pas morte (la casse immobilise, l'usure ralentit)");
});

test("usure → performance: refroidissement usé + canicule = puissance en berne", () => {
  const seg: TerrainSegment = { km: 0, biome: "desert", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" };
  const saine = mkCar("soutenue");
  const mauvaise = mkCar("soutenue");
  mauvaise.organs.refroidissement = 100;
  // sous temps clair, le refroidissement n'a pas d'effet
  assert.ok(Math.abs(computeSpeed(mauvaise, seg, "clair", 0) - computeSpeed(saine, seg, "clair", 0)) < 0.5, "clair: aucun effet");
  // sous canicule, il pèse
  const vSaine = computeSpeed(saine, seg, "canicule", 0);
  const vMauvaise = computeSpeed(mauvaise, seg, "canicule", 0);
  assert.ok(vMauvaise < vSaine * 0.95, `canicule: refroidissement mort ${vMauvaise.toFixed(1)} vs ${vSaine.toFixed(1)} km/h`);
});

test("météo: l'effet PUISSANCE de la tempête atteint la route (powerEff était du code mort)", () => {
  const seg: TerrainSegment = { km: 0, biome: "steppe", terrain: "piste_rapide", altitude: 0, slope: 0, width: "large" };
  const car = mkCar("soutenue");
  const vClair = computeSpeed(car, seg, "clair", 0);
  const vTempete = computeSpeed(car, seg, "tempete_sable", 0);
  // avant: WEATHER_POWER_EFFECT alimentait powerEff, variable jamais lue
  assert.ok(vTempete < vClair * 0.95, `tempête: ${vTempete.toFixed(1)} vs ${vClair.toFixed(1)} km/h`);
});

test("météo vivante: les fronts se déplacent le long de la route", () => {
  const race = new Race({ seedText: "meteo", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  const mobiles = race.fronts.filter((f) => f.speedKmPerTick !== 0);
  assert.ok(mobiles.length > 0, "au moins un front mobile généré (±5-40 km/h)");
  const f0 = mobiles[0];
  const km0 = f0.km;
  const nTicks = TICKS_PER_HOUR / 2; // 30 minutes simulées
  const drift = f0.speedKmPerTick * nTicks;
  race.addPlayer("a", "Alice", "#111");
  race.start();
  for (let i = 0; i < nTicks; i++) race.step();
  let d = f0.km - km0;
  const total = race.world.totalKm;
  if (d < -total / 2) d += total; else if (d > total / 2) d -= total; // wrap
  assert.ok(Math.abs(d - drift) < 0.5, `le front a bougé de ${d.toFixed(2)} km (attendu ${drift.toFixed(2)})`);
});

test("météo vivante: distance_prochain_front et meteo_devant exposés aux règles", () => {
  const race = new Race({ seedText: "front", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.start();
  const car = race.cars[0];
  // fronts synthétiques: la course n'a pas encore roulé, on remplace les fronts réels
  race.fronts.length = 0;
  race.fronts.push({ id: 9999, kind: "tempete_sable", km: car.positionKm + 100, speedKmPerTick: 0, radiusKm: 20, startTick: 0, endTick: 10 * TICKS_PER_HOUR });
  race.fronts.push({ id: 9998, kind: "pluie_diluvienne", km: car.positionKm + 500, speedKmPerTick: 0, radiusKm: 30, startTick: 0, endTick: 10 * TICKS_PER_HOUR });
  race.fronts.push({ id: 9997, kind: "piste_endommagee" as any, km: car.positionKm + 30, speedKmPerTick: 0, radiusKm: 2, startTick: 0, endTick: 10 * TICKS_PER_HOUR });
  const vars = buildVariables(car, race.ctxFor());
  assert.ok(Math.abs(vars.distance_prochain_front - 80) < 0.5, `distance au front = ${vars.distance_prochain_front} (attendu 80 = bord d'entrée 100 - rayon 20)`);
  assert.equal(vars.meteo_devant, "tempete_sable", "le type du front le plus proche est exposé");
  assert.equal(vars.meteo_active, false, "hors du front: meteo_active fausse");
  // la piste endommagée à +28 km (bord) n'est PAS comptée comme front météo
  // une fois le premier front passé derrière, le suivant prend le relais
  car.positionKm += 85;
  const vars2 = buildVariables(car, race.ctxFor());
  assert.ok(Math.abs(vars2.distance_prochain_front - 385) < 1, `front derrière → suivant à ${vars2.distance_prochain_front} (attendu 385)`);
  assert.equal(vars2.meteo_devant, "pluie_diluvienne");
});

// ========== UNITÉ DE TEMPS: le moteur tourne à 30 ticks/s, pas 1 ==========

test("départ échelonné: l'intervalle est en secondes réelles", () => {
  const race = new Race({ seedText: "echel", targetHours: 5, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.addPlayer("b", "Bob", "#222");
  race.addPlayer("c", "Carole", "#333");
  race.start();
  const parOffset = (s: number) => race.cars.find((c) => c.offsetSeconds === s)!;
  // 59 s de course: seule la voiture de offset 0 a bougé
  for (let i = 0; i < 59 * 30; i++) race.step();
  assert.ok(parOffset(0).positionKm > 0, "la première voiture roule");
  assert.equal(parOffset(60).positionKm, 0, "la deuxième n'a pas bougé avant 60 s");
  assert.equal(parOffset(120).positionKm, 0, "la troisième non plus");
  // à 61 s: la deuxième part, la troisième attend encore
  for (let i = 0; i < 2 * 30; i++) race.step();
  assert.ok(parOffset(60).positionKm > 0, "la deuxième part après 60 s");
  assert.equal(parOffset(120).positionKm, 0, "la troisième attend son heure");
  // l'ancienne comparaison ticks/secondes les faisait partir en 2 s
});

test("station: 400 L en 15 minutes (pas 1 h 40)", () => {
  const race = new Race({ seedText: "plein", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("a", "Alice", "#111");
  race.start();
  const car = race.cars[0];
  const st = race.world.stations[0];
  car.positionKm = st.km; // à la station
  car.fuel = 0;           // 400 L à verser
  car.rules = [{
    channel: 2, enabled: true, conditions: [],
    action: { kind: "ravitaillement", target: { kind: "percent", percent: 100 } },
    effect: { kind: "default" }, mode: "persistante",
  }];
  const t0 = race.tick;
  race.step();
  assert.ok(car.stopWork && car.stopWork.fuelTarget !== null, "ravitaillement engagé");
  const hours = (car.stopUntilTick! - t0) / TICKS_PER_HOUR;
  // 400 L × 0,000625 h/L = 0,25 h = 15 min (l'ancienne constante 0,0042: 1,68 h)
  assert.ok(Math.abs(hours - 0.25) < 0.02, `durée du plein = ${hours.toFixed(2)} h (attendu 0,25)`);
});

test("poussière: fatigue ×1,5, pas +1080/h", () => {
  const race = new Race({ seedText: "dust", targetHours: 5, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("lead", "Lead", "#111");
  race.addPlayer("suiveur", "Suiveur", "#222");
  race.start();
  const lead = race.cars[0];
  const sui = race.cars[1];
  for (const c of race.cars) c.rules = [{
    channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" },
    effect: { kind: "default" }, mode: "persistante",
  }];
  // ÉCHAUFFEMENT (correctif trafic×dynamique): les voitures prennent leur
  // vitesse d'équilibre AVANT le placement — posées à l'arrêt à 10 m, le
  // leader "quasi immobile" passait pour un OBSTACLE contournable: le suiveur
  // le doublait au départ ("suiveur dépasse lead", t=215 mesuré), les rôles
  // s'inversaient et c'est le leader qui mangeait la poussière.
  for (let i = 0; i < 60 * 30; i++) race.step(); // 1 min de roulage
  // le suiveur 10 m derrière: il reste dans la fenêtre de poussière (50 m)
  // (à vitesse égale, le filtre "plus lent que moi" ne s'arme plus: le
  // suiveur suit dans la poussière, les rôles sont stables)
  lead.positionKm = 10;
  sui.positionKm = 10 - 0.01;
  for (let i = 0; i < 10 * 60 * 30; i++) race.step(); // 10 minutes de course
  // suiveur: 5,5/h × 1,5 × (10/60) ≈ 1,4 points de fatigue
  // (l'ancienne constante: +0,01/tick = +180 pts en 10 min → 100 plafonné)
  assert.ok(sui.fatigue > 0.7 && sui.fatigue < 5, `fatigue suiveur ${sui.fatigue.toFixed(2)} (attendu ≈1,4)`);
  assert.ok(sui.dustTick > 0, "le suiveur a été marqué dans la poussière");
  assert.ok(lead.fatigue < sui.fatigue, "le leader (sans poussière) fatigue moins");
});

// ========== PATCH 7: DYNAMIQUE LONGITUDINALE ==========
// La vitesse est un ÉTAT intégré (F = m·a): plus de téléportation entre
// équilibres, freinage ANTICIPÉ (le pilote voit 600 m devant), pédales réelles.
// Mesures avant patch (banc 2-3 h): chute −145 km/h en 1 tick (−123 g) aux
// changements de terrain, frein affiché 8,5 s d'affilée en virage, accélérateur
// constant (70%) pendant 2 h.

// 1. ACCÉLÉRATION: depuis l'arrêt, la voiture monte en vitesse PROGRESSIVEMENT
//    (avant: elle partait instantanément à sa vitesse d'équilibre)
test("dynamique: accélération progressive depuis l'arrêt (plus de téléportation)", () => {
  const race = new Race({ seedText: "dyn-accel", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("pilote", "Pilote", "#111");
  race.start();
  const car = race.cars[0];
  car.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
  let maxAcc = 0; // m/s²
  let prev = car.speedKmh;
  for (let i = 0; i < 30 * 30; i++) { // 30 s
    race.step();
    maxAcc = Math.max(maxAcc, (car.speedKmh - prev) / 3.6 / TICK_SECONDS);
    prev = car.speedKmh;
  }
  assert.ok(car.speedKmh > 80, `la voiture dépasse 80 km/h en 30 s (${car.speedKmh.toFixed(0)} km/h)`);
  assert.ok(maxAcc < 9, `accélération bornée par la physique (${maxAcc.toFixed(1)} m/s² < 9 — avant: +185 km/h en 1 tick)`);
});

// 2. FREINAGE ANTICIPÉ: le pilote voit le virage venir et freine AVANT,
//    fort à l'abord puis en relâchant DANS le virage — jamais au-delà de la
//    capacité physique (avant: frein à fond pendant tout le virage, et
//    téléportation 187→42 km/h en 1 tick aux changements de terrain)
test("dynamique: frein anticipé avant le virage, relâché dedans", () => {
  const race = new Race({ seedText: "dyn-frein", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("pilote", "Pilote", "#111");
  race.start();
  const car = race.cars[0];
  car.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
  // un virage FORT à APPROCHE DROITE (au-delà du km 2): on place la voiture à
  // 170 km/h — si l'approche est courbée, l'accident émergent PRÉEXISTANT la
  // tue avant le virage (mesuré: "casse chassis" à 6 ticks). Le candidat doit
  // avoir 500→250 m d'approche droite et un virage serré.
  let cornerKm = 0;
  for (const p of race.world.points) {
    if (p.km <= 2) continue;
    const here = curvatureAt(race.world, p.km);
    if (here < 0.5) continue; // pas un virage fort
    let straight = true;
    for (let d = 500; d >= 250; d -= 50) {
      if (curvatureAt(race.world, p.km - d / 1000) > 0.15) { straight = false; break; }
    }
    if (straight) { cornerKm = p.km; break; }
  }
  assert.ok(cornerKm > 0, "le monde contient un virage fort à approche droite");
  // place la voiture 500 m avant, à 170 km/h
  car.positionKm = Math.max(0.6, cornerKm - 0.5);
  car.speedKmh = 170;
  const entryKm = car.positionKm + 0.5;
  let vAt100m = 0, maxDec = 0, prev = 170, brakeInsideSum = 0, brakeInsideN = 0, brakedBefore = false;
  for (let i = 0; i < 30 * 60; i++) { // 60 s max
    race.step();
    maxDec = Math.max(maxDec, (prev - car.speedKmh) / 3.6 / TICK_SECONDS);
    prev = car.speedKmh;
    const d = (entryKm - car.positionKm) * 1000; // mètres avant l'entrée
    if (!vAt100m && Math.abs(d - 100) < 8) vAt100m = car.speedKmh;
    if (d > 20 && car.brake > 0.4) brakedBefore = true;
    if (d <= 0 && d > -60) { brakeInsideSum += car.brake; brakeInsideN++; }
    if (car.positionKm > entryKm + 0.08) break;
  }
  assert.ok(brakedBefore, "freine AVANT le virage (anticipation 600 m)");
  assert.ok(vAt100m > 0 && vAt100m < 150, `à 100 m de l'entrée la vitesse a déjà chuté (${vAt100m.toFixed(0)} km/h < 150)`);
  assert.ok(maxDec < 12, `pas de téléportation (décél max ${maxDec.toFixed(1)} m/s² < 12 — avant: −1210 m/s²)`);
  assert.ok(brakeInsideN > 0 && brakeInsideSum / brakeInsideN < 0.75, `frein relâché DANS le virage (moyenne ${(brakeInsideSum / brakeInsideN).toFixed(2)} < 0.75 — avant: 1.0 pendant tout le virage)`);
});

// 3. SURVITESSE → DÉRIVE (décision: l'accident se paie hors piste): entré trop
//    vite, la voiture glisse vers l'EXTÉRIEUR; une roue peut sortir (l'adhérence
//    chute) et la demande latérale alimente l'accident émergent existant
test("dynamique: survitesse en virage → dérive extérieure + frein à fond", () => {
  const race = new Race({ seedText: "dyn-drift", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("pilote", "Pilote", "#111");
  race.start();
  const car = race.cars[0];
  car.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
  let best = 0, cornerKm = 0;
  for (const p of race.world.points) {
    if (p.km > 2 && Math.abs(p.curvature) > best) { best = Math.abs(p.curvature); cornerKm = p.km; }
  }
  // limite d'adhérence du virage, puis entrée à 1,6× (freinage raté)
  const seg = segmentAt(race.world.segments, cornerKm);
  const vLimKmh = cornerLimitAt(car, seg, "clair", 0, race.world, cornerKm) * 3.6;
  assert.ok(vLimKmh > 30 && vLimKmh < 140, `limite du virage crédible (${vLimKmh.toFixed(0)} km/h)`);
  car.positionKm = cornerKm;
  car.speedKmh = vLimKmh * 1.6;
  const lat0 = Math.abs(car.lateral);
  let maxBrake = 0;
  for (let i = 0; i < 20; i++) { // ~0,7 s dans le virage
    race.step();
    maxBrake = Math.max(maxBrake, car.brake);
  }
  assert.ok(Math.abs(car.lateral) > lat0 + 0.3, `la voiture dérive vers l'extérieur (|lat| ${lat0.toFixed(2)} → ${Math.abs(car.lateral).toFixed(2)} m)`);
  assert.ok(maxBrake >= 0.9, `frein à fond exigé par la survitesse (${maxBrake.toFixed(2)})`);
});

// 4. FREINS USÉS → freinage réel dégradé (décision: l'usure des freins allonge
//    les distances): à 100% d'usure la capacité de décélération chute de 30%
test("dynamique: freins usés = décélération max plus faible", () => {
  const mkRace = (): Race => {
    const r = new Race({ seedText: "dyn-usure-freins", targetHours: 3, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
    r.addPlayer("pilote", "Pilote", "#111");
    r.start();
    r.cars[0].rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
    return r;
  };
  let cornerKm = 0;
  {
    // même critère que le test de freinage: virage fort à approche droite
    const r = mkRace();
    for (const p of r.world.points) {
      if (p.km <= 2) continue;
      if (curvatureAt(r.world, p.km) < 0.5) continue;
      let straight = true;
      for (let d = 500; d >= 250; d -= 50) {
        if (curvatureAt(r.world, p.km - d / 1000) > 0.15) { straight = false; break; }
      }
      if (straight) { cornerKm = p.km; break; }
    }
  }
  assert.ok(cornerKm > 0, "le monde contient un virage fort à approche droite");
  const measure = (brakeWear: number): number => {
    const r = mkRace();
    const car = r.cars[0];
    car.organs.freins = brakeWear;
    car.positionKm = Math.max(0.6, cornerKm - 0.5);
    car.speedKmh = 170;
    let maxDec = 0, prev = 170;
    for (let i = 0; i < 30 * 45; i++) { // 45 s max
      r.step();
      maxDec = Math.max(maxDec, (prev - car.speedKmh) / 3.6 / TICK_SECONDS);
      prev = car.speedKmh;
      if (car.positionKm > cornerKm + 0.05) break;
    }
    return maxDec;
  };
  const decNeuf = measure(0);
  const decUse = measure(100);
  assert.ok(decNeuf > 2, `le neuf freine fort (${decNeuf.toFixed(1)} m/s²)`);
  assert.ok(decUse < decNeuf * 0.85, `freins à 100%: décélération max réduite (${decUse.toFixed(1)} vs ${decNeuf.toFixed(1)} m/s², attendu ≈ −30%)`);
});

// 5. TRAFIC × DYNAMIQUE (correctif tempête d'accrochages): avec l'état intégré,
//    les facteurs de vitesse par tick (poussière ×0.9, bord sale ×0.5) se
//    composaient sur l'état — effondrement exponentiel mesuré: voiture garée à
//    3,4 km/h pendant 6 minutes en phase côte à côte collée, tirage
//    d'accrochage à 900 m d'écart, 8/10 voitures mortes en 1 h de bench.
//    Correctifs: facteurs = échelles de CIBLE, échappée de la phase côte à
//    côte, accrochage seulement au contact, ré-engagement sur la vitesse
//    demandée. Le rapide doit doubler le lent — proprement.
test("trafic: le rapide double le lent, sans accrochage ni voiture garée", () => {
  const race = new Race({ seedText: "traf-tempete", targetHours: 6, startIntervalSeconds: 0, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer("lent", "Lent", "#111");
  race.addPlayer("rapide", "Rapide", "#222");
  race.start();
  const [lent, rapide] = race.cars;
  lent.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "lift_and_coast" }, effect: { kind: "default" }, mode: "persistante" }];
  rapide.rules = [{ channel: 5, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" }];
  // placement DÉTERMINISTE (l'ordre du départ est tiré au sort par le rng):
  // le lent 1,2 km devant, les deux à 60 km/h — le rapide, dont l'équilibre
  // est plus haut, rattrape et doit doubler proprement
  lent.positionKm = 1.2; lent.speedKmh = 60;
  rapide.positionKm = 0.0; rapide.speedKmh = 60;
  // 15 min de course: rattrapage (~2-4 min), dépassement, détachement
  let parkedTicks = 0; // ticks consécutifs "voiture garée": <15 km/h, déportée, censée rouler
  let parkedMax = 0;
  for (let i = 0; i < 15 * 60 * 30; i++) {
    race.step();
    for (const c of race.cars) {
      const crawling = c.speedKmh > 0.5 && c.speedKmh < 15 && Math.abs(c.lateral) > 2
        && !c.immobilized && !c.stopWork && c.sleeping <= 0;
      parkedTicks = crawling ? parkedTicks + 1 : 0;
      parkedMax = Math.max(parkedMax, parkedTicks);
    }
  }
  const accrochages = race.events.filter((e) => e.text.includes("Accrochage")).length;
  const depassements = race.events.filter((e) => e.text.includes("dépasse")).length;
  assert.ok(depassements >= 1, `le rapide a bien doublé le lent (${depassements} dépassement(s))`);
  assert.equal(accrochages, 0, `aucun accrochage (${accrochages} — avant correctif: tempête)`);
  assert.ok(parkedMax < 60, `pas de voiture garée sur la piste (max ${parkedMax} ticks <15 km/h déportée, < 2 s)`);
  assert.ok(rapide.positionKm > lent.positionKm + 0.1, `le rapide est détaché devant (+${((rapide.positionKm - lent.positionKm) * 1000).toFixed(0)} m)`);
});
