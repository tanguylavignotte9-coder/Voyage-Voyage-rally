import { CarState, World, WeatherFront } from "./types";
import { Rng } from "./rng";
import { SimContext } from "./sim";
export interface RaceParams {
    seedText: string;
    targetHours: number;
    startIntervalSeconds: number;
    programWindowMinutes: number;
    closureDelayHours: number;
    biomeWeights?: Partial<Record<string, number>>;
}
export interface PlayerInfo {
    id: string;
    pseudo: string;
    color: string;
    isAdmin: boolean;
}
export declare class Race {
    world: World;
    fronts: WeatherFront[];
    cars: CarState[];
    players: PlayerInfo[];
    rng: Rng;
    tick: number;
    raceStartTick: number;
    paused: boolean;
    finished: boolean;
    events: {
        tick: number;
        text: string;
    }[];
    params: RaceParams;
    constructor(params: RaceParams);
    hourOfDay(tick: number): number;
    addPlayer(id: string, pseudo: string, color: string, isAdmin?: boolean): void;
    start(): void;
    ctxFor(): SimContext;
    step(): string[];
    standings(): CarState[];
}
