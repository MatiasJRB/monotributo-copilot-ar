import assert from "node:assert/strict";
import test from "node:test";
import { documentForCuit } from "./mappings.js";

test("acepta un CUIT con dígito verificador válido", () => {
  const result = documentForCuit("20-99999999-9");
  assert.equal(result.DocTipo, 80);
  assert.equal(result.DocNro, 20999999999);
});

test("rechaza un CUIT con dígito verificador inválido", () => {
  assert.throws(() => documentForCuit("20-99999999-8"), /dígito verificador/);
});

test("permite consumidor final sin documento", () => {
  assert.deepEqual(documentForCuit(""), {
    DocTipo: 99,
    DocNro: 0,
    documentoTipo: "Consumidor Final",
    documentoNro: "0",
  });
});
