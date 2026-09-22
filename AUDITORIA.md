# Auditoría técnica — AdSim (simulador de publicidad programática)

Fecha: 22 septiembre 2026
Alcance: persistencia de estado, ciclo de vida de equipos/campañas, simulación económica (ROAS/ingresos/beneficio), eventos de mercado, marca de agua, pruebas automáticas.

**Nota sobre arquitectura**: esta aplicación no usa React. Es un backend Node.js/Express/Socket.io con estado autoritativo en el servidor, y un frontend en JavaScript vanilla que reconstruye el DOM manualmente en una función `render()` cada vez que llega un evento `state:update` por WebSocket. No hay `useState`/`useEffect`/`useMemo`/hooks porque no hay React — pero los síntomas descritos (inputs que se borran, selects que vuelven a su valor inicial, checkboxes que se desmarcan) tienen una causa raíz estructuralmente equivalente a la que esos hooks existen para evitar en React: **algo está reconstruyendo un formulario con datos que el usuario aún no ha guardado**. La auditoría se hizo con esa hipótesis desde el principio y se confirmó reproduciendo el fallo antes de tocar nada, tal como se pidió.

---

## A. Problemas encontrados

1. Cualquier input de texto, `<select>` o conjunto de chips de segmentación que un usuario tuviera abierto y sin guardar se vaciaba/reseteaba en cuanto llegaba **cualquier** actualización de estado desde el servidor (otro equipo creando una campaña, el profesor añadiendo un equipo, o simplemente el siguiente tick automático de subasta, que ocurre solo cada 5-8 segundos durante toda la partida).
2. Los campos de configuración de la partida (presupuesto, duración, intervalo de subasta) en el panel del profesor se reseteaban a sus valores por defecto en cuanto se añadía un equipo, antes de pulsar "Crear partida".
3. Los selectores de "tipo de evento" y "segmento objetivo" en el panel del profesor volvían a su primera opción en cuanto se resolvía una subasta de fondo (cada 5-8s durante la partida), por lo que era casi imposible seleccionar un evento y activarlo a tiempo.
4. **Equipos y campañas podían desaparecer por completo**, incluso con la partida en marcha: el servidor no impedía que la acción "crear partida" (`profesor:createGame`) se ejecutara mientras había una partida en curso. Una pestaña de profesor duplicada, desincronizada tras una reconexión, o un doble clic, podían borrar de golpe todos los equipos y campañas de todo el mundo, sin aviso ni confirmación.
5. El beneficio/pérdida en euros no se mostraba en ningún sitio de forma explícita — solo ROAS (un ratio), lo que dificultaba responder directamente "¿gané o perdí dinero" a simple vista.
6. El ROAS se mostraba como "0" tanto para un equipo que aún no había gastado nada como para uno que había gastado y no había ganado nada, dos situaciones muy distintas que se confundían visualmente.

## B. Causa raíz de cada problema

**Problemas 1, 2 y 3 comparten una única causa raíz.** El servidor difunde (`io.emit('state:update', ...)`) el estado completo de la partida a **todos** los clientes conectados cada vez que ocurre cualquier mutación: crear un equipo, crear/editar una campaña, y —lo más frecuente— cada vez que se resuelve una subasta automática (cada 5-8 segundos mientras la partida está en marcha). En el cliente, la función `render()` reaccionaba a *cada* uno de esos mensajes reconstruyendo el DOM de las secciones interactivas desde cero (`innerHTML = ''` + reconstrucción completa a partir de los datos del servidor o de valores por defecto). Un formulario abierto no tiene representación en el estado del servidor hasta que se guarda — así que reconstruirlo significaba, literalmente, destruir lo que el usuario tenía escrito y sustituirlo por una versión en blanco. Esto no dependía de que "otro equipo interactuara": bastaba con dejar el formulario abierto y esperar al siguiente tick automático de subasta.

