import { NextResponse } from 'next/server';
import { lerProgresso } from '../../../lib/core';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const conta = searchParams.get('conta') || 'canal1';
  return NextResponse.json(lerProgresso(conta));
}
