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
let camZoom = 1;
let viewMode: "flat" | "iso" = "flat";
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


// ===== Vue 2D plate =====
function drawFlatWorld(w: number, h: number, km: number, seg: any, myPub: CarPublic | undefined, now: number, _dt: number): void {
  ctx.save();
  ctx.translate(w / 2, h * 0.55);
  ctx.scale(camZoom, camZoom);
  ctx.translate(-w / 2, -h * 0.55);

  ctx.fillStyle = BIOME_COLORS[seg?.biome ?? "steppe"];
  ctx.fillRect(-w, -h, w * 3, h * 3);

  const seedR = (n: number) => {
    const x = Math.sin(n * 127.1 + km * 0.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 7; i++) {
    const bx = (i * w) / 6 - w * 0.08;
    const bh = h * (0.12 + seedR(i + 1) * 0.22);
    ctx.fillStyle = "rgba(0,0,0,0.09)";
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.1, h * 0.42);
    ctx.quadraticCurveTo(bx + w * 0.09, h * 0.42 - bh, bx + w * 0.28, h * 0.42);
    ctx.fill();
  }
  for (let i = 0; i < 14; i++) {
    const ox = seedR(i + 40) * w;
    const oy = h * 0.45 + seedR(i + 60) * h * 0.5;
    if (seedR(i + 100) < 0.45) {
      ctx.fillStyle = "rgba(90,80,65,0.8)";
      ctx.beginPath();
      ctx.ellipse(ox, oy, 5 + seedR(i) * 9, 4 + seedR(i + 7) * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (seg?.biome === "steppe" || seg?.biome === "humide") {
      ctx.fillStyle = seg.biome === "humide" ? "rgba(40,90,50,0.7)" : "rgba(70,110,50,0.6)";
      ctx.beginPath();
      ctx.ellipse(ox, oy, 6 + seedR(i) * 6, 5 + seedR(i + 3) * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (seedR(Math.floor(now / 8000)) < 0.25) {
    const ax = w * 0.15 + seedR(Math.floor(now / 8000) + 1) * w * 0.7;
    ctx.fillStyle = "rgba(120,90,60,0.85)";
    ctx.beginPath();
    ctx.ellipse(ax, h * 0.78, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ax + 11, h * 0.78 - 3, 4, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const roadW = seg?.width === "etroite" ? 26 : seg?.width === "moyenne" ? 36 : 48;
  ctx.strokeStyle = "rgba(107,91,67,0.95)";
  ctx.lineWidth = roadW;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.bezierCurveTo(w * 0.3, h * 0.58, w * 0.6, h * 0.78, w, h * 0.62);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = roadW * 0.18;
  ctx.setLineDash([12, 16]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "10px sans-serif";
  const nextBorne = Math.ceil(km / 10) * 10;
  for (let b = -2; b <= 2; b++) {
    const bkm = nextBorne + b * 10;
    if (bkm < 0) continue;
    const rel = bkm - km;
    if (Math.abs(rel) > 0.35) continue;
    const bx = w / 2 + (rel / 0.35) * w * 0.42;
    ctx.fillStyle = "#efe8dc";
    ctx.fillRect(bx - 1, h * 0.7 - 14, 2, 14);
    ctx.fillStyle = "#3a332a";
    ctx.fillText(`${bkm}`, bx - 10, h * 0.7 - 17);
  }
  for (const st of state?.world.stations ?? []) {
    const rel = st.km - km;
    if (rel > -0.05 && rel < 0.35) {
      const sx = w / 2 + (rel / 0.35) * w * 0.42;
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText("⛽", sx, h * 0.7 - 26);
      if (st.hasHotel) ctx.fillText("🏨", sx + 16, h * 0.7 - 26);
      ctx.font = "10px sans-serif";
    }
  }

  const cx = w / 2, cy = h * 0.7;
  const drawCar = (x: number, y: number, color: string, label: string | undefined, moving: boolean) => {
    const bounce = moving ? Math.sin(now / 90 + x) * 1.5 : 0;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 27, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    for (const wx of [x - 27, x - 19, x + 19, x + 27]) {
      ctx.fillRect(wx, y - 9 + bounce, 8, 18);
      if (moving) {
        ctx.fillStyle = "#555";
        const spin = Math.sin(now / 60 + wx) * 6;
        ctx.fillRect(wx, y - 4 + bounce + spin * 0.4, 8, 3);
        ctx.fillStyle = "#1a1a1a";
      }
    }
    ctx.fillStyle = color;
    ctx.fillRect(x - 24, y - 14 + bounce, 48, 24);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(x - 24, y + 4 + bounce, 48, 6);
    ctx.fillStyle = "#9cf";
    ctx.fillRect(x - 14, y - 9 + bounce, 20, 9);
    if (label) {
      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.fillText(label, x - 18, y - 22 + bounce);
    }
  };

  if (myPub) {
    for (const c of state!.cars) {
      if (c.playerId === myId) continue;
      const gap = c.positionKm - myPub.positionKm;
      if (Math.abs(gap) < 0.35) {
        const rel = gap / 0.35;
        drawCar(cx + rel * w * 0.35, cy - 14, c.color, state!.players.find((p) => p.id === c.playerId)?.pseudo, c.speedKmh > 2);
      }
    }
    drawCar(cx, cy, myPub.color, undefined, myPub.speedKmh > 2);
    if (myPub.immobilized) {
      ctx.fillStyle = "#e66";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("⚠ " + (myPub.immobilizedReason ?? ""), cx - 60, cy - 32);
    } else if (myPub.sleeping) {
      ctx.fillStyle = "#ccc";
      ctx.font = "13px sans-serif";
      ctx.fillText("💤 bivouac / repos en cours", cx - 70, cy - 32);
    }
    if (myPub.speedKmh > 5) {
      if (dustParticles.length < 40 && Math.random() < 0.5) {
        dustParticles.push({ x: cx - 30, y: cy + 6, vx: -30 - Math.random() * 40, vy: -10 + Math.random() * 20, life: 1 });
      }
      for (const p of dustParticles) {
        p.x += p.vx * _dt;
        p.y += p.vy * _dt;
        p.life -= _dt * 1.4;
        ctx.fillStyle = `rgba(180,160,120,${Math.max(0, p.life) * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + (1 - p.life) * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      dustParticles = dustParticles.filter((p) => p.life > 0);
    }
  }

  const hour = state ? hourOfDay(state.tick) : 12;
  const dark = hour >= 21 || hour < 5 ? 0.75 : hour >= 19 ? ((hour - 19) / 2) * 0.75 : hour < 7 ? ((7 - hour) / 2) * 0.75 : 0;
  if (dark > 0.05) {
    ctx.fillStyle = `rgba(10,10,30,${dark})`;
    ctx.fillRect(-w, -h, w * 3, h * 3);
    const grad = ctx.createRadialGradient(cx + 55, cy, 8, cx + 55, cy, 130 * camZoom);
    grad.addColorStop(0, "rgba(255,240,170,0.4)");
    grad.addColorStop(1, "rgba(255,240,170,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx + 18, cy - 6);
    ctx.lineTo(cx + 250 * camZoom, cy - 75 * camZoom);
    ctx.lineTo(cx + 250 * camZoom, cy + 65 * camZoom);
    ctx.closePath();
    ctx.fill();
  }

  const weather = myPub?.weather ?? "clair";
  if (weather === "pluie_diluvienne" || weather === "grele") {
    if (rainDrops.length < 120) for (let i = 0; i < 6; i++) rainDrops.push({ x: Math.random() * w, y: Math.random() * h });
    ctx.strokeStyle = weather === "grele" ? "rgba(220,230,255,0.7)" : "rgba(160,190,230,0.6)";
    ctx.lineWidth = weather === "grele" ? 2.5 : 1.2;
    for (const d of rainDrops) {
      d.y += (weather === "grele" ? 300 : 480) * _dt;
      d.x -= 60 * _dt;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 3, d.y + 10);
      ctx.stroke();
      if (d.y > h) { d.y = -10; d.x = Math.random() * (w * 1.1); }
    }
    if (weather === "grele" && Math.random() < 0.008) {
      ctx.fillStyle = "rgba(255,255,200,0.9)";
      ctx.fillRect(0, 0, w, h);
    }
  } else rainDrops = [];
  if (weather === "tempete_sable") {
    ctx.fillStyle = "rgba(190,150,90,0.35)";
    ctx.fillRect(-w, -h, w * 3, h * 3);
    for (let i = 0; i < 40; i++) {
      const sx = ((now / 8 + i * 97) % (w + 100)) - 50;
      const sy = (i * 53) % h;
      ctx.fillStyle = "rgba(220,190,130,0.5)";
      ctx.fillRect(sx + (now / 3) % 30, sy, 14, 2);
    }
  }
  if (weather === "brouillard") {
    ctx.fillStyle = "rgba(200,200,200,0.35)";
    ctx.fillRect(-w, -h, w * 3, h * 3);
  }
  if (weather === "canicule") {
    const hg = ctx.createLinearGradient(0, 0, 0, h);
    hg.addColorStop(0, "rgba(255,180,80,0.15)");
    hg.addColorStop(1, "rgba(255,180,80,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(-w, -h, w * 3, h * 3);
  }
  if (weather === "froid_intense") {
    ctx.fillStyle = "rgba(180,200,255,0.12)";
    ctx.fillRect(-w, -h, w * 3, h * 3);
  }

  ctx.restore();
}

// ===== Vue 3/4 isométrique (aperçu) =====
function drawIsoWorld(w: number, h: number, km: number, seg: any, myPub: CarPublic | undefined, now: number, dt: number, cx: number, cy: number): void {
  const S = 5 * camZoom;               // pixels par mètre
  const ISOX = 0.866, ISOY = 0.5;
  const proj = (x: number, z: number): [number, number] => [
    w / 2 + (x - z) * ISOX * S,
    h * 0.52 + (x + z) * ISOY * S,
  ];
  const poly = (pts: [number, number][], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // --- sol : losanges de 16 m, damier subtil ---
  const TILE = 16;
  const baseTx = Math.floor((km * 1000) / TILE);
  const biomeBase = BIOME_COLORS[seg?.biome ?? "steppe"];
  for (let tx = -10; tx <= 14; tx++) {
    for (let tz = -6; tz <= 6; tz++) {
      const X = (baseTx + tx) * TILE - km * 1000;
      const Z = tz * TILE;
      const c1 = proj(X, Z), c2 = proj(X + TILE, Z), c3 = proj(X + TILE, Z + TILE), c4 = proj(X, Z + TILE);
      const alt = ((baseTx + tx + tz) % 2 + 2) % 2;
      poly([c1, c2, c3, c4], alt ? biomeBase : shade(biomeBase, 1.06));
    }
  }

  // --- route : ruban latitudinal le long de x ---
  const hw = seg?.width === "etroite" ? 4 : seg?.width === "moyenne" ? 5.5 : 7;
  const roadBase = "#6b5b43";
  for (let x = -90; x < 190; x += 8) {
    poly([proj(x, -hw), proj(x + 8, -hw), proj(x + 8, hw), proj(x, hw)], ((x / 8) % 2 === 0) ? roadBase : shade(roadBase, 1.08));
  }
  // ligne centrale pointillée
  for (let x = -90; x < 190; x += 12) {
    poly([proj(x, -0.3), proj(x + 4, -0.3), proj(x + 4, 0.3), proj(x, 0.3)], "rgba(230,220,190,0.5)");
  }
  // bas-côté : bandes claires
  poly([proj(-90, -hw - 1.2), proj(190, -hw - 1.2), proj(190, -hw), proj(-90, -hw)], "rgba(200,180,140,0.5)");
  poly([proj(-90, hw), proj(190, hw), proj(190, hw + 1.2), proj(-90, hw + 1.2)], "rgba(200,180,140,0.5)");

  // --- décors : rochers / végétation à positions monde fixes ---
  type Ent = { depth: number; draw: () => void };
  const ents: Ent[] = [];
  const hash = (n: number) => {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let t = -6; t <= 12; t++) {
    const txm = (baseTx + t) * TILE;
    for (let j = 0; j < 3; j++) {
      const r1 = hash(txm * 3 + j), r2 = hash(txm * 7 + j * 13), r3 = hash(txm * 11 + j * 29);
      if (r3 < 0.35) continue;
      const X = txm - km * 1000 + r1 * TILE;
      const side = r2 < 0.5 ? -1 : 1;
      const Z = side * (hw + 3 + r2 * 22);
      const depth = X + Z;
      const px = proj(X, Z);
      if (r3 < 0.65) {
        // rocher : petit volume
        const rr = 1.2 + r1 * 1.6;
        const topY = px[1] - rr * 2 * S * 0.5;
        ents.push({
          depth,
          draw: () => {
            poly([proj(X - rr, Z), proj(X + rr * 0.4, Z + rr * 0.8), proj(X + rr, Z), proj(X, Z - rr * 0.8)], "rgba(105,95,80,0.9)");
            poly([[px[0] - rr * ISOX * S, topY], [px[0], topY - rr * ISOY * S * 0.6], [px[0] + rr * ISOX * S, topY], [px[0], topY + rr * ISOY * S * 0.6]], "rgba(140,128,108,0.95)");
          },
        });
      } else if (seg?.biome === "steppe" || seg?.biome === "humide") {
        // végétation : touffe avec hauteur
        ents.push({
          depth,
          draw: () => {
            ctx.strokeStyle = "rgba(90,70,45,0.8)";
            ctx.beginPath();
            ctx.moveTo(px[0], px[1]);
            ctx.lineTo(px[0], px[1] - 6 * S * 0.4);
            ctx.stroke();
            poly([[px[0] - 3 * S * 0.5, px[1] - 4 * S * 0.4], [px[0], px[1] - 8 * S * 0.5], [px[0] + 3 * S * 0.5, px[1] - 4 * S * 0.4], [px[0], px[1] - 1 * S * 0.4]], seg?.biome === "humide" ? "rgba(50,105,60,0.9)" : "rgba(80,125,55,0.85)");
          },
        });
      }
    }
  }

  // --- voitures : volumes 3 faces ---
  const drawIsoCar = (xOff: number, color: string, moving: boolean, label?: string) => {
    const L = 2.3, W = 1.05, H = 1.5;
    const bounce = moving ? Math.sin(now / 90 + xOff) * 0.06 : 0;
    const x0 = xOff;
    const up = (p: [number, number], hh: number): [number, number] => [p[0], p[1] - hh * S];
    const cFL = proj(x0 + L, -W), cFR = proj(x0 + L, W), cBL = proj(x0 - L, -W), cBR = proj(x0 - L, W);
    const b = bounce * 2;
    // roues (sous la caisse)
    ctx.fillStyle = "#1a1a1a";
    for (const [wx, wz] of [[L - 0.7, -W - 0.15], [L - 0.7, W + 0.15], [-L + 0.7, -W - 0.15], [-L + 0.7, W + 0.15]] as [number, number][]) {
      const p = proj(x0 + wx, wz);
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], 0.5 * S, 0.35 * S, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // faces avant (x=+L) et côté (z=+W)
    poly([cFL, cFR, up(cFR, H), up(cFL, H)], shade(color, 0.72));
    poly([cFR, cBR, up(cBR, H), up(cFR, H)], shade(color, 0.55));
    // toit
    poly([up(cFL, H + b), up(cFR, H + b), up(cBR, H + b), up(cBL, H + b)], color);
    // pare-brise sur le toit
    const wFL = up(proj(x0 + L * 0.55, -W * 0.8), H + b), wFR = up(proj(x0 + L * 0.55, W * 0.8), H + b);
    const wBL = up(proj(x0 - L * 0.1, -W * 0.8), H + b), wBR = up(proj(x0 - L * 0.1, W * 0.8), H + b);
    poly([wFL, wFR, wBR, wBL], "rgba(150,200,235,0.9)");
    if (label) {
      const lp = up(cBL, H + 0.8);
      ctx.fillStyle = "#fff";
      ctx.font = "11px sans-serif";
      ctx.fillText(label, lp[0] - 18, lp[1]);
    }
    // phares la nuit
    return { cFL, cFR };
  };

  if (myPub) {
    // concurrents proches en volume, triés par profondeur avec les décors
    for (const c of state!.cars) {
      if (c.playerId === myId) continue;
      const gapM = (c.positionKm - myPub.positionKm) * 1000;
      if (Math.abs(gapM) < 220) {
        ents.push({ depth: gapM + 0, draw: () => drawIsoCar(gapM, c.color, c.speedKmh > 2, state!.players.find((p) => p.id === c.playerId)?.pseudo) });
      }
    }
    ents.push({ depth: 0, draw: () => {
      drawIsoCar(0, myPub.color, myPub.speedKmh > 2);
      if (myPub.immobilized) {
        const p = proj(0, -3);
        ctx.fillStyle = "#e66";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("⚠ " + (myPub.immobilizedReason ?? ""), p[0] - 60, p[1] - 30);
      }
      // poussière iso derrière
      if (myPub.speedKmh > 5) {
        if (dustParticles.length < 40 && Math.random() < 0.5) {
          dustParticles.push({ x: -3, y: 0.8, vx: -6, vy: 0, life: 1 });
        }
      }
    }});
  }
  ents.sort((a, b) => a.depth - b.depth);
  for (const e of ents) e.draw();

  // particules de poussière en coordonnées iso
  for (const p of dustParticles) {
    p.x += p.vx * dt;
    p.y += (0.4 + p.y * 0.2) * dt * 2;
    p.life -= dt * 1.4;
    const pp = proj(p.x, p.y);
    ctx.fillStyle = `rgba(180,160,120,${Math.max(0, p.life) * 0.5})`;
    ctx.beginPath();
    ctx.arc(pp[0], pp[1] - (1 - p.life) * 4, (3 + (1 - p.life) * 5) * camZoom, 0, Math.PI * 2);
    ctx.fill();
  }
  dustParticles = dustParticles.filter((p) => p.life > 0);

  // cône de phares iso (la nuit, géré par le voile partagé)
  const hour = state ? hourOfDay(state.tick) : 12;
  const dark = hour >= 21 || hour < 5 ? 0.75 : hour >= 19 ? ((hour - 19) / 2) * 0.75 : hour < 7 ? ((7 - hour) / 2) * 0.75 : 0;
  if (dark > 0.05 && myPub) {
    const f1 = proj(2.6, -0.9), f2 = proj(2.6, 0.9);
    const e1 = proj(45, -7), e2 = proj(45, 7);
    poly([f1, e1, e2, f2], `rgba(255,240,170,${0.18 + 0.15 * dark})`);
  }
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
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
  const km = myPub?.positionKm ?? 0;
  const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
  const weather = myPub?.weather ?? "clair";
  const hour = hourOfDay(state.tick);
  const dark = hour >= 21 || hour < 5 ? 0.75 : hour >= 19 ? ((hour - 19) / 2) * 0.75 : hour < 7 ? ((7 - hour) / 2) * 0.75 : 0;

  const cx = w / 2, cy = h * 0.7;
  if (viewMode === "iso") {
    drawIsoWorld(w, h, km, seg, myPub, now, dt, cx, cy);
  } else {
    drawFlatWorld(w, h, km, seg, myPub, now, dt);
  }

  // HUD caméra : bandeau bas avec vitesse, allure, météo locale
  ctx.fillStyle = "rgba(30,26,20,0.75)";
  ctx.fillRect(0, h - 30, w, 30);
  ctx.fillStyle = "#efe8dc";
  ctx.font = "13px sans-serif";
  const spd = myPub?.speedKmh ?? 0;
  ctx.fillText(`${spd.toFixed(0)} km/h`, 12, h - 11);
  ctx.fillText(`${WEATHER_ICON[weather] ?? ""} ${WEATHER_FR[weather] ?? weather}`, 100, h - 11);
  ctx.fillText(`${(myPub?.positionKm ?? 0).toFixed(1)} km`, w - 110, h - 11);
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

$("btn-view").addEventListener("click", () => {
  viewMode = viewMode === "iso" ? "flat" : "iso";
  $("btn-view").textContent = viewMode === "iso" ? "🟦 Vue 2D" : "💎 Vue 3/4 iso";
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

connect();
render();
