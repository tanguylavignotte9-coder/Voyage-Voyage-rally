import { test } from "node:test";
import assert from "node:assert";
import { generateWorld } from "./world";
import { Rng, seedFromString } from "./rng";
import { Race, PRIME_HOUR } from "./race";
import { darknessFactor, computeSpeed } from "./sim";
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
    stopWork: null, overtaking: "prudent", defending: false, offsetSeconds: 0, dailyKm: 0, dayStartTick: 0,
    dailyMaxSpeed: 0, mentalLog: [], towedBy: null, transactions: [],
    stats: { distance: 0, maxSpeed: 0, pannes: 0, depenses: 0, primes: 0, accidents: 0, depassements: 0 },
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

test("règles par défaut présentes (canaux 1-4)", () => {
  assert.equal(DEFAULT_RULES.length, 4);
  assert.deepEqual(DEFAULT_RULES.map((r) => r.channel), [1, 2, 3, 4]);
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
  for (let i = 0; i < 3600; i++) race.step();
  const car = race.cars[0];
  assert.ok(car.positionKm > 10, `position=${car.positionKm}`);
  assert.equal(car.pace, "prudente");
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
  for (let i = 0; i < 3600 * 6; i++) race.step();
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
