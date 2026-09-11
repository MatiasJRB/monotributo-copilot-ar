import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { getConfig, REPO_ROOT } from "./config.js";
import {
  buildFiscalReport,
  fetchArcaHistory,
  readJsonFile,
  readPortalHistoryCsv,
  readPaymentLedgerCsv,
  rollingTwelveMonthStart,
  nextRecategorizationWindow,
  writeArcaHistory,
  writeFiscalReport,
  type ArcaHistoryBundle,
  type CcmaSnapshot,
  type FinanceSummary,
  type MonotributoCategory,
  type NormalizedVoucher,
  type RecategorizationParameters,
} from "./fiscal.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

function parseTypes(value: string | undefined): Array<11 | 12 | 13> {
  const result = (value ?? "11,12,13").split(",").map((item) => Number(item.trim()));
  if (result.some((item) => ![11, 12, 13].includes(item))) throw new Error("--types admite 11,12,13");
  return result as Array<11 | 12 | 13>;
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function historyCommand() {
  const config = getConfig();
  const to = requiredArg("to");
  const from = arg("from", rollingTwelveMonthStart(to))!;
  const salesPoint = Number(arg("sales-point", String(config.puntoVenta)));
  const vouchers = await fetchArcaHistory({
    config,
    from,
    to,
    salesPoint,
    voucherTypes: parseTypes(arg("types")),
  });
  const history: ArcaHistoryBundle = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "arca_wsfe",
    environment: config.env,
    period: { from, to },
    sales_point: salesPoint,
    voucher_types: parseTypes(arg("types")),
    vouchers,
  };
  const output = arg("output");
  print({ history, output: output ? writeArcaHistory(output, history) : null });
}

async function reportCommand() {
  const asOf = requiredArg("as-of");
  const arcaHistoryPath = arg("arca-history");
  const portalPath = arg("portal-history");
  const financePath = arg("finance-summary");
  const ccmaPath = arg("ccma");
  const recategorizationParametersPath = arg("recategorization-parameters");
  const paymentsLedgerPath = arg("payments-ledger", path.join(REPO_ROOT, "data", "payments.csv"));
  const currentCategory = arg("current-category")?.toUpperCase() as MonotributoCategory | undefined;
  if (currentCategory && !/^[A-K]$/.test(currentCategory)) throw new Error("--current-category debe ser A..K");

  const arcaHistoryBundle = arcaHistoryPath && existsSync(arcaHistoryPath)
    ? readJsonFile<Partial<ArcaHistoryBundle> & { vouchers: NormalizedVoucher[] }>(arcaHistoryPath)
    : null;
  if (arcaHistoryBundle && arcaHistoryBundle.environment !== "prod" && !process.argv.includes("--allow-homologation")) {
    throw new Error("--arca-history debe declarar environment=prod; para una prueba no fiscal usá --allow-homologation");
  }
  const arcaHistory = arcaHistoryBundle?.vouchers ?? [];
  const portalHistory = portalPath && existsSync(portalPath) ? readPortalHistoryCsv(portalPath) : [];
  const portalFrom = arg("portal-from");
  const portalTo = arg("portal-to");
  if (portalPath && existsSync(portalPath) && (!portalFrom || !portalTo)) {
    throw new Error("Un export del portal requiere --portal-from y --portal-to explícitos para probar su cobertura");
  }
  const requiredFrom = rollingTwelveMonthStart(asOf);
  const portalCoverageComplete = Boolean(portalPath && existsSync(portalPath) && portalFrom! <= requiredFrom && portalTo! >= asOf);
  const finance = financePath && existsSync(financePath) ? readJsonFile<FinanceSummary>(financePath) : null;
  const ccma = ccmaPath && existsSync(ccmaPath) ? readJsonFile<CcmaSnapshot>(ccmaPath) : null;
  const recategorizationParameters = recategorizationParametersPath && existsSync(recategorizationParametersPath)
    ? readJsonFile<RecategorizationParameters>(recategorizationParametersPath)
    : null;
  const paymentLedger = paymentsLedgerPath && existsSync(paymentsLedgerPath) ? readPaymentLedgerCsv(paymentsLedgerPath) : null;

  const report = buildFiscalReport({
    asOf,
    vouchers: [...arcaHistory, ...portalHistory],
    currentCategory,
    sourceStatus: {
      arcaWsfe: Boolean(arcaHistoryPath && existsSync(arcaHistoryPath)),
      portalPoint1: portalCoverageComplete,
    },
    finance,
    ccma,
    recategorizationParameters,
    paymentLedger,
    sourceEvidence: {
      arcaWsfe: arcaHistoryPath && existsSync(arcaHistoryPath) ? {
        generatedAt: arcaHistoryBundle?.generated_at ?? statSync(arcaHistoryPath).mtime.toISOString(),
        period: arcaHistoryBundle?.period ?? { from: requiredFrom, to: asOf },
        environment: arcaHistoryBundle?.environment ?? "homo",
      } : undefined,
      portalPoint1: portalCoverageComplete ? {
        generatedAt: statSync(portalPath!).mtime.toISOString(),
        period: { from: portalFrom!, to: portalTo! },
      } : undefined,
    },
  });
  const outputDir = path.resolve(arg("output-dir", path.join(REPO_ROOT, "data", "out", "fiscal", asOf))!);
  print({ report, files: writeFiscalReport(outputDir, report) });
}

