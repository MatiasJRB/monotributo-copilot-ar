import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { InvoicePdfGenerator, type InvoiceData } from "@arcasdk/pdf";
import { REPO_ROOT } from "./config.js";

export type GenerateInvoicePdfOptions = {
  homologacion?: boolean;
};

const HOMOLOGACION_FOOTER = "HOMOLOGACION / TESTING - NO VALIDA COMO FACTURA FISCAL.";
const require = createRequire(import.meta.url);

function logoDataUrl(): string | undefined {
  const logo = path.join(REPO_ROOT, "assets", "logo.png");
  if (!existsSync(logo)) return undefined;
  const base64 = readFileSync(logo).toString("base64");
  return `data:image/png;base64,${base64}`;
}

function homologacionTemplate(): string | undefined {
  const packageJson = require.resolve("@arcasdk/pdf/package.json");
  const templatePath = path.join(path.dirname(packageJson), "lib", "templates", "arca-default", "invoice-document.hbs");
  if (!existsSync(templatePath)) return undefined;
  const template = readFileSync(templatePath, "utf-8");
  const css = `
  .homologacion-banner{
    border:1.5pt solid #b00020;
    background:#fff0f0;
    color:#b00020;
    text-align:center;
    font-size:12pt;
    font-weight:bold;
    letter-spacing:.3px;
    padding:6px 8px;
    margin:-1px 0 6px 0;
  }`;
  return template
    .replace("</style>", `${css}\n</style>`)
    .replace("  <!-- Header -->", `  <div class="homologacion-banner">${HOMOLOGACION_FOOTER}</div>\n\n  <!-- Header -->`);
}

export async function generateInvoicePdf(data: InvoiceData, options: GenerateInvoicePdfOptions = {}): Promise<Buffer> {
  const generator = new InvoicePdfGenerator({
    includeQr: true,
    copies: ["ORIGINAL", "DUPLICADO"],
    logo: logoDataUrl(),
    logoWidth: 100,
    footerText: options.homologacion ? HOMOLOGACION_FOOTER : "Comprobante autorizado electrónicamente por ARCA.",
    template: options.homologacion ? homologacionTemplate() : undefined,
  });
  return generator.generate(data);
}
