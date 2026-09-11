# Seguridad

## Datos que nunca deben versionarse

- CUIT real, certificados, claves privadas, CSR y tickets WSAA.
- Facturas, CAE, PDFs y respuestas productivas de ARCA.
- Exportaciones de CCMA, DFE, bancos o billeteras.
- Datos de clientes, correos y domicilios.

El repositorio ignora `secrets/`, `tickets/`, `data/` y archivos `.env`.

## Producción

La homologación es el entorno inicial. La emisión productiva exige flags separados,
la frase exacta `EMITIR FACTURA REAL` y no admite `--force`. Antes de reintentar
una respuesta dudosa hay que consultar el último comprobante en ARCA.

## Reportes fiscales

Los comandos fiscales son de lectura. No generan ni pagan VEP, no reimputan saldos
y no presentan recategorizaciones. Un dato ausente se conserva como desconocido,
nunca se interpreta como cero.

## Reportar una vulnerabilidad

No abras un issue con credenciales o datos fiscales. Usá la sección privada
**Security advisories** del repositorio.
