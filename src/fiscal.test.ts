import assert from "node:assert/strict";
import test from "node:test";
import {
  alertLevel,
  buildFiscalReport,
  categoryTableFor,
  evaluateRecategorizationParameters,
  dedupeVouchers,
  parsePortalRows,
  parsePaymentLedgerRows,
  reconcilePaymentLedger,
  reconcileVouchersWithFinance,
  rollingTwelveMonthStart,
  suggestedCategory,
  monotributoDueDate,
  nextRecategorizationWindow,
  validateRecategorizationParameters,
  validateCcmaSnapshot,
  validateFinanceSummary,
  type NormalizedVoucher,
} from "./fiscal.js";

function voucher(overrides: Partial<NormalizedVoucher> = {}): NormalizedVoucher {
  return {
    salesPoint: 2,
    voucherType: 11,
    voucherNumber: 1,
    issuedOn: "2026-09-01",
    currency: "PES",
    currencyRate: 1,
    totalOriginal: 100_000,
    totalArs: 100_000,
    effect: 1,
    source: "arca_wsfe",
    ...overrides,
  };
}

test("calcula una ventana móvil inclusiva de doce meses", () => {
  assert.equal(rollingTwelveMonthStart("2026-09-10"), "2025-09-11");
  assert.equal(rollingTwelveMonthStart("2024-02-29"), "2023-03-02");
});

test("selecciona la tabla según su vigencia", () => {
  assert.equal(categoryTableFor("2026-07-31").thresholds[1].grossIncomeCapArs, 15_058_447.71);
  assert.equal(categoryTableFor("2026-08-01").thresholds[1].grossIncomeCapArs, 17_595_182.74);
});

test("sugiere categoría en los bordes y exclusión sobre K", () => {
  assert.equal(suggestedCategory(12_009_410.45, "2026-09-10"), "A");
  assert.equal(suggestedCategory(12_009_410.46, "2026-09-10"), "B");
  assert.equal(suggestedCategory(126_610_838.76, "2026-09-10"), "EXCLUDED");
});

test("aplica semáforos en los umbrales acordados", () => {
  assert.equal(alertLevel(69.99), "green");
  assert.equal(alertLevel(70), "attention");
  assert.equal(alertLevel(85), "warning");
  assert.equal(alertLevel(95), "critical");
  assert.equal(alertLevel(100), "exceeded");
});

test("mueve el vencimiento del día 20 por fin de semana y feriados declarados", () => {
  assert.equal(monotributoDueDate("2026-09"), "2026-09-21");
  assert.equal(monotributoDueDate("2026-09", ["2026-09-21"]), "2026-09-22");
});

test("calcula la próxima ventana semestral de recategorización", () => {
  assert.deepEqual(nextRecategorizationWindow("2026-09-10"), {
    month: "february",
    deadline: "2027-02-05",
    measurementPeriod: { from: "2026-02-01", to: "2027-01-31" },
  });
  assert.equal(nextRecategorizationWindow("2027-02-05").deadline, "2027-02-05");
  assert.deepEqual(nextRecategorizationWindow("2027-02-06").measurementPeriod, {
    from: "2026-08-01",
    to: "2027-07-31",
  });
});

test("valida parámetros declarados sin convertir faltantes en cero", () => {
  const parameters = validateRecategorizationParameters({
    activity: "services",
    activityStartedOn: null,
    surfaceParameterApplies: false,
    affectedSurfaceM2: null,
    annualElectricEnergyKwh: 0,
    annualRentArs: 0,
    maximumUnitPriceArs: null,
    excludedActivityDetected: false,
  });
  assert.equal(parameters.affectedSurfaceM2, null);
  assert.throws(() => validateRecategorizationParameters({ ...parameters, annualRentArs: -1 }));
});

test("elige la categoría más alta entre ingresos y parámetros aplicables", () => {
  const evaluation = evaluateRecategorizationParameters(1_000_000, {
    activity: "services",
    activityStartedOn: "2020-01-01",
    surfaceParameterApplies: true,
    affectedSurfaceM2: 50,
    annualElectricEnergyKwh: 4_000,
    annualRentArs: 1_000_000,
    maximumUnitPriceArs: null,
    excludedActivityDetected: false,
  }, "2026-09-10");
  assert.equal(evaluation.suggestedCategoryWhenComplete, "C");
  assert.deepEqual(evaluation.limitingParameters, ["affectedSurfaceM2"]);
  assert.deepEqual(evaluation.missingParameters, []);
});

