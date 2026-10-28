// Calibration réaliste — rallye raid (référence : Dakar, catégorie auto)
// Toutes les valeurs sont en unités réelles : km/h, litres, %/km, €.

// ========== MODÈLE PHYSIQUE ÉMERGENT (plus de hardcaps) ==========
// La vitesse n'est JAMAIS plafonnée par une table: elle émerge de l'équilibre
// des forces à chaque tick. P_traCTION disponible = P_max × allure × risque;
// forces opposées: roulement (terrain), traînée aéro (∝ v²), gravité (pente),
// tenue de route (virage). On résout P/v = ΣF (itération rapide).
export const CAR_MASS_KG = 1900;
export const CAR_POWER_W = 246000;          // 330 ch — une vraie préparation raid
export const TRANSMISSION_EFF = 0.62;       // rendement roue: boîte+pont+pertes
export const ALTITUDE_POWER_LOSS = 0.13;    // la puissance chute avec l altitude (air raréfié)
export const AERO_DRAG_COEFF = 0.85;        // Cx × S d'un SUV
export const AIR_DENSITY = 1.2;
// coefficient de roulement par terrain (Cr — le "grip/roughness" réel)
export const ROLLING_RES: Record<string, number> = {
  piste_rapide: 0.014,
  piste_moyenne: 0.03,
  piste_mauvaise: 0.055,
  regs: 0.04,
  dunes: 0.10,
  pierrier: 0.075,
  col: 0.06,
  bourbier: 0.12,
  marécage: 0.15,
};
// adhérence latérale (μ) par terrain — borne la force centripète en virage
export const LATERAL_GRIP: Record<string, number> = {
  piste_rapide: 0.75,
  piste_moyenne: 0.65,
  piste_mauvaise: 0.5,
  regs: 0.55,
  dunes: 0.45,
  pierrier: 0.45,
  col: 0.5,
  bourbier: 0.35,
  marécage: 0.3,
};

// ---------- (legacy: allures = FRACTION DE PUISSANCE ÉMOTIONNELLE, pas vitesse) ----------
export const BASE_SPEED_KMH = 105;

// Facteurs d'allure (multiplicateurs de vitesse).
// L'allure = puissance MOTRICE consentie (lift_and_coast = on économique).
// La vitesse qui en découle émerge de la physique du moment.
export const PACE_SPEED_FACTOR: Record<string, number> = {
  lift_and_coast: 0.35,
  prudente: 0.5,
  normale: 0.7,
  soutenue: 0.88,
  attaque: 1.0, // 100% de la puissance — l'environnement décide du reste
};

// Vitesse de croisière par typologie de terrain (km/h, à soutenue).
export const TERRAIN_SPEED_KMH: Record<string, number> = {
  piste_rapide: 175, // liaison rapide: on y tient le 200 en attaque
  piste_moyenne: 115,
  piste_mauvaise: 75,
  regs: 95,
  dunes: 60,
  pierrier: 55,
  col: 50,
  bourbier: 40,
  marécage: 35,
};

// ---------- Carburant ----------
export const FUEL_CAPACITY_L = 400; // réservoir type rallye raid auto
export const FUEL_BASE_L_PER_100KM = 35; // à allure normale sur piste moyenne
export const FUEL_TERRAIN_FACTOR: Record<string, number> = {
  piste_rapide: 0.8,
  piste_moyenne: 1.0,
  piste_mauvaise: 1.3,
  regs: 1.2,
  dunes: 1.5, // le sable avale le carburant
  pierrier: 1.6,
  col: 1.7,
  bourbier: 2.0,
  marécage: 2.4,
};
// ---------- Énergie de gravité (pente) ----------
// slope en ‰ (mètres par km). Physique de l'énergie :
// - montée : il faut vaincre m·g·h — surconso proportionnelle à la pente ;
// - descente : le frein moteur fait l'affaire — la conso chute vers le ralenti,
//   sans jamais atteindre zéro (le moteur tourne toujours).
// référence : ~2 t, 35 L/100 km de base ≈ 12 kWh d'énergie utile / 100 km.
// Monter 10 ‰ sur 1 km = 20 000 kg·m·g ≈ 0,054 kWh... la chimie thermique
// gaspille ~3x : on calibre le facteur sur l'observable Dakar (cols = soif).
export const GRAVITY_UP_PER_MILLE = 0.028;   // +2.8 % de conso par ‰ de montée
export const GRAVITY_DOWN_PER_MILLE = 0.022; // -2.2 % de conso par ‰ de descente
export const IDLE_CONSUMPTION_FLOOR = 0.45;  // plancher : jamais sous 45 % (ralenti + accessoires)

export function slopeConsumptionFactor(slopeMilli: number): number {
  if (slopeMilli > 0) return 1 + slopeMilli * GRAVITY_UP_PER_MILLE;
  const down = 1 - (-slopeMilli) * GRAVITY_DOWN_PER_MILLE;
  return Math.max(IDLE_CONSUMPTION_FLOOR, down);
}

export const PACE_CONSUMPTION_FACTOR: Record<string, number> = {
  lift_and_coast: 0.65,
  prudente: 0.8,
  normale: 1.0,
  soutenue: 1.2,
  attaque: 1.25,
};

