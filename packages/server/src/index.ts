import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { RaceHost, RaceConfig } from "./host";
import { CarState, PlayerRule, TICK_SECONDS } from "@vvr/engine";

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
} else {
  const restored = RaceHost.restore(SNAP_DIR);
  if (restored) {
    config = restored.config;
  }
}

if (!config) {
  console.log("Usage: node dist/index.js create [seed] [hours] [intervalSec] [programMin] [closureHours] [code]");
  console.log("       ou restaure data/snapshot.json automatiquement");
  process.exit(1);
}

let host = RaceHost.restore(SNAP_DIR) || new RaceHost(config!, SNAP_DIR);

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
let nextId = 1;

function broadcast(msg: any): void {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

function stateMsg(): any {
  return {
    type: "state",
    tick: host.race.tick,
    paused: host.race.paused,
    world: host.race.world,
    cars: host.race.cars.map(publicCar),
    standings: host.race.standings().map((c) => c.playerId),
    events: host.race.events.slice(-100),
    chat: host.chat.slice(-100),
    players: host.race.players,
  };
}

function publicCar(c: CarState): any {
  return {
    playerId: c.playerId,
    color: host.race.players.find((p) => p.id === c.playerId)?.color ?? "#888",
    positionKm: c.positionKm,
    speedKmh: c.speedKmh,
    pace: c.pace,
    arrived: c.arrived,
    forfait: c.forfait,
    immobilized: c.immobilized,
    immobilizedReason: c.immobilizedReason,
    crevaison: c.crevaison,
    offsetSeconds: c.offsetSeconds,
  };
}

wss.on("connection", (ws) => {
  const client: Client = { ws, playerId: null, pseudo: null, isAdmin: false };
  clients.push(client);

  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "join": {
        if (host.race.tick > host.race.raceStartTick + host.race.params.startIntervalSeconds * host.race.cars.length) {
          ws.send(JSON.stringify({ type: "error", text: "Inscriptions fermées" }));
          return;
        }
        if (msg.code !== host.config.accessCode) {
          ws.send(JSON.stringify({ type: "error", text: "Code d'accès invalide" }));
          return;
        }
        const id = "p" + nextId++;
        const isAdmin = host.race.players.length === 0;
        host.race.addPlayer(id, msg.pseudo, msg.color || "#c33", isAdmin);
        client.playerId = id;
        client.pseudo = msg.pseudo;
        client.isAdmin = isAdmin;
        ws.send(JSON.stringify({ type: "joined", playerId: id, isAdmin, car: host.race.cars.find((c) => c.playerId === id) }));
        broadcast(stateMsg());
        break;
      }
      case "rules": {
        const car = host.race.cars.find((c) => c.playerId === client.playerId);
        if (!car) return;
        car.rules = msg.rules as PlayerRule[];
        host.race.events.push({ tick: host.race.tick, text: `${client.pseudo} ajuste son planificateur` });
        broadcast(stateMsg());
        break;
      }
      case "chat": {
        host.chat.push({ tick: host.race.tick, pseudo: client.pseudo || "?", text: String(msg.text).slice(0, 300) });
        broadcast(stateMsg());
        break;
      }
      case "admin_pause": {
        if (!client.isAdmin) return;
        host.race.paused = !!msg.paused;
        broadcast(stateMsg());
        break;
      }
      case "admin_start": {
        if (!client.isAdmin) return;
        host.race.start();
        broadcast(stateMsg());
        break;
      }
      case "admin_advance": {
        if (!client.isAdmin) return;
        const steps = Math.min(100000, msg.steps | 0);
        for (let i = 0; i < steps; i++) host.race.step();
        broadcast(stateMsg());
        break;
      }
      case "get_state":
        ws.send(JSON.stringify(stateMsg()));
        break;
    }
  });

  ws.on("close", () => {
    const i = clients.indexOf(client);
    if (i >= 0) clients.splice(i, 1);
  });

  ws.send(JSON.stringify(stateMsg()));
});

setInterval(() => {
  const events = host.race.step();
  if (events.length > 0) broadcast(stateMsg());
}, TICK_MS);

setInterval(() => {
  host.snapshot();
  broadcast(stateMsg());
}, 60_000);

server.listen(PORT, () => {
  console.log(`Voyage Voyage Rally — http://localhost:${PORT}`);
  console.log(`Course: ${host.config.seedText} — ${host.race.world.totalKm} km, ${host.race.world.stations.length} stations`);
});
