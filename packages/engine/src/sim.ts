import { CarState, OrganId, TerrainSegment, World, WeatherFront, Station, StationWork, TICKS_PER_HOUR, TICKS_PER_SECOND, TRUCK_FIXED_HOURS } from "./types";
import {
  // NB (patch 7): CAR_POWER_W ("330 ch") retiré — calculé mais JAMAIS lu, code
  // mort n°2; la vraie puissance passe par torqueCurve × ENGINE_MAX_TORQUE_NM.
  CAR_MASS_KG, TRANSMISSION_EFF, ALTITUDE_POWER_LOSS, AERO_DRAG_COEFF, AIR_DENSITY, ROLLING_RES, LATERAL_GRIP,
  PACE_SPEED_FACTOR, PACE_CONSUMPTION_FACTOR,
  FUEL_BASE_L_PER_100KM, FUEL_TERRAIN_FACTOR, RISK_CONSUMPTION_FACTOR, WEIGHT_SPEED_PENALTY_FULL,
  RISK_SPEED_BONUS,
  FATIGUE_PER_HOUR, FATIGUE_NIGHT_FACTOR, FATIGUE_WEATHER_FACTOR, slopeConsumptionFactor,
  FATIGUE_RECOVERY_BIVOUC_PER_HOUR, FATIGUE_RECOVERY_HOTEL_PER_HOUR,
  ORGAN_MODELS, STRENGTH_SCATTER, WEATHER_STRESS, RISK_ACCIDENT_FACTOR, wearFactor,
  AERO_HALF, CONVERGENCE_DAMPING, CONVERGENCE_EPS, CONVERGENCE_EFF, CONVERGENCE_V_MIN, FUEL_TIME_H_PER_L,
  ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM, ENGINE_MAX_TORQUE_NM, GEAR_RATIOS, GEAR_FINAL_DRIVE,
  WHEEL_RADIUS_M, torqueCurve,
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
  DRAFT_GAP_MIN_KM, DRAFT_GAP_MAX_KM, DRAFT_SPEED_DIFF, OVERTAKE_GAP_MAX_KM,
  TRACK_WIDTH_M, CAR_WIDTH_M, CAR_LEN_M, LAT_RATE_M_S, ALONGSIDE_OVERLAP_M, SIDE_CLEARANCE_M,
  BRAKE_GRIP_SHARE, BRAKE_PLAN_SHARE, LOOKAHEAD_MAX_M, LOOKAHEAD_STEP_M, BRAKE_CONFIDENCE, OFF_TRACK_GRIP, DRIFT_OUT_MAX_M, PARKED_BRAKE,
  OVERTAKE_APPROACH_DECEL,
  OVERTAKE_ALONGSIDE_SPEED_DELTA, SIDE_EDGE_MARGIN_M, OVERTAKE_ACC_PER_S, OVERTAKE_ACC_RISK, OVERTAKE_ACC_CURVE_MIN,
  OVERTAKE_ACC_CURVE_GAIN, DEFEND_ACC_FACTOR, OFFLINE_SPEED_PENALTY, OVERTAKE_FAIL_COOLDOWN_S,
  OVERTAKE_LOOKAHEAD_KM, OVERTAKE_WINDOW_CURVE_MAX,
  DUST_GAP_KM, DUST_SPEED_FACTOR, DUST_FATIGUE_FACTOR,
  FUEL_TIME_PER_PERCENT, WHEEL_CHANGE_HOURS, REPAIR_TIME_MIN_SHARE, REPAIR_TIME_WEAR_SHARE,
  REPAIR_PRICE_MIN_SHARE, REPAIR_PRICE_WEAR_SHARE, ORGAN_CRITICAL_WEAR, ORGAN_WARN_WEAR, DIAG_ORGAN_MENTION,
  MENTAL_LOG_MAX, STATION_PROXIMITY_KM, FATIGUE_HEAVY_EYES, FATIGUE_DANGER,
  FUEL_PRICE_PER_LITRE, TIRE_PRICE, HOTEL_PRICE, REPAIR_PRICE_BASE, REPAIR_HOURS, ACCIDENT_FAULT_PENALTY,
  settingsEffects,
} from "./calibration";
import { segmentAt, nextStation, weatherAt, curvatureAt, curvatureSignedAt, roadAhead } from "./world";
import { Rng } from "./rng";
import { GameVariables, tickPlanner, ActiveEffects } from "./planner";

export const TICK_SECONDS = 1 / 30;

export function darknessFactor(hourOfDay: number): number {
  if (hourOfDay >= 21 || hourOfDay < 5) return 1.0;
  if (hourOfDay >= 19) return (hourOfDay - 19) / 2;
  if (hourOfDay < 7) return (7 - hourOfDay) / 2;
  return 0;
}

// Vitesse d'ÉQUILIBRE (physique statique) + DYNAMIQUE LONGITUDINALE (patch 7).
// L'équilibre: v tel que F_motrice(v) = F_roulement + F_aéro(v) + F_pente; le
// virage borne par l'adhérence latérale (v_lat = sqrt(mu·g·r)); la pente est
// une FORCE réelle (gravité). La DYNAMIQUE: la vitesse est un ÉTAT intégré à
// chaque tick (F = m·a) — la voiture freine AVANT le virage (anticipation
// 600 m), accélère progressivement en sortie, et expose des pédales RÉELLES.
// Diagnostic mesuré avant ce patch (banc, 2-3 h): la vitesse téléportait de
// 187 à 42 km/h en 1 tick (-1210 m/s²), le frein restait à 1.0 pendant tout
// un virage (8,5 s) et l'accélérateur affichait 70% pendant 2 h d'affilée.
// NB: l'ancien powerW (CAR_POWER_W, "330 ch") était calculé mais JAMAIS lu —
// code mort de plus; la vraie puissance passe par le couple moteur (torqueCurve).

