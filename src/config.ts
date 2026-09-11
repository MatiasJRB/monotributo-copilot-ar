import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export type ArcaEnvironment = "homo" | "prod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const SERVICE_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = SERVICE_ROOT;

function loadDotenvIfExists(filePath: string) {
  if (existsSync(filePath)) dotenv.config({ path: filePath, override: false });
}

loadDotenvIfExists(path.join(SERVICE_ROOT, ".env"));
loadDotenvIfExists(path.join(SERVICE_ROOT, "secrets", "arca.env"));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta variable requerida ${name}`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "s", "si", "sí"].includes(value);
}

function resolveMaybeRelative(value: string): string {
  if (path.isAbsolute(value)) return value;
  return path.resolve(SERVICE_ROOT, value);
}

function readSecretContent(contentName: string, pathName: string): string {
  const direct = optional(contentName);
  if (direct) return direct.replace(/\\n/g, "\n");
  const filePath = resolveMaybeRelative(required(pathName));
  if (!existsSync(filePath)) throw new Error(`No existe ${pathName}: ${filePath}`);
  return readFileSync(filePath, "utf-8");
}

export type ArcaConfig = {
  env: ArcaEnvironment;
  production: boolean;
  cuit: number;
  puntoVenta: number;
  cert: string;
  key: string;
  ticketPath: string;
  useHttpsAgent: boolean;
  serviceHost: string;
  servicePort: number;
  serviceToken: string;
  emisor: {
    razonSocial: string;
    domicilioComercial: string;
    condicionIva: string;
    cuit: string;
    iibb: string;
    fechaInicioActividades: string;
    contacto: string;
  };
};

export function getConfig(options: { requireCredentials?: boolean } = {}): ArcaConfig {
  const env = (optional("ARCA_ENV", "homo") as ArcaEnvironment).toLowerCase() as ArcaEnvironment;
  if (!["homo", "prod"].includes(env)) throw new Error("ARCA_ENV debe ser homo o prod");
  const cuit = Number(required("ARCA_CUIT"));
  const puntoVenta = Number(required("ARCA_PUNTO_VENTA"));
  if (!Number.isInteger(cuit) || String(cuit).length !== 11) throw new Error("ARCA_CUIT debe tener 11 dígitos");
  if (!Number.isInteger(puntoVenta) || puntoVenta < 1) throw new Error("ARCA_PUNTO_VENTA inválido");
  const ticketPath = resolveMaybeRelative(optional("ARCA_TICKET_PATH", `./tickets/${env}`));
  const requireCredentials = options.requireCredentials ?? true;
  return {
    env,
    production: env === "prod",
    cuit,
    puntoVenta,
    cert: requireCredentials ? readSecretContent("ARCA_CERT", "ARCA_CERT_PATH") : optional("ARCA_CERT"),
    key: requireCredentials ? readSecretContent("ARCA_KEY", "ARCA_KEY_PATH") : optional("ARCA_KEY"),
    ticketPath,
    useHttpsAgent: boolEnv("ARCA_USE_HTTPS_AGENT", false),
    serviceHost: optional("ARCA_SERVICE_HOST", "127.0.0.1"),
    servicePort: Number(optional("ARCA_SERVICE_PORT", "8787")),
    serviceToken: optional("ARCA_SERVICE_TOKEN", ""),
    emisor: {
      razonSocial: required("ARCA_EMISOR_RAZON_SOCIAL"),
      domicilioComercial: required("ARCA_EMISOR_DOMICILIO"),
      condicionIva: required("ARCA_EMISOR_CONDICION_IVA"),
      cuit: String(cuit),
      iibb: optional("ARCA_EMISOR_IIBB", "-"),
      fechaInicioActividades: optional("ARCA_EMISOR_INICIO_ACTIVIDADES", ""),
      contacto: optional("ARCA_EMISOR_CONTACTO", ""),
    },
  };
}

export function getConfigStatus(): Record<string, unknown> {
  const env = optional("ARCA_ENV", "homo");
  const certPath = optional("ARCA_CERT_PATH");
  const keyPath = optional("ARCA_KEY_PATH");
  return {
    serviceRoot: SERVICE_ROOT,
    repoRoot: REPO_ROOT,
    env,
    cuitSet: Boolean(optional("ARCA_CUIT")),
    puntoVenta: optional("ARCA_PUNTO_VENTA"),
    certPath: certPath ? resolveMaybeRelative(certPath) : null,
    certPathExists: certPath ? existsSync(resolveMaybeRelative(certPath)) : Boolean(optional("ARCA_CERT")),
    keyPath: keyPath ? resolveMaybeRelative(keyPath) : null,
    keyPathExists: keyPath ? existsSync(resolveMaybeRelative(keyPath)) : Boolean(optional("ARCA_KEY")),
    ticketPath: optional("ARCA_TICKET_PATH", `./tickets/${env}`),
  };
}