test("ignora precio unitario para servicios y detecta exclusión por parámetros", () => {
  const serviceParameters = {
    activity: "services",
    activityStartedOn: "2020-01-01",
    surfaceParameterApplies: false,
    affectedSurfaceM2: null,
    annualElectricEnergyKwh: 0,
    annualRentArs: 0,
    maximumUnitPriceArs: null,
    excludedActivityDetected: false,
  } as const;
  const services = evaluateRecategorizationParameters(1_000_000, serviceParameters, "2026-09-10");
  assert.equal(services.suggestedCategoryWhenComplete, "A");
  const goods = evaluateRecategorizationParameters(1_000_000, {
    ...serviceParameters,
    activity: "sale_of_goods",
    maximumUnitPriceArs: 716_840.78,
  }, "2026-09-10");
  assert.equal(goods.suggestedCategoryWhenComplete, "EXCLUDED");
});

test("valida snapshots CCMA sin convertir faltantes en cero", () => {
  assert.equal(validateCcmaSnapshot({
    schema_version: 1,
    checked_at: "2026-09-10T12:00:00Z",
    period: "2026-09",
    debt_capital_ars: null,
    debt_interest_ars: null,
    credit_balance_ars: null,
    last_payment_applied_on: null,
    last_payment_period: null,
    automatic_debit: "unknown",
    source: "arca_ccma",
  }).debt_capital_ars, null);
});

test("distingue CCMA fresco sin deuda de un snapshot vencido", () => {
  const baseCcma = {
    schema_version: 1,
    period: "2026-09",
    debt_capital_ars: 0,
    debt_interest_ars: 0,
    credit_balance_ars: 0,
    last_payment_applied_on: "2026-09-08",
    last_payment_period: "2026-09",
    automatic_debit: "active" as const,
    source: "arca_ccma" as const,
  };
  const fresh = buildFiscalReport({
    asOf: "2026-09-10",
    vouchers: [],
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    ccma: { ...baseCcma, checked_at: "2026-09-10T12:00:00Z" },
  });
  assert.equal(fresh.ccmaAssessment.status, "no-debt-verified");
  assert.equal(fresh.obligations.monotributo.paymentStatus, "applied");
  const stale = buildFiscalReport({
    asOf: "2026-09-10",
    vouchers: [],
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    ccma: { ...baseCcma, checked_at: "2026-08-31T12:00:00Z" },
  });
  assert.equal(stale.ccmaAssessment.status, "stale");
  assert.ok(stale.sources.missing.includes("arca_ccma_fresh_snapshot"));
  assert.notEqual(stale.obligations.monotributo.paymentStatus, "applied");
});

test("no habilita un borrador de VEP sin detalle conciliado por período y concepto", () => {
  const ccma = {
    schema_version: 1,
    checked_at: "2026-09-10T12:00:00Z",
    period: "2026-09",
    debt_capital_ars: 1000,
    debt_interest_ars: 100,
    credit_balance_ars: 0,
    last_payment_applied_on: null,
    last_payment_period: null,
    automatic_debit: "inactive" as const,
    source: "arca_ccma" as const,
  };
  const incomplete = buildFiscalReport({
    asOf: "2026-09-10",
    vouchers: [],
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    ccma,
  });
  assert.equal(incomplete.obligations.vepDraft?.status, "blocked-by-missing-debt-detail");
  const complete = buildFiscalReport({
    asOf: "2026-09-10",
    vouchers: [],
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    ccma: {
      ...ccma,
      debt_items: [{ period: "2026-08", concept: "Monotributo", capital_ars: 1000, interest_ars: 100 }],
    },
  });
  assert.equal(complete.obligations.vepDraft?.status, "requires-explicit-confirmation");
  assert.equal(complete.obligations.vepDraft?.detailTotalArs, 1100);
});

test("valida cobertura y privacidad estructural del resumen financiero", () => {
  const finance = validateFinanceSummary({
    schema_version: 2,
    generated_at: "2026-09-10T12:00:00Z",
    period: { from: "2026-09-01", to: "2026-09-10" },
    currency: "ARS",
    observed: {
      business_income: 0, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 100,
    },
    counts: {
      business_income: 0, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 1,
    },
    unsupported_currencies: {},
    reconciliation_candidates: [
      { candidate_id: "0123456789abcdef", occurred_on: "2026-09-02", amount_ars: 100, bucket: "unreviewed" },
    ],
    source: "finance_export",
    classification_rule: "test",
  });
  const report = buildFiscalReport({
    asOf: "2026-09-10",
    vouchers: [],
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    finance,
  });
  assert.equal(report.financeCoverage?.complete, false);
  assert.ok(report.sources.missing.includes("finance_export_period"));
  assert.throws(() => validateFinanceSummary({
    ...finance,
    reconciliation_candidates: [{ candidate_id: "raw-bank-id", occurred_on: "2026-09-02", amount_ars: 100, bucket: "unreviewed" }],
  }));
});

