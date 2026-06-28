import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    // 1. TESTE DO SUPABASE
    const { data: insertData, error: dbError } = await supabase
      .from('historico_operacoes')
      .insert([{ ticker: 'TESTE', sinal: 'COMPRA', taxa_entrada: 100.00, resultado: 'PENDENTE' }])
      .select('id').single();

    if (dbError) {
      return NextResponse.json({ 
        falhou_no: "BANCO DE DADOS", 
        motivo: dbError 
      });
    }

    // 2. TESTE DO TELEGRAM
    const mensagem = `🧪 *TESTE DE SISTEMA* - Conexão Perfeita!`;
    const tgResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown' }),
    });

    const tgJson = await tgResponse.json();

    if (!tgResponse.ok) {
       return NextResponse.json({ 
        falhou_no: "TELEGRAM", 
        motivo: tgJson 
      });
    }

    return NextResponse.json({ success: true, message: "Chegou no banco e no Telegram com sucesso!" });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
