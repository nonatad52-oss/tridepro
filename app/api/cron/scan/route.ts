export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Garante tempo suficiente para processar todos os mais de 20 ativos

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

async function getAdvancedMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    const dezDiasAtras = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    // @ts-ignore
    const historical = await yahooFinance.historical(ticker, { period1: dezDiasAtras });

    const ultimosFechamentos = historical
      .slice(-10)
      .map(dia => Number(dia.close).toFixed(ticker.includes('-USD') ? 4 : 2));

    return {
      precoAtual: quote.regularMarketPrice || 0,
      variacaoDia: quote.regularMarketChangePercent || 0,
      maximaDia: quote.regularMarketDayHigh || 0,
      minimaDia: quote.regularMarketDayLow || 0,
      volumeHoje: quote.regularMarketVolume || 0,
      historico10Dias: ultimosFechamentos.join(', ')
    };
  } catch (e) { 
    return null; 
  }
}

async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Você é um Trader Preditivo de Elite especialista em Opções Binárias e Scalping.
      Analise o ativo ${ticker} e identifique uma oportunidade matemática clara para DAQUI A 5 MINUTOS.
      
      MÉTRICAS ATUAIS:
      - Preço Atual: ${mkt.precoAtual} (Variação: ${mkt.variacaoDia}%)
      - Extremos do Dia: Mínima=${mkt.minimaDia} | Máxima=${mkt.maximaDia}
      - Histórico Recente: [${mkt.historico10Dias}]

      REGRAS PREDITIVAS DE ANTECE DÊNCIA (5 MINUTOS):
      1. Projete a movimentação para os próximos 5 minutos com base na proximidade dos extremos (suporte/resistência).
      2. Se o preço estiver muito perto da Máxima do dia perdendo força, sinalize PUT (Venda) para daqui a 5 minutos.
      3. Se o preço estiver muito perto da Mínima do dia demonstrando suporte, sinalize CALL (Compra) para daqui a 5 minutos.
      4. Estipule a taxa ideal no campo "preco_alvo_entrada".

      Retorne APENAS um JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "preco_alvo_entrada": number, "expiracao_ob": "1 Minuto"|"5 Minutos", "gatilho_tecnico": "Breve justificativa técnica do padrão"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.35
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return { sinal: "AGUARDAR", confianca: 0 };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // 🔥 CONSULTA APONTANDO PARA A NOVA TABELA
  const { data: ativos } = await supabase.from('ativos_global').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) return NextResponse.json({ success: true, message: "Nenhum ativo encontrado na tabela ativos_global." });

  // Alerta inicial de varredura
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `⏳ *Gênio Iniciando Varredura Global...*\nMapeando o comportamento preditivo de *${ativos.length} ativos* simultaneamente. Aguarde os sinais em instantes...`,
      parse_mode: 'Markdown'
    })
  });

  const dataAtual = new Date();
  dataAtual.setMinutes(dataAtual.getMinutes() + 5);
  const horarioEntrada = dataAtual.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  let sinaisEnviados = 0;
  
  for (const ativo of ativos) {
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);

    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 75) continue;

    sinaisEnviados++;
    const isCompra = analysis.sinal === 'COMPRA';
    const tagAcao = isCompra ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🧠 *SINAL PREDITIVO GÊNIO PRO*\n\n⏰ *ENTRADA ANTECIPADA ÀS:* ${horarioEntrada}\n_(Abra a corretora e prepare-se)_\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n🔥 *Confiança:* ${analysis.confianca}%\n\n⏱️ *OPÇÕES BINÁRIAS:*\n⏳ *Expiração:* ${analysis.expiracao_ob}\n🎯 *Taxa Alvo de Entrada:* $${analysis.preco_alvo_entrada || mkt.precoAtual}\n\n⚡ *Análise Gráfica:* ${analysis.gatilho_tecnico}`,
        parse_mode: 'Markdown'
      })
    });
  }

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `✅ *Varredura Completa!*\nTodos os ${ativos.length} ativos foram checados. Foram emitidos ${sinaisEnviados} alertas de entrada antecipada.`,
      parse_mode: 'Markdown'
    })
  });

  return NextResponse.json({ success: true });
}
