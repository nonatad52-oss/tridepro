export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 🔥 ISSO AQUI RESOLVE O PROBLEMA DO TEMPO! Dá 60 segundos pra Vercel.

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
      Você é um Trader Preditivo de Elite especialista em Opções Binárias.
      Analise o ativo ${ticker} e identifique uma oportunidade que VAI ACONTECER DAQUI A 5 MINUTOS.
      
      MÉTRICAS ATUAIS:
      - Preço Atual: ${mkt.precoAtual} (Variação: ${mkt.variacaoDia}%)
      - Extremos: Mín=${mkt.minimaDia} | Máx=${mkt.maximaDia}
      - Histórico 10 períodos: [${mkt.historico10Dias}]

      REGRAS PREDITIVAS:
      1. NÃO dê sinal para entrar agora. Projete onde o preço estará em 5 minutos.
      2. Perto da resistência máxima = PUT (Venda) daqui a 5 min.
      3. Perto do suporte mínimo = CALL (Compra) daqui a 5 min.
      4. Indique o preco_alvo_entrada.

      Retorne APENAS um JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "preco_alvo_entrada": number, "expiracao_ob": "1 Minuto"|"5 Minutos", "gatilho_tecnico": "Motivo rápido"}
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
  const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) return NextResponse.json({ success: true, message: "Sem ativos." });

  // 🔥 MENSAGEM DE AVISO: Dispara no Telegram ASSIM QUE COMEÇA!
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `⏳ *Gênio Trabalhando...*\nAnalisando ${ativos.length} ativos neste momento. Aguarde o resultado...`,
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
        text: `🧠 *SINAL PREDITIVO GÊNIO PRO*\n\n⏰ *ENTRADA ÀS:* ${horarioEntrada}\n_(Daqui a 5 minutos)_ \n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n🔥 *Confiança:* ${analysis.confianca}%\n\n⏱️ *OPÇÕES BINÁRIAS:*\n⏳ *Expiração:* ${analysis.expiracao_ob}\n🎯 *Preço Alvo (Taxa):* $${analysis.preco_alvo_entrada || mkt.precoAtual}\n\n⚡ *Previsão:* ${analysis.gatilho_tecnico}`,
        parse_mode: 'Markdown'
      })
    });
  }

  // MENSAGEM FINAL APÓS TERMINAR
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `✅ *Varredura Concluída!*\nForam encontrados ${sinaisEnviados} sinais para operar agora.`,
      parse_mode: 'Markdown'
    })
  });

  return NextResponse.json({ success: true });
}
