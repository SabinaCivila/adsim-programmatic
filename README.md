# AdSim — Simulador educativo de publicidad programática

MVP funcional para usar en clase. Simula, de forma simplificada pero realista, una subasta programática (estilo RTB): equipos que gestionan campañas compitiendo por impresiones, con presupuesto, segmentación, puja, CTR/CVR simulados, ROAS y ranking.

## Requisitos

- Node.js 18 o superior.

## Puesta en marcha (local, en el aula)

```bash
npm install
npm start
```

El servidor arranca en `http://localhost:3000`. Verás en la consola las tres URLs.

- **Profesor** (tu ordenador, proyectado o no): `http://localhost:3000/profesor`
- **Equipos** (un dispositivo por equipo, en la misma red WiFi): `http://<IP-de-tu-ordenador>:3000/equipo`
- **Pantalla de proyección** (para el cañón/TV del aula): `http://localhost:3000/pantalla`

Para que los alumnos puedan entrar desde sus móviles/portátiles, todos deben estar en la misma red WiFi que el ordenador que ejecuta el servidor. Averigua tu IP local con `ipconfig` (Windows) o `ifconfig`/`ip a` (Mac/Linux) y compártela con la clase, por ejemplo `http://192.168.1.23:3000/equipo`.

## Flujo de una partida

1. Abre `/profesor`, configura presupuesto inicial, duración, cadencia de subastas (cada cuántos segundos se resuelve una) y los pesos del ranking.
2. Pulsa "Crear/reconfigurar partida" y añade un equipo por grupo de alumnos.
3. Cada equipo abre `/equipo` en su dispositivo y selecciona su nombre de equipo (queda recordado en ese navegador).
4. El profesor pulsa "Iniciar partida". A partir de ahí, el motor genera oportunidades de impresión y resuelve subastas automáticamente cada pocos segundos.
5. Los equipos crean y ajustan campañas (objetivo, segmentación, presupuesto, puja máxima, estrategia) en tiempo real; el motor puja automáticamente por ellos en cada subasta según esos parámetros — así funciona un DSP real.
6. El profesor puede pausar, activar eventos de mercado (tendencia viral, crisis de reputación, etc.) y ver todas las campañas y subastas en directo.
7. La pantalla de proyección muestra cada subasta resuelta de forma animada y el ranking en vivo.
8. Al agotar el tiempo, la partida termina y se congela el ranking final.

## Cómo funciona la subasta (resumen)

Cada campaña activa con segmentación compatible con la oportunidad genera una puja automática según su estrategia (CPM fijo, maximizar conversiones, maximizar alcance, CPA objetivo, ROAS objetivo). Se calcula un `ad_rank = puja × calidad`, gana quien tenga mayor ad_rank, y paga (subasta de segundo precio) el precio necesario para superar al segundo mejor, nunca más de su propia puja. Después se simula probabilísticamente si hay clic y, si lo hay, si hay conversión, generando ingresos simulados para el ROAS.

## Estructura del proyecto

```
server/
  index.js        # Express + Socket.io, rutas y eventos
  gameEngine.js    # Motor de la simulación (estado, subastas, ranking)
  data.js          # Catálogos: segmentos, objetivos, estrategias, eventos
public/
  profesor.html/js # Panel del profesor
  equipo.html/js   # Panel del equipo
  pantalla.html/js # Pantalla de proyección
  css/styles.css   # Estilos compartidos
```

Sin base de datos: todo el estado vive en memoria del proceso Node mientras dura la clase. Reiniciar el servidor reinicia la partida.

## Despliegue en internet (más adelante)

La app no depende de nada local aparte de Node: se puede desplegar tal cual en Railway, Render, Fly.io o similar (`npm start` como comando de arranque), y los alumnos accederían por la URL pública en lugar de por la IP local.
