// lib/core.js - logica compartilhada entre a CLI (baixar.js/postar.js) e o painel web
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const readline = require('readline');

const BASE = path.join(__dirname, '..');

// Downloads em andamento (em memoria, por conta) - permite cancelar matando o processo yt-dlp atual.
const execucoesAtivas = new Map();

function matarProcesso(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) { /* ignore */ }
}

function cancelarDownload(conta) {
  const execucao = execucoesAtivas.get(conta);
  if (!execucao) return { ok: false, motivo: 'nada em andamento para essa conta' };
  execucao.cancelado = true;
  matarProcesso(execucao.child);
  return { ok: true };
}

function contaDir(conta) {
  return path.join(BASE, 'contas', conta);
}

// Transforma o link "base" de um canal (ex: youtube.com/@fulano) na aba de Shorts dele.
// Se ja for um link de video/playlist/outra aba, devolve sem alterar.
function paraShorts(url) {
  const original = url.trim();
  const semBarra = original.replace(/\/+$/, '');
  const semQuery = semBarra.split('?')[0];

  if (/\/shorts$/i.test(semQuery)) return semBarra;
  if (/\/(videos|streams|playlists)$/i.test(semQuery)) {
    return semQuery.replace(/\/(videos|streams|playlists)$/i, '/shorts');
  }

  const canalBase = /^https?:\/\/(www\.)?youtube\.com\/(@[^/?]+|channel\/[^/?]+|c\/[^/?]+|user\/[^/?]+)$/i;
  if (canalBase.test(semQuery)) {
    return `${semQuery}/shorts`;
  }

  return original;
}

function lerJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function gravarJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function garantirConta(conta) {
  const dir = contaDir(conta);
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
  const filaTxt = path.join(dir, 'fila.txt');
  if (!fs.existsSync(filaTxt)) {
    fs.writeFileSync(filaTxt, '# Cole aqui, uma por linha: link de video, playlist ou canal do YouTube.\n');
  }
  const configFile = path.join(dir, 'config.json');
  if (!fs.existsSync(configFile)) {
    gravarJSON(configFile, { idioma: 'pt', posts_por_vez: 1, intervalo_horas: 24, privacidade: 'private', titulo_padrao: '{nome}' });
  }
  return dir;
}

function listarContas() {
  const dir = path.join(BASE, 'contas');
  fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory());
}

