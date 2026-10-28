import {
  CarState,
  PlayerRule,
  RuleAction,
  RuleCondition,
  OrganId,
  ORGANS,
} from "./types";

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

export function evaluateCondition(cond: RuleCondition, vars: GameVariables): boolean {
  if (cond.kind === "bool") {
    const v = (vars as any)[cond.variable];
    return cond.value ? !!v : !v;
  }
  if (cond.kind === "numeric") {
    const v = (vars as any)[cond.variable];
    if (typeof v !== "number") return false;
    switch (cond.operator) {
      case "<": return v < cond.value;
      case "<=": return v <= cond.value;
      case ">": return v > cond.value;
      case ">=": return v >= cond.value;
      case "==": return v === cond.value;
    }
  }
  if (cond.kind === "categorial") {
    const v = (vars as any)[cond.variable];
    return v === cond.value;
  }
  return false;
}

export function evaluateConditions(conds: RuleCondition[], vars: GameVariables): boolean {
  return conds.every((c) => evaluateCondition(c, vars));
}

export interface ActiveEffects {
  pace: { level: import("./types").PaceLevel; sourceChannel: number } | null;
  risk: { level: import("./types").RiskLevel; sourceChannel: number } | null;
  fuelTarget: { percent: number; sourceChannel: number } | null;
  repairOrgan: { organ: OrganId; sourceChannel: number } | null;
  replaceWheel: { where: "station" | "bord_piste"; sourceChannel: number } | null;
  sleep: { hours: number; place: "bivouac" | "hotel"; sourceChannel: number } | null;
  overtaking: { level: "agressif" | "prudent" | "interdit"; sourceChannel: number } | null;
  defending: boolean;
  callTruck: boolean;
  stopAtStation: boolean;
  resumeRoad: boolean;
  assistRival: boolean;
  ruleToggles: { channel: number; enabled: boolean }[];
}

export function emptyEffects(): ActiveEffects {
  return {
    pace: null,
    risk: null,
    fuelTarget: null,
    repairOrgan: null,
    replaceWheel: null,
    sleep: null,
    overtaking: null,
    defending: false,
    callTruck: false,
    stopAtStation: false,
    resumeRoad: false,
    assistRival: false,
    ruleToggles: [],
  };
}

function lowestWins<T extends { sourceChannel: number }>(current: T | null, next: T | null): boolean {
  if (!current) return true;
  if (!next) return false;
  return next.sourceChannel < current.sourceChannel;
}

export function applyAction(
  action: RuleAction,
  channel: number,
  effects: ActiveEffects,
  car: CarState
): void {
  switch (action.kind) {
    case "allure":
      if (lowestWins(effects.pace, { level: action.level, sourceChannel: channel }))
        effects.pace = { level: action.level, sourceChannel: channel };
      break;
    case "risque":
      if (lowestWins(effects.risk, { level: action.level, sourceChannel: channel }))
        effects.risk = { level: action.level, sourceChannel: channel };
      break;
    case "ravitaillement":
      const pct = action.target.kind === "percent" ? action.target.percent : (action.target.litres / car.fuelCapacity) * 100;
      if (lowestWins(effects.fuelTarget, { percent: pct, sourceChannel: channel }))
        effects.fuelTarget = { percent: pct, sourceChannel: channel };
      break;
    case "reparer_organe":
      if (lowestWins(effects.repairOrgan, { organ: action.organ, sourceChannel: channel }))
        effects.repairOrgan = { organ: action.organ, sourceChannel: channel };
      break;
    case "remplacer_roue":
      if (lowestWins(effects.replaceWheel, { where: action.where, sourceChannel: channel }))
        effects.replaceWheel = { where: action.where, sourceChannel: channel };
      break;
    case "dormir":
      if (!effects.sleep || effects.sleep.hours < action.hours)
        effects.sleep = { hours: action.hours, place: action.place, sourceChannel: channel };
      break;
    case "depassement":
      if (lowestWins(effects.overtaking, { level: action.level, sourceChannel: channel }))
        effects.overtaking = { level: action.level, sourceChannel: channel };
      break;
    case "defendre_position":
      effects.defending = true;
      break;
    case "appeler_camion":
      effects.callTruck = true;
      break;
    case "arreter_station":
      effects.stopAtStation = true;
      break;
    case "reprendre_route":
      effects.resumeRoad = true;
      break;
    case "assistance_rival":
      effects.assistRival = true;
      break;
    case "set_rule":
      effects.ruleToggles.push({ channel: action.channel, enabled: action.enabled });
      break;
  }
}

export function findContradictions(rules: PlayerRule[]): string[] {
  const errors: string[] = [];
  const active = rules.filter((r) => r.enabled && r.conditions.length === 0);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i].action;
      const b = active[j].action;
      if (contradicts(a, b)) {
        errors.push(
          `Les règles N°${active[i].channel} et N°${active[j].channel} se contredisent (états présents).`
        );
      }
    }
  }
  return errors;
}

function contradicts(a: RuleAction, b: RuleAction): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "allure":
    case "risque":
    case "depassement":
      return (a as any).level !== (b as any).level;
    case "dormir":
      return (a as any).hours !== (b as any).hours || (a as any).place !== (b as any).place;
    case "ravitaillement":
      return (a as any).target.percent !== (b as any).target.percent || (a as any).target.litres !== (b as any).target.litres;
    case "remplacer_roue":
      return (a as any).where !== (b as any).where;
    case "set_rule":
      return (a as any).channel === (b as any).channel && (a as any).enabled !== (b as any).enabled;
    default:
      return false;
  }
}

export function tickPlanner(car: CarState, vars: GameVariables): { effects: ActiveEffects; fired: number[] } {
  const effects = emptyEffects();
  const fired: number[] = [];
  const sorted = [...car.rules].sort((a, b) => b.channel - a.channel);
  for (const rule of sorted) {
    if (!rule.enabled) continue;
    const condOk = evaluateConditions(rule.conditions, vars);
    if (condOk) {
      applyAction(rule.action, rule.channel, effects, car);
      fired.push(rule.channel);
    }
  }
  for (const t of effects.ruleToggles) {
    const target = car.rules.find((r) => r.channel === t.channel);
    if (target) target.enabled = t.enabled;
  }
  return { effects, fired };
}
