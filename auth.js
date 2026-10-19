// auth.js - autoriza o robo a postar no YouTube da conta indicada (uma vez so, por conta)
// Uso: node auth.js [conta]
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const BASE = __dirname;
const CONTA = process.argv[2] || process.env.CONTA || 'canal1';
const SEGREDOS = path.join(BASE, 'segredos');
const CLIENT_SECRET_FILE = path.join(SEGREDOS, 'client_secret.json');
const TOKEN_FILE = path.join(SEGREDOS, `${CONTA}_token.json`);
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!fs.existsSync(CLIENT_SECRET_FILE)) {
  console.error(
    `Faltou o arquivo ${CLIENT_SECRET_FILE}.\n` +
    'Crie uma credencial OAuth tipo "App para computador" no Google Cloud Console ' +
    '(com a YouTube Data API v3 ativada), baixe o JSON e salve exatamente nesse caminho.'
  );
  process.exit(1);
}

const secretJson = JSON.parse(fs.readFileSync(CLIENT_SECRET_FILE, 'utf8'));
const { client_id, client_secret } = secretJson.installed || secretJson.web || {};
if (!client_id || !client_secret) {
  console.error('client_secret.json nao tem o formato esperado (precisa ter client_id e client_secret).');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.end();
    return;
  }
  const code = new URL(req.url, REDIRECT_URI).searchParams.get('code');
  res.end('Autorizado! Pode fechar essa aba e voltar pro terminal.');
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.mkdirSync(SEGREDOS, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n');
    console.log(`Token salvo em segredos/${CONTA}_token.json. Pronto, pode rodar "node postar.js ${CONTA}" agora.`);
  } catch (e) {
    console.error(`Falha ao trocar o codigo por token: ${e.message}`);
  }
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Abra esse link no navegador e faca login com a conta Google do canal "${CONTA}":\n\n${authUrl}\n`);
  try {
    execSync(`start "" "${authUrl}"`, { shell: 'cmd.exe' });
  } catch (e) {
    console.log('(nao consegui abrir o navegador automaticamente, copie e cole o link acima)');
  }
});
