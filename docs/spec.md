# Especificación

## Problema

Una persona monotributista necesita emitir comprobantes y controlar su situación
fiscal periódicamente. Las herramientas existentes suelen resolver la conexión con
WSFE, pero dejan afuera la cobertura de fuentes, la categoría, CCMA, vencimientos,
recategorización, DFE y el límite entre automatización y decisión profesional.

## Objetivo

Proveer un núcleo reproducible, auditable y seguro que prepare información y
automatice tareas mecánicas, manteniendo intervención humana para cualquier acción
irreversible o interpretación extraordinaria.

## Alcance

- Factura C de servicios en pesos.
- Homologación, dry-run, producción con doble gate y PDF.
- Historial WSFE e importación del portal.
- Facturas, notas de débito y notas de crédito.
- Ventana móvil de doce meses.
- Parámetros y categorías versionados.
- Expediente de recategorización.
- Resumen financiero agregado y anonimizado.
- Snapshot CCMA, vencimientos y control de aplicación de pagos.
- Borrador informativo de VEP únicamente con detalle reconciliado.
- Registro mínimo de alertas DFE.
- Plantilla y escalamiento de casos extraordinarios.

## Fuera de alcance

- Guardar o pedir Clave Fiscal.
- Automatizar el portal autenticado de ARCA.
- Pagar o presentar VEP.
- Reimputar saldos.
- Presentar recategorizaciones.
- Contestar notificaciones o defensas.
- Reemplazar asesoramiento contable o jurídico.

## Criterios de aceptación

1. Los tests no realizan llamadas productivas.
2. Una fuente ausente nunca se interpreta como cero.
3. Producción exige flags y frase exacta; `--force` está prohibido.
4. Una respuesta dudosa obliga a consultar ARCA antes de reintentar.
5. CCMA vencido no puede informar “sin deuda verificada”.
6. El VEP queda bloqueado sin detalle conciliado.
7. La recategorización permanece en monitoreo hasta cerrar la ventana.
8. El registro DFE rechaza cuerpos, snippets y adjuntos.
9. Los ejemplos no contienen datos fiscales ni comerciales reales.
