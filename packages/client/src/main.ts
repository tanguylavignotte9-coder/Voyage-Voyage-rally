// Voyage Voyage Rally — client

interface CarPublic {
  playerId: string;
  color: string;
  positionKm: number;
  speedKmh: number;
  arrived: boolean;
  forfait: boolean;
  immobilized: boolean;
  immobilizedReason: string | null;
  stopped: boolean;
  sleeping: boolean;
}

interface MyCar {
  playerId: string;
  fuel: number;
  fuelCapacity: number;
  fatigue: number;
  pace: string;
  risk: string;
  organs: Record<string, number>;
  budget: number;
  spareWheels: number;
  rules: any[];
  allowAssist: boolean;
  transactions: { tick: number; label: string; amount: number }[];
  mentalLog: { tick: number; text: string }[];
  stats: { distance: number; maxSpeed: number; pannes: number; depenses: number; primes: number; accidents: number; depassements: number };
  arrived: boolean;
  forfait: boolean;
  immobilized: boolean;
  immobilizedReason: string | null;
  positionKm: number;
  dailyKm: number;
}

interface StateMsg {
  type: string;
  tick: number;
  started: boolean;
  paused: boolean;
  finished: boolean;
  world: any;
  cars: CarPublic[];
  standings: string[];
  events: { tick: number; text: string }[];
  chat: { pseudo: string; text: string }[];
  players: { id: string; pseudo: string; color: string; isAdmin?: boolean }[];
  challenges: any[];
  mine: MyCar | null;
}

const BIOME_COLORS: Record<string, string> = {
  desert: "#c9a96a",
  montagne: "#7d8a96",
  steppe: "#8fae6d",
  humide: "#5f8a7a",
};

const ORGANS_FR: Record<string, string> = {
  moteur: "Moteur", transmission: "Transmission", pneus_av: "Pneus av.", pneus_ar: "Pneus ar.",
  suspensions: "Suspensions", chassis: "Châssis", freins: "Freins", refroidissement: "Refroidissement",
};

const PACE_FR: Record<string, string> = {
  lift_and_coast: "Lift and coast", prudente: "Prudente", normale: "Normale", soutenue: "Soutenue", attaque: "Attaque",
};

let ws: WebSocket;
let myId: string | null = null;
let isAdmin = false;
let state: StateMsg | null = null;

