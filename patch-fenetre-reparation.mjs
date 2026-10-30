// patch-fenetre-reparation.mjs — Voyage-Voyage-rally (branche main)
// Réparation de la fenêtre de conscience (patch 2) — RÉGRESSION découverte
// au premier rejoue de la suite de tests après le push du patch 2 (3 échecs):
//
// 1. FILE MORTE: quand la fenêtre refusait l'engagement, le doublard entrait
//    dans le sillage (vitesse d'État plafonnée à celle du rival) et le filtre
//    de candidats "o.speedKmh < car.speedKmh * DUST" devenait insatisfaisable
//    — plus jamais de candidat, donc plus jamais de ré-engagement à
//    l'ouverture de la fenêtre. -> le filtre compare la vitesse DEMANDÉE.
// 2. VOITURE À L'ARRÊT: une cible quasi immobile gelait le doublard à 0 km/h
//    (position figée = fenêtre figée = boucle sans issue). -> sous 10 km/h,
//    pas de duel possible (garde d'accrochage du modèle): la cible est un
//    obstacle à contourner, la fenêtre ne s'y applique pas.
//
// Mesuré au banc après réparation: 22/22 tests (les 3 tests de dépassement
// du patch 1 repassent: franchissement réel, piste moyenne, voiture à
// l'arrêt). Les tests de conscience du patch 2 restent verts.
//
// 2 diffs, 1 fichier: packages/engine/src/sim.ts.
// Usage: node patch-fenetre-reparation.mjs <racine_du_repo>
// Chaque diff est ancré sur un AVANT unique — échec explicite si le dépôt a dérivé.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || ".";
const P = (f) => join(ROOT, f);

const diffs = [
  {
    file: "packages/engine/src/sim.ts",
    avant: "          o.speedKmh < car.speedKmh * DUST_SPEED_FACTOR &&\n",
    apres: "          // \"plus lent que moi\" se juge sur la vitesse DEMANDÉE ce tick (le\n          // paramètre speed), pas sur car.speedKmh: dans le sillage, la vitesse\n          // d'État est plafonnée à celle du rival, et l'ancien filtre se\n          // désarmait après un premier refus de fenêtre — plus jamais de\n          // candidat, donc plus jamais de ré-engagement quand la fenêtre\n          // s'ouvrait (3 tests de dépassement passés en échec).\n          o.speedKmh < speed * DUST_SPEED_FACTOR &&\n"
  },
  {
    file: "packages/engine/src/sim.ts",
    avant: "        const fenetre = candidate.immobilized\n          ? null\n          : roadAhead(ctx.world, car.positionKm, OVERTAKE_LOOKAHEAD_KM);\n",
    apres: "        // pas de duel possible sous 10 km/h (garde d'accrochage du modèle):\n        // une cible quasi à l'arrêt est un OBSTACLE à contourner, pas un\n        // rival — la fenêtre ne s'y applique pas (l'accrochage est de toute\n        // façon impossible avec elle). Sans cette exemption, le doublard\n        // gelait à 0 km/h derrière une voiture à l'arrêt, à position figée:\n        // fenêtre figée, boucle sans issue.\n        const fenetre = candidate.immobilized || candidate.speedKmh < 10\n          ? null\n          : roadAhead(ctx.world, car.positionKm, OVERTAKE_LOOKAHEAD_KM);\n"
  },
];

for (const d of diffs) {
  const path = P(d.file);
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch (e) {
    console.error(`✗ ${d.file}: fichier introuvable`);
    process.exit(1);
  }
  const n = src.split(d.avant).length - 1;
  if (n !== 1) {
    console.error(`✗ ${d.file}: ancre trouvée ${n} fois (attendu: 1) — dépôt divergé, patch refusé.`);
    process.exit(1);
  }
}
console.log("Ancres vérifiées: " + diffs.length + " diffs.");
for (const d of diffs) {
  const path = P(d.file);
  const src = readFileSync(path, "utf8");
  writeFileSync(path, src.replace(d.avant, d.apres));
  console.log(`✓ ${d.file}`);
}
console.log("Patch appliqué: " + diffs.length + " diffs. (réparation fenêtre de conscience)");
