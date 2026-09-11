import assert from "node:assert/strict";
import test from "node:test";
import type { ArcaConfig } from "./config.js";
import { invoicePreview, normalizePaymentDueDate, parseAmount, prepareFromBillingRow } from "./billing.js";

const config: ArcaConfig = {
  env: "homo",
  production: false,
  cuit: 20000000001,
  puntoVenta: 2,
  cert: "",
  key: "",
  ticketPath: "./tickets/test",
  useHttpsAgent: false,
  serviceHost: "127.0.0.1",
  servicePort: 8787,
  serviceToken: "test",
  emisor: {
    razonSocial: "Emisor de prueba",
    domicilioComercial: "Calle 123",
    condicionIva: "Monotributo",
    cuit: "20000000001",
    iibb: "-",
    fechaInicioActividades: "20200101",
    contacto: "",
  },
};

const row = {
  periodo: "2026-08",
  cliente_id: "cliente-test",
  razon_social: "Cliente de prueba",
  cuit: "20-99999999-9",
  condicion_iva: "Responsable Inscripto",
  domicilio_fiscal: "Calle 456",
  email_facturacion: "facturacion@example.com",
  comprobante_tipo: "Factura C",
  concepto: "Servicios",
  descripcion: "Servicios profesionales",
  monto: "1.234.567,89",
  moneda: "ARS",
  vencimiento: "2026-09-10",
  notas: "",
};

test("parseAmount acepta formatos argentinos y decimales simples", () => {
  assert.equal(parseAmount("1.234.567,89"), 1234567.89);
  assert.equal(parseAmount("1234567.89"), 1234567.89);
  assert.equal(parseAmount("1,234,567.89"), 1234567.89);
  assert.equal(parseAmount("532000"), 532000);
});

test("ajusta un vencimiento histórico a la fecha del comprobante", () => {
  assert.equal(normalizePaymentDueDate("2026-08-10", "20260828"), "20260828");
  assert.equal(normalizePaymentDueDate("2026-09-10", "20260828"), "20260910");
});

test("el preview distingue el vencimiento original del enviado a ARCA", () => {
  const prepared = prepareFromBillingRow({ ...row, vencimiento: "2020-01-01" }, config, "real");
  const preview = invoicePreview(prepared);
  assert.equal(preview.vencimiento, `${prepared.voucher.CbteFch.slice(0, 4)}-${prepared.voucher.CbteFch.slice(4, 6)}-${prepared.voucher.CbteFch.slice(6, 8)}`);
  assert.equal(preview.vencimientoOriginal, "2020-01-01");
  assert.equal(preview.vencimientoAjustado, true);
});

test("prepara una Factura C de servicios en pesos sin IVA discriminado", () => {
  const prepared = prepareFromBillingRow(row, config, "real");
  assert.equal(prepared.voucher.CbteTipo, 11);
  assert.equal(prepared.voucher.Concepto, 2);
  assert.equal(prepared.voucher.ImpTotal, 1234567.89);
  assert.equal(prepared.voucher.ImpIVA, 0);
  assert.equal(prepared.voucher.MonId, "PES");
  assert.equal(prepared.voucher.CondicionIVAReceptorId, 1);
});

test("bloquea moneda extranjera hasta implementar la cotización ARCA", () => {
  assert.throws(
    () => prepareFromBillingRow({ ...row, moneda: "USD" }, config, "real"),
    /solo emite en pesos/,
  );
});

test("bloquea receptor con el mismo CUIT del emisor", () => {
  assert.throws(
    () => prepareFromBillingRow({ ...row, cuit: "20-00000000-1" }, config, "real"),
    /mismo CUIT/,
  );
});
