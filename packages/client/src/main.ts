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
  weather: string;
  stats: { distance: number; maxSpeed: number; pannes: number; depenses: number; primes: number; accidents: number; depassements: number } | null;
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
  gear: number;
  rpm: number;
  throttle: number;
  brake: number;
  settings: { tirePressure: number; groundClearance: number; engineMap: number; startFuel: number };
  stopped: boolean;
}

interface StateMsg {
  type: string;
  tick: number;
  started: boolean;
  paused: boolean;
  finished: boolean;
  world: any;
  pathSummary: { x: number; y: number; km: number }[];
  pathChunk: Map<number, any[]>;
  fronts: { id: number; kind: string; km: number; radiusKm: number; startTick: number; endTick: number }[];
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
    if (msg.type === "world_reset") {
      pathChunks.clear();
      camInit = false;
      return;
    }
    if (msg.type === "path_chunk") {
      pathChunks.set(msg.fromKm, msg.points);
      // purge: fenêtre glissante (max 16 chunks = 64 km autour de nous)
      if (pathChunks.size > 16) {
        const keys = [...pathChunks.keys()].sort((a, b) => Math.abs(a - lastKnownKm) - Math.abs(b - lastKnownKm));
        while (pathChunks.size > 16) pathChunks.delete(keys.pop()!);
      }
      return;
    }
    if (msg.type === "state") {
      const myOld = state?.cars.find((c) => c.playerId === myId);
      msg.pathChunk = pathChunks;
      state = msg;
      const myNew = state.cars.find((c) => c.playerId === myId);
      if (myNew) {
        lastKnownKm = myNew.positionKm;
        lastKnownSpeed = myNew.speedKmh;
        lastStateTime = performance.now();
        if (myOld) {
          const dKm = myNew.positionKm - myOld.positionKm;
          const elapsed = Math.max(0.001, (performance.now() - lastStateTime) / 1000);
        }
        extrapolatedKm = myNew.positionKm;
      }
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
  $("btn-results").classList.toggle("hidden", !state.finished);

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
  if (car.stopped) {
    const setup = document.createElement("button");
    setup.textContent = "🔧 Réglages voiture (station)";
    setup.onclick = () => openSettings(car);
    actions.append(setup);
  }
  const resBtn = document.createElement("button");
  resBtn.textContent = "📊 Détail budget";
  resBtn.onclick = () => openBudget(car);
  actions.append(resBtn);

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
const BOOL_VARS = ["crevaison", "immobilisation", "nuit", "en_station", "bivouac_en_cours", "meteo_active", "depassement_en_cours"];
const NUM_VARS = ["carburant", "fatigue", "organe_critique", "vitesse", "km_parcourus", "distance_prochaine_station", "heure", "jour_de_course", "distance_rival_devant", "distance_rival_derriere"];
const CAT_VARS: Record<string, string[]> = {
  biome: ["desert", "montagne", "steppe", "humide"],
  typologie_terrain: ["piste_rapide", "piste_moyenne", "piste_mauvaise", "dunes", "regs", "pierrier", "col", "bourbier", "marécage"],
};
const NUM_VARS_LABELS: Record<string, string> = {
  carburant: "Carburant (% réservoir)", fatigue: "Fatigue (0-100)", organe_critique: "Organes au seuil critique",
  vitesse: "Vitesse (km/h)", km_parcourus: "Km parcourus", distance_prochaine_station: "Distance prochaine station (km)",
  heure: "Heure (0-24)", jour_de_course: "Jour de course", distance_rival_devant: "Distance rival devant (km)",
  distance_rival_derriere: "Distance rival derrière (km)",
};
const BOOL_VARS_LABELS: Record<string, string> = {
  crevaison: "Crevaison", immobilisation: "Immobilisation", nuit: "Nuit", en_station: "En station",
  bivouac_en_cours: "Bivouac en cours", meteo_active: "Météo active", depassement_en_cours: "Dépassement en cours",
};

function field(label: string, input: HTMLElement): HTMLElement {
  const div = document.createElement("label");
  div.style.display = "flex";
  div.style.flexDirection = "column";
  div.style.gap = ".15rem";
  div.style.fontSize = ".75rem";
  const s = document.createElement("span");
  s.textContent = label;
  div.append(s, input);
  return div;
}

function select(options: { value: string; label: string }[], value: string, onchange: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.onchange = () => onchange(sel.value);
  return sel;
}

function numberInput(value: number, onchange: (v: number) => void): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.value = String(value);
  inp.oninput = () => onchange(parseFloat(inp.value) || 0);
  return inp;
}

function renderConditionEditor(cond: any, onChange: () => void): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
  const kinds = select(
    [
      { value: "bool", label: "Booléenne" },
      { value: "numeric", label: "Numérique" },
      { value: "categorial", label: "Catégorielle" },
    ],
    cond.kind,
    (v) => {
      if (v === "bool") Object.assign(cond, { kind: "bool", variable: BOOL_VARS[0], value: true });
      else if (v === "numeric") Object.assign(cond, { kind: "numeric", variable: NUM_VARS[0], operator: "<", value: 20 });
      else Object.assign(cond, { kind: "categorial", variable: "biome", value: "desert" });
      onChange();
    }
  );
  box.appendChild(kinds);
  if (cond.kind === "bool") {
    box.appendChild(select(BOOL_VARS.map((v) => ({ value: v, label: BOOL_VARS_LABELS[v] ?? v })), cond.variable, (v) => { cond.variable = v; onChange(); }));
    box.appendChild(select([{ value: "true", label: "est vraie" }, { value: "false", label: "est fausse" }], cond.value ? "true" : "false", (v) => { cond.value = v === "true"; onChange(); }));
  } else if (cond.kind === "numeric") {
    box.appendChild(select(NUM_VARS.map((v) => ({ value: v, label: NUM_VARS_LABELS[v] ?? v })), cond.variable, (v) => { cond.variable = v; onChange(); }));
    box.appendChild(select(["<", "<=", ">", ">=", "=="].map((o) => ({ value: o, label: o })), cond.operator, (v) => { cond.operator = v; onChange(); }));
    box.appendChild(numberInput(cond.value, (v) => { cond.value = v; onChange(); }));
  } else {
    box.appendChild(select(Object.keys(CAT_VARS).map((k) => ({ value: k, label: k === "biome" ? "Biome" : "Typologie de terrain" })), cond.variable, (v) => { cond.variable = v; cond.value = CAT_VARS[v][0]; onChange(); }));
    box.appendChild(select(CAT_VARS[cond.variable]?.map((c) => ({ value: c, label: c })) ?? [], cond.value, (v) => { cond.value = v; onChange(); }));
  }
  return box;
}

