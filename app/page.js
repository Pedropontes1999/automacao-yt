'use client';

import { useEffect, useRef, useState } from 'react';

function formatarDuracao(ms) {
  if (!ms || ms < 0) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sr = s % 60;
  if (m < 60) return `${m}min ${sr}s`;
  const h = Math.floor(m / 60);
  const mr = m % 60;
  return `${h}h ${mr}min`;
}

export default function Home() {
  const [conta, setConta] = useState('canal1');
  const [urls, setUrls] = useState('');
  const [limite, setLimite] = useState(0);
  const [somenteShorts, setSomenteShorts] = useState(false);
  const [status, setStatus] = useState(null);
  const [progresso, setProgresso] = useState(null);
  const pollRef = useRef(null);

  async function carregarStatus() {
    try {
      const res = await fetch(`/api/fila?conta=${encodeURIComponent(conta)}`);
      const data = await res.json();
      setStatus(data.status);
    } catch (e) {
      // ignora falha pontual
    }
  }

  async function carregarProgresso() {
    try {
      const res = await fetch(`/api/progresso?conta=${encodeURIComponent(conta)}`);
      const data = await res.json();
      setProgresso(data);
      if (!data.emAndamento && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        carregarStatus();
      }
    } catch (e) {
      // ignora falha pontual
    }
  }

  useEffect(() => {
    carregarStatus();
    carregarProgresso();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [conta]);

  async function cancelar() {
    try {
      await fetch('/api/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta }),
      });
      carregarProgresso();
    } catch (e) {
      alert(e.message);
    }
  }

  async function baixar() {
    if (!urls.trim()) return;
    try {
      const res = await fetch('/api/baixar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta, urls, limite, somenteShorts }),
      });
      const data = await res.json();
      if (data.erro) {
        alert(data.erro);
        return;
      }
      setProgresso(data.progresso);
      if (!pollRef.current) {
        pollRef.current = setInterval(carregarProgresso, 1500);
      }
    } catch (e) {
      alert(e.message);
    }
  }

  const emAndamento = progresso?.emAndamento;
  const total = progresso?.totalEstimado;
  const baixados = progresso?.baixados || 0;
  const pct = total ? Math.min(100, Math.round((baixados / total) * 100)) : null;

  let eta = null;
  if (emAndamento && total && baixados > 0) {
    const decorrido = Date.now() - new Date(progresso.iniciadoEm).getTime();
    const ritmo = decorrido / baixados;
    eta = ritmo * (total - baixados);
  }

  return (
    <div className="wrap">
      <h1>YT Automacao</h1>
      <p className="sub">Baixar videos em massa e preparar a fila de postagem no YouTube.</p>

      <div className="panel">
        <label>Canal (pasta em contas/)</label>
        <input
          type="text"
          value={conta}
          onChange={(e) => setConta(e.target.value)}
          style={{ width: 200, marginBottom: 12 }}
        />

        <label>Links (video, playlist ou canal do YouTube - um por linha)</label>
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/playlist?list=...\nhttps://www.youtube.com/@algumcanal  (com "Somente Shorts" marcado, baixa so os shorts dele)'}
        />

        <div className="row">
          <label style={{ margin: 0 }}>Limite nesta rodada:</label>
          <input
            type="number"
            min="0"
            value={limite}
            onChange={(e) => setLimite(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>(0 = sem limite)</span>

          <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={somenteShorts}
              onChange={(e) => setSomenteShorts(e.target.checked)}
            />
            Somente Shorts do canal
          </label>

          <button onClick={baixar} disabled={emAndamento}>
            {emAndamento ? 'Baixando...' : 'Baixar agora'}
          </button>
          {emAndamento && (
            <button className="secundario" onClick={cancelar} style={{ background: '#5c1f1f' }}>
              Cancelar
            </button>
          )}
          <button className="secundario" onClick={carregarStatus} disabled={emAndamento}>
            Atualizar status
          </button>
        </div>
      </div>

      {progresso && (progresso.emAndamento || progresso.logs?.length > 0) && (
        <div className="panel">
          <h3 style={{ fontSize: 14, marginTop: 0 }}>
            {progresso.fase === 'contando' && 'Contando quantos videos tem...'}
            {progresso.fase === 'baixando' && 'Baixando...'}
            {progresso.fase === 'concluido' && 'Download concluido'}
          </h3>

          {total != null && (
            <>
              <div style={{ background: '#0d0f13', border: '1px solid var(--border)', borderRadius: 8, height: 10, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ background: 'var(--accent)', height: '100%', width: `${pct ?? 0}%`, transition: 'width .3s' }} />
              </div>
              <div className="status-grid">
                <div className="stat">
                  <div className="num">{baixados} / {total}</div>
                  <div className="label">videos baixados</div>
                </div>
                <div className="stat">
                  <div className="num">{pct != null ? `${pct}%` : '-'}</div>
                  <div className="label">concluido</div>
                </div>
                <div className="stat">
                  <div className="num">{emAndamento ? formatarDuracao(eta) : '-'}</div>
                  <div className="label">tempo restante estimado</div>
                </div>
              </div>
            </>
          )}
          {total == null && progresso.fase === 'contando' && (
            <p className="sub" style={{ marginBottom: 0 }}>Mapeando os videos do link (pode levar um tempinho se o canal tiver muitos)...</p>
          )}

          <div className="log">{(progresso.logs || []).slice(-60).join('\n')}</div>
        </div>
      )}

      {status && (
        <div className="panel">
          <div className="status-grid">
            <div className="stat">
              <div className="num">{status.totalPendentes}</div>
              <div className="label">pendentes de postar</div>
            </div>
            <div className="stat">
              <div className="num">{status.enviados}</div>
              <div className="label">ja enviados</div>
            </div>
            <div className="stat">
              <div className="num">{status.proximaPublicacao ? new Date(status.proximaPublicacao).toLocaleString() : '-'}</div>
              <div className="label">proxima publicacao agendada</div>
            </div>
          </div>
          <div>
            Credencial OAuth
            <span className={`badge ${status.temCredencial ? 'ok' : 'falta'}`}>
              {status.temCredencial ? 'configurada' : 'faltando'}
            </span>
            &nbsp;&nbsp;Token do canal
            <span className={`badge ${status.temToken ? 'ok' : 'falta'}`}>
              {status.temToken ? 'autorizado' : 'faltando'}
            </span>
          </div>

          {status.pendentes?.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, marginTop: 16 }}>Fila de upload</h3>
              <ul className="lista">
                {status.pendentes.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
