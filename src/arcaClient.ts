import { mkdirSync } from "node:fs";
import { Arca } from "@arcasdk/core";
import type { ArcaConfig } from "./config.js";

export function createArca(config: ArcaConfig): Arca {
  mkdirSync(config.ticketPath, { recursive: true });
  return new Arca({
    cuit: config.cuit,
    cert: config.cert,
    key: config.key,
    production: config.production,
    ticketPath: config.ticketPath,
    useHttpsAgent: config.useHttpsAgent,
  });
}
