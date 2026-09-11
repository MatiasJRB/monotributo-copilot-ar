import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DFE_REGISTER_SCHEMA_VERSION = 1;

export type DfeNoticeStatus = "new" | "reviewed" | "dismissed";

export type DfeNoticeMetadata = {
  message_id: string;
  received_at: string;
  sender: string;
  subject: string;
  due_on?: string | null;
};

export type DfeNotice = DfeNoticeMetadata & {
  status: DfeNoticeStatus;
  detected_at: string;
  reviewed_at: string | null;
};

export type DfeRegister = {
  schema_version: 1;
  source: "gmail_read_only";
  last_checked_at: string;
  notices: DfeNotice[];
};

const FORBIDDEN_FIELDS = new Set([
  "body",
  "body_html",
  "body_text",
  "snippet",
  "content",
  "attachments",
  "attachment",
  "raw",
]);

function requireTimestamp(value: string, name: string): string {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${name} debe ser ISO-8601`);
  return value;
}

function requireIsoDate(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} debe usar YYYY-MM-DD`);
  }
  return value;
}

function rejectSensitivePayloadFields(value: unknown, pathPrefix = "input"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSensitivePayloadFields(item, `${pathPrefix}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) throw new Error(`${pathPrefix}.${key} no está permitido en el registro DFE`);
    rejectSensitivePayloadFields(child, `${pathPrefix}.${key}`);
  }
}

export function validateDfeMetadata(input: DfeNoticeMetadata): DfeNoticeMetadata {
  rejectSensitivePayloadFields(input);
  if (!input.message_id.trim() || input.message_id.length > 256) throw new Error("DFE message_id inválido");
  requireTimestamp(input.received_at, "DFE received_at");
  if (!input.sender.trim() || input.sender.length > 160) throw new Error("DFE sender inválido");
  if (!input.subject.trim() || input.subject.length > 240) throw new Error("DFE subject inválido");
  if (input.due_on) requireIsoDate(input.due_on, "DFE due_on");
  return input;
}

export function validateDfeRegister(register: DfeRegister): DfeRegister {
  rejectSensitivePayloadFields(register);
  if (register.schema_version !== DFE_REGISTER_SCHEMA_VERSION) throw new Error("DFE schema_version no soportada");
  if (register.source !== "gmail_read_only") throw new Error("DFE source inválido");
  requireTimestamp(register.last_checked_at, "DFE last_checked_at");
  const ids = new Set<string>();
  for (const notice of register.notices) {
    validateDfeMetadata(notice);
    requireTimestamp(notice.detected_at, "DFE detected_at");
    if (notice.reviewed_at) requireTimestamp(notice.reviewed_at, "DFE reviewed_at");
    if (!["new", "reviewed", "dismissed"].includes(notice.status)) throw new Error("DFE status inválido");
    if (ids.has(notice.message_id)) throw new Error("DFE message_id duplicado");
    ids.add(notice.message_id);
  }
  return register;
}

export function mergeDfeRegister(options: {
  current?: DfeRegister | null;
  candidates: DfeNoticeMetadata[];
  checkedAt?: string;
}): { register: DfeRegister; newNotices: DfeNotice[] } {
  const checkedAt = requireTimestamp(options.checkedAt ?? new Date().toISOString(), "DFE checkedAt");
  const current = options.current ? validateDfeRegister(options.current) : null;
  const notices = [...(current?.notices ?? [])];
  const known = new Set(notices.map((notice) => notice.message_id));
  const newNotices: DfeNotice[] = [];
  for (const candidate of options.candidates.map(validateDfeMetadata)) {
    if (known.has(candidate.message_id)) continue;
    const notice: DfeNotice = {
      ...candidate,
      due_on: candidate.due_on ?? null,
      status: "new",
      detected_at: checkedAt,
      reviewed_at: null,
    };
    notices.push(notice);
    newNotices.push(notice);
    known.add(candidate.message_id);
  }
  const register: DfeRegister = {
    schema_version: DFE_REGISTER_SCHEMA_VERSION,
    source: "gmail_read_only",
    last_checked_at: checkedAt,
    notices: notices.sort((a, b) => b.received_at.localeCompare(a.received_at) || a.message_id.localeCompare(b.message_id)),
  };
  return { register, newNotices };
}

export function readDfeRegister(filePath: string): DfeRegister {
  return validateDfeRegister(JSON.parse(readFileSync(filePath, "utf-8")) as DfeRegister);
}

export function writeDfeRegister(filePath: string, register: DfeRegister): string {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(validateDfeRegister(register), null, 2)}\n`, { mode: 0o600 });
  return resolved;
}