// la boîte: rapport optimal pour v (le plus haut sans sur-régimer,
// rétrograde sous le ralenti)
function gearFor(vMs: number): number {
  let best = 0;
  for (let gi = 0; gi < GEAR_RATIOS.length; gi++) {
    const rpm = vMs / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI);
    if (rpm <= ENGINE_REDLINE_RPM * 0.98) best = gi;
  }
  while (best > 0) {
    const rpm = vMs / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[best] * GEAR_FINAL_DRIVE / (2 * Math.PI);
    if (rpm >= ENGINE_IDLE_RPM) break;
    best--;
  }
  return best;
}

// le rapport de FORCE (accélération): celui qui maximise le couple à la roue
// parmi les rapports utilisables (ralenti ≤ rpm ≤ zone rouge). Le tall-gear
// ci-dessus laisse la voiture en 6e à 40 km/h (900 tr/min, couple 0.3):
// accélération rampante MESURÉE au banc (46 km/h en 30 s, 6e à 918 tr/min).
// En accélération, le pilote rétrograde dans la bande de couple — c'est ce
// rapport qui sert à la force motrice de la dynamique ET au HUD conduite.
// (engineEquilibrium garde le tall-gear: les équilibres ne changent pas.)
export function powerGearFor(vMs: number): number {
  let best = 0, bestF = -1;
  // les rapports sont triés du PLUS COURT au plus long: la 1re est celle qui
  // sur-régime le plus vite — on l'IGNORE (continue), on ne casse pas la boucle.
  // (Première version: break sur sur-régime → la voiture restait bloquée en
  // 1re à 6000 tr/min à 60 km/h, mesuré, accélération stoppée net.)
  for (let gi = 0; gi < GEAR_RATIOS.length; gi++) {
    const rpm = vMs / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI);
    if (rpm > ENGINE_REDLINE_RPM * 0.98) continue; // trop court ici: le rapport suivant est plus long
    if (rpm < ENGINE_IDLE_RPM) continue; // sous le ralenti (quasi-arrêt): 1re, embrayage
    const f = torqueCurve(rpm) * GEAR_RATIOS[gi];
    if (f > bestF) { bestF = f; best = gi; }
  }
  return best;
}

// la part d'accélérateur consentie: allure × risque × carto × altitude ×
// nuit × fatigue × usure moteur/transmission × météo (+ refroidissement par
// canicule/tempête) — un facteur, réutilisé par l'équilibre ET la dynamique
function throttleShareOf(car: CarState, seg: TerrainSegment, weather: string, darkness: number): number {
  const eff = settingsEffects(car.settings);
  const altLoss = 1 - ALTITUDE_POWER_LOSS * Math.min(1, Math.max(0, (seg.altitude - 200) / 3000));
  const nightThrottle = 1 - darkness * NIGHT_POWER_LOSS;
  const fatigueThrottle = car.fatigue > FATIGUE_POWER_START
    ? 1 - ((car.fatigue - FATIGUE_POWER_START) / 100) * FATIGUE_POWER_RATE : 1;
  const powerWear = (wearFactor(car.organs.moteur) + wearFactor(car.organs.transmission)) / 2;
  const coolingWear = (weather === "canicule" || weather === "tempete_sable") ? wearFactor(car.organs.refroidissement) : 1;
  return (PACE_SPEED_FACTOR[car.pace] ?? 0.7) * (RISK_SPEED_BONUS[car.risk] ?? 1.0)
    * eff.power * altLoss * nightThrottle * fatigueThrottle
    * (WEATHER_POWER_EFFECT[weather] ?? 1.0) * powerWear * coolingWear;
}

// Vitesse d'ÉQUILIBRE moteur en m/s (le solveur itératif existant, SANS clamp
// de virage: la limite de virage est gérée séparément par cornerLimitAt).
export function engineEquilibrium(car: CarState, seg: TerrainSegment, weather: string, darkness: number): number {
  const mass = CAR_MASS_KG + car.fuel * FUEL_DENSITY_KG_PER_L;
  const crEff = (car.crevaison ? (ROLLING_RES[seg.terrain] ?? 0.04) * 2.2 : (ROLLING_RES[seg.terrain] ?? 0.04)) * (1 + (1 - wearFactor(car.organs.suspensions)));
  const rollingF = crEff * mass * GRAVITY;
  const slopeF = (seg.slope / 1000) * mass * GRAVITY;
  const kAero = AERO_HALF * AIR_DENSITY * AERO_DRAG_COEFF;
  const throttleShare = throttleShareOf(car, seg, weather, darkness);
  const maxTractionF = WHEEL_DRIVE_EFF * (LATERAL_GRIP[seg.terrain] ?? 0.5)
    * ((wearFactor(car.organs.pneus_av) + wearFactor(car.organs.pneus_ar)) / 2)
    * (WEATHER_GRIP_EFFECT[weather] ?? 1.0) * mass * GRAVITY;
  let v = 20;
  for (let i = 0; i < 14; i++) {
    const fTotal = Math.max(50, rollingF + slopeF + kAero * v * v);
    const gi = gearFor(v);
    const rpm = v / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI);
    const fGear = torqueCurve(rpm) * ENGINE_MAX_TORQUE_NM * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE
      * TRANSMISSION_EFF / WHEEL_RADIUS_M * throttleShare;
    const fTraction = Math.min(fGear, maxTractionF);
    const vNext = (fTraction * v) / fTotal * CONVERGENCE_EFF + CONVERGENCE_V_MIN;
    v = v + (vNext - v) * CONVERGENCE_DAMPING;
    if (Math.abs(vNext - v) < CONVERGENCE_EPS) break;
  }
  return v;
}

