import { NextResponse } from 'next/server';
import { statusConta, listarContas, removerDaFila, lerProgresso } from '../../../lib/core';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const conta = searchParams.get('conta') || 'canal1';
  const contas = listarContas();
  const status = statusConta(conta);
  return NextResponse.json({ contas, status });
}

// Body: { conta, itens: [...] } remove esses itens; sem "itens" limpa a fila toda.
export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const conta = body.conta || 'canal1';
  // O download em andamento regrava a fila inteira a cada video novo e desfaria a remocao.
  if (lerProgresso(conta).emAndamento) {
    return NextResponse.json({ erro: 'Cancele o download antes de mexer na fila.' }, { status: 409 });
  }
  const itens = Array.isArray(body.itens) ? body.itens : null;
  return NextResponse.json(removerDaFila(conta, itens));
}
