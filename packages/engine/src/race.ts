import { DEFAULT_RULES, CarState, World, WeatherFront, PlayerRule, TICKS_PER_HOUR, TICKS_PER_SECOND, FUEL_CAPACITY_L, BUDGET_START } from "./types";
import { DAILY_PRIME_BASE, DAILY_PRIME_RANK_BONUS, CHALLENGE_PRIME } from "./calibration";
import { generateWorld, generateWeatherFronts } from "./world";
import { Rng, seedFromString } from "./rng";
import { tickCar, SimContext, grantPrime, mental } from "./sim";

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
  muted?: boolean;
}

export interface DailyChallengeResult {
  day: number;
  vitesseMax: { playerId: string; value: number } | null;
  distanceJour: { playerId: string; value: number } | null;
  leader: { playerId: string; value: number } | null;
}

export const PRIME_HOUR = 12;

export class Race {
  world: World;
  fronts: WeatherFront[];
  cars: CarState[] = [];
  players: PlayerInfo[] = [];
  rng: Rng;
  tick = 0;
  raceStartTick = 0;
  started = false;
  paused = false;
  finished = false;
  events: { tick: number; text: string }[] = [];
  params: RaceParams;
  lastPrimeDay = 0;
  challengeResults: DailyChallengeResult[] = [];
  finishers: string[] = [];
  closureAtTick: number | null = null;

  constructor(params: RaceParams) {
    this.params = params;
    const seed = seedFromString(params.seedText);
    this.rng = new Rng(seed);
    this.world = generateWorld({ seed, targetHours: params.targetHours, biomeWeights: params.biomeWeights as any });
    this.fronts = generateWeatherFronts(this.world, this.rng, TICKS_PER_HOUR);
  }

  hourOfDay(tick: number): number {
    const startHour = 8;
    return (startHour + (tick - this.raceStartTick) / TICKS_PER_HOUR) % 24;
  }

  addPlayer(id: string, pseudo: string, color: string, isAdmin = false): void {
    this.players.push({ id, pseudo, color, isAdmin });
    this.cars.push({
      playerId: id,
      color,
      positionKm: 0,
      fuel: FUEL_CAPACITY_L,
      fuelCapacity: FUEL_CAPACITY_L,
      organs: {
        moteur: 0, transmission: 0, pneus_av: 0, pneus_ar: 0,
        suspensions: 0, chassis: 0, freins: 0, refroidissement: 0,
      },
      fatigue: 0,
      speedKmh: 0,
      pace: "prudente",
      risk: "normal",
      rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
      settings: { tirePressure: 50, groundClearance: 50, engineMap: 50, startFuel: FUEL_CAPACITY_L },
      spareWheels: 1,
      budget: BUDGET_START,
      arrived: false,
      arrivalTime: null,
      finisherRank: null,
      forfait: false,
      allowAssist: true,
      immobilized: false,
      immobilizedReason: null,
      immobilizedUntil: null,
      truckCalledTick: null,
      crevaison: false,
      crevaisonOrgan: null,
      sleeping: 0,
      sleepPlace: null,
      stopped: false,
      stopUntilTick: null,
      stopWork: null,
      overtaking: "prudent",
      defending: false,
      offsetSeconds: 0,
      lateral: 0,
      maneuver: null,
      noPassUntilTick: 0,
      dustTick: 0,
      gear: 1,
      rpm: 900,
      throttle: 0,
      brake: 0,
      dailyKm: 0,
      dayStartTick: 0,
      dailyMaxSpeed: 0,
      mentalLog: [],
      towedBy: null,
      transactions: [],
      stats: { distance: 0, maxSpeed: 0, pannes: 0, depenses: 0, primes: 0, accidents: 0, depassements: 0 },
    });
  }

