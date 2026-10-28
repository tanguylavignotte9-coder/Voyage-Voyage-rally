import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { RaceHost, RaceConfig } from "./host";
import { CarState, PlayerRule, TICK_SECONDS, findContradictions } from "@vvr/engine";

const PORT = parseInt(process.env.PORT || "8080", 10);
const SNAP_DIR = process.env.SNAP_DIR || path.join(process.cwd(), "data");
const TICK_MS = TICK_SECONDS * 1000;

const args = process.argv.slice(2);
let config: RaceConfig | null = null;

if (args[0] === "create") {
  config = {
    seedText: args[1] || Math.random().toString(36),
    targetHours: parseFloat(args[2] || "168"),
    startIntervalSeconds: parseInt(args[3] || "60", 10),
    programWindowMinutes: parseInt(args[4] || "60", 10),
    closureDelayHours: parseFloat(args[5] || "24"),
    accessCode: args[6] || "rally",
    adminPseudo: "admin",
  };
}

if (!config && !RaceHost.restore(SNAP_DIR)) {
  // Lancement simple (double-clic) : crée une course par défaut — 7 jours, code d'accès "rally".
  // Pour personnaliser : node dist/index.js create <graine> <durée_h> <intervalle_s> <fenêtre_min> <clôture_h> <code>
  config = {
    seedText: Math.random().toString(36).slice(2, 10),
    targetHours: 168,
    startIntervalSeconds: 60,
    programWindowMinutes: 60,
    closureDelayHours: 24,
    accessCode: "rally",
    adminPseudo: "admin",
  };
  console.log("Aucune course existante — course par défaut créée (7 jours, code d'accès : rally)");
}

let host = RaceHost.restore(SNAP_DIR) || new RaceHost(config!, SNAP_DIR);

// Rattrapage après coupure : le serveur rattrape le temps réel manqué depuis le dernier snapshot
if (host.race.started && !host.race.paused && host.wallClockSnapshot) {
  const missedMs = Date.now() - host.wallClockSnapshot;
  if (missedMs > 60_000) {
    const steps = Math.min(3600 * 24 * 2, Math.floor(missedMs / 1000));
    console.log(`Rattrapage accéléré : ${steps} ticks (${(steps / 3600).toFixed(1)} h)…`);
    host.race.log(`Redémarrage serveur — rattrapage accéléré de ${(steps / 3600).toFixed(1)} h`);
    for (let i = 0; i < steps; i++) host.race.step();
    console.log("Rattrapage terminé.");
  }
}

