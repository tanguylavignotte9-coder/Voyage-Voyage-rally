const { Race } = await import('./packages/engine/dist/race.js');
for (const seed of ['dakar-calib', 'sahara-2026', 'atlas-nord', 'test-raid']) {
  const race = new Race({ seedText: seed, targetHours: 168, startIntervalSeconds: 60, programWindowMinutes: 60, closureDelayHours: 24 });
  race.addPlayer('a', 'A', '#0a0');
  race.start();
  for (let i = 0; i < 3600 * 24; i++) race.step();
  const c = race.cars[0];
  console.log(`${seed}: km/24h=${c.positionKm.toFixed(0)} (${(c.positionKm/24).toFixed(1)} km/h) fat=${c.fatigue.toFixed(0)} worn=${Math.max(...Object.values(c.organs)).toFixed(0)}`);
}
