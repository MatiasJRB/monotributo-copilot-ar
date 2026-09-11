# Arquitectura

## Módulos

### Facturación

- `config.ts`: carga configuración y secretos fuera de Git.
- `billing.ts`: normaliza el CSV y prepara el comprobante.
- `mappings.ts`: comprobantes, condición IVA y CUIT.
- `operations.ts`: consultas, emisión y PDF.
- `safety.ts`: frase de confirmación productiva.
- `out.ts`: artefactos locales ignorados.
- `cli.ts`: interfaz explícita para la persona operadora.
- `server.ts` y `ui.ts`: API/UI local de consulta.

### Control fiscal

- `fiscal.ts`: cálculo puro, contratos, categoría, CCMA y reportes.
- `fiscalCli.ts`: carga de fuentes explícitas.
- `dfe.ts`: validación y deduplicación de metadata.
- `dfeCli.ts`: registro mínimo de alertas.
- `csv.ts` y `dates.ts`: adaptadores deterministas.

## Fronteras

El motor fiscal recibe datos ya obtenidos y no abre sesiones web. La única capa con
acceso a WSFE es el cliente ARCA. Las capacidades read-only y de escritura usan
comandos diferentes.

Los datos reales viven bajo `data/`; certificados y tickets viven bajo
`secrets/` y `tickets/`. Las tres rutas están ignoradas por Git.

## Decisiones

- Artefactos JSON/Markdown antes que una base de datos.
- Estado incompleto antes que falsa precisión.
- Cálculo puro para reglas fiscales y tests.
- Contratos financieros anonimizados.
- Escrituras fiscales con gates humanos explícitos.
- Casos extraordinarios fuera del flujo automático.
