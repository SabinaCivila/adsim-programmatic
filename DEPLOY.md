# Desplegar AdSim en internet (una URL para toda la clase)

Por qué no usar la red WiFi local: la mayoría de redes universitarias (eduroam incluida) aíslan a los clientes entre sí por seguridad, así que los portátiles/móviles de los alumnos no podrían llegar al servidor en tu ordenador aunque estén en la misma WiFi. Desplegarlo en internet evita ese problema y además no depende de que tu ordenador esté encendido y conectado durante toda la clase.

Usamos **Render** (tiene plan gratuito, sin necesidad de tarjeta en la mayoría de casos). Alternativa si prefieres evitar el "arranque en frío": Railway o el plan de pago de Render (~7$/mes), ver nota al final.

## 1. Subir el código a GitHub

Si no tienes cuenta, créala en [github.com/join](https://github.com/join) (gratis).

Crea un repositorio nuevo y vacío en [github.com/new](https://github.com/new) — nómbralo, por ejemplo, `adsim-programmatic`. No marques "Add a README" (ya tenemos uno).

Descomprime el zip que te envié y, desde una terminal dentro de esa carpeta:

```bash
cd adsim-programmatic
git init
git add .
git commit -m "Simulador de publicidad programatica"
git branch -M main
git remote add origin https://github.com/<TU-USUARIO>/adsim-programmatic.git
git push -u origin main
```

Si Git te pide contraseña y la rechaza: GitHub ya no acepta la contraseña normal por HTTPS. Genera un token en **Settings → Developer settings → Personal access tokens → Generate new token** (permiso `repo` basta) y úsalo como contraseña.

## 2. Desplegar en Render

1. Crea cuenta en [render.com](https://render.com) — puedes registrarte directamente con tu cuenta de GitHub, es lo más rápido.
2. Dashboard → **New +** → **Web Service**.
3. Conecta tu cuenta de GitHub (si no lo has hecho) y selecciona el repositorio `adsim-programmatic`.
4. Render detecta el archivo `render.yaml` del proyecto y rellena solo el build command (`npm install`) y el start command (`npm start`). Revisa que el plan sea **Free** y pulsa **Create Web Service** (o **Apply** si te muestra la vista de Blueprint).
5. Espera el primer build (2-4 minutos). Cuando termine, Render te da una URL pública del tipo `https://adsim-programmatic.onrender.com`.

## 3. Comprobar que funciona

Abre estas tres rutas sobre tu URL de Render:

- `https://tu-url.onrender.com/profesor`
- `https://tu-url.onrender.com/equipo`
- `https://tu-url.onrender.com/pantalla`

Configura una partida de prueba rápida, añade un equipo, crea una campaña y deja correr unas subastas para confirmar que todo va en tiempo real igual que en local.

## 4. El día de la clase

- **Entra a la URL 5-10 minutos antes de empezar.** El plan gratuito de Render "duerme" el servicio tras 15 minutos sin actividad; la primera visita después de dormido tarda ~1 minuto en responder. Entrando antes te aseguras de que ya está despierto cuando lleguen los alumnos.
- **Deja la pestaña de `/profesor` abierta durante toda la clase.** La conexión en tiempo real (WebSocket) cuenta como actividad y evita que el servicio vuelva a dormirse a media partida.
- Comparte con los alumnos solo esta URL: `https://tu-url.onrender.com/equipo` (o el enlace corto que prefieras generar). Ellos entran ahí y eligen su equipo.
- Proyecta `https://tu-url.onrender.com/pantalla` en el cañón del aula.

## 5. Plan de respaldo

No hay base de datos: si Render reinicia el servicio de forma inesperada (poco frecuente, pero puede pasar en el plan gratuito), la partida en curso se pierde y hay que "Reiniciar partida" desde el panel del profesor. Para una clase importante donde esto no sea aceptable, el plan pagado de Render (Starter, ~7$/mes) elimina el sueño por inactividad y los reinicios espontáneos — actívalo solo el día de la clase y vuelve a Free después si quieres ahorrar.

Como respaldo sin depender de internet: sigue el `README.md` para ejecutarlo en local con `npm start` y compartir tu IP en la misma WiFi — funcionará si la red del aula no tiene aislamiento de clientes (pruébalo con antelación, no el día de la clase).
