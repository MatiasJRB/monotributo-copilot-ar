export const COMPROBANTE_TIPO: Record<string, { codigo: number; letra: string; descripcion: string }> = {
  "factura a": { codigo: 1, letra: "A", descripcion: "FACTURA" },
  "factura b": { codigo: 6, letra: "B", descripcion: "FACTURA" },
  "factura c": { codigo: 11, letra: "C", descripcion: "FACTURA" },
  "nota de debito a": { codigo: 2, letra: "A", descripcion: "NOTA DE DÉBITO" },
  "nota de credito a": { codigo: 3, letra: "A", descripcion: "NOTA DE CRÉDITO" },
  "nota de débito a": { codigo: 2, letra: "A", descripcion: "NOTA DE DÉBITO" },
  "nota de crédito a": { codigo: 3, letra: "A", descripcion: "NOTA DE CRÉDITO" },
  "nota de debito c": { codigo: 13, letra: "C", descripcion: "NOTA DE DÉBITO" },
  "nota de credito c": { codigo: 14, letra: "C", descripcion: "NOTA DE CRÉDITO" },
  "nota de débito c": { codigo: 13, letra: "C", descripcion: "NOTA DE DÉBITO" },
  "nota de crédito c": { codigo: 14, letra: "C", descripcion: "NOTA DE CRÉDITO" },
};

export const CONDICION_IVA_RECEPTOR: Record<string, number> = {
  "iva responsable inscripto": 1,
  "responsable inscripto": 1,
  "ri": 1,
  "iva sujeto exento": 4,
  "iva exento": 4,
  "exento": 4,
  "consumidor final": 5,
  "cf": 5,
  "responsable monotributo": 6,
  "monotributo": 6,
  "monotributista": 6,
  "sujeto no categorizado": 7,
  "proveedor del exterior": 8,
  "cliente del exterior": 9,
  "iva liberado": 10,
  "monotributista social": 13,
  "iva no alcanzado": 15,
  "no alcanzado": 15,
  "monotributo trabajador independiente promovido": 16,
};

export const DOC_TIPO: Record<string, number> = {
  cuit: 80,
  cuil: 86,
  dni: 96,
  consumidor_final: 99,
};

export function normalize(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function comprobanteFromText(value: string) {
  const key = normalize(value || "Factura C");
  const mapped = COMPROBANTE_TIPO[key];
  if (!mapped) throw new Error(`Tipo de comprobante no soportado: ${value}`);
  return mapped;
}

export function condicionIvaId(value: string): number {
  const key = normalize(value || "Consumidor Final");
  const id = CONDICION_IVA_RECEPTOR[key];
  if (!id) throw new Error(`Condición IVA receptor no soportada: ${value}`);
  return id;
}

export function documentForCuit(cuit: string) {
  const clean = (cuit || "").replace(/\D/g, "");
  if (!clean) return { DocTipo: DOC_TIPO.consumidor_final, DocNro: 0, documentoTipo: "Consumidor Final", documentoNro: "0" };
  if (clean.length !== 11) throw new Error(`CUIT inválido: ${cuit}`);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(clean[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const expectedDigit = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  if (Number(clean[10]) !== expectedDigit) throw new Error(`CUIT inválido: ${cuit} (dígito verificador)`);
  return { DocTipo: DOC_TIPO.cuit, DocNro: Number(clean), documentoTipo: "CUIT", documentoNro: clean };
}
