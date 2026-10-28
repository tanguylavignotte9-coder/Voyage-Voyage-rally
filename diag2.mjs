const { Race } = await import('./packages/engine/dist/race.js');
const { segmentAt } = await import('./packages/engine/dist/world.js');
const race = new Race({ seedText: 'sahara-2026', targetHours: 168, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
race.addPlayer('a', 'A', '#0a0');
race.start();
const biomeCount = {};
let dist = 0;
for (let i = 0; i < 3600 * 24; i++) {
  race.step();
  const c = race.cars[0];
  const seg = segmentAt(race.world.segments, c.positionKm);
  biomeCount[seg.biome] = (biomeCount[seg.biome] ?? 0) + 1;
  if (i % 3600 === 0) console.log(`h${i/3600}: km=${c.positionKm.toFixed(0)} v=${c.speedKmh.toFixed(0)} terrain=${seg.terrain} organes: ${Object.entries(c.organs).filter(([k,v])=>v>50).map(([k,v])=>k+'='+v.toFixed(0)).join(' ') || 'ok'} ${c.immobilized ? 'IMMOB ' + c.immobilizedReason : ''}${c.stopped ? ' STATION' : ''}`);
}
console.log('biome exposure:', JSON.stringify(biomeCount));
