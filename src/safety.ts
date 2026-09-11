export const PRODUCTION_CONFIRMATION = "EMITIR FACTURA REAL";

export function productionConfirmationMatches(value: unknown): boolean {
  return value === PRODUCTION_CONFIRMATION;
}
