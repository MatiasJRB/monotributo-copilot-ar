import { existsSync, readFileSync } from "node:fs";
import type { ICreateVoucherResult } from "@arcasdk/core";
import type { InvoiceData } from "@arcasdk/pdf";
import { createArca } from "./arcaClient.js";
import { getConfig, type ArcaConfig, type ArcaEnvironment } from "./config.js";
import { loadPreparedInvoice, type PreparedInvoice, type Source } from "./billing.js";
import { generateInvoicePdf } from "./pdf.js";
import { invoiceOutPaths, writeBuffer, writeJson } from "./out.js";

const HOMOLOGACION_NOTICE = "HOMOLOGACION / TESTING - NO VALIDA COMO FACTURA FISCAL.";

function getDetail(result: ICreateVoucherResult): any {
  const det = (result.response as any)?.FeDetResp?.FECAEDetResponse;
  return Array.isArray(det) ? det[0] : det;
}

function accepted(result: ICreateVoucherResult): boolean {
  return Boolean(result.cae && getDetail(result)?.Resultado === "A");
}

function invoiceDataFromBase(
  pdfBase: PreparedInvoice["pdfBase"],
  result: ICreateVoucherResult,
  options: { homologacion?: boolean } = {},
): InvoiceData {
  const detail = getDetail(result) || {};
  const observaciones = options.homologacion
    ? [HOMOLOGACION_NOTICE, pdfBase.observaciones].filter(Boolean).join(" ")
    : pdfBase.observaciones;
  return {
    ...pdfBase,
    observaciones,
    cbteDesde: Number(detail.CbteDesde),
    cbteHasta: Number(detail.CbteHasta),
    cae: result.cae,
    caeFechaVencimiento: result.caeFchVto,
  };
}

