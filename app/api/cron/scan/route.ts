export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 1. FUNÇÃO DE DISPARO PARA O TELEGRAM
async function dispararTelegram(sinal: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const horarioFormatado = new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
  });

  const icone = sinal.direcao === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA';
  const mensagem = `📊 **NOVO SINAL TRIDEPRO** 📊\n\n🎯 **Ativo:** ${sinal.ticker}\n⚡ **Ação:** ${icone}\n⏳ **Entrada:** ${horarioFormatado}\n🤖 **Assertividade:** ${sinal.assertividade_passada}%`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: mensagem, parse_mode: 'Markdown' })
  });
}

// 2. MOTOR DE ANÁLISE (GROQ)
async function analisarComGroq(ticker: string, apiKey: string) {
  try {
    const prompt = `Analise ${ticker}. Responda apenas JSON: {"sinal": "COMPRA", "assertividade": 90} ou {"sinal": "VENDA", "assertividade": 90} ou {"sinal": "AGUARDAR", "assertividade": 0}.`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3-70b-8192', messages: [{ role: 'user', content: prompt }], temperature: 0.1 })
    });
    const dados = await res.json();
    const match = dados.choices[0].message.content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { sinal: 'AGUARDAR', assertividade: 0 };
  } catch { return { sinal: 'AGUARDAR', assertividade: 0 }; }
}

// 3. ROTA PRINCIPAL COM PROTEÇÃO CRON_SECRET
export async function GET(request: Request) {
  // Verificação de segurança (401 Unauthorized)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

    if (!ativos) return NextResponse.json({ message: "Nenhum ativo." });

    for (const ativo of ativos) {
      const analise = await analisarComGroq(ativo.ticker, process.env.GROQ_API_KEY!);
      
      if (analise.sinal !== 'AGUARDAR') {
        const horarioEntrada = new Date();
        horarioEntrada.setMinutes(horarioEntrada.getMinutes() + (5 - (horarioEntrada.getMinutes() % 5)));
        horarioEntrada.setSeconds(0, 0);

        const { data: novoSinal } = await supabase.from('historico_sinais').insert([{
          ticker: ativo.ticker,
          direcao: analise.sinal,
          horario_entrada: horarioEntrada.toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: analise.assertividade,
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
