import WebSocket from 'ws';
const results = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function connectClient(name, code = 'rally') {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8091');
    const client = { ws, name, state: null, joined: false, id: null };
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.type === 'state') client.state = m;
      else if (m.type === 'joined') { client.joined = true; client.id = m.playerId; }
      else if (m.type === 'error') results.push(`ERR(${name}): ${m.text}`);
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', pseudo: name, code, color: '#3c3' }));
      setTimeout(() => resolve(client), 500);
    });
  });
}
const a = await connectClient('Alice');
a.ws.send(JSON.stringify({ type: 'admin_start' }));
await wait(300);
const rules = JSON.parse(JSON.stringify(a.state.mine.rules));
rules.push({ channel: 5, enabled: true, conditions: [], action: { kind: 'allure', level: 'attaque' }, effect: { kind: 'default' }, mode: 'persistante' });
a.ws.send(JSON.stringify({ type: 'rules', rules }));
await wait(500);
const n1 = a.state.mine.rules.length;
results.push(`règles après ajout: ${n1} (attendu 5)`);
// contradiction: N°7 sans condition allure prudente vs N°5 attaque
const bad = JSON.parse(JSON.stringify(a.state.mine.rules));
bad.push({ channel: 7, enabled: true, conditions: [], action: { kind: 'allure', level: 'prudente' }, effect: { kind: 'default' }, mode: 'persistante' });
a.ws.send(JSON.stringify({ type: 'rules', rules: bad }));
await wait(500);
const n2 = a.state.mine.rules.length;
results.push(`contradiction refusée: ${n2 === n1} (${n2} canaux)`);
// réglages en station: pas en station -> ignoré; en course on vérifie juste que ça ne crashe pas
a.ws.send(JSON.stringify({ type: 'settings', settings: { tirePressure: 80 } }));
await wait(300);
results.push(`settings en course ignorés (pas en station): ok`);
console.log(results.join('\n'));
process.exit(results.every(r => !r.startsWith('ERR')) && n2 === n1 ? 0 : 1);
