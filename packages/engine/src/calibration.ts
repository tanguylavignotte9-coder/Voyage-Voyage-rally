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

// ========== USURE ÉMERGENTE: loi contrainte -> fatigue matérielle ==========
// L'usure d'un organe découle de la CONTRAINTE qu'il subit ce tick, pas d'une
// table au km. Chaque organe a une résistante (charge nominale) et une
// loi d'endommagement (à la Paris: dommage ∝ (contrainte/limite)^n, n>1 —
// proche de la limite, l'usure explose; en dessous, quasi négligeable).
export interface OrganLoadModel {
  // contrainte du tick en Newton (calculée depuis les forces physiques)
  // -> dommage = K_organ × (contrainte / chargeNominale)^n × dt
  nominalLoadN: number;   // charge de conception (durée de vie nominale)
  expo: number;           // exposant de la loi d'endommagement (>1 = seuil mou)
  damagePerHourAtNominal: number; // %/h d'usure à charge nominale
}

export const ORGAN_MODELS: Record<string, OrganLoadModel> = {
  // nominale ~ 2.2× la charge statique de l'organe (m·g/4 ≈ 5450 N):
  // en usage doux on vit à 0.3-0.6×nominale, en raid dur 0.8-1.1×,
  // les extrêmes dépassent.
  moteur:        { nominalLoadN: 9500,  expo: 2.6, damagePerHourAtNominal: 0.16 },
  transmission:  { nominalLoadN: 9500,  expo: 2.8, damagePerHourAtNominal: 0.13 },
  pneus_av:      { nominalLoadN: 12000, expo: 2.2, damagePerHourAtNominal: 0.20 },
  pneus_ar:      { nominalLoadN: 12000, expo: 2.2, damagePerHourAtNominal: 0.22 },
  suspensions:   { nominalLoadN: 13500, expo: 2.4, damagePerHourAtNominal: 0.18 },
  chassis:       { nominalLoadN: 16000, expo: 3.0, damagePerHourAtNominal: 0.08 },
  freins:        { nominalLoadN: 9000,  expo: 2.0, damagePerHourAtNominal: 0.13 },
  refroidissement: { nominalLoadN: 8500, expo: 2.5, damagePerHourAtNominal: 0.12 },
};

// PANNE = ÉCHEC DE CHARGE: quand la contrainte dépasse la RÉSISTANCE RÉSIDUELLE
// de l'organe (usure + aléa matérielle), il cède. Plus d'échelle 80%: un organe
// à 40% usé soumis à une contrainte énorme (réception de saut à 200 km/h)
// peut casser NET; un organe à 90% tenu gentil peut survivre des heures.
export const STRENGTH_SCATTER = 0.18; // dispersion matérielle (σ/μ ~18%)
export const WEATHER_STRESS: Record<string, number> = {
  // la météo STRESSE les organes (facteur de charge, pas un multiplicateur d'usure)
  tempete_sable: 1.35, canicule: 1.25, pluie_diluvienne: 1.2, grele: 1.15,
  froid_intense: 1.15, vent_fort: 1.1, brouillard: 1.0, clair: 1.0,
};

// ---------- (legacy supprimé progressivement) Usure par organe ----------
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

// ========== EFFETS MÉTÉO SUR LA CONDUITE (multiplicateurs adhérence/puissance) ==========
export const WEATHER_GRIP_EFFECT: Record<string, number> = {
  tempete_sable: 0.55, pluie_diluvienne: 0.55, piste_endommagee: 0.8,
  brouillard: 1.0, grele: 1.0, vent_fort: 1.0, canicule: 1.0, froid_intense: 1.0, clair: 1.0,
};
export const WEATHER_POWER_EFFECT: Record<string, number> = {
  tempete_sable: 0.7, pluie_diluvienne: 0.7, piste_endommagee: 0.75,
  brouillard: 0.8, grele: 0.8, vent_fort: 0.8, canicule: 0.92, froid_intense: 0.92, clair: 1.0,
};

