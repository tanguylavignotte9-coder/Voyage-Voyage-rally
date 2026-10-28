// Build du bundle client via l'API esbuild — portable Windows/Mac/Linux,
// ne dépend ni du PATH npm ni d'un binaire appelé directement.
const esbuild = require("esbuild");
const path = require("path");
const root = path.resolve(__dirname, "..");

esbuild
  .build({
    entryPoints: [path.join(root, "packages/client/src/main.ts")],
    bundle: true,
    outfile: path.join(root, "packages/server/public/app.js"),
    format: "iife",
    target: "es2020",
  })
  .then(() => console.log("Client: packages/server/public/app.js"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
