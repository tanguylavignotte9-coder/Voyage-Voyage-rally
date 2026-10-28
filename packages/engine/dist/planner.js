"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCondition = evaluateCondition;
exports.evaluateConditions = evaluateConditions;
exports.emptyEffects = emptyEffects;
exports.applyAction = applyAction;
exports.findContradictions = findContradictions;
exports.tickPlanner = tickPlanner;
function evaluateCondition(cond, vars) {
    if (cond.kind === "bool") {
        const v = vars[cond.variable];
        return cond.value ? !!v : !v;
    }
    if (cond.kind === "numeric") {
        const v = vars[cond.variable];
        if (typeof v !== "number")
            return false;
        switch (cond.operator) {
            case "<": return v < cond.value;
            case "<=": return v <= cond.value;
            case ">": return v > cond.value;
            case ">=": return v >= cond.value;
            case "==": return v === cond.value;
        }
    }
    if (cond.kind === "categorial") {
        const v = vars[cond.variable];
        return v === cond.value;
    }
    return false;
}
function evaluateConditions(conds, vars) {
    return conds.every((c) => evaluateCondition(c, vars));
}
function emptyEffects() {
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
function lowestWins(current, next) {
    if (!current)
        return true;
    if (!next)
        return false;
    return next.sourceChannel < current.sourceChannel;
}
function applyAction(action, channel, effects, car) {
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
function findContradictions(rules) {
    const errors = [];
    const active = rules.filter((r) => r.enabled && r.conditions.length === 0);
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const a = active[i].action;
            const b = active[j].action;
            if (contradicts(a, b)) {
                errors.push(`Les règles N°${active[i].channel} et N°${active[j].channel} se contredisent (états présents).`);
            }
        }
    }
    return errors;
}
function contradicts(a, b) {
    if (a.kind !== b.kind) {
        const meta = (x) => x.kind === "set_rule" ? null : x.kind;
        return meta(a) !== null && meta(a) === meta(b) && false;
    }
    return false;
}
function tickPlanner(car, vars) {
    const effects = emptyEffects();
    const fired = [];
    const sorted = [...car.rules].sort((a, b) => b.channel - a.channel);
    for (const rule of sorted) {
        if (!rule.enabled)
            continue;
        const condOk = evaluateConditions(rule.conditions, vars);
        if (condOk) {
            applyAction(rule.action, rule.channel, effects, car);
            fired.push(rule.channel);
        }
    }
    for (const t of effects.ruleToggles) {
        const target = car.rules.find((r) => r.channel === t.channel);
        if (target)
            target.enabled = t.enabled;
    }
    return { effects, fired };
}
