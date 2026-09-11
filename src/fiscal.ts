import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createArca } from "./arcaClient.js";
import { parseAmount } from "./billing.js";
import type { ArcaConfig } from "./config.js";
import { readCsv, type CsvRow } from "./csv.js";

export const FISCAL_SCHEMA_VERSION = 1;
export const FISCAL_SOURCE_URL = "https://www.arca.gob.ar/monotributo/categorias.asp";

export type MonotributoCategory = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";
export type FiscalSource = "arca_wsfe" | "portal_export";
export type FiscalPeriod = { from: string; to: string };

export type NormalizedVoucher = {
  salesPoint: number;
  voucherType: 11 | 12 | 13;
  voucherNumber: number;
  issuedOn: string;
  currency: string;
  currencyRate: number;
  totalOriginal: number;
  totalArs: number;
  effect: 1 | -1;
  source: FiscalSource;
};

export type ArcaHistoryBundle = {
  schema_version: 1;
  source: "arca_wsfe";
  generated_at: string;
  environment: "homo" | "prod";
  period: FiscalPeriod;
  sales_point: number;
  voucher_types: Array<11 | 12 | 13>;
  vouchers: NormalizedVoucher[];
};

export type FinanceSummary = {
  schema_version: number;
  generated_at: string;
  period: { from: string; to: string };
  currency: string;
  observed: {
    business_income: number;
    personal_income: number;
    business_expenses: number;
    personal_expenses: number;
    internal_transfers: number;
    excluded: number;
    unreviewed: number;
  };
  counts: {
    business_income: number;
    personal_income: number;
    business_expenses: number;
    personal_expenses: number;
    internal_transfers: number;
    excluded: number;
    unreviewed: number;
  };
  unsupported_currencies: Record<string, number>;
  reconciliation_candidates?: Array<{
    candidate_id: string;
    occurred_on: string;
    amount_ars: number;
    bucket: "business_income" | "unreviewed";
  }>;
  source: "finance_export";
  classification_rule: string;
};

const FINANCE_BUCKETS = [
  "business_income",
  "personal_income",
  "business_expenses",
  "personal_expenses",
  "internal_transfers",
  "excluded",
  "unreviewed",
] as const;

export type FinanceReconciliation = {
  status: "available" | "unavailable";
  matches: Array<{
    voucherKey: string;
    candidateId: string;
    amountArs: number;
    daysFromIssue: number;
    candidateBucket: "business_income" | "unreviewed";
  }>;
  unmatchedVoucherKeys: string[];
  unusedCandidateCount: number;
  unusedCandidateAmountArs: number;
  caveat: string;
};

export type PaymentLedgerGroup = {
  clientHash: string;
  paidOn: string;
  amountArs: number;
  allocatedPeriods: string[];
  rowCount: number;
};

export type PaymentLedgerImport = {
  schema_version: 1;
  source: "payment_ledger";
  generated_at: string;
  period: FiscalPeriod | null;
  groups: PaymentLedgerGroup[];
  excluded: { missingPaymentDate: number; unsupportedCurrency: number; notPaid: number };
};

export type CcmaSnapshot = {
  schema_version: number;
  checked_at: string;
  period?: string;
  debt_capital_ars: number | null;
  debt_interest_ars: number | null;
  credit_balance_ars: number | null;
  last_payment_applied_on: string | null;
  last_payment_period: string | null;
  automatic_debit: "active" | "inactive" | "unknown";
  debt_items?: Array<{
    period: string;
    concept: string;
    capital_ars: number;
    interest_ars: number;
  }>;
  source: "arca_ccma";
  notes?: string;
};

export type CategoryThreshold = {
  category: MonotributoCategory;
  grossIncomeCapArs: number;
  affectedSurfaceCapM2: number;
  annualElectricEnergyCapKwh: number;
  annualRentCapArs: number;
  maximumUnitPriceArs: number;
};

export type CategoryTable = {
  validFrom: string;
  validTo: string | null;
  sourceUrl: string;
  thresholds: CategoryThreshold[];
};

const SURFACE_CAPS = [30, 45, 60, 85, 110, 150, 200, 200, 200, 200, 200];
const ENERGY_CAPS = [3_330, 5_000, 6_700, 10_000, 13_000, 16_500, 20_000, 20_000, 20_000, 20_000, 20_000];

function categoryThresholds(
  grossIncomeCaps: number[],
  annualRentCaps: number[],
  maximumUnitPriceArs: number,
): CategoryThreshold[] {
  const categories = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as MonotributoCategory[];
  if (grossIncomeCaps.length !== categories.length || annualRentCaps.length !== categories.length) {
    throw new Error("Tabla de categorías incompleta");
  }
  return categories.map((category, index) => ({
    category,
    grossIncomeCapArs: grossIncomeCaps[index],
    affectedSurfaceCapM2: SURFACE_CAPS[index],
    annualElectricEnergyCapKwh: ENERGY_CAPS[index],
    annualRentCapArs: annualRentCaps[index],
    maximumUnitPriceArs,
  }));
}

export type RecategorizationParameters = {
  activity: "services" | "sale_of_goods" | "mixed" | null;
  activityStartedOn: string | null;
  surfaceParameterApplies: boolean | null;
  affectedSurfaceM2: number | null;
  annualElectricEnergyKwh: number | null;
  annualRentArs: number | null;
  maximumUnitPriceArs: number | null;
  excludedActivityDetected: boolean | null;
  notes?: string;
};

export type RecategorizationWindow = {
  month: "february" | "august";
  deadline: string;
  measurementPeriod: { from: string; to: string };
};

export const CATEGORY_TABLES: CategoryTable[] = [
  {
    validFrom: "2026-02-01",
    validTo: "2026-07-31",
    sourceUrl: "https://www.arca.gob.ar/monotributo/documentos/categorias/monotributo-categorias-febrero-julio-2026.pdf",
    thresholds: categoryThresholds(
      [10_277_988.13, 15_058_447.71, 21_113_696.52, 26_212_853.42, 30_833_964.37, 38_642_048.36, 46_211_109.37, 70_113_407.33, 78_479_211.62, 89_872_640.30, 108_357_084.05],
      [2_390_229.80, 2_390_229.80, 3_266_647.39, 3_266_647.39, 4_143_064.98, 4_143_064.98, 4_939_808.23, 7_170_689.39, 7_170_689.39, 7_170_689.39, 7_170_689.39],
      613_492.31,
    ),
  },
  {
    validFrom: "2026-08-01",
    validTo: null,
    sourceUrl: FISCAL_SOURCE_URL,
    thresholds: categoryThresholds(
      [12_009_410.45, 17_595_182.74, 24_670_494.31, 30_628_651.43, 36_028_231.33, 45_151_659.41, 53_995_798.87, 81_924_660.37, 91_699_761.90, 105_012_519.20, 126_610_838.75],
      [2_792_886.15, 2_792_886.15, 3_816_944.41, 3_816_944.41, 4_841_002.66, 4_841_002.66, 5_771_964.69, 8_378_658.45, 8_378_658.45, 8_378_658.45, 8_378_658.45],
      716_840.77,
    ),
  },
];