// ========== CONDUITE (comportement du pilote) ==========
export const DARING_BY_RISK = { haut: 1.0, bas: 0.72, normal: 0.88 };
export const NIGHT_POWER_LOSS = 0.25;        // on lève le pied la nuit (ligne droite)
export const NIGHT_AUDACITY_LOSS = 0.35;    // on réduit l'audace en virage la nuit
export const FATIGUE_POWER_START = 70;      // la fatigue commence à peser sur la puissance
export const FATIGUE_POWER_RATE = 0.3;      // intensité de la perte (par point au-dessus du seuil)
export const FATIGUE_AUDACITY_RATE = 0.4;   // idem sur l'audace en virage
export const CURVE_REF_RADIUS_M = 90;      // rayon de référence de la courbure normalisée
export const CURVE_MIN_NORMALIZED = 0.001;  // en dessous: considéré droit
export const TOWING_SPEED_FACTOR = 0.65;   // on tire une autre auto
export const FUEL_DENSITY_KG_PER_L = 0.8;  // masse de l'essence
export const WHEEL_DRIVE_EFF = 0.9;        // 4 roues motrices: efficacité de la motricité
export const GRAVITY = 9.81;

// ========== INTERACTIONS TRAFIC ==========
export const DRAFT_GAP_MIN_KM = 0.02, DRAFT_GAP_MAX_KM = 0.3;   // aspiration
export const DRAFT_SPEED_DIFF = 8;                                // km/h de tolérance
export const DUST_GAP_KM = 0.05;               // dans la poussière: malus
export const DUST_SPEED_FACTOR = 0.9;
export const DUST_FATIGUE_PER_TICK = 0.01;

// ========== DÉPASSEMENT SPATIAL ==========
// Les voitures vivent sur un axe (positionKm) + un déport latéral (lateral, m).
// Le dépassement est une manœuvre réelle en 3 phases (approche → côte à côte →
// décrochage) qui se termine par un VRAI franchissement de position. L'accrochage
// ne se tire QU'en côte à côte (chevauchement réel) — plus jamais à distance.
export const OVERTAKE_GAP_MAX_KM = 0.15;        // fenêtre d'engagement (init de manœuvre)
export const TRACK_WIDTH_M = { large: 12, moyenne: 7.5, etroite: 4.5 }; // largeur de piste par segment
export const CAR_WIDTH_M = 1.9;                 // largeur d'une voiture
export const CAR_LEN_M = 4.3;                   // longueur — franchissement = écart > CAR_LEN
export const LAT_RATE_M_S = 3.2;                // vitesse de déport latéral (m/s)
export const ALONGSIDE_OVERLAP_M = 8;          // |écart| < 8 m => chevauchement (côte à côte)
export const SIDE_CLEARANCE_M = 0.5;           // marge latérale minimale côte à côte
export const SIDE_EDGE_MARGIN_M = 0.15;        // distance au bord de piste lors d'un dépassement
export const OVERTAKE_ALONGSIDE_SPEED_DELTA = 15; // écart de vitesse max en côte à côte (km/h)
export const OVERTAKE_ACC_PER_S = { agressif: 0.12, prudent: 0.012, interdit: 0 }; // accrochage/s en côte à côte
export const OVERTAKE_ACC_RISK = { haut: 2.2, normal: 1, bas: 0.35 };
export const OVERTAKE_ACC_CURVE_MIN = 0.4;      // risque plancher, même en ligne droite
export const OVERTAKE_ACC_CURVE_GAIN = 2.1;     // le virage multiplie le risque (max ×2,5 à R=90 m)
export const DEFEND_ACC_FACTOR = 1.8;           // défenseur qui tique: risque accru
export const OFFLINE_SPEED_PENALTY = 0.94;      // rouler au bord de la piste en virage
export const OVERTAKE_FAIL_COOLDOWN_S = 8;     // délai avant nouvelle tentative après échec
export const OVERTAKE_LOOKAHEAD_KM = 0.6;      // conscience: fenêtre de lecture du tracé avant engagement
export const OVERTAKE_WINDOW_CURVE_MAX = 0.15; // courbure max dans la fenêtre (0,15 = vrai virage)