function invoiceData(prepared: PreparedInvoice, result: ICreateVoucherResult, config: ArcaConfig): InvoiceData {
  return invoiceDataFromBase(prepared.pdfBase, result, { homologacion: !config.production });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export async function serverStatus(config = getConfig()) {
  const arca = createArca(config);
  return arca.electronicBillingService.getServerStatus();
}

export async function salesPoints(config = getConfig()) {
  const arca = createArca(config);
  return arca.electronicBillingService.getSalesPoints();
}

export async function lastVoucher(cbteTipo = 11, config = getConfig()) {
  const arca = createArca(config);
  return arca.electronicBillingService.getLastVoucher(config.puntoVenta, cbteTipo);
}

export function dryRun(periodo: string, clienteId: string, source: Source, config = getConfig({ requireCredentials: false })) {
  const prepared = loadPreparedInvoice(periodo, clienteId, source, config);
  const paths = invoiceOutPaths(periodo, clienteId, config.env);
  const dryRunPaths = {
    ...paths,
    requestJson: paths.requestJson.replace(/request\.json$/, "dry-run-request.json"),
    metadataJson: paths.metadataJson.replace(/metadata\.json$/, "dry-run-metadata.json"),
  };
  writeJson(dryRunPaths.requestJson, {
    env: config.env,
    production: config.production,
    source,
    externalReference: prepared.externalReference,
    voucher: prepared.voucher,
    pdfBase: prepared.pdfBase,
  });
  writeJson(dryRunPaths.metadataJson, {
    status: "dry-run",
    env: config.env,
    source,
    periodo,
    clienteId,
    externalReference: prepared.externalReference,
  });
  return { prepared, paths: dryRunPaths };
}

export async function emitInvoice(options: {
  periodo: string;
  clienteId: string;
  source: Source;
  allowHomoEmit?: boolean;
  allowProductionEmit?: boolean;
  force?: boolean;
  config?: ArcaConfig;
}) {
  const config = options.config ?? getConfig();
  if (config.production && !options.allowProductionEmit) {
    throw new Error("Bloqueado: producción requiere allowProductionEmit=true y --production --allow-production-emit.");
  }
  if (config.production && options.force) {
    throw new Error("Bloqueado: producción no admite --force. Primero hay que reconciliar el último comprobante con ARCA.");
  }
  if (!config.production && !options.allowHomoEmit) {
    throw new Error("Bloqueado: homologación emite comprobantes de prueba; requiere allowHomoEmit=true / --allow-homo-emit.");
  }
  if (config.production && options.source !== "real") {
    throw new Error("Bloqueado: producción solo puede emitir source=real/facturas_a_emitir.csv.");
  }

  const prepared = loadPreparedInvoice(options.periodo, options.clienteId, options.source, config);
  const paths = invoiceOutPaths(options.periodo, options.clienteId, config.env);
  if (existsSync(paths.responseJson) && !options.force) {
    throw new Error(`Ya existe ${paths.responseJson}. Uso bloqueado para evitar duplicados. Pasá --force si corresponde.`);
  }

  writeJson(paths.requestJson, {
    env: config.env,
    production: config.production,
    source: options.source,
    externalReference: prepared.externalReference,
    voucher: prepared.voucher,
    pdfBase: prepared.pdfBase,
  });

  const arca = createArca(config);
  const result = await arca.electronicBillingService.createNextVoucher(prepared.voucher);
  writeJson(paths.responseJson, result);

  if (!accepted(result)) {
    writeJson(paths.metadataJson, {
      status: "rejected",
      env: config.env,
      source: options.source,
      periodo: options.periodo,
      clienteId: options.clienteId,
      externalReference: prepared.externalReference,
      detail: getDetail(result),
    });
    throw new Error(`ARCA no aceptó el comprobante. Revisar ${paths.responseJson}`);
  }

  const pdfData = invoiceData(prepared, result, config);
  const pdf = await generateInvoicePdf(pdfData, { homologacion: !config.production });
  writeBuffer(paths.pdf, pdf);
  const detail = getDetail(result);
  writeJson(paths.metadataJson, {
    status: "accepted",
    env: config.env,
    source: options.source,
    periodo: options.periodo,
    clienteId: options.clienteId,
    externalReference: prepared.externalReference,
    ptoVta: prepared.voucher.PtoVta,
    cbteTipo: prepared.voucher.CbteTipo,
    cbteDesde: detail?.CbteDesde,
    cbteHasta: detail?.CbteHasta,
    cae: result.cae,
    caeFchVto: result.caeFchVto,
    pdf: paths.pdf,
  });

  return { result, detail, paths, pdfData };
}

export async function renderExistingPdf(options: {
  periodo: string;
  clienteId: string;
  env?: ArcaEnvironment;
  config?: ArcaConfig;
}) {
  const config = options.config ?? getConfig({ requireCredentials: false });
  const env = options.env ?? config.env;
  const paths = invoiceOutPaths(options.periodo, options.clienteId, env);
  if (!existsSync(paths.requestJson)) throw new Error(`No existe ${paths.requestJson}`);
  if (!existsSync(paths.responseJson)) throw new Error(`No existe ${paths.responseJson}`);

  const request = readJson<{
    env?: ArcaEnvironment;
    production?: boolean;
    source?: Source;
    externalReference?: string;
    pdfBase: PreparedInvoice["pdfBase"];
  }>(paths.requestJson);
  const result = readJson<ICreateVoucherResult>(paths.responseJson);
  if (!accepted(result)) {
    throw new Error(`El response no está aceptado por ARCA. Revisar ${paths.responseJson}`);
  }

  const homologacion = env !== "prod" && request.production !== true;
  const pdfData = invoiceDataFromBase(request.pdfBase, result, { homologacion });
  const pdf = await generateInvoicePdf(pdfData, { homologacion });
  writeBuffer(paths.pdf, pdf);

  const detail = getDetail(result);
  writeJson(paths.metadataJson, {
    status: "accepted",
    env,
    source: request.source,
    periodo: options.periodo,
    clienteId: options.clienteId,
    externalReference: request.externalReference,
    ptoVta: pdfData.puntoVenta,
    cbteTipo: pdfData.cbteTipo,
    cbteDesde: detail?.CbteDesde,
    cbteHasta: detail?.CbteHasta,
    cae: result.cae,
    caeFchVto: result.caeFchVto,
    pdf: paths.pdf,
    renderedFromExistingResponse: true,
  });

  return { result, detail, paths, pdfData };
}