const EFFECT_BY_TYPE: Record<number, 1 | -1> = { 11: 1, 12: 1, 13: -1 };
const TYPE_BY_NAME: Record<string, 11 | 12 | 13> = {
  "factura c": 11,
  "nota de debito c": 12,
  "nota debito c": 12,
  "nota de credito c": 13,
  "nota credito c": 13,
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requireIsoDate(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} debe usar YYYY-MM-DD`);
  }
  return value;
}

export function rollingTwelveMonthStart(asOf: string): string {
  requireIsoDate(asOf, "asOf");
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function categoryTableFor(asOf: string): CategoryTable {
  requireIsoDate(asOf, "asOf");
  const table = [...CATEGORY_TABLES]
    .reverse()
    .find((candidate) => candidate.validFrom <= asOf && (!candidate.validTo || candidate.validTo >= asOf));
  if (!table) throw new Error(`No hay tabla de monotributo versionada para ${asOf}`);
  return table;
}

export function suggestedCategory(totalArs: number, asOf: string): MonotributoCategory | "EXCLUDED" {
  const table = categoryTableFor(asOf);
  return table.thresholds.find((row) => totalArs <= row.grossIncomeCapArs)?.category ?? "EXCLUDED";
}

export function evaluateRecategorizationParameters(
  totalArs: number,
  parameters: RecategorizationParameters | null,
  asOf: string,
): {
  minimumCategoryFromKnownValues: MonotributoCategory | "EXCLUDED";
  suggestedCategoryWhenComplete: MonotributoCategory | "EXCLUDED" | null;
  limitingParameters: string[];
  missingParameters: string[];
} {
  const table = categoryTableFor(asOf);
  const categories = table.thresholds.map((row) => row.category);
  const evaluated: Array<{ name: string; category: MonotributoCategory | "EXCLUDED" }> = [
    { name: "grossIncomeArs", category: suggestedCategory(totalArs, asOf) },
  ];
  const missing: string[] = [];
  if (!parameters) {
    missing.push(
      "activity",
      "activityStartedOn",
      "surfaceParameterApplies",
      "affectedSurfaceM2",
      "annualElectricEnergyKwh",
      "annualRentArs",
      "maximumUnitPriceArs",
      "excludedActivityDetected",
    );
  } else {
    validateRecategorizationParameters(parameters);
    if (parameters.activity === null) missing.push("activity");
    if (parameters.activityStartedOn === null) missing.push("activityStartedOn");
    if (parameters.surfaceParameterApplies === null) missing.push("surfaceParameterApplies");
    if (parameters.excludedActivityDetected === null) missing.push("excludedActivityDetected");
    if (parameters.excludedActivityDetected === true) evaluated.push({ name: "excludedActivityDetected", category: "EXCLUDED" });
    const numericParameters: Array<{
      name: string;
      value: number | null;
      cap: keyof Pick<CategoryThreshold, "affectedSurfaceCapM2" | "annualElectricEnergyCapKwh" | "annualRentCapArs" | "maximumUnitPriceArs">;
      applies: boolean;
    }> = [
      { name: "affectedSurfaceM2", value: parameters.affectedSurfaceM2, cap: "affectedSurfaceCapM2", applies: parameters.surfaceParameterApplies === true },
      { name: "annualElectricEnergyKwh", value: parameters.annualElectricEnergyKwh, cap: "annualElectricEnergyCapKwh", applies: true },
      { name: "annualRentArs", value: parameters.annualRentArs, cap: "annualRentCapArs", applies: true },
      { name: "maximumUnitPriceArs", value: parameters.maximumUnitPriceArs, cap: "maximumUnitPriceArs", applies: parameters.activity === "sale_of_goods" || parameters.activity === "mixed" },
    ];
    for (const item of numericParameters) {
      if (!item.applies) continue;
      if (item.value === null) {
        missing.push(item.name);
        continue;
      }
      const category = table.thresholds.find((row) => item.value! <= row[item.cap])?.category ?? "EXCLUDED";
      evaluated.push({ name: item.name, category });
    }
  }
  const rank = (category: MonotributoCategory | "EXCLUDED") => category === "EXCLUDED" ? categories.length : categories.indexOf(category);
  const maxRank = Math.max(...evaluated.map((item) => rank(item.category)));
  const minimumCategoryFromKnownValues = maxRank >= categories.length ? "EXCLUDED" : categories[maxRank];
  return {
    minimumCategoryFromKnownValues,
    suggestedCategoryWhenComplete: missing.length ? null : minimumCategoryFromKnownValues,
    limitingParameters: evaluated.filter((item) => rank(item.category) === maxRank).map((item) => item.name),
    missingParameters: missing,
  };
}

export function alertLevel(usagePercent: number): "green" | "attention" | "warning" | "critical" | "exceeded" {
  if (usagePercent >= 100) return "exceeded";
  if (usagePercent >= 95) return "critical";
  if (usagePercent >= 85) return "warning";
  if (usagePercent >= 70) return "attention";
  return "green";
}

export function monotributoDueDate(yearMonth: string, holidays: string[] = []): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error("yearMonth debe usar YYYY-MM");
  let due = `${yearMonth}-20`;
  const holidaySet = new Set(holidays.map((value) => requireIsoDate(value, "holiday")));
  while ([0, 6].includes(new Date(`${due}T12:00:00Z`).getUTCDay()) || holidaySet.has(due)) {
    const date = new Date(`${due}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    due = date.toISOString().slice(0, 10);
  }
  return due;
}

export function nextRecategorizationWindow(asOf: string): RecategorizationWindow {
  requireIsoDate(asOf, "asOf");
  const year = Number(asOf.slice(0, 4));
  const candidates = [
    { month: "february" as const, deadline: `${year}-02-05`, measurementEnd: `${year}-01-31` },
    { month: "august" as const, deadline: `${year}-08-05`, measurementEnd: `${year}-07-31` },
    { month: "february" as const, deadline: `${year + 1}-02-05`, measurementEnd: `${year + 1}-01-31` },
  ];
  const candidate = candidates.find((item) => item.deadline >= asOf)!;
  const end = new Date(`${candidate.measurementEnd}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 11, 1);
  return {
    month: candidate.month,
    deadline: candidate.deadline,
    measurementPeriod: { from: start.toISOString().slice(0, 10), to: candidate.measurementEnd },
  };
}

function validateNullableNonNegative(value: number | null, name: string): number | null {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Parámetro de recategorización ${name} inválido`);
  }
  return value;
}

export function validateRecategorizationParameters(
  parameters: RecategorizationParameters,
): RecategorizationParameters {
  if (parameters.activity !== null && !["services", "sale_of_goods", "mixed"].includes(parameters.activity)) {
    throw new Error("Parámetro de recategorización activity inválido");
  }
  if (parameters.activityStartedOn !== null) requireIsoDate(parameters.activityStartedOn, "activityStartedOn");
  if (parameters.surfaceParameterApplies !== null && typeof parameters.surfaceParameterApplies !== "boolean") {
    throw new Error("Parámetro de recategorización surfaceParameterApplies inválido");
  }
  if (parameters.excludedActivityDetected !== null && typeof parameters.excludedActivityDetected !== "boolean") {
    throw new Error("Parámetro de recategorización excludedActivityDetected inválido");
  }
  validateNullableNonNegative(parameters.affectedSurfaceM2, "affectedSurfaceM2");
  validateNullableNonNegative(parameters.annualElectricEnergyKwh, "annualElectricEnergyKwh");
  validateNullableNonNegative(parameters.annualRentArs, "annualRentArs");
  validateNullableNonNegative(parameters.maximumUnitPriceArs, "maximumUnitPriceArs");
  return parameters;
}

