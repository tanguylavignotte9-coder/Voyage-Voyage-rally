// Calibration réaliste — rallye raid (référence : Dakar, catégorie auto)
// Toutes les valeurs sont en unités réelles : km/h, litres, %/km, €.

// ---------- Vitesses de référence (allure soutenue, piste plate, conditions claires) ----------
// Vitesse de base du véhicule (moteur 100%, carto neutre).
export const BASE_SPEED_KMH = 90;

// Facteurs d'allure (multiplicateurs de vitesse).
export const PACE_SPEED_FACTOR: Record<string, number> = {
  lift_and_coast: 0.6, // conduite économe, lever le pied tôt
  prudente: 0.78,
  normale: 0.9,
  soutenue: 1.0,
  attaque: 1.12, // très exigeant mécaniquement
};

// Vitesse de croisière par typologie de terrain (km/h, à soutenue).
export const TERRAIN_SPEED_KMH: Record<string, number> = {
  piste_rapide: 130, // liaison rapide, piste roulante
  piste_moyenne: 95,
  piste_mauvaise: 70,
  regs: 85, // plat caillouteux du désert, on peut y aller vite
  dunes: 55, // franchissement, beaucoup de régime
  pierrier: 50,
  col: 45, // montagne, épingles
  bourbier: 35,
  marécage: 30,
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
export const RISK_SPEED_BONUS: Record<string, number> = { bas: 0.95, normal: 1.0, haut: 1.08 };
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