const $ = (id: string) => document.getElementById(id)!;
const cv = $("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;

function send(msg: any): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") {
      state = msg;
      updateUI();
    } else if (msg.type === "joined") {
      myId = msg.playerId;
      isAdmin = msg.isAdmin;
      $("joinbox").classList.add("hidden");
      if (isAdmin) addAdminButtons();
    } else if (msg.type === "error") {
      $("errline").textContent = msg.text;
      setTimeout(() => ($("errline").textContent = ""), 5000);
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

function myCar(): MyCar | null {
  return state?.mine ?? null;
}

function hourOfDay(tick: number): number {
  return (8 + tick / 3600) % 24;
}

function fmtHour(tick: number): string {
  const h = hourOfDay(tick);
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
}

function updateUI(): void {
  if (!state) return;
  const car = myCar();
  $("clock").textContent = fmtHour(state.tick);
  $("day").textContent = `Jour ${Math.floor(state.tick / 86400) + 1}`;
  $("pos").textContent = `${(car?.positionKm ?? 0).toFixed(0)} km / ${state.world.totalKm} km`;
  $("budget").textContent = `💰 ${(car?.budget ?? 0).toFixed(0)}`;

  const pausedEl = $("paused");
  pausedEl.classList.toggle("hidden", !state.paused && state.started);

  updateStandings();
  updateEvents();
  updateChat();
  updateGauges();
  updateRules();
  updateMental();
}

function updateStandings(): void {
  const el = $("standings");
  el.innerHTML = "";
  state!.standings.forEach((pid, i) => {
    const p = state!.players.find((x) => x.id === pid);
    const c = state!.cars.find((x) => x.playerId === pid);
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${p?.pseudo ?? pid} — ${c ? c.positionKm.toFixed(0) : 0} km${c?.arrived ? " 🏁" : c?.forfait ? " ❌" : ""}`;
    if (pid === myId) li.style.color = "#d9a441";
    el.appendChild(li);
  });
  const ch = $("challenges");
  ch.innerHTML = "<h3>Challenges du jour</h3>";
  for (const c of state!.challenges ?? []) {
    const d = document.createElement("div");
    d.className = "rule";
    const nm = (id: string) => state!.players.find((p) => p.id === id)?.pseudo ?? id;
    d.innerHTML = c.vitesseMax ? `⚡ Vitesse max : <b>${nm(c.vitesseMax.playerId)}</b> (${c.vitesseMax.value.toFixed(0)} km/h)<br>` : "";
    d.innerHTML += c.distanceJour ? `🛣️ Distance : <b>${nm(c.distanceJour.playerId)}</b> (${c.distanceJour.value.toFixed(0)} km)<br>` : "";
    d.innerHTML += c.leader ? `👑 Leader : <b>${nm(c.leader.playerId)}</b>` : "";
    ch.appendChild(d);
  }
}

function updateEvents(): void {
  const el = $("events");
  el.innerHTML = "";
  for (const e of state!.events.slice(-40).reverse()) {
    const d = document.createElement("div");
    d.textContent = `[${fmtHour(e.tick)}] ${e.text}`;
    el.appendChild(d);
  }
}

function updateChat(): void {
  const el = $("chat");
  el.innerHTML = "";
  for (const m of state!.chat.slice(-40)) {
    const d = document.createElement("div");
    d.className = "msg";
    const sp = document.createElement("span");
    sp.className = "pseudo";
    sp.textContent = `${m.pseudo} : `;
    d.append(sp, document.createTextNode(m.text));
    el.appendChild(d);
  }
}

function updateGauges(): void {
  const car = myCar();
  const el = $("gauges");
  el.innerHTML = "";
  if (!car) return;
  const gauge = (label: string, pct: number, invert = false) => {
    const good = invert ? 100 - pct : pct;
    const color = good > 60 ? "#7c7" : good > 30 ? "#cc7" : "#c66";
    return `<div class="g"><span>${label}</span><div class="bar"><div class="fill" style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></div></div></div>`;
  };
  const fuelPct = (car.fuel / car.fuelCapacity) * 100;
  let organsHtml = "";
  for (const [o, w] of Object.entries(car.organs)) {
    organsHtml += gauge(`${ORGANS_FR[o]} ${w.toFixed(0)}%`, w, true);
  }
  el.innerHTML =
    gauge("Carburant", fuelPct) +
    gauge("Fatigue", car.fatigue, true) +
    `<div class="rule">Allure : <b>${PACE_FR[car.pace] ?? car.pace}</b> — Risque : <b>${car.risk}</b> — Roues : <b>${car.spareWheels}</b></div>` +
    organsHtml;
  const actions = $("actions");
  actions.innerHTML = "";
  if (car.immobilized) {
    const truck = document.createElement("button");
    truck.textContent = "🚛 Appeler le camion (6h)";
    truck.onclick = () => send({ type: "call_truck" });
    actions.append(truck);
  }
  const forf = document.createElement("button");
  forf.textContent = "🏳️ Déclarer forfait";
  forf.onclick = () => {
    if (confirm("Déclarer forfait ? Vous deviendrez spectateur.")) send({ type: "forfait" });
  };
  actions.append(forf);
  const assist = document.createElement("button");
  assist.textContent = car.allowAssist ? "🤝 Entraide : OUI" : "🤝 Entraide : NON";
  assist.onclick = () => send({ type: "allow_assist", value: !car.allowAssist });
  actions.append(assist);

  const near = state!.cars.filter(
    (c) => c.playerId !== myId && Math.abs(c.positionKm - car.positionKm) < 0.5 && !c.arrived && !c.forfait
  );
  for (const n of near) {
    const name = state!.players.find((p) => p.id === n.playerId)?.pseudo ?? n.playerId;
    if (n.immobilized) {
      const tow = document.createElement("button");
      tow.textContent = `🪝 Remorquer ${name}`;
      tow.onclick = () => send({ type: "tow", targetId: n.playerId });
      actions.append(tow);
    }
    if (n.stopped) {
      const fuel = document.createElement("button");
      fuel.textContent = `⛽ Donner 10 L à ${name}`;
      fuel.onclick = () => send({ type: "transfer_fuel", targetId: n.playerId, litres: 10 });
      actions.append(fuel);
      const rep = document.createElement("button");
      rep.textContent = `🔧 Aider réparations de ${name}`;
      rep.onclick = () => send({ type: "repair_together", targetId: n.playerId });
      actions.append(rep);
    }
  }
}

function updateMental(): void {
  const el = $("mental");
  el.innerHTML = "";
  const car = myCar();
  if (!car) return;
  for (const m of car.mentalLog.slice(-15).reverse()) {
    const d = document.createElement("div");
    d.textContent = `« ${m.text} »`;
    el.appendChild(d);
  }
}

function updateRules(): void {
  const car = myCar();
  const el = $("rules");
  if (!car) {
    el.innerHTML = "<p>Rejoignez la course pour programmer.</p>";
    return;
  }
  el.innerHTML = "";
  const sorted = [...car.rules].sort((a, b) => a.channel - b.channel);
  for (const r of sorted.slice(0, 12)) {
    const d = document.createElement("div");
    d.className = "rule";
    const cond = r.conditions.length === 0
      ? "toujours"
      : r.conditions.map(condText).join(" ET ");
    d.innerHTML = `<div class="head"><span>N°${r.channel} ${r.enabled ? '<span class="on">ON</span>' : '<span class="off">OFF</span>'}</span><button class="small" data-ch="${r.channel}">${r.enabled ? "⏸" : "▶"}</button></div><div>${cond} → <b>${actionText(r.action)}</b></div>`;
    el.appendChild(d);
  }
  const more = document.createElement("button");
  more.textContent = "Éditeur complet…";
  more.onclick = openPlanner;
  el.appendChild(more);
}

function condText(c: any): string {
  if (c.kind === "bool") return c.value ? c.variable : `!${c.variable}`;
  if (c.kind === "numeric") return `${c.variable} ${c.operator} ${c.value}`;
  return `${c.variable} = ${c.value}`;
}

function actionText(a: any): string {
  switch (a.kind) {
    case "allure": return `allure ${PACE_FR[a.level] ?? a.level}`;
    case "risque": return `risque ${a.level}`;
    case "ravitaillement": return `faire le plein (${a.target.kind === "percent" ? a.target.percent + "%" : a.target.litres + " L"}) à la prochaine station`;
    case "reparer_organe": return `réparer ${ORGANS_FR[a.organ]} à la station`;
    case "remplacer_roue": return `changer la roue (${a.where === "station" ? "à la station" : "au bord de la piste"})`;
    case "dormir": return `dormir ${a.hours} h (${a.place})`;
    case "depassement": return `dépassement ${a.level}`;
    case "defendre_position": return "défendre sa position";
    case "appeler_camion": return "appeler le camion";
    case "arreter_station": return "s'arrêter à la prochaine station";
    case "reprendre_route": return "reprendre la route";
    case "assistance_rival": return "assister un rival";
    case "set_rule": return `règle N°${a.channel} = ${a.enabled ? "on" : "off"}`;
    default: return a.kind;
  }
}

// ===== Éditeur complet =====
function openPlanner(): void {
  const car = myCar();
  if (!car) return;
  const fsEl = $("fullscreen");
  fsEl.style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.maxHeight = "100%";
  wrap.style.overflowY = "auto";

  const rules = JSON.parse(JSON.stringify(car.rules));

  const render = () => {
    wrap.innerHTML = "<h2>Planificateur — 50 canaux</h2>";
    const table = document.createElement("table");
    table.innerHTML = "<tr><th>N°</th><th>État</th><th>Conditions (ET)</th><th>Action</th><th></th></tr>";
    const sorted = [...rules].sort((a: any, b: any) => a.channel - b.channel);
    for (const r of sorted) {
      const tr = document.createElement("tr");
      const cond = r.conditions.length === 0 ? "toujours" : r.conditions.map(condText).join(" ET ");
      tr.innerHTML = `<td>${r.channel}</td><td>${r.enabled ? "ON" : "OFF"}</td><td>${escapeHtml(cond)}</td><td>${escapeHtml(actionText(r.action))}</td>`;
      const td = document.createElement("td");
      const toggle = document.createElement("button");
      toggle.textContent = r.enabled ? "Désactiver" : "Activer";
      toggle.onclick = () => { r.enabled = !r.enabled; render(); };
      const del = document.createElement("button");
      del.textContent = "Supprimer";
      del.onclick = () => {
        const idx = rules.indexOf(r);
        rules.splice(idx, 1);
        render();
      };
      td.append(toggle, del);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    wrap.appendChild(table);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Nouvelle règle";
    addBtn.onclick = () => {
      if (rules.length >= 50) return;
      const used = new Set(rules.map((r: any) => r.channel));
      let ch = 1;
      while (used.has(ch)) ch++;
      rules.push({
        channel: ch, enabled: true, conditions: [],
        action: { kind: "allure", level: "normale" },
        effect: { kind: "default" }, mode: "persistante",
      });
      render();
    };
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Enregistrer";
    saveBtn.style.background = "#7c7";
    saveBtn.onclick = () => {
      send({ type: "rules", rules });
      closeFullscreen();
    };
    wrap.append(addBtn, saveBtn);
  };

  render();
  content.appendChild(wrap);
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function closeFullscreen(): void {
  $("fullscreen").style.display = "none";
  $("fscontent").innerHTML = "";
}

// ===== Carte =====
function openMap(): void {
  if (!state) return;
  $("fullscreen").style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = content.clientWidth || 900;
  c.height = (content.clientWidth || 900) * 0.5;
  content.appendChild(c);
  drawMap(c.getContext("2d")!, c.width, c.height);
}

function drawMap(m: CanvasRenderingContext2D, w: number, h: number): void {
  if (!state) return;
  const total = state.world.totalKm;
  m.fillStyle = "#3a332a";
  m.fillRect(0, 0, w, h);
  const profileY = (alt: number) => h * 0.55 - (alt / 4000) * h * 0.45;

  m.strokeStyle = "#5a4f3d";
  m.lineWidth = 1;
  state.world.segments.forEach((seg: any) => {
    m.fillStyle = BIOME_COLORS[seg.biome];
    m.fillRect((seg.km / total) * w, h - 24, w / state.world.segments.length + 1, 24);
  });

  m.strokeStyle = "#d9a441";
  m.lineWidth = 3;
  m.beginPath();
  state.world.segments.forEach((seg: any, i: number) => {
    const x = (seg.km / total) * w;
    const y = profileY(seg.altitude);
    if (i === 0) m.moveTo(x, y);
    else m.lineTo(x, y);
  });
  m.stroke();

  m.font = "11px sans-serif";
  state.world.stations.forEach((s: any) => {
    const x = (s.km / total) * w;
    m.fillText("⛽", x - 5, profileY(3000) + 14);
    m.fillStyle = "#fff";
    m.fillText(s.name, x - 20, profileY(3000) + 28);
    m.fillStyle = "#000";
  });
  state.world.villages.forEach((v: any) => {
    m.fillStyle = "#ddd";
    m.fillText("🏠", (v.km / total) * w - 5, profileY(3000) + 40);
  });
  state.cars.forEach((c) => {
    const x = (c.positionKm / total) * w;
    const y = profileY(altAt(c.positionKm)) - 8;
    m.fillStyle = c.color;
    m.beginPath();
    m.arc(x, y, 6, 0, Math.PI * 2);
    m.fill();
    const p = state!.players.find((pp) => pp.id === c.playerId);
    m.fillStyle = "#fff";
    m.fillText(p?.pseudo ?? "", x + 8, y + 3);
  });
}

function altAt(km: number): number {
  if (!state) return 0;
  const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
  return seg?.altitude ?? 0;
}

// ===== Rendu caméra =====
function render(): void {
  requestAnimationFrame(render);
  if (!state) return;
  const w = (cv.width = cv.clientWidth);
  const h = (cv.height = cv.clientHeight);
  const car = myCar();
  const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor((car?.positionKm ?? 0) / 25))];
  ctx.fillStyle = BIOME_COLORS[seg?.biome ?? "steppe"];
  ctx.fillRect(0, 0, w, h);

  // relief ombré simple
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w / 6, h * 0.3);
    ctx.quadraticCurveTo(i * w / 6 + w / 12, h * (0.1 + (i % 3) * 0.08), (i + 1) * w / 6, h * 0.3);
    ctx.fill();
  }

  // piste
  ctx.strokeStyle = "#6b5b43";
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.bezierCurveTo(w * 0.3, h * 0.58, w * 0.6, h * 0.78, w, h * 0.62);
  ctx.stroke();

  // voitures proches visibles
  const cx = w / 2, cy = h * 0.68;
  const drawCar = (x: number, y: number, color: string, label?: string) => {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(x - 24, y - 14, 48, 24);
    ctx.fillStyle = "#222";
    ctx.fillRect(x - 28, y - 10, 6, 12);
    ctx.fillRect(x + 22, y - 10, 6, 12);
    ctx.fillRect(x - 28, y + 6, 6, 12);
    ctx.fillRect(x + 22, y + 6, 6, 12);
    ctx.fillStyle = "#9cf";
    ctx.fillRect(x - 14, y - 8, 20, 10);
    if (label) {
      ctx.fillStyle = "#fff";
      ctx.font = "12px sans-serif";
      ctx.fillText(label, x - 20, y - 22);
    }
  };

  const myPub = state.cars.find((c) => c.playerId === myId);
  if (myPub) {
    for (const c of state.cars) {
      if (c.playerId === myId) continue;
      const gap = c.positionKm - myPub.positionKm;
      if (Math.abs(gap) < 0.4) {
        const rel = gap / 0.4;
        drawCar(cx + rel * w * 0.35, cy - 20, c.color, state.players.find((p) => p.id === c.playerId)?.pseudo);
      }
    }
    drawCar(cx, cy, myPub.color);
    if (myPub.crevaisonFlag) { /* placeholder */ }
  }

  if (state.paused || !state.started) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText(state.paused ? "⏸ Course en pause — éditez vos règles librement" : "⏳ En attente du départ…", 12, 26);
  }
}

// ===== Admin =====
function addAdminButtons(): void {
  const bar = $("topbar");
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    bar.appendChild(b);
  };
  mk("Départ", () => send({ type: "admin_start" }));
  mk("Pause", () => send({ type: "admin_pause", paused: true }));
  mk("Reprendre", () => send({ type: "admin_pause", paused: false }));
  mk("+1h", () => send({ type: "admin_advance", steps: 3600 }));
  mk("+6h", () => send({ type: "admin_advance", steps: 21600 }));
}

// ===== Events DOM =====
$("joinform").addEventListener("submit", (e) => {
  e.preventDefault();
  send({
    type: "join",
    pseudo: ($("f_pseudo") as HTMLInputElement).value,
    code: ($("f_code") as HTMLInputElement).value,
    color: ($("f_color") as HTMLInputElement).value,
  });
});

$("chatinput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const input = e.target as HTMLInputElement;
    if (input.value.trim()) {
      send({ type: "chat", text: input.value });
      input.value = "";
    }
  }
});

$("btn-map").onclick = openMap;
$("btn-planner").onclick = openPlanner;
$("btn-close").onclick = closeFullscreen;

connect();
render();
