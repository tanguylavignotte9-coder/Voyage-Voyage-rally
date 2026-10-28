import { Race, RaceParams } from "@vvr/engine";
export interface RaceConfig extends RaceParams {
    accessCode: string;
    adminPseudo: string;
}
export declare class RaceHost {
    race: Race;
    config: RaceConfig;
    chat: {
        tick: number;
        pseudo: string;
        text: string;
    }[];
    snapDir: string;
    constructor(config: RaceConfig, snapDir: string);
    snapshot(): void;
    static restore(snapDir: string): RaceHost | null;
}