// Limite de virage (m/s) à la position km — la formule d'adhérence existante,
// extraite pour être interrogée ICI et dans l'anticipation. Pneus usés =
// adhérence en berne; freins usés = lever de pied moins efficace; une ROUE
// HORS PISTE (dérive de survitesse) = l'adhérence herbe/terre chute.
export function cornerLimitAt(car: CarState, seg: TerrainSegment, weather: string, darkness: number, world: World, km: number): number {
  const curve = curvatureAt(world, km);
  if (curve <= CURVE_MIN_NORMALIZED) return Infinity;
  const radius = CURVE_REF_RADIUS_M / curve;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  const tireWear = (wearFactor(car.organs.pneus_av) + wearFactor(car.organs.pneus_ar)) / 2;
  const muEff = mu * tireWear * (WEATHER_GRIP_EFFECT[weather] ?? 1.0);
  const daring = (DARING_BY_RISK as Record<string, number>)[car.risk] ?? 0.88;
  const daringEff = daring * (1 - darkness * NIGHT_AUDACITY_LOSS) * (car.fatigue > FATIGUE_POWER_START ? 1 - ((car.fatigue - FATIGUE_POWER_START) / 100) * FATIGUE_AUDACITY_RATE : 1);
  const halfW = (TRACK_WIDTH_M as Record<string, number>)[seg.width] / 2;
  const offTrack = Math.abs(car.lateral) > halfW - CAR_WIDTH_M / 2 ? OFF_TRACK_GRIP : 1;
  return Math.sqrt(muEff * offTrack * GRAVITY * Math.max(20, radius)) * daringEff * wearFactor(car.organs.freins);
}

// Contrat INCHANGÉ (tests + références): l'équilibre statique AVEC limite de
// virage — la vitesse qu'une voiture TIENDAIT à cet instant. La vitesse
// réellement tenue vient désormais de dynamicSpeed (intégration tick par tick).
export function computeSpeed(car: CarState, seg: TerrainSegment, weather: string, darkness: number, world?: World): number {
  let v = engineEquilibrium(car, seg, weather, darkness);
  if (world) {
    const vc = cornerLimitAt(car, seg, weather, darkness, world, car.positionKm);
    if (vc < v) v = vc;
  }
  if (car.towedBy) v *= TOWING_SPEED_FACTOR;
  return Math.max(0, v * 3.6); // m/s -> km/h
}

