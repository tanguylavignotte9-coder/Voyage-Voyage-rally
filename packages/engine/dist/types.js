"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RULES = exports.RISK_LEVELS = exports.PACE_LEVELS = exports.ORGANS = void 0;
exports.ORGANS = [
    "moteur",
    "transmission",
    "pneus_av",
    "pneus_ar",
    "suspensions",
    "chassis",
    "freins",
    "refroidissement",
];
exports.PACE_LEVELS = ["lift_and_coast", "prudente", "normale", "soutenue", "attaque"];
exports.RISK_LEVELS = ["bas", "normal", "haut"];
exports.DEFAULT_RULES = [
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