export function validateCcmaSnapshot(snapshot: CcmaSnapshot): CcmaSnapshot {
  if (snapshot.schema_version !== 1) throw new Error("CCMA usa schema_version no soportada");
  if (snapshot.source !== "arca_ccma") throw new Error("CCMA source debe ser arca_ccma");
  if (Number.isNaN(Date.parse(snapshot.checked_at))) throw new Error("CCMA checked_at inválido");
  for (const [name, value] of Object.entries({
    debt_capital_ars: snapshot.debt_capital_ars,
    debt_interest_ars: snapshot.debt_interest_ars,
    credit_balance_ars: snapshot.credit_balance_ars,
  })) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`CCMA ${name} inválido`);
  }
  if (snapshot.last_payment_applied_on) requireIsoDate(snapshot.last_payment_applied_on, "last_payment_applied_on");
  if (snapshot.last_payment_period && !/^\d{4}-\d{2}$/.test(snapshot.last_payment_period)) {
    throw new Error("CCMA last_payment_period debe usar YYYY-MM");
  }
  if (!["active", "inactive", "unknown"].includes(snapshot.automatic_debit)) throw new Error("CCMA automatic_debit inválido");
  for (const item of snapshot.debt_items ?? []) {
    if (!/^\d{4}-\d{2}$/.test(item.period)) throw new Error("CCMA debt_items.period inválido");
    if (!item.concept.trim()) throw new Error("CCMA debt_items.concept vacío");
    validateNullableNonNegative(item.capital_ars, "debt_items.capital_ars");
    validateNullableNonNegative(item.interest_ars, "debt_items.interest_ars");
  }
  return snapshot;
}

export function validateFinanceSummary(summary: FinanceSummary): FinanceSummary {
  if (![1, 2].includes(summary.schema_version)) throw new Error("El resumen financiero usa schema_version no soportada");
  if (summary.source !== "finance_export") throw new Error("El resumen financiero source inválido");
  if (summary.currency !== "ARS") throw new Error("El resumen financiero debe exportar su agregado en ARS");
  if (Number.isNaN(Date.parse(summary.generated_at))) throw new Error("El resumen financiero generated_at inválido");
  requireIsoDate(summary.period.from, "finance.period.from");
  requireIsoDate(summary.period.to, "finance.period.to");
  if (summary.period.from > summary.period.to) throw new Error("El resumen financiero tiene un período invertido");
  for (const bucket of FINANCE_BUCKETS) {
    const observed = summary.observed[bucket];
    const count = summary.counts[bucket];
    if (!Number.isFinite(observed) || observed < 0) throw new Error(`El resumen financiero observed.${bucket} inválido`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`El resumen financiero counts.${bucket} inválido`);
  }
  for (const [currency, count] of Object.entries(summary.unsupported_currencies)) {
    if (!currency || !Number.isInteger(count) || count < 0) throw new Error("El resumen financiero unsupported_currencies inválido");
  }
  if (summary.reconciliation_candidates) {
    const ids = new Set<string>();
    for (const candidate of summary.reconciliation_candidates) {
      if (!/^[a-f0-9]{16,64}$/i.test(candidate.candidate_id)) throw new Error("Candidato financiero sin hash opaco válido");
      requireIsoDate(candidate.occurred_on, "finance.candidate.occurred_on");
      if (!Number.isFinite(candidate.amount_ars) || candidate.amount_ars <= 0) throw new Error("Candidato financiero con monto inválido");
      if (!["business_income", "unreviewed"].includes(candidate.bucket)) throw new Error("Candidato financiero con bucket inválido");
      if (ids.has(candidate.candidate_id)) throw new Error("Candidato financiero duplicado");
      ids.add(candidate.candidate_id);
    }
  }
  return summary;
}

function ccmaAssessment(snapshot: CcmaSnapshot | null, asOf: string) {
  if (!snapshot) {
    return { status: "not-consulted" as const, checkedOn: null, ageDays: null, isFresh: false };
  }
  const checkedOn = new Date(snapshot.checked_at).toISOString().slice(0, 10);
  const ageDays = daysBetween(checkedOn, asOf);
  const isFresh = ageDays >= 0 && ageDays <= 7;
  if (ageDays < 0) return { status: "after-report-date" as const, checkedOn, ageDays, isFresh };
  if (!isFresh) return { status: "stale" as const, checkedOn, ageDays, isFresh };
  if (snapshot.debt_capital_ars === null || snapshot.debt_interest_ars === null || snapshot.credit_balance_ars === null) {
    return { status: "consulted-incomplete" as const, checkedOn, ageDays, isFresh };
  }
  if (snapshot.debt_capital_ars > 0 || snapshot.debt_interest_ars > 0) {
    return { status: "debt-detected" as const, checkedOn, ageDays, isFresh };
  }
  return { status: "no-debt-verified" as const, checkedOn, ageDays, isFresh };
}

export function voucherKey(voucher: NormalizedVoucher): string {
  return `${voucher.salesPoint}:${voucher.voucherType}:${voucher.voucherNumber}`;
}

export function dedupeVouchers(vouchers: NormalizedVoucher[]): NormalizedVoucher[] {
  const byKey = new Map<string, NormalizedVoucher>();
  for (const voucher of vouchers) {
    const key = voucherKey(voucher);
    const existing = byKey.get(key);
    if (!existing || (existing.source === "portal_export" && voucher.source === "arca_wsfe")) {
      byKey.set(key, voucher);
    }
  }
  return [...byKey.values()].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || voucherKey(a).localeCompare(voucherKey(b)));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function reconcileVouchersWithFinance(
  vouchers: NormalizedVoucher[],
  finance?: FinanceSummary | null,
  options: { amountToleranceArs?: number; maxDaysBefore?: number; maxDaysAfter?: number } = {},
): FinanceReconciliation {
  const caveat = "Coincidencia heurística por monto y cercanía de fecha; no prueba cobro, imputación ni identidad de contraparte.";
  if (!finance?.reconciliation_candidates) {
    return {
      status: "unavailable",
      matches: [],
      unmatchedVoucherKeys: vouchers.filter((item) => item.effect === 1).map(voucherKey),
      unusedCandidateCount: 0,
      unusedCandidateAmountArs: 0,
      caveat,
    };
  }
  const amountToleranceArs = options.amountToleranceArs ?? 1;
  const maxDaysBefore = options.maxDaysBefore ?? 3;
  const maxDaysAfter = options.maxDaysAfter ?? 60;
  const candidates = finance.reconciliation_candidates
    .filter((item) => item.amount_ars > 0)
    .map((item) => ({ ...item, used: false }))
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.candidate_id.localeCompare(b.candidate_id));
  const positiveVouchers = dedupeVouchers(vouchers).filter((item) => item.effect === 1);
  const matches: FinanceReconciliation["matches"] = [];
  const unmatchedVoucherKeys: string[] = [];
  for (const invoice of positiveVouchers) {
    const eligible = candidates
      .map((candidate, index) => ({ candidate, index, days: daysBetween(invoice.issuedOn, candidate.occurred_on) }))
      .filter(({ candidate, days }) =>
        !candidate.used
        && Math.abs(candidate.amount_ars - invoice.totalArs) <= amountToleranceArs
        && days >= -maxDaysBefore
        && days <= maxDaysAfter)
      .sort((a, b) => Math.abs(a.days) - Math.abs(b.days) || a.days - b.days);
    const match = eligible[0];
    if (!match) {
      unmatchedVoucherKeys.push(voucherKey(invoice));
      continue;
    }
    candidates[match.index].used = true;
    matches.push({
      voucherKey: voucherKey(invoice),
      candidateId: match.candidate.candidate_id,
      amountArs: invoice.totalArs,
      daysFromIssue: match.days,
      candidateBucket: match.candidate.bucket,
    });
  }
  const unused = candidates.filter((item) => !item.used);
  return {
    status: "available",
    matches,
    unmatchedVoucherKeys,
    unusedCandidateCount: unused.length,
    unusedCandidateAmountArs: roundMoney(unused.reduce((sum, item) => sum + item.amount_ars, 0)),
    caveat,
  };
}

