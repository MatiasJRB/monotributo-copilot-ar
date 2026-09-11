export function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Fecha inválida: ${value}`);
  return new Date(Date.UTC(year, month - 1, day));
}

export function periodBounds(periodo: string): { desde: string; hasta: string } {
  const [year, month] = periodo.split("-").map(Number);
  if (!year || !month) throw new Error(`Período inválido: ${periodo}`);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { desde: yyyymmdd(from), hasta: yyyymmdd(to) };
}

export function todayArca(): string {
  const now = new Date();
  const arg = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  return yyyymmdd(arg);
}