function renderActionEditor(rule: any, onChange: () => void): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
  const actionTypes = [
    { value: "allure", label: "Changer l'allure" },
    { value: "risque", label: "Changer le risque" },
    { value: "ravitaillement", label: "Ravitaillement (prochaine station)" },
    { value: "reparer_organe", label: "Réparer un organe (station)" },
    { value: "remplacer_roue", label: "Remplacer une roue" },
    { value: "dormir", label: "Dormir" },
    { value: "depassement", label: "Moduler le dépassement" },
    { value: "defendre_position", label: "Défendre sa position" },
    { value: "appeler_camion", label: "Appeler le camion d'assistance" },
    { value: "arreter_station", label: "S'arrêter à la prochaine station" },
    { value: "reprendre_route", label: "Reprendre la route" },
    { value: "assistance_rival", label: "Assistance à un rival" },
    { value: "set_rule", label: "Méta-action: activer/désactiver une règle" },
  ];
  const ensure = (kind: string) => {
    const defaults: Record<string, any> = {
      allure: { kind: "allure", level: "normale" },
      risque: { kind: "risque", level: "normal" },
      ravitaillement: { kind: "ravitaillement", target: { kind: "percent", percent: 100 } },
      reparer_organe: { kind: "reparer_organe", organ: "moteur" },
      remplacer_roue: { kind: "remplacer_roue", where: "station" },
      dormir: { kind: "dormir", hours: 7, place: "bivouac" },
      depassement: { kind: "depassement", level: "prudent" },
      defendre_position: { kind: "defendre_position" },
      appeler_camion: { kind: "appeler_camion" },
      arreter_station: { kind: "arreter_station" },
      reprendre_route: { kind: "reprendre_route" },
      assistance_rival: { kind: "assistance_rival" },
      set_rule: { kind: "set_rule", channel: 1, enabled: false },
    };
    rule.action = defaults[kind];
    onChange();
  };
  box.appendChild(select(actionTypes, rule.action.kind, ensure));
  const a = rule.action;
  if (a.kind === "allure") box.appendChild(select(["lift_and_coast", "prudente", "normale", "soutenue", "attaque"].map((l) => ({ value: l, label: PACE_FR[l] ?? l })), a.level, (v) => { a.level = v; onChange(); }));
  else if (a.kind === "risque") box.appendChild(select(["bas", "normal", "haut"].map((l) => ({ value: l, label: l })), a.level, (v) => { a.level = v; onChange(); }));
  else if (a.kind === "ravitaillement") {
    box.appendChild(select([{ value: "percent", label: "% du réservoir" }, { value: "litres", label: "Litres" }], a.target.kind, (v) => {
      a.target = v === "percent" ? { kind: "percent", percent: 100 } : { kind: "litres", litres: 60 };
      onChange();
    }));
    box.appendChild(numberInput(a.target.kind === "percent" ? a.target.percent : a.target.litres, (v) => {
      if (a.target.kind === "percent") a.target.percent = v; else a.target.litres = v;
      onChange();
    }));
  } else if (a.kind === "reparer_organe") box.appendChild(select(Object.entries(ORGANS_FR).map(([k, v]) => ({ value: k, label: v })), a.organ, (v) => { a.organ = v; onChange(); }));
  else if (a.kind === "remplacer_roue") box.appendChild(select([{ value: "station", label: "à la station" }, { value: "bord_piste", label: "au bord de la piste" }], a.where, (v) => { a.where = v; onChange(); }));
  else if (a.kind === "dormir") {
    box.appendChild(numberInput(a.hours, (v) => { a.hours = v; onChange(); }));
    box.appendChild(select([{ value: "bivouac", label: "bivouac sur place" }, { value: "hotel", label: "hôtel (prochaine station)" }], a.place, (v) => { a.place = v; onChange(); }));
  } else if (a.kind === "depassement") box.appendChild(select(["agressif", "prudent", "interdit"].map((l) => ({ value: l, label: l })), a.level, (v) => { a.level = v; onChange(); }));
  else if (a.kind === "set_rule") {
    box.appendChild(numberInput(a.channel, (v) => { a.channel = Math.round(v); onChange(); }));
    box.appendChild(select([{ value: "true", label: "activée" }, { value: "false", label: "désactivée" }], a.enabled ? "true" : "false", (v) => { a.enabled = v === "true"; onChange(); }));
  }
  return box;
}

