"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Race = void 0;
const world_1 = require("./world");
const rng_1 = require("./rng");
const sim_1 = require("./sim");
const types_1 = require("./types");
class Race {
    constructor(params) {
        this.cars = [];
        this.players = [];
        this.tick = 0;
        this.raceStartTick = 0;
        this.paused = false;
        this.finished = false;
        this.events = [];
        this.params = params;
        const seed = (0, rng_1.seedFromString)(params.seedText);
        this.rng = new rng_1.Rng(seed);
        this.world = (0, world_1.generateWorld)({ seed, targetHours: params.targetHours, biomeWeights: params.biomeWeights });
        this.fronts = (0, world_1.generateWeatherFronts)(this.world, this.rng, sim_1.TICKS_PER_HOUR);
        this.raceStartTick = 0;
    }
    hourOfDay(tick) {
        const startHour = 8;
        return (startHour + tick / 3600) % 24;
    }
    addPlayer(id, pseudo, color, isAdmin = false) {
        this.players.push({ id, pseudo, color, isAdmin });
        this.cars.push({
            playerId: id,
            color,
            positionKm: 0,
            fuel: 60,
            fuelCapacity: 60,
            organs: {
                moteur: 0, transmission: 0, pneus_av: 0, pneus_ar: 0,
                suspensions: 0, chassis: 0, freins: 0, refroidissement: 0,
            },
            fatigue: 0,
            speedKmh: 0,
            pace: "prudente",
            risk: "normal",
            rules: JSON.parse(JSON.stringify(types_1.DEFAULT_RULES)),
            settings: { tirePressure: 50, groundClearance: 50, engineMap: 50, startFuel: 60 },
            spareWheels: 1,
            budget: 1000,
            arrived: false,
            arrivalTime: null,
            finisherRank: null,
            forfait: false,
            allowAssist: true,
            immobilized: false,
            immobilizedReason: null,
            immobilizedUntil: null,
            crevaison: false,
            sleeping: 0,
            stopped: false,
            overtaking: "prudent",
            defending: false,
            offsetSeconds: 0,
        });
    }
    start() {
        const order = [...this.cars];
        for (let i = 0; i < order.length; i++) {
            order[i].offsetSeconds = i * this.params.startIntervalSeconds;
        }
        this.raceStartTick = this.tick;
    }
    ctxFor() {
        return {
            world: this.world,
            fronts: this.fronts,
            rng: this.rng,
            tick: this.tick,
            raceStartTick: this.raceStartTick,
            hourOfDay: (t) => this.hourOfDay(t),
            allCars: this.cars,
        };
    }
    step() {
        if (this.paused)
            return [];
        this.tick++;
        const allEvents = [];
        const ctx = this.ctxFor();
        const started = this.tick > this.raceStartTick;
        if (!started)
            return [];
        for (const car of this.cars) {
            if (this.tick - this.raceStartTick < car.offsetSeconds)
                continue;
            const res = (0, sim_1.tickCar)(car, ctx);
            for (const e of res.events) {
                allEvents.push(e);
                this.events.push({ tick: this.tick, text: e });
            }
        }
        return allEvents;
    }
    standings() {
        const compensed = [...this.cars].sort((a, b) => {
            const aT = a.arrived ? (a.arrivalTime ?? 0) - a.offsetSeconds : Infinity;
            const bT = b.arrived ? (b.arrivalTime ?? 0) - b.offsetSeconds : Infinity;
            if (a.arrived && b.arrived)
                return aT - bT;
            if (a.arrived)
                return -1;
            if (b.arrived)
                return 1;
            return b.positionKm - a.positionKm;
        });
        return compensed;
    }
}
exports.Race = Race;