// ---------- Usure par organe (%/km, allure normale, piste moyenne, risque normal) ----------
// Vies de référence : pneus ~2000 km, freins plaquettes ~4000 km (descente ×3),
// moteur ~8000 km, suspensions ~7000 km, refroidissement ~6000 km (poussière),
// transmission ~9000 km, châssis ~15000 km.
export const WEAR_PER_KM: Record<string, number> = {
  moteur: 0.0125,
  transmission: 0.011,
  pneus_av: 0.05,
  pneus_ar: 0.05,
  suspensions: 0.014,
  chassis: 0.006,
  freins: 0.025,
  refroidissement: 0.017,
};

// Multiplicateur d'usure par terrain (contrainte mécanique réelle).
export const WEAR_TERRAIN_FACTOR: Record<string, number> = {
  piste_rapide: 0.5,
  piste_moyenne: 1.0,
  piste_mauvaise: 1.6,
  regs: 1.3,
  dunes: 2.8,
  pierrier: 2.2,
  col: 2.4,
  bourbier: 2.6,
  marécage: 3.0,
};

// Multiplicateur d'usure par organe sous météo défavorable.
export const WEAR_ORGAN_WEATHER: Record<string, Record<string, number>> = {
  moteur: { canicule: 1.6 },
  refroidissement: { tempete_sable: 2.0, canicule: 1.6, pluie_diluvienne: 1.3 },
  pneus_av: { tempete_sable: 1.3, canicule: 1.2 },
  freins: {},
};

// ---------- Fatigue ----------
// Points de fatigue par heure de conduite (jauge 0-100, ~18 h de route à normale = épuisement).
export const FATIGUE_PER_HOUR: Record<string, number> = {
  lift_and_coast: 3.5,
  prudente: 4,
  normale: 5.5,
  soutenue: 7,
  attaque: 9,
};
export const FATIGUE_NIGHT_FACTOR = 1.7; // rouler de nuit fatigue plus vite
export const FATIGUE_WEATHER_FACTOR = 1.3; // météo active
export const FATIGUE_RECOVERY_BIVOUC_PER_HOUR = 9; // sommeil réparateur, pas complet
export const FATIGUE_RECOVERY_HOTEL_PER_HOUR = 14; // récupération complète

// ---------- Risque ----------
// Le risque = audace dans les limites physiques: on accepte d'approcher
// la limite d'adhérence (haut) ou on garde de la marge (bas).
export const RISK_SPEED_BONUS: Record<string, number> = { bas: 0.85, normal: 1.0, haut: 1.1 };
export const RISK_WEAR_FACTOR: Record<string, number> = { bas: 0.6, normal: 1.0, haut: 1.8 };
export const RISK_CONSUMPTION_FACTOR: Record<string, number> = { bas: 0.9, normal: 1.0, haut: 1.18 };
export const RISK_ACCIDENT_FACTOR: Record<string, number> = { bas: 0.3, normal: 1.0, haut: 2.6 };

// ---------- Pannes probabilistes (par heure, au-delà du seuil critique 80 %) ----------
// usure 80-100% : de 0.2 %/h à 2.5 %/h de chance de casse, ×facteur risque.
export const BREAKDOWN_BASE_PER_HOUR = 0.002;
export const ACCIDENT_FATIGUE_PER_HOUR = 0.006; // par point de fatigue au-dessus de 70
export const DEBRIS_BASE_PER_HOUR = 0.02; // rocher/animal : événement par voiture

// ---------- Réglages voiture (0-100, défaut 50) ----------
export function settingsEffects(s: { tirePressure: number; groundClearance: number; engineMap: number }): {
  speedHard: number; speedSand: number; speedRocks: number;
  consumption: number; power: number;
} {
  const t = (s.tirePressure - 50) / 50; // -1..1
  const g = (s.groundClearance - 50) / 50;
  const m = (s.engineMap - 50) / 50;
  return {
    speedHard: 1 + t * 0.12,        // pression haute = vite sur piste dure
    speedSand: 1 - t * 0.18,       // pression basse = accroche sable
    speedRocks: 1 + g * 0.15,      // garde haute = dunes/rochers
    consumption: 1 + m * 0.25,     // carto poussée = soif
    power: 1 + m * 0.10,          // carto poussée = puissance
  };
}

// ---------- Masse variable ----------
export const WEIGHT_SPEED_PENALTY_FULL = 0.07; // plein réservoir = jusqu'à -7 % de vitesse

// ---------- Économie (€) ----------
export const BUDGET_START = 8000;
export const FUEL_PRICE_PER_LITRE = 2.2;
export const TIRE_PRICE = 450;
export const HOTEL_PRICE = 220;
export const REPAIR_PRICE_BASE: Record<string, number> = {
  moteur: 1800,
  transmission: 1400,
  pneus_av: 450,
  pneus_ar: 450,
  suspensions: 900,
  chassis: 1500,
  freins: 700,
  refroidissement: 800,
};
// Durées de réparation à la station (h) — préventif (usure faible) plus court que curatif.
export const REPAIR_HOURS: Record<string, number> = {
  moteur: 4,
  transmission: 3,
  pneus_av: 0.75,
  pneus_ar: 0.75,
  suspensions: 2,
  chassis: 3,
  freins: 1.5,
  refroidissement: 1.5,
};
export const DAILY_PRIME_BASE = 900;
export const DAILY_PRIME_RANK_BONUS = 300;
export const CHALLENGE_PRIME = 400;
export const ACCIDENT_FAULT_PENALTY = 900;
