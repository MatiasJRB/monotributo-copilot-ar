import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCTION_CONFIRMATION, productionConfirmationMatches } from "./safety.js";

test("producción requiere una frase exacta", () => {
  assert.equal(productionConfirmationMatches(PRODUCTION_CONFIRMATION), true);
  assert.equal(productionConfirmationMatches("emitir factura real"), false);
  assert.equal(productionConfirmationMatches(true), false);
});
