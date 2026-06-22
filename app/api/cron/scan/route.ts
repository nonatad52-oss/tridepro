export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  // 1. Pega a chave da URL
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  // 2. Validação simples: se não bater a chave, retorna erro 401 sem pedir login
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    // Busca ativos
    const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

    if (ativos && ativos.length > 0) {
      // Simulação rápida para evitar timeout
      for (const ativo of ativos) {
        await supabase.from('historico_sinais').insert([{
          ticker: ativo.ticker,
          direcao: 'COMPRA',
          horario_entrada: new Date().toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: 90,
          resultado_real: 'PENDENTE'
        }]);
      }
    }
    
    return NextResponse.json({ success: true, processed: ativos?.length || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
