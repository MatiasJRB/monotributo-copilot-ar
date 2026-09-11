# Operación

## 1. Homologación

1. Copiá `env.example` a `.env`.
2. Completá un CUIT y punto de venta de homologación.
3. Generá clave y CSR con `npm run setup:csr:homo`.
4. Subí únicamente el CSR a ARCA y guardá el certificado en `secrets/homo/`.
5. Ejecutá `npm run doctor`, `npm run arca:status` y un dry-run.
6. Emití pruebas sólo con `npm run arca:emit-homo`.

## 2. Producción

Antes de emitir:

- verificá destinatario, importe, período, punto de venta y tipo;
- ejecutá dry-run;
- consultá el último comprobante;
- confirmá que no existe una respuesta aceptada local;
- usá `--production --allow-production-emit`;
- escribí exactamente `--confirm-production "EMITIR FACTURA REAL"`.

Producción no admite `--force`. Ante timeout o respuesta incierta consultá el
último comprobante en ARCA antes de cualquier reintento.

## 3. Control fiscal

Cargá sólo fuentes con cobertura y fecha explícitas. Para el historial del portal
deben informarse `--portal-from` y `--portal-to`. Para CCMA, `null` significa
“no verificado”, no cero.

El reporte puede preparar un borrador informativo de VEP, pero nunca lo genera ni
lo paga. La recategorización sólo queda lista para revisión humana cuando la
ventana oficial está cerrada y los parámetros requeridos están presentes.

## 4. DFE

El comando DFE acepta exclusivamente:

- `message_id`
- `received_at`
- `sender`
- `subject`
- `due_on`

No almacenes cuerpo, snippet, adjuntos ni credenciales.
