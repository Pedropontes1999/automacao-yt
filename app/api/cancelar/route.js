import { NextResponse } from 'next/server';
import { cancelarDownload } from '../../../lib/core';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const conta = body.conta || 'canal1';
  const resultado = cancelarDownload(conta);
  return NextResponse.json(resultado);
}
