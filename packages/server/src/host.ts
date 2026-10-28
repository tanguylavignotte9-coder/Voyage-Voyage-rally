import { Race, RaceParams } from "../../engine";
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
    const data = JSON.stringify({
      race: this.race,
      chat: this.chat,
      config: this.config,
      wallClock: this.wallClockSnapshot,
    });
    fs.writeFileSync(path.join(this.snapDir, "snapshot.json"), data);
  }

  static restore(snapDir: string): RaceHost | null {
    const file = path.join(snapDir, "snapshot.json");
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const host = new RaceHost(data.config, snapDir);
    Object.assign(host.race, data.race);
    host.chat = data.chat;
    host.wallClockSnapshot = data.wallClock ?? null;
    return host;
  }
}
