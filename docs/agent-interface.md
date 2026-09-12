# Interfaz de agentes

## Idea central

Monotributo Copilot AR es **agent-operated**. La persona no debería memorizar una
secuencia de comandos ni navegar un dashboard para cada control: expresa una
intención y un agente la traduce a herramientas deterministas del repositorio.

La separación es deliberada:

- el agente conversa, planifica, pide los datos mínimos y explica incertidumbre;
- la skill aporta el procedimiento y los límites operativos;
- la CLI valida argumentos, ejecuta operaciones y devuelve JSON;
- el motor fiscal calcula sin efectos externos;
- la persona conserva la aprobación de toda acción sensible;
- ARCA sigue siendo la fuente de verdad para autorizaciones y estado fiscal.

## Ciclo de operación

```text
intención en lenguaje natural
          |
          v
 agente carga la skill
          |
          v
 controles read-only + artefactos JSON/Markdown
          |
          v
 resumen con evidencia, faltantes y acción propuesta
          |
          v
 aprobación humana cuando corresponde
          |
          v
 ejecución acotada + verificación contra ARCA
```

## Skill incluida

[`skills/monotributo-copilot-ar/SKILL.md`](../skills/monotributo-copilot-ar/SKILL.md)
es la primera interfaz de agente mantenida por el proyecto. Es portable: no
acopla el núcleo a un proveedor de modelos y sólo asume que el agente puede
ejecutar comandos locales, leer archivos y detenerse para pedir aprobación.

La skill define:

- cómo enrutar facturación, reportes, CCMA, categoría, recategorización y DFE;
- qué evidencia mostrar antes de proponer una acción;
- cuándo un dato debe quedar como desconocido;
- qué acciones requieren aprobación inmediata;
- qué tareas quedan fuera de la automatización.

## Human-in-the-loop

Read-only no significa infalible. El agente debe mostrar cobertura, antigüedad de
las fuentes y supuestos. Para emitir en producción presenta destinatario, monto,
período, punto de venta, entorno y comando final antes de detenerse por aprobación.

El agente nunca recibe permiso implícito para pagar VEP, reimputar saldos,
presentar recategorizaciones, responder DFE o resolver casos extraordinarios.

## Extensión

Otros agentes pueden integrarse sobre la misma CLI y los mismos contratos JSON.
Una futura capa MCP puede exponerlos como herramientas tipadas sin cambiar las
reglas del dominio. Hasta entonces, la skill es la interfaz de referencia y la
CLI es el protocolo ejecutable.