// DYNAMIQUE LONGITUDINALE (patch 7 — décision: modèle profond):
// 1. la vitesse est un ÉTAT (car.speedKmh) intégré à chaque tick: plus de
//    téléportation entre équilibres;
// 2. le pilote ANTICIPE (600 m): vAllowed = sqrt(vLim² + 2·a·d) — il freine
//    AVANT le virage et AVANT le terrain lent, pas à l'entrée;
// 3. capacité de freinage = adhérence × part freinage × usure des freins
//    (décision: l'usure allonge les distances), et la CONFIANCE au freinage
//    suit le profil de risque: le risqué freine tard, entre en survitesse
//    et dérive — l'accident se paie hors piste (adhérence chute);
// 4. les pédales sont RÉELLES: frein = décélération exigée / capacité,
//    accélérateur = force employée / force disponible — signaux continus.
function dynamicSpeed(car: CarState, ctx: SimContext, seg: TerrainSegment, weather: string, darkness: number, envScale: number): number {
  const dt = TICK_SECONDS;
  const g = GRAVITY;
  let v = Math.max(0, car.speedKmh / 3.6); // ÉTAT en m/s, persiste entre ticks
  const mass = CAR_MASS_KG + car.fuel * FUEL_DENSITY_KG_PER_L;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  const tireWear = (wearFactor(car.organs.pneus_av) + wearFactor(car.organs.pneus_ar)) / 2;
  const muEff = mu * tireWear * (WEATHER_GRIP_EFFECT[weather] ?? 1.0);
  const aBrakeMax = muEff * g * BRAKE_GRIP_SHARE * wearFactor(car.organs.freins);
  // cible de base: équilibre moteur et limite de virage à la position actuelle
  // (remorquage: on tire une autre auto — abstraction conservée du moteur)
  let vEqHere = engineEquilibrium(car, seg, weather, darkness);
  if (car.towedBy) vEqHere *= TOWING_SPEED_FACTOR;
  const vLimHere = cornerLimitAt(car, seg, weather, darkness, ctx.world, car.positionKm);
  let vTarget = Math.min(vEqHere, vLimHere);
  // ANTICIPATION (notes de pace): la contrainte la plus forte DEVANT, ramenée
  // à la vitesse qu'on peut encore tenir ICI: vAllowed = sqrt(vLim² + 2·a·d).
  const conf = (BRAKE_CONFIDENCE as Record<string, number>)[car.risk] ?? 0.94;
  // freinage PLANIFIÉ à une fraction de la capacité (0.6): sans cette marge,
  // vReach ne contraint qu'au dernier moment (~140 m) et le déficit exigé
  // d'un coup colle la pédale à 1.0 — le défaut historique. À 60%, le freinage
  // commence ~250 m avant l'obstacle et la pédale monte progressivement.
  const aBrakePlan = Math.max(0.1, aBrakeMax * conf * BRAKE_PLAN_SHARE);
  let segPrev: TerrainSegment | null = null;
  let vEqPrev = 0;
  for (let d = LOOKAHEAD_STEP_M; d <= LOOKAHEAD_MAX_M; d += LOOKAHEAD_STEP_M) {
    const kmA = car.positionKm + d / 1000;
    const segA = segmentAt(ctx.world.segments, kmA);
    let vLimD = cornerLimitAt(car, segA, weather, darkness, ctx.world, kmA);
    if (segA !== seg) {
      // frontière de terrain dans la fenêtre: l'équilibre moteur change là —
      // le pilote voit le marécage/les dunes arriver et lève le pied avant
      if (segA !== segPrev) { vEqPrev = engineEquilibrium(car, segA, weather, darkness) * (car.towedBy ? TOWING_SPEED_FACTOR : 1); segPrev = segA; }
      if (vEqPrev < vLimD) vLimD = vEqPrev;
    }
    const vReach = Math.sqrt(vLimD * vLimD + 2 * aBrakePlan * d);
    if (vReach < vTarget) vTarget = vReach;
  }
  // FACTEURS D'ENVIRONNEMENT (correctif tempête d'accrochages): poussière,
  // bord sale en virage, aspiration — des échelles de CIBLE, pas des
  // multiplicateurs d'état. Appliqués à la vitesse filée par tick, un facteur
  // ×0.5/tick la pompait exponentiellement: équilibre v_pin = a·dt/(1/p − 1),
  // soit 3,4 km/h mesurés pendant 6 minutes (voiture garée sur la piste,
  // phase côte à côte collée, accrochages fantômes à 900 m). En échelle de
  // cible, le pilote tient DURABLEMENT la vitesse d'environnement et
  // récupère quand elle disparaît.
  vTarget *= envScale;
  // résistances à la vitesse courante (pour l'accélération et la pédale)
  const crEff = (car.crevaison ? (ROLLING_RES[seg.terrain] ?? 0.04) * 2.2 : (ROLLING_RES[seg.terrain] ?? 0.04)) * (1 + (1 - wearFactor(car.organs.suspensions)));
  const rollingF = crEff * mass * g;
  const slopeF = (seg.slope / 1000) * mass * g; // positif = côte (oppose)
  const kAero = AERO_HALF * AIR_DENSITY * AERO_DRAG_COEFF;
  const Fres = Math.max(0, rollingF + slopeF + kAero * v * v);
  // force motrice disponible à v (boîte + couple + part d'accélérateur)
  const throttleShare = throttleShareOf(car, seg, weather, darkness);
  const gi = powerGearFor(v);
  const rpm = v / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI);
  const fGear = torqueCurve(rpm) * ENGINE_MAX_TORQUE_NM * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE
    * TRANSMISSION_EFF / WHEEL_RADIUS_M * throttleShare;
  const Fmax = Math.min(fGear, WHEEL_DRIVE_EFF * muEff * mass * g); // borné traction
  if (v < vTarget) {
    // ACCÉLÉRER (traction-borné), sans dépasser la cible: la remontée en
    // sortie de virage est progressive (F = m·a), plus de saut à l'équilibre
    const aWish = (vTarget - v) / dt;
    const a = Math.min(Math.max(0, (Fmax - Fres) / mass), aWish);
    v = Math.min(vTarget, v + a * dt);
    // pédale: la part de la force disponible réellement employée
    car.throttle = Math.min(1, (mass * a + Fres) / Math.max(Fmax, 1));
    car.brake = 0;
  } else if (v > vTarget) {
    // FREINER: la décélération exigée par la cible (qui se resserre à
    // l'approche du virage → frein fort à l'ENTRÉE puis relâche dans le
    // virage — plus jamais "à fond tout le virage"), bornée par la capacité
    const aNeed = Math.min(aBrakeMax, (v - vTarget) / dt);
    v = Math.max(vTarget, v - aNeed * dt);
    car.brake = aBrakeMax > 0 ? aNeed / aBrakeMax : 1;
    car.throttle = 0;
  } else {
    // TENIR la vitesse: accélérateur = frottements / force disponible
    car.throttle = Math.min(1, Fres / Math.max(Fmax, 1));
    car.brake = 0;
  }
  // (la SURVITESSE → dérive extérieure est appliquée dans tickCarInternal,
  // APRÈS applyTrafficEffects: son recentrage vers l'axe (0,064 m/tick puis
  // snap à 0 sous 5 cm) annulait exactement une dérive de même amplitude
  // posée ici — mesuré: |lateral| 0,00 pendant 20 ticks de survitesse)
  // état moteur exposé (HUD 30 Hz): rapport et régime de la vitesse RÉELLE
  const giHud = powerGearFor(v);
  car.gear = giHud + 1;
  car.rpm = Math.max(ENGINE_IDLE_RPM, v / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[giHud] * GEAR_FINAL_DRIVE / (2 * Math.PI));
  return Math.max(0, v * 3.6); // km/h
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
  // MÉTÉO VIVANTE: front actif ou à venir le plus proche DEVANT (bord d'entrée,
  // km - rayon). Sert aux règles "si tempête à < X km → ralentir". Les pistes
  // endommagées sont du terrain, pas des fronts météo — on les ignore.
  let frontDist = 9999; let frontKind = "clair";
  for (const f of ctx.fronts) {
    if (f.kind === "piste_endommagee") continue;
    if (ctx.tick > f.endTick) continue;
    const d = f.km - f.radiusKm - car.positionKm;
    if (d >= 0 && d < frontDist) { frontDist = d; frontKind = f.kind; }
  }
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
    distance_prochain_front: frontDist,
    meteo_devant: frontKind,
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
  // PÉDALES à l'arrêt (patch 7): voiture garée — régime ralenti, frein de
  // parking affiché (avant: régime/pédales figés à la dernière valeur roulée).
  if (car.immobilized || car.stopWork || car.sleeping > 0) {
    car.gear = 1; car.rpm = ENGINE_IDLE_RPM; car.throttle = 0; car.brake = PARKED_BRAKE;
  }

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

  // DYNAMIQUE LONGITUDINALE (patch 7): la vitesse est un état INTÉGRÉ —
  // accélération/freinage progressifs, anticipation 600 m, pédales réelles.
  // FACTEURS D'ENVIRONNEMENT (correctif tempête d'accrochages): échelle de
  // cible poussière / bord sale / aspiration, calculée sur l'état du tick —
  // les effets équivalents de applyTrafficEffects ne multiplient plus la
  // vitesse: sur un état intégré, un facteur par tick se composait (×0.5/tick
  // = voiture garée à 3,4 km/h des minutes durant, aspirait le peloton
  // dedans, et la phase côte à côte sans sortie tirait des accrochages
  // fantômes à 900 m — 8/10 morts en 1 h de bench).
  let envScale = 1;
  {
    const curveNow = curvatureAt(ctx.world, car.positionKm);
    const halfWNow = (TRACK_WIDTH_M as Record<string, number>)[seg.width] / 2;
    // bord sale en virage (déporté): le pilote vise une vitesse réduite
    if (Math.abs(car.lateral) > halfWNow * 0.4 && curveNow > 0.05) envScale *= OFFLINE_SPEED_PENALTY;
    for (const o of ctx.allCars) {
      if (o.playerId === car.playerId || o.arrived || o.forfait) continue;
      const gapKm = o.positionKm - car.positionKm;
      if (gapKm > DRAFT_GAP_MIN_KM && gapKm < DRAFT_GAP_MAX_KM && Math.abs(o.speedKmh - car.speedKmh) < DRAFT_SPEED_DIFF) {
        envScale *= 1.03; // aspiration: +3% de cible
      } else if (gapKm > 0 && gapKm < DUST_GAP_KM && Math.abs(car.lateral - o.lateral) < CAR_WIDTH_M) {
        envScale *= DUST_SPEED_FACTOR; // dans la poussière: cible réduite
      }
    }
  }
  let speed = dynamicSpeed(car, ctx, seg, weather, darkness, envScale);
  // vitesse DEMANDÉE (l'équilibre) pour le filtre "plus lent que moi" du
  // dépassement: la vitesse INTÉGRÉE est plafonnée par le rival suivi dans la
  // poussière — un filtre sur l'état intégré interdisait tout ré-engagement
  // une fois collé derrière un lent (le rapide ne repassait jamais).
  const vDemand = computeSpeed(car, seg, weather, darkness, ctx.world);
  speed = applyTrafficEffects(car, ctx, speed, riskFactor, emit, vDemand);

  // SURVITESSE en virage (décision: l'accident se paie hors piste): freinage
  // insuffisant → la voiture glisse vers l'EXTÉRIEUR; une roue peut sortir
  // (l'adhérence chute: OFF_TRACK_GRIP dans cornerLimitAt) et la demande
  // latérale alimente l'accident émergent existant (× agressivité). Ici,
  // APRÈS applyTrafficEffects: avant ce déplacement, le recentrage vers
  // l'axe (0,064 m/tick + snap 5 cm) annulait la dérive posée en amont.
  if (!car.maneuver) {
    const vLimHere = cornerLimitAt(car, seg, weather, darkness, ctx.world, car.positionKm);
    const vMs = speed / 3.6;
    if (vLimHere !== Infinity && vMs > vLimHere * 1.001) {
      const dir = -Math.sign(curvatureSignedAt(ctx.world, car.positionKm) || 1); // extérieur
      const over = (vMs * vMs) / (vLimHere * vLimHere) - 1;
      // le glissement de décrochage est PLUS RAPIDE qu'un déplacement contrôlé:
      // plafond 2×latStep. Mesuré: à 1×latStep, le recentrage d'applyTrafficEffects
      // (0,064 m) + son snap "< 5 cm → 0" annulaient exactement le gain net
      // (0,043 m < 0,05) — la voiture oscillait 0 ↔ −0,107 sans jamais dériver.
      const latStep = LAT_RATE_M_S * TICK_SECONDS;
      car.lateral += dir * Math.min(2 * latStep, (0.3 + over * 2) * latStep);
      const halfW = (TRACK_WIDTH_M as Record<string, number>)[seg.width] / 2;
      const bound = halfW - CAR_WIDTH_M / 2 + DRIFT_OUT_MAX_M; // une roue dehors, pas la voiture
      car.lateral = Math.max(-bound, Math.min(bound, car.lateral));
    }
  }

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
    (weather !== "clair" ? FATIGUE_WEATHER_FACTOR : 1) *
    (car.dustTick === ctx.tick ? DUST_FATIGUE_FACTOR : 1);
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

