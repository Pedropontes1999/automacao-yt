// lib/core.js - logica compartilhada entre a CLI (baixar.js/postar.js) e o painel web
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const readline = require('readline');

// No painel (Next/Turbopack) o __dirname vira "/ROOT/lib" (= C:\ROOT no Windows); nesse caso usa a
// pasta onde o "next dev" foi iniciado, que e a raiz do projeto.
const BASE_DIRNAME = path.join(__dirname, '..');
const BASE = fs.existsSync(path.join(BASE_DIRNAME, 'package.json')) ? BASE_DIRNAME : process.cwd();

// Downloads em andamento (em memoria, por conta) - permite cancelar matando o processo yt-dlp atual.
// Fica no globalThis porque o Next carrega uma copia do modulo por rota e recarrega no hot reload;
// com um Map local o /api/cancelar nao enxergava o download iniciado pelo /api/baixar.
const execucoesAtivas = globalThis.__execucoesAtivas || (globalThis.__execucoesAtivas = new Map());

function matarPid(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) { /* ignore */ }
}

function matarProcesso(child) {
  if (child) matarPid(child.pid);
}

function cancelarDownload(conta) {
  const execucao = execucoesAtivas.get(conta);
  if (execucao) {
    execucao.cancelado = true;
    matarProcesso(execucao.child);
  }
  // Mesmo sem a execucao em memoria (servidor reiniciado/recarregado), mata o yt-dlp pelo PID
  // gravado no progresso e marca como cancelado, pra nao voltar "baixando" no F5.
  const progresso = lerProgresso(conta);
  if (progresso.emAndamento) {
    matarPid(progresso.pid);
    salvarProgresso(conta, {
      ...progresso,
      emAndamento: false,
      fase: 'cancelado',
      atual: null,
      pid: null,
      concluidoEm: new Date().toISOString(),
    });
    return { ok: true };
  }
  return execucao ? { ok: true } : { ok: false, motivo: 'nada em andamento para essa conta' };
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

// Cookies de uma conta logada no YouTube (exportados do navegador no formato Netscape).
// Sem isso o YouTube passa a pedir "Sign in to confirm you're not a bot" depois de muitos downloads.
function argsCookies() {
  const arq = path.join(BASE, 'segredos', 'cookies.txt');
  return fs.existsSync(arq) ? ['--cookies', arq] : [];
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
      '-o', path.join(videosDir, '%(title)s.%(ext)s'),
      '--write-thumbnail',
      '--convert-thumbnails', 'jpg',
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      // Pausas e retentativas: sem isso o YouTube corta com HTTP 403 em downloads em massa.
      '--sleep-requests', '1',
      '--sleep-interval', '3',
      '--max-sleep-interval', '8',
      '--retries', '10',
      '--fragment-retries', '10',
      '--no-overwrites',
      '--ignore-errors',
      '--quiet',
      '--no-warnings',
      '--print', 'after_move:filepath',
      // Imprime o caminho em UTF-8 (titulos com emoji/acento viram caminho certo na fila_upload.json).
      '--encoding', 'utf-8',
      ...argsCookies(),
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
  const progresso = lerJSON(progressoPath(conta), { emAndamento: false });
  // "Em andamento" sem execucao em memoria = sobra de um servidor que caiu/reiniciou no meio.
  if (progresso.emAndamento && !execucoesAtivas.has(conta)) {
    matarPid(progresso.pid);
    progresso.emAndamento = false;
    progresso.fase = 'cancelado';
    progresso.atual = null;
    progresso.pid = null;
    salvarProgresso(conta, progresso);
  }
  return progresso;
}
function salvarProgresso(conta, obj) {
  gravarJSON(progressoPath(conta), obj);
}

// Conta rapido quantos itens tem num link (sem baixar) usando --flat-playlist.
function contarIds(url, execucao) {
  return new Promise((resolve) => {
    if (execucao?.cancelado) { resolve(0); return; }
    const args = [url, '--flat-playlist', '--print', '%(id)s', '--skip-download', '--quiet', '--no-warnings', '--ignore-errors', ...argsCookies()];
    const child = spawn('yt-dlp', args);
    if (execucao) {
      execucao.child = child;
      if (execucao.progresso) {
        execucao.progresso.pid = child.pid;
        salvarProgresso(execucao.conta, execucao.progresso);
      }
    }
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

  const execucao = { cancelado: false, child: null, conta, progresso };
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
        if (execucao.bloqueado) break;
        if (restante <= 0) { logLinha('Limite atingido. Rode de novo pra continuar.'); break; }
        progresso.atual = url;
        logLinha(`Baixando: ${url}`);

        const args = [
          url,
          '--download-archive', arquivoBaixados,
          '-o', path.join(videosDir, '%(title)s.%(ext)s'),
      '--write-thumbnail',
      '--convert-thumbnails', 'jpg',
          '-f', 'bv*+ba/b',
          '--merge-output-format', 'mp4',
          // Pausas e retentativas: sem isso o YouTube corta com HTTP 403 em downloads em massa.
          '--sleep-requests', '1',
          '--sleep-interval', '3',
          '--max-sleep-interval', '8',
          '--retries', '10',
          '--fragment-retries', '10',
          '--no-overwrites',
          '--ignore-errors',
          '--quiet',
          '--no-warnings',
          '--print', 'after_move:filepath',
          '--encoding', 'utf-8',
          ...argsCookies(),
        ];
        if (restante !== Infinity) args.push('--max-downloads', String(restante));

        if (execucao.cancelado) { logLinha('Cancelado pelo usuario.'); break; }

        await new Promise((resolve) => {
          const child = spawn('yt-dlp', args);
          execucao.child = child;
          progresso.pid = child.pid;
          salvarProgresso(conta, progresso);
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
          rlErr.on('line', (linha) => {
            if (!linha.trim()) return;
            logLinha(`yt-dlp: ${linha.trim()}`);
            // Bloqueio anti-robo: todos os proximos videos vao falhar igual, entao para logo
            // (insistir so prolonga o bloqueio). Os que falharam nao entram no baixados.txt.
            if (!execucao.bloqueado && linha.includes('confirm you')) {
              execucao.bloqueado = true;
              matarProcesso(child);
            }
          });
          child.on('close', () => resolve());
          child.on('error', (e) => { logLinha(`Erro ao chamar yt-dlp: ${e.message}`); resolve(); });
        });
      }

      progresso.emAndamento = false;
      progresso.fase = execucao.cancelado ? 'cancelado' : execucao.bloqueado ? 'bloqueado' : 'concluido';
      progresso.atual = null;
      progresso.pid = null;
      progresso.concluidoEm = new Date().toISOString();
      if (execucao.cancelado) {
        logLinha(`Cancelado. ${progresso.baixados} video(s) baixado(s) antes de parar.`);
      } else if (execucao.bloqueado) {
        logLinha(`YouTube bloqueou como robo. ${progresso.baixados} video(s) baixado(s) antes de parar. `
          + 'Espere algumas horas ou coloque cookies em segredos/cookies.txt e rode de novo - continua de onde parou.');
      } else {
        logLinha(`Rodada concluida. ${progresso.baixados} video(s) baixado(s).`);
      }
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

// Tira itens da fila de upload e apaga o video + thumbnail do disco. itens = null limpa a fila toda.
// Continuam no baixados.txt, entao o proximo download nao baixa eles de novo.
function removerDaFila(conta, itens = null) {
  const dir = garantirConta(conta);
  const filaUploadFile = path.join(dir, 'fila_upload.json');
  const filaUpload = lerJSON(filaUploadFile, []);
  const remover = itens === null ? filaUpload : filaUpload.filter((rel) => itens.includes(rel));

  for (const rel of remover) {
    const video = path.join(BASE, rel);
    const thumb = video.replace(/\.[^.\\/]+$/, '.jpg');
    for (const arq of [video, thumb]) {
      try { fs.unlinkSync(arq); } catch (e) { /* ja nao existe */ }
    }
  }

  const novaFila = filaUpload.filter((rel) => !remover.includes(rel));
  gravarJSON(filaUploadFile, novaFila);
  return { removidos: remover.length, totalPendentes: novaFila.length };
}

module.exports = {
  BASE, contaDir, garantirConta, listarContas, baixarUrls, statusConta,
  lerJSON, gravarJSON, paraShorts, iniciarDownload, lerProgresso, cancelarDownload,
  removerDaFila,
};