async function syncReportCommand() {
  const asOf = requiredArg("as-of");
  const config = getConfig();
  if (config.env !== "prod" && !process.argv.includes("--allow-homologation")) {
    throw new Error("sync-report requiere credenciales productivas; definí ARCA_ENV=prod y rutas prod. Para una prueba no fiscal usá --allow-homologation.");
  }
  const from = rollingTwelveMonthStart(asOf);
  const recategorizationFrom = nextRecategorizationWindow(asOf).measurementPeriod.from;
  const fetchFrom = from < recategorizationFrom ? from : recategorizationFrom;
  const vouchers = await fetchArcaHistory({ config, from: fetchFrom, to: asOf, voucherTypes: [11, 12, 13] });
  const portalPath = arg("portal-history");
  const portalFrom = arg("portal-from");
  const portalTo = arg("portal-to");
  const financePath = arg("finance-summary");
  const ccmaPath = arg("ccma");
  const recategorizationParametersPath = arg("recategorization-parameters");
  const paymentsLedgerPath = arg("payments-ledger", path.join(REPO_ROOT, "data", "payments.csv"));
  const currentCategory = arg("current-category")?.toUpperCase() as MonotributoCategory | undefined;
  const portalHistory = portalPath && existsSync(portalPath) ? readPortalHistoryCsv(portalPath) : [];
  if (portalPath && existsSync(portalPath) && (!portalFrom || !portalTo)) {
    throw new Error("Un export del portal requiere --portal-from y --portal-to explícitos para probar su cobertura");
  }
  const portalCoverageComplete = Boolean(portalPath && existsSync(portalPath) && portalFrom! <= from && portalTo! >= asOf);
  const finance = financePath && existsSync(financePath) ? readJsonFile<FinanceSummary>(financePath) : null;
  const ccma = ccmaPath && existsSync(ccmaPath) ? readJsonFile<CcmaSnapshot>(ccmaPath) : null;
  const recategorizationParameters = recategorizationParametersPath && existsSync(recategorizationParametersPath)
    ? readJsonFile<RecategorizationParameters>(recategorizationParametersPath)
    : null;
  const paymentLedger = paymentsLedgerPath && existsSync(paymentsLedgerPath) ? readPaymentLedgerCsv(paymentsLedgerPath) : null;
  const report = buildFiscalReport({
    asOf,
    vouchers: [...vouchers, ...portalHistory],
    currentCategory,
    sourceStatus: { arcaWsfe: true, portalPoint1: portalCoverageComplete },
    finance,
    ccma,
    recategorizationParameters,
    paymentLedger,
    sourceEvidence: {
      arcaWsfe: { generatedAt: new Date().toISOString(), period: { from: fetchFrom, to: asOf }, environment: config.env },
      portalPoint1: portalCoverageComplete ? {
        generatedAt: statSync(portalPath!).mtime.toISOString(),
        period: { from: portalFrom!, to: portalTo! },
      } : undefined,
    },
  });
  const outputDir = path.resolve(arg("output-dir", path.join(REPO_ROOT, "data", "out", "fiscal", asOf))!);
  const history: ArcaHistoryBundle = {
    schema_version: 1,
    source: "arca_wsfe",
    generated_at: report.sourceEvidence.arcaWsfe.generated_at!,
    environment: config.env,
    period: { from: fetchFrom, to: asOf },
    sales_point: config.puntoVenta,
    voucher_types: [11, 12, 13],
    vouchers,
  };
  print({
    report,
    files: {
      ...writeFiscalReport(outputDir, report),
      arcaHistory: writeArcaHistory(path.join(outputDir, "arca-wsfe-history.json"), history),
    },
  });
}

async function main() {
  const command = process.argv[2] || "help";
  if (["help", "--help", "-h"].includes(command)) {
    console.log(`Copiloto fiscal read-only

Comandos:
  history --from YYYY-MM-DD --to YYYY-MM-DD [--sales-point 2] [--types 11,12,13] [--output file.json]
  report --as-of YYYY-MM-DD [--arca-history file.json] [--portal-history file.csv --portal-from YYYY-MM-DD --portal-to YYYY-MM-DD] [--finance-summary file.json] [--payments-ledger file.csv] [--ccma file.json] [--recategorization-parameters file.json] [--current-category B]
  sync-report --as-of YYYY-MM-DD [--portal-history file.csv --portal-from YYYY-MM-DD --portal-to YYYY-MM-DD] [--finance-summary file.json] [--payments-ledger file.csv] [--ccma file.json] [--recategorization-parameters file.json] [--current-category B] [--allow-homologation]

Ningún comando emite comprobantes, crea VEP, paga ni presenta recategorizaciones.`);
    return;
  }
  if (command === "history") return historyCommand();
  if (command === "report") return reportCommand();
  if (command === "sync-report") return syncReportCommand();
  throw new Error(`Comando desconocido: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
