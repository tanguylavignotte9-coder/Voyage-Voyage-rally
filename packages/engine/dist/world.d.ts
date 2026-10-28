import { Rng } from "./rng";
import { Biome, Station, TerrainSegment, World, WeatherFront } from "./types";
export interface WorldGenParams {
    seed: number;
    targetHours: number;
    biomeWeights?: Partial<Record<Biome, number>>;
}
export declare const AVG_SPEED_KMH = 50;
export declare function generateWorld(params: WorldGenParams): World;
export declare function segmentAt(segments: TerrainSegment[], km: number): TerrainSegment;
export declare function nextStation(stations: Station[], km: number): Station | null;
export declare function generateWeatherFronts(world: World, rng: Rng, ticksPerHour: number): WeatherFront[];
export declare function weatherAt(fronts: WeatherFront[], tick: number, km: number): WeatherFront["kind"];
