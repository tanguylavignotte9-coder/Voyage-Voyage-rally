import { CarState, OrganId, TerrainSegment, World, WeatherFront, Station, StationWork, TICKS_PER_HOUR, TICKS_PER_SECOND, TRUCK_FIXED_HOURS } from "./types";
import {
  BASE_SPEED_KMH, PACE_SPEED_FACTOR, TERRAIN_SPEED_KMH, PACE_CONSUMPTION_FACTOR,
  FUEL_BASE_L_PER_100KM, FUEL_TERRAIN_FACTOR, RISK_CONSUMPTION_FACTOR, WEIGHT_SPEED_PENALTY_FULL,
  WEAR_PER_KM, WEAR_TERRAIN_FACTOR, WEAR_ORGAN_WEATHER, RISK_WEAR_FACTOR, RISK_SPEED_BONUS,
  FATIGUE_PER_HOUR, FATIGUE_NIGHT_FACTOR, FATIGUE_WEATHER_FACTOR, slopeConsumptionFactor,
  FATIGUE_RECOVERY_BIVOUC_PER_HOUR, FATIGUE_RECOVERY_HOTEL_PER_HOUR,
  BREAKDOWN_BASE_PER_HOUR, ACCIDENT_FATIGUE_PER_HOUR, DEBRIS_BASE_PER_HOUR, RISK_ACCIDENT_FACTOR,
  FUEL_PRICE_PER_LITRE, TIRE_PRICE, HOTEL_PRICE, REPAIR_PRICE_BASE, REPAIR_HOURS, ACCIDENT_FAULT_PENALTY,
  settingsEffects,
} from "./calibration";
import { segmentAt, nextStation, weatherAt } from "./world";
import { Rng } from "./rng";
import { GameVariables, tickPlanner, ActiveEffects } from "./planner";

export const TICK_SECONDS = 1 / 30;

export function darknessFactor(hourOfDay: number): number {
  if (hourOfDay >= 21 || hourOfDay < 5) return 1.0;
  if (hourOfDay >= 19) return (hourOfDay - 19) / 2;
  if (hourOfDay < 7) return (7 - hourOfDay) / 2;
  return 0;
}

export function computeSpeed(car: CarState, seg: TerrainSegment, weather: string, darkness: number): number {
  const eff = settingsEffects(car.settings);
  let v = BASE_SPEED_KMH * (PACE_SPEED_FACTOR[car.pace] ?? 0.85) * eff.power;
  const terrainV = TERRAIN_SPEED_KMH[seg.terrain] ?? 70;
  // la vitesse effective tend vers la limite du terrain, pas seulement multiplicative
  v = Math.min(v, terrainV * (1 + ((PACE_SPEED_FACTOR[car.pace] ?? 0.85) - 1) * 0.35) * RISK_SPEED_BONUS[car.risk]);
  if (seg.terrain === "dunes" || seg.terrain === "regs") v *= eff.speedSand;
  else v *= eff.speedHard;
  if (seg.terrain === "pierrier" || seg.terrain === "col") v *= eff.speedRocks;
  if (seg.slope > 0) v *= Math.max(0.5, 1 - seg.slope * 0.015);
  else if (seg.slope < -1) v *= 1.03;
  if (weather === "tempete_sable" || weather === "pluie_diluvienne") v *= 0.35;
  if (weather === "piste_endommagee") v *= 0.5;
  else if (weather === "brouillard" || weather === "grele" || weather === "vent_fort") v *= 0.55;
  else if (weather === "canicule" || weather === "froid_intense") v *= 0.85;
  v *= 1 - darkness * 0.3;
  if (car.fatigue > 70) v *= 1 - ((car.fatigue - 70) / 100) * 0.35;
  if (car.crevaison) v *= 0.5;
  v *= 1 - (car.fuel / car.fuelCapacity) * WEIGHT_SPEED_PENALTY_FULL;
  if (car.towedBy) v *= 0.7;
  return Math.max(0, v);
}