function normalizeHeader(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedRow(row: CsvRow): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value.trim()]));
}

function first(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value) return value;
  }
  return "";
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const match = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new Error(`Fecha de comprobante inválida: ${value}`);
}

function voucherType(value: string): 11 | 12 | 13 {
  const numeric = value.match(/\b(11|12|13)\b/);
  if (numeric) return Number(numeric[1]) as 11 | 12 | 13;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const result = TYPE_BY_NAME[normalized];
  if (!result) throw new Error(`Tipo de comprobante no soportado: ${value}`);
  return result;
}

function pointAndNumber(row: Record<string, string>): { salesPoint: number; voucherNumber: number } {
  const composite = first(row, ["comprobante", "numero comprobante", "nro comprobante"]);
  const compositeMatch = composite.match(/(?:\D|^)(\d{1,5})[-/]0*(\d{1,10})(?:\D|$)/);
  const pointRaw = first(row, ["punto de venta", "pto vta", "ptovta", "sales point"]);
  const numberRaw = first(row, ["numero", "nro", "cbte desde", "voucher number"]);
  const salesPoint = Number((pointRaw || compositeMatch?.[1] || "").replace(/^0+/, "") || "0");
  const voucherNumber = Number((numberRaw || compositeMatch?.[2] || "").replace(/^0+/, "") || "0");
  if (!Number.isInteger(salesPoint) || salesPoint < 1) throw new Error("Falta punto de venta válido");
  if (!Number.isInteger(voucherNumber) || voucherNumber < 1) throw new Error("Falta número de comprobante válido");
  return { salesPoint, voucherNumber };
}

export function parsePortalRows(rows: CsvRow[]): NormalizedVoucher[] {
  return rows.map((sourceRow) => {
    const row = normalizedRow(sourceRow);
    const type = voucherType(first(row, ["tipo", "tipo comprobante", "cbte tipo", "comprobante tipo"]));
    const { salesPoint, voucherNumber } = pointAndNumber(row);
    const currencyRaw = first(row, ["moneda", "mon id", "currency"]).toUpperCase();
    const currency = ["", "$", "ARS", "PES", "PESO", "PESOS"].includes(currencyRaw) ? "PES" : currencyRaw;
    const totalOriginal = parseAmount(first(row, ["importe total", "imp total", "total", "importe"]));
    const currencyRateRaw = first(row, ["cotizacion", "mon cotiz", "tipo de cambio"]);
    const currencyRate = currency === "PES" ? 1 : parseAmount(currencyRateRaw);
    if (currency !== "PES" && !(currencyRate > 0)) throw new Error("Una moneda extranjera requiere cotización positiva");
    return {
      salesPoint,
      voucherType: type,
      voucherNumber,
      issuedOn: normalizeDate(first(row, ["fecha", "fecha emision", "cbte fch", "fecha comprobante"])),
      currency,
      currencyRate,
      totalOriginal,
      totalArs: roundMoney(totalOriginal * currencyRate),
      effect: EFFECT_BY_TYPE[type],
      source: "portal_export" as const,
    };
  });
}

export function readPortalHistoryCsv(filePath: string): NormalizedVoucher[] {
  return parsePortalRows(readCsv(filePath));
}

function opaqueClientHash(clientId: string): string {
  return createHash("sha256").update(`fiscal-payment-ledger-v1:${clientId}`).digest("hex").slice(0, 20);
}

function parseLedgerAmount(value: string): { currency: string; amount: number } {
  const match = value.trim().match(/^([A-Za-z]{3})\s+(.+)$/);
  if (!match) throw new Error(`Importe del registro de pagos inválido: ${value}`);
  return { currency: match[1].toUpperCase(), amount: parseAmount(match[2]) };
}

export function parsePaymentLedgerRows(rows: CsvRow[], generatedAt = new Date().toISOString()): PaymentLedgerImport {
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("payment ledger generatedAt inválido");
  const grouped = new Map<string, PaymentLedgerGroup>();
  const excluded = { missingPaymentDate: 0, unsupportedCurrency: 0, notPaid: 0 };
  for (const sourceRow of rows) {
    const row = normalizedRow(sourceRow);
    if (first(row, ["estado"]).toLowerCase() !== "pagado") {
      excluded.notPaid += 1;
      continue;
    }
    const paidOnRaw = first(row, ["fecha pago", "fecha_pago"]);
    if (!paidOnRaw) {
      excluded.missingPaymentDate += 1;
      continue;
    }
    const paidOn = normalizeDate(paidOnRaw);
    const { currency, amount } = parseLedgerAmount(first(row, ["importe", "monto"]));
    if (!["ARS", "PES"].includes(currency)) {
      excluded.unsupportedCurrency += 1;
      continue;
    }
    const clientId = first(row, ["cliente id", "cliente_id"]);
    if (!clientId) throw new Error("El registro de pagos requiere cliente_id");
    const clientHash = opaqueClientHash(clientId);
    const period = first(row, ["periodo"]);
    if (period && !/^\d{4}-\d{2}$/.test(period)) throw new Error(`Período de pago inválido: ${period}`);
    const key = `${clientHash}:${paidOn}`;
    const current = grouped.get(key) ?? { clientHash, paidOn, amountArs: 0, allocatedPeriods: [], rowCount: 0 };
    current.amountArs = roundMoney(current.amountArs + amount);
    current.rowCount += 1;
    if (period && !current.allocatedPeriods.includes(period)) current.allocatedPeriods.push(period);
    grouped.set(key, current);
  }
  const groups = [...grouped.values()]
    .map((group) => ({ ...group, allocatedPeriods: group.allocatedPeriods.sort() }))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.clientHash.localeCompare(b.clientHash));
  const dates = groups.map((group) => group.paidOn);
  return {
    schema_version: 1,
    source: "payment_ledger",
    generated_at: generatedAt,
    period: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
    groups,
    excluded,
  };
}

