(() => {
  // packages/client/src/main.ts
  var BIOME_COLORS = {
    desert: "#c9a96a",
    montagne: "#7d8a96",
    steppe: "#8fae6d",
    humide: "#5f8a7a"
  };
  var ORGANS_FR = {
    moteur: "Moteur",
    transmission: "Transmission",
    pneus_av: "Pneus av.",
    pneus_ar: "Pneus ar.",
    suspensions: "Suspensions",
    chassis: "Ch\xE2ssis",
    freins: "Freins",
    refroidissement: "Refroidissement"
  };
  var PACE_FR = {
    lift_and_coast: "Lift and coast",
    prudente: "Prudente",
    normale: "Normale",
    soutenue: "Soutenue",
    attaque: "Attaque"
  };
  var ws;
  var myId = null;
  var isAdmin = false;
  var state = null;
  var $ = (id) => document.getElementById(id);
  var cv = $("cv");
  var ctx = cv.getContext("2d");
  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  function connect() {
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
        setTimeout(() => $("errline").textContent = "", 5e3);
      }
    };
    ws.onclose = () => setTimeout(connect, 2e3);
  }
  function myCar() {
    return state?.mine ?? null;
  }
  function hourOfDay(tick) {
    return (8 + tick / 3600) % 24;
  }
  function fmtHour(tick) {
    const h = hourOfDay(tick);
    return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(h % 1 * 60)).padStart(2, "0")}`;
  }
  function updateUI() {
    if (!state) return;
    const car = myCar();
    $("clock").textContent = fmtHour(state.tick);
    $("day").textContent = `Jour ${Math.floor(state.tick / 86400) + 1}`;
    $("pos").textContent = `${(car?.positionKm ?? 0).toFixed(0)} km / ${state.world.totalKm} km`;
    $("budget").textContent = `\u{1F4B0} ${(car?.budget ?? 0).toFixed(0)}`;
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
  function updateStandings() {
    const el = $("standings");
    el.innerHTML = "";
    state.standings.forEach((pid, i) => {
      const p = state.players.find((x) => x.id === pid);
      const c = state.cars.find((x) => x.playerId === pid);
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${p?.pseudo ?? pid} \u2014 ${c ? c.positionKm.toFixed(0) : 0} km${c?.arrived ? " \u{1F3C1}" : c?.forfait ? " \u274C" : ""}`;
      if (pid === myId) li.style.color = "#d9a441";
      el.appendChild(li);
    });
    const ch = $("challenges");
    ch.innerHTML = "<h3>Challenges du jour</h3>";
    for (const c of state.challenges ?? []) {
      const d = document.createElement("div");
      d.className = "rule";
      const nm = (id) => state.players.find((p) => p.id === id)?.pseudo ?? id;
      d.innerHTML = c.vitesseMax ? `\u26A1 Vitesse max : <b>${nm(c.vitesseMax.playerId)}</b> (${c.vitesseMax.value.toFixed(0)} km/h)<br>` : "";
      d.innerHTML += c.distanceJour ? `\u{1F6E3}\uFE0F Distance : <b>${nm(c.distanceJour.playerId)}</b> (${c.distanceJour.value.toFixed(0)} km)<br>` : "";
      d.innerHTML += c.leader ? `\u{1F451} Leader : <b>${nm(c.leader.playerId)}</b>` : "";
      ch.appendChild(d);
    }
  }
  function updateEvents() {
    const el = $("events");
    el.innerHTML = "";
    for (const e of state.events.slice(-40).reverse()) {
      const d = document.createElement("div");
      d.textContent = `[${fmtHour(e.tick)}] ${e.text}`;
      el.appendChild(d);
    }
  }
  function updateChat() {
    const el = $("chat");
    el.innerHTML = "";
    for (const m of state.chat.slice(-40)) {
      const d = document.createElement("div");
      d.className = "msg";
      const sp = document.createElement("span");
      sp.className = "pseudo";
      sp.textContent = `${m.pseudo} : `;
      d.append(sp, document.createTextNode(m.text));
      el.appendChild(d);
    }
  }
  function updateGauges() {
    const car = myCar();
    const el = $("gauges");
    el.innerHTML = "";
    if (!car) return;
    const gauge = (label, pct, invert = false) => {
      const good = invert ? 100 - pct : pct;
      const color = good > 60 ? "#7c7" : good > 30 ? "#cc7" : "#c66";
      return `<div class="g"><span>${label}</span><div class="bar"><div class="fill" style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></div></div></div>`;
    };
    const fuelPct = car.fuel / car.fuelCapacity * 100;
    let organsHtml = "";
    for (const [o, w] of Object.entries(car.organs)) {
      organsHtml += gauge(`${ORGANS_FR[o]} ${w.toFixed(0)}%`, w, true);
    }
    el.innerHTML = gauge("Carburant", fuelPct) + gauge("Fatigue", car.fatigue, true) + `<div class="rule">Allure : <b>${PACE_FR[car.pace] ?? car.pace}</b> \u2014 Risque : <b>${car.risk}</b> \u2014 Roues : <b>${car.spareWheels}</b></div>` + organsHtml;
    const actions = $("actions");
    actions.innerHTML = "";
    if (car.immobilized) {
      const truck = document.createElement("button");
      truck.textContent = "\u{1F69B} Appeler le camion (6h)";
      truck.onclick = () => send({ type: "call_truck" });
      actions.append(truck);
    }
    const forf = document.createElement("button");
    forf.textContent = "\u{1F3F3}\uFE0F D\xE9clarer forfait";
    forf.onclick = () => {
      if (confirm("D\xE9clarer forfait ? Vous deviendrez spectateur.")) send({ type: "forfait" });
    };
    actions.append(forf);
    const assist = document.createElement("button");
    assist.textContent = car.allowAssist ? "\u{1F91D} Entraide : OUI" : "\u{1F91D} Entraide : NON";
    assist.onclick = () => send({ type: "allow_assist", value: !car.allowAssist });
    actions.append(assist);
    if (car.stopped) {
      const setup = document.createElement("button");
      setup.textContent = "\u{1F527} R\xE9glages voiture (station)";
      setup.onclick = () => openSettings(car);
      actions.append(setup);
    }
    const resBtn = document.createElement("button");
    resBtn.textContent = "\u{1F4CA} D\xE9tail budget";
    resBtn.onclick = () => openBudget(car);
    actions.append(resBtn);
    const near = state.cars.filter(
      (c) => c.playerId !== myId && Math.abs(c.positionKm - car.positionKm) < 0.5 && !c.arrived && !c.forfait
    );
    for (const n of near) {
      const name = state.players.find((p) => p.id === n.playerId)?.pseudo ?? n.playerId;
      if (n.immobilized) {
        const tow = document.createElement("button");
        tow.textContent = `\u{1FA9D} Remorquer ${name}`;
        tow.onclick = () => send({ type: "tow", targetId: n.playerId });
        actions.append(tow);
      }
      if (n.stopped) {
        const fuel = document.createElement("button");
        fuel.textContent = `\u26FD Donner 10 L \xE0 ${name}`;
        fuel.onclick = () => send({ type: "transfer_fuel", targetId: n.playerId, litres: 10 });
        actions.append(fuel);
        const rep = document.createElement("button");
        rep.textContent = `\u{1F527} Aider r\xE9parations de ${name}`;
        rep.onclick = () => send({ type: "repair_together", targetId: n.playerId });
        actions.append(rep);
      }
    }
  }
  function updateMental() {
    const el = $("mental");
    el.innerHTML = "";
    const car = myCar();
    if (!car) return;
    for (const m of car.mentalLog.slice(-15).reverse()) {
      const d = document.createElement("div");
      d.textContent = `\xAB ${m.text} \xBB`;
      el.appendChild(d);
    }
  }
  function updateRules() {
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
      const cond = r.conditions.length === 0 ? "toujours" : r.conditions.map(condText).join(" ET ");
      d.innerHTML = `<div class="head"><span>N\xB0${r.channel} ${r.enabled ? '<span class="on">ON</span>' : '<span class="off">OFF</span>'}</span><button class="small" data-ch="${r.channel}">${r.enabled ? "\u23F8" : "\u25B6"}</button></div><div>${cond} \u2192 <b>${actionText(r.action)}</b></div>`;
      el.appendChild(d);
    }
    const more = document.createElement("button");
    more.textContent = "\xC9diteur complet\u2026";
    more.onclick = openPlanner;
    el.appendChild(more);
  }
  function condText(c) {
    if (c.kind === "bool") return c.value ? c.variable : `!${c.variable}`;
    if (c.kind === "numeric") return `${c.variable} ${c.operator} ${c.value}`;
    return `${c.variable} = ${c.value}`;
  }
  function actionText(a) {
    switch (a.kind) {
      case "allure":
        return `allure ${PACE_FR[a.level] ?? a.level}`;
      case "risque":
        return `risque ${a.level}`;
      case "ravitaillement":
        return `faire le plein (${a.target.kind === "percent" ? a.target.percent + "%" : a.target.litres + " L"}) \xE0 la prochaine station`;
      case "reparer_organe":
        return `r\xE9parer ${ORGANS_FR[a.organ]} \xE0 la station`;
      case "remplacer_roue":
        return `changer la roue (${a.where === "station" ? "\xE0 la station" : "au bord de la piste"})`;
      case "dormir":
        return `dormir ${a.hours} h (${a.place})`;
      case "depassement":
        return `d\xE9passement ${a.level}`;
      case "defendre_position":
        return "d\xE9fendre sa position";
      case "appeler_camion":
        return "appeler le camion";
      case "arreter_station":
        return "s'arr\xEAter \xE0 la prochaine station";
      case "reprendre_route":
        return "reprendre la route";
      case "assistance_rival":
        return "assister un rival";
      case "set_rule":
        return `r\xE8gle N\xB0${a.channel} = ${a.enabled ? "on" : "off"}`;
      default:
        return a.kind;
    }
  }
  var BOOL_VARS = ["crevaison", "immobilisation", "nuit", "en_station", "bivouac_en_cours", "meteo_active", "depassement_en_cours"];
  var NUM_VARS = ["carburant", "fatigue", "organe_critique", "vitesse", "km_parcourus", "distance_prochaine_station", "heure", "jour_de_course", "distance_rival_devant", "distance_rival_derriere"];
  var CAT_VARS = {
    biome: ["desert", "montagne", "steppe", "humide"],
    typologie_terrain: ["piste_rapide", "piste_moyenne", "piste_mauvaise", "dunes", "regs", "pierrier", "col", "bourbier", "mar\xE9cage"]
  };
  var NUM_VARS_LABELS = {
    carburant: "Carburant (% r\xE9servoir)",
    fatigue: "Fatigue (0-100)",
    organe_critique: "Organes au seuil critique",
    vitesse: "Vitesse (km/h)",
    km_parcourus: "Km parcourus",
    distance_prochaine_station: "Distance prochaine station (km)",
    heure: "Heure (0-24)",
    jour_de_course: "Jour de course",
    distance_rival_devant: "Distance rival devant (km)",
    distance_rival_derriere: "Distance rival derri\xE8re (km)"
  };
  var BOOL_VARS_LABELS = {
    crevaison: "Crevaison",
    immobilisation: "Immobilisation",
    nuit: "Nuit",
    en_station: "En station",
    bivouac_en_cours: "Bivouac en cours",
    meteo_active: "M\xE9t\xE9o active",
    depassement_en_cours: "D\xE9passement en cours"
  };
  function field(label, input) {
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
  function select(options, value, onchange) {
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
  function numberInput(value, onchange) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.value = String(value);
    inp.oninput = () => onchange(parseFloat(inp.value) || 0);
    return inp;
  }
  function renderConditionEditor(cond, onChange) {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
    const kinds = select(
      [
        { value: "bool", label: "Bool\xE9enne" },
        { value: "numeric", label: "Num\xE9rique" },
        { value: "categorial", label: "Cat\xE9gorielle" }
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
      box.appendChild(select(BOOL_VARS.map((v) => ({ value: v, label: BOOL_VARS_LABELS[v] ?? v })), cond.variable, (v) => {
        cond.variable = v;
        onChange();
      }));
      box.appendChild(select([{ value: "true", label: "est vraie" }, { value: "false", label: "est fausse" }], cond.value ? "true" : "false", (v) => {
        cond.value = v === "true";
        onChange();
      }));
    } else if (cond.kind === "numeric") {
      box.appendChild(select(NUM_VARS.map((v) => ({ value: v, label: NUM_VARS_LABELS[v] ?? v })), cond.variable, (v) => {
        cond.variable = v;
        onChange();
      }));
      box.appendChild(select(["<", "<=", ">", ">=", "=="].map((o) => ({ value: o, label: o })), cond.operator, (v) => {
        cond.operator = v;
        onChange();
      }));
      box.appendChild(numberInput(cond.value, (v) => {
        cond.value = v;
        onChange();
      }));
    } else {
      box.appendChild(select(Object.keys(CAT_VARS).map((k) => ({ value: k, label: k === "biome" ? "Biome" : "Typologie de terrain" })), cond.variable, (v) => {
        cond.variable = v;
        cond.value = CAT_VARS[v][0];
        onChange();
      }));
      box.appendChild(select(CAT_VARS[cond.variable]?.map((c) => ({ value: c, label: c })) ?? [], cond.value, (v) => {
        cond.value = v;
        onChange();
      }));
    }
    return box;
  }
  function renderActionEditor(rule, onChange) {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
    const actionTypes = [
      { value: "allure", label: "Changer l'allure" },
      { value: "risque", label: "Changer le risque" },
      { value: "ravitaillement", label: "Ravitaillement (prochaine station)" },
      { value: "reparer_organe", label: "R\xE9parer un organe (station)" },
      { value: "remplacer_roue", label: "Remplacer une roue" },
      { value: "dormir", label: "Dormir" },
      { value: "depassement", label: "Moduler le d\xE9passement" },
      { value: "defendre_position", label: "D\xE9fendre sa position" },
      { value: "appeler_camion", label: "Appeler le camion d'assistance" },
      { value: "arreter_station", label: "S'arr\xEAter \xE0 la prochaine station" },
      { value: "reprendre_route", label: "Reprendre la route" },
      { value: "assistance_rival", label: "Assistance \xE0 un rival" },
      { value: "set_rule", label: "M\xE9ta-action: activer/d\xE9sactiver une r\xE8gle" }
    ];
    const ensure = (kind) => {
      const defaults = {
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
        set_rule: { kind: "set_rule", channel: 1, enabled: false }
      };
      rule.action = defaults[kind];
      onChange();
    };
    box.appendChild(select(actionTypes, rule.action.kind, ensure));
    const a = rule.action;
    if (a.kind === "allure") box.appendChild(select(["lift_and_coast", "prudente", "normale", "soutenue", "attaque"].map((l) => ({ value: l, label: PACE_FR[l] ?? l })), a.level, (v) => {
      a.level = v;
      onChange();
    }));
    else if (a.kind === "risque") box.appendChild(select(["bas", "normal", "haut"].map((l) => ({ value: l, label: l })), a.level, (v) => {
      a.level = v;
      onChange();
    }));
    else if (a.kind === "ravitaillement") {
      box.appendChild(select([{ value: "percent", label: "% du r\xE9servoir" }, { value: "litres", label: "Litres" }], a.target.kind, (v) => {
        a.target = v === "percent" ? { kind: "percent", percent: 100 } : { kind: "litres", litres: 60 };
        onChange();
      }));
      box.appendChild(numberInput(a.target.kind === "percent" ? a.target.percent : a.target.litres, (v) => {
        if (a.target.kind === "percent") a.target.percent = v;
        else a.target.litres = v;
        onChange();
      }));
    } else if (a.kind === "reparer_organe") box.appendChild(select(Object.entries(ORGANS_FR).map(([k, v]) => ({ value: k, label: v })), a.organ, (v) => {
      a.organ = v;
      onChange();
    }));
    else if (a.kind === "remplacer_roue") box.appendChild(select([{ value: "station", label: "\xE0 la station" }, { value: "bord_piste", label: "au bord de la piste" }], a.where, (v) => {
      a.where = v;
      onChange();
    }));
    else if (a.kind === "dormir") {
      box.appendChild(numberInput(a.hours, (v) => {
        a.hours = v;
        onChange();
      }));
      box.appendChild(select([{ value: "bivouac", label: "bivouac sur place" }, { value: "hotel", label: "h\xF4tel (prochaine station)" }], a.place, (v) => {
        a.place = v;
        onChange();
      }));
    } else if (a.kind === "depassement") box.appendChild(select(["agressif", "prudent", "interdit"].map((l) => ({ value: l, label: l })), a.level, (v) => {
      a.level = v;
      onChange();
    }));
    else if (a.kind === "set_rule") {
      box.appendChild(numberInput(a.channel, (v) => {
        a.channel = Math.round(v);
        onChange();
      }));
      box.appendChild(select([{ value: "true", label: "activ\xE9e" }, { value: "false", label: "d\xE9sactiv\xE9e" }], a.enabled ? "true" : "false", (v) => {
        a.enabled = v === "true";
        onChange();
      }));
    }
    return box;
  }
  function openPlanner() {
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
    const render2 = () => {
      wrap.innerHTML = "<h2>Planificateur \u2014 50 canaux, le n\xB0 le plus bas gagne</h2>";
      const sorted = [...rules].sort((a, b) => a.channel - b.channel);
      for (const r of sorted) {
        const card = document.createElement("div");
        card.className = "rule";
        card.style.marginBottom = ".5rem";
        const head = document.createElement("div");
        head.className = "head";
        const title = document.createElement("span");
        title.innerHTML = `N\xB0${r.channel} <span class="${r.enabled ? "on" : "off"}">${r.enabled ? "ON" : "OFF"}</span> \u2014 ${r.mode === "one_shot" ? "one-shot" : "persistante"}`;
        head.appendChild(title);
        const chanSel = document.createElement("select");
        for (let ch = 1; ch <= 50; ch++) {
          const opt = document.createElement("option");
          opt.value = String(ch);
          opt.textContent = `N\xB0${ch}`;
          chanSel.appendChild(opt);
        }
        chanSel.value = String(r.channel);
        chanSel.onchange = () => {
          const newCh = parseInt(chanSel.value);
          if (rules.some((x) => x.channel === newCh)) return;
          r.channel = newCh;
          dirty = true;
          render2();
        };
        const toggle = document.createElement("button");
        toggle.textContent = r.enabled ? "\u23F8 D\xE9sactiver" : "\u25B6 Activer";
        toggle.onclick = () => {
          r.enabled = !r.enabled;
          dirty = true;
          render2();
        };
        const del = document.createElement("button");
        del.textContent = "\u{1F5D1}";
        del.onclick = () => {
          rules.splice(rules.indexOf(r), 1);
          dirty = true;
          render2();
        };
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
          row.appendChild(renderConditionEditor(cond, () => {
            dirty = true;
            renderSummary();
          }));
          const rm = document.createElement("button");
          rm.textContent = "\u2715";
          rm.className = "small";
          rm.onclick = () => {
            r.conditions.splice(r.conditions.indexOf(cond), 1);
            dirty = true;
            render2();
          };
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
            render2();
          };
          card.appendChild(addCond);
        }
        const actHeader = document.createElement("div");
        actHeader.innerHTML = "<b>Action</b>";
        card.append(actHeader);
        card.appendChild(renderActionEditor(r, () => {
          dirty = true;
          render2();
        }));
        const effHeader = document.createElement("div");
        effHeader.innerHTML = "<b>Dur\xE9e d'effet</b>";
        card.appendChild(effHeader);
        const effRow = document.createElement("div");
        effRow.style.cssText = "display:flex;gap:.3rem;align-items:flex-end;flex-wrap:wrap";
        const effSel = select(
          [
            { value: "default", label: "jusqu'\xE0 consigne contraire" },
            { value: "duration", label: "pendant (heures)" },
            { value: "distance", label: "pendant (km)" }
          ],
          r.effect.kind,
          (v) => {
            r.effect = v === "default" ? { kind: "default" } : v === "duration" ? { kind: "duration", hours: 2 } : { kind: "distance", km: 200 };
            dirty = true;
            render2();
          }
        );
        effRow.appendChild(effSel);
        if (r.effect.kind === "duration") effRow.appendChild(numberInput(r.effect.hours, (v) => {
          r.effect.hours = v;
          dirty = true;
          renderSummary();
        }));
        if (r.effect.kind === "distance") effRow.appendChild(numberInput(r.effect.km, (v) => {
          r.effect.km = v;
          dirty = true;
          renderSummary();
        }));
        card.appendChild(effRow);
        const modeRow = document.createElement("div");
        modeRow.style.marginTop = ".3rem";
        modeRow.appendChild(select(
          [{ value: "persistante", label: "Persistante (gardien)" }, { value: "one_shot", label: "One-shot (\xE0 r\xE9armer)" }],
          r.mode,
          (v) => {
            r.mode = v;
            dirty = true;
            render2();
          }
        ));
        card.appendChild(modeRow);
        wrap.appendChild(card);
      }
      const bottom = document.createElement("div");
      const addBtn = document.createElement("button");
      addBtn.textContent = "+ Nouvelle r\xE8gle";
      addBtn.onclick = () => {
        if (rules.length >= 50) return;
        const used = new Set(rules.map((r) => r.channel));
        let ch = 1;
        while (used.has(ch)) ch++;
        rules.push({
          channel: ch,
          enabled: true,
          conditions: [],
          action: { kind: "allure", level: "normale" },
          effect: { kind: "default" },
          mode: "persistante"
        });
        dirty = true;
        render2();
      };
      const saveBtn = document.createElement("button");
      saveBtn.textContent = "\u{1F4BE} Enregistrer";
      saveBtn.style.background = "#7c7";
      saveBtn.onclick = () => {
        send({ type: "rules", rules });
        closeFullscreen();
      };
      bottom.append(addBtn, saveBtn);
      wrap.appendChild(bottom);
      renderSummary();
    };
    const renderSummary = () => {
    };
    render2();
    content.appendChild(wrap);
  }
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function closeFullscreen() {
    $("fullscreen").style.display = "none";
    $("fscontent").innerHTML = "";
  }
  function openSettings(car) {
    const fsEl = $("fullscreen");
    fsEl.style.display = "block";
    const content = $("fscontent");
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = "<h2>R\xE9glages voiture \u2014 modifiables uniquement \xE0 l'arr\xEAt en station</h2>";
    const st = car.settings;
    const sliders = [
      { key: "tirePressure", label: "Pression des pneus", hint: "haute = vitesse sur piste dure, basse = accroche sable/dunes" },
      { key: "groundClearance", label: "Garde au sol", hint: "haute = dunes/rochers, basse = stabilit\xE9 et vitesse sur piste" },
      { key: "engineMap", label: "Cartographie moteur", hint: "puissance vs consommation" }
    ];
    for (const sl of sliders) {
      const row = field(`${sl.label} (0-100) \u2014 ${sl.hint}`, (() => {
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = "0";
        inp.max = "100";
        inp.value = String(st[sl.key]);
        inp.style.width = "220px";
        return inp;
      })());
      wrap.appendChild(row);
    }
    const save = document.createElement("button");
    save.textContent = "\u{1F4BE} Appliquer";
    save.style.background = "#7c7";
    save.onclick = () => {
      const settings = {};
      wrap.querySelectorAll("input[type=range]").forEach((inp, i) => {
        settings[sliders[i].key] = parseInt(inp.value);
      });
      send({ type: "settings", settings });
      closeFullscreen();
    };
    wrap.appendChild(save);
    content.appendChild(wrap);
  }
  function openBudget(car) {
    const fsEl = $("fullscreen");
    fsEl.style.display = "block";
    const content = $("fscontent");
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = `<h2>Portefeuille \u2014 ${car.budget.toFixed(0)}</h2><p>Primes re\xE7ues : ${car.stats.primes.toFixed(0)} \u2014 D\xE9penses : ${car.stats.depenses.toFixed(0)}</p>`;
    const table = document.createElement("table");
    table.innerHTML = "<tr><th>Heure</th><th>Op\xE9ration</th><th>Montant</th></tr>";
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
  function openResults() {
    if (!state) return;
    const fsEl = $("fullscreen");
    fsEl.style.display = "block";
    const content = $("fscontent");
    content.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.innerHTML = "<h2>\u{1F3C1} R\xE9sultats de la course</h2>";
    const table = document.createElement("table");
    table.innerHTML = "<tr><th>#</th><th>Pilote</th><th>Distance</th><th>V. moy.</th><th>Pannes</th><th>Accidents</th><th>D\xE9passements</th><th>D\xE9penses</th><th>Primes</th></tr>";
    state.standings.forEach((pid, i) => {
      const p = state.players.find((x) => x.id === pid);
      const c = state.cars.find((x) => x.playerId === pid);
      if (!c) return;
      const avg = state.tick > 0 ? c.positionKm / (state.tick / 3600) : 0;
      const st = c.stats;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(p?.pseudo ?? pid)}${c.arrived ? " \u{1F3C1}" : c.forfait ? " \u274C" : ""}</td><td>${c.positionKm.toFixed(0)} km</td><td>${avg.toFixed(1)} km/h</td><td>${st ? st.pannes : "\u2014"}</td><td>${st ? st.accidents : "\u2014"}</td><td>${st ? st.depassements : "\u2014"}</td><td>${st ? st.depenses.toFixed(0) : "\u2014"}</td><td>${st ? st.primes.toFixed(0) : "\u2014"}</td>`;
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    content.appendChild(wrap);
  }
  function openMap() {
    if (!state) return;
    $("fullscreen").style.display = "block";
    const content = $("fscontent");
    content.innerHTML = "";
    const c = document.createElement("canvas");
    c.width = content.clientWidth || 900;
    c.height = (content.clientWidth || 900) * 0.5;
    content.appendChild(c);
    drawMap(c.getContext("2d"), c.width, c.height);
  }
  function drawMap(m, w, h) {
    if (!state) return;
    const total = state.world.totalKm;
    m.fillStyle = "#3a332a";
    m.fillRect(0, 0, w, h);
    const profileY = (alt) => h * 0.55 - alt / 4e3 * h * 0.45;
    m.strokeStyle = "#5a4f3d";
    m.lineWidth = 1;
    state.world.segments.forEach((seg) => {
      m.fillStyle = BIOME_COLORS[seg.biome];
      m.fillRect(seg.km / total * w, h - 24, w / state.world.segments.length + 1, 24);
    });
    m.strokeStyle = "#d9a441";
    m.lineWidth = 3;
    m.beginPath();
    state.world.segments.forEach((seg, i) => {
      const x = seg.km / total * w;
      const y = profileY(seg.altitude);
      if (i === 0) m.moveTo(x, y);
      else m.lineTo(x, y);
    });
    m.stroke();
    m.font = "11px sans-serif";
    state.world.stations.forEach((s) => {
      const x = s.km / total * w;
      m.fillText("\u26FD", x - 5, profileY(3e3) + 14);
      m.fillStyle = "#fff";
      m.fillText(s.name, x - 20, profileY(3e3) + 28);
      m.fillStyle = "#000";
    });
    state.world.villages.forEach((v) => {
      m.fillStyle = "#ddd";
      m.fillText("\u{1F3E0}", v.km / total * w - 5, profileY(3e3) + 40);
    });
    state.cars.forEach((c) => {
      const x = c.positionKm / total * w;
      const y = profileY(altAt(c.positionKm)) - 8;
      m.fillStyle = c.color;
      m.beginPath();
      m.arc(x, y, 6, 0, Math.PI * 2);
      m.fill();
      const p = state.players.find((pp) => pp.id === c.playerId);
      m.fillStyle = "#fff";
      m.fillText(p?.pseudo ?? "", x + 8, y + 3);
    });
  }
  function altAt(km) {
    if (!state) return 0;
    const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
    return seg?.altitude ?? 0;
  }
  var camZoom = 1;
  var lastFrame = 0;
  var dustParticles = [];
  var rainDrops = [];
  var WEATHER_FR = {
    clair: "Ciel d\xE9gag\xE9",
    pluie_diluvienne: "Pluie diluvienne",
    tempete_sable: "Temp\xEAte de sable",
    canicule: "Canicule",
    froid_intense: "Froid intense",
    brouillard: "Brouillard dense",
    vent_fort: "Vent lat\xE9ral fort",
    grele: "Gr\xEAle / orage"
  };
  var WEATHER_ICON = {
    clair: "\u2600\uFE0F",
    pluie_diluvienne: "\u{1F327}\uFE0F",
    tempete_sable: "\u{1F32A}\uFE0F",
    canicule: "\u{1F975}",
    froid_intense: "\u2744\uFE0F",
    brouillard: "\u{1F32B}\uFE0F",
    vent_fort: "\u{1F4A8}",
    grele: "\u26C8\uFE0F"
  };
  cv.addEventListener("wheel", (e) => {
    camZoom = Math.max(0.6, Math.min(1.6, camZoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  });
  function render() {
    requestAnimationFrame(render);
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1e3);
    lastFrame = now;
    if (!state) return;
    const w = cv.width = cv.clientWidth;
    const h = cv.height = cv.clientHeight;
    const car = myCar();
    const myPub = state.cars.find((c) => c.playerId === myId);
    const km = myPub?.positionKm ?? 0;
    const seg = state.world.segments[Math.min(state.world.segments.length - 1, Math.floor(km / 25))];
    const weather = myPub?.weather ?? "clair";
    const hour = hourOfDay(state.tick);
    const dark = hour >= 21 || hour < 5 ? 0.75 : hour >= 19 ? (hour - 19) / 2 * 0.75 : hour < 7 ? (7 - hour) / 2 * 0.75 : 0;
    ctx.save();
    ctx.translate(w / 2, h * 0.55);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-w / 2, -h * 0.55);
    ctx.fillStyle = BIOME_COLORS[seg?.biome ?? "steppe"];
    ctx.fillRect(-w, -h, w * 3, h * 3);
    const seedR = (n) => {
      const x = Math.sin(n * 127.1 + km * 0.7) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 7; i++) {
      const bx = i * w / 6 - w * 0.08;
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
    if (seedR(Math.floor(now / 8e3)) < 0.25) {
      const ax = w * 0.15 + seedR(Math.floor(now / 8e3) + 1) * w * 0.7;
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
      const bx = w / 2 + rel / 0.35 * w * 0.42;
      ctx.fillStyle = "#efe8dc";
      ctx.fillRect(bx - 1, h * 0.7 - 14, 2, 14);
      ctx.fillStyle = "#3a332a";
      ctx.fillText(`${bkm}`, bx - 10, h * 0.7 - 17);
    }
    for (const st of state.world.stations) {
      const rel = st.km - km;
      if (rel > -0.05 && rel < 0.35) {
        const sx = w / 2 + rel / 0.35 * w * 0.42;
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("\u26FD", sx, h * 0.7 - 26);
        if (st.hasHotel) ctx.fillText("\u{1F3E8}", sx + 16, h * 0.7 - 26);
        ctx.font = "10px sans-serif";
      }
    }
    const cx = w / 2, cy = h * 0.7;
    const drawCar = (x, y, color, label, moving) => {
      const bounce = moving ? Math.sin(now / 90 + x) * 1.5 : 0;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(x, y + 13, 27, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      for (const wx2 of [x - 27, x - 19, x + 19, x + 27]) {
        ctx.fillRect(wx2, y - 9 + bounce, 8, 18);
        if (moving) {
          ctx.fillStyle = "#555";
          const spin = Math.sin(now / 60 + wx2) * 6;
          ctx.fillRect(wx2, y - 4 + bounce + spin * 0.4, 8, 3);
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
      for (const c of state.cars) {
        if (c.playerId === myId) continue;
        const gap = c.positionKm - myPub.positionKm;
        if (Math.abs(gap) < 0.35) {
          const rel = gap / 0.35;
          drawCar(cx + rel * w * 0.35, cy - 14, c.color, state.players.find((p) => p.id === c.playerId)?.pseudo, c.speedKmh > 2);
        }
      }
      drawCar(cx, cy, myPub.color, void 0, myPub.speedKmh > 2);
      if (myPub.immobilized) {
        ctx.fillStyle = "#e66";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("\u26A0 " + (myPub.immobilizedReason ?? ""), cx - 60, cy - 32);
      } else if (myPub.sleeping) {
        ctx.fillStyle = "#ccc";
        ctx.font = "13px sans-serif";
        ctx.fillText("\u{1F4A4} bivouac / repos en cours", cx - 70, cy - 32);
      }
      if (myPub.speedKmh > 5) {
        if (dustParticles.length < 40 && Math.random() < 0.5) {
          dustParticles.push({ x: cx - 30, y: cy + 6, vx: -30 - Math.random() * 40, vy: -10 + Math.random() * 20, life: 1 });
        }
        for (const p of dustParticles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 1.4;
          ctx.fillStyle = `rgba(180,160,120,${Math.max(0, p.life) * 0.5})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 + (1 - p.life) * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        dustParticles = dustParticles.filter((p) => p.life > 0);
      }
    }
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
    if (weather === "pluie_diluvienne" || weather === "grele") {
      if (rainDrops.length < 120) for (let i = 0; i < 6; i++) rainDrops.push({ x: Math.random() * w, y: Math.random() * h });
      ctx.strokeStyle = weather === "grele" ? "rgba(220,230,255,0.7)" : "rgba(160,190,230,0.6)";
      ctx.lineWidth = weather === "grele" ? 2.5 : 1.2;
      for (const d of rainDrops) {
        d.y += (weather === "grele" ? 300 : 480) * dt;
        d.x -= 60 * dt;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 3, d.y + 10);
        ctx.stroke();
        if (d.y > h) {
          d.y = -10;
          d.x = Math.random() * (w * 1.1);
        }
      }
      if (weather === "grele" && Math.random() < 8e-3) {
        ctx.fillStyle = "rgba(255,255,200,0.9)";
        ctx.fillRect(0, 0, w, h);
      }
    } else rainDrops = [];
    if (weather === "tempete_sable") {
      ctx.fillStyle = "rgba(190,150,90,0.35)";
      ctx.fillRect(-w, -h, w * 3, h * 3);
      for (let i = 0; i < 40; i++) {
        const sx = (now / 8 + i * 97) % (w + 100) - 50;
        const sy = i * 53 % h;
        ctx.fillStyle = "rgba(220,190,130,0.5)";
        ctx.fillRect(sx + now / 3 % 30, sy, 14, 2);
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
    ctx.fillStyle = "rgba(30,26,20,0.75)";
    ctx.fillRect(0, h - 30, w, 30);
    ctx.fillStyle = "#efe8dc";
    ctx.font = "13px sans-serif";
    const spd = myPub?.speedKmh ?? 0;
    ctx.fillText(`${spd.toFixed(0)} km/h`, 12, h - 11);
    ctx.fillText(`${WEATHER_ICON[weather] ?? ""} ${WEATHER_FR[weather] ?? weather}`, 100, h - 11);
    ctx.fillText(`${(myPub?.positionKm ?? 0).toFixed(1)} km`, w - 110, h - 11);
    const wx = $("weather");
    if (wx) wx.textContent = `${WEATHER_ICON[weather] ?? ""} ${WEATHER_FR[weather] ?? ""}`;
    if (state.paused || !state.started) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, w, 40);
      ctx.fillStyle = "#fff";
      ctx.font = "16px sans-serif";
      ctx.fillText(state.paused ? "\u23F8 Course en pause \u2014 \xE9ditez vos r\xE8gles librement" : "\u23F3 En attente du d\xE9part\u2026", 12, 26);
    }
    updateAudio(myPub, weather, dark);
  }
  function addAdminButtons() {
    const bar = $("topbar");
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = fn;
      bar.appendChild(b);
    };
    mk("D\xE9part", () => send({ type: "admin_start" }));
    mk("Pause", () => send({ type: "admin_pause", paused: true }));
    mk("Reprendre", () => send({ type: "admin_pause", paused: false }));
    mk("+1h", () => send({ type: "admin_advance", steps: 3600 }));
    mk("+6h", () => send({ type: "admin_advance", steps: 21600 }));
  }
  $("joinform").addEventListener("submit", (e) => {
    e.preventDefault();
    send({
      type: "join",
      pseudo: $("f_pseudo").value,
      code: $("f_code").value,
      color: $("f_color").value
    });
  });
  $("chatinput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const input = e.target;
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
  var audioCtx = null;
  var engineOsc = null;
  var engineGain = null;
  var windGain = null;
  var soundOn = false;
  function startAudio() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(audioCtx.destination);
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 55;
    engineOsc.connect(engineGain);
    engineOsc.start();
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
  function updateAudio(myPub, weather, dark) {
    if (!soundOn || !audioCtx || !engineOsc || !engineGain || !windGain) return;
    const speed = myPub?.speedKmh ?? 0;
    engineOsc.frequency.value = 45 + speed / 100 * 110;
    engineGain.gain.value = speed > 1 ? 0.05 : 0.02;
    const storm = weather === "tempete_sable" || weather === "pluie_diluvienne" || weather === "grele" || weather === "vent_fort";
    windGain.gain.value = (storm ? 0.09 : 0.02) + dark * 0.02;
  }
  $("btn-sound").addEventListener("click", () => {
    soundOn = !soundOn;
    $("btn-sound").textContent = soundOn ? "\u{1F507} Muet" : "\u{1F50A} Son";
    if (soundOn) {
      startAudio();
      audioCtx?.resume();
    } else if (audioCtx) {
      engineGain.gain.value = 0;
      windGain.gain.value = 0;
    }
  });
  connect();
  render();
})();