// ========== STATION / RÉPARATION ==========
export const FUEL_TIME_PER_PERCENT = 0.25 / 100;  // heures de plein par % de réservoir
export const WHEEL_CHANGE_HOURS = 0.5;
export const REPAIR_TIME_MIN_SHARE = 0.4;          // courbe de temps: part fixe
export const REPAIR_TIME_WEAR_SHARE = 0.6;         // + part proportionnelle à l'usure
export const REPAIR_PRICE_MIN_SHARE = 0.6;        // idem pour le prix
export const REPAIR_PRICE_WEAR_SHARE = 0.6;
export const ORGAN_CRITICAL_WEAR = 80;             // seuil indicateur (lecture, canal par défaut N°3)
export const ORGAN_WARN_WEAR = 60;                // seuil symptôme vague
export const DIAG_ORGAN_MENTION = 60;            // l'atelier mentionne au-delà de

// ========== SIGNEAUX DE JEU ==========
export const MENTAL_LOG_MAX = 200;
export const STATION_PROXIMITY_KM = 0.3;          // fenêtre de détection d'une station
export const FATIGUE_HEAVY_EYES = 70;             // pensées: paupières lourdes
export const FATIGUE_DANGER = 85;                 // pensées: danger

// ========== CHARGES D'ORGANES (répartition des forces, en parts) ==========
export const AERO_HALF = 0.5;                    // ½·ρ·Cx·S (le 0.5 de la formule de traînée)
export const CONVERGENCE_DAMPING = 0.5;         // amorti de l'itération d'équilibre vitesse
export const CONVERGENCE_EPS = 0.05;            // seuil de convergence (m/s)
export const FUEL_TIME_H_PER_L = 0.0042;        // heures de plein par litre (≈15 min les 400 L)

// répartition des charges par organe (parts de statWheel/shock/traction)
export const LOAD_SHOCK_GAIN = 0.00025;        // chocs: mass·v²·Cr·gain
export const LOAD_BUMP_CR_GAIN = 9;            // facteur de bosse: Cr × gain
export const LOAD_BUMP_V_REF = 33;             // vitesse de référence de bosse (m/s)
export const LOAD_SUSP_OVER_STATIC = 1.15;      // suspensions au-delà de la jambe statique
export const LOAD_TIRE_SHOCK_AV = 0.55, LOAD_TIRE_SHOCK_AR = 0.45; // répartition chocs pneus
export const LOAD_TIRE_TRACTION_SHARE = 0.12; // part traction sur pneu arrière
export const LOAD_CHASSIS_STATIC_SHARE = 0.35, LOAD_CHASSIS_SHOCK_SHARE = 0.6;
export const LOAD_ENGINE_NIGHT_EXTRA = 0.1;    // moteur: la nuit, on force (chaleur)
export const LOAD_COOLANT_TRACTION_SHARE = 0.55, LOAD_COOLANT_STRESS_N = 9000;
export const LOAD_COOLANT_UPHILL = 1.3, LOAD_UPHILL_REF_PERMILLE = 40;
export const LOAD_BRAKES_DOWNHILL_N = 1.1, LOAD_BRAKES_STATIC_SHARE = 0.04;
export const LOAD_TRANSMISSION_OVER = 1.05;    // boîte au-delà de la traction moteur

// accident: vigueur et excès
export const VIGOR_LOSS_PER_FATIGUE = 0.0035;    // perte de vigueur par point de fatigue (0.35/100)
export const ACCIDENT_EXCESS_GAIN = 0.02;       // probabilité d'accident par excès²
export const ACCIDENT_GRAVITY_DIV = 2, ACCIDENT_GRAVITY_RAND = 0.3;
export const ACCIDENT_DMG_BASE = 25, ACCIDENT_DMG_RAND = 20;
export const DEBRIS_BASE_CHANCE = 0.012;        // densité de base des débris
export const DEBRIS_DENSITY = { pierrier: 3, regs: 2, dunes: 1.2, defaut: 1 };
export const DEBRIS_SPEED_REF = 30;             // vitesse de référence (m/s)
export const DEBRIS_RISK_FACTOR = { haut: 1.6, normal: 1, bas: 0.6 };
export const DEBRIS_ANIMAL_FATIGUE = 2;          // fatigue d'une manœuvre d'évitement

