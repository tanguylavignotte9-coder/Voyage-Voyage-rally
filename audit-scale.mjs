// AUDIT D'ÉCHELLE: ce que l'utilisateur voit réellement à l'écran.
import { generateWorld } from "./packages/engine/dist/world.js";

const w = generateWorld({ seed: 12345, targetHours: 168 });
const pts = w.points;

// === reproduction EXACTE de la caméra client ===
const PXM = (1200 / 160); // écran 1200px de large / 160 m visibles ≈ 7.5 px/m
console.log("=== ÉCHELLE À L'ÉCRAN (1200×800, zoom 1) ===");
console.log("1 mètre =", PXM.toFixed(1), "px");
console.log("voiture (4.6 m de long):", (4.6 * PXM).toFixed(0), "px");
console.log("route (large, 13 m):", (13 * PXM).toFixed(0), "px de large —", (13 * PXM / 1200 * 100).toFixed(0), "% de l'écran");
console.log("fenêtre visible devant la voiture: 70% de 800px =", (0.7 * 800 / PXM).toFixed(0), "m");
console.log("champ vertical total:", (800 / PXM).toFixed(0), "m");

// === à 60 km/h: vitesse de défilement ===
console.log("\n=== DÉFILEMENT (sensation de vitesse) ===");
const v60 = 60 / 3.6; // m/s
console.log("à 60 km/h: le décor défile à", (v60 * PXM).toFixed(0), "px/s (60 fps =", (v60 * PXM / 60).toFixed(1), "px/frame)");
const v90 = 90 / 3.6;
console.log("à 90 km/h:", (v90 * PXM).toFixed(0), "px/s —", (v90 * PXM / 60).toFixed(1), "px/frame");
console.log("(les jeux de course 2D défilent typiquement à 300-900 px/s)");
// temps de traversée d'un virage
console.log("\n=== VIRAGES: temps de traversée à l'écran ===");
// détecter les virages: |courbure| > 1/250 sur la géométrie réelle
let inTurn = false, turnLen = 0, turns = [];
for (const p of pts) {
  if (Math.abs(p.curvature) > 1 / 250) { inTurn = true; turnLen += 20; }
  else if (inTurn) { turns.push(turnLen); inTurn = false; turnLen = 0; }
}
if (inTurn) turns.push(turnLen);
turns = turns.filter((t) => t >= 40);
const med = turns.sort((a, b) => a - b)[Math.floor(turns.length / 2)];
console.log("virages détectés:", turns.length, "| longueur médiane:", med, "m");
console.log("à 60 km/h, un virage médiane dure:", (med / v60).toFixed(1), "s à l'écran");
console.log("à 60 km/h, le virage fait défiler:", (med * PXM).toFixed(0), "px de route");

// rayon de virage ressenti
let rads = [];
for (const p of pts) { const c = Math.abs(p.curvature); if (c > 1 / 250) rads.push(1 / c); }
rads.sort((a, b) => a - b);
console.log("rayon médian des virages:", rads[Math.floor(rads.length / 2)].toFixed(0), "m | p10:", rads[Math.floor(rads.length * 0.1)].toFixed(0), "m");

// === densité de virages sur 60 km x 3 vitesses ===
console.log("\n=== DYNAMISME: distance entre virages ===");
let gaps = [];
let lastTurnEnd = 0;
inTurn = false; turnLen = 0;
let arcSince = 0;
for (let i = 0; i < pts.length; i++) {
  const p = pts[i];
  if (Math.abs(p.curvature) > 1 / 250) {
    if (!inTurn) { if (arcSince > 40) gaps.push(arcSince); arcSince = 0; inTurn = true; }
  } else if (inTurn) { inTurn = false; }
  arcSince += 20;
}
gaps.sort((a, b) => a - b);
const gmed = gaps[Math.floor(gaps.length / 2)];
console.log("droites entre virages: médiane", gmed, "m | (à 60km/h =", (gmed / v60).toFixed(1), "s entre virages)");
const g10 = gaps[Math.floor(gaps.length * 0.1)];
console.log("gaps p10 (les plus fréquents serrés):", g10, "m =", (g10 / v60).toFixed(1), "s à 60 km/h");
