import { CarState, PlayerRule, RuleAction, RuleCondition, OrganId } from "./types";
export interface GameVariables {
    crevaison: boolean;
    immobilisation: boolean;
    nuit: boolean;
    en_station: boolean;
    bivouac_en_cours: boolean;
    meteo_active: boolean;
    depassement_en_cours: boolean;
    carburant: number;
    fatigue: number;
    usure: Record<OrganId, number>;
    organe_critique: number;
    vitesse: number;
    km_parcourus: number;
    distance_prochaine_station: number;
    heure: number;
    jour_de_course: number;
    retard_avance: number;
    distance_rival_devant: number;
    distance_rival_derriere: number;
    biome: string;
    typologie_terrain: string;
}
export declare function evaluateCondition(cond: RuleCondition, vars: GameVariables): boolean;
export declare function evaluateConditions(conds: RuleCondition[], vars: GameVariables): boolean;
export interface ActiveEffects {
    pace: {
        level: import("./types").PaceLevel;
        sourceChannel: number;
    } | null;
    risk: {
        level: import("./types").RiskLevel;
        sourceChannel: number;
    } | null;
    fuelTarget: {
        percent: number;
        sourceChannel: number;
    } | null;
    repairOrgan: {
        organ: OrganId;
        sourceChannel: number;
    } | null;
    replaceWheel: {
        where: "station" | "bord_piste";
        sourceChannel: number;
    } | null;
    sleep: {
        hours: number;
        place: "bivouac" | "hotel";
        sourceChannel: number;
    } | null;
    overtaking: {
        level: "agressif" | "prudent" | "interdit";
        sourceChannel: number;
    } | null;
    defending: boolean;
    callTruck: boolean;
    stopAtStation: boolean;
    resumeRoad: boolean;
    assistRival: boolean;
    ruleToggles: {
        channel: number;
        enabled: boolean;
    }[];
}
export declare function emptyEffects(): ActiveEffects;
export declare function applyAction(action: RuleAction, channel: number, effects: ActiveEffects, car: CarState): void;
export declare function findContradictions(rules: PlayerRule[]): string[];
export declare function tickPlanner(car: CarState, vars: GameVariables): {
    effects: ActiveEffects;
    fired: number[];
};
