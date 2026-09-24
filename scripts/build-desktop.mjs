import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const env = { ...process.env };
// Prefer verified local tools when they have already been prepared on this machine.
for (const [name, directory] of [
  ["ELECTRON_BUILDER_NSIS_DIR", "nsis"],
  ["ELECTRON_BUILDER_NSIS_RESOURCES_DIR", "nsis-resources"],
]) {
  const location = path.join(project, ".build-tools", directory);
  if (!env[name] && fs.existsSync(location)) env[name] = location;
}
const store = path.join(project, "node_modules", ".pnpm");
if (!env.ELECTRON_BUILDER_7ZIP_PATH && fs.existsSync(store)) {
  const installer = fs.readdirSync(store).find((name) => name.startsWith("electron-winstaller@"));
  const sevenZip = installer && path.join(store, installer, "node_modules", "electron-winstaller", "vendor", "7z.exe");
  if (sevenZip && fs.existsSync(sevenZip)) env.ELECTRON_BUILDER_7ZIP_PATH = sevenZip;
}
const cli = path.join(path.dirname(require.resolve("electron-builder/package.json")), "out", "cli", "cli.js");
const result = spawnSync(process.execPath, [cli, "--win", "nsis"], { cwd: project, env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