**Problema 4** (el más grave, capaz de tirar una clase entera): `createGame()` en `server/gameEngine.js` no comprobaba en qué estado estaba la partida antes de ejecutar un `reset()` completo (que vacía `teams` y `campaigns`). El botón "Crear / reconfigurar partida" solo se oculta en el cliente cuando `state.status !== 'lobby'`, pero eso es una comodidad de interfaz, no una garantía: cualquier cliente que emita el evento de socket `profesor:createGame` directamente —una pestaña duplicada del profesor con un estado de render desincronizado, una reconexión que tarda en refrescar la UI, o simplemente un clic accidental antes de que la UI reaccione— lo ejecuta igualmente, porque el servidor confiaba en que el cliente nunca lo pediría en mal momento.

**Problemas 5 y 6**: la lógica de negocio (ingresos, gasto, beneficio) ya se calculaba correctamente en el servidor, pero la capa de presentación no exponía el beneficio en euros de forma explícita, y usaba una única representación numérica del ROAS sin distinguir "0 porque no ha gastado" de "0 porque gastó y no ganó nada".

## C. Archivos modificados

- `server/gameEngine.js` — guard de `createGame`, saneamiento de configuración, extracción de la lógica económica pura (`resolveClearingPrice`, `simulateOutcome`).
- `public/js/common.js` — nuevo helper `renderOnce` (pieza central de la corrección), `roasLabel`, `profitLabel`, marca de agua.
- `public/js/profesor.js` — reescrito: separación entre formularios estables (config de partida, controles de evento) y secciones en vivo (listas, ranking, feed de subastas).
- `public/js/equipo.js` — reescrito: mismo patrón para el formulario de campaña (nueva/editar).
- `public/js/pantalla.js` — usa `roasLabel`/`profitLabel` para coherencia visual.
- `public/profesor.html` — separa `lobby-section` y `events-section` en un contenedor "formulario estable" + un contenedor "datos en vivo" cada uno.
- `public/equipo.html` — añade `#campaign-edit-holder` separado de la lista de campañas.
- `public/css/styles.css` — estilos de la marca de agua y colores de beneficio/pérdida.
- `package.json` — scripts `test` y `test:ui`.
- `test/gameEngine.test.js` — **nuevo**, 22 pruebas unitarias.
- `test/ui-persistence.test.js` — **nuevo**, prueba de regresión end-to-end con Playwright.

No se ha eliminado ninguna funcionalidad existente. Los únicos cambios de comportamiento visible son: (a) el formulario de edición de campaña ahora aparece en un bloque fijo encima de la lista en lugar de sustituir la tarjeta en su sitio (cambio necesario para poder dejarlo intacto entre renders — se explica en la sección E); (b) `createGame` ahora puede rechazar la petición con un error explícito si la partida está en curso (antes la ejecutaba siempre, destructivamente).

## D. Cambios realizados (resumen técnico)

Se introdujo `renderOnce(container, key, buildFn)` en `common.js`: reconstruye un contenedor solo cuando cambia su **identidad** (p. ej. qué campaña se está editando, o si el formulario de "nueva campaña" está abierto o cerrado), y lo deja completamente intacto ante cualquier otro `state:update`, venga de donde venga. Esto es, en esencia, el mismo principio que resuelve el problema en React con `key` + componentes controlados, adaptado a esta arquitectura sin depender de un framework nuevo ni añadir estado duplicado.

Se dividió cada `render()` en dos categorías explícitas:
- **Datos en vivo** (ranking, feed de subastas, tarjetas de presupuesto, lista de campañas en modo lectura, banner de eventos activos): se refrescan en cada `state:update`, porque no contienen texto ni selecciones sin guardar del usuario.
- **Formularios interactivos** (nueva campaña, editar campaña, configuración inicial de partida, selector de evento a activar): se construyen una sola vez por `renderOnce` y no se tocan hasta que el propio usuario los abre, cierra o cambia de objetivo.

## E. Cambios relacionados con la persistencia del estado

