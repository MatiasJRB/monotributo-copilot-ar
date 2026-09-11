#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function patchFile(target, applyPatch) {
  if (!existsSync(target)) {
    console.warn(`[patch-arcasdk] No existe ${target}; omito patch`);
    return;
  }

  const original = readFileSync(target, "utf-8");
  const updated = applyPatch(original);
  if (updated === original) return;
  writeFileSync(target, updated, "utf-8");
}

const billingTarget = path.resolve(
  "node_modules/@arcasdk/core/lib/infrastructure/outbound/adapters/electronic-billing/electronic-billing-repository.js",
);
patchFile(billingTarget, (text) => {
  if (text.includes("CanMisMonExt: voucherData.CanMisMonExt")) {
    console.log("[patch-arcasdk] CanMisMonExt ya está aplicado");
    return text;
  }

  const needle = "                MonCotiz: voucherData.MonCotiz,\n";
  if (!text.includes(needle)) {
    console.warn("[patch-arcasdk] No encontré punto de inserción MonCotiz; revisar SDK");
    return text;
  }

  console.log("[patch-arcasdk] Agregado CanMisMonExt al request WSFEv1");
  return text.replaceAll(needle, `${needle}                CanMisMonExt: voucherData.CanMisMonExt,\n`);
});

const soapTarget = path.resolve(
  "node_modules/@arcasdk/core/lib/infrastructure/outbound/adapters/soap/soap-client.js",
);
patchFile(soapTarget, (text) => {
  if (text.includes('ciphers: "DEFAULT@SECLEVEL=1"')) {
    console.log("[patch-arcasdk] TLS legado de WSFE ya está aplicado");
    return text;
  }

  const needle = "                        minDHSize: constants_1.MIN_DH_SIZE_LEGACY,\n";
  if (!text.includes(needle)) {
    console.warn("[patch-arcasdk] No encontré el agente HTTPS legado; revisar SDK");
    return text;
  }

  console.log("[patch-arcasdk] Habilitado SECLEVEL=1 sólo para el agente HTTPS legado de ARCA");
  return text.replace(
    needle,
    `${needle}                        ciphers: "DEFAULT@SECLEVEL=1",\n`,
  );
});