export interface SimContext {
  world: World;
  fronts: WeatherFront[];
  rng: Rng;
  tick: number;
  raceStartTick: number;
  started: boolean;
  hourOfDay: (tick: number) => number;
  allCars: CarState[];
  logGlobal: (text: string) => void;
}

export function buildVariables(car: CarState, ctx: SimContext): GameVariables {
  const seg = segmentAt(ctx.world.segments, car.positionKm);
  const next = nextStation(ctx.world.stations, car.positionKm);
  const weather = weatherAt(ctx.fronts, ctx.tick, car.positionKm);
  const criticalCount = Object.values(car.organs).filter((w) => w >= 80).length;
  const hour = ctx.hourOfDay(ctx.tick);
  const rivals = ctx.allCars.filter((c) => c.playerId !== car.playerId && !c.arrived && !c.forfait);
  let frontGap = Infinity;
  let behindGap = Infinity;
  for (const r of rivals) {
    const d = r.positionKm - car.positionKm;
    if (d >= 0 && d < frontGap) frontGap = d;
    if (d < 0 && -d < behindGap) behindGap = -d;
  }
  return {
    crevaison: car.crevaison,
    immobilisation: car.immobilized,
    nuit: darknessFactor(hour) > 0.3,
    en_station: car.stopped && !car.immobilized && car.sleeping <= 0,
    bivouac_en_cours: car.sleeping > 0,
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
    jour_de_course: Math.floor((ctx.tick - ctx.raceStartTick) / (24 * TICKS_PER_HOUR)) + 1,
    retard_avance: 0,
    distance_rival_devant: frontGap === Infinity ? 9999 : frontGap,
    distance_rival_derriere: behindGap === Infinity ? 9999 : behindGap,
    biome: seg.biome,
    typologie_terrain: seg.terrain,
  };
}

export interface TickResult {
  events: string[];
}

export function mental(car: CarState, tick: number, text: string): void {
  car.mentalLog.push({ tick, text });
  if (car.mentalLog.length > 200) car.mentalLog.shift();
}

export function pay(car: CarState, tick: number, label: string, amount: number): boolean {
  if (amount > car.budget) return false;
  car.budget -= amount;
  car.stats.depenses += amount;
  car.transactions.push({ tick, label, amount: -amount });
  return true;
}

export function grantPrime(car: CarState, tick: number, label: string, amount: number): void {
  car.budget += amount;
  car.stats.primes += amount;
  car.transactions.push({ tick, label, amount });
}