const server = http.createServer((req, res) => {
  const publicDir = path.join(__dirname, "..", "public");
  const url = req.url === "/" ? "/index.html" : req.url!;
  const file = path.join(publicDir, url);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": contentType(url) });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

function contentType(url: string): string {
  if (url.endsWith(".html")) return "text/html; charset=utf-8";
  if (url.endsWith(".js")) return "application/javascript";
  if (url.endsWith(".css")) return "text/css";
  return "text/plain";
}

const wss = new WebSocketServer({ server });

interface Client {
  ws: WebSocket;
  playerId: string | null;
  pseudo: string | null;
  isAdmin: boolean;
}

const clients: Client[] = [];

function broadcast(msg: any): void {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

function stateMsg(forPlayerId: string | null): any {
  const cars = host.race.cars;
  const publicCars = cars.map((c) => ({
    playerId: c.playerId,
    color: host.race.players.find((p) => p.id === c.playerId)?.color ?? "#888",
    positionKm: c.positionKm,
    speedKmh: c.speedKmh,
    arrived: c.arrived,
    forfait: c.forfait,
    immobilized: c.immobilized,
    immobilizedReason: c.immobilizedReason,
    stopped: c.stopped,
    sleeping: c.sleeping > 0,
    stats: host.race.finished ? c.stats : null,
  }));
  const mine = forPlayerId ? cars.find((c) => c.playerId === forPlayerId) : undefined;
  return {
    type: "state",
    tick: host.race.tick,
    started: host.race.started,
    paused: host.race.paused,
    finished: host.race.finished,
    world: host.race.world,
    cars: publicCars,
    standings: host.race.standings().map((c) => c.playerId),
    events: host.race.events.slice(-150),
    chat: host.chat.slice(-150),
    players: host.race.players,
    challenges: host.race.challengeResults.slice(-3),
    mine: mine
      ? {
          playerId: mine.playerId,
          fuel: mine.fuel,
          fuelCapacity: mine.fuelCapacity,
          fatigue: mine.fatigue,
          pace: mine.pace,
          risk: mine.risk,
          organs: mine.organs,
          budget: mine.budget,
          spareWheels: mine.spareWheels,
          rules: mine.rules,
          allowAssist: mine.allowAssist,
          transactions: mine.transactions.slice(-30),
          mentalLog: mine.mentalLog.slice(-60),
          stats: mine.stats,
          arrived: mine.arrived,
          forfait: mine.forfait,
          immobilized: mine.immobilized,
          immobilizedReason: mine.immobilizedReason,
          positionKm: mine.positionKm,
          dailyKm: mine.dailyKm,
        }
      : null,
  };
}

function broadcastState(): void {
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(stateMsg(c.playerId)));
  }
}

wss.on("connection", (ws) => {
  const client: Client = { ws, playerId: null, pseudo: null, isAdmin: false };
  clients.push(client);

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const race = host.race;
    const myCar = () => race.cars.find((c) => c.playerId === client.playerId);

    switch (msg.type) {
      case "join": {
        if (race.started) {
          ws.send(JSON.stringify({ type: "error", text: "Inscriptions fermées — la course est déjà partie." }));
          return;
        }
        if (msg.code !== host.config.accessCode) {
          ws.send(JSON.stringify({ type: "error", text: "Code d'accès invalide" }));
          return;
        }
        if (race.players.some((p) => p.pseudo === msg.pseudo)) {
          ws.send(JSON.stringify({ type: "error", text: "Ce pseudo est déjà pris" }));
          return;
        }
        const id = "p" + race.players.length + 1;
        const isAdmin = race.players.length === 0;
        race.addPlayer(id, msg.pseudo, msg.color || "#c33", isAdmin);
        client.playerId = id;
        client.pseudo = msg.pseudo;
        client.isAdmin = isAdmin;
        race.log(`${msg.pseudo} rejoint la course`);
        ws.send(JSON.stringify({ type: "joined", playerId: id, isAdmin }));
        broadcastState();
        break;
      }
      case "rules": {
        const car = myCar();
        if (!car) return;
        const errors = findContradictions(msg.rules as PlayerRule[]);
        if (errors.length > 0) {
          ws.send(JSON.stringify({ type: "error", text: errors.join(" ") }));
          return;
        }
        car.rules = msg.rules as PlayerRule[];
        race.log(`${client.pseudo} ajuste son planificateur`);
        broadcastState();
        break;
      }
      case "chat": {
        const player = race.players.find((p) => p.id === client.playerId);
        if (player?.muted) return;
        host.chat.push({ tick: race.tick, pseudo: client.pseudo || "?", text: String(msg.text).slice(0, 300) });
        broadcastState();
        break;
      }
      case "allow_assist": {
        const car = myCar();
        if (car) car.allowAssist = !!msg.value;
        broadcastState();
        break;
      }
      case "forfait": {
        race.declareForfait(client.playerId!);
        broadcastState();
        break;
      }
      case "call_truck": {
        race.callTruck(client.playerId!);
        broadcastState();
        break;
      }
      case "tow": {
        const ok = race.assistTow(client.playerId!, msg.targetId);
        if (!ok) ws.send(JSON.stringify({ type: "error", text: "Remorquage impossible (proximité, arrêt, ou entraide refusée)" }));
        broadcastState();
        break;
      }
      case "transfer_fuel": {
        const ok = race.transferFuel(client.playerId!, msg.targetId, parseFloat(msg.litres) || 0);
        if (!ok) ws.send(JSON.stringify({ type: "error", text: "Transfert impossible (proximité < 500 m, arrêt, ou entraide refusée)" }));
        broadcastState();
        break;
      }
      case "repair_together": {
        race.repairTogether(msg.targetId, client.playerId!);
        broadcastState();
        break;
      }
      case "settings": {
        const car = myCar();
        if (!car || !car.stopped) return;
        if (typeof msg.settings === "object") Object.assign(car.settings, msg.settings);
        broadcastState();
        break;
      }
      case "admin_start": {
        if (!client.isAdmin || race.started) return;
        race.start();
        broadcastState();
        break;
      }
      case "admin_pause": {
        if (!client.isAdmin) return;
        race.paused = !!msg.paused;
        race.log(race.paused ? "Course en pause — les règles peuvent être éditées" : "Reprise de la course");
        broadcastState();
        break;
      }
      case "admin_advance": {
        if (!client.isAdmin) return;
        const steps = Math.min(3600 * 24, msg.steps | 0);
        for (let i = 0; i < steps; i++) race.step();
        broadcastState();
        break;
      }
      case "admin_mute": {
        if (!client.isAdmin) return;
        const p = race.players.find((x) => x.id === msg.playerId);
        if (p) p.muted = !!msg.value;
        broadcastState();
        break;
      }
      case "admin_exclude": {
        if (!client.isAdmin) return;
        const ok = race.declareForfait(msg.playerId);
        if (ok) race.log(`${race.pseudoOf(msg.playerId)} exclu par la direction de course`);
        broadcastState();
        break;
      }
      case "get_state":
        ws.send(JSON.stringify(stateMsg(client.playerId)));
        break;
    }
  });

  ws.on("close", () => {
    const i = clients.indexOf(client);
    if (i >= 0) clients.splice(i, 1);
  });

  ws.send(JSON.stringify(stateMsg(null)));
});

setInterval(() => {
  if (host.race.step()) broadcastState();
}, TICK_MS);

setInterval(() => {
  host.snapshot();
  broadcastState();
}, 60_000);

setInterval(() => broadcastState(), 5000);

server.listen(PORT, () => {
  console.log(`Voyage Voyage Rally — http://localhost:${PORT}`);
  console.log(`Course: ${host.config.seedText} — ${host.race.world.totalKm} km, ${host.race.world.stations.length} stations`);
});
