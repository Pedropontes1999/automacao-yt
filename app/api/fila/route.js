import { NextResponse } from 'next/server';
import { statusConta, listarContas } from '../../../lib/core';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const conta = searchParams.get('conta') || 'canal1';
  const contas = listarContas();
  const status = statusConta(conta);
  return NextResponse.json({ contas, status });
}
