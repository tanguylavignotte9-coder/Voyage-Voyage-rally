import { CarState, TerrainSegment, World, WeatherFront } from "./types";
import { Rng } from "./rng";
import { GameVariables } from "./planner";
export declare const TICK_SECONDS = 1;
export declare const TICKS_PER_HOUR = 3600;
export declare function darknessFactor(hourOfDay: number): number;
export declare function computeSpeed(car: CarState, seg: TerrainSegment, weather: string, darkness: number): number;
export interface SimContext {
    world: World;
    fronts: WeatherFront[];
    rng: Rng;
    tick: number;
    raceStartTick: number;
    hourOfDay: (tick: number) => number;
    allCars?: CarState[];
}
export declare function buildVariables(car: CarState, ctx: SimContext): GameVariables;
export interface TickResult {
    events: string[];
}
export declare function tickCar(car: CarState, ctx: SimContext): TickResult;
