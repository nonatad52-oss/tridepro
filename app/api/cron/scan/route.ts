export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 🧮 MOTOR MATEMÁTICO PROPRIETÁRIO
function calcularLinhaEMA(precos: number[], periodos: number): number[] {
  const k = 2 / (periodos + 1);
  let ema = [precos[0]];
  for (let i = 1; i < precos.length; i++) ema.push(precos[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

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

function calcularMétricasAceleração(fechamentos: number[]) {
  if (fechamentos.length < 5) return { aceleracaoCurta: 0, desvioVelocidade: false };
  const atual = fechamentos[fechamentos.length - 1];
  const anterior1 = fechamentos[fechamentos.length - 2];
  const anterior3 = fechamentos[fechamentos.length - 4];
  const varizacao1Vela = ((atual - anterior1) / anterior1) * 100;
  const variacao3Velas = ((atual - anterior3) / anterior3) * 100;
  return {
    aceleracaoCurta: Number(varizacao1Vela.toFixed(4)),
    desvioVelocidade: Math.abs(varizacao1Vela) > Math.abs(variacao3Velas) * 1.5
  };
}

function calcularStressScore(fechamentos: number[], rsi: number, precoAtual: number, ema21: number) {
  let score = 0;
  const distanciaMedia = ((precoAtual - ema21) / ema21) * 100;
  if (Math.abs(distanciaMedia) > 0.35) score += 35; 
  else if (Math.abs(distanciaMedia) > 0.20) score += 20;

  if (rsi > 75 || rsi < 25) score += 35; 
  else if (rsi > 68 || rsi < 32) score += 15;

  const { desvioVelocidade } = calcularMétricasAceleração(fechamentos);
  if (desvioVelocidade) score += 30; 

  return { scoreTotal: score, distanciaMedia: distanciaMedia.toFixed(4), desvioVelocidade };
}

// 🛡️ MEMÓRIA DE LOSS E REGISTRO
async function verificarBloqueioPorLoss(supabase: any, ticker: string): Promise<boolean> {
  try {
    const tresHorasAtras = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { data: ultimas } = await supabase.from('historico_operacoes')
      .select('resultado').eq('ticker', ticker).gt('criado_em', tresHorasAtras).order('criado_em', { ascending: false }).limit(2);
    if (ultimas && ultimas.length >= 2) return ultimas.every((op: any) => op.resultado === 'LOSS');
    return false;
  } catch (e) { return false; }
}

async function registrarOperacaoNoBanco(supabase: any, ticker: string, sinal: string, taxa: number) {
  try {
    const { data } = await supabase.from('historico_operacoes').insert([{
      ticker, sinal, taxa_entrada: taxa, resultado: 'PENDENTE', criado_em: new Date().toISOString()
    }]).select('id').single();
    return data ? data.id : null;
  } catch (e) { return null; }
}

// 👁️ AUDITORIA IA
async function auditoriaIA(ticker: string, mkt: any, stress: any) {
  try {
    const prompt = `Analise: ${ticker} | Preço: ${mkt.precoAtual} | Score Estresse: ${stress.scoreTotal}/100 | RSI: ${mkt.rsi} | Aceleração: ${mkt.aceleracao}%.
    Decida se é exaustão real ou tendência forte. Se score < 60 ou aceleração direcional sem pausa, retorne AGUARDAR.
    Retorne JSON: {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "justificativa_metrica": "Motivo curto"}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "llama3-70b-8192", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.15 })
    });
    return JSON.parse((await response.json()).choices[0].message.content);
  } catch (e) { return { sinal: "AGUARDAR", confianca: 0 }; }
}

// 🚀 ORQUESTRADOR
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_global').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) return NextResponse.json({ success: true });

  const horaSinalizada = new Date(Date.now() + 5 * 60000).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  for (const ativo of ativos) {
    try {
      if (await verificarBloqueioPorLoss(supabase, ativo.ticker)) continue;

      const diasAtras = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      // @ts-ignore
      const historical = await yahooFinance.historical(ativo.ticker, { period1: diasAtras });
      // @ts-ignore
      const quote = await yahooFinance.quote(ativo.ticker);

      const fechamentos = historical.map(dia => Number(dia.close));
      const precoAtual = quote.regularMarketPrice || fechamentos[fechamentos.length - 1];
      const rsi = calcularRSI(fechamentos, 14);
      const ema21 = calcularLinhaEMA(fechamentos, 21).pop() || precoAtual;
      const metricsAcel = calcularMétricasAceleração(fechamentos);
      const stress = calcularStressScore(fechamentos, rsi, precoAtual, ema21);

      if (stress.scoreTotal < 60) continue;

      const auditoria = await auditoriaIA(ativo.ticker, { precoAtual, rsi: rsi.toFixed(2), aceleracao: metricsAcel.aceleracaoCurta }, stress);
      if (auditoria.sinal === "AGUARDAR" || auditoria.confianca < 75) continue;

      // Grava no banco e pega a ID
      const operacaoId = await registrarOperacaoNoBanco(supabase, ativo.ticker, auditoria.sinal, precoAtual);

      const direcaoSinal = auditoria.sinal === 'COMPRA' ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';
      const tagAtivo = ativo.ticker.replace('-','_').replace('=','_');
      
      // Monta os botões atrelados à ID
      const tecladoInline = operacaoId ? {
        inline_keyboard: [
          [{ text: "✅ WIN", callback_data: `res_WIN_${operacaoId}` }, { text: "❌ LOSS", callback_data: `res_LOSS_${operacaoId}` }]
        ]
      } : undefined;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `⚡ *SUPER ANALISADOR QUANT*\n\n📈 *Ativo:* #${tagAtivo}\n🎯 *Operação:* ${direcaoSinal}\n⏰ *Entrada:* ${horaSinalizada}\n⏳ *Expiração:* 5 Minutos\n🎯 *Taxa:* $${precoAtual}\n🔥 *Confiança:* ${auditoria.confianca}%\n\n🌐 *Auditoria:* _${auditoria.justificativa_metrica}_\n\n👇 *Registre o resultado abaixo:*`,
          parse_mode: 'Markdown',
          reply_markup: tecladoInline
        })
      });

    } catch (e) { continue; }
  }

  return NextResponse.json({ success: true });
}
