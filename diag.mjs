const { Race } = await import('./packages/engine/dist/race.js');
const { segmentAt, weatherAt } = await import('./packages/engine/dist/world.js');
const race = new Race({ seedText: 'dakar-calib', targetHours: 168, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
race.addPlayer('a', 'A', '#0a0');
race.start();
let sum = 0, n = 0, night = 0, weather = 0, stops = 0, slowTerrain = 0;
let speedSamples = [];
for (let i = 0; i < 3600 * 24; i++) {
  race.step();
  const c = race.cars[0];
  sum += c.speedKmh; n++;
  if (c.speedKmh === 0) stops++;
  const seg = segmentAt(race.world.segments, c.positionKm);
  const w = weatherAt(race.fronts, race.tick, c.positionKm);
  if (w !== 'clair') weather++;
  const hour = race.hourOfDay(race.tick);
  if (hour >= 21 || hour < 5) night++;
  if (['dunes','pierrier','col','bourbier','marécage','piste_mauvaise'].includes(seg.terrain)) slowTerrain++;
  if (i % 600 === 0) speedSamples.push(`${c.speedKmh.toFixed(0)}(${seg.terrain},${w!=='clair'?'météo':'',hour.toFixed(0)}h,fat${c.fatigue.toFixed(0)})`);
}
console.log('avg speed:', (sum / n).toFixed(1), 'km/h | arrêt %:', (stops / n * 100).toFixed(1), '| météo %:', (weather / n * 100).toFixed(1), '| nuit %:', (night / n * 100).toFixed(1), '| terrain lent %:', (slowTerrain / n * 100).toFixed(1));
console.log('km après 24h:', race.cars[0].positionKm.toFixed(0));
console.log('échantillons:', speedSamples.join(' '));
