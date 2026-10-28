import { Race, RaceParams, generateWorld } from "../../engine";
import * as fs from "fs";
import * as path from "path";

export interface RaceConfig extends RaceParams {
  accessCode: string;
  adminCode: string;
  adminPseudo: string;
}

export class RaceHost {
  race: Race;
  config: RaceConfig;
  chat: { tick: number; pseudo: string; text: string }[] = [];
  snapDir: string;
  wallClockSnapshot: number | null = null;

  constructor(config: RaceConfig, snapDir: string) {
    this.config = config;
    this.snapDir = snapDir;
    this.race = new Race(config);
    fs.mkdirSync(snapDir, { recursive: true });
  }

  snapshot(): void {
    this.wallClockSnapshot = Date.now();
    // Le monde est déterministe: les 300k points de tracé sont régénérables
    // depuis la graine — on ne sérialise que l'état de course (léger).
    const raceLight: any = { ...this.race };
    const savedPoints = raceLight.world?.points;
    const savedPathZ = raceLight.world?.pathZ;
    if (raceLight.world) {
      raceLight.world = { ...raceLight.world, points: [], pathZ: [] };
    }
    const data = JSON.stringify({
      race: raceLight,
      chat: this.chat,
      config: this.config,
      wallClock: this.wallClockSnapshot,
    });
    if (raceLight.world && savedPoints) {
      raceLight.world.points = savedPoints;
      raceLight.world.pathZ = savedPathZ;
    }
    fs.writeFileSync(path.join(this.snapDir, "snapshot.json"), data);
  }

  static restore(snapDir: string): RaceHost | null {
    const file = path.join(snapDir, "snapshot.json");
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const host = new RaceHost(data.config, snapDir);
    // régénère le tracé complet depuis la graine (déterminisme) au lieu de
    // relire 78 Mo de points — et remplace le monde léger du snapshot
    if (data.race.world) {
      const seed = data.race.world.seed;
      data.race.world = generateWorld({ seed, targetHours: data.config.targetHours });
    }
    Object.assign(host.race, data.race);
    host.chat = data.chat;
    host.wallClockSnapshot = data.wallClock ?? null;
    return host;
  }
}