export function readPaymentLedgerCsv(filePath: string): PaymentLedgerImport {
  return parsePaymentLedgerRows(readCsv(filePath), new Date().toISOString());
}

export function reconcilePaymentLedger(
  ledger: PaymentLedgerImport | null | undefined,
  finance: FinanceSummary | null | undefined,
  options: { amountToleranceArs?: number; maxDateDistanceDays?: number } = {},
) {
  const caveat = "Conciliación operativa por importe y fecha; confirma consistencia entre registros, no identidad bancaria por sí sola.";
  if (!ledger || !finance?.reconciliation_candidates) {
    return {
      status: "unavailable" as const,
      matches: [],
      unmatchedGroupCount: ledger?.groups.length ?? 0,
      confirmedBusinessIncomeArs: 0,
      caveat,
    };
  }
  const tolerance = options.amountToleranceArs ?? 1;
  const maxDays = options.maxDateDistanceDays ?? 3;
  const candidates = finance.reconciliation_candidates.map((candidate) => ({ ...candidate, used: false }));
  const matches: Array<{
    clientHash: string;
    paidOn: string;
    allocatedPeriods: string[];
    amountArs: number;
    candidateId: string;
    candidateDate: string;
    candidateBucket: "business_income" | "unreviewed";
    daysDifference: number;
  }> = [];
  let unmatchedGroupCount = 0;
  for (const group of ledger.groups) {
    const match = candidates
      .map((candidate, index) => ({ candidate, index, days: daysBetween(group.paidOn, candidate.occurred_on) }))
      .filter(({ candidate, days }) => !candidate.used
        && Math.abs(candidate.amount_ars - group.amountArs) <= tolerance
        && Math.abs(days) <= maxDays)
      .sort((a, b) => Math.abs(a.days) - Math.abs(b.days))[0];
    if (!match) {
      unmatchedGroupCount += 1;
      continue;
    }
    candidates[match.index].used = true;
    matches.push({
      clientHash: group.clientHash,
      paidOn: group.paidOn,
      allocatedPeriods: group.allocatedPeriods,
      amountArs: group.amountArs,
      candidateId: match.candidate.candidate_id,
      candidateDate: match.candidate.occurred_on,
      candidateBucket: match.candidate.bucket,
      daysDifference: match.days,
    });
  }
  return {
    status: "available" as const,
    matches,
    unmatchedGroupCount,
    confirmedBusinessIncomeArs: roundMoney(matches.reduce((sum, match) => sum + match.amountArs, 0)),
    caveat,
  };
}

export async function fetchArcaHistory(options: {
  config: ArcaConfig;
  from: string;
  to: string;
  salesPoint?: number;
  voucherTypes?: Array<11 | 12 | 13>;
}): Promise<NormalizedVoucher[]> {
  const from = requireIsoDate(options.from, "from");
  const to = requireIsoDate(options.to, "to");
  if (from > to) throw new Error("from no puede ser posterior a to");
  const salesPoint = options.salesPoint ?? options.config.puntoVenta;
  const voucherTypes = options.voucherTypes ?? [11, 12, 13];
  const arca = createArca(options.config);
  const vouchers: NormalizedVoucher[] = [];

  for (const type of voucherTypes) {
    const last = await arca.electronicBillingService.getLastVoucher(salesPoint, type);
    if (last.errors?.err?.length) {
      throw new Error(`ARCA rechazó la consulta del punto ${salesPoint}, tipo ${type}: ${last.errors.err.map((error) => error.msg).join("; ")}`);
    }
    for (let number = 1; number <= last.cbteNro; number += 1) {
      const detail = await arca.electronicBillingService.getVoucherInfo(number, salesPoint, type);
      if (!detail?.cbteFch || detail.impTotal === undefined) continue;
      const issuedOn = normalizeDate(detail.cbteFch);
      if (issuedOn < from || issuedOn > to) continue;
      const currency = detail.monId || "PES";
      const currencyRate = detail.monCotiz || (currency === "PES" ? 1 : 0);
      if (!(currencyRate > 0)) throw new Error(`Comprobante ${salesPoint}-${number} no tiene cotización utilizable`);
      vouchers.push({
        salesPoint,
        voucherType: type,
        voucherNumber: number,
        issuedOn,
        currency,
        currencyRate,
        totalOriginal: detail.impTotal,
        totalArs: roundMoney(detail.impTotal * currencyRate),
        effect: EFFECT_BY_TYPE[type],
        source: "arca_wsfe",
      });
    }
  }
  return vouchers;
}

export type FiscalReport = ReturnType<typeof buildFiscalReport>;

