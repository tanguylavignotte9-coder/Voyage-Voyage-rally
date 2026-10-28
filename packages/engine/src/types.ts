export type Biome = "desert" | "montagne" | "steppe" | "humide";

export type TerrainType =
  | "piste_rapide"
  | "piste_moyenne"
  | "piste_mauvaise"
  | "dunes"
  | "regs"
  | "pierrier"
  | "col"
  | "bourbier"
  | "marécage";

export type WeatherKind =
  | "clair"
  | "pluie_diluvienne"
  | "tempete_sable"
  | "canicule"
  | "froid_intense"
  | "brouillard"
  | "vent_fort"
  | "grele";

export type OrganId =
  | "moteur"
  | "transmission"
  | "pneus_av"
  | "pneus_ar"
  | "suspensions"
  | "chassis"
  | "freins"
  | "refroidissement";

export const ORGANS: OrganId[] = [
  "moteur",
  "transmission",
  "pneus_av",
  "pneus_ar",
  "suspensions",
  "chassis",
  "freins",
  "refroidissement",
];

export type PaceLevel = "lift_and_coast" | "prudente" | "normale" | "soutenue" | "attaque";
export const PACE_LEVELS: PaceLevel[] = ["lift_and_coast", "prudente", "normale", "soutenue", "attaque"];

export type RiskLevel = "bas" | "normal" | "haut";
export const RISK_LEVELS: RiskLevel[] = ["bas", "normal", "haut"];

export type CarColor = string;

export interface CarSettings {
  tirePressure: number;
  groundClearance: number;
  engineMap: number;
  startFuel: number;
}

export interface PlayerRule {
  channel: number;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  effect: { kind: "duration"; hours: number } | { kind: "distance"; km: number } | { kind: "default" };
  mode: "persistante" | "one_shot";
  lastFiredTick?: number;
}

export type RuleCondition = BoolCondition | NumericCondition | CategorialCondition;

export interface BoolCondition {
  kind: "bool";
  variable: string;
  value: boolean;
}

export interface NumericCondition {
  kind: "numeric";
  variable: string;
  operator: "<" | "<=" | ">" | ">=" | "==";
  value: number;
}

export interface CategorialCondition {
  kind: "categorial";
  variable: string;
  value: string;
}

export type RuleAction =
  | { kind: "allure"; level: PaceLevel }
  | { kind: "risque"; level: RiskLevel }
  | { kind: "ravitaillement"; target: { kind: "litres"; litres: number } | { kind: "percent"; percent: number } }
  | { kind: "reparer_organe"; organ: OrganId }
  | { kind: "remplacer_roue"; where: "station" | "bord_piste" }
  | { kind: "dormir"; hours: number; place: "bivouac" | "hotel" }
  | { kind: "depassement"; level: "agressif" | "prudent" | "interdit" }
  | { kind: "defendre_position" }
  | { kind: "appeler_camion" }
  | { kind: "arreter_station" }
  | { kind: "reprendre_route" }
  | { kind: "assistance_rival" }
  | { kind: "set_rule"; channel: number; enabled: boolean };

export const DEFAULT_RULES: PlayerRule[] = [
  {
    channel: 1,
    enabled: true,
    conditions: [{ kind: "bool", variable: "crevaison", value: true }],
    action: { kind: "remplacer_roue", where: "station" },
    effect: { kind: "default" },
    mode: "persistante",
  },
  {
    channel: 2,
    enabled: true,
    conditions: [{ kind: "numeric", variable: "carburant", operator: "<", value: 20 }],
    action: { kind: "ravitaillement", target: { kind: "percent", percent: 100 } },
    effect: { kind: "default" },
    mode: "persistante",
  },
  {
    channel: 3,
    enabled: true,
    conditions: [{ kind: "numeric", variable: "organe_critique", operator: ">=", value: 1 }],
    action: { kind: "reparer_organe", organ: "moteur" },
    effect: { kind: "default" },
    mode: "persistante",
  },
  {
    channel: 4,
    enabled: true,
    conditions: [
      { kind: "bool", variable: "immobilisation", value: true },
    ],
    action: { kind: "appeler_camion" },
    effect: { kind: "default" },
    mode: "persistante",
  },
];

