export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 🧮 MÓDULO MATEMÁTICO DE PRECISÃO E AGILIDADE
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
  if (precos.length < 26) return { hist: 0 };
  const ema12 = calcularLinhaEMA(precos, 12);
  const ema26 = calcularLinhaEMA(precos, 26);
  const macdLine = precos.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = calcularLinhaEMA(macdLine, 9);
  const ultimoMacd = macdLine[macdLine.length - 1];
  const ultimoSignal = signalLine[signalLine.length - 1];
  return { hist: ultimoMacd - ultimoSignal };
}

function calcularEstocastico(fechamentos: number[], minimas: number[], maximas: number[], periodos = 14) {
  if (fechamentos.length < periodos) return 50;
  const minima = Math.min(...minimas.slice(-periodos));
  const maxima = Math.max(...ultimasMaximas(maximas, periodos));
  const fechamentoAtual = fechamentos[fechamentos.length - 1];
  if (maxima === minima) return 50;
  return ((fechamentoAtual - minima) / (maxima - minima)) * 100;
}

function ultimasMaximas(maxs: number[], p: number) { return maxs.slice(-p); }

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

    return {
      precoAtual: quote.regularMarketPrice || 0,
      rsi: calcularRSI(fechamentos, 14).toFixed(2),
      estocastico: calcularEstocastico(fechamentos, minimas, maximas, 14).toFixed(2),
      macdHist: calcularMACD(fechamentos).hist.toFixed(5),
      bbSuperior: calcularBollinger(fechamentos, 20).superior.toFixed(4),
      bbInferior: calcularBollinger(fechamentos, 20).inferior.toFixed(4),
      ema9: calcularLinhaEMA(fechamentos, 9).pop()?.toFixed(4) || 0,
      ema21: calcularLinhaEMA(fechamentos, 21).pop()?.toFixed(4) || 0
    };
  } catch (e) { return null; }
}

async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Analise ${ticker} para Opções Binárias (5 minutos). 
      DADOS: Preço=${mkt.precoAtual} | EMA9/21=${mkt.ema9}/${mkt.ema21} | Bollinger=${mkt.bbInferior}-${mkt.bbSuperior} | RSI=${mkt.rsi} | Estocástico=${mkt.estocastico} | MACD Hist=${mkt.macdHist}.

      INSTRUÇÃO DE ALTA AGILIDADE:
      1. Busque Padrões de Exaustão (Preço batendo nas bandas + RSI/Estocástico em zona de reversão).
      2. Não exija 100% de confluência; priorize sinais onde o preço está esticado fora das bandas e a tendência das EMAs permite a correção.
      3. Se houver um padrão claro de reversão de 5 minutos, emita o sinal.
      4. Se cenário incerto, retorne "AGUARDAR".
      
      Retorne APENAS JSON: {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "preco_alvo_entrada": number, "expiracao_ob": "1 Minuto"|"5 Minutos"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.25 
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

  const dataEntrada = new Date();
  dataEntrada.setMinutes(dataEntrada.getMinutes() + 5);
  const hora = dataEntrada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  for (const ativo of ativos) {
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 70) continue;

    const tagAcao = analysis.sinal === 'COMPRA' ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🎯 *SINAL DETECTADO*\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_').replace('=','_')}\n🎯 *Operação:* ${tagAcao}\n⏰ *Entrada:* ${hora}\n⏳ *Expiração:* ${analysis.expiracao_ob}\n🎯 *Preço Alvo:* $${analysis.preco_alvo_entrada || mkt.precoAtual}\n🔥 *Confiança:* ${analysis.confianca}%`,
        parse_mode: 'Markdown'
      })
    });
  }

  return NextResponse.json({ success: true });
}
