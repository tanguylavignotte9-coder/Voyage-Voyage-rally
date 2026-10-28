import { CarState, World, WeatherFront } from "./types";
import { generateWorld, generateWeatherFronts } from "./world";
import { Rng, seedFromString } from "./rng";
import { tickCar, TICKS_PER_HOUR, SimContext } from "./sim";
import { DEFAULT_RULES } from "./types";

export interface RaceParams {
  seedText: string;
  targetHours: number;
  startIntervalSeconds: number;
  programWindowMinutes: number;
  closureDelayHours: number;
  biomeWeights?: Partial<Record<string, number>>;
}

export interface PlayerInfo {
  id: string;
  pseudo: string;
  color: string;
  isAdmin: boolean;
}

export class Race {
  world: World;
  fronts: WeatherFront[];
  cars: CarState[] = [];
  players: PlayerInfo[] = [];
  rng: Rng;
  tick = 0;
  raceStartTick = 0;
  paused = false;
  finished = false;
  events: { tick: number; text: string }[] = [];
  params: RaceParams;

  constructor(params: RaceParams) {
    this.params = params;
    const seed = seedFromString(params.seedText);
    this.rng = new Rng(seed);
    this.world = generateWorld({ seed, targetHours: params.targetHours, biomeWeights: params.biomeWeights as any });
    this.fronts = generateWeatherFronts(this.world, this.rng, TICKS_PER_HOUR);
    this.raceStartTick = 0;
  }

  hourOfDay(tick: number): number {
    const startHour = 8;
    return (startHour + tick / 3600) % 24;
  }

  addPlayer(id: string, pseudo: string, color: string, isAdmin = false): void {
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
      rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
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

  start(): void {
    const order = [...this.cars];
    for (let i = 0; i < order.length; i++) {
      order[i].offsetSeconds = i * this.params.startIntervalSeconds;
    }
    this.raceStartTick = this.tick;
  }

  ctxFor(): SimContext {
    return {
      world: this.world,
      fronts: this.fronts,
      rng: this.rng,
      tick: this.tick,
      raceStartTick: this.raceStartTick,
      hourOfDay: (t) => this.hourOfDay(t),
      allCars: this.cars,
    } as SimContext;
  }

  step(): string[] {
    if (this.paused) return [];
    this.tick++;
    const allEvents: string[] = [];
    const ctx = this.ctxFor();
    const started = this.tick > this.raceStartTick;
    if (!started) return [];
    for (const car of this.cars) {
      if (this.tick - this.raceStartTick < car.offsetSeconds) continue;
      const res = tickCar(car, ctx);
      for (const e of res.events) {
        allEvents.push(e);
        this.events.push({ tick: this.tick, text: e });
      }
    }
    return allEvents;
  }

  standings(): CarState[] {
    const compensed = [...this.cars].sort((a, b) => {
      const aT = a.arrived ? (a.arrivalTime ?? 0) - a.offsetSeconds : Infinity;
      const bT = b.arrived ? (b.arrivalTime ?? 0) - b.offsetSeconds : Infinity;
      if (a.arrived && b.arrived) return aT - bT;
      if (a.arrived) return -1;
      if (b.arrived) return 1;
      return b.positionKm - a.positionKm;
    });
    return compensed;
  }
}
