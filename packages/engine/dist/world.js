"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AVG_SPEED_KMH = void 0;
exports.generateWorld = generateWorld;
exports.segmentAt = segmentAt;
exports.nextStation = nextStation;
exports.generateWeatherFronts = generateWeatherFronts;
exports.weatherAt = weatherAt;
const rng_1 = require("./rng");
const BIOMES = ["desert", "montagne", "steppe", "humide"];
const TERRAINS_BY_BIOME = {
    desert: ["dunes", "regs", "piste_moyenne", "piste_mauvaise"],
    montagne: ["col", "pierrier", "piste_mauvaise", "piste_moyenne"],
    steppe: ["piste_rapide", "piste_moyenne", "piste_mauvaise"],
    humide: ["bourbier", "marécage", "piste_mauvaise", "piste_moyenne"],
};
exports.AVG_SPEED_KMH = 50;
function generateWorld(params) {
    const rng = new rng_1.Rng(params.seed);
    const totalKm = Math.round(params.targetHours * exports.AVG_SPEED_KMH * rng.range(0.9, 1.1));
    const weights = {
        desert: params.biomeWeights?.desert ?? 1,
        montagne: params.biomeWeights?.montagne ?? 1,
        steppe: params.biomeWeights?.steppe ?? 1,
        humide: params.biomeWeights?.humide ?? 1,
    };
    const biomeSequence = [];
    const weightSum = BIOMES.reduce((s, b) => s + weights[b], 0);
    while (biomeSequence.length < 8) {
        let r = rng.next() * weightSum;
        let chosen = BIOMES[0];
        for (const b of BIOMES) {
            r -= weights[b];
            if (r <= 0) {
                chosen = b;
                break;
            }
        }
        if (biomeSequence[biomeSequence.length - 1] !== chosen)
            biomeSequence.push(chosen);
    }
    const segments = [];
    const segmentLength = 25;
    let altitude = 200;
    let currentBiome = biomeSequence[0];
    let biomeKmLeft = totalKm / biomeSequence.length;
    for (let km = 0; km < totalKm; km += segmentLength) {
        if (biomeKmLeft <= 0 && biomeSequence.length > 1) {
            biomeSequence.shift();
            currentBiome = biomeSequence[0];
            if (biomeSequence.length === 1)
                biomeSequence.push(currentBiome);
            biomeKmLeft = totalKm / 8;
        }
        biomeKmLeft -= segmentLength;
        const terrain = rng.pick(TERRAINS_BY_BIOME[currentBiome]);
        if (currentBiome === "montagne") {
            altitude += rng.range(-150, 250);
        }
        else if (currentBiome === "humide") {
            altitude += rng.range(-50, 50);
        }
        else {
            altitude += rng.range(-40, 60);
        }
        altitude = Math.max(0, Math.min(3500, altitude));
        segments.push({
            km,
            biome: currentBiome,
            terrain,
            altitude,
            slope: 0,
            width: rng.pick(["large", "moyenne", "moyenne", "etroite"]),
        });
    }
    for (let i = 1; i < segments.length; i++) {
        const d = segments[i].altitude - segments[i - 1].altitude;
        segments[i].slope = d / segmentLength;
    }
    const stations = [];
    let nextStationKm = 150;
    let stationIdx = 1;
    while (nextStationKm < totalKm - 100) {
        const seg = segmentAt(segments, nextStationKm);
        stations.push({
            km: nextStationKm,
            name: `Station ${stationIdx}`,
            hasHotel: rng.chance(0.4),
        });
        stationIdx++;
        nextStationKm += rng.range(300, 500) * (seg.biome === "humide" ? 0.9 : 1);
    }
    stations.push({ km: totalKm, name: "Arrivée", hasHotel: true });
    const villages = [];
    const rivers = [];
    let villageKm = rng.range(40, 120);
    let vIdx = 1;
    while (villageKm < totalKm) {
        villages.push({ km: villageKm, name: `Village ${vIdx}`, traversed: rng.chance(0.5) });
        vIdx++;
        villageKm += rng.range(80, 300);
    }
    let riverKm = rng.range(60, 200);
    let rIdx = 1;
    while (riverKm < totalKm) {
        rivers.push({ km: riverKm, name: `Rivière ${rIdx}` });
        rIdx++;
        riverKm += rng.range(200, 500);
    }
    return {
        seed: params.seed,
        totalKm,
        segments,
        stations,
        villages,
        rivers,
        startName: "Départ",
        endName: "Arrivée",
    };
}
function segmentAt(segments, km) {
    const idx = Math.min(segments.length - 1, Math.max(0, Math.floor(km / 25)));
    return segments[idx];
}
function nextStation(stations, km) {
    for (const s of stations) {
        if (s.km > km)
            return s;
    }
    return null;
}
function generateWeatherFronts(world, rng, ticksPerHour) {
    const fronts = [];
    const kinds = [
        "pluie_diluvienne",
        "tempete_sable",
        "canicule",
        "froid_intense",
        "brouillard",
        "vent_fort",
        "grele",
    ];
    let id = 1;
    const totalTicks = (world.totalKm / exports.AVG_SPEED_KMH) * ticksPerHour;
    for (let t = 0; t < totalTicks; t += rng.int(3600, 14400)) {
        fronts.push({
            id: id++,
            kind: rng.pick(kinds),
            km: rng.range(0, world.totalKm),
            speedKmPerTick: rng.range(-0.02, 0.02),
            radiusKm: rng.range(30, 100),
            startTick: t,
            endTick: t + rng.int(3600, 14400),
        });
    }
    return fronts;
}
function weatherAt(fronts, tick, km) {
    for (const f of fronts) {
        if (tick >= f.startTick && tick <= f.endTick && Math.abs(f.km - km) <= f.radiusKm) {
            return f.kind;
        }
    }
    return "clair";
}
