// postar.js - envia videos da fila de upload para o YouTube, agendando a publicacao
// Uso: node postar.js [conta]
// Titulo e capa ainda sao so um placeholder (nome do arquivo) - isso fica pra depois.
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const BASE = __dirname;
const CONTA = process.argv[2] || process.env.CONTA || 'canal1';
const CONTA_DIR = path.join(BASE, 'contas', CONTA);
const SEGREDOS = path.join(BASE, 'segredos');
const TOKEN_FILE = path.join(SEGREDOS, `${CONTA}_token.json`);
const CLIENT_SECRET_FILE = path.join(SEGREDOS, 'client_secret.json');
const FILA_UPLOAD = path.join(CONTA_DIR, 'fila_upload.json');
const ESTADO_FILE = path.join(CONTA_DIR, 'estado.json');
const ENVIADOS_DIR = path.join(CONTA_DIR, 'enviados');
const LOG_FILE = path.join(BASE, 'postar.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] [${CONTA}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* ignore */ }
}
function lerJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function gravarJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

if (!fs.existsSync(TOKEN_FILE)) {
  log(`Sem token em segredos/${CONTA}_token.json. Rode "node auth.js ${CONTA}" primeiro.`);
  process.exit(1);
}

const cfg = Object.assign(
  { posts_por_vez: 1, intervalo_horas: 24, privacidade: 'private', titulo_padrao: '{nome}' },
  lerJSON(path.join(CONTA_DIR, 'config.json'), {})
);

const secretJson = lerJSON(CLIENT_SECRET_FILE, {});
const { client_id, client_secret } = secretJson.installed || secretJson.web || {};
const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
oauth2Client.setCredentials(lerJSON(TOKEN_FILE, {}));
oauth2Client.on('tokens', (tokens) => {
  const atual = lerJSON(TOKEN_FILE, {});
  gravarJSON(TOKEN_FILE, { ...atual, ...tokens });
});
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

function proximaData(estado) {
  const agora = Date.now();
  const base = estado.proxima_publicacao ? Date.parse(estado.proxima_publicacao) : agora;
  const data = base > agora ? base : agora + 5 * 60000; // pelo menos 5 min no futuro
  return new Date(data).toISOString();
}

async function enviarUm(caminhoRel) {
  const caminho = path.join(BASE, caminhoRel);
  if (!fs.existsSync(caminho)) {
    log(`Arquivo nao existe mais, pulando: ${caminhoRel}`);
    return 'pular';
  }

  const estado = lerJSON(ESTADO_FILE, { proxima_publicacao: null, proximo_numero: 1 });
  const nome = path.basename(caminho, path.extname(caminho));
  const titulo = cfg.titulo_padrao.replace('{nome}', nome).replace('{n}', String(estado.proximo_numero));
  const publishAt = proximaData(estado);

  log(`Enviando ${caminhoRel} (titulo: "${titulo}", agendado p/ ${publishAt})`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: titulo, description: '', categoryId: '22' },
      status: {
        privacyStatus: 'private',
        publishAt,
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(caminho) },
  });

  log(`OK - video_id=${res.data.id}`);

  fs.mkdirSync(ENVIADOS_DIR, { recursive: true });
  fs.renameSync(caminho, path.join(ENVIADOS_DIR, path.basename(caminho)));

  estado.proxima_publicacao = new Date(Date.parse(publishAt) + cfg.intervalo_horas * 3600000).toISOString();
  estado.proximo_numero += 1;
  gravarJSON(ESTADO_FILE, estado);
  return 'ok';
}

async function main() {
  const quantidade = Math.max(1, Math.min(50, Number(process.env.QUANTIDADE) || cfg.posts_por_vez || 1));
  let fila = lerJSON(FILA_UPLOAD, []);
  if (!fila.length) {
    log('Fila de upload vazia. Rode o baixar.js primeiro.');
    return;
  }

  let enviados = 0;
  while (enviados < quantidade && fila.length) {
    const caminho = fila[0];
    try {
      const resultado = await enviarUm(caminho);
      fila.shift();
      gravarJSON(FILA_UPLOAD, fila);
      if (resultado === 'ok') enviados += 1;
    } catch (e) {
      log(`FALHOU ${caminho}: ${e.message}`);
      break; // deixa na fila, proxima rodada tenta de novo
    }
  }
  log(`Rodada concluida. ${enviados} video(s) enviado(s). Faltam ${fila.length} na fila.`);
}

main().catch((e) => log(`ERRO GERAL: ${e.message}`));
