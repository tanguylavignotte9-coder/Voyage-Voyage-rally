#!/usr/bin/env bash
# Voyage Voyage Rally — lanceur en un clic (Mac / Linux)
cd "$(dirname "$0")"

echo "============================================"
echo "  VOYAGE VOYAGE RALLY"
echo "  Préparation du serveur de course..."
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERREUR] Node.js n'est pas installé."
  echo "  Mac    : https://nodejs.org (version LTS) ou : brew install node"
  echo "  Linux  : sudo apt install nodejs npm"
  echo "Puis relancez ce fichier."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[1/3] Installation des composants (première fois seulement)..."
  npm install --no-fund --no-audit || { echo "[ERREUR] Installation échouée — vérifiez votre connexion internet."; exit 1; }
  echo
fi

if [ ! -f "packages/server/dist/index.js" ]; then
  echo "[2/3] Compilation du jeu (première fois seulement)..."
  npm run build || { echo "[ERREUR] Compilation échouée."; exit 1; }
  echo
fi

echo "[3/3] Démarrage du serveur de course..."
echo
echo "============================================"
echo "  Le navigateur va s'ouvrir sur la page de connexion."
echo
echo "  CODE D'ACCÈS PAR DÉFAUT : rally"
echo
echo "  Gardez cette fenêtre OUVERTE pendant la course."
echo "  Pour arrêter : Ctrl+C."
echo "============================================"
echo

( sleep 2; if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:8080; else open http://localhost:8080; fi ) &
node packages/server/dist/index.js
