# Monotributo Copilot AR

Herramientas TypeScript para que una persona monotributista pueda automatizar
trabajo operativo sin convertir una automatización en su contador.

El proyecto combina dos capas:

1. **Facturación directa:** WSAA + WSFEv1, Factura C de servicios en pesos, PDF y
   una API local de consulta.
2. **Control fiscal read-only:** historial, notas de crédito/débito, límites de
   categoría, recategorización, CCMA, vencimientos, conciliación y alertas DFE.

> **No es asesoramiento contable ni jurídico.** No reemplaza la intervención
> profesional cuando una situación requiere interpretación, firma, presentación,
> defensa o una decisión fiscal extraordinaria.

## Por qué existe

Emitir una factura es sólo una parte del trabajo. El riesgo cotidiano está en
olvidar deuda, interpretar como cero una fuente ausente, exceder una categoría,
recategorizar con una ventana incompleta o ejecutar una acción irreversible sin
revisión humana.

Monotributo Copilot AR modela esos riesgos explícitamente:

- una fuente faltante produce estado `incomplete`;
- un snapshot CCMA viejo no prueba deuda cero;
- un match entre depósito y factura es una pista, no una prueba de cobro;
- un VEP queda bloqueado si el detalle no reconcilia con el total;
- la recategorización no se habilita antes del cierre de su ventana;
- producción requiere una confirmación exacta y separada.

## Estado

- Factura C de servicios en ARS mediante WSFEv1.
- Dry-run, homologación y producción separadas.
- Consulta del último comprobante antes de reintentos.
- PDF sólo después de una autorización aceptada.
- Historial de Facturas C, Notas de Débito C y Notas de Crédito C.
- Importación del historial descargado desde el portal.
- Ventana móvil de doce meses y tabla de categorías versionada.
- Expediente semestral de recategorización.
- Snapshot CCMA y borrador de VEP con gate de conciliación.
- Contrato financiero anonimizado y conciliación heurística.
- Registro DFE con metadata mínima y prohibición de cuerpos/adjuntos.
- 34 pruebas automatizadas sin llamadas productivas.

## Requisitos

- Node.js 20 o superior.
- OpenSSL para generar una clave y un CSR.
- Para conectarse: certificado de ARCA y punto de venta habilitado.
- Para experimentar localmente no hacen falta credenciales reales.

## Inicio rápido seguro

```bash
git clone https://github.com/MatiasJRB/monotributo-copilot-ar.git
cd monotributo-copilot-ar
npm ci
cp env.example .env
npm test
npm run check
```

El archivo `.env` empieza en homologación. No completes datos reales hasta leer
[Seguridad](SECURITY.md) y [Operación](docs/operations.md).

### Probar el motor fiscal con ejemplos

```bash
npm run fiscal -- report \
  --as-of 2026-09-10 \
  --portal-history examples/fiscal/portal-history.example.csv \
  --portal-from 2025-09-01 \
  --portal-to 2026-09-10 \
  --finance-summary examples/fiscal/finance-summary.example.json \
  --payments-ledger examples/fiscal/payments.example.csv \
  --ccma examples/fiscal/ccma.example.json \
  --recategorization-parameters examples/fiscal/recategorization-parameters.example.json \
  --current-category B \
  --output-dir /tmp/monotributo-copilot-demo
```

### Probar la preparación de una factura sin emitir

Copiá el fixture a la ubicación de datos ignorada por Git:

```bash
mkdir -p data/billing/2026-08
cp examples/billing/2026-08/facturacion_dev.csv data/billing/2026-08/
npm run arca:dry-run -- --periodo 2026-08 --cliente cliente-demo --source dev
```

## Comandos

| Comando | Efecto |
|---|---|
| `npm run doctor` | Verifica configuración sin mostrar secretos |
| `npm run arca:status` | Consulta el estado de WSFE |
| `npm run arca:last` | Consulta el último comprobante |
| `npm run arca:dry-run` | Prepara request y preview; no emite |
| `npm run arca:emit-homo` | Emite únicamente en homologación |
| `npm run arca:render-pdf` | Regenera un PDF desde una respuesta aceptada |
| `npm run fiscal -- history …` | Descarga historial WSFE |
| `npm run fiscal -- report …` | Construye reporte desde fuentes explícitas |
| `npm run fiscal -- sync-report …` | Consulta y genera el reporte |
| `npm run dfe -- merge …` | Mezcla metadata mínima de alertas DFE |

La emisión productiva existe, pero no tiene un alias corto deliberadamente. Consultá
la operación completa antes de usarla.

## Arquitectura

```text
ARCA WSFE ---------> historial normalizado -----+
Export del portal -> importador CSV ------------+--> motor fiscal puro
Resumen financiero anonimizado -----------------+
Snapshot CCMA -----------------------------------+
Metadata DFE --> registro mínimo por excepción

CSV de facturación --> dry-run --> WSFE --> respuesta aceptada --> PDF
```

El código no automatiza el portal de ARCA, no almacena Clave Fiscal y no incorpora
un navegador desatendido.

## Documentación

- [Especificación](docs/spec.md)
- [Arquitectura](docs/architecture.md)
- [Operación](docs/operations.md)
- [Roadmap](docs/roadmap.md)
- [Seguridad](SECURITY.md)
- [Contribuir](CONTRIBUTING.md)

## Licencia

MIT. El proyecto no está afiliado, respaldado ni mantenido por ARCA.
