import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.js";

export type InvoiceOutputPaths = {
  dir: string;
  requestJson: string;
  responseJson: string;
  pdf: string;
  metadataJson: string;
};

function safePathSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(value)) {
    throw new Error(`${label} contiene caracteres no permitidos`);
  }
  return value;
}

export function invoiceOutPaths(periodo: string, clienteId: string, env: string): InvoiceOutputPaths {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new Error("periodo debe tener formato YYYY-MM");
  const dir = path.join(
    REPO_ROOT,
    "data",
    "out",
    periodo,
    "facturacion",
    "arca",
    safePathSegment(env, "env"),
    safePathSegment(clienteId, "clienteId"),
  );
  return {
    dir,
    requestJson: path.join(dir, "request.json"),
    responseJson: path.join(dir, "response.json"),
    pdf: path.join(dir, "factura-arca.pdf"),
    metadataJson: path.join(dir, "metadata.json"),
  };
}

export function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function writeBuffer(filePath: string, data: Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, data);
}
