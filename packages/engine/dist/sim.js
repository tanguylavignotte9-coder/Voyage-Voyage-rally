"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TICKS_PER_HOUR = exports.TICK_SECONDS = void 0;
exports.darknessFactor = darknessFactor;
exports.computeSpeed = computeSpeed;
exports.buildVariables = buildVariables;
exports.tickCar = tickCar;
const world_1 = require("./world");
const planner_1 = require("./planner");
exports.TICK_SECONDS = 1;
exports.TICKS_PER_HOUR = 3600;
const PACE_SPEED_FACTOR = {
    lift_and_coast: 0.6,
    prudente: 0.75,
    normale: 0.9,
    soutenue: 1.0,
    attaque: 1.1,
};
const PACE_CONSUMPTION = {
    lift_and_coast: 0.6,
    prudente: 0.8,
    normale: 1.0,
    soutenue: 1.25,
    attaque: 1.5,
};
const TERRAIN_SPEED = {
    piste_rapide: 1.0,
    piste_moyenne: 0.8,
    piste_mauvaise: 0.6,
    dunes: 0.4,
    regs: 0.6,
    pierrier: 0.5,
    col: 0.45,
    bourbier: 0.35,
    "marécage": 0.3,
};
const TERRAIN_WEAR = {
    piste_rapide: 0.4,
    piste_moyenne: 0.7,
    piste_mauvaise: 1.0,
    dunes: 1.8,
    regs: 1.1,
    pierrier: 1.4,
    col: 1.3,
    bourbier: 1.6,
    "marécage": 1.8,
};
function darknessFactor(hourOfDay) {
    if (hourOfDay >= 21 || hourOfDay < 5)
        return 1.0;
    if (hourOfDay >= 19)
        return (hourOfDay - 19) / 2;
    if (hourOfDay < 7)
        return (7 - hourOfDay) / 2;
    return 0;
}
function computeSpeed(car, seg, weather, darkness) {
    let v = 55 * PACE_SPEED_FACTOR[car.pace];
    v *= TERRAIN_SPEED[seg.terrain] ?? 0.7;
    if (seg.slope > 0)
        v *= Math.max(0.4, 1 - seg.slope * 0.5);
    else if (seg.slope < -0.02)
        v *= 1.05;
    if (weather === "tempete_sable" || weather === "pluie_diluvienne")
        v *= 0.4;
    else if (weather === "brouillard" || weather === "grele" || weather === "vent_fort")
        v *= 0.6;
    else if (weather === "canicule" || weather === "froid_intense")
        v *= 0.85;
    v *= 1 - darkness * 0.35;
    if (car.fatigue > 70)
        v *= 1 - ((car.fatigue - 70) / 100) * 0.4;
    if (car.crevaison)
        v *= 0.5;
    const weightFactor = 1 - (car.fuel / car.fuelCapacity) * 0.05;
    v *= weightFactor;
    if (car.pace === "lift_and_coast")
        v *= 0.9;
    return Math.max(0, v);
}
function buildVariables(car, ctx) {
    const seg = (0, world_1.segmentAt)(ctx.world.segments, car.positionKm);
    const next = (0, world_1.nextStation)(ctx.world.stations, car.positionKm);
    const weather = (0, world_1.weatherAt)(ctx.fronts, ctx.tick, car.positionKm);
    const criticalCount = Object.values(car.organs).filter((w) => w >= 80).length;
    const hour = ctx.hourOfDay(ctx.tick);
    const rivals = ctx.allCars
        ? ctx.allCars.filter((c) => c.playerId !== car.playerId && !c.arrived)
        : [];
    let frontGap = Infinity;
    let behindGap = Infinity;
    for (const r of rivals) {
        const d = r.positionKm - car.positionKm;
        if (d >= 0 && d < frontGap)
            frontGap = d;
        if (d < 0 && -d < behindGap)
            behindGap = -d;
    }
    return {
        crevaison: car.crevaison,
        immobilisation: car.immobilized,
        nuit: darknessFactor(hour) > 0.3,
        en_station: car.stopped && !car.immobilized,
        bivouac_en_cours: car.sleeping > 0 && !car.stopped,
        meteo_active: weather !== "clair",
        depassement_en_cours: false,
        carburant: (car.fuel / car.fuelCapacity) * 100,
        fatigue: car.fatigue,
        usure: car.organs,
        organe_critique: criticalCount,
        vitesse: car.speedKmh,
        km_parcourus: car.positionKm,
        distance_prochaine_station: next ? next.km - car.positionKm : 9999,
        heure: hour,
        jour_de_course: Math.floor((ctx.tick - ctx.raceStartTick) / (24 * exports.TICKS_PER_HOUR)) + 1,
        retard_avance: car.arrived ? 0 : 0,
        distance_rival_devant: frontGap === Infinity ? 9999 : frontGap,
        distance_rival_derriere: behindGap === Infinity ? 9999 : behindGap,
        biome: seg.biome,
        typologie_terrain: seg.terrain,
    };
}
function tickCar(car, ctx) {
    const events = [];
    if (car.arrived || car.forfait)
        return { events };
    const seg = (0, world_1.segmentAt)(ctx.world.segments, car.positionKm);
    const weather = (0, world_1.weatherAt)(ctx.fronts, ctx.tick, car.positionKm);
    const hour = ctx.hourOfDay(ctx.tick);
    const darkness = darknessFactor(hour);
    if (car.immobilized) {
        if (car.immobilizedUntil !== null && ctx.tick >= car.immobilizedUntil) {
            const station = (0, world_1.nextStation)(ctx.world.stations, car.positionKm);
            if (station) {
                car.positionKm = station.km;
                car.immobilized = false;
                car.immobilizedUntil = null;
                car.immobilizedReason = null;
                car.speedKmh = 0;
                car.stopped = true;
                events.push(`${car.playerId} remorqué jusqu'à ${station.name}`);
            }
            else {
                car.immobilized = false;
                car.immobilizedUntil = null;
                car.immobilizedReason = null;
            }
        }
        return { events };
    }
    if (car.sleeping > 0) {
        car.sleeping -= exports.TICK_SECONDS / 3600;
        const recovery = car.stopped && stationHere(ctx, car) ? 12 : 8;
        car.fatigue = Math.max(0, car.fatigue - recovery * (exports.TICK_SECONDS / 3600));
        car.speedKmh = 0;
        if (car.sleeping <= 0)
            car.sleeping = 0;
        return { events };
    }
    const vars = buildVariables(car, ctx);
    const { effects } = (0, planner_1.tickPlanner)(car, vars);
    if (effects.pace)
        car.pace = effects.pace.level;
    if (effects.risk)
        car.risk = effects.risk.level;
    if (effects.overtaking)
        car.overtaking = effects.overtaking.level;
    car.defending = effects.defending;
    if (effects.sleep) {
        car.sleeping = effects.sleep.hours;
        car.stopped = effects.sleep.place === "hotel";
        events.push(`${car.playerId} dort ${effects.sleep.hours}h (${effects.sleep.place})`);
        return { events };
    }
    const riskFactor = car.risk === "haut" ? 1.8 : car.risk === "bas" ? 0.6 : 1.0;
    const speed = computeSpeed(car, seg, weather, darkness);
    car.speedKmh = speed;
    const distanceDelta = (speed * exports.TICK_SECONDS) / 3600;
    car.positionKm = Math.min(ctx.world.totalKm, car.positionKm + distanceDelta);
    const consumptionPerKm = 0.12 * PACE_CONSUMPTION[car.pace] * (TERRAIN_WEAR[seg.terrain] ?? 1) * (1 + riskFactor * 0.15);
    car.fuel = Math.max(0, car.fuel - consumptionPerKm * distanceDelta);
    const wearBase = (TERRAIN_WEAR[seg.terrain] ?? 1) * riskFactor;
    const fatigueRate = (0.5 + darkness * 1.0 + (weather !== "clair" ? 0.5 : 0)) * (car.pace === "attaque" ? 1.5 : 1);
    wearUpdate(car, seg, weather, riskFactor, distanceDelta, ctx, events);
    car.fatigue = Math.min(100, car.fatigue + fatigueRate * (exports.TICK_SECONDS / 3600) * 2);
    if (car.fuel <= 0) {
        car.immobilized = true;
        car.immobilizedReason = "panne sèche";
        car.speedKmh = 0;
        events.push(`${car.playerId} : panne sèche`);
    }
    if (car.positionKm >= ctx.world.totalKm) {
        car.arrived = true;
        car.arrivalTime = ctx.tick;
        car.speedKmh = 0;
        events.push(`${car.playerId} est ARRIVÉ !`);
    }
    return { events };
}
function stationHere(ctx, car) {
    return ctx.world.stations.some((s) => Math.abs(s.km - car.positionKm) < 0.5);
}
function wearUpdate(car, seg, weather, riskFactor, distanceDelta, ctx, events) {
    const bump = (organ, amount) => {
        car.organs[organ] = Math.min(100, car.organs[organ] + amount);
        if (car.organs[organ] >= 100) {
            breakOrgan(car, organ, ctx, events);
        }
    };
    const base = distanceDelta / 100;
    bump("moteur", base * 0.5 * riskFactor * (weather === "canicule" ? 1.5 : 1) * (seg.slope > 0 ? 1.3 : 1));
    bump("transmission", base * 0.4 * riskFactor);
    bump("pneus_av", base * 0.8 * (TERRAIN_WEAR[seg.terrain] ?? 1) * riskFactor * (weather === "tempete_sable" ? 1.2 : 1));
    bump("pneus_ar", base * 0.7 * (TERRAIN_WEAR[seg.terrain] ?? 1) * riskFactor);
    bump("suspensions", base * 0.6 * (TERRAIN_WEAR[seg.terrain] ?? 1) * riskFactor);
    bump("chassis", base * 0.2 * riskFactor);
    bump("freins", base * (seg.slope < -0.02 ? 1.5 : 0.3) * riskFactor);
    bump("refroidissement", base * 0.4 * (weather === "tempete_sable" || weather === "canicule" ? 1.8 : 1));
    probabilisticFailure(car, riskFactor, ctx, events);
}
function probabilisticFailure(car, riskFactor, ctx, events) {
    const perTick = exports.TICK_SECONDS / 3600;
    for (const [organ, wear] of Object.entries(car.organs)) {
        if (wear < 80)
            continue;
        const p = perTick * (wear - 79) * 0.02 * riskFactor;
        if (ctx.rng.chance(p)) {
            breakOrgan(car, organ, ctx, events);
        }
    }
    const accidentP = perTick * (car.fatigue > 70 ? (car.fatigue - 70) * 0.01 : 0) * riskFactor;
    if (ctx.rng.chance(accidentP)) {
        car.immobilized = true;
        car.immobilizedReason = "accident";
        car.speedKmh = 0;
        car.organs.chassis = Math.min(100, car.organs.chassis + 30);
        events.push(`${car.playerId} : accident (fatigue)`);
    }
}
function breakOrgan(car, organ, ctx, events) {
    if (organ === "pneus_av" || organ === "pneus_ar") {
        if (!car.crevaison) {
            car.crevaison = true;
            car.organs[organ] = 90;
            events.push(`${car.playerId} : crevaison (${organ})`);
        }
        return;
    }
    car.immobilized = true;
    car.immobilizedReason = `casse ${organ}`;
    car.speedKmh = 0;
    car.organs[organ] = 100;
    events.push(`${car.playerId} : casse ${organ} — immobilisation`);
}
