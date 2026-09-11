import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listBillingRows, prepareFromBillingRow, type Source } from "./billing.js";
import { REPO_ROOT, type ArcaConfig } from "./config.js";
import { readCsv } from "./csv.js";
import { invoiceOutPaths } from "./out.js";

export type InvoiceCatalogItem = {
  clienteId: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  descripcion: string;
  monto: string;
  moneda: string;
  vencimiento: string;
  emailFacturacion: string;
  valid: boolean;
  error?: string;
  status: "pending" | "accepted" | "rejected";
  hasDryRun: boolean;
  hasPdf: boolean;
  cae?: string;
  comprobanteNumero?: number;
};

export type CollectionCatalogItem = InvoiceCatalogItem & {
  importeLabel: string;
  estadoPago: string;
  estadoFactura: string;
  comprobante: string;
  medioPago: string;
};

function metadata(paths: ReturnType<typeof invoiceOutPaths>): Record<string, any> | null {
  if (!existsSync(paths.metadataJson)) return null;
  try {
    return JSON.parse(readFileSync(paths.metadataJson, "utf-8"));
  } catch {
    return null;
  }
}

export function listInvoiceCatalog(periodo: string, source: Source, config: ArcaConfig): InvoiceCatalogItem[] {
  return listBillingRows(periodo, source).map((row) => {
    const clienteId = (row.cliente_id || "").trim();
    const paths = invoiceOutPaths(periodo, clienteId, config.env);
    const meta = metadata(paths);
    let valid = true;
    let error: string | undefined;

    try {
      prepareFromBillingRow(row, config, source);
    } catch (cause: any) {
      valid = false;
      error = cause?.message || String(cause);
    }

    return {
      clienteId,
      razonSocial: row.razon_social || row.cliente_nombre || clienteId,
      cuit: row.cuit || "",
      condicionIva: row.condicion_iva || "",
      descripcion: row.descripcion || "",
      monto: row.monto || "",
      moneda: row.moneda || "ARS",
      vencimiento: row.vencimiento || "",
      emailFacturacion: row.email_facturacion || "",
      valid,
      error,
      status: meta?.status === "accepted" ? "accepted" : meta?.status === "rejected" ? "rejected" : "pending",
      hasDryRun: existsSync(paths.requestJson.replace(/request\.json$/, "dry-run-request.json")),
      hasPdf: existsSync(paths.pdf),
      cae: meta?.cae,
      comprobanteNumero: meta?.cbteDesde ? Number(meta.cbteDesde) : undefined,
    };
  });
}

export function listCollectionCatalog(periodo: string): CollectionCatalogItem[] {
  const pendingPath = path.join(REPO_ROOT, "data", "collections", "out", periodo, "pending.csv");
  const clientsPath = path.join(REPO_ROOT, "data", "collections", "clients.csv");
  if (!existsSync(pendingPath)) return [];
  const clients = new Map((existsSync(clientsPath) ? readCsv(clientsPath) : []).map((row) => [(row.cliente_id || "").trim(), row]));

  return readCsv(pendingPath).map((row) => {
    const clienteId = (row.cliente_id || "").trim();
    const client = clients.get(clienteId) || {};
    const estadoFactura = (row.estado_factura || "pendiente").trim().toLowerCase();
    const faltantes = (row.faltantes || "").trim();
    return {
      clienteId,
      razonSocial: row.cliente_nombre || client.razon_social || clienteId,
      cuit: client.cuit || "",
      condicionIva: client.condicion_iva || "",
      descripcion: row.servicio || client.servicio || "",
      monto: "0",
      moneda: "ARS",
      importeLabel: row.importe || "",
      vencimiento: row.vencimiento || "",
      emailFacturacion: client.email_facturacion || client.email || "",
      valid: !faltantes,
      error: faltantes ? `Faltan datos: ${faltantes}` : undefined,
      status: ["emitida", "enviada", "pagada"].includes(estadoFactura) ? "accepted" : "pending",
      hasDryRun: false,
      hasPdf: false,
      estadoPago: (row.estado_pago || "pendiente").trim().toLowerCase(),
      estadoFactura,
      comprobante: row.comprobante || "",
      medioPago: row.medio_pago || "",
    };
  });
}
