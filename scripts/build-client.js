// Build du bundle client via l'API TypeScript — portable Windows/Mac/Linux,
// aucun binaire natif (esbuild remplacé par ts.transpileModule).
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

const inputFile = path.join(root, "packages/client/src/main.ts");
const outFile = path.join(root, "packages/server/public/app.js");

const source = fs.readFileSync(inputFile, "utf8");
const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  },
  fileName: inputFile,
});

if (result.diagnostics && result.diagnostics.length > 0) {
  for (const d of result.diagnostics) {
    console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  }
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, result.outputText);
console.log("Client: packages/server/public/app.js");
