import { NextResponse } from 'next/server';
import { iniciarDownload } from '../../../lib/core';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const conta = body.conta || 'canal1';
  const urls = String(body.urls || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const limite = Number(body.limite || 0);
  const somenteShorts = Boolean(body.somenteShorts);

  if (!urls.length) {
    return NextResponse.json({ erro: 'Cole pelo menos um link.' }, { status: 400 });
  }

  const progresso = iniciarDownload(conta, urls, limite, { somenteShorts });
  return NextResponse.json({ iniciado: true, progresso });
}
