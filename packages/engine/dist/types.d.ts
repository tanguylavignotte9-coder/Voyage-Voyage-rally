export type Biome = "desert" | "montagne" | "steppe" | "humide";
export type TerrainType = "piste_rapide" | "piste_moyenne" | "piste_mauvaise" | "dunes" | "regs" | "pierrier" | "col" | "bourbier" | "marécage";
export type WeatherKind = "clair" | "pluie_diluvienne" | "tempete_sable" | "canicule" | "froid_intense" | "brouillard" | "vent_fort" | "grele";
export type OrganId = "moteur" | "transmission" | "pneus_av" | "pneus_ar" | "suspensions" | "chassis" | "freins" | "refroidissement";
export declare const ORGANS: OrganId[];
export type PaceLevel = "lift_and_coast" | "prudente" | "normale" | "soutenue" | "attaque";
export declare const PACE_LEVELS: PaceLevel[];
export type RiskLevel = "bas" | "normal" | "haut";
export declare const RISK_LEVELS: RiskLevel[];
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
    effect: {
        kind: "duration";
        hours: number;
    } | {
        kind: "distance";
        km: number;
    } | {
        kind: "default";
    };
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
export type RuleAction = {
    kind: "allure";
    level: PaceLevel;
} | {
    kind: "risque";
    level: RiskLevel;
} | {
    kind: "ravitaillement";
    target: {
        kind: "litres";
        litres: number;
    } | {
        kind: "percent";
        percent: number;
    };
} | {
    kind: "reparer_organe";
    organ: OrganId;
} | {
    kind: "remplacer_roue";
    where: "station" | "bord_piste";
} | {
    kind: "dormir";
    hours: number;
    place: "bivouac" | "hotel";
} | {
    kind: "depassement";
    level: "agressif" | "prudent" | "interdit";
} | {
    kind: "defendre_position";
} | {
    kind: "appeler_camion";
} | {
    kind: "arreter_station";
} | {
    kind: "reprendre_route";
} | {
    kind: "assistance_rival";
} | {
    kind: "set_rule";
    channel: number;
    enabled: boolean;
};
export declare const DEFAULT_RULES: PlayerRule[];
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
    crevaison: boolean;
    sleeping: number;
    stopped: boolean;
    overtaking: "agressif" | "prudent" | "interdit";
    defending: boolean;
    offsetSeconds: number;
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
    villages: {
        km: number;
        name: string;
        traversed: boolean;
    }[];
    rivers: {
        km: number;
        name: string;
    }[];
    startName: string;
    endName: string;
}
