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
    if (msg.type === "path_chunk") {
      pathChunks.set(msg.fromKm, msg.points);
      // purge: garder une fenêtre glissante (max 40 chunks = 80 km)
      if (pathChunks.size > 40) {
        const keys = [...pathChunks.keys()].sort((a, b) => Math.abs(a - lastKnownKm) - Math.abs(b - lastKnownKm));
        while (pathChunks.size > 40) pathChunks.delete(keys.pop()!);
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
  wrap.style.cssText = "max-height:100%;overflow-y:auto";

  const rules = JSON.parse(JSON.stringify(car.rules));
  let dirty = false;

  const render = () => {
    wrap.innerHTML = "<h2>Planificateur — 50 canaux, le n° le plus bas gagne</h2>";
    const sorted = [...rules].sort((a: any, b: any) => a.channel - b.channel);
    for (const r of sorted) {
      const card = document.createElement("div");
      card.className = "rule";
      card.style.marginBottom = ".5rem";
      const head = document.createElement("div");
      head.className = "head";
      const title = document.createElement("span");
      title.innerHTML = `N°${r.channel} <span class="${r.enabled ? "on" : "off"}">${r.enabled ? "ON" : "OFF"}</span> — ${r.mode === "one_shot" ? "one-shot" : "persistante"}`;
      head.appendChild(title);

      const chanSel = document.createElement("select");
      for (let ch = 1; ch <= 50; ch++) {
        const opt = document.createElement("option");
        opt.value = String(ch);
        opt.textContent = `N°${ch}`;
        chanSel.appendChild(opt);
      }
      chanSel.value = String(r.channel);
      chanSel.onchange = () => {
        const newCh = parseInt(chanSel.value);
        if (rules.some((x: any) => x.channel === newCh)) return;
        r.channel = newCh;
        dirty = true;
        render();
      };
      const toggle = document.createElement("button");
      toggle.textContent = r.enabled ? "⏸ Désactiver" : "▶ Activer";
      toggle.onclick = () => { r.enabled = !r.enabled; dirty = true; render(); };
      const del = document.createElement("button");
      del.textContent = "🗑";
      del.onclick = () => { rules.splice(rules.indexOf(r), 1); dirty = true; render(); };
      const controls = document.createElement("span");
      controls.append(chanSel, toggle, del);
      head.appendChild(controls);
      card.appendChild(head);

      const condHeader = document.createElement("div");
      condHeader.innerHTML = "<b>Conditions (ET, max 3)</b>";
      card.appendChild(condHeader);
      for (const cond of r.conditions) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:.3rem";
        row.appendChild(renderConditionEditor(cond, () => { dirty = true; renderSummary(); }));
        const rm = document.createElement("button");
        rm.textContent = "✕";
        rm.className = "small";
        rm.onclick = () => { r.conditions.splice(r.conditions.indexOf(cond), 1); dirty = true; render(); };
        row.appendChild(rm);
        card.appendChild(row);
      }
      if (r.conditions.length < 3) {
        const addCond = document.createElement("button");
        addCond.textContent = "+ condition";
        addCond.className = "small";
        addCond.onclick = () => {
          r.conditions.push({ kind: "bool", variable: "nuit", value: true });
          dirty = true;
          render();
        };
        card.appendChild(addCond);
      }

      const actHeader = document.createElement("div");
      actHeader.innerHTML = "<b>Action</b>";
      card.append(actHeader);
      card.appendChild(renderActionEditor(r, () => { dirty = true; render(); }));

      const effHeader = document.createElement("div");
      effHeader.innerHTML = "<b>Durée d'effet</b>";
      card.appendChild(effHeader);
      const effRow = document.createElement("div");
      effRow.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
      const effSel = select(
        [
          { value: "default", label: "jusqu'à consigne contraire" },
          { value: "duration", label: "pendant (heures)" },
          { value: "distance", label: "pendant (km)" },
        ],
        r.effect.kind,
        (v) => {
          r.effect = v === "default" ? { kind: "default" } : v === "duration" ? { kind: "duration", hours: 2 } : { kind: "distance", km: 200 };
          dirty = true;
          render();
        }
      );
      effRow.appendChild(effSel);
      if (r.effect.kind === "duration") effRow.appendChild(numberInput(r.effect.hours, (v) => { r.effect.hours = v; dirty = true; renderSummary(); }));
      if (r.effect.kind === "distance") effRow.appendChild(numberInput(r.effect.km, (v) => { r.effect.km = v; dirty = true; renderSummary(); }));
      card.appendChild(effRow);

      const modeRow = document.createElement("div");
      modeRow.style.marginTop = ".3rem";
      modeRow.appendChild(select(
        [{ value: "persistante", label: "Persistante (gardien)" }, { value: "one_shot", label: "One-shot (à réarmer)" }],
        r.mode,
        (v) => { r.mode = v; dirty = true; render(); }
      ));
      card.appendChild(modeRow);
      wrap.appendChild(card);
    }

    const bottom = document.createElement("div");
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
      dirty = true;
      render();
    };
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Enregistrer";
    saveBtn.style.background = "#7c7";
    saveBtn.onclick = () => {
      send({ type: "rules", rules });
      closeFullscreen();
    };
    bottom.append(addBtn, saveBtn);
    wrap.appendChild(bottom);
    renderSummary();
  };

  const renderSummary = () => {};
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

  // VRAI tracé (vue du dessus) — le tracé 2D réel du monde, échantillonné au km
  const pts = state.pathSummary ?? [];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) * 1.1;
  const cx0 = (minX + maxX) / 2, cy0 = (minY + maxY) / 2;
  const mapX = (x: number) => w / 2 + ((x - cx0) / span) * Math.min(w - 60, h * 1.6);
  const mapY = (y: number) => h * 0.52 + ((y - cy0) / span) * Math.min(w - 60, h * 1.6);
  if (pts.length > 1) {
    m.strokeStyle = "#d9a441";
    m.lineWidth = 3;
    m.beginPath();
    pts.forEach((p, i) => {
      const x = mapX(p.x), y = mapY(p.y);
      if (i === 0) m.moveTo(x, y);
      else m.lineTo(x, y);
    });
    m.stroke();
    // position des voitures sur le VRAI tracé
    state.cars.forEach((c) => {
      const nearest = pts.reduce((best: any, p: any) =>
        Math.abs(p.km - c.positionKm) < Math.abs(best.km - c.positionKm) ? p : best, pts[0]);
      const x = mapX(nearest.x), y = mapY(nearest.y);
      m.fillStyle = c.color;
      m.beginPath();
      m.arc(x, y, 6, 0, Math.PI * 2);
      m.fill();
      const pp = state!.players.find((pp2) => pp2.id === c.playerId);
      m.fillStyle = "#fff";
      m.fillText(pp?.pseudo ?? "", x + 8, y + 3);
    });
    // départ / arrivée
    m.fillStyle = "#fff";
    m.font = "bold 12px sans-serif";
    m.fillText("A", mapX(pts[0].x) - 4, mapY(pts[0].y) - 10);
    m.fillText("B", mapX(pts[pts.length - 1].x) - 4, mapY(pts[pts.length - 1].y) - 10);
  }
  // profil d'altitude (bande basse)
  m.strokeStyle = "rgba(217,164,65,0.7)";
  m.lineWidth = 2;
  m.beginPath();
  state.world.segments.forEach((seg: any, i: number) => {
    const x = (seg.km / total) * w;
    const y = h - 26 - (seg.altitude / 4000) * 20;
    if (i === 0) m.moveTo(x, y);
    else m.lineTo(x, y);
  });
  m.stroke();

  // stations, villages, ponts: positionnés sur le VRAI tracé (position 2D la plus proche)
  m.font = "11px sans-serif";
  const onPath = (km: number) => {
    let best = pts[0], bd = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.km - km);
      if (d < bd) { bd = d; best = p; }
    }
    return { x: mapX(best.x), y: mapY(best.y) };
  };
  state.world.stations.forEach((s: any) => {
    const pos = onPath(s.km);
    m.fillText("⛽", pos.x - 5, pos.y - 10);
    if (s.hasHotel) m.fillText("🏨", pos.x + 8, pos.y - 10);
    m.fillStyle = "#fff";
    m.fillText(s.name, pos.x - 20, pos.y - 22);
    m.fillStyle = "#000";
  });
  state.world.villages.forEach((v: any) => {
    const pos = onPath(v.km);
    m.fillStyle = "#ddd";
    m.fillText("🏠", pos.x - 5, pos.y + 16);
  });
  (state.world.bridges ?? []).forEach((b: any) => {
    const pos = onPath(b.km);
    m.fillStyle = "#a86";
    m.fillText("＝", pos.x - 5, pos.y + 6);
  });
  // Fronts météo mobiles visibles sur la carte (on voit la tempête arriver)
  const FRONT_COLORS: Record<string, string> = {
    pluie_diluvienne: "rgba(80,120,220,0.35)", tempete_sable: "rgba(210,160,80,0.4)",
    canicule: "rgba(230,120,40,0.25)", froid_intense: "rgba(160,200,255,0.3)",
    brouillard: "rgba(200,200,200,0.3)", vent_fort: "rgba(150,180,160,0.25)",
    grele: "rgba(190,210,255,0.4)", piste_endommagee: "rgba(120,60,40,0.5)",
  };
  for (const f of state.fronts ?? []) {
    if (state.tick < f.startTick || state.tick > f.endTick) continue;
    const color = FRONT_COLORS[f.kind] ?? "rgba(150,150,150,0.3)";
    m.fillStyle = color;
    const fx = (f.km / total) * w;
    const fr = Math.max(4, (f.radiusKm / total) * w);
    m.beginPath();
    m.arc(fx, h / 2, fr, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "#fff";
    m.font = "10px sans-serif";
    m.fillText(WEATHER_ICON[f.kind] ?? "?", fx - 6, h / 2 - 6);
  }

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
let camZoom = 1;
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
  camZoom = Math.max(0.6, Math.min(1.6, camZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
});


// ===== Vue 2D de haut — route ancrée au monde, caméra suit la voiture =====
// Tracé réel: les chunks de polyligne 2D du monde, demandés au serveur.
// pathPoint(k) interpole dans les chunks — la vue dessine le VRAI monde.
function pathPoint(k: number): { x: number; y: number } | null {
  const base = Math.floor(k / 2) * 2;
  const chunk = pathChunks.get(base);
  if (!chunk || chunk.length === 0) return null;
  // chunk: points tous les 25 m sur [base, base+2[
  const fi = ((k - base) * 1000) / 20; // pas du tracé: 20 m
  const i0 = Math.max(0, Math.min(chunk.length - 1, Math.floor(fi)));
  const i1 = Math.min(chunk.length - 1, i0 + 1);
  const f = fi - i0;
  return {
    x: chunk[i0].x + (chunk[i1].x - chunk[i0].x) * f,
    y: chunk[i0].y + (chunk[i1].y - chunk[i0].y) * f,
  };
}

// ===== Caméra poursuite douce: nord fixe du MONDE, voiture en mouvement =====
// La voiture BOUGE à l'écran: la caméra la suit avec retard (lissage), la
// voiture glisse dans le cadre selon sa trajectoire réelle. En virage, la
// caméra pivote doucement vers le cap de la route (optionnel: léger).
let camX = 0, camY = 0, camAngle = 0;
let camInit = false;

function drawFlatWorld(w: number, h: number, km: number, seg: any, myPub: CarPublic | undefined, now: number, _dt: number): void {
  const PXM = (w / 160) * camZoom; // pixels par mètre (~160 m de large visible)

  // ma position réelle sur le tracé
  const me = pathPoint(km);
  const meAhead = pathPoint(km + 0.006);
  if (!me || !meAhead) {
    ctx.fillStyle = "#2b2620";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#efe8dc";
    ctx.font = "14px sans-serif";
    ctx.fillText("Chargement du tracé…", w / 2 - 70, h / 2);
    return;
  }
  const carAngle = Math.atan2(meAhead.y - me.y, meAhead.x - me.x);

  // caméra retardataire: vise un point devant la voiture, rattrape en douceur
  const targetX = me.x + Math.cos(carAngle) * 30;
  const targetY = me.y + Math.sin(carAngle) * 30;
  if (!camInit) { camX = targetX; camY = targetY; camAngle = carAngle; camInit = true; }
  const follow = 0.08;
  camX += (targetX - camX) * follow;
  camY += (targetY - camY) * follow;
  // rotation douce de la caméra vers le cap (amortie)
  let dAng = carAngle - camAngle;
  while (dAng > Math.PI) dAng -= 2 * Math.PI;
  while (dAng < -Math.PI) dAng += 2 * Math.PI;
  camAngle += dAng * 0.05;

  // transformation monde -> écran
  const W2S = (x: number, y: number): [number, number] => {
    const dx = x - camX, dy = y - camY;
    const rx = dx * Math.cos(-camAngle) - dy * Math.sin(-camAngle);
    const ry = dx * Math.sin(-camAngle) + dy * Math.cos(-camAngle);
    return [w / 2 + rx * PXM, h * 0.62 + ry * PXM];
  };

  // sol
  ctx.fillStyle = BIOME_COLORS[seg?.biome ?? "steppe"];
  ctx.fillRect(0, 0, w, h);

  // ---------- ROUTE: le vrai tracé, large bande, tous les points visibles ----------
  const half = 0.09; // ±90 m autour de nous
  const roadWm = seg?.width === "etroite" ? 3.5 : seg?.width === "moyenne" ? 5 : 6.5;
  // collecter les points du tracé dans la fenêtre
  const path: { x: number; y: number }[] = [];
  for (let k = km - half; k <= km + half; k += 0.001) {
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
    // ligne centrale
    ctx.strokeStyle = "rgba(230,220,190,0.45)";
    ctx.lineWidth = 0.3 * PXM;
    ctx.setLineDash([3 * PXM, 4 * PXM]);
    ctx.beginPath();
    path.forEach((p, i) => {
      const [sx, sy] = W2S(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------- DÉCORS ancrés au monde (hash de position absolue) ----------
  const hash = (n: number) => {
    const v = Math.sin(n * 127.1) * 43758.5453;
    return v - Math.floor(v);
  };
  const decorStep = 12; // tous les 12 m
  const dStart = Math.floor((km - half) * 1000 / decorStep) * decorStep;
  for (let dm = dStart; dm <= (km + half) * 1000; dm += decorStep) {
    const k = dm / 1000;
    const p = pathPoint(k);
    if (!p) continue;
    const idx = Math.round(dm / decorStep);
    const r1 = hash(idx * 3 + 1), r2 = hash(idx * 7 + 2), r3 = hash(idx * 11 + 3);
    if (r3 < 0.45) continue;
    const side = r2 < 0.5 ? -1 : 1;
    const dist = roadWm + 5 + r1 * 26;
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
      ctx.fillStyle = "rgba(95,85,68,0.9)";
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
      ctx.fillStyle = seg?.biome === "humide" ? "rgba(45,100,55,0.85)" : "rgba(75,115,55,0.8)";
      ctx.beginPath();
      ctx.ellipse(sx, sy, sz * 1.25, sz, 0, 0, Math.PI * 2);
      ctx.fill();
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
      drawCar2D(p.x, p.y, c.color, c.speedKmh > 2, W2S, PXM, now, c.positionKm, state!.players.find((pl) => pl.id === c.playerId)?.pseudo);
    }
  }

  // ---------- MA VOITURE: position réelle, cap réel, bouge à l'écran ----------
  if (myPub) {
    drawCar2D(me.x, me.y, myPub.color, myPub.speedKmh > 2, W2S, PXM, now, km);
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
    ctx.rotate(carAngle - camAngle);
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
  PXM: number, now: number, kmOfCar: number, label?: string
): void {
  const [sx, sy] = W2S(wx, wy);
  const L = 2.3, W = 1.05;
  const bounce = moving ? Math.sin(now / 85 + wx * 0.1) * 0.05 : 0;
  // cap de la voiture = tangente du tracé à son km
  const pA = pathPoint(kmOfCar - 0.003);
  const pB = pathPoint(kmOfCar + 0.003);
  const ang = pA && pB ? Math.atan2(pB.y - pA.y, pB.x - pA.x) : 0;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ang - camAngle);
  // ombre
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, W * PXM * 0.8, L * PXM * 1.05, W * PXM * 0.6, 0, 0, Math.PI * 2);
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
  const center = Math.floor(lastKnownKm / 2) * 2;
  for (let c = center - 4; c <= center + 4; c += 2) {
    if (c < 0) continue;
    if (!pathChunks.has(c)) send({ type: "get_path_chunk", fromKm: c });
  }
}, 1000);

connect();
render();