| Problema | Causa | Solución | Prueba realizada | Resultado |
|---|---|---|---|---|
| Texto del nombre de campaña se borraba | `render()` reconstruía el formulario en cada `state:update` | `renderOnce` en `#campaign-form-holder`/`#campaign-edit-holder`, clave = modo del formulario | `test/ui-persistence.test.js`, escenario 1: se escribe el nombre, se dispara una acción concurrente de otro cliente, se comprueba el valor del input | **OK** — el texto persiste (antes: se perdía el 100% de las veces) |
| Select de estrategia volvía a "CPM fijo" | Igual que el anterior | Igual que el anterior | Mismo test, misma comprobación sobre el `<select>` | **OK** |
| Chips de segmentación se desmarcaban | Igual que el anterior (los chips viven en una `Set` dentro del closure del formulario, que se destruía) | Igual que el anterior | Mismo test, comprobación de `.chip.active` antes/después | **OK** |
| Inputs de presupuesto/duración de la partida se reseteaban al añadir un equipo | `renderLobby()` reconstruía todo el bloque, incluida la config, cada vez que cambiaba la lista de equipos | Se separó en `lobby-config-section` (`renderOnce`) y `lobby-teams-section` (en vivo) | `test/ui-persistence.test.js`, escenario 2 | **OK** — 777€/33min siguen en el formulario tras añadir un equipo |
| Selector de evento de mercado volvía a la primera opción | `renderEvents()` reconstruía los `<select>` en cada tick de subasta | Se separó en `event-controls-section` (`renderOnce`) y `event-active-section` (en vivo) | Verificado manualmente + cubierto por la no-reconstrucción del mismo contenedor en el resto de tests | **OK** |
| **Equipos y campañas podían desaparecer de golpe** | `createGame()` sin guard de estado | Guard: rechaza la petición si `status` es `running`/`paused`, con mensaje explicativo | `test/gameEngine.test.js` ("createGame no puede destruir una partida en curso") + `test/ui-persistence.test.js` escenario 3 (ataque real vía socket directo, con la partida corriendo) | **OK** — los equipos y campañas sobreviven; el servidor devuelve el error "No se puede reconfigurar una partida en curso..." |

## F. Cambios realizados en la simulación económica

El modelo es **probabilístico por impresión**, no una multiplicación determinista de tasas agregadas: cada impresión ganada sortea individualmente si hay clic (probabilidad = CTR previsto del segmento) y, solo si hay clic, si hay conversión (probabilidad = CVR previsto). Esto es intencional y se documenta aquí porque el enunciado proponía un modelo determinista (`Clicks = Impresiones × CTR`) — el simulador converge a esas tasas en agregado sobre muchas impresiones, pero impresión a impresión hay varianza, igual que en datos reales de campañas (dos campañas con el mismo CTR objetivo no sacan exactamente el mismo número de clics). Se extrajo esta lógica a una función pura y testable, `GameEngine.simulateOutcome(predictedCTR, predictedCVR, revenuePerConversion, rng)`, para poder fijar la secuencia aleatoria en los tests y comprobar resultados exactos.

Fórmulas exactas usadas (`server/gameEngine.js`):
- **Coste de la impresión**: subasta de segundo precio — el ganador paga `(ad_rank del segundo / calidad propia) + 0,01€`, con suelo en el precio de reserva del segmento y techo en su propia puja.
- **CTR / CPC / CPM / CPA** (agregados, en `computeRanking()`): `CTR = clics/impresiones`, `CPC = gasto/clics`, `CPM = (gasto/impresiones)×1000`, `CPA = gasto/conversiones`.
- **ROAS** = `ingresos / gasto`.
- **Beneficio** = `ingresos - gasto` (nuevo campo mostrado explícitamente, antes solo se podía inferir).
- **Eficiencia** (usada en el ranking) = `(ingresos - gasto) / presupuesto inicial`.

No se cambió ninguna fórmula respecto al MVP original; lo que cambió es que ahora están cubiertas por tests con valores conocidos (ver sección K) y que el beneficio se expone explícitamente en la interfaz.

