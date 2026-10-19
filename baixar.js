// baixar.js - baixa videos em massa (lista de URLs, playlists ou canais) usando yt-dlp
// Uso: node baixar.js [conta] [limite]
//   conta  = pasta em contas/ (padrao: canal1)
//   limite = numero maximo de videos novos nesta rodada (padrao: sem limite)
const fs = require('fs');
const path = require('path');
const { baixarUrls, garantirConta } = require('./lib/core');

const BASE = __dirname;
const CONTA = process.argv[2] || process.env.CONTA || 'canal1';
const LIMITE = Number(process.argv[3] || process.env.LIMITE || 0); // 0 = sem limite
const LOG_FILE = path.join(BASE, 'baixar.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] [${CONTA}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* ignore */ }
}

const dir = garantirConta(CONTA);
const filaTxt = path.join(dir, 'fila.txt');
const fontes = fs.readFileSync(filaTxt, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (!fontes.length) {
  log('fila.txt esta vazio. Cole links de video/playlist/canal, um por linha, e rode de novo.');
  process.exit(0);
}

const { logs } = baixarUrls(CONTA, fontes, LIMITE);
logs.forEach(log);
