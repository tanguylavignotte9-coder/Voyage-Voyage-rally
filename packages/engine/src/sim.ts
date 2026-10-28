import { CarState, OrganId, TerrainSegment, World, WeatherFront, Station, StationWork, TICKS_PER_HOUR, TICKS_PER_SECOND, TRUCK_FIXED_HOURS } from "./types";
import {
  CAR_MASS_KG, CAR_POWER_W, TRANSMISSION_EFF, ALTITUDE_POWER_LOSS, AERO_DRAG_COEFF, AIR_DENSITY, ROLLING_RES, LATERAL_GRIP,
  PACE_SPEED_FACTOR, PACE_CONSUMPTION_FACTOR,
  FUEL_BASE_L_PER_100KM, FUEL_TERRAIN_FACTOR, RISK_CONSUMPTION_FACTOR, WEIGHT_SPEED_PENALTY_FULL,
  RISK_SPEED_BONUS,
  FATIGUE_PER_HOUR, FATIGUE_NIGHT_FACTOR, FATIGUE_WEATHER_FACTOR, slopeConsumptionFactor,
  FATIGUE_RECOVERY_BIVOUC_PER_HOUR, FATIGUE_RECOVERY_HOTEL_PER_HOUR,
  ORGAN_MODELS, STRENGTH_SCATTER, WEATHER_STRESS, RISK_ACCIDENT_FACTOR,
  AERO_HALF, CONVERGENCE_DAMPING, CONVERGENCE_EPS, CONVERGENCE_EFF, CONVERGENCE_V_MIN, FUEL_TIME_H_PER_L,
  LOAD_SHOCK_GAIN, LOAD_BUMP_CR_GAIN, LOAD_BUMP_V_REF, LOAD_SUSP_OVER_STATIC,
  LOAD_TIRE_SHOCK_AV, LOAD_TIRE_SHOCK_AR, LOAD_TIRE_TRACTION_SHARE,
  LOAD_CHASSIS_STATIC_SHARE, LOAD_CHASSIS_SHOCK_SHARE, LOAD_ENGINE_NIGHT_EXTRA,
  LOAD_COOLANT_TRACTION_SHARE, LOAD_COOLANT_STRESS_N, LOAD_COOLANT_UPHILL, LOAD_UPHILL_REF_PERMILLE,
  LOAD_BRAKES_DOWNHILL_N, LOAD_BRAKES_STATIC_SHARE, LOAD_TRANSMISSION_OVER,
  VIGOR_LOSS_PER_FATIGUE, OVERTAKE_NIGHT_GRIP_LOSS, RAIN_GRIP_FACTOR, ACCIDENT_EXCESS_GAIN, ACCIDENT_GRAVITY_DIV, ACCIDENT_GRAVITY_RAND,
  ACCIDENT_DMG_BASE, ACCIDENT_DMG_RAND, DEBRIS_BASE_CHANCE, DEBRIS_DENSITY, DEBRIS_SPEED_REF,
  DEBRIS_RISK_FACTOR, DEBRIS_ANIMAL_FATIGUE,
  WEATHER_GRIP_EFFECT, WEATHER_POWER_EFFECT, DARING_BY_RISK, NIGHT_POWER_LOSS, NIGHT_AUDACITY_LOSS,
  FATIGUE_POWER_START, FATIGUE_POWER_RATE, FATIGUE_AUDACITY_RATE, CURVE_REF_RADIUS_M, CURVE_MIN_NORMALIZED,
  TOWING_SPEED_FACTOR, FUEL_DENSITY_KG_PER_L, WHEEL_DRIVE_EFF, GRAVITY,
  DRAFT_GAP_MIN_KM, DRAFT_GAP_MAX_KM, DRAFT_SPEED_DIFF, OVERTAKE_GAP_MAX_KM, OVERTAKE_RISK_BASE,
  DEFEND_EXTRA_RISK, OVERTAKE_COLLISION_SHARE, OVERTAKE_SPEED_GAIN, OVERTAKE_RISK_FACTOR,
  DUST_GAP_KM, DUST_SPEED_FACTOR, DUST_FATIGUE_PER_TICK,
  FUEL_TIME_PER_PERCENT, WHEEL_CHANGE_HOURS, REPAIR_TIME_MIN_SHARE, REPAIR_TIME_WEAR_SHARE,
  REPAIR_PRICE_MIN_SHARE, REPAIR_PRICE_WEAR_SHARE, ORGAN_CRITICAL_WEAR, ORGAN_WARN_WEAR, DIAG_ORGAN_MENTION,
  MENTAL_LOG_MAX, STATION_PROXIMITY_KM, FATIGUE_HEAVY_EYES, FATIGUE_DANGER,
  FUEL_PRICE_PER_LITRE, TIRE_PRICE, HOTEL_PRICE, REPAIR_PRICE_BASE, REPAIR_HOURS, ACCIDENT_FAULT_PENALTY,
  settingsEffects,
} from "./calibration";
import { segmentAt, nextStation, weatherAt, curvatureAt } from "./world";
import { Rng } from "./rng";
import { GameVariables, tickPlanner, ActiveEffects } from "./planner";