test("deduplica por punto, tipo y número prefiriendo ARCA", () => {
  const rows = dedupeVouchers([
    voucher({ source: "portal_export", totalArs: 99_000 }),
    voucher({ source: "arca_wsfe", totalArs: 100_000 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "arca_wsfe");
  assert.equal(rows[0].totalArs, 100_000);
});

test("concilia depósitos anonimizados uno a uno sin tratarlos como prueba de cobro", () => {
  const reconciliation = reconcileVouchersWithFinance([
    voucher({ voucherNumber: 1, issuedOn: "2026-09-01", totalArs: 100_000 }),
    voucher({ voucherNumber: 2, issuedOn: "2026-09-02", totalArs: 100_000 }),
    voucher({ voucherType: 13, voucherNumber: 3, issuedOn: "2026-09-02", totalArs: 20_000, effect: -1 }),
  ], {
    schema_version: 2,
    generated_at: "2026-09-10T12:00:00Z",
    period: { from: "2026-09-01", to: "2026-09-10" },
    currency: "ARS",
    observed: {
      business_income: 100_000, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 99_999,
    },
    counts: {
      business_income: 1, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 1,
    },
    unsupported_currencies: {},
    reconciliation_candidates: [
      { candidate_id: "a", occurred_on: "2026-09-03", amount_ars: 100_000, bucket: "business_income" },
      { candidate_id: "b", occurred_on: "2026-09-04", amount_ars: 99_999, bucket: "unreviewed" },
    ],
    source: "finance_export",
    classification_rule: "test",
  });
  assert.equal(reconciliation.status, "available");
  assert.equal(reconciliation.matches.length, 2);
  assert.deepEqual(reconciliation.unmatchedVoucherKeys, []);
  assert.equal(reconciliation.matches[0].candidateId, "a");
  assert.match(reconciliation.caveat, /no prueba cobro/);
});

test("marca conciliación no disponible para exports agregados anteriores", () => {
  const reconciliation = reconcileVouchersWithFinance([voucher()], null);
  assert.equal(reconciliation.status, "unavailable");
  assert.deepEqual(reconciliation.unmatchedVoucherKeys, ["2:11:1"]);
});

test("importa formatos habituales del portal", () => {
  const rows = parsePortalRows([{
    "Fecha Emisión": "31/08/2026",
    "Tipo Comprobante": "13 - Nota de Crédito C",
    "Comprobante": "00001-00000053",
    "Importe Total": "1.234.567,89",
    "Moneda": "ARS",
  }]);
  assert.deepEqual(rows[0], {
    salesPoint: 1,
    voucherType: 13,
    voucherNumber: 53,
    issuedOn: "2026-08-31",
    currency: "PES",
    currencyRate: 1,
    totalOriginal: 1_234_567.89,
    totalArs: 1_234_567.89,
    effect: -1,
    source: "portal_export",
  });
});

test("agrupa cuotas de una misma cobranza sin exponer cliente_id", () => {
  const ledger = parsePaymentLedgerRows([
    { periodo: "2026-02", cliente_id: "cliente-privado", estado: "pagado", fecha_pago: "12/06/2026", importe: "ARS 15.000" },
    { periodo: "2026-03", cliente_id: "cliente-privado", estado: "pagado", fecha_pago: "12/06/2026", importe: "ARS 15.000" },
    { periodo: "2026-04", cliente_id: "cliente-privado", estado: "pagado", fecha_pago: "", importe: "ARS 15.000" },
  ], "2026-09-11T12:00:00Z");
  assert.equal(ledger.groups.length, 1);
  assert.equal(ledger.groups[0].amountArs, 30_000);
  assert.deepEqual(ledger.groups[0].allocatedPeriods, ["2026-02", "2026-03"]);
  assert.equal(ledger.excluded.missingPaymentDate, 1);
  assert.equal(JSON.stringify(ledger).includes("cliente-privado"), false);
});

test("triangula una cobranza agrupada con un depósito anonimizado", () => {
  const ledger = parsePaymentLedgerRows([
    { periodo: "2026-02", cliente_id: "cliente-privado", estado: "pagado", fecha_pago: "2026-06-12", importe: "ARS 15000" },
    { periodo: "2026-03", cliente_id: "cliente-privado", estado: "pagado", fecha_pago: "2026-06-12", importe: "ARS 15000" },
  ], "2026-09-11T12:00:00Z");
  const finance = validateFinanceSummary({
    schema_version: 2,
    generated_at: "2026-09-11T12:00:00Z",
    period: { from: "2026-01-01", to: "2026-09-10" },
    currency: "ARS",
    observed: {
      business_income: 0, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 30_000,
    },
    counts: {
      business_income: 0, personal_income: 0, business_expenses: 0, personal_expenses: 0,
      internal_transfers: 0, excluded: 0, unreviewed: 1,
    },
    unsupported_currencies: {},
    reconciliation_candidates: [
      { candidate_id: "0123456789abcdef", occurred_on: "2026-06-12", amount_ars: 30_000, bucket: "unreviewed" },
    ],
    source: "finance_export",
    classification_rule: "test",
  });
  const reconciliation = reconcilePaymentLedger(ledger, finance);
  assert.equal(reconciliation.status, "available");
  assert.equal(reconciliation.matches.length, 1);
  assert.equal(reconciliation.confirmedBusinessIncomeArs, 30_000);
  assert.equal(reconciliation.unmatchedGroupCount, 0);
});

test("el reporte suma facturas y débitos, resta créditos y marca fuentes faltantes", () => {
  const report = buildFiscalReport({
    asOf: "2026-09-10",
    currentCategory: "B",
    sourceStatus: { arcaWsfe: true, portalPoint1: false },
    generatedAt: "2026-09-10T12:00:00Z",
    vouchers: [
      voucher({ voucherNumber: 1, totalArs: 1_000_000 }),
      voucher({ voucherType: 12, voucherNumber: 2, totalArs: 100_000 }),
      voucher({ voucherType: 13, voucherNumber: 3, totalArs: 250_000, effect: -1 }),
      voucher({ voucherNumber: 4, issuedOn: "2025-09-10", totalArs: 9_000_000 }),
    ],
  });
  assert.equal(report.income.observedArs, 850_000);
  assert.equal(report.income.voucherCount, 3);
  assert.equal(report.status, "incomplete");
  assert.ok(report.sources.missing.includes("portal_point_1"));
  assert.equal(report.monotributo.evaluatedAgainstCategory, "B");
  assert.equal(report.monotributo.suggestedByGrossIncome, null);
  assert.equal(report.monotributo.usagePercent, null);
  assert.equal(report.monotributo.alert, "unknown");
  assert.equal(report.income.projectedAnnualRunRateArs, null);
  assert.equal(report.recategorization.recommendationStatus, "blocked-by-missing-evidence");
  assert.equal(report.recategorization.window.deadline, "2027-02-05");
  assert.ok(report.recategorization.missingParameters.includes("activity"));
});

test("mantiene el expediente en monitoreo hasta que cierre el período de medición", () => {
  const report = buildFiscalReport({
    asOf: "2026-09-10",
    currentCategory: "B",
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    vouchers: [voucher()],
    recategorizationParameters: {
      activity: "services",
      activityStartedOn: "2020-01-01",
      surfaceParameterApplies: false,
      affectedSurfaceM2: 0,
      annualElectricEnergyKwh: 0,
      annualRentArs: 0,
      maximumUnitPriceArs: 0,
      excludedActivityDetected: false,
    },
  });
  assert.equal(report.recategorization.recommendationStatus, "monitoring-incomplete-window");
  assert.equal(report.recategorization.filingNeed, "monitoring-incomplete-window");
  assert.equal(report.recategorization.evidence.measurementPeriodComplete, false);
  assert.equal(report.recategorization.indicativeCategoryByCurrentGrossIncomeTable, "A");
  assert.deepEqual(report.recategorization.missingParameters, []);
});

test("calcula la recategorización con la ventana oficial y recién entonces habilita revisión", () => {
  const report = buildFiscalReport({
    asOf: "2027-02-05",
    currentCategory: "B",
    sourceStatus: { arcaWsfe: true, portalPoint1: true },
    sourceEvidence: {
      arcaWsfe: { generatedAt: "2027-02-05T12:00:00Z", period: { from: "2026-02-01", to: "2027-02-05" }, environment: "prod" },
      portalPoint1: { generatedAt: "2027-02-05T12:00:00Z", period: { from: "2026-02-01", to: "2027-02-05" } },
    },
    vouchers: [
      voucher({ issuedOn: "2026-02-01", totalArs: 10_000_000 }),
      voucher({ voucherNumber: 2, issuedOn: "2027-02-01", totalArs: 99_000_000 }),
    ],
    recategorizationParameters: {
      activity: "services",
      activityStartedOn: "2020-01-01",
      surfaceParameterApplies: false,
      affectedSurfaceM2: null,
      annualElectricEnergyKwh: 0,
      annualRentArs: 0,
      maximumUnitPriceArs: null,
      excludedActivityDetected: false,
    },
  });
  assert.equal(report.recategorization.recommendationStatus, "ready-for-human-review");
  assert.equal(report.recategorization.evidence.measurementPeriodComplete, true);
  assert.equal(report.recategorization.evidence.grossIncomeArs, 10_000_000);
  assert.equal(report.recategorization.evidence.voucherCount, 1);
});