function tickCarInternal(car: CarState, ctx: SimContext, emit: (t: string) => void): void {
  if (car.arrived || car.forfait) return;

  const seg = segmentAt(ctx.world.segments, car.positionKm);
  const weather = weatherAt(ctx.fronts, ctx.tick, car.positionKm);
  const hour = ctx.hourOfDay(ctx.tick);
  const darkness = darknessFactor(hour);

  if (car.immobilized) {
    tickImmobilized(car, ctx, emit);
    return;
  }

  if (car.stopWork && car.stopUntilTick !== null) {
    if (ctx.tick >= car.stopUntilTick) {
      finishStationWork(car, ctx, emit);
    } else {
      car.speedKmh = 0;
      return;
    }
  }

  if (car.sleeping > 0) {
    car.sleeping -= TICK_SECONDS / 3600;
    const hotelish = car.sleepPlace === "hotel";
    const recovery = hotelish ? FATIGUE_RECOVERY_HOTEL_PER_HOUR : FATIGUE_RECOVERY_BIVOUC_PER_HOUR;
    car.fatigue = Math.max(0, car.fatigue - recovery * (TICK_SECONDS / 3600));
    car.speedKmh = 0;
    if (car.sleeping <= 0) {
      car.sleeping = 0;
      car.sleepPlace = null;
      mental(car, ctx.tick, hotelish ? "Nuit à l'hôtel, je suis comme neuf." : "Bivouac terminé, ça va mieux.");
    }
    return;
  }

  const vars = buildVariables(car, ctx);
  const { effects } = tickPlanner(car, vars);

  if (effects.pace) car.pace = effects.pace.level;
  if (effects.risk) car.risk = effects.risk.level;
  if (effects.overtaking) car.overtaking = effects.overtaking.level;
  car.defending = effects.defending;

  if (effects.callTruck && car.immobilized) {
    car.truckCalledTick = ctx.tick;
    mental(car, ctx.tick, "J'appelle le camion d'assistance… 6 h d'attente.");
    emit(`${car.playerId} appelle le camion d'assistance`);
  }

  if (effects.sleep && !car.immobilized) {
    const hotel = effects.sleep.place === "hotel";
    if (hotel) {
      const st = stationHere(ctx, car);
      if (st && st.hasHotel && pay(car, ctx.tick, "l'hôtel", HOTEL_PRICE)) {
        car.sleeping = effects.sleep.hours;
        car.sleepPlace = "hotel";
        emit(`${car.playerId} dort à l'hôtel (${effects.sleep.hours}h)`);
        return;
      }
      mental(car, ctx.tick, "Pas d'hôtel ici, je dormirai au bivouac.");
    }
    car.sleeping = effects.sleep.hours;
    car.sleepPlace = "bivouac";
    emit(`${car.playerId} fait bivouac (${effects.sleep.hours}h)`);
    return;
  }

  const station = stationHere(ctx, car);
  const wantsStation = !!(effects.fuelTarget || effects.repairOrgan || effects.replaceWheel || effects.stopAtStation);
  if (station && wantsStation) {
    if (startStationWork(car, ctx, station, effects, emit)) return;
  }

  const riskFactor = RISK_WEAR_FACTOR[car.risk];

  let speed = computeSpeed(car, seg, weather, darkness);
  speed = applyTrafficEffects(car, ctx, speed, riskFactor, emit);

  // Arrêt planifié: si des prestations sont demandées mais qu'on n'est pas encore à la station,
  // la voiture s'arrête à la station suivante (elle ne dépasse jamais la station visée).
  const nextSt = wantsStation ? nextStation(ctx.world.stations, car.positionKm) : null;
  if (nextSt && !car.stopWork) {
    const distanceToStation = nextSt.km - car.positionKm;
    if (distanceToStation <= (speed * TICK_SECONDS) / 3600) {
      car.positionKm = nextSt.km;
      car.speedKmh = 0;
      if (startStationWork(car, ctx, nextSt, effects, emit)) return;
    }
  }

  car.speedKmh = speed;
  const distanceDelta = (speed * TICK_SECONDS) / 3600;
  const prevPos = car.positionKm;
  car.positionKm = Math.min(ctx.world.totalKm, car.positionKm + distanceDelta);
  car.dailyKm += car.positionKm - prevPos;
  car.stats.distance += car.positionKm - prevPos;
  car.stats.maxSpeed = Math.max(car.stats.maxSpeed, speed);
  car.dailyMaxSpeed = Math.max(car.dailyMaxSpeed, speed);

  const eff = settingsEffects(car.settings);
  const consumptionPerKm =
    (FUEL_BASE_L_PER_100KM / 100) *
    PACE_CONSUMPTION_FACTOR[car.pace] *
    (FUEL_TERRAIN_FACTOR[seg.terrain] ?? 1.3) *
    RISK_CONSUMPTION_FACTOR[car.risk] *
    slopeConsumptionFactor(seg.slope) *
    eff.consumption;
  car.fuel = Math.max(0, car.fuel - consumptionPerKm * distanceDelta);

  const fatigueRate =
    FATIGUE_PER_HOUR[car.pace] *
    (1 + darkness * (FATIGUE_NIGHT_FACTOR - 1)) *
    (weather !== "clair" ? FATIGUE_WEATHER_FACTOR : 1);
  wearUpdate(car, seg, weather, riskFactor, distanceDelta, ctx, emit);
  car.fatigue = Math.min(100, car.fatigue + fatigueRate * (TICK_SECONDS / 3600));

  if (car.fatigue > 70 && ctx.tick % TICKS_PER_HOUR === 0) mental(car, ctx.tick, "Mes paupières sont lourdes…");
  if (car.fatigue > 85 && ctx.tick % (TICKS_PER_HOUR / 2) === 0) mental(car, ctx.tick, "Je lutte pour garder les yeux ouverts. C'est dangereux.");

  if (car.fuel <= 0) {
    car.immobilized = true;
    car.immobilizedReason = "panne sèche";
    car.speedKmh = 0;
    car.stats.pannes++;
    emit(`${car.playerId} : panne sèche !`);
    mental(car, ctx.tick, "Réservoir vide… j'aurais dû faire le plein.");
  }

  if (car.positionKm >= ctx.world.totalKm && !car.arrived) {
    car.arrived = true;
    car.arrivalTime = ctx.tick;
    car.speedKmh = 0;
    emit(`${car.playerId} est ARRIVÉ ! 🏁`);
  }
}

