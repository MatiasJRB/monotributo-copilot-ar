import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.js";
import {
  mergeDfeRegister,
  readDfeRegister,
  writeDfeRegister,
  type DfeNoticeMetadata,
} from "./dfe.js";
import { readJsonFile } from "./fiscal.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

const command = process.argv[2] ?? "help";
if (["help", "--help", "-h"].includes(command)) {
  console.log(`Registro mínimo y read-only de alertas DFE

Comandos:
  merge --input gmail-metadata.json [--register dfe-register.json] [--checked-at ISO-8601]

El input solo admite message_id, received_at, sender, subject y due_on. Cuerpos, snippets y adjuntos están prohibidos.`);
  process.exit(0);
}
if (command !== "merge") throw new Error(`Comando desconocido: ${command}`);

const inputPath = requiredArg("input");
const registerPath = path.resolve(arg("register", path.join(REPO_ROOT, "data", "out", "fiscal", "dfe-register.json"))!);
const candidates = readJsonFile<DfeNoticeMetadata[]>(inputPath);
if (!Array.isArray(candidates)) throw new Error("--input debe contener un array JSON");
const current = existsSync(registerPath) ? readDfeRegister(registerPath) : null;
const result = mergeDfeRegister({ current, candidates, checkedAt: arg("checked-at") });
console.log(JSON.stringify({
  register: writeDfeRegister(registerPath, result.register),
  checked_at: result.register.last_checked_at,
  new_notice_count: result.newNotices.length,
  new_notices: result.newNotices.map(({ message_id, received_at, sender, subject, due_on, status }) => ({
    message_id, received_at, sender, subject, due_on, status,
  })),
}, null, 2));