// ========== DÉPASSEMENT SPATIAL ==========
// Le trafic vit sur un axe (positionKm) + un déport latéral (car.lateral, m).
// Une manœuvre traverse 3 phases: approche (déport du côté choisi), côte à
// côte (chevauchement réel — SEUL moment où l'accrochage peut survenir),
// décrochage (retour au centre). "X dépasse Y" n'est journalisé qu'au VRAI
// franchissement (écart > CAR_LEN_M), une seule fois par manœuvre.
// La Direction désigne le fautif par la GÉOMÉTRIE: en virage, l'EXTÉRIEUR
// est en tort (l'intérieur possède la trajectoire); sur ligne droite, la
// voiture qui fait la manœuvre — sauf si le rival défend activement.
export function resolveContactFault(doubler: CarState, target: CarState, ctx: SimContext): CarState {
  const curve = curvatureSignedAt(ctx.world, doubler.positionKm);
  if (Math.abs(curve) > 0.15) {
    // vrai virage: convention curvature > 0 = virage à GAUCHE → l'intérieur
    // est à gauche (lateral plus grand). La voiture à l'intérieur possède la ligne.
    const doublerInside = curve > 0 ? doubler.lateral > target.lateral : doubler.lateral < target.lateral;
    return doublerInside ? target : doubler;
  }
  // ligne droite: le doublard est en tort, sauf défense active du rival
  return target.defending ? target : doubler;
}