export function tickCar(car: CarState, ctx: SimContext): TickResult {
  const events: string[] = [];
  const emit = (t: string) => {
    events.push(t);
    ctx.logGlobal(t);
  };
  tickCarInternal(car, ctx, emit);
  return { events };
}

function stationHere(ctx: SimContext, car: CarState): Station | null {
  return ctx.world.stations.find((s) => Math.abs(s.km - car.positionKm) < 0.3) ?? null;
}

function startStationWork(
  car: CarState,
  ctx: SimContext,
  station: Station,
  effects: ActiveEffects,
  emit: (t: string) => void
): boolean {
  const work: StationWork = {
    stationKm: station.km,
    endsAtTick: 0,
    fuelTarget: effects.fuelTarget ? (effects.fuelTarget.percent / 100) * car.fuelCapacity : null,
    repairOrgan: effects.repairOrgan ? effects.repairOrgan.organ : null,
    replaceWheel: !!effects.replaceWheel,
    buyWheels: 0,
    hotel: false,
  };

  let hours = 0;
  if (work.fuelTarget !== null) {
    const litres = Math.max(0, work.fuelTarget - car.fuel);
    const afford = Math.min(car.budget / FUEL_PRICE_PER_LITRE, litres);
    if (afford < litres) mental(car, ctx.tick, "Budget serré… je ne peux pas faire le plein complet.");
    work.fuelTarget = car.fuel + afford;
    hours += (afford / car.fuelCapacity) * 0.25;
  }
  if (work.replaceWheel) {
    if (car.spareWheels <= 0) {
      if (pay(car, ctx.tick, "un pneu neuf", TIRE_PRICE)) car.spareWheels++;
      else {
        work.replaceWheel = false;
        mental(car, ctx.tick, "Pas de roue de secours, et pas de quoi en acheter une.");
      }
    }
    if (work.replaceWheel) hours += 0.5;
  }
  if (work.repairOrgan) {
    let organ: OrganId = work.repairOrgan;
    if (car.organs[organ] < 60) {
      const mostWorn = (Object.keys(car.organs) as OrganId[]).sort((a, b) => car.organs[b] - car.organs[a])[0];
      if (car.organs[mostWorn] > car.organs[organ]) organ = mostWorn;
      work.repairOrgan = organ;
    }
    const price = REPAIR_PRICE_BASE[organ] * (0.6 + (car.organs[organ] / 100) * 0.6);
    if (pay(car, ctx.tick, `la réparation ${organ}`, price)) {
      hours += REPAIR_HOURS[organ] * (0.4 + (car.organs[organ] / 100) * 0.6);
    } else {
      work.repairOrgan = null;
      mental(car, ctx.tick, "L'atelier a tout lu, mais je n'ai pas de quoi payer la réparation.");
    }
  }
  if (hours <= 0) return false;

  car.stopped = true;
  car.stopWork = work;
  car.stopUntilTick = ctx.tick + Math.max(TICKS_PER_SECOND, Math.round(hours * TICKS_PER_HOUR));
  work.endsAtTick = car.stopUntilTick;
  emit(
    `${car.playerId} s'arrête à ${station.name} — ravitaillement: ${work.fuelTarget !== null ? "oui" : "non"}, réparation: ${work.repairOrgan ?? "aucune"}, roue: ${work.replaceWheel ? "oui" : "non"}`
  );
  return true;
}

