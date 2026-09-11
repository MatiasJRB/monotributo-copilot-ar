import path from "node:path";
import type { InvoiceData } from "@arcasdk/pdf";
import { REPO_ROOT, type ArcaConfig } from "./config.js";
import { readCsv, type CsvRow } from "./csv.js";
import { periodBounds, todayArca } from "./dates.js";
import { comprobanteFromText, condicionIvaId, documentForCuit } from "./mappings.js";

export type Source = "dev" | "real";

export type ArcaVoucher = {
  CantReg: number;
  PtoVta: number;
  CbteTipo: number;
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteFch: string;
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpIVA: number;
  ImpTrib: number;
  FchServDesde?: string;
  FchServHasta?: string;
  FchVtoPago?: string;
  MonId: string;
  MonCotiz: number;
  CanMisMonExt?: string;
  CondicionIVAReceptorId: number;
};

export type PreparedInvoice = {
  source: Source;
  periodo: string;
  clienteId: string;
  externalReference: string;
  row: CsvRow;
  voucher: ArcaVoucher;
  pdfBase: Omit<InvoiceData, "cae" | "caeFechaVencimiento" | "cbteDesde" | "cbteHasta">;
};

export function invoicePreview(prepared: PreparedInvoice) {
  const item = prepared.pdfBase.items[0];
  const vencimientoArca = prepared.voucher.FchVtoPago || "";
  const vencimiento = vencimientoArca
    ? `${vencimientoArca.slice(0, 4)}-${vencimientoArca.slice(4, 6)}-${vencimientoArca.slice(6, 8)}`
    : "";
  const vencimientoOriginal = prepared.row.vencimiento;
  return {
    periodo: prepared.periodo,
    clienteId: prepared.clienteId,
    razonSocial: prepared.pdfBase.receptor.razonSocial,
    documentoTipo: prepared.pdfBase.receptor.documentoTipo,
    documentoNro: prepared.pdfBase.receptor.documentoNro,
    condicionIva: prepared.pdfBase.receptor.condicionIva,
    comprobante: `${prepared.pdfBase.cbteDescripcion} ${prepared.pdfBase.cbteLetra}`,
    descripcion: item?.descripcion,
    importeTotal: prepared.pdfBase.importeTotal,
    moneda: prepared.pdfBase.moneda,
    vencimiento,
    vencimientoOriginal,
    vencimientoAjustado: Boolean(vencimientoOriginal && vencimiento !== vencimientoOriginal),
    emailFacturacion: prepared.row.email_facturacion || "",
  };
}

function required(row: CsvRow, field: string): string {
  const value = (row[field] || "").trim();
  if (!value) throw new Error(`Falta ${field} para cliente ${row.cliente_id || "?"}`);
  return value;
}

export function parseAmount(value: string): number {
  const raw = String(value).trim().replace(/\s/g, "");
  if (!raw) throw new Error("Monto vacío");

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = raw.split(separator);
    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const decimals = parts[1]?.length ?? 0;
      normalized = decimals >= 1 && decimals <= 2 ? `${parts[0]}.${parts[1]}` : parts.join("");
    }
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) throw new Error(`Monto inválido: ${value}`);
  return Math.round(num * 100) / 100;
}

export function normalizePaymentDueDate(value: string, cbteFch: string): string {
  const dueDate = value.trim().replace(/-/g, "");
  if (!/^\d{8}$/.test(dueDate)) throw new Error(`Fecha de vencimiento inválida: ${value}`);
  if (!/^\d{8}$/.test(cbteFch)) throw new Error(`Fecha de comprobante inválida: ${cbteFch}`);
  // WSFE error 10036: para servicios, FchVtoPago no puede preceder CbteFch.
  return dueDate < cbteFch ? cbteFch : dueDate;
}

export function sourceFile(periodo: string, source: Source): string {
  return path.join(REPO_ROOT, "data", "billing", periodo, source === "dev" ? "facturacion_dev.csv" : "facturas_a_emitir.csv");
}

export function listBillingRows(periodo: string, source: Source): CsvRow[] {
  return readCsv(sourceFile(periodo, source));
}