export interface StationWork {
  stationKm: number;
  endsAtTick: number;
  fuelTarget: number | null;
  repairOrgan: OrganId | null;
  replaceWheel: boolean;
  buyWheels: number;
  hotel: boolean;
}

export const TICKS_PER_HOUR = 3600;
export const FUEL_PRICE_PER_LITRE = 1.8;
export const TIRE_PRICE = 120;
export const HOTEL_PRICE = 80;
export const REPAIR_PRICE_BASE: Record<string, number> = { moteur: 500, transmission: 400, pneus_av: 120, pneus_ar: 120, suspensions: 300, chassis: 450, freins: 250, refroidissement: 280 };
export const REPAIR_HOURS: Record<string, number> = { moteur: 4, transmission: 3, pneus_av: 0.75, pneus_ar: 0.75, suspensions: 2, chassis: 3, freins: 1.5, refroidissement: 1.5 };
export const FUEL_TIME_PER_PERCENT = 0.25 / 100;
export const DAILY_PRIME_BASE = 300;
export const DAILY_PRIME_RANK_BONUS = 50;
export const CHALLENGE_PRIME = 150;
export const TRUCK_FIXED_HOURS = 6;
export const ACCIDENT_FAULT_PENALTY = 250;

export interface CarStats {
  distance: number;
  maxSpeed: number;
  pannes: number;
  depenses: number;
  primes: number;
  accidents: number;
  depassements: number;
}

export interface CarState {
  playerId: string;
  color: CarColor;
  positionKm: number;
  fuel: number;
  fuelCapacity: number;
  organs: Record<OrganId, number>;
  fatigue: number;
  speedKmh: number;
  pace: PaceLevel;
  risk: RiskLevel;
  rules: PlayerRule[];
  settings: CarSettings;
  spareWheels: number;
  budget: number;
  arrived: boolean;
  arrivalTime: number | null;
  finisherRank: number | null;
  forfait: boolean;
  allowAssist: boolean;
  immobilized: boolean;
  immobilizedReason: string | null;
  immobilizedUntil: number | null;
  truckCalledTick: number | null;
  crevaison: boolean;
  crevaisonOrgan: OrganId | null;
  sleeping: number;
  sleepPlace: "bivouac" | "hotel" | null;
  stopped: boolean;
  stopUntilTick: number | null;
  stopWork: StationWork | null;
  overtaking: "agressif" | "prudent" | "interdit";
  defending: boolean;
  offsetSeconds: number;
  dailyKm: number;
  dayStartTick: number;
  dailyMaxSpeed: number;
  mentalLog: { tick: number; text: string }[];
  towedBy: string | null;
  transactions: { tick: number; label: string; amount: number }[];
  stats: CarStats;
}

export interface Station {
  km: number;
  name: string;
  hasHotel: boolean;
}

export interface TerrainSegment {
  km: number;
  biome: Biome;
  terrain: TerrainType;
  altitude: number;
  slope: number;
  width: "large" | "moyenne" | "etroite";
}

export interface WorldEvent {
  id: number;
  kind: WeatherKind | "piste_endommagee" | "rocher" | "animal";
  km: number;
  radiusKm: number;
  startTick: number;
  endTick: number;
}

export interface WeatherFront {
  id: number;
  kind: WeatherKind;
  km: number;
  speedKmPerTick: number;
  radiusKm: number;
  startTick: number;
  endTick: number;
}

export interface World {
  seed: number;
  totalKm: number;
  stations: Station[];
  segments: TerrainSegment[];
  villages: { km: number; name: string; traversed: boolean }[];
  rivers: { km: number; name: string }[];
  startName: string;
  endName: string;
}