## G. Implementación del ROAS

Ya existía en el MVP (`revenue / spend` por campaña y por equipo) y funcionaba correctamente — lo confirman los tests de la sección K con números fijados a mano. Lo que se corrigió fue la **presentación**: antes se mostraba `0` tanto para "sin gasto todavía" como para "gastó y no ganó nada", que son mensajes muy distintos para un alumno leyendo su dashboard en clase. Ahora `roasLabel()` (en `common.js`) muestra:
- `—` cuando el gasto es 0 (todavía no hay datos que interpretar).
- `2,50x` / `0,60x` cuando sí hay gasto, con el formato exacto que se pidió en el enunciado (ejemplo del enunciado: inversión 500€, ingresos 300€ → ROAS 0,60x — reproducido literalmente en el test `computeRanking: una campaña puede ser NO rentable`).

Se confirmó explícitamente, con un test dedicado, que el simulador **permite perder dinero**: una campaña puede terminar con ROAS < 1 y beneficio negativo; no hay ningún suelo artificial que garantice rentabilidad.

## H. Implementación de ingresos y beneficio/pérdida

Se añadió el campo "Beneficio" (con signo y color: verde si es positivo, rojo si es negativo) en tres sitios donde antes no existía de forma explícita:
- Tarjetas de presupuesto del equipo (`equipo.html`, sustituye a "Ingresos simulados" como cuarta tarjeta, más útil para responder "¿soy rentable?" de un vistazo).
- Tarjeta de cada campaña individual (`equipo.js`), junto al resto de métricas (impresiones, clics, conversiones, CTR, CPC, CPM, CPA, ingresos).
- Tabla comparativa del profesor (`profesor.js`) y ranking en la pantalla de proyección (`pantalla.js`).

## I. Implementación de eventos de mercado

Se verificó —no se dio por hecho— que los eventos alteran variables reales del motor y no solo el texto del banner. Cada evento modifica uno de estos tres multiplicadores del segmento afectado: `segmentDemand` (sube el precio de reserva de la subasta), `segmentCtrMultiplier` (sube/baja la probabilidad de clic) o `segmentCvrMultiplier` (sube/baja la probabilidad de conversión); algunos eventos (p. ej. "Evento deportivo") tocan demanda y CTR a la vez. Estos multiplicadores entran directamente en el cálculo de `reservePrice`, `predictedCTR` y `predictedCVR` dentro de `_tick()` — es decir, si el precio sube, el coste real que paga el ganador de la subasta sube; si el CTR baja, hay menos clics simulados de verdad, no solo un aviso visual.

Se comprobó con tests dedicados (sección K) para "Tendencia viral" (demanda x1.8), "Crisis de reputación" (CTR x0.5, sin tocar demanda), un evento con alcance "global" (afecta a los 8 segmentos), la expiración automática (el multiplicador vuelve a 1 y el evento desaparece de la lista al caducar), y el impacto directo en el precio de reserva que se cobraría en una subasta real del segmento afectado.

## J. Implementación de la marca de agua "Sabina Civila"

Elemento `<div class="adsim-watermark">` montado una sola vez por `mountWatermark()` en `common.js` (compartido por las tres vistas, para no duplicar marcado). Posición fija en la esquina inferior derecha, `pointer-events: none` (no intercepta clics ni tapa ningún control), `aria-hidden="true"`, opacidad baja (`#ffffff40`) para que sea discreta pero legible, con tamaño reducido en móvil. Verificada visualmente en las tres pantallas (capturas adjuntas durante la auditoría): no se solapa con botones, tablas ni gráficos en ninguna de las tres vistas.

## K. Pruebas realizadas