function finishStationWork(car: CarState, ctx: SimContext, emit: (t: string) => void): void {
  const work = car.stopWork;
  if (work) {
    if (work.fuelTarget !== null && work.fuelTarget > car.fuel) {
      car.fuel = work.fuelTarget;
    }
    if (work.replaceWheel && car.spareWheels > 0 && car.crevaison) {
      car.spareWheels--;
      car.crevaison = false;
      if (car.crevaisonOrgan) car.organs[car.crevaisonOrgan] = 10;
      car.crevaisonOrgan = null;
      emit(`${car.playerId} a changé sa roue.`);
    }
    if (work.repairOrgan) {
      car.organs[work.repairOrgan] = 5;
      emit(`${car.playerId} : ${work.repairOrgan} réparé.`);
    }
    mental(car, ctx.tick, "Diagnostic atelier complet effectué.");
    for (const o of Object.keys(car.organs) as OrganId[]) {
      if (car.organs[o] >= 60) mental(car, ctx.tick, `L'atelier dit : ${o} à ${car.organs[o].toFixed(0)}%.`);
    }
  }
  car.stopped = false;
  car.stopWork = null;
  car.stopUntilTick = null;
}

function tickImmobilized(car: CarState, ctx: SimContext, emit: (t: string) => void): void {
  car.fatigue = Math.max(0, car.fatigue - (FATIGUE_RECOVERY_BIVOUC_PER_HOUR / 2) * (TICK_SECONDS / 3600));
  const vars = buildVariables(car, ctx);
  const { effects } = tickPlanner(car, vars);
  if (effects.callTruck && car.truckCalledTick === null) {
    car.truckCalledTick = ctx.tick;
    mental(car, ctx.tick, "J'appelle le camion d'assistance… 6 h d'attente.");
    emit(`${car.playerId} appelle le camion d'assistance`);
  }
  if (car.truckCalledTick === null) return;
  const readyAt = car.truckCalledTick + TRUCK_FIXED_HOURS * TICKS_PER_HOUR;
  if (ctx.tick < readyAt) return;
  const station = nextStation(ctx.world.stations, car.positionKm);
  car.truckCalledTick = null;
  if (station) {
    car.positionKm = station.km;
    car.immobilized = false;
    car.immobilizedReason = null;
    car.immobilizedUntil = null;
    car.speedKmh = 0;
    car.stopped = true;
    car.stopUntilTick = ctx.tick + 300;
    car.stopWork = {
      stationKm: station.km,
      endsAtTick: car.stopUntilTick,
      fuelTarget: null,
      repairOrgan: null,
      replaceWheel: false,
      buyWheels: 0,
      hotel: false,
    };
    emit(`${car.playerId} : remorqué par le camion jusqu'à ${station.name}`);
  } else {
    car.immobilized = false;
    car.immobilizedReason = null;
  }
}