// Baixa uma lista de URLs (video/playlist/canal) pra dentro de contas/<conta>/videos.
// Retorna { baixados: [...caminhos relativos novos], logs: [...linhas] }.
function baixarUrls(conta, urls, limite = 0, opts = {}) {
  const dir = garantirConta(conta);
  const videosDir = path.join(dir, 'videos');
  const arquivoBaixados = path.join(dir, 'baixados.txt');
  const filaUploadFile = path.join(dir, 'fila_upload.json');

  const filaUpload = lerJSON(filaUploadFile, []);
  const logs = [];
  const novosTotal = [];
  let restante = limite > 0 ? limite : Infinity;

  const urlsFinais = opts.somenteShorts ? urls.map(paraShorts) : urls;

  for (const url of urlsFinais) {
    if (restante <= 0) {
      logs.push('Limite da rodada atingido. Rode de novo para continuar baixando o resto.');
      break;
    }

    logs.push(`Baixando: ${url}`);
    const args = [
      url,
      '--download-archive', arquivoBaixados,
      '-o', path.join(videosDir, '%(id)s.%(ext)s'),
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--no-overwrites',
      '--ignore-errors',
      '--quiet',
      '--no-warnings',
      '--print', 'after_move:filepath',
    ];
    if (restante !== Infinity) args.push('--max-downloads', String(restante));

    const res = spawnSync('yt-dlp', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
    if (res.error) {
      logs.push(`Erro ao chamar yt-dlp (esta instalado e no PATH?): ${res.error.message}`);
      continue;
    }
    if (res.stderr) {
      res.stderr.split('\n').filter(Boolean).forEach((l) => logs.push(`yt-dlp: ${l}`));
    }

    const novos = (res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const caminho of novos) {
      const rel = path.relative(BASE, caminho).split(path.sep).join('/');
      if (!filaUpload.includes(rel)) {
        filaUpload.push(rel);
        novosTotal.push(rel);
        restante -= 1;
        logs.push(`OK - baixado: ${rel}`);
      }
    }
  }

  gravarJSON(filaUploadFile, filaUpload);
  logs.push(`Rodada concluida. ${novosTotal.length} video(s) novo(s). Fila de upload agora tem ${filaUpload.length} video(s) pendente(s).`);
  return { baixados: novosTotal, logs, filaUpload };
}

function progressoPath(conta) {
  return path.join(contaDir(conta), 'progresso.json');
}
function lerProgresso(conta) {
  return lerJSON(progressoPath(conta), { emAndamento: false });
}
function salvarProgresso(conta, obj) {
  gravarJSON(progressoPath(conta), obj);
}

// Conta rapido quantos itens tem num link (sem baixar) usando --flat-playlist.
function contarIds(url, execucao) {
  return new Promise((resolve) => {
    if (execucao?.cancelado) { resolve(0); return; }
    const args = [url, '--flat-playlist', '--print', '%(id)s', '--skip-download', '--quiet', '--no-warnings', '--ignore-errors'];
    const child = spawn('yt-dlp', args);
    if (execucao) execucao.child = child;
    let total = 0;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', () => { total += 1; });
    child.on('close', () => resolve(total));
    child.on('error', () => resolve(0));
  });
}

// Dispara o download em segundo plano (nao espera terminar) e vai atualizando
// contas/<conta>/progresso.json pra quem quiser acompanhar (o painel web faz polling nele).
function iniciarDownload(conta, urls, limite = 0, opts = {}) {
  const dir = garantirConta(conta);
  const videosDir = path.join(dir, 'videos');
  const arquivoBaixados = path.join(dir, 'baixados.txt');
  const filaUploadFile = path.join(dir, 'fila_upload.json');
  const urlsFinais = opts.somenteShorts ? urls.map(paraShorts) : urls;

  const progresso = {
    emAndamento: true,
    fase: 'contando',
    iniciadoEm: new Date().toISOString(),
    totalEstimado: null,
    baixados: 0,
    urls: urlsFinais,
    atual: null,
    logs: [],
    concluidoEm: null,
    erro: null,
  };
  salvarProgresso(conta, progresso);

  const execucao = { cancelado: false, child: null };
  execucoesAtivas.set(conta, execucao);

  function logLinha(l) {
    progresso.logs.push(l);
    if (progresso.logs.length > 300) progresso.logs.shift();
    salvarProgresso(conta, progresso);
  }

  (async () => {
    try {
      let total = 0;
      for (const url of urlsFinais) {
        if (execucao.cancelado) break;
        total += await contarIds(url, execucao);
      }
      progresso.totalEstimado = limite > 0 ? Math.min(limite, total) : total;
      progresso.fase = 'baixando';
      salvarProgresso(conta, progresso);

      const filaUpload = lerJSON(filaUploadFile, []);
      let restante = limite > 0 ? limite : Infinity;

      for (const url of urlsFinais) {
        if (execucao.cancelado) { logLinha('Cancelado pelo usuario.'); break; }
        if (restante <= 0) { logLinha('Limite atingido. Rode de novo pra continuar.'); break; }
        progresso.atual = url;
        logLinha(`Baixando: ${url}`);

        const args = [
          url,
          '--download-archive', arquivoBaixados,
          '-o', path.join(videosDir, '%(id)s.%(ext)s'),
          '-f', 'bv*+ba/b',
          '--merge-output-format', 'mp4',
          '--no-overwrites',
          '--ignore-errors',
          '--quiet',
          '--no-warnings',
          '--print', 'after_move:filepath',
        ];
        if (restante !== Infinity) args.push('--max-downloads', String(restante));

        if (execucao.cancelado) { logLinha('Cancelado pelo usuario.'); break; }

        await new Promise((resolve) => {
          const child = spawn('yt-dlp', args);
          execucao.child = child;
          const rlOut = readline.createInterface({ input: child.stdout });
          rlOut.on('line', (linha) => {
            const caminho = linha.trim();
            if (!caminho) return;
            const rel = path.relative(BASE, caminho).split(path.sep).join('/');
            if (!filaUpload.includes(rel)) {
              filaUpload.push(rel);
              progresso.baixados += 1;
              restante -= 1;
              gravarJSON(filaUploadFile, filaUpload);
              logLinha(`OK - baixado (${progresso.baixados}/${progresso.totalEstimado ?? '?'}): ${rel}`);
            }
          });
          const rlErr = readline.createInterface({ input: child.stderr });
          rlErr.on('line', (linha) => { if (linha.trim()) logLinha(`yt-dlp: ${linha.trim()}`); });
          child.on('close', () => resolve());
          child.on('error', (e) => { logLinha(`Erro ao chamar yt-dlp: ${e.message}`); resolve(); });
        });
      }

      progresso.emAndamento = false;
      progresso.fase = execucao.cancelado ? 'cancelado' : 'concluido';
      progresso.atual = null;
      progresso.concluidoEm = new Date().toISOString();
      logLinha(execucao.cancelado
        ? `Cancelado. ${progresso.baixados} video(s) baixado(s) antes de parar.`
        : `Rodada concluida. ${progresso.baixados} video(s) baixado(s).`);
    } catch (e) {
      progresso.emAndamento = false;
      progresso.erro = e.message;
      salvarProgresso(conta, progresso);
    } finally {
      execucoesAtivas.delete(conta);
    }
  })();

  return progresso;
}

function statusConta(conta) {
  const dir = garantirConta(conta);
  const filaUpload = lerJSON(path.join(dir, 'fila_upload.json'), []);
  const estado = lerJSON(path.join(dir, 'estado.json'), { proxima_publicacao: null, proximo_numero: 1 });
  const enviadosDir = path.join(dir, 'enviados');
  const enviados = fs.existsSync(enviadosDir) ? fs.readdirSync(enviadosDir) : [];
  const temToken = fs.existsSync(path.join(BASE, 'segredos', `${conta}_token.json`));
  const temCredencial = fs.existsSync(path.join(BASE, 'segredos', 'client_secret.json'));
  return {
    conta,
    pendentes: filaUpload,
    totalPendentes: filaUpload.length,
    enviados: enviados.length,
    proximaPublicacao: estado.proxima_publicacao,
    temToken,
    temCredencial,
  };
}

module.exports = {
  BASE, contaDir, garantirConta, listarContas, baixarUrls, statusConta,
  lerJSON, gravarJSON, paraShorts, iniciarDownload, lerProgresso, cancelarDownload,
};
