import assert from "node:assert/strict";
import test from "node:test";
import { mergeDfeRegister, validateDfeMetadata } from "./dfe.js";

test("registra solo metadata mínima y deduplica por message-id", () => {
  const first = mergeDfeRegister({
    checkedAt: "2026-09-11T12:00:00Z",
    candidates: [{
      message_id: "abc123",
      received_at: "2026-09-11T10:00:00Z",
      sender: "alertas@arca.gob.ar",
      subject: "Nueva comunicación en DFE",
      due_on: "2026-09-20",
    }],
  });
  const second = mergeDfeRegister({
    current: first.register,
    checkedAt: "2026-09-11T17:00:00Z",
    candidates: [{
      message_id: "abc123",
      received_at: "2026-09-11T10:00:00Z",
      sender: "alertas@arca.gob.ar",
      subject: "Nueva comunicación en DFE",
    }],
  });
  assert.equal(first.newNotices.length, 1);
  assert.equal(second.newNotices.length, 0);
  assert.equal(second.register.notices.length, 1);
  assert.equal(second.register.last_checked_at, "2026-09-11T17:00:00Z");
});

test("rechaza cuerpos, snippets y adjuntos aunque vengan anidados", () => {
  const safe = {
    message_id: "abc123",
    received_at: "2026-09-11T10:00:00Z",
    sender: "alertas@arca.gob.ar",
    subject: "Nueva comunicación en DFE",
  };
  assert.throws(() => validateDfeMetadata({ ...safe, snippet: "contenido" } as never), /no está permitido/);
  assert.throws(() => validateDfeMetadata({ ...safe, metadata: { attachments: [] } } as never), /no está permitido/);
});
