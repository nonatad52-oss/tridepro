export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

function calcularRSI(precos: number[], periodos = 14) {
  if (precos.length < periodos + 1) return 50;
  let ganhos = 0; let perdas = 0;
  for (let i = precos.length - periodos; i < precos.length; i++) {
    const diferenca = precos[i] - precos[i - 1];
    if (diferenca >= 0) ganhos += diferenca;
    else perdas -= diferenca;
  }
  const ganhoMedio = ganhos / periodos;
  const perdaMedia = perdas / periodos;
  if (perdaMedia === 0) return 100;
  const rs = ganhoMedio / perdaMedia;
  return 100 - (100 / (1 + rs));
}

function calcularBollinger(precos: number[], periodos = 20) {
  if (precos.length < periodos) return { superior: 0, inferior: 0, media: 0 };
  const corte = precos.slice(-periodos);
  const sma = corte.reduce((a, b) => a + b, 0) / periodos;
  const variancia = corte.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / periodos;
  const desvioPadrao = Math.sqrt(variancia);
  return { superior: sma + (desvioPadrao * 2), inferior: sma - (desvioPadrao * 2) };
}

async function getAdvancedMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    const quarentaDiasAtras = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    // @ts-ignore
    const historical = await yahooFinance.historical(ticker, { period1: quarentaDiasAtras });

    const todosFechamentos = historical.map(dia => Number(dia.close));
    const rsi = calcularRSI(todosFechamentos, 14);
    const bb = calcularBollinger(todosFechamentos, 20);

    return {
      precoAtual: quote.regularMarketPrice || 0,
      rsi: rsi.toFixed(2),
      bbSuperior: bb.superior.toFixed(4),
      bbInferior: bb.inferior.toFixed(4)
    };
  } catch (e) { return null; }
}

async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Analise ${ticker} (RSI: ${mkt.rsi}, Bollinger Superior: ${mkt.bbSuperior}, Bollinger Inferior: ${mkt.bbInferior}, Preço Atual: ${mkt.precoAtual}).
      Gere uma operação de alta probabilidade para daqui a 5 minutos baseada em exaustão de preço.
      Retorne APENAS um objeto JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "preco_alvo_entrada": number, "expiracao_ob": "1 Minuto"|"5 Minutos"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.2
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) { return { sinal: "AGUARDAR", confianca: 0 }; }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_global').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) return NextResponse.json({ success: true });

  const dataAtual = new Date();
  dataAtual.setMinutes(dataAtual.getMinutes() + 5);
  const horarioEntrada = dataAtual.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  for (const ativo of ativos) {
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 75) continue;

    const tagAcao = analysis.sinal === 'COMPRA' ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🎯 *SINAL EMITIDO*\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n⏰ *Entrada:* ${horarioEntrada}\n⏳ *Expiração:* ${analysis.expiracao_ob}\n🎯 *Taxa:* $${analysis.preco_alvo_entrada || mkt.precoAtual}\n🔥 *Confiança:* ${analysis.confianca}%`,
        parse_mode: 'Markdown'
      })
    });
  }

  return NextResponse.json({ success: true });
}
