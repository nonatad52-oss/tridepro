export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 1. Coleta Avançada de Dados
async function getAdvancedMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // @ts-ignore
    const historical = await yahooFinance.historical(ticker, { period1: trintaDiasAtras });

    const ultimosFechamentos = historical
      .slice(-15)
      .map(dia => Number(dia.close).toFixed(ticker.includes('-USD') ? 4 : 2));

    return {
      precoAtual: quote.regularMarketPrice || 0,
      variacaoDia: quote.regularMarketChangePercent || 0,
      maximaDia: quote.regularMarketDayHigh || 0,
      minimaDia: quote.regularMarketDayLow || 0,
      volumeHoje: quote.regularMarketVolume || 0,
      volumeMedio3M: quote.averageDailyVolume3Month || 0,
      media50: quote.fiftyDayAverage || 0,
      media200: quote.twoHundredDayAverage || 0,
      historico15Dias: ultimosFechamentos.join(', ')
    };
  } catch (e) { 
    return null; 
  }
}

// 2. Cérebro de Análise
async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Você é um algoritmo de Alta Frequência (HFT) e especialista em Price Action e Fluxo de Ordens.
      Analise o ativo ${ticker}:
      - Preço Atual: ${mkt.precoAtual} (Variação: ${mkt.variacaoDia}%)
      - Médias Móveis: SMA50=${mkt.media50} | SMA200=${mkt.media200}
      - Volume: Hoje=${mkt.volumeHoje} | Média 3M=${mkt.volumeMedio3M}
      - Histórico 15 dias: [${mkt.historico15Dias}]

      Retorne APENAS um objeto JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "stop_loss": number, "take_profit": number, "expiracao_ob": "1 Minuto"|"5 Minutos"|"15 Minutos", "gatilho_tecnico": "breve explicacao"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.15
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return { sinal: "AGUARDAR", confianca: 0, stop_loss: 0, take_profit: 0, expiracao_ob: "5 Minutos", gatilho_tecnico: "Erro" };
  }
}

// 3. Rota Principal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) {
    return NextResponse.json({ success: true, message: "Nenhum ativo ativo." });
  }

  let sinaisEnviadosnestaRodada = 0;
  let ativosAnalisados = [];
  
  for (const ativo of ativos) {
    ativosAnalisados.push(ativo.ticker);
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);

    // Se a IA mandar aguardar ou a confiança for menor que 85%, o robô pula de forma segura
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 85) continue;

    sinaisEnviadosnestaRodada++;
    const isCompra = analysis.sinal === 'COMPRA';
    const tagAcao = isCompra ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🧠 *SINAL GÊNIO QUANT PRO*\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n🔥 *Confiança:* ${analysis.confianca}%\n\n⏱️ *OPÇÕES BINÁRIAS (OB):*\n⏳ *Expiração:* ${analysis.expiracao_ob}\n\n🪙 *MERCADO CRIPTO / TRADICIONAL:*\n💲 *Preço:* $${mkt.precoAtual}\n🛑 *SL:* $${analysis.stop_loss} | 🎯 *TP:* $${analysis.take_profit}\n\n⚡ *Análise:* ${analysis.gatilho_tecnico}`,
        parse_mode: 'Markdown'
      })
    });
  }

  // MENSAGEM DE DIAGNÓSTICO: Envia um aviso dizendo que rodou e o que ele encontrou
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `ℹ️ *Relatório do Gênio:*\nVarredura concluída com sucesso!\n\n📋 *Ativos Verificados:* ${ativosAnalisados.join(', ')}\n🎯 *Sinais Disparados:* ${sinaisEnviadosnestaRodada}\n\n_${sinaisEnviadosnestaRodada === 0 ? 'Nenhuma oportunidade ultra-precisa (>85% confiança) foi detectada neste minuto. O robô segue monitorando de forma segura._' : ''}`,
      parse_mode: 'Markdown'
    })
  });

  return NextResponse.json({ success: true });
}
