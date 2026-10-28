"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rng = void 0;
exports.seedFromString = seedFromString;
class Rng {
    constructor(seed) {
        this.state = seed >>> 0 || 1;
    }
    next() {
        let x = this.state;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state = x >>> 0;
        return this.state / 4294967296;
    }
    range(min, max) {
        return min + this.next() * (max - min);
    }
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
    pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
    }
    chance(p) {
        return this.next() < p;
    }
}
exports.Rng = Rng;
function seedFromString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