**22 pruebas unitarias** (`npm test`, `test/gameEngine.test.js`), todas en verde:
- Guard de `createGame` (partida en curso no se puede destruir; sí se puede recrear en lobby o tras terminar).
- Saneamiento de configuración degenerada (presupuesto 0, duración negativa, intervalo de 1ms).
- Regresión del bug de segmentación original (`_matchScore` solo puntúa dimensiones especificadas — este era otro bug real, encontrado y corregido en una sesión anterior; se dejó como test permanente para que no vuelva a colarse).
- Subasta de segundo precio: dos pujadores, un solo pujador, precio de reserva como suelo.
- Cadena clic→conversión→ingreso con secuencias de aleatoriedad fijadas (sin clic no hay conversión; con clic sin conversión; con clic y conversión, ingreso exacto verificado).
- Cálculo de CTR/CPC/CPA/ROAS/beneficio a partir de métricas conocidas fijadas a mano (no tautológico: el test calcula el resultado esperado de forma independiente y lo compara).
- Caso explícito de campaña NO rentable (ROAS 0,60x, beneficio negativo) — usando los números literales del ejemplo del enunciado.
- Ranking sin NaN/Infinity cuando un equipo no ha gastado nada.
- Elegibilidad de subasta cuando se agota el presupuesto de la campaña o del equipo.
- 5 tests de eventos de mercado (impacto real en demanda/CTR/CVR, alcance global, expiración, impacto en precio de reserva).
- Prueba de estrés de 200 subastas con 3 equipos, pausas y un evento de mercado en medio, comprobando: sin NaN/Infinity/undefined, ningún equipo gasta más de su presupuesto, ninguna campaña gasta más de su presupuesto asignado, coherencia interna (clics ≤ impresiones, conversiones ≤ clics), y que la suma del gasto de las campañas de un equipo cuadra exactamente con el gasto registrado del equipo.

**Prueba de regresión de interfaz** (`npm run test:ui`, `test/ui-persistence.test.js`, requiere el servidor arrancado): reproduce con Playwright los tres bugs de persistencia más graves contra la aplicación ya corregida — 11 comprobaciones, todas en verde.

**Prueba de estrés completa de 16 pasos** (el guion exacto pedido en el encargo, con 4 equipos, edición de una campaña en pleno directo mientras llegan acciones concurrentes de otros clientes, evento de mercado activado, recarga de página a mitad de partida, segunda edición de la misma campaña después de que ya tenía métricas reales, y comprobación final de que todo lo anterior sigue existiendo): 20 comprobaciones, todas en verde, cero errores de consola.

## L. Problemas pendientes / limitaciones conocidas

- **Escala del motor de subastas**: cada tick resuelve exactamente una oportunidad de impresión para toda la partida, no una por equipo. Con 3-4 equipos no se nota; con 6-8 equipos algunos pueden pasar varios ticks sin ganar nada. No es un bug de esta auditoría (es una limitación de diseño ya señalada antes de la prueba en clase), pero conviene tenerlo presente si la próxima prueba es con un grupo grande — se puede ajustar bajando el intervalo de subasta desde el panel del profesor, o pedir que amplíe el motor a varias oportunidades por tick si el grupo es numeroso.
- **Volumen de broadcast**: el servidor sigue enviando el estado completo de la partida a todos los clientes en cada mutación (ahora ya no destructivo gracias a `renderOnce`, pero sigue siendo más tráfico del estrictamente necesario). A la escala de una clase (unas pocas decenas de clientes) no es un problema real; si en el futuro se usa con varios cientos de dispositivos a la vez, valdría la pena granularizar qué se envía a quién.
- No se ha añadido persistencia en base de datos (sigue siendo una decisión de diseño del MVP, no algo que esta auditoría debiera cambiar por su cuenta): si el proceso del servidor se cae, la partida en curso se pierde. El guard de `createGame` evita el caso más probable de pérdida de datos (un clic/reconexión accidental), pero no protege frente a un cierre real del proceso.

---

### Cómo volver a verificar todo esto

```bash
npm install
npm test              # 22 pruebas unitarias del motor (no necesita servidor arrancado)
npm start &            # arranca el servidor
npm run test:ui        # prueba de regresión de persistencia con navegador real
```
