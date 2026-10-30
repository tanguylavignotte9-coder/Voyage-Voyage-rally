// patch-correctifs-ui.mjs — Voyage-Voyage-rally (branche main)
// Quatre correctifs d'interface, diagnostic vérifié au banc sur main
// (après patch 1 "dépassement spatial" + patch 2 "fenêtre de conscience") :
//
// 1. SACCADE "rollback" ~1 s: le serveur émet un état toutes les ~500 ms mais
//    la position n'avance qu'une fois par tick (1 s); le client ré-ancrait
//    son extrapolation sur CHAQUE état — donc deux fois par position, et la
//    voiture "repartait en arrière" à chaque doublon. -> re-ancrage uniquement
//    sur les états qui font progresser la voiture + lissage du point de rendu.
// 2. SUPERPOSITIONS TEXTE: l'allure écrasait la météo (x fixes 90/100) et les
//    étiquettes ACCÉL/FREIN débordaient sur la barre de régime.
//    -> positionnement par largeur mesurée + HUD conduite rehaussé (86->96).
// 3. RPM FIGÉ: le bloc HUD du moteur lisait la vitesse d'équilibre moteur
//    AVANT les limites physiques (virage, remorquage) — le régime restait
//    celui du "souhait" (constaté au banc: 3874 tr/min figés pendant que la
//    vitesse passait de 185 à 123 km/h). -> régime, rapport et frein calculés
//    sur la vitesse réellement tenue; le frein s'affiche aussi en virage.
// 4. BANDEAU ROUGE "en pause" au départ: affiché dès !started (au lieu d'une
//    vraie pause) et position:absolute plein écran -> recouvrait la barre du
//    bouton Départ. -> bandeau réservé à la pause vraie, déplacé DANS #camera.
//
// 13 diffs, 4 fichiers: engine/src/sim.ts, client/src/main.ts (x8),
// server/public/index.html (x2), engine/src/engine.test.ts (x2).
// 1 nouveau test moteur (régime = vitesse tenue) -> 22 tests attendus.
//
// Usage: node patch-correctifs-ui.mjs <racine_du_repo>
// Chaque diff est ancré sur un AVANT unique — échec explicite si le dépôt a dérivé.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2] || ".";
const P = (f) => join(ROOT, f);

