import { getConfigStatus } from "./config.js";
import { dryRun, emitInvoice, lastVoucher, renderExistingPdf, salesPoints, serverStatus } from "./operations.js";
import { PRODUCTION_CONFIRMATION, productionConfirmationMatches } from "./safety.js";
import { invoicePreview, type Source } from "./billing.js";
import type { ArcaEnvironment } from "./config.js";

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1];
  const withEq = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requiredArg(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const command = process.argv[2] || "help";
  if (["help", "--help", "-h"].includes(command)) {
    console.log(`ARCA service CLI

Comandos:
  doctor
  status
  sales-points
  last --cbte-tipo 11
  emit --periodo YYYY-MM --cliente cliente_id --source dev|real --dry-run
  emit --periodo YYYY-MM --cliente cliente_id --source dev --homo --allow-homo-emit
  emit --periodo YYYY-MM --cliente cliente_id --source real --production --allow-production-emit --confirm-production "${PRODUCTION_CONFIRMATION}"
  render-pdf --periodo YYYY-MM --cliente cliente_id --env homo|prod
`);
    return;
  }

  if (command === "doctor") {
    printJson(getConfigStatus());
    return;
  }

  if (command === "status") {
    printJson(await serverStatus());
    return;
  }

  if (command === "sales-points") {
    printJson(await salesPoints());
    return;
  }

  if (command === "last") {
    printJson(await lastVoucher(Number(arg("cbte-tipo", "11"))));
    return;
  }

  if (command === "emit") {
    const periodo = requiredArg("periodo");
    const clienteId = requiredArg("cliente");
    const source = (arg("source", "dev") as Source) || "dev";
    if (!["dev", "real"].includes(source)) throw new Error("--source debe ser dev o real");

    if (hasFlag("dry-run")) {
      const result = dryRun(periodo, clienteId, source);
      printJson({ status: "dry-run", paths: result.paths, voucher: result.prepared.voucher, preview: invoicePreview(result.prepared) });
      return;
    }

    const productionRequested = hasFlag("production") || hasFlag("allow-production-emit");
    const productionConfirmed = productionConfirmationMatches(arg("confirm-production"));
    if (productionRequested && !productionConfirmed) {
      throw new Error(`Producción requiere --confirm-production "${PRODUCTION_CONFIRMATION}"`);
    }

    const result = await emitInvoice({
      periodo,
      clienteId,
      source,
      allowHomoEmit: hasFlag("allow-homo-emit") || hasFlag("homo"),
      allowProductionEmit: hasFlag("allow-production-emit") && hasFlag("production") && productionConfirmed,
      force: hasFlag("force"),
    });
    printJson({ status: "accepted", detail: result.detail, paths: result.paths });
    return;
  }

  if (command === "render-pdf") {
    const env = arg("env") as ArcaEnvironment | undefined;
    if (env && !["homo", "prod"].includes(env)) throw new Error("--env debe ser homo o prod");
    const result = await renderExistingPdf({
      periodo: requiredArg("periodo"),
      clienteId: requiredArg("cliente"),
      env,
    });
    printJson({ status: "rendered", detail: result.detail, paths: result.paths });
    return;
  }

  throw new Error(`Comando desconocido: ${command}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
