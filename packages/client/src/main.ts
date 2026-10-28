interface CarPublic {
  playerId: string;
  color: string;
  positionKm: number;
  speedKmh: number;
  pace: string;
  arrived: boolean;
  forfait: boolean;
  immobilized: boolean;
  immobilizedReason: string | null;
  crevaison: boolean;
  offsetSeconds: number;
}

interface StateMsg {
  type: string;
  tick: number;
  paused: boolean;
  world: any;
  cars: CarPublic[];
  standings: string[];
  events: { tick: number; text: string }[];
  chat: { pseudo: string; text: string }[];
  players: { id: string; pseudo: string; color: string }[];
}

const BIOME_COLORS: Record<string, string> = {
  desert: "#c9a96a",
  montagne: "#7d8a96",
  steppe: "#8fae6d",
  humide: "#5f8a7a",
};

let ws: WebSocket;
let myId: string | null = null;
let state: StateMsg | null = null;

const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;

function resize(): void {
  cv.width = cv.clientWidth;
  cv.height = cv.clientHeight;
}
window.addEventListener("resize", resize);

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
      (document.getElementById("joinbox") as HTMLElement).classList.add("hidden");
      if (msg.isAdmin) addAdminButtons();
    } else if (msg.type === "error") {
      alert(msg.text);
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

function myCar(): CarPublic | null {
  if (!state || !myId) return null;
  return state.cars.find((c) => c.playerId === myId) ?? null;
}

function hourOfDay(tick: number): number {
  return (8 + tick / 3600) % 24;
}

function updateUI(): void {
  if (!state) return;
  const car = myCar();
  const h = hourOfDay(state.tick);
  document.getElementById("clock")!.textContent =
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  document.getElementById("day")!.textContent = `Jour ${Math.floor(state.tick / 86400) + 1}`;
  document.getElementById("pos")!.textContent = `${car ? car.positionKm.toFixed(0) : 0} km`;
  document.getElementById("budget")!.textContent = "";

  const standings = document.getElementById("standings")!;
  standings.innerHTML = "";
  state.standings.forEach((pid, i) => {
    const p = state!.players.find((x) => x.id === pid);
    const c = state!.cars.find((x) => x.playerId === pid);
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${p?.pseudo ?? pid} — ${c ? c.positionKm.toFixed(0) : 0} km${c?.arrived ? " 🏁" : ""}`;
    if (pid === myId) li.style.color = "#d9a441";
    standings.appendChild(li);
  });

  const events = document.getElementById("events")!;
  events.innerHTML = "";
  for (const e of state.events.slice(-40).reverse()) {
    const d = document.createElement("div");
    d.textContent = e.text;
    events.appendChild(d);
  }

  const chat = document.getElementById("chat")!;
  chat.innerHTML = "";
  for (const m of state.chat.slice(-40)) {
    const d = document.createElement("div");
    d.className = "msg";
    d.innerHTML = `<span class="pseudo"></span> ${escapeHtml(m.text)}`;
    (d.querySelector(".pseudo") as HTMLElement).textContent = m.pseudo;
    chat.appendChild(d);
  }
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function addAdminButtons(): void {
  const bar = document.getElementById("topbar")!;
  const pause = document.createElement("button");
  pause.textContent = "Pause";
  pause.onclick = () => send({ type: "admin_pause", paused: true });
  const resume = document.createElement("button");
  resume.textContent = "Reprendre";
  resume.onclick = () => send({ type: "admin_pause", paused: false });
  const start = document.createElement("button");
  start.textContent = "Départ";
  start.onclick = () => send({ type: "admin_start" });
  const adv = document.createElement("button");
  adv.textContent = "+1h";
  adv.onclick = () => send({ type: "admin_advance", steps: 3600 });
  bar.append(start, pause, resume, adv);
}

document.getElementById("joinform")!.addEventListener("submit", (e) => {
  e.preventDefault();
  send({
    type: "join",
    pseudo: (document.getElementById("f_pseudo") as HTMLInputElement).value,
    code: (document.getElementById("f_code") as HTMLInputElement).value,
    color: (document.getElementById("f_color") as HTMLInputElement).value,
  });
});

document.getElementById("chatinput")!.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const input = e.target as HTMLInputElement;
    if (input.value.trim()) {
      send({ type: "chat", text: input.value });
      input.value = "";
    }
  }
});

function render(): void {
  requestAnimationFrame(render);
  if (!state) return;
  resize();
  const w = cv.width, h2 = cv.height;
  const car = myCar();
  const seg = state.world.segments[Math.min(
    state.world.segments.length - 1,
    Math.floor((car?.positionKm ?? 0) / 25)
  )];
  const biome = seg?.biome ?? "steppe";
  ctx.fillStyle = BIOME_COLORS[biome] ?? "#8fae6d";
  ctx.fillRect(0, 0, w, h2);

  const hour = hourOfDay(state.tick);
  const dark = hour >= 21 || hour < 5 ? 0.7 : hour >= 19 ? (hour - 19) / 2 * 0.7 : hour < 7 ? (7 - hour) / 2 * 0.7 : 0;

  // route stylisée
  ctx.strokeStyle = "#6b5b43";
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.moveTo(0, h2 * 0.7);
  ctx.bezierCurveTo(w * 0.3, h2 * 0.55, w * 0.6, h2 * 0.8, w, h2 * 0.6);
  ctx.stroke();

  // voiture
  const cx = w / 2, cy = h2 * 0.68;
  if (car) {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 12, 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = car.color;
    ctx.fillRect(cx - 24, cy - 14, 48, 24);
    ctx.fillStyle = "#222";
    ctx.fillRect(cx - 28, cy - 10, 6, 12);
    ctx.fillRect(cx + 22, cy - 10, 6, 12);
    ctx.fillRect(cx - 28, cy + 6, 6, 12);
    ctx.fillRect(cx + 22, cy + 6, 6, 12);
    ctx.fillStyle = "#9cf";
    ctx.fillRect(cx - 14, cy - 8, 20, 10);

    if (car.crevaison) {
      ctx.fillStyle = "#f55";
      ctx.font = "14px sans-serif";
      ctx.fillText("🔧 crevaison !", cx + 34, cy - 14);
    }
    if (car.immobilized) {
      ctx.fillStyle = "#f55";
      ctx.font = "14px sans-serif";
      ctx.fillText(`⚠ ${car.immobilizedReason}`, cx + 34, cy + 4);
    }

    if (dark > 0.1) {
      ctx.fillStyle = `rgba(10,10,25,${dark})`;
      ctx.fillRect(0, 0, w, h2);
      const grad = ctx.createRadialGradient(cx + 60, cy, 5, cx + 60, cy, 120);
      grad.addColorStop(0, "rgba(255,240,180,0.35)");
      grad.addColorStop(1, "rgba(255,240,180,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx + 20, cy);
      ctx.lineTo(cx + 200, cy - 80);
      ctx.lineTo(cx + 200, cy + 80);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (state.paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText("⏸ Course en pause — vous pouvez éditer vos règles", 12, 26);
  }
}

// Carte plein écran
const fsEl = document.getElementById("fullscreen")!;
document.getElementById("btn-map")!.onclick = () => {
  if (!state) return;
  fsEl.style.display = "block";
  const c = document.createElement("canvas");
  c.width = fsEl.clientWidth - 40;
  c.height = fsEl.clientHeight - 60;
  fsEl.querySelector("#fscontent")!.append(c);
  drawMap(c.getContext("2d")!, c.width, c.height);
};
(document.getElementById("btn-close") as HTMLElement).onclick = () => {
  fsEl.style.display = "none";
  fsEl.querySelector("#fscontent")!.innerHTML = "";
};

function drawMap(m: CanvasRenderingContext2D, w: number, h2: number): void {
  if (!state) return;
  const total = state.world.totalKm;
  m.fillStyle = "#3a332a";
  m.fillRect(0, 0, w, h2);
  m.strokeStyle = "#d9a441";
  m.lineWidth = 3;
  m.beginPath();
  let prevAlt = 0;
  state.world.segments.forEach((seg: any, i: number) => {
    const x = (seg.km / total) * w;
    const y = h2 / 2 - seg.altitude / 4000 * h2;
    if (i === 0) m.moveTo(x, y);
    else m.lineTo(x, y);
  });
  m.stroke();
  m.fillStyle = "#8fae6d";
  state.world.segments.forEach((seg: any) => {
    m.fillStyle = BIOME_COLORS[seg.biome];
    m.fillRect((seg.km / total) * w, h2 - 30, w / state.world.segments.length, 30);
  });
  m.fillStyle = "#fff";
  m.font = "11px sans-serif";
  state.world.stations.forEach((s: any) => {
    const x = (s.km / total) * w;
    m.fillText("⛽", x - 5, h2 / 2 + 20);
    if (s.hasHotel) m.fillText("🏨", x - 5, h2 / 2 + 34);
  });
  state.cars.forEach((c) => {
    const x = (c.positionKm / total) * w;
    m.fillStyle = c.color;
    m.beginPath();
    m.arc(x, h2 / 2 - 6, 5, 0, Math.PI * 2);
    m.fill();
    const p = state!.players.find((pp) => pp.id === c.playerId);
    m.fillText(p?.pseudo ?? "", x + 7, h2 / 2 - 6);
  });
}

// Planificateur plein écran
document.getElementById("btn-planner")!.onclick = () => {
  if (!state || !myCar()) return;
  fsEl.style.display = "block";
  const car = myCar()!;
  const div = document.createElement("div");
  div.style.padding = "1rem";
  div.innerHTML = `<h2>Planificateur</h2><p>Règles par défaut; édition complète à venir.</p>`;
  (fsEl.querySelector("#fscontent") as HTMLElement).append(div);
};

connect();
render();