function openPlanner(): void {
  const car = myCar();
  if (!car) return;
  if (car.arrived || car.forfait) return;
  const fsEl = $("fullscreen");
  fsEl.style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "overflow-y:auto";
  // hauteur réelle du conteneur: le planificateur scrolle jusqu'en bas
  const fsBtn = $("btn-close");
  wrap.style.maxHeight = (fsEl.clientHeight - fsBtn.clientHeight - 40) + "px";

  const rules = JSON.parse(JSON.stringify(car.rules));
  let dirty = false;

  // rendu COMPACT: une ligne par règle — N° | on/off | condition→action | durée | éditer | suppr
  const render = () => {
    wrap.innerHTML = "<h2 style='margin:0 0 6px'>Planificateur — 50 canaux <small>(le n° le plus bas gagne)</small></h2>";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
    table.innerHTML = "<tr style='color:#d9a441;text-align:left'><th>N°</th><th>On</th><th>Condition(s)</th><th>Action</th><th style='width:40px'></th></tr>";
    const sorted = [...rules].sort((a: any, b: any) => a.channel - b.channel);
    for (const r of sorted) {
      const tr = document.createElement("tr");
      tr.style.cssText = "border-top:1px solid #444;height:26px";
      const cond = r.conditions.length === 0 ? "<i>toujours</i>" : r.conditions.map(condText).join(" ET ");
      const effTxt = r.effect.kind === "duration" ? ` (${r.effect.hours}h)` : r.effect.kind === "distance" ? ` (${r.effect.km}km)` : "";
      const modeTxt = r.mode === "one_shot" ? " ⚡" : "";
      tr.innerHTML = `<td><b>${r.channel}</b></td><td>${r.enabled ? "🟢" : "⚪"}</td><td>${escapeHtml(cond)}</td><td>${escapeHtml(actionText(r.action))}${effTxt}${modeTxt}</td>`;
      const td = document.createElement("td");
      td.style.whiteSpace = "nowrap";
      const toggle = document.createElement("button");
      toggle.className = "small";
      toggle.textContent = r.enabled ? "⏸" : "▶";
      toggle.title = r.enabled ? "Désactiver" : "Activer";
      toggle.onclick = () => { r.enabled = !r.enabled; render(); };
      const edit = document.createElement("button");
      edit.className = "small";
      edit.textContent = "✎";
      edit.title = "Éditer";
      edit.onclick = () => openRuleEditor(r);
      const del = document.createElement("button");
      del.className = "small";
      del.textContent = "🗑";
      del.onclick = () => { rules.splice(rules.indexOf(r), 1); render(); };
      td.append(toggle, edit, del);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    const bottom = document.createElement("div");
    bottom.style.cssText = "margin-top:8px";
    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Nouvelle règle";
    addBtn.onclick = () => {
      if (rules.length >= 50) return;
      const used = new Set(rules.map((r: any) => r.channel));
      let ch = 1;
      while (used.has(ch)) ch++;
      const nr = { channel: ch, enabled: true, conditions: [], action: { kind: "allure", level: "normale" }, effect: { kind: "default" }, mode: "persistante" };
      rules.push(nr);
      render();
      openRuleEditor(nr);
    };
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Enregistrer";
    saveBtn.style.background = "#7c7";
    saveBtn.onclick = () => { send({ type: "rules", rules }); closeFullscreen(); };
    bottom.append(addBtn, saveBtn);
    wrap.appendChild(bottom);
  };

  // éditeur d'une règle: panneau au-dessus de la liste (condition/action/durée)
  const openRuleEditor = (r: any) => {
    const panel = document.createElement("div");
    panel.style.cssText = "border:1px solid #d9a441;border-radius:6px;padding:8px;margin-bottom:8px;background:#2f2a22";
    const close = () => { panel.remove(); };
    const rebuild = () => {
      panel.innerHTML = "";
      const title = document.createElement("div");
      title.innerHTML = `<b>Éditer la règle N°${r.channel}</b>`;
      panel.appendChild(title);
      const row1 = document.createElement("div");
      row1.style.cssText = "display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;margin-top:6px";
      const chanSel = document.createElement("select");
      for (let ch = 1; ch <= 50; ch++) {
        const opt = document.createElement("option");
        opt.value = String(ch); opt.textContent = "N°" + ch;
        chanSel.appendChild(opt);
      }
      chanSel.value = String(r.channel);
      chanSel.onchange = () => { if (!rules.some((x: any) => x.channel === parseInt(chanSel.value))) { r.channel = parseInt(chanSel.value); render(); } };
      row1.appendChild(field("Canal", chanSel));
      // conditions (ET)
      for (const cond of r.conditions) {
        const condBox = document.createElement("span");
        condBox.style.cssText = "display:flex;gap:4px;align-items:flex-end";
        condBox.appendChild(renderConditionEditor(cond, () => { dirty = true; }));
        const rm = document.createElement("button");
        rm.className = "small"; rm.textContent = "✕";
        rm.onclick = () => { r.conditions.splice(r.conditions.indexOf(cond), 1); rebuild(); };
        condBox.appendChild(rm);
        row1.appendChild(condBox);
      }
      if (r.conditions.length < 3) {
        const addC = document.createElement("button");
        addC.className = "small"; addC.textContent = "+ condition";
        addC.onclick = () => { r.conditions.push({ kind: "bool", variable: "nuit", value: true }); rebuild(); };
        row1.appendChild(addC);
      }
      panel.appendChild(row1);
      const row2 = document.createElement("div");
      row2.style.cssText = "display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;margin-top:6px";
      row2.appendChild(renderActionEditor(r, () => { dirty = true; }));
      // durée d'effet
      const effSel = select(
        [
          { value: "default", label: "jusqu'à consigne contraire" },
          { value: "duration", label: "pendant (h)" },
          { value: "distance", label: "pendant (km)" },
        ],
        r.effect.kind,
        (v: string) => {
          r.effect = v === "default" ? { kind: "default" } : v === "duration" ? { kind: "duration", hours: 2 } : { kind: "distance", km: 200 };
          rebuild();
        }
      );
      row2.appendChild(field("Durée", effSel));
      if (r.effect.kind === "duration") row2.appendChild(numberInput(r.effect.hours, (v: number) => { r.effect.hours = v; }));
      if (r.effect.kind === "distance") row2.appendChild(numberInput(r.effect.km, (v: number) => { r.effect.km = v; }));
      const modeSel = select(
        [{ value: "persistante", label: "Persistante" }, { value: "one_shot", label: "One-shot" }],
        r.mode,
        (v: string) => { r.mode = v; }
      );
      row2.appendChild(field("Mode", modeSel));
      panel.appendChild(row2);
      const done = document.createElement("button");
      done.textContent = "✓ Terminé";
      done.style.marginTop = "6px";
      done.onclick = () => { close(); render(); };
      panel.appendChild(done);
    };
    rebuild();
    wrap.insertBefore(panel, wrap.firstChild);
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

// ===== Réglages voiture (aux stations uniquement) =====
function openSettings(car: MyCar): void {
  const fsEl = $("fullscreen");
  fsEl.style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.innerHTML = "<h2>Réglages voiture — modifiables uniquement à l'arrêt en station</h2>";
  const st = car.settings;
  const sliders: { key: string; label: string; hint: string }[] = [
    { key: "tirePressure", label: "Pression des pneus", hint: "haute = vitesse sur piste dure, basse = accroche sable/dunes" },
    { key: "groundClearance", label: "Garde au sol", hint: "haute = dunes/rochers, basse = stabilité et vitesse sur piste" },
    { key: "engineMap", label: "Cartographie moteur", hint: "puissance vs consommation" },
  ];
  for (const sl of sliders) {
    const row = field(`${sl.label} (0-100) — ${sl.hint}`, (() => {
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = "0";
      inp.max = "100";
      inp.value = String((st as any)[sl.key]);
      inp.style.width = "220px";
      return inp;
    })());
    wrap.appendChild(row);
  }
  const save = document.createElement("button");
  save.textContent = "💾 Appliquer";
  save.style.background = "#7c7";
  save.onclick = () => {
    const settings = {};
    wrap.querySelectorAll("input[type=range]").forEach((inp: any, i) => {
      (settings as any)[sliders[i].key] = parseInt(inp.value);
    });
    send({ type: "settings", settings });
    closeFullscreen();
  };
  wrap.appendChild(save);
  content.appendChild(wrap);
}

// ===== Détail budget =====
function openBudget(car: MyCar): void {
  const fsEl = $("fullscreen");
  fsEl.style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.innerHTML = `<h2>Portefeuille — ${car.budget.toFixed(0)}</h2><p>Primes reçues : ${car.stats.primes.toFixed(0)} — Dépenses : ${car.stats.depenses.toFixed(0)}</p>`;
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Heure</th><th>Opération</th><th>Montant</th></tr>";
  for (const t of [...car.transactions].reverse().slice(0, 30)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${fmtHour(t.tick)}</td><td>${escapeHtml(t.label)}</td><td style="color:${t.amount >= 0 ? "#7c7" : "#c66"}">${t.amount >= 0 ? "+" : ""}${t.amount.toFixed(0)}</td>`;
    table.appendChild(tr);
  }
  wrap.appendChild(table);
  const close = document.createElement("button");
  close.textContent = "Fermer";
  close.onclick = closeFullscreen;
  wrap.appendChild(close);
  content.appendChild(wrap);
}

// ===== Écran de résultats =====
function openResults(): void {
  if (!state) return;
  const fsEl = $("fullscreen");
  fsEl.style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.innerHTML = "<h2>🏁 Résultats de la course</h2>";
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>#</th><th>Pilote</th><th>Distance</th><th>V. moy.</th><th>Pannes</th><th>Accidents</th><th>Dépassements</th><th>Dépenses</th><th>Primes</th></tr>";
  state.standings.forEach((pid, i) => {
    const p = state!.players.find((x) => x.id === pid);
    const c = state!.cars.find((x) => x.playerId === pid);
    if (!c) return;
    const avg = state!.tick > 0 ? c.positionKm / (state!.tick / 3600) : 0;
    const st = c.stats;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(p?.pseudo ?? pid)}${c.arrived ? " 🏁" : c.forfait ? " ❌" : ""}</td><td>${c.positionKm.toFixed(0)} km</td><td>${avg.toFixed(1)} km/h</td><td>${st ? st.pannes : "—"}</td><td>${st ? st.accidents : "—"}</td><td>${st ? st.depassements : "—"}</td><td>${st ? st.depenses.toFixed(0) : "—"}</td><td>${st ? st.primes.toFixed(0) : "—"}</td>`;
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  content.appendChild(wrap);
}

// ===== CARTE topographique: ZOOM (molette) + PAN (drag) =====
let mapZoomLevel = 1;
let mapCenterKm: number | null = null;
let mapDrag: { x: number; y: number } | null = null;

function drawMap(m: CanvasRenderingContext2D, w: number, h: number): void {
  if (!state) return;
  m.fillStyle = "#3a332a";
  m.fillRect(0, 0, w, h);
  const pts = state.pathSummary ?? [];
  if (pts.length === 0) return;

  const myPos = state.cars.find((c) => c.playerId === myId);
  if (mapCenterKm === null && myPos) mapCenterKm = myPos.positionKm;
  const focusKm = mapCenterKm ?? myPos?.positionKm ?? 0;
  const focusPt = pts.reduce((best: any, p: any) => Math.abs(p.km - focusKm) < Math.abs(best.km - focusKm) ? p : best, pts[0]);

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const spanAll = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.08 || 1;
  const span = spanAll / mapZoomLevel;
  const cx0 = focusPt.x, cy0 = focusPt.y;
  const side = Math.min(w - 40, h - 40);
  const mapX = (x: number) => w / 2 + ((x - cx0) / span) * side;
  const mapY = (y: number) => h / 2 + ((y - cy0) / span) * side;

  // biomes en bandes sous le tracé
  for (const z of state.world.biomeZones ?? []) {
    m.strokeStyle = BIOME_COLORS[z.biome] ?? "#8fae6d";
    m.globalAlpha = 0.3;
    m.lineWidth = 9;
    m.beginPath();
    let started = false;
    for (const p of pts) {
      if (p.km < z.startKm || p.km > z.endKm) continue;
      const x = mapX(p.x), y = mapY(p.y);
      if (!started) { m.moveTo(x, y); started = true; } else m.lineTo(x, y);
    }
    m.stroke();
    m.globalAlpha = 1;
  }

  m.strokeStyle = "#d9a441";
  m.lineWidth = Math.max(1.5, 3 / Math.sqrt(mapZoomLevel));
  m.beginPath();
  pts.forEach((p, i) => {
    const x = mapX(p.x), y = mapY(p.y);
    if (i === 0) m.moveTo(x, y); else m.lineTo(x, y);
  });
  m.stroke();

  const iconSize = Math.min(16, Math.max(10, 14 / Math.sqrt(mapZoomLevel)));
  m.font = iconSize + "px sans-serif";
  state.world.stations.forEach((s: any) => {
    const pos = pts.reduce((best: any, p: any) => Math.abs(p.km - s.km) < Math.abs(best.km - s.km) ? p : best, pts[0]);
    const x = mapX(pos.x), y = mapY(pos.y);
    m.fillText("⛽", x - iconSize / 2, y - 8);
    if (s.hasHotel) m.fillText("🏨", x + iconSize / 2, y - 8);
    if (mapZoomLevel > 2) {
      m.fillStyle = "#fff";
      m.font = "9px sans-serif";
      m.fillText(s.name, x - 18, y - 22);
      m.font = iconSize + "px sans-serif";
    }
  });
  if (mapZoomLevel > 1.5) {
    (state.world.villages ?? []).forEach((v: any) => {
      const pos = pts.reduce((best: any, p: any) => Math.abs(p.km - v.km) < Math.abs(best.km - v.km) ? p : best, pts[0]);
      m.fillText("🏠", mapX(pos.x) - 5, mapY(pos.y) + 14);
    });
    (state.world.bridges ?? []).forEach((b: any) => {
      const pos = pts.reduce((best: any, p: any) => Math.abs(p.km - b.km) < Math.abs(best.km - b.km) ? p : best, pts[0]);
      m.fillText("＝", mapX(pos.x) - 5, mapY(pos.y) + 6);
    });
  }
  const FRONT_COLORS: Record<string, string> = {
    pluie_diluvienne: "rgba(80,120,220,0.35)", tempete_sable: "rgba(210,160,80,0.4)",
    canicule: "rgba(230,120,40,0.25)", froid_intense: "rgba(160,200,255,0.3)",
    brouillard: "rgba(200,200,200,0.3)", vent_fort: "rgba(150,180,160,0.25)",
    grele: "rgba(190,210,255,0.4)", piste_endommagee: "rgba(120,60,40,0.5)",
  };
  m.font = "10px sans-serif";
  for (const f of state.fronts ?? []) {
    if (state.tick < f.startTick || state.tick > f.endTick) continue;
    const pos = pts.reduce((best: any, p: any) => Math.abs(p.km - f.km) < Math.abs(best.km - f.km) ? p : best, pts[0]);
    const fx = mapX(pos.x), fy = mapY(pos.y);
    m.fillStyle = FRONT_COLORS[f.kind] ?? "rgba(150,150,150,0.3)";
    const fr = Math.max(3, (f.radiusKm / (state.world.totalKm / mapZoomLevel)) * side * 0.5);
    m.beginPath();
    m.arc(fx, fy, fr, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "#fff";
    m.fillText(WEATHER_ICON[f.kind] ?? "?", fx - 6, fy - fr - 4);
  }
  state.cars.forEach((c) => {
    const pos = pts.reduce((best: any, p: any) => Math.abs(p.km - c.positionKm) < Math.abs(best.km - c.positionKm) ? p : best, pts[0]);
    const x = mapX(pos.x), y = mapY(pos.y);
    m.fillStyle = c.color;
    m.beginPath();
    m.arc(x, y, 6, 0, Math.PI * 2);
    m.fill();
    m.strokeStyle = "#fff";
    m.lineWidth = 1.5;
    m.stroke();
    const pp = state!.players.find((q) => q.id === c.playerId);
    m.fillStyle = "#fff";
    m.font = "11px sans-serif";
    m.fillText(pp?.pseudo ?? "", x + 9, y + 4);
  });
  m.fillStyle = "#fff";
  m.font = "bold 13px sans-serif";
  m.fillText("A", mapX(pts[0].x) - 4, mapY(pts[0].y) - 10);
  m.fillText("B", mapX(pts[pts.length - 1].x) - 4, mapY(pts[pts.length - 1].y) - 10);
  m.fillStyle = "#888";
  m.font = "10px sans-serif";
  m.fillText("Zoom ×" + mapZoomLevel.toFixed(1) + " — molette: zoom, glisser: déplacer, double-clic: suivre", 10, h - 10);
}

// ===== Carte =====
function openMap(): void {
  if (!state) return;
  mapCenterKm = null;
  $("fullscreen").style.display = "block";
  const content = $("fscontent");
  content.innerHTML = "";
  const c = document.createElement("canvas");
  c.width = content.clientWidth - 20 || 900;
  c.height = (content.clientWidth - 20 || 900) * 0.55;
  c.style.cssText = "cursor:grab";
  content.appendChild(c);
  const ctxM = c.getContext("2d")!;
  const redraw = () => drawMap(ctxM, c.width, c.height);
  redraw();

  // molette = zoom autour du point souris
  c.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const old = mapZoomLevel;
    mapZoomLevel = Math.max(1, Math.min(40, mapZoomLevel * (e.deltaY > 0 ? 0.8 : 1.25)));
    if (mapZoomLevel === old) return;
    redraw();
  }, { passive: false });
  // drag = pan (déplace le focus en km le long du tracé)
  c.addEventListener("mousedown", (e: MouseEvent) => {
    mapDrag = { x: e.offsetX, y: e.offsetY };
    c.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    if (mapDrag) { mapDrag = null; c.style.cursor = "grab"; }
  });
  c.addEventListener("mousemove", (e: MouseEvent) => {
    if (!mapDrag) return;
    // pan en km: approx via la largeur visible = totalKm/zoom
    const dpx = e.offsetX - mapDrag.x;
    const dkm = -(dpx / c.width) * (state!.world.totalKm / mapZoomLevel);
    const cur = mapCenterKm ?? state!.cars.find((x) => x.playerId === myId)?.positionKm ?? 0;
    mapCenterKm = Math.max(0, Math.min(state!.world.totalKm, cur + dkm));
    mapDrag = { x: e.offsetX, y: e.offsetY };
    redraw();
  });
  c.addEventListener("dblclick", () => { mapCenterKm = null; redraw(); });
  // refresh périodique (voitures avancent)
  setInterval(() => {
    if ($("fullscreen").style.display === "block" && !mapDrag) redraw();
  }, 2000);
}

function altAt(km: number): number {
  if (!state) return 0;
  const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
  return seg?.altitude ?? 0;
}

// ===== Rendu caméra =====
let camZoom = 0.55; // dézoom par défaut: ~73 m visibles
let racingOffset = 0; // décalage latéral courant de la racing line
let lastStateTime = 0;
let extrapolatedKm = 0;
let lastKnownKm = 0;
let lastKnownSpeed = 0;
const pathChunks = new Map<number, any[]>();
let lastFrame = 0;
let dustParticles: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
let rainDrops: { x: number; y: number }[] = [];

const WEATHER_FR: Record<string, string> = {
  clair: "Ciel dégagé", pluie_diluvienne: "Pluie diluvienne", tempete_sable: "Tempête de sable",
  canicule: "Canicule", froid_intense: "Froid intense", brouillard: "Brouillard dense",
  vent_fort: "Vent latéral fort", grele: "Grêle / orage",
};
const WEATHER_ICON: Record<string, string> = {
  clair: "☀️", pluie_diluvienne: "🌧️", tempete_sable: "🌪️", canicule: "🥵",
  froid_intense: "❄️", brouillard: "🌫️", vent_fort: "💨", grele: "⛈️",
};

cv.addEventListener("wheel", (e) => {
  camZoom = Math.max(0.12, Math.min(1.8, camZoom * (e.deltaY > 0 ? 0.9 : 1.11)));
});


// ===== Vue 2D de haut — route ancrée au monde, caméra suit la voiture =====
// Tracé réel: les chunks de polyligne 2D du monde, demandés au serveur.
// pathPoint(k) interpole dans les chunks — la vue dessine le VRAI monde.
// Interpolation Catmull-Rom entre 4 points de tracé: la route est une COURBE
// lisse (les virages sont ronds, plus de facettes visibles entre segments).
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function rawPoint(k: number): { x: number; y: number } | null {
  const base = Math.floor(k / 4) * 4; // chunks de 4 km
  const chunk = pathChunks.get(base);
  if (!chunk || chunk.length === 0) return null;
  const fi = ((k - base) * 1000) / 20; // pas du tracé: 20 m
  const i0 = Math.max(0, Math.min(chunk.length - 1, Math.floor(fi)));
  const i1 = Math.min(chunk.length - 1, i0 + 1);
  const f = fi - i0;
  return {
    x: chunk[i0].x + (chunk[i1].x - chunk[i0].x) * f,
    y: chunk[i0].y + (chunk[i1].y - chunk[i0].y) * f,
  };
}

function pathPoint(k: number): { x: number; y: number } | null {
  // points de contrôle autour de k (i-1, i, i+1, i+2) — dans le chunk
  const base = Math.floor(k / 4) * 4;
  const chunk = pathChunks.get(base);
  if (!chunk || chunk.length === 0) return null;
  const fi = ((k - base) * 1000) / 20;
  const i1 = Math.max(0, Math.min(chunk.length - 1, Math.floor(fi)));
  const i0 = Math.max(0, i1 - 1);
  const i2 = Math.min(chunk.length - 1, i1 + 1);
  const i3 = Math.min(chunk.length - 1, i1 + 2);
  const t = fi - Math.floor(fi);
  return {
    x: catmull(chunk[i0].x, chunk[i1].x, chunk[i2].x, chunk[i3].x, t),
    y: catmull(chunk[i0].y, chunk[i1].y, chunk[i2].y, chunk[i3].y, t),
  };
}

// ===== Caméra poursuite douce: nord fixe du MONDE, voiture en mouvement =====
// La voiture BOUGE à l'écran: la caméra la suit avec retard (lissage), la
// voiture glisse dans le cadre selon sa trajectoire réelle. En virage, la
// caméra pivote doucement vers le cap de la route (optionnel: léger).
let camX = 0, camY = 0, camAngle = 0;
let camInit = false;

function drawFlatWorld(w: number, h: number, km: number, seg: any, myPub: CarPublic | undefined, now: number, _dt: number): void {
  // ÉCHELLE CAMÉRA: ~40 m visibles de large. À 60 km/h le décor défile
  // à ~500 px/s (sensation de vitesse réelle) et la voiture fait ~140 px.
  const PXM = (w / 40) * camZoom; // pixels par mètre

  // ma position sur l'axe du tracé + point devant (cap de la route)
  const meRoad = pathPoint(km);
  const meAhead = pathPoint(km + 0.006);
  if (!meRoad || !meAhead) {
    ctx.fillStyle = "#2b2620";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#efe8dc";
    ctx.font = "14px sans-serif";
    ctx.fillText("Chargement du tracé…", w / 2 - 70, h / 2);
    return;
  }
  // RACING LINE CONTINUE — apex au MILIEU du virage: on lit la courbure sur une
  // fenêtre SYMÉTRIQUE (-150/+150 m) et le décalage suit la courbure LOCALE
  // (forte ici = à l'apex on est à l'intérieur; en approche/sortie on s'ouvre).
  const roadWm0 = seg?.width === "etroite" ? 3.5 : seg?.width === "moyenne" ? 5 : 6.5;
  const HALFR = 0.15;
  let curvHere = 0;
  {
    const pA = pathPoint(km - 0.006), pB = pathPoint(km + 0.006);
    if (pA && pB) {
      const ax = pB.x - pA.x, ay = pB.y - pA.y;
      const aLen = Math.hypot(ax, ay) || 1;
      const gx2 = meAhead.x - meRoad.x, gy2 = meAhead.y - meRoad.y;
      curvHere = (gx2 * ay - gy2 * ax) / (aLen * (Math.hypot(gx2, gy2) || 1));
    }
  }
  // anticipation: la courbure qui VIENT (devant) déclenche la prise d'extérieur
  let curvAhead = 0;
  {
    const pA = pathPoint(km + 0.02), pB = pathPoint(km + 0.08);
    if (pA && pB) {
      const ax = pB.x - pA.x, ay = pB.y - pA.y;
      const aLen = Math.hypot(ax, ay) || 1;
      const gx2 = meAhead.x - meRoad.x, gy2 = meAhead.y - meRoad.y;
      curvAhead = (gx2 * ay - gy2 * ax) / (aLen * (Math.hypot(gx2, gy2) || 1));
    }
  }
  // décalage cible: À L'APEX (courbure locale forte) -> intérieur;
  // en approche (courbure devant, locale faible) -> extérieur; sortie -> neutre.
  const breathe = Math.sin(km * 137.3) * roadWm0 * 0.08;
  const insideNow = Math.max(-1, Math.min(1, -curvHere * 16)) * roadWm0 * 0.5;   // apex: intérieur
  const outsidePrep = Math.max(-1, Math.min(1, -curvAhead * 16)) * -roadWm0 * 0.4; // approche: extérieur
  const targetOffset = (Math.abs(curvHere) > 0.06 ? insideNow : outsidePrep) + breathe;
  // lissage temporel doux: mouvement latéral fluide
  racingOffset += (targetOffset - racingOffset) * 0.03;
  // position effective de la voiture: axe du tracé + décalage latéral (normale locale)
  const angRoad = Math.atan2(meAhead.y - meRoad.y, meAhead.x - meRoad.x);
  const me = {
    x: meRoad.x - Math.sin(angRoad) * racingOffset,
    y: meRoad.y + Math.cos(angRoad) * racingOffset,
  };
  const carAngle = Math.atan2(meAhead.y - meRoad.y, meAhead.x - meRoad.x);

  // CAMÉRA ARRIÈRE (poursuite): la cible est la POSITION de la voiture, mais
  // le suivi est RETARDÉ (10%/frame). En accélérant, la voiture s'élève dans
  // le cadre (vers le haut), la caméra la rattrape — vraie caméra de poursuite.
  // La voiture est ancrée à 30% du bas: on voit sa DERRIÈRE et la route loin devant.
  const targetX = me.x;
  const targetY = me.y;
  if (!camInit) { camX = targetX; camY = targetY; camAngle = carAngle; camInit = true; }
  const follow = 0.10;
  camX += (targetX - camX) * follow;
  camY += (targetY - camY) * follow;
  // HYSTÉRÉSIS: 20° de liberté — la caméra ne pivote pas pour des micro-écarts;
  // au-delà de la zone morte, elle suit franchement (effet de "prise en main").
  const CAM_DEADZONE = (20 * Math.PI) / 180;
  let dAng = carAngle - camAngle;
  while (dAng > Math.PI) dAng -= 2 * Math.PI;
  while (dAng < -Math.PI) dAng += 2 * Math.PI;
  if (Math.abs(dAng) > CAM_DEADZONE) {
    // ramener l'écart au bord de la zone morte (la voiture garde sa liberté)
    const excess = dAng - Math.sign(dAng) * CAM_DEADZONE;
    camAngle += excess * 0.3;
  }

  // transformation monde -> écran: le CAP de la voiture pointe vers le HAUT.
  // On applique la rotation inverse du cap PUIS un quart de tour (-90°):
  // un point devant la voiture obtient ry négatif (vers le haut de l'écran).
  const viewAngle = camAngle + Math.PI / 2; // repère "cap = -y écran"
  const cosV = Math.cos(-viewAngle), sinV = Math.sin(-viewAngle);
  const W2S = (x: number, y: number): [number, number] => {
    const dx = x - camX, dy = y - camY;
    const rx = dx * cosV - dy * sinV;
    const ry = dx * sinV + dy * cosV;
    // voiture à 30% du BAS: on la voit de dos au bas de l'écran,
    // la route s'étire loin devant vers le HAUT
    return [w / 2 + rx * PXM, h * 0.70 + ry * PXM];
  };

  // sol
  ctx.fillStyle = BIOME_COLORS[seg?.biome ?? "steppe"];
  ctx.fillRect(0, 0, w, h);

  // ---------- ROUTE: le vrai tracé, large bande, tous les points visibles ----------
  // ±1 km: la route et son environnement sont dessinés loin autour de la
  // voiture (le préchargement de chunks ±8 km couvre largement).
  const half = 1.0;
  const roadWm = seg?.width === "etroite" ? 3.5 : seg?.width === "moyenne" ? 5 : 6.5;
  // collecter les points du tracé dans la fenêtre
  const path: { x: number; y: number }[] = [];
  for (let k = km - half; k <= km + half; k += 0.0004) {
    const p = pathPoint(k);
    if (p) path.push(p);
  }
  if (path.length > 1) {
    // épaisseur: bande route + accotements
    const drawBand = (widthM: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = widthM * 2 * PXM;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      path.forEach((p, i) => {
        const [sx, sy] = W2S(p.x, p.y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    };
    drawBand(roadWm + 1.6, "rgba(180,160,120,0.5)"); // accotement
    drawBand(roadWm, "#6b5b43");                      // piste
    // LIGNE CENTRALE ancrée au monde: le motif pointillé démarre à des
    // positions de tracé en MÈTRES ARRONDIS (multiples de 7 m = période du
    // motif 3+4). La voiture avance, le motif reste fixe sur la route.
    ctx.strokeStyle = "rgba(230,220,190,0.45)";
    ctx.lineWidth = 0.3 * PXM;
    const PERIOD_M = 7; // 3 m de trait + 4 m de vide
    // dessiner chaque trait séparément, positionné en mètres du monde
    const startM = Math.ceil((km - half) * 1000 / PERIOD_M) * PERIOD_M;
    for (let m = startM; m <= (km + half) * 1000; m += PERIOD_M) {
      const k0 = m / 1000;
      const k1 = (m + 3) / 1000;
      const pa = pathPoint(k0), pb = pathPoint(k1);
      if (!pa || !pb) continue;
      const [sx0, sy0] = W2S(pa.x, pa.y);
      const [sx1, sy1] = W2S(pb.x, pb.y);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
  }

  // ---------- DÉCORS ancrés au monde (hash de position absolue) ----------
  const hash = (n: number) => {
    const v = Math.sin(n * 127.1) * 43758.5453;
    return v - Math.floor(v);
  };
  // DEUX RANGÉES de décors ancrés au monde: bande rapprochée (10-40 m) et
  // horizon proche (40-110 m) — l'environnement existe au-delà du ruban.
  const decorStep = 15; // le long du tracé
  const dStart = Math.floor((km - half) * 1000 / decorStep) * decorStep;
  for (let dm = dStart; dm <= (km + half) * 1000; dm += decorStep) {
    const k = dm / 1000;
    const p = pathPoint(k);
    if (!p) continue;
    for (let row = 0; row < 2; row++) {
    const idx = Math.round(dm / decorStep) * 2 + row;
    const r1 = hash(idx * 3 + 1), r2 = hash(idx * 7 + 2), r3 = hash(idx * 11 + 3);
    if (r3 < 0.32) continue;
    const side = r2 < 0.5 ? -1 : 1;
    const dist = row === 0 ? roadWm + 6 + r1 * 30 : roadWm + 38 + r1 * 70;
    // normale au tracé à cette position
    const pA = pathPoint(k - 0.002), pB = pathPoint(k + 0.002);
    if (!pA || !pB) continue;
    const a = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    const nx = -Math.sin(a) * side, ny = Math.cos(a) * side;
    const dx = p.x + nx * dist, dy = p.y + ny * dist;
    const [sx, sy] = W2S(dx, dy);
    if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
    const sz = (0.9 + r1 * 2.4) * PXM;
    if (r3 < 0.72) {
      ctx.fillStyle = row === 1 ? "rgba(85,76,61,0.75)" : "rgba(95,85,68,0.9)";
      ctx.beginPath();
      ctx.ellipse(sx, sy, sz, sz * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (seg?.biome === "desert") {
      ctx.strokeStyle = "rgba(110,140,80,0.75)";
      ctx.lineWidth = Math.max(1, 0.28 * PXM);
      ctx.beginPath();
      ctx.moveTo(sx, sy + sz);
      ctx.lineTo(sx, sy - sz * 1.5);
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - sz * 0.8, sy - sz);
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + sz * 0.8, sy - sz);
      ctx.stroke();
    } else {
      ctx.fillStyle = seg?.biome === "humide" ? (row === 1 ? "rgba(38,88,48,0.7)" : "rgba(45,100,55,0.85)") : (row === 1 ? "rgba(62,98,46,0.7)" : "rgba(75,115,55,0.8)");
      ctx.beginPath();
      ctx.ellipse(sx, sy, sz * 1.25, sz, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    }
  }

  // ---------- PIQUETS de vitesse: tous les 20 m, à portée visible ----------
  const halfPiquets = Math.min(half, 0.2);
  for (let dm = Math.floor((km - halfPiquets) * 50) * 20; dm <= (km + halfPiquets) * 1000; dm += 20) {
    const k = dm / 1000;
    const p = pathPoint(k);
    if (!p) continue;
    const pA = pathPoint(k - 0.002), pB = pathPoint(k + 0.002);
    if (!pA || !pB) continue;
    const a = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    for (const side of [-1, 1]) {
      const dx = p.x - Math.sin(a) * (roadWm + 2.5) * side;
      const dy = p.y + Math.cos(a) * (roadWm + 2.5) * side;
      const [sx, sy] = W2S(dx, dy);
      ctx.fillStyle = side < 0 ? "rgba(240,235,220,0.9)" : "rgba(200,60,40,0.9)";
      ctx.fillRect(sx - 0.12 * PXM, sy - 1.4 * PXM, 0.25 * PXM, 1.4 * PXM);
    }
  }

  // ---------- BORNES hectométriques ----------
  for (let b = Math.ceil((km - half) * 10) / 10; b <= km + half; b += 0.1) {
    const p = pathPoint(b);
    if (!p) continue;
    const pA = pathPoint(b - 0.002), pB = pathPoint(b + 0.002);
    if (!pA || !pB) continue;
    const a = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const dx = p.x + nx * (roadWm + 1.6), dy = p.y + ny * (roadWm + 1.6);
    const [sx, sy] = W2S(dx, dy);
    const isKm = Math.abs(b - Math.round(b)) < 0.001;
    ctx.fillStyle = isKm ? "#efe8dc" : "rgba(220,210,190,0.55)";
    const bh = (isKm ? 2.0 : 1.1) * PXM;
    ctx.fillRect(sx - 0.22 * PXM, sy - bh, 0.45 * PXM, bh);
  }

  // ---------- STATIONS à l'approche ----------
  for (const st of state?.world?.stations ?? []) {
    if (Math.abs(st.km - km) > half) continue;
    const p = pathPoint(st.km);
    if (!p) continue;
    const [sx, sy] = W2S(p.x, p.y);
    ctx.font = `${Math.max(13, 5 * PXM)}px sans-serif`;
    ctx.fillText("⛽", sx - 8, sy - 4 * PXM);
    if (st.hasHotel) ctx.fillText("🏨", sx + 8, sy - 4 * PXM);
  }

  // ---------- CONCURRENTS proches ----------
  if (myPub) {
    for (const c of state!.cars) {
      if (c.playerId === myId) continue;
      if (Math.abs(c.positionKm - km) > half) continue;
      const p = pathPoint(c.positionKm);
      if (!p) continue;
      drawCar2D(p.x, p.y, c.color, c.speedKmh > 2, W2S, PXM, now, c.positionKm, viewAngle, state!.players.find((pl) => pl.id === c.playerId)?.pseudo);
    }
  }

  // ---------- MA VOITURE: position réelle, cap réel, bouge à l'écran ----------
  if (myPub) {
    drawCar2D(me.x, me.y, myPub.color, myPub.speedKmh > 2, W2S, PXM, now, km, viewAngle);
    // états
    const [msx, msy] = W2S(me.x, me.y);
    if (myPub.immobilized) {
      ctx.fillStyle = "#e66";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("⚠ " + (myPub.immobilizedReason ?? ""), msx - 60, msy - 30);
    } else if (myPub.sleeping) {
      ctx.fillStyle = "#ccc";
      ctx.font = "13px sans-serif";
      ctx.fillText("💤 repos en cours", msx - 60, msy - 30);
    }
    // poussière derrière (position monde, dérive arrière)
    if (myPub.speedKmh > 5) {
      if (dustParticles.length < 36 && Math.random() < 0.6) {
        dustParticles.push({ x: me.x - Math.cos(carAngle) * 4, y: me.y - Math.sin(carAngle) * 4, vx: -Math.cos(carAngle) * 6, vy: -Math.sin(carAngle) * 6, life: 1 });
      }
    }
  }
  // rendu poussière (coordonnées monde)
  for (const p of dustParticles) {
    p.x += p.vx * _dt;
    p.y += p.vy * _dt;
    p.life -= _dt * 1.3;
    const [sx, sy] = W2S(p.x, p.y);
    ctx.fillStyle = `rgba(180,160,120,${Math.max(0, p.life) * 0.5})`;
    ctx.beginPath();
    ctx.arc(sx, sy, (1 + (1 - p.life) * 2.2) * PXM, 0, Math.PI * 2);
    ctx.fill();
  }
  dustParticles = dustParticles.filter((p) => p.life > 0);

  // ---------- NUIT: voile + cône de phares orienté ----------
  const hour = state ? hourOfDay(state.tick) : 12;
  const dark = hour >= 21 || hour < 5 ? 0.62 : hour >= 19 ? ((hour - 19) / 2) * 0.62 : hour < 7 ? ((7 - hour) / 2) * 0.62 : 0;
  if (dark > 0.03 && myPub) {
    ctx.fillStyle = `rgba(10,10,30,${dark})`;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    const [chx, chy] = W2S(me.x, me.y);
    ctx.translate(chx, chy);
    ctx.rotate(carAngle - viewAngle);
    const grad = ctx.createLinearGradient(2 * PXM, 0, 55 * PXM, 0);
    grad.addColorStop(0, `rgba(255,240,170,${0.30 + 0.2 * dark})`);
    grad.addColorStop(1, "rgba(255,240,170,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(2 * PXM, -1.8 * PXM);
    ctx.lineTo(55 * PXM, -13 * PXM);
    ctx.lineTo(55 * PXM, 13 * PXM);
    ctx.lineTo(2 * PXM, 1.8 * PXM);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------- MÉTÉO ----------
  const weather = myPub?.weather ?? "clair";
  if (weather === "pluie_diluvienne" || weather === "grele") {
    if (rainDrops.length < 110) for (let i = 0; i < 5; i++) rainDrops.push({ x: Math.random() * w, y: Math.random() * h });
    ctx.strokeStyle = weather === "grele" ? "rgba(220,230,255,0.7)" : "rgba(160,190,230,0.55)";
    ctx.lineWidth = weather === "grele" ? 2.5 : 1.2;
    for (const d of rainDrops) {
      d.y += (weather === "grele" ? 300 : 460) * _dt;
      d.x -= 60 * _dt;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 3, d.y + 10);
      ctx.stroke();
      if (d.y > h) { d.y = -10; d.x = Math.random() * (w * 1.1); }
    }
    if (weather === "grele" && Math.random() < 0.008) {
      ctx.fillStyle = "rgba(255,255,200,0.7)";
      ctx.fillRect(0, 0, w, h);
    }
  } else rainDrops = [];
  if (weather === "tempete_sable") {
    ctx.fillStyle = "rgba(190,150,90,0.3)";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 36; i++) {
      const sx = ((now / 8 + i * 97) % (w + 100)) - 50;
      const sy = (i * 53) % h;
      ctx.fillStyle = "rgba(220,190,130,0.5)";
      ctx.fillRect(sx + (now / 3) % 30, sy, 14, 2);
    }
  }
  if (weather === "brouillard") {
    ctx.fillStyle = "rgba(200,200,200,0.28)";
    ctx.fillRect(0, 0, w, h);
  }
  if (weather === "canicule") {
    const hg = ctx.createLinearGradient(0, 0, 0, h);
    hg.addColorStop(0, "rgba(255,180,80,0.12)");
    hg.addColorStop(1, "rgba(255,180,80,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
  }
  if (weather === "froid_intense") {
    ctx.fillStyle = "rgba(180,200,255,0.10)";
    ctx.fillRect(0, 0, w, h);
  }
  if (weather === "piste_endommagee") {
    ctx.fillStyle = "rgba(120,60,40,0.22)";
    ctx.fillRect(0, 0, w, h);
  }
}

// voiture 2D orientée selon le VRAI cap du tracé, ombre + roues + rebond
function drawCar2D(
  wx: number, wy: number, color: string, moving: boolean,
  W2S: (x: number, y: number) => [number, number],
  PXM: number, now: number, kmOfCar: number, viewAngle: number, label?: string
): void {
  const [sx, sy] = W2S(wx, wy);
  const L = 2.3, W = 1.05;
  const bounce = 0; // carrosserie stable: plus de va-et-vient
  // cap de la voiture = tangente du tracé à son km
  const pA = pathPoint(kmOfCar - 0.003);
  const pB = pathPoint(kmOfCar + 0.003);
  const ang = pA && pB ? Math.atan2(pB.y - pA.y, pB.x - pA.x) : 0;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ang - viewAngle);
  // ombre portée (décalée: le soleil vient du haut-gauche)
  ctx.fillStyle = "rgba(20,14,8,0.35)";
  ctx.beginPath();
  ctx.ellipse(-W * PXM * 0.25, W * PXM * 1.15, L * PXM * 1.02, W * PXM * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // roues
  ctx.fillStyle = "#1a1a1a";
  for (const [wx2, wz] of [[L - 0.7, -W - 0.12], [L - 0.7, W + 0.12], [-L + 0.7, -W - 0.12], [-L + 0.7, W + 0.12]] as [number, number][]) {
    ctx.fillRect((wx2 - 0.45) * PXM, (wz - 0.32) * PXM, 0.9 * PXM, 0.64 * PXM);
  }
  // caisse
  const b = bounce * PXM;
  ctx.fillStyle = color;
  ctx.fillRect(-L * PXM, (-W + b) * PXM, 2 * L * PXM, 2 * W * PXM);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(-L * PXM, (W * 0.35 + b) * PXM, 2 * L * PXM, W * 0.65 * PXM);
  // pare-brise + toit arrière
  ctx.fillStyle = "#9cf";
  ctx.fillRect(L * 0.1 * PXM, (-W * 0.72 + b) * PXM, L * 0.55 * PXM, W * 1.44 * PXM);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(-L * 0.72 * PXM, (-W * 0.6 + b) * PXM, L * 0.3 * PXM, W * 1.2 * PXM);
  ctx.restore();
  if (label) {
    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.fillText(label, sx - 16, sy - (W + 1.5) * PXM);
  }
}

function render(): void {
  requestAnimationFrame(render);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!state) return;
  const w = (cv.width = cv.clientWidth);
  const h = (cv.height = cv.clientHeight);
  const car = myCar();
  const myPub = state.cars.find((c) => c.playerId === myId);
  // extrapolation 60 fps: entre les states serveur (500 ms), on avance selon la vitesse
  if (lastKnownSpeed > 0) {
    const dtS = (performance.now() - lastStateTime) / 1000;
    extrapolatedKm = lastKnownKm + (lastKnownSpeed * dtS) / 3600;
  }
  const km = myPub ? (lastKnownSpeed > 0 ? extrapolatedKm : myPub.positionKm) : 0;
  const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
  const weather = myPub?.weather ?? "clair";
  const hour = hourOfDay(state.tick);
  const dark = hour >= 21 || hour < 5 ? 0.75 : hour >= 19 ? ((hour - 19) / 2) * 0.75 : hour < 7 ? ((7 - hour) / 2) * 0.75 : 0;

    drawFlatWorld(w, h, km, seg, myPub, now, dt);

  // HUD caméra : bandeau bas avec vitesse, allure, météo locale
  ctx.fillStyle = "rgba(30,26,20,0.75)";
  ctx.fillRect(0, h - 30, w, 30);
  ctx.fillStyle = "#efe8dc";
  ctx.font = "13px sans-serif";
  const spd = myPub?.speedKmh ?? 0;
  ctx.fillText(`${spd.toFixed(0)} km/h`, 12, h - 11);
  const paceTxt = PACE_FR[myCar()?.pace ?? ""] ?? "";
  if (paceTxt) {
    ctx.fillStyle = (myCar()?.pace === "attaque" || myCar()?.pace === "soutenue") ? "#7c7" : "#cc7";
    ctx.fillText(`Allure : ${paceTxt}`, 90, h - 11);
    ctx.fillStyle = "#efe8dc";
  }
  ctx.fillText(`${WEATHER_ICON[weather] ?? ""} ${WEATHER_FR[weather] ?? weather}`, 100, h - 11);
  ctx.fillText(`${(myPub?.positionKm ?? 0).toFixed(1)} km`, w - 110, h - 11);
  // Prévision ~12 h : fronts qui toucheront ma position (annonce, précis à 12 h)
  if (myPub && state?.fronts) {
    const myKm = myPub.positionKm;
    const in12h = state.fronts.filter(
      (f) => f.kind !== "piste_endommagee" && f.startTick <= state.tick + 12 * 3600 && f.endTick >= state.tick && Math.abs(f.km - myKm) < f.radiusKm + 120
    );
    if (in12h.length > 0) {
      ctx.fillText(`Prévision 12 h : ${in12h.slice(0, 2).map((f) => WEATHER_FR[f.kind] ?? f.kind).join(", ")}`, 260, h - 11);
    }
  }
  // ===== HUD CONDUITE: rapport + compte-tours + pédales =====
  {
    const car = myCar();
    if (car) {
      const bw = 220, bh = 86, bx = w - bw - 12, by = h - 30 - bh - 8;
      ctx.fillStyle = "rgba(30,26,20,0.8)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#555";
      ctx.strokeRect(bx, by, bw, bh);
      // rapport + régime
      ctx.fillStyle = "#efe8dc";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(String(car.gear), bx + 10, by + 26);
      ctx.font = "11px sans-serif";
      ctx.fillText("e", bx + 26, by + 26);
      ctx.fillStyle = car.rpm > 4800 ? "#e55" : car.rpm > 3800 ? "#cc7" : "#7c7";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(car.rpm.toFixed(0) + " tr/min", bx + 48, by + 24);
      // barre régime
      ctx.fillStyle = "#241f19";
      ctx.fillRect(bx + 10, by + 32, bw - 20, 8);
      const rpmShare = Math.min(1, (car.rpm - 900) / (5200 - 900));
      ctx.fillStyle = rpmShare > 0.85 ? "#e55" : "#d9a441";
      ctx.fillRect(bx + 10, by + 32, (bw - 20) * rpmShare, 8);
      // pédales: accélérateur (vert) / frein (rouge)
      ctx.fillStyle = "#241f19";
      ctx.fillRect(bx + 10, by + 48, (bw - 30) / 2, 12);
      ctx.fillRect(bx + bw / 2 + 5, by + 48, (bw - 30) / 2, 12);
      ctx.fillStyle = "#7c7";
      ctx.fillRect(bx + 10, by + 48, ((bw - 30) / 2) * Math.min(1, car.throttle), 12);
      ctx.fillStyle = "#c55";
      ctx.fillRect(bx + bw / 2 + 5, by + 48, ((bw - 30) / 2) * Math.min(1, car.brake), 12);
      ctx.fillStyle = "#aaa";
      ctx.font = "9px sans-serif";
      ctx.fillText("ACCÉL", bx + 10, by + 44);
      ctx.fillText("FREIN", bx + bw / 2 + 5, by + 44);
      // direction: braquage = tangente(+12m) - tangente(-12m) le long du tracé
      const pA2 = pathPoint(km - 0.012), pB2 = pathPoint(km + 0.012);
      if (pA2 && pB2) {
        const tHere = Math.atan2(pB2.y - pA2.y, pB2.x - pA2.x);
        const pA3 = pathPoint(km - 0.024), pB3 = pathPoint(km);
        const tBefore = pA3 && pB3 ? Math.atan2(pB3.y - pA3.y, pB3.x - pA3.x) : tHere;
        let dAng = tHere - tBefore;
        while (dAng > Math.PI) dAng -= 2 * Math.PI;
        while (dAng < -Math.PI) dAng += 2 * Math.PI;
        const steer = Math.max(-1, Math.min(1, -dAng * 12));
        ctx.strokeStyle = "#efe8dc";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + bw / 2, by + bh - 12);
        ctx.lineTo(bx + bw / 2 + steer * 60, by + bh - 12);
        ctx.stroke();
        ctx.fillStyle = "#aaa";
        ctx.font = "9px sans-serif";
        ctx.fillText("◀", bx + bw / 2 - 75, by + bh - 9);
        ctx.fillText("▶", bx + bw / 2 + 68, by + bh - 9);
      }
    }
  }
  // météo aussi dans le bandeau haut
  const wx = $("weather");
  if (wx) wx.textContent = `${WEATHER_ICON[weather] ?? ""} ${WEATHER_FR[weather] ?? ""}`;

  if (state.paused || !state.started) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "16px sans-serif";
    ctx.fillText(state.paused ? "⏸ Course en pause — éditez vos règles librement" : "⏳ En attente du départ…", 12, 26);
  }

  updateAudio(myPub, weather, dark);
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
  const mkConfirm = (label: string, msg: any, question: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { if (confirm(question)) send(msg); };
    bar.appendChild(b);
  };
  mkConfirm("↺ Reset course", { type: "admin_reset", newSeed: false }, "Réinitialiser toute la course ? (même graine, tout le monde repart à zéro, inscriptions rouvertes)");
  mkConfirm("🌍 Nouvelle course", { type: "admin_reset", newSeed: true }, "Générer une NOUVELLE course (nouvelle graine, nouveau monde) ? Tout l'état actuel est perdu.");
  mk("Pause", () => send({ type: "admin_pause", paused: true }));
  mk("Reprendre", () => send({ type: "admin_pause", paused: false }));
  mk("+1h", () => send({ type: "admin_advance", steps: 3600 * 30 }));
  mk("+6h", () => send({ type: "admin_advance", steps: 21600 * 30 }));
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

const QUICK_REACTIONS = ["👍", "😂", "🔥", "😮", "💪", "🫡", "🏁", "😤"];
const reactBar = document.createElement("div");
reactBar.style.cssText = "display:flex;gap:.2rem;margin:.2rem 0;flex-wrap:wrap";
for (const r of QUICK_REACTIONS) {
  const b = document.createElement("button");
  b.className = "small";
  b.textContent = r;
  b.onclick = () => send({ type: "chat", text: r });
  reactBar.appendChild(b);
}
$("chatinput").insertAdjacentElement("beforebegin", reactBar);

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
$("btn-results").onclick = openResults;
$("btn-planner").onclick = openPlanner;
$("btn-close").onclick = closeFullscreen;

// ===== Ambiance sonore (WebAudio procédural, sans fichiers) =====
let audioCtx: AudioContext | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let windGain: GainNode | null = null;
let soundOn = false;

function startAudio(): void {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  // moteur : oscillateur grave dont la fréquence suit la vitesse
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineGain.connect(audioCtx.destination);
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = "sawtooth";
  engineOsc.frequency.value = 55;
  engineOsc.connect(engineGain);
  engineOsc.start();
  // vent : bruit blanc filtré
  const bufferSize = 2 * audioCtx.sampleRate;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const windFilter = audioCtx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 400;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0;
  noise.connect(windFilter).connect(windGain).connect(audioCtx.destination);
  noise.start();
}

function updateAudio(myPub: CarPublic | undefined, weather: string, dark: number): void {
  if (!soundOn || !audioCtx || !engineOsc || !engineGain || !windGain) return;
  const speed = myPub?.speedKmh ?? 0;
  engineOsc.frequency.value = 45 + (speed / 100) * 110;
  engineGain.gain.value = speed > 1 ? 0.05 : 0.02;
  const storm = weather === "tempete_sable" || weather === "pluie_diluvienne" || weather === "grele" || weather === "vent_fort";
  windGain.gain.value = (storm ? 0.09 : 0.02) + dark * 0.02;
}

$("btn-sound").addEventListener("click", () => {
  soundOn = !soundOn;
  $("btn-sound").textContent = soundOn ? "🔇 Muet" : "🔊 Son";
  if (soundOn) {
    startAudio();
    audioCtx?.resume();
  } else if (audioCtx) {
    engineGain!.gain.value = 0;
    windGain!.gain.value = 0;
  }
});

// demande des chunks de tracé autour de la position (fenêtre glissante ±3 km)
setInterval(() => {
  if (!state || !myId || lastKnownSpeed <= 0) return;
  const center = Math.floor(lastKnownKm / 4) * 4;
  for (let c = center - 8; c <= center + 8; c += 4) {
    if (c < 0) continue;
    if (!pathChunks.has(c)) send({ type: "get_path_chunk", fromKm: c });
  }
}, 1000);

connect();
render();