const diffs = [
  {
    file: "packages/engine/src/sim.ts",
    avant: "  // état moteur exposé (HUD pédales/régime/rapport)\n  {\n    const gi = gearFor(v);\n    car.gear = gi + 1;\n    car.rpm = Math.max(ENGINE_IDLE_RPM, v / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI));\n    car.throttle = Math.min(1, throttleShare);\n    car.brake = slopeFrac < -0.015 ? Math.min(1, -slopeFrac * 8) : 0;\n  }\n  // le virage borne par la physique (pas un cap arbitraire: c'est l'adhérence)\n  if (vTurnEff < v) v = vTurnEff;\n  // remorquage: force supplémentaire (on tire une autre auto)\n  if (car.towedBy) v *= TOWING_SPEED_FACTOR;\n  return Math.max(0, v * 3.6); // m/s -> km/h\n",
    apres: "  // le virage borne par la physique (pas un cap arbitraire: c'est l'adhérence)\n  const vWish = v; // équilibre moteur avant limites (sert à l'affichage du frein)\n  if (vTurnEff < v) v = vTurnEff;\n  // remorquage: force supplémentaire (on tire une autre auto)\n  if (car.towedBy) v *= TOWING_SPEED_FACTOR;\n  // état moteur exposé (HUD pédales/régime/rapport) — calculé sur la vitesse\n  // RÉELLEMENT tenue (après les limites physiques). Avant, ce bloc lisait\n  // l'équilibre moteur: le régime paraissait figé pendant que la vitesse\n  // variait, et le frein n'existait qu'en descente.\n  {\n    const gi = gearFor(v);\n    car.gear = gi + 1;\n    car.rpm = Math.max(ENGINE_IDLE_RPM, v / WHEEL_RADIUS_M * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI));\n    car.throttle = Math.min(1, throttleShare);\n    // frein affiché: descente (frein moteur) OU lever de pied exigé par le virage\n    const brakeSlope = slopeFrac < -0.015 ? Math.min(1, -slopeFrac * 8) : 0;\n    const brakeCurve = vWish > 20 && v < vWish ? Math.min(1, ((vWish - v) / vWish) * 3) : 0;\n    car.brake = Math.max(brakeSlope, brakeCurve);\n  }\n  return Math.max(0, v * 3.6); // m/s -> km/h\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "    if (msg.type === \"state\") {\n      const myOld = state?.cars.find((c) => c.playerId === myId);\n      msg.pathChunk = pathChunks;\n      state = msg;\n      const myNew = state.cars.find((c) => c.playerId === myId);\n      if (myNew) {\n        lastKnownKm = myNew.positionKm;\n        lastKnownSpeed = myNew.speedKmh;\n        lastStateTime = performance.now();\n        if (myOld) {\n          const dKm = myNew.positionKm - myOld.positionKm;\n          const elapsed = Math.max(0.001, (performance.now() - lastStateTime) / 1000);\n        }\n        extrapolatedKm = myNew.positionKm;\n      }\n      updateUI();\n",
    apres: "    if (msg.type === \"state\") {\n      msg.pathChunk = pathChunks;\n      state = msg;\n      const myNew = state.cars.find((c) => c.playerId === myId);\n      if (myNew) {\n        // anti-saccade: le serveur émet un état ~toutes les 500 ms mais la\n        // position n'avance qu'une fois par tick (1 s). On ne re-ancre\n        // l'extrapolation QUE sur un état qui a fait progresser la voiture —\n        // ré-ancrer sur un doublon ramène le rendu en arrière (\"rollback\").\n        lastKnownSpeed = myNew.speedKmh;\n        if (lastStateTime === 0 || myNew.positionKm > lastKnownKm) {\n          lastKnownKm = myNew.positionKm;\n          lastStateTime = performance.now();\n        }\n      }\n      updateUI();\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "  // extrapolation 60 fps: entre les states serveur (500 ms), on avance selon la vitesse\n  if (lastKnownSpeed > 0) {\n    const dtS = (performance.now() - lastStateTime) / 1000;\n    extrapolatedKm = lastKnownKm + (lastKnownSpeed * dtS) / 3600;\n  }\n  const km = myPub ? (lastKnownSpeed > 0 ? extrapolatedKm : myPub.positionKm) : 0;\n",
    apres: "  // extrapolation 60 fps + LISSAGE: la cible avance depuis la dernière ancre\n  // ayant réellement progressé; le point de rendu poursuit sa cible (constante\n  // ~100 ms) pour absorber les à-coups de vitesse, et se téléporte au-delà de\n  // 100 m (arrêt en station, remorquage) au lieu de filmer un rattrapage.\n  {\n    const dtS = (performance.now() - lastStateTime) / 1000;\n    const targetKm = lastKnownSpeed > 0\n      ? lastKnownKm + (lastKnownSpeed * dtS) / 3600\n      : (myPub?.positionKm ?? lastKnownKm);\n    if (extrapolatedKm === 0 || Math.abs(targetKm - extrapolatedKm) > 0.1) extrapolatedKm = targetKm;\n    else extrapolatedKm += (targetKm - extrapolatedKm) * Math.min(1, dt * 10);\n  }\n  const km = myPub ? (lastKnownSpeed > 0 ? extrapolatedKm : myPub.positionKm) : 0;\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "  const pausedEl = $(\"paused\");\n  pausedEl.classList.toggle(\"hidden\", !state.paused && state.started);\n",
    apres: "  const pausedEl = $(\"paused\");\n  // bandeau de pause VRAIE uniquement (course partie ET en pause): jamais\n  // pendant l'attente du départ, où il s'affichait à tort et recouvrait la\n  // barre contenant le bouton Départ.\n  pausedEl.classList.toggle(\"hidden\", !(state.paused && state.started));\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "  if (state.paused || !state.started) {\n    ctx.fillStyle = \"rgba(0,0,0,0.55)\";\n    ctx.fillRect(0, 0, w, 40);\n    ctx.fillStyle = \"#fff\";\n    ctx.font = \"16px sans-serif\";\n    ctx.fillText(state.paused ? \"⏸ Course en pause — éditez vos règles librement\" : \"⏳ En attente du départ…\", 12, 26);\n  }\n",
    apres: "  if (!state.started) {\n    ctx.fillStyle = \"rgba(0,0,0,0.55)\";\n    ctx.fillRect(0, 0, w, 40);\n    ctx.fillStyle = \"#fff\";\n    ctx.font = \"16px sans-serif\";\n    ctx.fillText(\"⏳ En attente du départ…\", 12, 26);\n  }\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "  const spd = myPub?.speedKmh ?? 0;\n  ctx.fillText(`${spd.toFixed(0)} km/h`, 12, h - 11);\n  const paceTxt = PACE_FR[myCar()?.pace ?? \"\"] ?? \"\";\n  if (paceTxt) {\n    ctx.fillStyle = (myCar()?.pace === \"attaque\" || myCar()?.pace === \"soutenue\") ? \"#7c7\" : \"#cc7\";\n    ctx.fillText(`Allure : ${paceTxt}`, 90, h - 11);\n    ctx.fillStyle = \"#efe8dc\";\n  }\n  ctx.fillText(`${WEATHER_ICON[weather] ?? \"\"} ${WEATHER_FR[weather] ?? weather}`, 100, h - 11);\n  ctx.fillText(`${(myPub?.positionKm ?? 0).toFixed(1)} km`, w - 110, h - 11);\n",
    apres: "  const spd = myPub?.speedKmh ?? 0;\n  ctx.fillText(`${spd.toFixed(0)} km/h`, 12, h - 11);\n  // bandeau bas: positionnement dynamique — chaque texte suit la largeur\n  // MESURÉE du précédent (l'allure écrasait la météo en x fixe).\n  let bandX = 12 + ctx.measureText(`${spd.toFixed(0)} km/h`).width + 14;\n  const paceTxt = PACE_FR[myCar()?.pace ?? \"\"] ?? \"\";\n  if (paceTxt) {\n    ctx.fillStyle = (myCar()?.pace === \"attaque\" || myCar()?.pace === \"soutenue\") ? \"#7c7\" : \"#cc7\";\n    ctx.fillText(`Allure : ${paceTxt}`, bandX, h - 11);\n    ctx.fillStyle = \"#efe8dc\";\n    bandX += ctx.measureText(`Allure : ${paceTxt}`).width + 14;\n  }\n  const wxTxt = `${WEATHER_ICON[weather] ?? \"\"} ${WEATHER_FR[weather] ?? weather}`;\n  ctx.fillText(wxTxt, bandX, h - 11);\n  bandX += ctx.measureText(wxTxt).width + 14;\n  ctx.fillText(`${(myPub?.positionKm ?? 0).toFixed(1)} km`, w - 110, h - 11);\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "    if (in12h.length > 0) {\n      ctx.fillText(`Prévision 12 h : ${in12h.slice(0, 2).map((f) => WEATHER_FR[f.kind] ?? f.kind).join(\", \")}`, 260, h - 11);\n    }\n",
    apres: "    if (in12h.length > 0) {\n      const prevTxt = `Prévision 12 h : ${in12h.slice(0, 2).map((f) => WEATHER_FR[f.kind] ?? f.kind).join(\", \")}`;\n      if (bandX + ctx.measureText(prevTxt).width < w - 120) ctx.fillText(prevTxt, bandX, h - 11);\n    }\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "      const bw = 220, bh = 86, bx = w - bw - 12, by = h - 30 - bh - 8;\n",
    apres: "      const bw = 220, bh = 96, bx = w - bw - 12, by = h - 30 - bh - 8;\n"
  },
  {
    file: "packages/client/src/main.ts",
    avant: "      ctx.fillStyle = \"#241f19\";\n      ctx.fillRect(bx + 10, by + 48, (bw - 30) / 2, 12);\n      ctx.fillRect(bx + bw / 2 + 5, by + 48, (bw - 30) / 2, 12);\n      ctx.fillStyle = \"#7c7\";\n      ctx.fillRect(bx + 10, by + 48, ((bw - 30) / 2) * Math.min(1, car.throttle), 12);\n      ctx.fillStyle = \"#c55\";\n      ctx.fillRect(bx + bw / 2 + 5, by + 48, ((bw - 30) / 2) * Math.min(1, car.brake), 12);\n      ctx.fillStyle = \"#aaa\";\n      ctx.font = \"9px sans-serif\";\n      ctx.fillText(\"ACCÉL\", bx + 10, by + 44);\n      ctx.fillText(\"FREIN\", bx + bw / 2 + 5, by + 44);\n",
    apres: "      // pédales plus basses, étiquettes AU-DESSUS: le texte 9px débordait\n      // auparavant sur la barre de régime (superposition ACCÉL/FREIN + tr/min)\n      ctx.fillStyle = \"#241f19\";\n      ctx.fillRect(bx + 10, by + 56, (bw - 30) / 2, 12);\n      ctx.fillRect(bx + bw / 2 + 5, by + 56, (bw - 30) / 2, 12);\n      ctx.fillStyle = \"#7c7\";\n      ctx.fillRect(bx + 10, by + 56, ((bw - 30) / 2) * Math.min(1, car.throttle), 12);\n      ctx.fillStyle = \"#c55\";\n      ctx.fillRect(bx + bw / 2 + 5, by + 56, ((bw - 30) / 2) * Math.min(1, car.brake), 12);\n      ctx.fillStyle = \"#aaa\";\n      ctx.font = \"9px sans-serif\";\n      ctx.fillText(\"ACCÉL\", bx + 10, by + 52);\n      ctx.fillText(\"FREIN\", bx + bw / 2 + 5, by + 52);\n"
  },
  {
    file: "packages/server/public/index.html",
    avant: "<div id=\"paused\" class=\"hidden\">⏸ Course en pause — vous pouvez éditer vos règles</div>\n<div id=\"main\">\n",
    apres: "<div id=\"main\">\n"
  },
  {
    file: "packages/server/public/index.html",
    avant: "  <div id=\"camera\">\n    <canvas id=\"cv\"></canvas>\n",
    apres: "  <div id=\"camera\">\n    <div id=\"paused\" class=\"hidden\">⏸ Course en pause — vous pouvez éditer vos règles</div>\n    <canvas id=\"cv\"></canvas>\n"
  },
  {
    file: "packages/engine/src/engine.test.ts",
    avant: "import { CAR_LEN_M } from \"./calibration\";\n",
    apres: "import { CAR_LEN_M, GEAR_RATIOS, GEAR_FINAL_DRIVE, WHEEL_RADIUS_M, ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM } from \"./calibration\";\n"
  },
  {
    file: "packages/engine/src/engine.test.ts",
    avant: "  const passant = drive(0.5, 2700);\n  assert.equal(passant.stats.depassements, 1, \"fenêtre ouverte: le dépassement se fait\");\n  assert.equal(passant.maneuver, null, \"manœuvre terminée\");\n});\n",
    apres: "  const passant = drive(0.5, 2700);\n  assert.equal(passant.stats.depassements, 1, \"fenêtre ouverte: le dépassement se fait\");\n  assert.equal(passant.maneuver, null, \"manœuvre terminée\");\n});\n\n// ========== HUD MOTEUR: régime et rapport suivent la vitesse tenue ==========\n\ntest(\"hud moteur: régime et rapport suivent la vitesse réellement tenue\", () => {\n  const mkW = (curv: number) => ({\n    segments: [{ km: 0, biome: \"steppe\", terrain: \"piste_rapide\", altitude: 0, slope: 0, width: \"large\" }],\n    points: Array.from({ length: 60 }, (_, i) => ({ km: (i * 20) / 1000, x: 0, y: 0, z: 0, curvature: curv })),\n  }) as any;\n  const seg = mkW(0).segments[0];\n  // référence: même voiture, même piste, en ligne droite\n  const carF = mkCar(\"attaque\");\n  carF.positionKm = 0.6;\n  const vFree = computeSpeed(carF, seg, \"clair\", 0, mkW(0));\n  // même situation, mais un virage fort (courbure brute 0,01 -> normalisée 0,9)\n  const carC = mkCar(\"attaque\");\n  carC.positionKm = 0.6;\n  const v = computeSpeed(carC, seg, \"clair\", 0, mkW(0.01));\n  assert.ok(v < vFree, `le virage bride la vitesse (v=${v.toFixed(0)} < vFree=${vFree.toFixed(0)})`);\n  // rapport et régime exposés = ceux de la vitesse TENUE, pas du souhait moteur\n  const vMs = v / 3.6;\n  let gi = 0;\n  for (let g2 = 0; g2 < GEAR_RATIOS.length; g2++) {\n    const r = (vMs / WHEEL_RADIUS_M) * 60 * GEAR_RATIOS[g2] * GEAR_FINAL_DRIVE / (2 * Math.PI);\n    if (r <= ENGINE_REDLINE_RPM * 0.98) gi = g2;\n  }\n  while (gi > 0) {\n    const r = (vMs / WHEEL_RADIUS_M) * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI);\n    if (r >= ENGINE_IDLE_RPM) break;\n    gi--;\n  }\n  const expected = Math.max(ENGINE_IDLE_RPM, (vMs / WHEEL_RADIUS_M) * 60 * GEAR_RATIOS[gi] * GEAR_FINAL_DRIVE / (2 * Math.PI));\n  assert.equal(carC.gear, gi + 1, \"rapport affiché = rapport tenu\");\n  assert.ok(Math.abs(carC.rpm - expected) < 1, `régime affiché = régime tenu (${carC.rpm.toFixed(0)} vs ${expected.toFixed(0)})`);\n  assert.ok(carC.brake > 0, \"lever de pied affiché dans le virage\");\n});\n"
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
console.log("Patch appliqué: " + diffs.length + " diffs. (correctifs interface)");