export function buildFiscalReport(options: {
  asOf: string;
  vouchers: NormalizedVoucher[];
  currentCategory?: MonotributoCategory;
  sourceStatus: { arcaWsfe: boolean; portalPoint1: boolean };
  finance?: FinanceSummary | null;
  paymentLedger?: PaymentLedgerImport | null;
  ccma?: CcmaSnapshot | null;
  recategorizationParameters?: RecategorizationParameters | null;
  sourceEvidence?: {
    arcaWsfe?: { generatedAt: string; period: FiscalPeriod; environment: "homo" | "prod" };
    portalPoint1?: { generatedAt: string; period: FiscalPeriod };
  };
  generatedAt?: string;
}) {
  const asOf = requireIsoDate(options.asOf, "asOf");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const from = rollingTwelveMonthStart(asOf);
  const finance = options.finance ? validateFinanceSummary(options.finance) : null;
  const financePeriodComplete = Boolean(finance && finance.period.from <= from && finance.period.to >= asOf);
  const allVouchers = dedupeVouchers(options.vouchers);
  const vouchers = allVouchers.filter((voucher) => voucher.issuedOn >= from && voucher.issuedOn <= asOf);
  const monthly: Record<string, number> = {};
  let totalArs = 0;
  for (const voucher of vouchers) {
    const contribution = voucher.totalArs * voucher.effect;
    totalArs += contribution;
    const month = voucher.issuedOn.slice(0, 7);
    monthly[month] = roundMoney((monthly[month] ?? 0) + contribution);
  }
  totalArs = roundMoney(totalArs);

  const table = categoryTableFor(asOf);
  const suggested = suggestedCategory(totalArs, asOf);
  const current = options.currentCategory;
  const incomeSourcesComplete = options.sourceStatus.arcaWsfe && options.sourceStatus.portalPoint1;
  const capRow = table.thresholds.find((row) => row.category === current)
    ?? (suggested === "EXCLUDED" ? table.thresholds.at(-1) : table.thresholds.find((row) => row.category === suggested));
  if (!capRow) throw new Error("No se pudo determinar el tope de categoría");
  const usagePercent = roundMoney((totalArs / capRow.grossIncomeCapArs) * 100);
  const recentMonths = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-3);
  const recentAverage = recentMonths.length
    ? roundMoney(recentMonths.reduce((sum, [, amount]) => sum + amount, 0) / recentMonths.length)
    : 0;
  const canProject = incomeSourcesComplete && recentMonths.length >= 3;

  const missingSources = [
    !options.sourceStatus.arcaWsfe ? "arca_wsfe" : null,
    !options.sourceStatus.portalPoint1 ? "portal_point_1" : null,
    !finance ? "finance_export" : null,
    finance && !financePeriodComplete ? "finance_export_period" : null,
  ].filter((value): value is string => Boolean(value));
  const duePeriod = asOf.slice(0, 7);
  const dueOn = monotributoDueDate(duePeriod);
  const ccma = options.ccma ? validateCcmaSnapshot(options.ccma) : null;
  const ccmaState = ccmaAssessment(ccma, asOf);
  if (!ccma) missingSources.push("arca_ccma");
  else if (!ccmaState.isFresh) missingSources.push("arca_ccma_fresh_snapshot");
  const debtTotalArs = ccma && ccma.debt_capital_ars !== null && ccma.debt_interest_ars !== null
    ? roundMoney(ccma.debt_capital_ars + ccma.debt_interest_ars)
    : null;
  const debtItemsTotalArs = ccma?.debt_items?.length
    ? roundMoney(ccma.debt_items.reduce((sum, item) => sum + item.capital_ars + item.interest_ars, 0))
    : null;
  const debtDetailComplete = debtTotalArs !== null
    && debtItemsTotalArs !== null
    && Math.abs(debtItemsTotalArs - debtTotalArs) <= 0.01;
  const paymentApplied = ccmaState.isFresh && ccma?.last_payment_period === duePeriod;
  const paymentStatus = paymentApplied
    ? "applied"
    : (!ccma ? "unknown" : (asOf > dueOn ? "overdue-or-unverified" : "pending-or-unverified"));
  const recategorizationWindow = nextRecategorizationWindow(asOf);
  const recategorizationCutoff = asOf < recategorizationWindow.measurementPeriod.to
    ? asOf
    : recategorizationWindow.measurementPeriod.to;
  const recategorizationVouchers = allVouchers.filter((voucher) =>
    voucher.issuedOn >= recategorizationWindow.measurementPeriod.from
    && voucher.issuedOn <= recategorizationCutoff);
  const recategorizationGrossIncomeArs = roundMoney(recategorizationVouchers.reduce(
    (sum, voucher) => sum + voucher.totalArs * voucher.effect,
    0,
  ));
  const evidenceCovers = (evidence: FiscalPeriod | undefined, required: FiscalPeriod) =>
    !evidence || (evidence.from <= required.from && evidence.to >= required.to);
  const recategorizationIncomePeriod = {
    from: recategorizationWindow.measurementPeriod.from,
    to: recategorizationCutoff,
  };
  const recategorizationIncomeSourcesComplete = incomeSourcesComplete
    && evidenceCovers(options.sourceEvidence?.arcaWsfe?.period, recategorizationIncomePeriod)
    && evidenceCovers(options.sourceEvidence?.portalPoint1?.period, recategorizationIncomePeriod);
  const measurementPeriodComplete = asOf >= recategorizationWindow.measurementPeriod.to;
  const recategorizationParameters = options.recategorizationParameters
    ? validateRecategorizationParameters(options.recategorizationParameters)
    : null;
  const parameterEvaluation = evaluateRecategorizationParameters(recategorizationGrossIncomeArs, recategorizationParameters, asOf);
  const missingParameters = parameterEvaluation.missingParameters;
  const sixMonthsCompletedOn = recategorizationParameters?.activityStartedOn
    ? (() => {
        const date = new Date(`${recategorizationParameters.activityStartedOn}T00:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() + 6);
        return date.toISOString().slice(0, 10);
      })()
    : null;
  const eligibleForRecategorization = sixMonthsCompletedOn === null
    ? null
    : sixMonthsCompletedOn <= recategorizationWindow.deadline;
  const categoryByAllParameters = recategorizationIncomeSourcesComplete
    ? parameterEvaluation.suggestedCategoryWhenComplete
    : null;
  const filingNeed = eligibleForRecategorization === false
    ? "no-action-less-than-six-months" as const
    : !measurementPeriodComplete
      ? "monitoring-incomplete-window" as const
      : categoryByAllParameters === "EXCLUDED"
        ? "professional-review-exclusion-risk" as const
        : (!categoryByAllParameters || !current)
          ? "unknown" as const
          : categoryByAllParameters === current
            ? "no-action-category-unchanged" as const
            : "category-change-indicated" as const;
  const dossierUncertainties = [
    ...(!recategorizationIncomeSourcesComplete ? ["Falta completar el historial fiscal del período de medición, incluido el punto de venta 1."] : []),
    ...(!measurementPeriodComplete ? [`El período de medición cierra el ${recategorizationWindow.measurementPeriod.to}; el total actual es parcial y puede cambiar.`] : []),
    ...(missingParameters.length ? [`Faltan parámetros declarados: ${missingParameters.join(", ")}.`] : []),
    "La tabla y las reglas deben revalidarse contra ARCA al abrirse la ventana.",
  ];
  const financeReconciliation = reconcileVouchersWithFinance(vouchers, finance);
  const paymentLedgerReconciliation = reconcilePaymentLedger(options.paymentLedger, finance);

  return {
    schemaVersion: FISCAL_SCHEMA_VERSION,
    generatedAt,
    status: missingSources.length ? "incomplete" as const : "complete" as const,
    period: { from, to: asOf },
    sources: {
      arcaWsfe: options.sourceStatus.arcaWsfe ? "loaded" : "missing",
      portalPoint1: options.sourceStatus.portalPoint1 ? "loaded" : "missing",
      financeExport: !finance ? "missing" : (financePeriodComplete ? "loaded" : "partial-period"),
      ccma: !ccma ? "not-consulted" : ccmaState.status,
      missing: missingSources,
    },
    sourceEvidence: {
      arcaWsfe: options.sourceStatus.arcaWsfe ? {
        source: "arca_wsfe" as const,
        generated_at: options.sourceEvidence?.arcaWsfe?.generatedAt ?? generatedAt,
        period: options.sourceEvidence?.arcaWsfe?.period ?? { from, to: asOf },
        environment: options.sourceEvidence?.arcaWsfe?.environment ?? null,
      } : { source: "arca_wsfe" as const, generated_at: null, period: null, environment: null },
      portalPoint1: options.sourceStatus.portalPoint1 ? {
        source: "portal_export" as const,
        generated_at: options.sourceEvidence?.portalPoint1?.generatedAt ?? generatedAt,
        period: options.sourceEvidence?.portalPoint1?.period ?? { from, to: asOf },
      } : { source: "portal_export" as const, generated_at: null, period: null },
      financeExport: finance ? {
        source: finance.source,
        generated_at: finance.generated_at,
        period: finance.period,
      } : { source: "finance_export" as const, generated_at: null, period: null },
      paymentLedger: options.paymentLedger ? {
        source: options.paymentLedger.source,
        generated_at: options.paymentLedger.generated_at,
        period: options.paymentLedger.period,
      } : { source: "payment_ledger" as const, generated_at: null, period: null },
      ccma: ccma ? {
        source: ccma.source,
        generated_at: ccma.checked_at,
        period: ccma.period ? { from: `${ccma.period}-01`, to: asOf } : null,
      } : { source: "arca_ccma" as const, generated_at: null, period: null },
    },
    income: {
      observedArs: totalArs,
      completeness: incomeSourcesComplete ? "complete" as const : "partial-minimum" as const,
      voucherCount: vouchers.length,
      monthly: Object.fromEntries(Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b))),
      recentThreeMonthAverageArs: recentAverage,
      projectedAnnualRunRateArs: canProject ? roundMoney(recentAverage * 12) : null,
      projectionMethod: canProject ? "promedio observado de los últimos 3 meses con comprobantes × 12" : null,
      projectionBlockedReason: canProject
        ? null
        : (!incomeSourcesComplete ? "faltan fuentes de ingresos" : "se requieren al menos 3 meses con comprobantes"),
    },
    monotributo: {
      currentCategory: current ?? null,
      suggestedByGrossIncome: incomeSourcesComplete ? suggested : null,
      evaluatedAgainstCategory: capRow.category,
      grossIncomeCapArs: capRow.grossIncomeCapArs,
      minimumObservedRemainingArs: roundMoney(capRow.grossIncomeCapArs - totalArs),
      usagePercent: incomeSourcesComplete ? usagePercent : null,
      minimumObservedUsagePercent: usagePercent,
      alert: incomeSourcesComplete ? alertLevel(usagePercent) : "unknown" as const,
      tableValidFrom: table.validFrom,
      tableSource: table.sourceUrl,
      caveat: "La categoría final también puede depender de alquileres, superficie, energía y otros parámetros aplicables.",
    },
    finance,
    financeCoverage: finance ? {
      required: { from, to: asOf },
      loaded: finance.period,
      complete: financePeriodComplete,
    } : null,
    financeReconciliation,
    paymentLedger: options.paymentLedger ?? null,
    paymentLedgerReconciliation,
    ccma,
    ccmaAssessment: ccmaState,
    obligations: {
      monotributo: {
        period: duePeriod,
        dueOn,
        dueDateBasis: "día 20; corrimiento de fines de semana incluido; feriados requieren calendario verificado",
        paymentStatus,
        automaticDebit: ccma?.automatic_debit ?? "unknown",
      },
      vepDraft: debtTotalArs && debtTotalArs > 0
        ? {
            amountArs: debtTotalArs,
            items: ccma?.debt_items ?? [],
            status: debtDetailComplete
              ? "requires-explicit-confirmation" as const
              : "blocked-by-missing-debt-detail" as const,
            detailTotalArs: debtItemsTotalArs,
            action: debtDetailComplete
              ? "Los datos están listos para revisar; generar VEP requiere confirmación explícita de la persona operadora."
              : "Completar períodos, conceptos, capital e intereses de CCMA antes de preparar un VEP.",
          }
        : null,
    },
    recategorization: {
      window: recategorizationWindow,
      currentCategory: current ?? null,
      indicativeCategoryByCurrentGrossIncomeTable: recategorizationIncomeSourcesComplete
        ? suggestedCategory(recategorizationGrossIncomeArs, asOf)
        : null,
      indicativeMinimumCategoryFromKnownValues: parameterEvaluation.minimumCategoryFromKnownValues,
      indicativeCategoryByAllParameters: categoryByAllParameters,
      limitingParameters: parameterEvaluation.limitingParameters,
      eligibleForRecategorization,
      sixMonthsCompletedOn,
      filingNeed,
      recommendationStatus: recategorizationIncomeSourcesComplete && missingParameters.length === 0 && eligibleForRecategorization !== null
        ? (measurementPeriodComplete ? "ready-for-human-review" as const : "monitoring-incomplete-window" as const)
        : "blocked-by-missing-evidence" as const,
      parameters: recategorizationParameters,
      missingParameters,
      evidence: {
        incomePeriodLoaded: recategorizationIncomePeriod,
        requiredMeasurementPeriod: recategorizationWindow.measurementPeriod,
        measurementPeriodComplete,
        voucherCount: recategorizationVouchers.length,
        grossIncomeArs: recategorizationIncomeSourcesComplete ? recategorizationGrossIncomeArs : null,
        categoryTableValidFrom: table.validFrom,
        categoryTableSource: table.sourceUrl,
      },
      uncertainties: dossierUncertainties,
      checklist: [
        "Completar la ventana de ingresos hasta el cierre del período de medición.",
        "Verificar Facturas C, Notas de Débito C y Notas de Crédito C de todos los puntos de venta.",
        "Revalidar categoría registral, tabla, topes y exclusiones vigentes en ARCA.",
        "Completar y respaldar los parámetros no vinculados a ingresos.",
        "Revisar el expediente con una persona responsable antes de cualquier presentación.",
      ],
      action: "No presenta ni confirma una recategorización.",
    },
  };
}

export function fiscalReportMarkdown(report: FiscalReport): string {
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
  const monthly = Object.entries(report.income.monthly)
    .map(([month, amount]) => `| ${month} | ${money.format(amount)} |`)
    .join("\n") || "| — | Sin comprobantes cargados |";
  const missing = report.sources.missing.length ? report.sources.missing.join(", ") : "ninguna";
  const ccma = report.ccma
    ? `Consultado ${report.ccma.checked_at}; estado **${report.ccmaAssessment.status}**; antigüedad ${report.ccmaAssessment.ageDays} día(s); deuda capital ${report.ccma.debt_capital_ars === null ? "no informada" : money.format(report.ccma.debt_capital_ars)}; intereses ${report.ccma.debt_interest_ars === null ? "no informados" : money.format(report.ccma.debt_interest_ars)}.`
    : "No consultado. No interpretar como deuda cero.";
  const finance = report.finance
    ? `- Cobertura: ${report.financeCoverage?.complete ? "completa" : `INCOMPLETA; cargada ${report.finance.period.from} a ${report.finance.period.to}`}\n- Ingresos de negocio clasificados: ${money.format(report.finance.observed.business_income)}\n- Gastos de negocio clasificados: ${money.format(report.finance.observed.business_expenses)}\n- Gastos personales clasificados: ${money.format(report.finance.observed.personal_expenses)}\n- Monto pendiente de revisión: ${money.format(report.finance.observed.unreviewed)} (${report.finance.counts.unreviewed} movimientos)\n- Monedas sin conversión: ${Object.entries(report.finance.unsupported_currencies).map(([currency, count]) => `${currency}: ${count}`).join(", ") || "ninguna"}`
    : "No cargado.";
  const reconciliation = report.financeReconciliation.status === "available"
    ? `- Coincidencias heurísticas factura/depósito: ${report.financeReconciliation.matches.length}\n- Facturas/débitos sin coincidencia: ${report.financeReconciliation.unmatchedVoucherKeys.length}\n- Depósitos candidatos no usados: ${report.financeReconciliation.unusedCandidateCount} (${money.format(report.financeReconciliation.unusedCandidateAmountArs)})\n\n> ${report.financeReconciliation.caveat}`
    : `No disponible: el export financiero no incluye candidatos anonimizados.\n\n> ${report.financeReconciliation.caveat}`;
  const paymentLedger = report.paymentLedgerReconciliation.status === "available"
    ? `- Grupos de pago conciliados con depósitos: ${report.paymentLedgerReconciliation.matches.length}\n- Grupos sin coincidencia: ${report.paymentLedgerReconciliation.unmatchedGroupCount}\n- Ingreso de negocio respaldado por ambos registros: ${money.format(report.paymentLedgerReconciliation.confirmedBusinessIncomeArs)}\n\n> ${report.paymentLedgerReconciliation.caveat}`
    : `No disponible.\n\n> ${report.paymentLedgerReconciliation.caveat}`;
  const vep = report.obligations.vepDraft
    ? `- Borrador VEP: **${report.obligations.vepDraft.status}**\n- Total: ${money.format(report.obligations.vepDraft.amountArs)}\n- Detalle conciliado: ${report.obligations.vepDraft.detailTotalArs === null ? "no disponible" : money.format(report.obligations.vepDraft.detailTotalArs)}\n- Próximo paso: ${report.obligations.vepDraft.action}`
    : "- Borrador VEP: no corresponde o no hay deuda total verificable.";

  return `# Reporte fiscal — Monotributo Copilot AR — ${report.period.to}

**Estado de datos:** ${report.status === "complete" ? "completo" : "INCOMPLETO"}

**Fuentes faltantes:** ${missing}

## Ingresos fiscales observados

- Ventana: ${report.period.from} a ${report.period.to}
- Total neto: **${money.format(report.income.observedArs)}**
- Comprobantes: ${report.income.voucherCount}
- Proyección anual por ritmo reciente: ${report.income.projectedAnnualRunRateArs === null ? `no disponible (${report.income.projectionBlockedReason})` : money.format(report.income.projectedAnnualRunRateArs)}

| Mes | Neto fiscal |
|---|---:|
${monthly}

## Monotributo

- Categoría registral declarada: ${report.monotributo.currentCategory ?? "no informada"}
- Categoría sugerida solo por ingresos: **${report.monotributo.suggestedByGrossIncome ?? "no calculable con fuentes incompletas"}**
- Uso del tope ${report.monotributo.evaluatedAgainstCategory}: **${report.monotributo.usagePercent === null ? `al menos ${report.monotributo.minimumObservedUsagePercent}%` : `${report.monotributo.usagePercent}%`}**
- Margen observado mínimo: ${money.format(report.monotributo.minimumObservedRemainingArs)}
- Semáforo: **${report.monotributo.alert}**
- Vigencia de tabla: ${report.monotributo.tableValidFrom}

> ${report.monotributo.caveat}

## CCMA

${ccma}

- Vencimiento estimado del período ${report.obligations.monotributo.period}: **${report.obligations.monotributo.dueOn}**
- Estado de pago: **${report.obligations.monotributo.paymentStatus}**
- Débito automático: **${report.obligations.monotributo.automaticDebit}**
${vep}

## Ingresos, depósitos y gastos

${finance}

### Conciliación orientativa

${reconciliation}

### Registro de cobranzas vs. depósitos

${paymentLedger}

## Próxima recategorización

- Fecha límite estimada: **${report.recategorization.window.deadline}**
- Período a medir: ${report.recategorization.window.measurementPeriod.from} a ${report.recategorization.window.measurementPeriod.to}
- Estado del expediente: **${report.recategorization.recommendationStatus}**
- Categoría indicativa por ingresos con la tabla actual: **${report.recategorization.indicativeCategoryByCurrentGrossIncomeTable ?? "no calculable"}**
- Categoría indicativa por todos los parámetros: **${report.recategorization.indicativeCategoryByAllParameters ?? "no calculable"}**
- Parámetro(s) limitante(s): ${report.recategorization.limitingParameters.join(", ") || "no calculable"}
- Necesidad de presentación: **${report.recategorization.filingNeed}**
- Antigüedad mínima de 6 meses: ${report.recategorization.eligibleForRecategorization === null ? "no verificable" : report.recategorization.eligibleForRecategorization ? "cumplida" : "no cumplida"}
- Parámetros faltantes: ${report.recategorization.missingParameters.join(", ") || "ninguno"}

Incertidumbres:
${report.recategorization.uncertainties.map((item) => `- ${item}`).join("\n")}

Checklist:
${report.recategorization.checklist.map((item) => `- [ ] ${item}`).join("\n")}

## Regla operativa

Este reporte es de consulta. No emite comprobantes, no genera ni paga VEP y no presenta recategorizaciones.
`;
}

export function recategorizationDossierMarkdown(report: FiscalReport): string {
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
  const dossier = report.recategorization;
  return `# Expediente de recategorización — ${dossier.window.deadline}

**Estado:** ${dossier.recommendationStatus}

**Generado:** ${report.generatedAt}

**Acción permitida:** revisión humana; este documento no realiza presentaciones.

## Ventana y categoría

- Período de medición requerido: ${dossier.window.measurementPeriod.from} a ${dossier.window.measurementPeriod.to}
- Ingresos cargados hasta: ${dossier.evidence.incomePeriodLoaded.to}
- Período de medición cerrado: ${dossier.evidence.measurementPeriodComplete ? "sí" : "no"}
- Ingresos fiscales: ${dossier.evidence.grossIncomeArs === null ? "no calculables con evidencia incompleta" : money.format(dossier.evidence.grossIncomeArs)}
- Categoría registral declarada: ${dossier.currentCategory ?? "no informada"}
- Categoría indicativa por ingresos con tabla actual: ${dossier.indicativeCategoryByCurrentGrossIncomeTable ?? "no calculable"}
- Categoría indicativa por todos los parámetros: ${dossier.indicativeCategoryByAllParameters ?? "no calculable"}
- Parámetro(s) limitante(s): ${dossier.limitingParameters.join(", ") || "no calculable"}
- Necesidad de presentación: ${dossier.filingNeed}
- Seis meses de actividad cumplidos al: ${dossier.sixMonthsCompletedOn ?? "no verificable"}
- Tabla vigente desde: ${dossier.evidence.categoryTableValidFrom}
- Fuente: ${dossier.evidence.categoryTableSource}

## Parámetros declarados

\`\`\`json
${JSON.stringify(dossier.parameters, null, 2)}
\`\`\`

Faltantes: ${dossier.missingParameters.join(", ") || "ninguno"}.

## Evidencia e incertidumbres

- Comprobantes cargados: ${dossier.evidence.voucherCount}
${dossier.uncertainties.map((item) => `- ${item}`).join("\n")}

## Checklist previo a la presentación

${dossier.checklist.map((item) => `- [ ] ${item}`).join("\n")}

> ${dossier.action}
`;
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function writeFiscalReport(outputDir: string, report: FiscalReport): { json: string; markdown: string; recategorizationDossier: string } {
  mkdirSync(outputDir, { recursive: true });
  const json = path.join(outputDir, "fiscal-report.json");
  const markdown = path.join(outputDir, "fiscal-report.md");
  const recategorizationDossier = path.join(outputDir, "recategorization-dossier.md");
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(markdown, fiscalReportMarkdown(report), { mode: 0o600 });
  writeFileSync(recategorizationDossier, recategorizationDossierMarkdown(report), { mode: 0o600 });
  return { json, markdown, recategorizationDossier };
}

export function writeArcaHistory(filePath: string, history: ArcaHistoryBundle): string {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
  return resolved;
}