export function applyTrafficEffects(
  car: CarState,
  ctx: SimContext,
  speed: number,
  _riskFactor: number,
  emit: (t: string) => void,
  vDemand?: number
): number {
  let v = speed;
  const seg = segmentAt(ctx.world.segments, car.positionKm);
  const halfW = (TRACK_WIDTH_M as Record<string, number>)[seg.width] / 2;
  const curve = curvatureAt(ctx.world, car.positionKm);
  const latStep = LAT_RATE_M_S * TICK_SECONDS;
  const others = ctx.allCars.filter(
    (c) => c.playerId !== car.playerId && !c.arrived && !c.forfait && Math.abs(c.positionKm - car.positionKm) < 1.0
  );

  if (car.maneuver) {
    const m = car.maneuver;
    const target = others.find((o) => o.playerId === m.targetId);
    if (car.overtaking === "interdit") {
      // le pilote interdit les dépassements en pleine manœuvre: on rentre
      m.phase = "decrochage";
      car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
    } else if (m.phase !== "decrochage" && !target) {
      // cible perdue (arrivée, forfait): on rentre. Une cible IMMOBILISÉE
      // reste dépassable: elle est au fossé, on se faufile à vitesse réduite.
      m.phase = "decrochage";
    } else if (m.phase === "approche" && target) {
      const gapM = (target.positionKm - car.positionKm) * 1000;
      // se déporter du côté choisi, au plus près du bord (15 cm) pour offrir
      // une vraie place latérale — sinon le doublard se parque à mi-piste et
      // reste bloqué.
      const latTarget = m.side * (halfW - CAR_WIDTH_M / 2 - SIDE_EDGE_MARGIN_M);
      car.lateral += Math.sign(latTarget - car.lateral) * Math.min(latStep, Math.abs(latTarget - car.lateral));
      // ARRIVÉE PLANIFIÉE: on ne fond pas sur le rival — la consigne est une
      // COURBE de freinage, pas un cap instantané: v ≤ sqrt(vCible² + 2·a·(d−35)),
      // puis le plafond plein à 35 m. (Avec l'état intégré, le cap sec à 35 m
      // téléportait la vitesse d'un coup: −23 km/h en 1 tick, mesuré.)
      {
        const vCapMs = (target.speedKmh + OVERTAKE_ALONGSIDE_SPEED_DELTA) / 3.6;
        const vPlan = Math.sqrt(vCapMs * vCapMs + 2 * OVERTAKE_APPROACH_DECEL * Math.max(0, gapM - 35));
        v = Math.min(v, vPlan * 3.6);
        if (gapM < 35) {
          v = Math.min(v, target.speedKmh + OVERTAKE_ALONGSIDE_SPEED_DELTA);
        }
      }
      if (Math.abs(gapM) < ALONGSIDE_OVERLAP_M) {
        m.phase = "cote_a_cote";
      } else if (gapM > m.startGapM + 20 || gapM > OVERTAKE_GAP_MAX_KM * 1000) {
        // le rival s'échappe (ou on n'arrive pas à fermer): abandon propre
        m.phase = "decrochage";
        car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
      }
    }
    if (m.phase === "cote_a_cote" && target) {
      const gapM = (target.positionKm - car.positionKm) * 1000;
      if (gapM <= 0) m.crossed = true;
      const latSep = Math.abs(car.lateral - target.lateral);
      // ÉCHAPPÉE (correctif tempête d'accrochages): la phase côte à côte
      // n'avait AUCUNE sortie quand le rival s'éloignait — la manœuvre
      // restait collée des kilomètres durant (mesuré: 6 min, écart 987 m)
      // pendant que le tirage d'accrochage tournait à distance. Abandon
      // propre, comme en approche.
      if (gapM > m.startGapM + 20 || gapM > OVERTAKE_GAP_MAX_KM * 1000) {
        m.phase = "decrochage";
        car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
      } else if (latSep < CAR_WIDTH_M + SIDE_CLEARANCE_M && !target.immobilized) {
        // pas encore la place latérale: on se tient PRÊT, derrière
        v = Math.min(v, target.speedKmh);
        // bloqué trop longtemps sans place: abandon propre
        if (ctx.tick - m.startTick > 30 * TICKS_PER_SECOND) {
          m.phase = "decrochage";
          car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
        }
      } else {
        // place réelle à côté: l'écart de vitesse se resserre (on ne "vole"
        // pas à côté) et le bord de piste est sale.
        // NB (correctif tempête d'accrochages): le ×0.97 s'applique au
        // PLAFOND, pas à la vitesse d'état — composé par tick sur l'état
        // intégré, il la pompait vers ~2 km/h (le doublard ne récupère que
        // ~0,6 m/s² dans le sable: v_pin = a·dt/(1/0,97 − 1), mesuré 2,3 km/h
        // côte à côte sur le sable, dépassement mort-né).
        v = Math.min(v, (target.speedKmh + OVERTAKE_ALONGSIDE_SPEED_DELTA) * 0.97);
        const curveFactor = OVERTAKE_ACC_CURVE_MIN + OVERTAKE_ACC_CURVE_GAIN * curve * curve;
        const perS =
          ((OVERTAKE_ACC_PER_S as Record<string, number>)[car.overtaking] ?? 0) *
          ((OVERTAKE_ACC_RISK as Record<string, number>)[car.risk] ?? 1) *
          curveFactor *
          (target.defending ? DEFEND_ACC_FACTOR : 1);
        // ACCROCHAGE = contact PHYSIQUE: seulement en chevauchement réel
        // (garde du correctif: la phase pouvait traîner, le tirage tournait
        // aussi à 900 m — accrochages fantômes, chassis +20/+15 sortis de
        // nulle part, 8/10 morts en 1 h de bench)
        if (Math.abs(gapM) <= ALONGSIDE_OVERLAP_M + CAR_LEN_M && target.speedKmh > 10 && ctx.rng.chance(perS * TICK_SECONDS)) {
          // ACCROCHAGE — seulement ici, côte à côte, jamais à distance
          car.stats.accidents++;
          target.stats.accidents++;
          car.organs.chassis = Math.min(100, car.organs.chassis + 20);
          target.organs.chassis = Math.min(100, target.organs.chassis + 15);
          const faultCar = resolveContactFault(car, target, ctx);
          faultCar.budget -= ACCIDENT_FAULT_PENALTY;
          faultCar.stats.depenses += ACCIDENT_FAULT_PENALTY;
          faultCar.transactions.push({
            tick: ctx.tick,
            label: "pénalité direction de course (accrochage)",
            amount: -ACCIDENT_FAULT_PENALTY,
          });
          emit(
            `Accrochage entre ${car.playerId} et ${target.playerId} ! Direction de course : ${faultCar.playerId} en tort (-${ACCIDENT_FAULT_PENALTY}).`
          );
          mental(car, ctx.tick, "Ça a frotté… la Direction ne va pas aimer.");
          m.phase = "decrochage";
          car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
          target.noPassUntilTick = ctx.tick + (OVERTAKE_FAIL_COOLDOWN_S / 2) * TICKS_PER_SECOND;
        } else if (m.crossed && gapM <= -CAR_LEN_M) {
          // VRAI FRANCHISSEMENT: l'écart a changé de signe et dépasse une longueur
          car.stats.depassements++;
          emit(`${car.playerId} dépasse ${target.playerId} !`);
          m.phase = "decrochage";
        } else if (gapM < -2 * ALONGSIDE_OVERLAP_M) {
          // le rival a repris l'avantage: abandon propre
          m.phase = "decrochage";
          car.noPassUntilTick = ctx.tick + OVERTAKE_FAIL_COOLDOWN_S * TICKS_PER_SECOND;
        }
      }
    }
    if (m.phase === "decrochage") {
      car.lateral -= Math.sign(car.lateral) * Math.min(latStep, Math.abs(car.lateral));
      if (Math.abs(car.lateral) < 0.05) {
        car.lateral = 0;
        car.maneuver = null;
      }
    }
    // hors trajectoire en virage: le bord de piste est sale (cailloux, souches)
    // (échelle de CIBLE: envScale dans tickCarInternal — un ×0.5/tick sur
    // l'état intégré garait la voiture à 3,4 km/h: effondrement exponentiel,
    // 6 min mesurées en phase côte à côte collée)
  } else {
    // pas de manœuvre: retour progressif à la trajectoire idéale (centre)
    car.lateral -= Math.sign(car.lateral) * Math.min(latStep * 0.6, Math.abs(car.lateral));
    if (Math.abs(car.lateral) < 0.05) car.lateral = 0;

    // initiation d'une manœuvre? Il faut: l'autorisation du pilote, la place
    // RÉELLE sur la piste (2 voitures + marges latérales), pas de cooldown,
    // et le rival le plus proche devant, plus lent, pas déjà doublé par
    // quelqu'un d'autre (file d'attente naturelle).
    if (car.overtaking !== "interdit" && ctx.tick >= car.noPassUntilTick) {
      const roomOk = 2 * CAR_WIDTH_M + 2 * SIDE_CLEARANCE_M <= 2 * halfW;
      const blockedIds = new Set(others.filter((o) => o.maneuver).map((o) => o.maneuver!.targetId));
      const candidates = others.filter(
        (o) =>
          o.positionKm - car.positionKm > 0 &&
          o.positionKm - car.positionKm < OVERTAKE_GAP_MAX_KM &&
          // "plus lent que moi" se juge sur la vitesse DEMANDÉE (l'équilibre,
          // paramètre vDemand), pas sur la vitesse tenue: dans le sillage,
          // l'état intégré est plafonné à celle du rival (patch 7) et un filtre
          // sur l'état interdisait tout ré-engagement une fois collé derrière
          // un lent. Fallback sur speed pour les appels directs (tests).
          o.speedKmh < (vDemand ?? speed) * DUST_SPEED_FACTOR &&
          !blockedIds.has(o.playerId)
      );
      if (candidates.length > 0) {
        const candidate = candidates.reduce((best, o) =>
          o.positionKm - car.positionKm < best.positionKm - car.positionKm ? o : best
        );
        // une voiture AU FOSSÉ (immobilisée) se contourne même sans place
        // latérale "normale": elle n'est pas sur la trajectoire de course.
        // CONSCIENCE DE COURSE: on ne s'engage que si la fenêtre DEVANT
        // permet de TERMINER le dépassement (pas de segment étroit, pas de
        // virage trop fort). Sinon on attend dans le sillage — le moment
        // opportun existe, il suffit de le lire sur le tracé.
        // pas de duel possible sous 10 km/h (garde d'accrochage du modèle):
        // une cible quasi à l'arrêt est un OBSTACLE à contourner, pas un
        // rival — la fenêtre ne s'y applique pas (l'accrochage est de toute
        // façon impossible avec elle). Sans cette exemption, le doublard
        // gelait à 0 km/h derrière une voiture à l'arrêt, à position figée:
        // fenêtre figée, boucle sans issue.
        const fenetre = candidate.immobilized || candidate.speedKmh < 10
          ? null
          : roadAhead(ctx.world, car.positionKm, OVERTAKE_LOOKAHEAD_KM);
        const fenetreOk =
          fenetre === null ||
          (fenetre.minWidth !== "etroite" && fenetre.maxCurve <= OVERTAKE_WINDOW_CURVE_MAX);
        if ((roomOk && fenetreOk) || candidate.immobilized) {
          // côté: à l'opposé du déport actuel du rival; s'il est au centre, à droite
          const side: -1 | 1 = candidate.lateral > 0.2 ? -1 : candidate.lateral < -0.2 ? 1 : -1;
          car.maneuver = {
            targetId: candidate.playerId,
            phase: "approche",
            side,
            startTick: ctx.tick,
            startGapM: (candidate.positionKm - car.positionKm) * 1000,
            crossed: false,
          };
        }
      }
    }
  }

  // --- effets de proximité: aspiration, poussière, file sur piste étroite ---
  for (const other of others) {
    const gap = other.positionKm - car.positionKm;
    if (gap > DRAFT_GAP_MIN_KM && gap < DRAFT_GAP_MAX_KM && Math.abs(other.speedKmh - car.speedKmh) < DRAFT_SPEED_DIFF) {
      // (l'aspiration est une échelle de CIBLE: envScale dans tickCarInternal —
      // un ×1.03/tick sur l'état intégré s'accumulait sans borne)
      mental(car, ctx.tick, "Je suis dans le sillage, ça glisse tout seul.");
    } else if (gap > 0 && gap < DUST_GAP_KM && Math.abs(car.lateral - other.lateral) < CAR_WIDTH_M) {
      // POUSSIÈRE — seulement dans le sillage LATÉRAL du rival: se déporter,
      // c'est en sortir (le cœur du dépassement spatial).
      // (la perte de vitesse est une échelle de CIBLE: envScale dans
      // tickCarInternal — un ×0.9/tick sur l'état intégré pompait la vitesse
      // vers ~32 km/h quel que soit le rival, mesuré)
      // SANS manœuvre, traverser un rival est PHYSIQUEMENT impossible:
      // on suit. Seule une manœuvre latérale réelle permet de dépasser.
      if (!car.maneuver && !other.immobilized) v = Math.min(v, other.speedKmh);
      // marquer le tick de poussière: la fatigue du tick sera multipliée par
      // DUST_FATIGUE_FACTOR (l'ancien ajout forfaitaire confondait ticks et
      // secondes: 0,01/tick = +1080/h à 30 ticks/s)
      car.dustTick = ctx.tick;
      mental(car, ctx.tick, "La poussière de celui de devant, je ne vois rien.");
    } else if (gap > 0 && gap < 0.03 && seg.width === "etroite" && !other.immobilized) {
      // piste étroite: aucune place pour se mettre à deux — on suit
      // (une voiture au fossé ne bloque pas: on se faufile)
      v = Math.min(v, other.speedKmh);
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
function computeOrganLoads(car: CarState, seg: TerrainSegment, weather: string, darkness: number, v: number, vGearRef?: number): Record<string, number> {
  // (patch 7) le rapport de la charge = tall-gear à la vitesse d'ÉQUILIBRE
  // (vGearRef, passée par wearUpdate), ni le rapport HUD ni le rapport à la
  // vitesse réelle: en 1re au lancement, fTraction ×1.05 ≈ 11-12 kN dépassait
  // la charge nominale de la transmission (9500 N) → "casse transmission" à
  // 12 km/h après quelques secondes, mesuré. La calibration des charges
  // (patch 5, banc) est conservée EXACTEMENT: avant la dynamique, la charge
  // était toujours évaluée à la vitesse d'équilibre en tall-gear. Bosse et
  // choc restent évalués à la vitesse RÉELLE (physique). Étiquette
  // d'honnêteté: le couple réel de 1re au lancement n'est pas encore dans le
  // modèle de charge (à étalonner ensemble).
  const gearIdx = gearFor((vGearRef ?? v) / 3.6);
  const mass = CAR_MASS_KG + car.fuel * FUEL_DENSITY_KG_PER_L;
  const g = GRAVITY;
  const cr = ROLLING_RES[seg.terrain] ?? 0.04;
  const slopeFrac = seg.slope / 1000;
  const weatherStress = WEATHER_STRESS[weather] ?? 1.0;
  const vMs = v / 3.6;
  const mu = LATERAL_GRIP[seg.terrain] ?? 0.5;
  // traction réelle: couple de boîte au régime courant × accélérateur (borné
  // par l'adhérence). P/v explosait à basse vitesse — la boîte donne le vrai couple.
  const rpmNow = Math.max(ENGINE_IDLE_RPM, vMs / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gearIdx] * GEAR_FINAL_DRIVE / (2 * Math.PI));
  const throttleNow = (PACE_SPEED_FACTOR[car.pace] ?? 0.7);
  const fTraction = Math.min(
    torqueCurve(rpmNow) * ENGINE_MAX_TORQUE_NM * GEAR_RATIOS[gearIdx] * GEAR_FINAL_DRIVE
      * TRANSMISSION_EFF / WHEEL_RADIUS_M * throttleNow,
    WHEEL_DRIVE_EFF * mu * mass * g
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
    moteur: (fTraction / (GEAR_RATIOS[gearIdx] * GEAR_FINAL_DRIVE)) * WHEEL_RADIUS_M * weatherStress * (1 + darkness * LOAD_ENGINE_NIGHT_EXTRA),
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
  // (patch 7) référence de charge = vitesse d'ÉQUILIBRE (computeSpeed), comme
  // avant la dynamique: la voiture ne peut plus téléporter, mais le modèle de
  // charge garde l'étalonnage de son banc (voir computeOrganLoads).
  const vEqLoad = computeSpeed(car, seg, weather, darkness, ctx.world);
  const loads = computeOrganLoads(car, seg, weather, darkness, v, vEqLoad);
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
  // pneus usés: l'accident émergent devient plus probable (l'adhérence RÉELLE
  // est dégradée par l'usure, pas seulement par météo/nuit/fatigue)
  const tireWearAcc = (wearFactor(car.organs.pneus_av) + wearFactor(car.organs.pneus_ar)) / 2;
  // une ROUE HORS PISTE (dérive de survitesse, patch 7): l'adhérence herbe/terre chute
  const offTrack = Math.abs(car.lateral) > ((TRACK_WIDTH_M as Record<string, number>)[seg.width] ?? 7.5) / 2 - CAR_WIDTH_M / 2;
  const muEff = mu * vigueur * tireWearAcc * (1 - darkness * OVERTAKE_NIGHT_GRIP_LOSS) * (weather === "pluie_diluvienne" || weather === "tempete_sable" ? RAIN_GRIP_FACTOR : 1) * (offTrack ? OFF_TRACK_GRIP : 1);
  const vMs = car.speedKmh / 3.6;
  // demande latérale vs capacité: l'excès est le moteur de l'accident
  if (radius !== Infinity && car.speedKmh > 3) {
    // cercle de friction simplifié (patch 7): en freinage fort la voiture ne
    // suit PAS encore la courbe — l'adhérence va au freinage (BRAKE_GRIP_SHARE),
    // la demande latérale EFFECTIVE chute. Mesuré avant: les transitoires de
    // la dynamique (changement de terrain: la cible chute d'un coup, la
    // voiture décélère physiquement à ~5 m/s²) tenaient un excès de 0.5-0.8
    // pendant ~90 ticks → tempête d'accidents (8/10 archétypes immobilisés en
    // 12 h, même les prudents). En survitesse NON freinée, l'accident paie
    // toujours — et la dérive de sortie de piste (offTrack ×0.6) paie aussi.
    const demand = (vMs * vMs) / radius * (1 - BRAKE_GRIP_SHARE * car.brake);
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
