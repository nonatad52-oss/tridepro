export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

async function getMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    return {
      preco: quote.regularMarketPrice,
      variacao: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
      maximaDia: quote.regularMarketDayHigh,
      minimaDia: quote.regularMarketDayLow,
      media50: quote.fiftyDayAverage,
      media200: quote.twoHundredDayAverage
    };
  } catch (e) { return null; }
}

async function getGeniusSignal(ticker: string, mkt: any, context: any, ultimoSinal: string) {
  const prompt = `
    Você é um sistema de Inteligência Artificial quantitativo e Mago dos Mercados Financeiros.
    Sua missão é analisar o ativo ${ticker} e decidir com precisão institucional.

    DADOS TÉCNICOS:
    - Preço Atual: ${mkt.preco} (Variação: ${mkt.variacao}%)
    - Limites do Dia: Mínima: ${mkt.minimaDia} | Máxima: ${mkt.maximaDia}
    - Médias Móveis: MA50: ${mkt.media50} | MA200: ${mkt.media200}
    
    MEMÓRIA:
    - Sessão: ${context.session}
    - Último sinal: ${ultimoSinal || "Nenhum"}

    ESTRATÉGIAS:
    1. SMART MONEY (SMC): Identifique quebra de estrutura.
    2. REVERSÃO À MÉDIA: Se muito esticado (longe da MA50), procure exaustão.
    3. FLUXO: Tendência forte a favor da MA200.

    REGRAS:
    - Retorne "AGUARDAR" se não houver clareza.
    - Assertividade exigida: Mínimo 89%.
    - Não repita o último sinal se o ciclo não mudou.

    Retorne APENAS JSON:
    {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "stop_loss": number, "take_profit": number, "analise_padrao": "string explicando"}
  `;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: "llama3-70b-8192", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);
  
  const hour = new Date().getUTCHours();
  const context = { session: hour < 8 ? "ASIATICA" : hour < 13 ? "EUROPEIA" : "AMERICANA" };

  for (const ativo of ativos || []) {
    const mkt = await getMarketData(ativo.ticker);
    if (!mkt) continue;

    const { data: historico } = await supabase
      .from('historico_sinais')
      .select('direcao')
      .eq('ticker', ativo.ticker)
      .order('id', { ascending: false })
      .limit(1);
    
    const ultimoSinal = historico && historico.length > 0 ? historico[0].direcao : "NENHUM";

    const analysis = await getGeniusSignal(ativo.ticker, mkt, context, ultimoSinal);

    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 89) continue;
    if (analysis.sinal === ultimoSinal) continue;

    await supabase.from('historico_sinais').insert([{
      ticker: ativo.ticker,
      direcao: analysis.sinal,
      assertividade_passada: analysis.confianca,
      stop_loss: analysis.stop_loss,
      take_profit: analysis.take_profit
    }]);
    
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🧠 *ANÁLISE DE GÊNIO*\n\n📈 *Ativo:* ${ativo.ticker}\n💰 *Preço Atual:* ${mkt.preco}\n🎯 *Ação Institucional:* ${analysis.sinal}\n📊 *Confiança:* ${analysis.confianca}%\n\n🛑 *SL:* ${analysis.stop_loss} | 🎯 *TP:* ${analysis.take_profit}\n\n🕵️‍♂️ *Padrão Gráfico:* ${analysis.analise_padrao}`,
        parse_mode: 'Markdown'
      })
    });
  }
  return NextResponse.json({ success: true });
}
