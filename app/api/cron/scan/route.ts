export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Função auxiliar para Telegram
async function dispararTelegram(sinal: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const icone = sinal.direcao === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA';
  const mensagem = `📊 *NOVO SINAL TRIDEPRO*\n\n🎯 *Ativo:* ${sinal.ticker}\n⚡ *Ação:* ${icone}\n⏳ *Entrada:* ${new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', {timeZone: 'America/Sao_Paulo'})}\n🤖 *Assertividade:* ${sinal.assertividade_passada}%`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: mensagem, parse_mode: 'Markdown' })
  });
}

// Rota principal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  // Verifica a chave sem pedir autenticação de navegador
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

    if (ativos) {
      for (const ativo of ativos) {
        // Simulação de análise para o robô rodar
        const { data: novoSinal } = await supabase.from('historico_sinais').insert([{
          ticker: ativo.ticker,
          direcao: 'COMPRA',
          horario_entrada: new Date().toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: 99.9,
          resultado_real: 'PENDENTE'
        }]).select().single();

        if (novoSinal) await dispararTelegram(novoSinal);
      }
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
