const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { GameEngine } = require('./gameEngine');
const catalog = require('./data');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const engine = new GameEngine(io);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/catalog', (req, res) => res.json(catalog));
app.get('/api/state', (req, res) => res.json(engine.getPublicState()));

app.get('/profesor', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'profesor.html')));
app.get('/equipo/:teamId?', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'equipo.html')));
app.get('/pantalla', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pantalla.html')));

function safe(socket, fn) {
  try {
    fn();
  } catch (err) {
    socket.emit('action:error', { message: err.message });
  }
}

io.on('connection', (socket) => {
  socket.emit('state:update', { reason: 'connect', state: engine.getPublicState() });

  socket.on('state:request', () => {
    socket.emit('state:update', { reason: 'request', state: engine.getPublicState() });
  });

  // ---- Profesor ----
  socket.on('profesor:createGame', (config) => safe(socket, () => engine.createGame(config)));
  socket.on('profesor:addTeam', (payload) => safe(socket, () => engine.addTeam(payload?.name)));
  socket.on('profesor:removeTeam', (payload) => safe(socket, () => engine.removeTeam(payload.teamId)));
  socket.on('profesor:startGame', () => safe(socket, () => engine.startGame()));
  socket.on('profesor:pauseGame', () => safe(socket, () => engine.pauseGame()));
  socket.on('profesor:resetGame', () => safe(socket, () => engine.resetGame()));
  socket.on('profesor:triggerEvent', (payload) => safe(socket, () => engine.triggerEvent(payload.eventId, payload.target, payload.durationMs)));
  socket.on('profesor:updateScoring', (payload) => safe(socket, () => {
    Object.assign(engine.state.config.scoring, payload);
    engine._broadcastState('scoring:updated');
  }));

  // ---- Equipos ----
  socket.on('campaign:create', (payload) => safe(socket, () => engine.createCampaign(payload.teamId, payload)));
  socket.on('campaign:update', (payload) => safe(socket, () => engine.updateCampaign(payload.campaignId, payload)));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AdSim escuchando en http://localhost:${PORT}`);
  console.log(`  Profesor:  http://localhost:${PORT}/profesor`);
  console.log(`  Equipo:    http://localhost:${PORT}/equipo`);
  console.log(`  Pantalla:  http://localhost:${PORT}/pantalla`);
});

module.exports = { app, server, engine };
