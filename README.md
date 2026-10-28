# 🏁 Voyage Voyage Rally

Simulation multijoueur de rallye raid : 10-20 amis, temps réel 1:1, 24h/24, sur un itinéraire
procédural A→B. Chaque joueur incarne un pilote tout-en-un et **programme des stratégies**
(50 canaux de règles) au lieu de conduire.

## Structure

- `packages/engine` — moteur de simulation partagé (déterministe, PRNG semé) :
  génération procédurale du monde multi-biomes, planificateur à règles, simulation
  véhicule (allure, usure par organe, fatigue, carburant, météo par fronts mobiles,
  nuit progressive, pannes probabilistes, immobilisation).
- `packages/server` — serveur autoritaire Node.js + WebSocket (`ws`) : une course = un
  processus, snapshots sur disque toutes les minutes + reprise après redémarrage,
  chat global, journal de course, commandes admin (départ, pause, avance du temps).
- `packages/client` — front TypeScript + Canvas 2D : vue caméra stylisée (jour/nuit,
  phares), carte topographique plein écran, classement compensé, chat, planificateur.

## Utilisation

```bash
npm install
npm start            # build + lance sur http://localhost:8080 (restaure data/snapshot.json si présent)
```

Créer une course :

```bash
node packages/server/dist/index.js create <graine> <durée_h> <intervalle_départ_s> <fenêtre_prog_min> <clôture_h> <code_acces>
```

Exemple : `node packages/server/dist/index.js create sahara2026 168 60 60 24 rally`
(7 jours, départ décalé 1 min, fenêtre de programmation 1 h, clôture 24 h).

Chaque joueur rejoint dans le navigateur : pseudo + code d'accès + couleur.
Le premier connecté est admin (boutons Départ / Pause / +1h).

## Tests

```bash
npm test   # build + tests node --test (moteur)
```

## Interface de programmation (rappels)

- 50 canaux, évaluation N°50→N°1 par tick, le n° le plus bas gagne les conflits.
- Conditions (jusqu'à 3, reliées par ET) sur les variables du catalogue ; une seule action par règle.
- Sémantique gardien : l'effet est actif tant que la condition est vraie.
- Règles par défaut N°1-4 (crevaison, carburant bas, organe critique, camion) — éditables.
- Sans règle d'allure active : allure prudente ; jamais d'arrêt sans ordre.
