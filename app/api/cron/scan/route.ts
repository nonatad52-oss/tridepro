import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'chave-temporaria';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'chave-temporaria';
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  const { data: insertData, error } = await supabase
    .from('historico_operacoes')
    .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
    .select('id').single();

  if (error || !insertData) return;

  const mensagem = `🧪 *TESTE DE SISTEMA*\n*Ativo:* ${ativo}\n*Ação:* ${iaData.sinal}\n*Preço:* ${precoAtual}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança: ${iaData.confianca_padrao}`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown'
    }),
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').limit(1);
    const ativo = ativosDB![0].ticker;

    // Simula uma análise para testar o envio
    const iaData = { sinal: "COMPRA", confianca_padrao: "100%" };
    await enviarSinalTelegram(ativo, iaData, 100.00, 50.00);

    return NextResponse.json({ success: true, message: "Teste de envio disparado!" });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