function applyTrafficEffects(
  car: CarState,
  ctx: SimContext,
  speed: number,
  riskFactor: number,
  emit: (t: string) => void
): number {
  let v = speed;
  const others = ctx.allCars.filter(
    (c) => c.playerId !== car.playerId && !c.arrived && !c.forfait && Math.abs(c.positionKm - car.positionKm) < 1.0
  );
  for (const other of others) {
    const gap = other.positionKm - car.positionKm;
    if (gap > 0.02 && gap < 0.3 && Math.abs(other.speedKmh - car.speedKmh) < 8) {
      v *= 1.03;
      mental(car, ctx.tick, "Je suis dans le sillage, ça glisse tout seul.");
    } else if (gap > 0 && gap < 0.15 && other.speedKmh < car.speedKmh * 0.9) {
      const seg = segmentAt(ctx.world.segments, car.positionKm);
      if (car.overtaking !== "interdit" && seg.width !== "etroite") {
        const riskBase = car.overtaking === "agressif" ? 0.15 : 0.05;
        const defended = other.defending ? 0.3 : 0;
        const p = (riskBase + defended) * TICK_SECONDS * (car.risk === "haut" ? 2 : car.risk === "bas" ? 0.3 : 1);
        if (ctx.rng.chance(p)) {
          car.stats.depassements++;
          emit(`${car.playerId} dépasse ${other.playerId} !`);
          v *= 1.05;
        } else if (ctx.rng.chance(p * 0.4)) {
          car.stats.accidents++;
          other.stats.accidents++;
          car.organs.chassis = Math.min(100, car.organs.chassis + 20);
          other.organs.chassis = Math.min(100, other.organs.chassis + 15);
          const atFault = car.overtaking === "agressif" || car.risk === "haut";
          const faultCar = atFault ? car : other;
          faultCar.budget -= ACCIDENT_FAULT_PENALTY;
          faultCar.stats.depenses += ACCIDENT_FAULT_PENALTY;
          faultCar.transactions.push({
            tick: ctx.tick,
            label: "pénalité direction de course (accrochage)",
            amount: -ACCIDENT_FAULT_PENALTY,
          });
          emit(
            `Accrochage entre ${car.playerId} et ${other.playerId} ! Direction de course : ${faultCar.playerId} en tort (-${ACCIDENT_FAULT_PENALTY}).`
          );
          mental(car, ctx.tick, "Ça a frotté… la Direction ne va pas aimer.");
        } else if (gap < 0.05) {
          v *= 0.9;
          car.fatigue = Math.min(100, car.fatigue + 0.01);
          mental(car, ctx.tick, "La poussière de celui de devant, je ne vois rien.");
        }
      } else if (seg.width === "etroite") {
        v = Math.min(v, other.speedKmh);
      }
    }
  }
  return v;
}

const SYMPTOMS: Record<OrganId, { vague: string; grave: string }> = {
  moteur: { vague: "Elle a du mal à reprendre, ça sent la surchauffe.", grave: "De la fumée… le moteur force terriblement." },
  transmission: { vague: "Des à-coups dans la boîte, pas net.", grave: "La boîte craque à chaque rapport." },
  pneus_av: { vague: "Je sens des vibrations dans le volant.", grave: "Les pneus avant chantent, ils sont à bout." },
  pneus_ar: { vague: "L'arrière bouge un peu trop dans les virages.", grave: "L'arrière est instable, ça va pas tenir." },
  suspensions: { vague: "Elle tape fort dans les bosses, la tenue de route se dégrade.", grave: "Les suspensions tapent le châssis, c'est dangereux." },
  chassis: { vague: "Des grincements partout, la caisse a pris du jeu.", grave: "Le châssis est tordu, les accélérations sont bridées." },
  freins: { vague: "Les freins mordent moins bien, il faut anticiper.", grave: "Les distances de freinage sont énormes." },
  refroidissement: { vague: "La température monte doucement, le radiateur doit être encrassé.", grave: "Elle surchauffe, le moteur est bridé." },
};

function wearUpdate(
  car: CarState,
  seg: TerrainSegment,
  weather: string,
  riskFactor: number,
  distanceDelta: number,
  ctx: SimContext,
  emit: (t: string) => void
): void {
  const terrainF = WEAR_TERRAIN_FACTOR[seg.terrain] ?? 1.3;
  const slopeF = seg.slope > 0 ? 1 + seg.slope * 0.04 : 1;
  const bump = (organ: OrganId, extra: number) => {
    const weatherF = (WEAR_ORGAN_WEATHER[organ] ?? {})[weather] ?? 1;
    const amount =
      WEAR_PER_KM[organ] * terrainF * weatherF * slopeF * riskFactor * extra * distanceDelta;
    const before = car.organs[organ];
    let next = car.organs[organ] + amount;
    if (car.crevaison && car.crevaisonOrgan === organ) next = Math.min(next, 90);
    car.organs[organ] = Math.min(100, next);
    if (before < 60 && car.organs[organ] >= 60) mental(car, ctx.tick, SYMPTOMS[organ].vague);
    if (before < 80 && car.organs[organ] >= 80) mental(car, ctx.tick, SYMPTOMS[organ].grave);
    if (car.organs[organ] >= 100) breakOrgan(car, organ, ctx, emit);
  };
  bump("moteur", 1);
  bump("transmission", 1);
  bump("pneus_av", 1);
  bump("pneus_ar", 1);
  bump("suspensions", 1);
  bump("chassis", 1);
  bump("freins", seg.slope < -0.02 ? 2.5 : 1);
  bump("refroidissement", 1);
  probabilisticFailure(car, ctx, emit);
}