export function loadBillingRow(periodo: string, clienteId: string, source: Source): CsvRow {
  const file = sourceFile(periodo, source);
  const rows = readCsv(file);
  const row = rows.find((item) => (item.cliente_id || "").trim() === clienteId);
  if (!row) throw new Error(`No encontré ${clienteId} en ${file}. Prepará primero el CSV de entrada.`);
  return row;
}

export function prepareFromBillingRow(row: CsvRow, config: ArcaConfig, source: Source): PreparedInvoice {
  const periodo = required(row, "periodo");
  const clienteId = required(row, "cliente_id");
  const comprobante = comprobanteFromText(row.comprobante_tipo || "Factura C");
  const total = parseAmount(required(row, "monto"));
  const doc = documentForCuit(row.cuit || "");
  if (doc.DocTipo === 80 && doc.DocNro === config.cuit) {
    throw new Error(`El receptor no puede tener el mismo CUIT que el emisor (${config.cuit}). Para homologación usá un cliente real distinto o Consumidor Final.`);
  }
  const condicionId = condicionIvaId(row.condicion_iva || (doc.DocTipo === 99 ? "Consumidor Final" : "Monotributo"));
  const cbteFch = todayArca();
  const vencimiento = normalizePaymentDueDate(required(row, "vencimiento"), cbteFch);
  const { desde, hasta } = periodBounds(periodo);
  const descripcion = required(row, "descripcion");
  const concepto = 2; // servicios
  const requestedCurrency = (row.moneda || "ARS").trim().toUpperCase();
  if (!["ARS", "PES"].includes(requestedCurrency)) {
    throw new Error("Por seguridad, el MVP solo emite en pesos. La moneda extranjera requiere cotización ARCA y un flujo separado.");
  }
  const moneda = "PES";
  const cotizacion = 1;

  // Monotributo / Factura C: sin IVA discriminado. Para A/B se deberá extender mapping.
  if (comprobante.codigo !== 11) {
    throw new Error(`Por ahora el microservicio está preparado para Factura C. Recibido: ${row.comprobante_tipo}`);
  }

  const voucher: ArcaVoucher = {
    CantReg: 1,
    PtoVta: config.puntoVenta,
    CbteTipo: comprobante.codigo,
    Concepto: concepto,
    DocTipo: doc.DocTipo,
    DocNro: doc.DocNro,
    CbteFch: cbteFch,
    ImpTotal: total,
    ImpTotConc: 0,
    ImpNeto: total,
    ImpOpEx: 0,
    ImpIVA: 0,
    ImpTrib: 0,
    FchServDesde: desde,
    FchServHasta: hasta,
    FchVtoPago: vencimiento,
    MonId: moneda,
    MonCotiz: cotizacion,
    CanMisMonExt: "N",
    CondicionIVAReceptorId: condicionId,
  };

  const pdfBase: PreparedInvoice["pdfBase"] = {
    emisor: config.emisor,
    receptor: {
      razonSocial: required(row, "razon_social"),
      domicilio: row.domicilio_fiscal || "",
      condicionIva: row.condicion_iva || "Consumidor Final",
      documentoTipo: doc.documentoTipo,
      documentoNro: doc.documentoNro,
    },
    cbteTipo: comprobante.codigo,
    cbteDescripcion: comprobante.descripcion,
    cbteLetra: comprobante.letra,
    puntoVenta: config.puntoVenta,
    cbteFecha: voucher.CbteFch,
    concepto,
    moneda,
    cotizacion,
    condicionVenta: "Cuenta corriente",
    fechaServicioDesde: desde,
    fechaServicioHasta: hasta,
    fechaVtoPago: vencimiento,
    items: [
      {
        codigo: clienteId,
        descripcion,
        cantidad: 1,
        unidadMedida: "servicio",
        precioUnitario: total,
        subtotal: total,
      },
    ],
    importeNetoGravado: total,
    importeIva: 0,
    importeTotal: total,
    observaciones: row.notas || undefined,
  };

  return {
    source,
    periodo,
    clienteId,
    externalReference: `monotributo-copilot-ar-${clienteId}-${periodo}`,
    row,
    voucher,
    pdfBase,
  };
}

export function loadPreparedInvoice(periodo: string, clienteId: string, source: Source, config: ArcaConfig): PreparedInvoice {
  return prepareFromBillingRow(loadBillingRow(periodo, clienteId, source), config, source);
}
