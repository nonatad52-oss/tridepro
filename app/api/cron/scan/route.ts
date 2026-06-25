export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 🧮 MÓDULO MATEMÁTICO DE ALTA PRECISÃO
function calcularRSI(precos: number[], periodos = 14) {
  if (precos.length < periodos + 1) return 50;
  let ganhos = 0; let perdas = 0;
  for (let i = precos.length - periodos; i < precos.length; i++) {
    const dif = precos[i] - precos[i - 1];
    if (dif >= 0) ganhos += dif; else perdas -= dif;
  }
  const rs = (ganhos / periodos) / (perdas / periodos || 1);
  return 100 - (100 / (1 + rs));
}

function calcularBollinger(precos: number[], periodos = 20) {
  if (precos.length < periodos) return { superior: 0, inferior: 0 };
  const corte = precos.slice(-periodos);
  const sma = corte.reduce((a, b) => a + b, 0) / periodos;
  const variancia = corte.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / periodos;
  const dp = Math.sqrt(variancia);
  return { superior: sma + (dp * 2), inferior: sma - (dp * 2) };
}

function calcularLinhaEMA(precos: number[], periodos: number): number[] {
  const k = 2 / (periodos + 1);
  let ema = [precos[0]];
  for (let i = 1; i < precos.length; i++) ema.push(precos[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcularMACD(precos: number[]) {
  if (precos.length < 26) return { macd: 0, sinal: 0, hist: 0 };
  const ema12 = calcularLinhaEMA(precos, 12);
  const ema26 = calcularLinhaEMA(precos, 26);
  const macdLine = precos.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = calcularLinhaEMA(macdLine, 9);
  const ultimoMacd = macdLine[macdLine.length - 1];
  const ultimoSignal = signalLine[signalLine.length - 1];
  return { macd: ultimoMacd, sinal: ultimoSignal, hist: ultimoMacd - ultimoSignal };
}

function calcularEstocastico(fechamentos: number[], minimas: number[], maximas: number[], periodos = 14) {
  if (fechamentos.length < periodos) return 50;
  const ultimasMinimas = minimas.slice(-periodos);
  const ultimasMaximas = maximas.slice(-periodos);
  const minima = Math.min(...ultimasMinimas);
  const maxima = Math.max(...ultimasMaximas);
  const fechamentoAtual = fechamentos[fechamentos.length - 1];
  if (maxima === minima) return 50;
  return ((fechamentoAtual - minima) / (maxima - minima)) * 100;
}

async function getAdvancedMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    const diasAtras = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    // @ts-ignore
    const historical = await yahooFinance.historical(ticker, { period1: diasAtras });

    const fechamentos = historical.map(dia => Number(dia.close));
    const minimas = historical.map(dia => Number(dia.low));
    const maximas = historical.map(dia => Number(dia.high));

    const rsi = calcularRSI(fechamentos, 14);
    const bb = calcularBollinger(fechamentos, 20);
    const ema9 = calcularLinhaEMA(fechamentos, 9).pop() || 0;
    const ema21 = calcularLinhaEMA(fechamentos, 21).pop() || 0;
    const macd = calcularMACD(fechamentos);
    const estocastico = calcularEstocastico(fechamentos, minimas, maximas, 14);

    return {
      precoAtual: quote.regularMarketPrice || 0,
      rsi: rsi.toFixed(2),
      estocastico: estocastico.toFixed(2),
      macdHist: macd.hist.toFixed(5),
      bbSuperior: bb.superior.toFixed(4),
      bbInferior: bb.inferior.toFixed(4),
      ema9: ema9.toFixed(4),
      ema21: ema21.toFixed(4)
    };
  } catch (e) { return null; }
}

async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Analise ${ticker} para Opções Binárias (5 minutos) exigindo PERFEITA CONFLUÊNCIA:
      - Preço: ${mkt.precoAtual} | EMA9: ${mkt.ema9} | EMA21: ${mkt.ema21}
      - Bollinger: Sup=${mkt.bbSuperior} | Inf=${mkt.bbInferior}
      - RSI (14): ${mkt.rsi} | Estocástico (14): ${mkt.estocastico}
      - MACD Histograma: ${mkt.macdHist}

      REGRAS DE CONFLUÊNCIA EXTREMA:
      1. CALL (COMPRA): Preço perto da Bollinger Inferior + RSI < 30 + Estocástico < 20 (Ambos sobrevendidos) + MACD Histograma mostrando perda de força de venda.
      2. PUT (VENDA): Preço perto da Bollinger Superior + RSI > 70 + Estocástico > 80 (Ambos sobrecomprados) + MACD Histograma mostrando perda de força de compra.
      3. Se o RSI e o Estocástico discordarem, RETORNE "AGUARDAR".
      
      Retorne APENAS JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "preco_alvo_entrada": number, "expiracao_ob": "1 Minuto"|"5 Minutos"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.1
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
    
    // Filtro cirúrgico mantido acima de 78%
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 78) continue;

    const tagAcao = analysis.sinal === 'COMPRA' ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `💎 *SINAL INSTITUCIONAL*\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n⏰ *Entrada:* ${horarioEntrada}\n⏳ *Expiração:* ${analysis.expiracao_ob}\n🎯 *Taxa:* $${analysis.preco_alvo_entrada || mkt.precoAtual}\n🔥 *Confiança:* ${analysis.confianca}%`,
        parse_mode: 'Markdown'
      })
    });
  }

  return NextResponse.json({ success: true });
}