function probabilisticFailure(car: CarState, ctx: SimContext, emit: (t: string) => void): void {
  const perHour = TICK_SECONDS / 3600;
  const riskAcc = RISK_ACCIDENT_FACTOR[car.risk];
  for (const [organ, wear] of Object.entries(car.organs) as [OrganId, number][]) {
    if (wear < 80) continue;
    const p = perHour * (wear - 80) * BREAKDOWN_BASE_PER_HOUR * 5 * riskAcc;
    if (ctx.rng.chance(p)) breakOrgan(car, organ, ctx, emit);
  }
  const accidentP = perHour * (car.fatigue > 70 ? (car.fatigue - 70) * ACCIDENT_FATIGUE_PER_HOUR : 0) * riskAcc;
  if (ctx.rng.chance(accidentP)) {
    car.stats.accidents++;
    car.organs.chassis = Math.min(100, car.organs.chassis + 30);
    if (car.organs.chassis >= 100) {
      car.immobilized = true;
      car.immobilizedReason = "accident";
      car.speedKmh = 0;
      emit(`${car.playerId} : accident grave (fatigue) — immobilisé !`);
      mental(car, ctx.tick, "Impossible… j'ai tapé. La voiture ne bougera pas sans secours.");
    } else {
      mental(car, ctx.tick, "Grosse frayeur, j'ai fait une tête-à-queue. La caisse a tapé.");
    }
  }
  const terrain = segmentAt(ctx.world.segments, car.positionKm).terrain;
  const terrainDebrisF = terrain === "pierrier" ? 3 : terrain === "regs" ? 2 : 1;
  const rockP = perHour * DEBRIS_BASE_PER_HOUR * terrainDebrisF * riskAcc;
  if (ctx.rng.chance(rockP)) {
    if (ctx.rng.chance(0.5)) {
      car.crevaison = true;
      car.crevaisonOrgan = ctx.rng.chance(0.5) ? "pneus_av" : "pneus_ar";
      car.organs[car.crevaisonOrgan] = Math.max(car.organs[car.crevaisonOrgan], 85);
      mental(car, ctx.tick, "Un caillou ! Je sens comme une crevaison…");
    } else {
      car.fatigue = Math.min(100, car.fatigue + 3);
      mental(car, ctx.tick, "Un animal sur la piste ! Je l'ai évité de justesse.");
    }
  }
}

function breakOrgan(car: CarState, organ: OrganId, ctx: SimContext, emit: (t: string) => void): void {
  if (organ === "pneus_av" || organ === "pneus_ar") {
    if (!car.crevaison) {
      car.crevaison = true;
      car.crevaisonOrgan = organ;
      car.organs[organ] = 90;
      mental(car, ctx.tick, "Éclatement ! Le pneu a explosé.");
      emit(`${car.playerId} : crevaison (${organ})`);
    }
    return;
  }
  car.immobilized = true;
  car.immobilizedReason = `casse ${organ}`;
  car.speedKmh = 0;
  car.organs[organ] = 100;
  car.stats.pannes++;
  mental(car, ctx.tick, `C'est fini, la ${organ} a lâché. Bord de piste, j'attends du secours.`);
  emit(`${car.playerId} : casse ${organ} — immobilisation`);
}