// ========== DERNIERS COEFFICIENTS SIM ==========
export const OVERTAKE_NIGHT_GRIP_LOSS = 0.3;   // l'obscurité réduit l'adhérence exploitée (μ)
export const RAIN_GRIP_FACTOR = 0.6;           // pluie/tempête de sable: l'adhérence chute

// ========== GÉNÉRATEUR DE MONDE ==========
export const GEN_END_SHARE = 0.5;              // B à 50% de l'arc cible (marge sinueux)
export const GEN_WAYPOINT_MIN_STEP_M = 2000;   // dernier waypoint serré à l'arrivée
export const GEN_LATERAL_SPREAD = 0.45;        // amplitude d'errance latérale des waypoints
export const GEN_LATERAL_STEP = 0.4;           // écart candidats latéraux
export const GEN_PROG_MIN_SHARE = 0.45;        // progression minimale vers B par saut
export const GEN_WET_COST_THRESHOLD = 0.5;     // au-delà: le sol coûte
export const GEN_DETAIL_EXPONENT = 1.5, GEN_DETAIL_GAIN = 2.0;
export const GEN_DETOUR_COST = 0.05;           // coût de détour par candidat
export const GEN_HAIRPIN_MIN_DEFLECTION = 1.9; // épingle: déflexion min (rad)
export const GEN_HAIRPIN_MAX_SHARE = 0.98;     // épingle: part de π
export const GEN_STRAIGHT_DRIFT_CORRECTION = 0.035; // rappel du cap vers B sur les droites
export const GEN_CURV_PHASE_EASE = 0.5;        // lissage courbure dans l'arc
export const GEN_COUNTER_STEER = 0.7;          // contre-braquage du relief (veto)
export const GEN_CONTINENTAL_MIN = 0.4, GEN_CONTINENTAL_GAIN = 0.6, GEN_ALT_BASE_SHARE = 0.5;
export const CONVERGENCE_EFF = 0.98;   // rendement d'équilibre énergie (stabilité numérique)
export const CONVERGENCE_V_MIN = 0.5;  // plancher de vitesse de l'itération (m/s)

// ========== BOÎTE DE VITESSES (6 rapports) ==========
// Chaque rapport a ses ratios; le couple roue = couple_moteur(ω) × ratio × rendement.
// Courbe de couple: monte vers un régime optimal (~3200 tr/min), s'effondre après
// la zone rouge. Le passage de rapport choisit le meilleur couple disponible.
export const ENGINE_IDLE_RPM = 900;
export const ENGINE_OPTIMAL_RPM = 3200;    // pic de couple
export const ENGINE_REDLINE_RPM = 5200;
export const ENGINE_MAX_TORQUE_NM = 520;   // couple moteur au pic (N·m)
export const GEAR_RATIOS = [4.2, 2.6, 1.8, 1.35, 1.05, 0.85]; // 1re..6e (boîte+pont)
export const GEAR_FINAL_DRIVE = 3.9;       // renvoi différentiel
export const WHEEL_RADIUS_M = 0.42;        // roue de raid 35"
export const ENGINE_INERTIA_FACTOR = 0.04; // inertie de rotation (masse équivalente)

// courbe de couple normalisée (0..1 du couple max) selon le régime
export function torqueCurve(rpm: number): number {
  if (rpm < ENGINE_IDLE_RPM) return 0.3; // embrayage glisse
  if (rpm >= ENGINE_REDLINE_RPM) return 0.15; // zone rouge bridée
  const rise = Math.min(1, (rpm - ENGINE_IDLE_RPM) / (ENGINE_OPTIMAL_RPM - ENGINE_IDLE_RPM));
  const past = Math.max(0, (rpm - ENGINE_OPTIMAL_RPM) / (ENGINE_REDLINE_RPM - ENGINE_OPTIMAL_RPM));
  return Math.min(1, 0.55 + 0.45 * rise - 0.55 * past * past);
}
