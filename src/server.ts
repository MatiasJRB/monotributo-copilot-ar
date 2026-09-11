import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { listCollectionCatalog, listInvoiceCatalog } from "./catalog.js";
import { getConfig } from "./config.js";
import { dryRun, emitInvoice, lastVoucher, renderExistingPdf, salesPoints, serverStatus } from "./operations.js";
import { invoicePreview, type Source } from "./billing.js";
import type { ArcaEnvironment } from "./config.js";
import { invoiceOutPaths } from "./out.js";
import { PRODUCTION_CONFIRMATION, productionConfirmationMatches } from "./safety.js";
import { facturadorHtml } from "./ui.js";

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function authorized(req: http.IncomingMessage, token: string): boolean {
  if (!token) return false;
  const header = req.headers.authorization || "";
  return header === `Bearer ${token}`;
}

function localViewAuthorized(req: http.IncomingMessage, serviceHost: string): boolean {
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const remoteAddress = req.socket.remoteAddress || "";
  const loopbackRemote = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  return loopbackHosts.has(serviceHost) && loopbackRemote;
}

async function main() {
  const baseConfig = getConfig({ requireCredentials: false });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(facturadorHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, env: baseConfig.env, production: baseConfig.production });
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/status") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const config = getConfig();
        json(res, 200, await serverStatus(config));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/view/status") {
        if (!localViewAuthorized(req, baseConfig.serviceHost)) return json(res, 403, { error: "La vista sólo está disponible en loopback" });
        const config = getConfig();
        json(res, 200, await serverStatus(config));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/sales-points") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const config = getConfig();
        json(res, 200, await salesPoints(config));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/last") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const config = getConfig();
        json(res, 200, await lastVoucher(Number(url.searchParams.get("cbteTipo") || "11"), config));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/invoices") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const periodo = String(url.searchParams.get("periodo") || "");
        const source = String(url.searchParams.get("source") || "real") as Source;
        if (!/^\d{4}-\d{2}$/.test(periodo)) return json(res, 400, { error: "periodo debe tener formato YYYY-MM" });
        if (!["dev", "real"].includes(source)) return json(res, 400, { error: "source debe ser dev o real" });
        json(res, 200, listInvoiceCatalog(periodo, source, baseConfig));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/view/invoices") {
        if (!localViewAuthorized(req, baseConfig.serviceHost)) return json(res, 403, { error: "La vista sólo está disponible en loopback" });
        const periodo = String(url.searchParams.get("periodo") || "");
        const source = String(url.searchParams.get("source") || "real") as Source;
        if (!/^\d{4}-\d{2}$/.test(periodo)) return json(res, 400, { error: "periodo debe tener formato YYYY-MM" });
        if (!["dev", "real"].includes(source)) return json(res, 400, { error: "source debe ser dev o real" });
        json(res, 200, listInvoiceCatalog(periodo, source, baseConfig));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/view/collections") {
        if (!localViewAuthorized(req, baseConfig.serviceHost)) return json(res, 403, { error: "La vista solo está disponible en loopback" });
        const periodo = String(url.searchParams.get("periodo") || "");
        if (!/^\d{4}-\d{2}$/.test(periodo)) return json(res, 400, { error: "periodo debe tener formato YYYY-MM" });
        json(res, 200, listCollectionCatalog(periodo));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/invoices/pdf") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const periodo = String(url.searchParams.get("periodo") || "");
        const clienteId = String(url.searchParams.get("clienteId") || "");
        if (!/^\d{4}-\d{2}$/.test(periodo) || !clienteId) return json(res, 400, { error: "periodo y clienteId son requeridos" });
        const paths = invoiceOutPaths(periodo, clienteId, baseConfig.env);
        if (!existsSync(paths.pdf)) return json(res, 404, { error: "Todavía no existe el PDF" });
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="factura-${clienteId.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf"`,
          "X-Content-Type-Options": "nosniff",
        });
        res.end(readFileSync(paths.pdf));
        return;
      }

      if (req.method === "GET" && url.pathname === "/arca/view/pdf") {
        if (!localViewAuthorized(req, baseConfig.serviceHost)) return json(res, 403, { error: "La vista sólo está disponible en loopback" });
        const periodo = String(url.searchParams.get("periodo") || "");
        const clienteId = String(url.searchParams.get("clienteId") || "");
        if (!/^\d{4}-\d{2}$/.test(periodo) || !clienteId) return json(res, 400, { error: "periodo y clienteId son requeridos" });
        const paths = invoiceOutPaths(periodo, clienteId, baseConfig.env);
        if (!existsSync(paths.pdf)) return json(res, 404, { error: "Todavía no existe el PDF" });
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="factura-${clienteId.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf"`,
          "X-Content-Type-Options": "nosniff",
        });
        res.end(readFileSync(paths.pdf));
        return;
      }

      if (req.method === "POST" && url.pathname === "/arca/invoices/dry-run") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const body = await readJson(req);
        const source = (body.source || "dev") as Source;
        const result = dryRun(String(body.periodo), String(body.clienteId), source, baseConfig);
        json(res, 200, { status: "dry-run", paths: result.paths, voucher: result.prepared.voucher, preview: invoicePreview(result.prepared) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/arca/invoices/emit") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const body = await readJson(req);
        const config = getConfig();
        if (config.production && !productionConfirmationMatches(body.confirmation)) {
          return json(res, 400, { error: `Producción requiere escribir exactamente: ${PRODUCTION_CONFIRMATION}` });
        }
        const result = await emitInvoice({
          periodo: String(body.periodo),
          clienteId: String(body.clienteId),
          source: (body.source || "dev") as Source,
          allowHomoEmit: body.allowHomoEmit === true,
          allowProductionEmit: body.allowProductionEmit === true && productionConfirmationMatches(body.confirmation),
          force: false,
          config,
        });
        json(res, 200, { status: "accepted", detail: result.detail, paths: result.paths });
        return;
      }

      if (req.method === "POST" && url.pathname === "/arca/invoices/render-pdf") {
        if (!authorized(req, baseConfig.serviceToken)) return json(res, 401, { error: "unauthorized" });
        const body = await readJson(req);
        const env = body.env as ArcaEnvironment | undefined;
        if (env && !["homo", "prod"].includes(env)) return json(res, 400, { error: "env debe ser homo o prod" });
        const result = await renderExistingPdf({
          periodo: String(body.periodo),
          clienteId: String(body.clienteId),
          env,
          config: baseConfig,
        });
        json(res, 200, { status: "rendered", detail: result.detail, paths: result.paths });
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (error: any) {
      json(res, 500, { error: error?.message || String(error) });
    }
  });

  server.listen(baseConfig.servicePort, baseConfig.serviceHost, () => {
    console.log(`ARCA service listening on http://${baseConfig.serviceHost}:${baseConfig.servicePort} (${baseConfig.env})`);
  });
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
