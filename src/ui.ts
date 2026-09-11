export function facturadorHtml(): string {
  return String.raw`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Cobranzas y facturación</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --surface: #ffffff;
      --ink: #18201d;
      --muted: #62706a;
      --line: #d9e0dc;
      --accent: #087f5b;
      --accent-dark: #056244;
      --accent-soft: #e7f5ef;
      --warning: #9a6700;
      --warning-soft: #fff4ce;
      --danger: #b42318;
      --danger-soft: #feeceb;
      --radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .48; }
    :focus-visible { outline: 3px solid rgba(8, 127, 91, .28); outline-offset: 2px; }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    .brand small { display: block; color: var(--muted); font-weight: 700; margin-bottom: 6px; }
    h1 { margin: 0; font-size: clamp(30px, 5vw, 46px); letter-spacing: -.045em; line-height: 1; }
    .env { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 8px 12px; font-size: 13px; font-weight: 750; }
    .env.prod { border-color: #f2b8b5; background: var(--danger-soft); color: var(--danger); }
    .env.homo { border-color: #ead28b; background: var(--warning-soft); color: var(--warning); }
    .toolbar, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
    input, select { min-height: 44px; border: 1px solid #bdc8c2; border-radius: 9px; background: #fff; color: var(--ink); padding: 10px 12px; }
    .toolbar { display: grid; grid-template-columns: minmax(160px, 210px) minmax(160px, 240px) auto 1fr; gap: 10px; align-items: end; padding: 14px; margin-bottom: 18px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 13px; font-weight: 700; }
    .button { min-height: 44px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--ink); padding: 10px 15px; font-weight: 760; }
    .button:hover { background: #f7f9f8; }
    .button:active { transform: translateY(1px); }
    .button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    .button.primary:hover { background: var(--accent-dark); }
    .button.danger { border-color: var(--danger); background: var(--danger); color: #fff; }
    .server-state { justify-self: end; align-self: center; color: var(--muted); font-size: 13px; }
    .layout { display: grid; grid-template-columns: minmax(300px, .86fr) minmax(0, 1.4fr); gap: 18px; }
    .panel { min-height: 420px; overflow: hidden; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
    h2 { margin: 0; font-size: 18px; letter-spacing: -.015em; }
    .count { color: var(--muted); font-size: 13px; }
    .invoice-list { display: grid; }
    .invoice-row { width: 100%; border: 0; border-bottom: 1px solid var(--line); background: #fff; color: inherit; padding: 16px 20px; text-align: left; }
    .invoice-row:hover, .invoice-row.active { background: #f6faf8; }
    .invoice-row:last-child { border-bottom: 0; }
    .row-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 7px; }
    .row-name { font-weight: 780; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-amount { font-weight: 800; white-space: nowrap; }
    .row-meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 13px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; background: #edf1ef; color: #45514b; font-size: 12px; font-weight: 750; }
    .badge.ok { background: var(--accent-soft); color: var(--accent-dark); }
    .badge.bad { background: var(--danger-soft); color: var(--danger); }
    .detail { padding: 22px; }
    .empty { display: grid; place-items: center; min-height: 330px; padding: 32px; color: var(--muted); text-align: center; }
    .detail-title { margin: 0 0 6px; font-size: 27px; letter-spacing: -.035em; }
    .detail-sub { margin: 0 0 24px; color: var(--muted); }
    dl { display: grid; grid-template-columns: 150px 1fr; gap: 12px 18px; margin: 0; }
    dt { color: var(--muted); font-size: 13px; font-weight: 700; }
    dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; }
    .notice { margin-top: 22px; border-radius: 10px; padding: 13px 14px; background: var(--warning-soft); color: #664d00; line-height: 1.45; }
    .notice.bad { background: var(--danger-soft); color: var(--danger); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
    .feedback { min-height: 24px; margin-top: 14px; color: var(--muted); font-size: 14px; }
    .feedback.error { color: var(--danger); }
    @media (max-width: 780px) {
      .shell { width: min(100% - 20px, 620px); padding-top: 20px; }
      header { display: grid; align-items: start; }
      .env { justify-self: start; }
      .toolbar > * { width: 100%; min-width: 0; }
      .toolbar { grid-template-columns: 1fr; }
      .server-state { justify-self: start; }
      .layout { grid-template-columns: 1fr; }
      .panel { min-height: 0; }
      dl { grid-template-columns: 1fr; gap: 5px; }
      dd { margin-bottom: 8px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div class="brand"><small>Monotributo Copilot AR</small><h1>Control fiscal y facturación</h1></div>
      <div id="environment" class="env">Leyendo entorno</div>
    </header>

    <section class="toolbar" aria-label="Filtros de cobranzas">
      <label>Período<input id="period" type="month" /></label>
      <button id="load" class="button primary">Cargar clientes</button>
      <div id="server-state" class="server-state">Todavía no conectado</div>
    </section>

    <div class="layout">
      <section class="panel" aria-labelledby="invoice-heading">
        <div class="panel-head"><h2 id="invoice-heading">Clientes considerados</h2><span id="count" class="count">0</span></div>
        <div id="invoice-list" class="invoice-list"><div class="empty">Cargá un período para revisar clientes y cobranzas.</div></div>
      </section>

      <section class="panel" aria-labelledby="detail-heading">
        <div class="panel-head"><h2 id="detail-heading">Estado de cobranza</h2></div>
        <div id="detail" class="empty">Elegí un cliente para ver la factura y el estado del pago.</div>
      </section>
    </div>
  </main>

  <script>
    const state = { items: [], selected: null, environment: null };
    const $ = (id) => document.getElementById(id);
    const now = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit" }).format(new Date());
    $("period").value = now;

    function money(value, currency = "ARS") {
      const raw = String(value || "0").replace(/\./g, "").replace(",", ".");
      return new Intl.NumberFormat("es-AR", { style: "currency", currency: currency === "USD" ? "USD" : "ARS" }).format(Number(raw));
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, options);
      if (!response.ok) {
        let message = "Error " + response.status;
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      return response;
    }

    async function loadEnvironment() {
      const data = await fetch("/health").then((response) => response.json());
      state.environment = data.production ? "prod" : "homo";
      const element = $("environment");
      element.className = "env " + state.environment;
      element.textContent = data.production ? "PRODUCCIÓN: facturas reales" : "HOMOLOGACIÓN: pruebas sin valor fiscal";
    }

    async function loadInvoices() {
      const period = $("period").value;
      if (!period) return;
      $("server-state").textContent = "Consultando cobranzas y archivos locales";
      try {
        const catalogResponse = await api("/arca/view/collections?periodo=" + encodeURIComponent(period));
        state.items = await catalogResponse.json();
        $("server-state").textContent = "Datos locales cargados";
        state.selected = state.items.find((item) => item.clienteId === state.selected?.clienteId) || null;
        renderList();
        renderDetail();
        api("/arca/view/status").then((response) => response.json()).then((server) => {
          $("server-state").textContent = Object.values(server).every((value) => value === "OK") ? "ARCA disponible" : "ARCA respondió con alertas";
        }).catch(() => {
          $("server-state").textContent = "Datos locales cargados · ARCA sin verificar";
        });
      } catch (error) {
        $("server-state").textContent = error.message;
        $("invoice-list").innerHTML = '<div class="empty">No pude cargar las cobranzas. Revisá el período o el estado del servicio.</div>';
      }
    }

    function renderList() {
      $("count").textContent = String(state.items.length);
      if (!state.items.length) {
        $("invoice-list").innerHTML = '<div class="empty">No hay clientes cargados para este período.</div>';
        return;
      }
      $("invoice-list").innerHTML = state.items.map((item) => {
        const invoiceStatus = !item.valid ? '<span class="badge bad">Revisar datos</span>' : item.estadoFactura === "enviada" ? '<span class="badge ok">Factura enviada</span>' : item.status === "accepted" ? '<span class="badge ok">Factura emitida</span>' : '<span class="badge">Factura pendiente</span>';
        const paymentStatus = item.estadoPago === "pagado" ? '<span class="badge ok">Pagado</span>' : '<span class="badge bad">Pago pendiente</span>';
        const active = state.selected?.clienteId === item.clienteId ? " active" : "";
        return '<button class="invoice-row' + active + '" data-client="' + escapeHtml(item.clienteId) + '" onclick="selectClient(this.dataset.client)"><span class="row-top"><span class="row-name">' + escapeHtml(item.razonSocial) + '</span><span class="row-amount">' + escapeHtml(item.importeLabel || money(item.monto, item.moneda)) + '</span></span><span class="row-meta">' + invoiceStatus + paymentStatus + '<span>Vence ' + escapeHtml(item.vencimiento || "sin fecha") + '</span></span></button>';
      }).join("");
    }

    function selectClient(clienteId) {
      state.selected = state.items.find((item) => item.clienteId === clienteId) || null;
      renderList();
      renderDetail();
    }

    function renderDetail() {
      const item = state.selected;
      if (!item) {
        $("detail").className = "empty";
        $("detail").innerHTML = "Elegí un cliente para ver la factura y el estado del pago.";
        return;
      }
      $("detail").className = "detail";
      const problem = item.error ? '<div class="notice bad">' + escapeHtml(item.error) + '</div>' : '<div class="notice">Vista de consulta. Emitir facturas y enviar recordatorios se opera únicamente por Codex y siempre con aprobación.</div>';
      $("detail").innerHTML = '<h3 class="detail-title">' + escapeHtml(item.razonSocial) + '</h3>' +
        '<p class="detail-sub">' + escapeHtml(item.importeLabel || money(item.monto, item.moneda)) + '</p>' +
        '<dl><dt>CUIT receptor</dt><dd>' + escapeHtml(item.cuit || "Consumidor final") + '</dd>' +
        '<dt>Condición IVA</dt><dd>' + escapeHtml(item.condicionIva) + '</dd>' +
        '<dt>Servicio</dt><dd>' + escapeHtml(item.descripcion) + '</dd>' +
        '<dt>Período</dt><dd>' + escapeHtml($("period").value) + '</dd>' +
        '<dt>Estado factura</dt><dd>' + escapeHtml(item.estadoFactura) + '</dd>' +
        '<dt>Comprobante</dt><dd>' + escapeHtml(item.comprobante || "Todavía no emitida") + '</dd>' +
        '<dt>Estado pago</dt><dd>' + escapeHtml(item.estadoPago) + '</dd>' +
        '<dt>Vencimiento</dt><dd>' + escapeHtml(item.vencimiento) + '</dd>' +
        '<dt>Medio de pago</dt><dd>' + escapeHtml(item.medioPago || "No informado") + '</dd>' +
        '<dt>Email</dt><dd>' + escapeHtml(item.emailFacturacion || "No informado") + '</dd>' +
        '</dl>' + problem;
    }

    async function downloadPdf() {
      const response = await api("/arca/view/pdf?periodo=" + encodeURIComponent($("period").value) + "&clienteId=" + encodeURIComponent(state.selected.clienteId));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "factura-" + state.selected.clienteId + ".pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    $("load").addEventListener("click", loadInvoices);
    loadEnvironment().then(loadInvoices);
  </script>
</body>
</html>`;
}
