export declare class Rng {
    private state;
    constructor(seed: number);
    next(): number;
    range(min: number, max: number): number;
    int(min: number, max: number): number;
    pick<T>(arr: T[]): T;
    chance(p: number): boolean;
}
export declare function seedFromString(s: string): number;