  start(): void {
    this.started = true;
    const order = [...this.cars];
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < order.length; i++) {
      order[i].offsetSeconds = i * this.params.startIntervalSeconds;
    }
    this.raceStartTick = this.tick;
    this.log(`Départ donné ! ${order.length} voitures, ordre tiré au sort.`);
  }

  log(text: string): void {
    this.events.push({ tick: this.tick, text });
    if (this.events.length > 2000) this.events.shift();
  }

  ctxFor(): SimContext {
    return {
      world: this.world,
      fronts: this.fronts,
      rng: this.rng,
      tick: this.tick,
      raceStartTick: this.raceStartTick,
      started: this.started,
      hourOfDay: (t) => this.hourOfDay(t),
      allCars: this.cars,
      logGlobal: (t) => this.log(t),
    };
  }

  step(): string[] {
    if (this.paused || !this.started) return [];
    this.tick++;
    const ctx = this.ctxFor();
    for (const car of this.cars) {
      // offsetSeconds est en SECONDES réelles: à 30 ticks/s, 60 s demandées
      // valent 1800 ticks — l'ancienne comparaison directe ticks vs secondes
      // faisait partir le peloton en 2 s au lieu de l'échelonnement voulu
      // (mesuré: 10 voitures parties en 18 s avec startIntervalSeconds 60).
      if ((this.tick - this.raceStartTick) / TICKS_PER_SECOND < car.offsetSeconds) continue;
      tickCar(car, ctx);
    }
    // MÉTÉO VIVANTE: les fronts avancent le long de la route (speedKmPerTick
    // en km/tick, ±5-40 km/h). Wrap aux extrémités de l'itinéraire: un front
    // qui sortit d'un côté ressort de l'autre — déterministe, pas de disparition.
    for (const f of this.fronts) {
      if (f.speedKmPerTick === 0) continue; // pistes endommagées = terrain fixe
      f.km += f.speedKmPerTick;
      if (f.km < 0) f.km += this.world.totalKm;
      else if (f.km > this.world.totalKm) f.km -= this.world.totalKm;
    }
    this.tickDaily();
    this.tickTowing();
    this.checkFinish();
    return [];
  }

  private tickDaily(): void {
    const day = Math.floor((this.tick - this.raceStartTick) / (24 * TICKS_PER_HOUR)) + 1;
    const hour = this.hourOfDay(this.tick);
    if (day > this.lastPrimeDay && hour >= PRIME_HOUR % 24) {
      this.lastPrimeDay = day;
      this.awardDaily(day);
    }
    if (day > (this as any)._statDay || (this as any)._statDay === undefined) {
      for (const c of this.cars) {
        if (day !== (this as any)._statDay) {
          c.dailyKm = 0;
          c.dailyMaxSpeed = 0;
          c.dayStartTick = this.tick;
        }
      }
      (this as any)._statDay = day;
    }
  }

  private awardDaily(day: number): void {
    const ranked = this.standings();
    const active = ranked.filter((c) => !c.forfait);
    const result: DailyChallengeResult = { day, vitesseMax: null, distanceJour: null, leader: null };
    const results: { playerId: string; value: number }[] = [];
    for (let i = 0; i < active.length; i++) {
      const car = active[i];
      const rank = i + 1;
      const prime = DAILY_PRIME_BASE + Math.max(0, active.length - rank) * DAILY_PRIME_RANK_BONUS / Math.max(1, active.length - 1);
      grantPrime(car, this.tick, `prime journalière (jour ${day}, rang ${rank})`, Math.round(prime));
      results.push({ playerId: car.playerId, value: car.dailyKm });
    }
    const bySpeed = [...active].sort((a, b) => b.dailyMaxSpeed - a.dailyMaxSpeed);
    if (bySpeed[0] && bySpeed[0].dailyMaxSpeed > 0) {
      grantPrime(bySpeed[0], this.tick, `challenge vitesse max (jour ${day})`, CHALLENGE_PRIME);
      result.vitesseMax = { playerId: bySpeed[0].playerId, value: bySpeed[0].dailyMaxSpeed };
      this.log(`Challenge vitesse max (jour ${day}) : ${this.pseudoOf(bySpeed[0].playerId)} (${bySpeed[0].dailyMaxSpeed.toFixed(0)} km/h) +${CHALLENGE_PRIME}`);
    }
    const byDist = [...active].sort((a, b) => b.dailyKm - a.dailyKm);
    if (byDist[0] && byDist[0].dailyKm > 0) {
      grantPrime(byDist[0], this.tick, `challenge distance (jour ${day})`, CHALLENGE_PRIME);
      result.distanceJour = { playerId: byDist[0].playerId, value: byDist[0].dailyKm };
      this.log(`Challenge distance du jour ${day} : ${this.pseudoOf(byDist[0].playerId)} (${byDist[0].dailyKm.toFixed(0)} km) +${CHALLENGE_PRIME}`);
    }
    if (active[0]) {
      grantPrime(active[0], this.tick, `challenge leader (jour ${day})`, CHALLENGE_PRIME);
      result.leader = { playerId: active[0].playerId, value: active[0].positionKm };
      this.log(`Challenge leader (jour ${day}) : ${this.pseudoOf(active[0].playerId)} +${CHALLENGE_PRIME}`);
    }
    this.challengeResults.push(result);
    this.log(`Primes journalières versées (jour ${day}).`);
  }

  pseudoOf(id: string): string {
    return this.players.find((p) => p.id === id)?.pseudo ?? id;
  }

  private tickTowing(): void {
    for (const car of this.cars) {
      if (car.towedBy) {
        const tower = this.cars.find((c) => c.playerId === car.towedBy);
        if (!tower || tower.arrived || tower.forfait || Math.abs(tower.positionKm - car.positionKm) > 2) {
          car.towedBy = null;
          continue;
        }
        const station = this.world.stations.find((s) => s.km > car.positionKm);
        if (station) {
          const speed = (Math.min(tower.speedKmh, 25) * (1 / 30)) / 3600;
          car.positionKm = Math.min(station.km, car.positionKm + speed);
          tower.positionKm = Math.min(station.km, tower.positionKm + speed);
          if (car.positionKm >= station.km) {
            car.towedBy = null;
            car.immobilized = false;
            car.immobilizedReason = null;
            car.speedKmh = 0;
            this.log(`${this.pseudoOf(car.playerId)} remorqué par ${this.pseudoOf(tower.playerId)} jusqu'à ${station.name}`);
            mental(car, this.tick, `Merci ${this.pseudoOf(tower.playerId)}, je te revaudrai ça.`);
          }
        }
      }
    }
  }

  assistTow(helperId: string, targetId: string): boolean {
    const helper = this.cars.find((c) => c.playerId === helperId);
    const target = this.cars.find((c) => c.playerId === targetId);
    if (!helper || !target) return false;
    if (!target.allowAssist || target.arrived || target.forfait || helper.arrived || helper.forfait) return false;
    if (!target.immobilized) return false;
    if (Math.abs(helper.positionKm - target.positionKm) > 0.5) return false;
    if (helper.speedKmh > 1) return false;
    target.towedBy = helperId;
    this.log(`${this.pseudoOf(helperId)} remorque ${this.pseudoOf(targetId)}`);
    return true;
  }

  transferFuel(fromId: string, toId: string, litres: number): boolean {
    const from = this.cars.find((c) => c.playerId === fromId);
    const to = this.cars.find((c) => c.playerId === toId);
    if (!from || !to) return false;
    if (!to.allowAssist || from.arrived || to.arrived || from.forfait || to.forfait) return false;
    if (Math.abs(from.positionKm - to.positionKm) > 0.5) return false;
    if (from.speedKmh > 1 || to.speedKmh > 1) return false;
    const amount = Math.min(litres, from.fuel, to.fuelCapacity - to.fuel);
    if (amount <= 0) return false;
    from.fuel -= amount;
    to.fuel += amount;
    this.log(`${this.pseudoOf(fromId)} transfère ${amount.toFixed(0)} L à ${this.pseudoOf(toId)}`);
    return true;
  }

  repairTogether(aId: string, bId: string): boolean {
    const a = this.cars.find((c) => c.playerId === aId);
    if (!a) return false;
    if (a.stopWork && a.stopUntilTick) {
      const remaining = a.stopUntilTick - this.tick;
      const saved = Math.round(remaining * (1 - 1 / 1.5));
      a.stopUntilTick -= saved;
      a.stopWork.endsAtTick = a.stopUntilTick;
      this.log(`${this.pseudoOf(bId)} aide ${this.pseudoOf(aId)} : réparation accélérée (×1,5)`);
      return true;
    }
    return false;
  }

  declareForfait(playerId: string): boolean {
    const car = this.cars.find((c) => c.playerId === playerId);
    if (!car || car.forfait || car.arrived) return false;
    car.forfait = true;
    car.speedKmh = 0;
    car.immobilized = true;
    car.immobilizedReason = "abandon";
    this.log(`${this.pseudoOf(playerId)} déclare forfait — spectateur.`);
    return true;
  }

  callTruck(playerId: string): boolean {
    const car = this.cars.find((c) => c.playerId === playerId);
    if (!car || !car.immobilized || car.truckCalledTick !== null) return false;
    car.truckCalledTick = this.tick;
    this.log(`${this.pseudoOf(playerId)} appelle le camion d'assistance (6 h)`);
    return true;
  }

  private checkFinish(): void {
    if (!this.started || this.finished) return;
    for (const car of this.cars) {
      if (car.arrived && car.finisherRank === null) {
        car.finisherRank = this.finishers.length + 1;
        this.finishers.push(car.playerId);
      }
    }
    const allDone = this.cars.every((c) => c.arrived || c.forfait);
    if (allDone && this.cars.length > 0 && this.closureAtTick === null) {
      this.closureAtTick = this.tick + this.params.closureDelayHours * TICKS_PER_HOUR;
      this.log(`Tous les participants sont arrivés ou forfait. Clôture dans ${this.params.closureDelayHours} h.`);
    }
    if (this.closureAtTick !== null && this.tick >= this.closureAtTick) {
      this.finished = true;
      this.log("Course terminée. Consultez les résultats !");
    }
  }

  standings(): CarState[] {
    return [...this.cars].sort((a, b) => {
      // compensation du handicap de départ en TICKS (offsetSeconds est en s)
      const aT = a.arrived ? (a.arrivalTime ?? 0) - a.offsetSeconds * TICKS_PER_SECOND : Infinity;
      const bT = b.arrived ? (b.arrivalTime ?? 0) - b.offsetSeconds * TICKS_PER_SECOND : Infinity;
      if (a.arrived && b.arrived) return aT - bT;
      if (a.arrived) return -1;
      if (b.arrived) return 1;
      return b.positionKm - a.positionKm;
    });
  }

  updateRules(playerId: string, rules: PlayerRule[]): void {
    const car = this.cars.find((c) => c.playerId === playerId);
    if (car) car.rules = rules;
  }
}