export const TICK_SECONDS = 1 / 30;

export function darknessFactor(hourOfDay: number): number {
  if (hourOfDay >= 21 || hourOfDay < 5) return 1.0;
  if (hourOfDay >= 19) return (hourOfDay - 19) / 2;
  if (hourOfDay < 7) return (7 - hourOfDay) / 2;
  return 0;
}

// Vitesse d'équilibre ÉMERGENTE: on cherche v tel que
//   P_dispo × efficacité(v) = F_roulement + F_aéro(v) + F_pente + marge_virage
// Le virage borne la vitesse par l'adhérence latérale: v_lat = sqrt(mu·g·r).
// La pente est une FORCE réelle (gravité), pas un malus arbitraire.
// Résolution par itérations rapides (12 passes suffisent).
export function computeSpeed(car: CarState, seg: TerrainSegment, weather: string, darkness: number, world?: World): number {
  const eff = settingsEffects(car.settings);
  // puissance motrice disponible (W) — allure + risque + carto
  // puissance à la roue: moteur × rendement transmission × altitude (le
  // moteur perd de la puissance en haute montagne — physique, pas un cap)
  const altLoss = 1 - ALTITUDE_POWER_LOSS * Math.min(1, Math.max(0, (seg.altitude - 200) / 3000));
  const powerW = CAR_POWER_W * TRANSMISSION_EFF * altLoss
    * (PACE_SPEED_FACTOR[car.pace] ?? 0.7)
    * (RISK_SPEED_BONUS[car.risk] ?? 1.0) * eff.power;
  // masse (carburant inclus)
  const mass = CAR_MASS_KG + car.fuel * FUEL_DENSITY_KG_PER_L;
  const g = GRAVITY;
  // forces d'environnement
  const cr = ROLLING_RES[seg.terrain] ?? 0.04;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  const slopeFrac = seg.slope / 1000; // ‰ -> fraction
  // virage: courbure moyenne signée autour de nous (fenêtre ±120 m)
  const curve = world ? curvatureAt(world, car.positionKm) : 0; // 0..1 (normalisée R=90m)
  const radius = curve > CURVE_MIN_NORMALIZED ? CURVE_REF_RADIUS_M / curve : Infinity;
  // vitesse limite en virage: v_max = sqrt(mu × g × r) × audace
  const daring = (DARING_BY_RISK as Record<string, number>)[car.risk] ?? 0.88;
  const vTurn = radius === Infinity ? Infinity : Math.sqrt(mu * g * Math.max(20, radius)) * daring;

  // conditions dégradantes (météo/nuit/fatigue/crevaison): agissent sur
  // l'ADHÉRENCE et la PUISSANCE — des effets physiques, pas des caps de vitesse
  let muEff = mu;
  let powerEff = powerW;
  muEff *= WEATHER_GRIP_EFFECT[weather] ?? 1.0;
  powerEff *= WEATHER_POWER_EFFECT[weather] ?? 1.0;
  // la nuit / la fatigue: on ne voit pas loin — on lève le pied même en ligne
  // droite ET on réduit l'audace en virage (comportement de pilote réel)
  powerEff *= 1 - darkness * NIGHT_POWER_LOSS;
  if (car.fatigue > FATIGUE_POWER_START) powerEff *= 1 - ((car.fatigue - FATIGUE_POWER_START) / 100) * FATIGUE_POWER_RATE;
  // la nuit on ne voit pas: on limite l'adhérence exploitée (audace)
  const daringEff = daring * (1 - darkness * NIGHT_AUDACITY_LOSS) * (car.fatigue > FATIGUE_POWER_START ? 1 - ((car.fatigue - FATIGUE_POWER_START) / 100) * FATIGUE_AUDACITY_RATE : 1);
  const vTurnEff = radius === Infinity ? Infinity : Math.sqrt(muEff * g * Math.max(20, radius)) * daringEff;
  if (car.crevaison) { /* roulage dégradé: roulement doublé */ }

  const crEff = car.crevaison ? cr * 2.2 : cr;
  const rollingF = crEff * mass * g;
  const slopeF = slopeFrac * mass * g; // positif = côte (oppose), négatif = descente (aide)
  const kAero = AERO_HALF * AIR_DENSITY * AERO_DRAG_COEFF;

  // MOTRICITÉ longitudinale: la force tractrice au sol est bornée par
  // l'adhérence (4 roues motrices: ~0.9 × mu × m × g). Sur piste meuble,
  // la voiture ne peut pas pousser plus fort que le sol ne le permet.
  const maxTractionF = WHEEL_DRIVE_EFF * muEff * mass * g;
  // itération de résolution: v = min(P/v, F_max) / (F_roll + F_slope + k·v²)
  let v = 20;
  for (let i = 0; i < 14; i++) {
    const fTotal = Math.max(50, rollingF + slopeF + kAero * v * v);
    const fTraction = Math.min(powerEff / v, maxTractionF); // force réelle au sol
    const vNext = (fTraction * v) / fTotal * CONVERGENCE_EFF + CONVERGENCE_V_MIN;
    v = v + (vNext - v) * CONVERGENCE_DAMPING;
    if (Math.abs(vNext - v) < CONVERGENCE_EPS) break;
  }
  // le virage borne par la physique (pas un cap arbitraire: c'est l'adhérence)
  if (vTurnEff < v) v = vTurnEff;
  // remorquage: force supplémentaire (on tire une autre auto)
  if (car.towedBy) v *= TOWING_SPEED_FACTOR;
  return Math.max(0, v * 3.6); // m/s -> km/h
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
  if (car.mentalLog.length > MENTAL_LOG_MAX) car.mentalLog.shift();
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

  // doc §5: sans règle d'allure active -> allure prudente (le fallback s'applique
  // à chaque tick, la voiture ne garde jamais une allure orpheline)
  car.pace = effects.pace ? effects.pace.level : "prudente";
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

  const riskFactor = 1; // le risque agit via l'audace physique (charges/accidents)

  let speed = computeSpeed(car, seg, weather, darkness, ctx.world);
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

  if (car.fatigue > FATIGUE_HEAVY_EYES && ctx.tick % TICKS_PER_HOUR === 0) mental(car, ctx.tick, "Mes paupières sont lourdes…");
  if (car.fatigue > FATIGUE_DANGER && ctx.tick % (TICKS_PER_HOUR / 2) === 0) mental(car, ctx.tick, "Je lutte pour garder les yeux ouverts. C'est dangereux.");

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
  return ctx.world.stations.find((s) => Math.abs(s.km - car.positionKm) < STATION_PROXIMITY_KM) ?? null;
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
    hours += afford * FUEL_TIME_H_PER_L;
  }
  if (work.replaceWheel) {
    if (car.spareWheels <= 0) {
      if (pay(car, ctx.tick, "un pneu neuf", TIRE_PRICE)) car.spareWheels++;
      else {
        work.replaceWheel = false;
        mental(car, ctx.tick, "Pas de roue de secours, et pas de quoi en acheter une.");
      }
    }
    if (work.replaceWheel) hours += WHEEL_CHANGE_HOURS;
  }
  if (work.repairOrgan) {
    let organ: OrganId = work.repairOrgan;
    if (car.organs[organ] < 60) {
      const mostWorn = (Object.keys(car.organs) as OrganId[]).sort((a, b) => car.organs[b] - car.organs[a])[0];
      if (car.organs[mostWorn] > car.organs[organ]) organ = mostWorn;
      work.repairOrgan = organ;
    }
    const price = REPAIR_PRICE_BASE[organ] * (REPAIR_PRICE_MIN_SHARE + (car.organs[organ] / 100) * REPAIR_PRICE_WEAR_SHARE);
    if (pay(car, ctx.tick, `la réparation ${organ}`, price)) {
      hours += REPAIR_HOURS[organ] * (REPAIR_TIME_MIN_SHARE + (car.organs[organ] / 100) * REPAIR_TIME_WEAR_SHARE);
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
      if (car.organs[o] >= DIAG_ORGAN_MENTION) mental(car, ctx.tick, `L'atelier dit : ${o} à ${car.organs[o].toFixed(0)}%.`);
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
    if (gap > DRAFT_GAP_MIN_KM && gap < DRAFT_GAP_MAX_KM && Math.abs(other.speedKmh - car.speedKmh) < DRAFT_SPEED_DIFF) {
      v *= 1.03;
      mental(car, ctx.tick, "Je suis dans le sillage, ça glisse tout seul.");
    } else if (gap > 0 && gap < OVERTAKE_GAP_MAX_KM && other.speedKmh < car.speedKmh * DUST_SPEED_FACTOR) {
      const seg = segmentAt(ctx.world.segments, car.positionKm);
      if (car.overtaking !== "interdit" && seg.width !== "etroite") {
        const riskBase = (OVERTAKE_RISK_BASE as Record<string, number>)[car.overtaking] ?? 0;
        const defended = other.defending ? DEFEND_EXTRA_RISK : 0;
        const p = (riskBase + defended) * TICK_SECONDS * ((OVERTAKE_RISK_FACTOR as Record<string, number>)[car.risk] ?? 1);
        if (ctx.rng.chance(p)) {
          car.stats.depassements++;
          emit(`${car.playerId} dépasse ${other.playerId} !`);
          v *= OVERTAKE_SPEED_GAIN;
        } else if (ctx.rng.chance(p * OVERTAKE_COLLISION_SHARE)) {
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
        } else if (gap < DUST_GAP_KM) {
          v *= DUST_SPEED_FACTOR;
          car.fatigue = Math.min(100, car.fatigue + DUST_FATIGUE_PER_TICK);
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

// ========== USURE ÉMERGENTE: les organes subissent les FORCES du tick ==========
// Chaque organe reçoit une contrainte (N) calculée depuis la physique du
// moment: traction, chocs du terrain (∝ vitesse² × rugosité), freinage en
// descente. L'usure suit la loi d'endommagement (contrainte/nominale)^expo —
// en douceur ça vieillit à peine, à 200 km/h sur pierrier ça explose.
// La PANNE est un ÉCHEC DE CHARGE: contrainte > résistance résiduelle
// (usure + dispersion matérielle) — un organe neuf encaisse, un usé cède.
function computeOrganLoads(car: CarState, seg: TerrainSegment, weather: string, darkness: number, v: number): Record<string, number> {
  const mass = CAR_MASS_KG + car.fuel * FUEL_DENSITY_KG_PER_L;
  const g = GRAVITY;
  const cr = ROLLING_RES[seg.terrain] ?? 0.04;
  const slopeFrac = seg.slope / 1000;
  const weatherStress = WEATHER_STRESS[weather] ?? 1.0;
  const vMs = v / 3.6;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  const fTraction = Math.min(
    CAR_POWER_W * TRANSMISSION_EFF * (PACE_SPEED_FACTOR[car.pace] ?? 0.7) / Math.max(5, vMs),
    0.9 * mu * mass * g
  );
  // charges calibrées pour un SUV de raid: la charge nominale représente
  // ~80% du pire cas réaliste — en usage normal on vit à 0.4-0.8×nominale,
  // les extrêmes (réception à 200 sur pierrier) dépassent 1×.
  // charges par organe (N): le poids statique se répartit (4 roues, 4 jambe
  // de suspension), le facteur de bosse et les chocs s'ajoutent en dynamique.
  // Une jambe voit ~m·g/4 statique; en raid elle encaisse le double en bosse.
  const statWheel = mass * g / 4;
  const bumpFactor = 1 + Math.min(1.6, cr * LOAD_BUMP_CR_GAIN) * Math.min(1, vMs / LOAD_BUMP_V_REF);
  const shock = mass * (vMs * vMs) * cr * LOAD_SHOCK_GAIN;
  return {
    moteur: fTraction * weatherStress * (1 + darkness * LOAD_ENGINE_NIGHT_EXTRA),
    transmission: fTraction * LOAD_TRANSMISSION_OVER * weatherStress,
    pneus_av: (statWheel * bumpFactor + shock * LOAD_TIRE_SHOCK_AV) * weatherStress,
    pneus_ar: (statWheel * bumpFactor + shock * LOAD_TIRE_SHOCK_AR + fTraction * LOAD_TIRE_TRACTION_SHARE) * weatherStress,
    suspensions: (statWheel * bumpFactor * LOAD_SUSP_OVER_STATIC + shock) * weatherStress,
    chassis: mass * g * LOAD_CHASSIS_STATIC_SHARE * bumpFactor + shock * LOAD_CHASSIS_SHOCK_SHARE,
    freins: slopeFrac < 0 ? Math.abs(slopeFrac) * mass * g * LOAD_BRAKES_DOWNHILL_N : mass * g * LOAD_BRAKES_STATIC_SHARE,
    refroidissement: (fTraction * LOAD_COOLANT_TRACTION_SHARE + (weatherStress - 1) * LOAD_COOLANT_STRESS_N) * (seg.slope > LOAD_UPHILL_REF_PERMILLE ? LOAD_COOLANT_UPHILL : 1),
  };
}

function wearUpdate(
  car: CarState,
  seg: TerrainSegment,
  weather: string,
  riskFactor: number,
  distanceDelta: number,
  ctx: SimContext,
  emit: (t: string) => void
): void {
  const v = car.speedKmh;
  const darkness = darknessFactor(ctx.hourOfDay(ctx.tick));
  const loads = computeOrganLoads(car, seg, weather, darkness, v);
  const dtH = TICK_SECONDS / 3600;
  for (const organ of Object.keys(car.organs) as OrganId[]) {
    const model = ORGAN_MODELS[organ];
    if (!model) continue;
    const load = loads[organ] ?? 0;
    const ratio = load / model.nominalLoadN;
    // loi d'endommagement: sous 0.5 de charge nominale, usure négligeable;
    // au-dessus de 1, elle explose
    const damage = model.damagePerHourAtNominal * Math.pow(ratio, model.expo) * dtH;
    const before = car.organs[organ];
    let next = before + damage;
    if (car.crevaison && car.crevaisonOrgan === organ) next = Math.min(next, 90);
    car.organs[organ] = Math.min(100, next);
    if (before < ORGAN_WARN_WEAR && car.organs[organ] >= ORGAN_WARN_WEAR) mental(car, ctx.tick, SYMPTOMS[organ].vague);
    if (before < ORGAN_CRITICAL_WEAR && car.organs[organ] >= ORGAN_CRITICAL_WEAR) mental(car, ctx.tick, SYMPTOMS[organ].grave);

    // PANNE = ÉCHEC DE CHARGE (résistance résiduelle × dispersion matérielle)
    // un organe déjà cassé (usure 100) ne re-déclenche pas la panne en boucle:
    // la voiture est immobilisée, l'organe est mort.
    if (car.organs[organ] < 99.5 && !car.immobilized) {
      const strength = (1 - car.organs[organ] / 100) * model.nominalLoadN;
      const scatter = 1 + (ctx.rng.next() - 0.5) * 2 * STRENGTH_SCATTER;
      if (load > strength * scatter) {
        breakOrgan(car, organ, ctx, emit);
      }
    }
  }
  probabilisticFailure(car, ctx, emit);
}

// ACCIDENT ÉMERGENT: la demande latérale (v²/r) comparée à l'adhérence
// disponible (μ_eff, dégradé par fatigue/nuit/météo). En dépassement, la
// voiture part — probabilité proportionnelle à l'excès, pas un seuil binaire.
function probabilisticFailure(car: CarState, ctx: SimContext, emit: (t: string) => void): void {
  const seg = segmentAt(ctx.world.segments, car.positionKm);
  const weather = weatherAt(ctx.fronts, ctx.tick, car.positionKm);
  const darkness = darknessFactor(ctx.hourOfDay(ctx.tick));
  const curve = curvatureAt(ctx.world, car.positionKm);
  const radius = curve > CURVE_MIN_NORMALIZED ? CURVE_REF_RADIUS_M / curve : Infinity;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  // adhérence effective: fatigue (vigilance) + nuit + météo la dégradent — CONTINU
  const vigueur = 1 - car.fatigue * VIGOR_LOSS_PER_FATIGUE;
  const muEff = mu * vigueur * (1 - darkness * OVERTAKE_NIGHT_GRIP_LOSS) * (weather === "pluie_diluvienne" || weather === "tempete_sable" ? RAIN_GRIP_FACTOR : 1);
  const vMs = car.speedKmh / 3.6;
  // demande latérale vs capacité: l'excès est le moteur de l'accident
  if (radius !== Infinity && car.speedKmh > 3) {
    const demand = (vMs * vMs) / radius;
    const capacity = muEff * 9.81;
    const excess = (demand / capacity - 1) * RISK_ACCIDENT_FACTOR[car.risk];
    if (excess > 0) {
      const pPerTick = Math.min(0.5, excess * excess * ACCIDENT_EXCESS_GAIN);
      if (ctx.rng.chance(pPerTick)) {
        car.stats.accidents++;
        const gravite = Math.min(1, excess / ACCIDENT_GRAVITY_DIV + ctx.rng.next() * ACCIDENT_GRAVITY_RAND);
        const dommage = gravite * (ACCIDENT_DMG_BASE + ctx.rng.next() * ACCIDENT_DMG_RAND);
        car.organs.chassis = Math.min(100, car.organs.chassis + dommage);
        if (car.organs.chassis >= 100) {
          car.immobilized = true;
          car.immobilizedReason = "accident";
          car.speedKmh = 0;
          emit(`${car.playerId} : accident grave (sortie de piste) — immobilisé !`);
          mental(car, ctx.tick, "Impossible… je suis sorti. La voiture ne bougera pas sans secours.");
        } else {
          emit(`${car.playerId} : sortie de piste évitée de justesse (caisse touchée)`);
          mental(car, ctx.tick, "Grosse frayeur, j'ai fait une tête-à-queue. La caisse a tapé.");
        }
      }
    }
  }
  // DÉBRIS: risque émergé = densité du terrain × vitesse (à 200 km/h sur
  // pierrier, on en percute beaucoup plus qu'à 30 en steppe)
  const debrisDensity = (DEBRIS_DENSITY as Record<string, number>)[seg.terrain] ?? DEBRIS_DENSITY.defaut;
  const rockP = (TICK_SECONDS / 3600) * debrisDensity * (vMs / DEBRIS_SPEED_REF) * ((DEBRIS_RISK_FACTOR as Record<string, number>)[car.risk] ?? 1);
  if (ctx.rng.chance(rockP * DEBRIS_BASE_CHANCE)) {
    if (ctx.rng.chance(0.5)) {
      car.crevaison = true;
      car.crevaisonOrgan = ctx.rng.chance(0.5) ? "pneus_av" : "pneus_ar";
      car.organs[car.crevaisonOrgan] = Math.max(car.organs[car.crevaisonOrgan], 85);
      mental(car, ctx.tick, "Un caillou ! Je sens comme une crevaison…");
    } else {
      car.fatigue = Math.min(100, car.fatigue + DEBRIS_ANIMAL_FATIGUE + vMs / DEBRIS_SPEED_REF * DEBRIS_ANIMAL_FATIGUE);
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
