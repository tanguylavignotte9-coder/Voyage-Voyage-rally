"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaceHost = void 0;
const engine_1 = require("@vvr/engine");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class RaceHost {
    constructor(config, snapDir) {
        this.chat = [];
        this.config = config;
        this.snapDir = snapDir;
        this.race = new engine_1.Race(config);
        fs.mkdirSync(snapDir, { recursive: true });
    }
    snapshot() {
        const data = JSON.stringify({
            race: this.race,
            chat: this.chat,
            config: this.config,
        });
        fs.writeFileSync(path.join(this.snapDir, "snapshot.json"), data);
    }
    static restore(snapDir) {
        const file = path.join(snapDir, "snapshot.json");
        if (!fs.existsSync(file))
            return null;
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const host = new RaceHost(data.config, snapDir);
        Object.assign(host.race, data.race);
        host.chat = data.chat;
        return host;
    }
}
exports.RaceHost = RaceHost;
