// Test de regresión para el bug de persistencia de estado auditado.
//
// Requiere el servidor arrancado en http://localhost:3000 (no lo levanta él
// mismo, para poder reutilizarse también como script de verificación manual
// durante el desarrollo). Usa Playwright, ya presente en el entorno de
// desarrollo para las capturas de pantalla del proyecto.
//
// Ejecutar: node server/index.js & luego npm run test:ui

const { chromium } = require('playwright');

let failures = 0;
function check(desc, cond) {
  if (cond) {
    console.log(`  OK   ${desc}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${desc}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const profesor = await browser.newPage();
  const equipo = await browser.newPage();
  const consoleErrors = [];
  [profesor, equipo].forEach((p) => p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); }));

  console.log('\n=== Escenario 2: los inputs de configuración del lobby no se borran al añadir equipos ===');
  await profesor.goto('http://localhost:3000/profesor', { waitUntil: 'networkidle' });
  await profesor.click('button:has-text("Crear / reconfigurar partida")');
  await profesor.waitForTimeout(150);
  await profesor.fill('#cfg-budget', '777');
  await profesor.fill('#cfg-duration', '33');
  await profesor.fill('#new-team-name', 'Equipo Alfa');
  await profesor.click('button:has-text("Añadir equipo")');
  await profesor.waitForTimeout(300);
  check('el presupuesto configurado (777) sigue en el campo tras añadir un equipo', await profesor.locator('#cfg-budget').inputValue() === '777');
  check('la duración configurada (33) sigue en el campo tras añadir un equipo', await profesor.locator('#cfg-duration').inputValue() === '33');

  console.log('\n=== Escenario 1: texto/selects/segmentación NO se pierden con un broadcast concurrente ===');
  await profesor.fill('#new-team-name', ''); // limpio para el siguiente paso
  await equipo.goto('http://localhost:3000/equipo', { waitUntil: 'networkidle' });
  await equipo.click('text=Equipo Alfa');
  await equipo.waitForTimeout(150);
  await equipo.click('#new-campaign-btn');
  await equipo.waitForTimeout(150);

  const form = equipo.locator('#campaign-form-holder');
  await form.locator('input[placeholder="Nombre de la campaña"]').fill('Campaña Coca-Cola Viral');
  await form.locator('select').nth(2).selectOption('maximizar_conversiones');
  await form.locator('.chips').nth(3).locator('.chip:has-text("viajes")').click();
  await form.locator('.chips').nth(0).locator('.chip:has-text("18-24")').click();

  // Acción concurrente desde otro cliente MIENTRAS el formulario sigue abierto sin guardar.
  await profesor.fill('#new-team-name', 'Equipo Beta');
  await profesor.click('button:has-text("Añadir equipo")');
  await equipo.waitForTimeout(400);

  check('el nombre de campaña sigue escrito', await form.locator('input[placeholder="Nombre de la campaña"]').inputValue() === 'Campaña Coca-Cola Viral');
  check('la estrategia sigue seleccionada', await form.locator('select').nth(2).inputValue() === 'maximizar_conversiones');
  check('el chip de interés "viajes" sigue activo', await form.locator('.chips').nth(3).locator('.chip.active').count() === 1);
  check('el chip de edad "18-24" sigue activo', await form.locator('.chips').nth(0).locator('.chip.active').count() === 1);

  await form.locator('button:has-text("Crear campaña")').click();
  await equipo.waitForTimeout(300);
  check('la campaña se guardó correctamente', await equipo.locator('text=Campaña Coca-Cola Viral').count() >= 1);

  console.log('\n=== Escenario 3: crear partida mientras hay una en curso no borra equipos (guard de servidor) ===');
  await profesor.click('button:has-text("Iniciar partida")');
  await profesor.waitForTimeout(400);
  const stateBefore = await fetch('http://localhost:3000/api/state').then((r) => r.json());
  check('la partida está "running" antes de intentar el ataque (precondición del test)', stateBefore.status === 'running');
  check('precondición: hay equipos antes del intento', Object.keys(stateBefore.teams).length > 0);
  await profesor.evaluate(() => {
    const s = io();
    s.emit('profesor:createGame', { initialBudget: 999, durationMs: 60000, tickIntervalMs: 6000, scoring: {} });
  });
  await profesor.waitForTimeout(400);
  const stateAfter = await fetch('http://localhost:3000/api/state').then((r) => r.json());
  check('los equipos NO desaparecen tras un intento de recrear la partida en curso', Object.keys(stateAfter.teams).length === Object.keys(stateBefore.teams).length && Object.keys(stateAfter.teams).length > 0);
  check('el estado sigue "running" (la recreación fue rechazada)', stateAfter.status === stateBefore.status);

  console.log('\n=== Errores de consola durante todo el recorrido ===');
  check('no hay errores de consola', consoleErrors.length === 0);
  if (consoleErrors.length) consoleErrors.forEach((e) => console.log('   ', e));

  await browser.close();

  console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FALLO EN EL TEST:', e); process.exit(1); });
