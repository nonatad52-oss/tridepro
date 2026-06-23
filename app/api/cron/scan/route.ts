export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 1. Coleta de dados do Mercado
async function getMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    return {
      preco: quote.regularMarketPrice || 0,
      variacao: quote.regularMarketChangePercent || 0,
      maximaDia: quote.regularMarketDayHigh || 0,
      minimaDia: quote.regularMarketDayLow || 0,
      media50: quote.fiftyDayAverage || 0,
      media200: quote.twoHundredDayAverage || 0
    };
  } catch (e) { 
    return null; 
  }
}

// 2. Cérebro de Análise (Groq AI)
async function getGeniusSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Analise o ativo ${ticker}. Preço: ${mkt.preco}, Variacao: ${mkt.variacao}%.
      Retorne APENAS um objeto JSON no seguinte formato, sem textos adicionais:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "stop_loss": number, "take_profit": number, "analise_padrao": "breve explicacao"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" } 
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return { sinal: "AGUARDAR", confianca: 0, stop_loss: 0, take_profit: 0, analise_padrao: "Erro na IA" };
  }
}

// 3. Rota Principal Executada pelo Cron / Navegador
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // TESTE DE CONEXÃO FORÇADO: Envia uma mensagem para garantir que o Bot está vivo
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `🔄 *Gênio Tridepro:* Conexão confirmada! Iniciando análise dos ativos...`,
      parse_mode: 'Markdown'
    })
  });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // Busca os ativos configurados no seu Supabase
  const { data: ativos, error: dbError } = await supabase
    .from('ativos_monitorados')
    .select('*')
    .eq('status_ativo', true);

  if (dbError || !ativos || ativos.length === 0) {
    // Alerta caso não encontre ativos cadastrados ou ativos ativos=true
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `⚠️ *Aviso:* Nenhhum ativo ativo encontrado na tabela 'ativos_monitorados'.`,
        parse_mode: 'Markdown'
      })
    });
    return NextResponse.json({ success: true, message: "Nenhum ativo encontrado." });
  }
  
  for (const ativo of ativos) {
    const mkt = await getMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getGeniusSignal(ativo.ticker, mkt);

    // Se a IA decidir aguardar, o robô pula para o próximo ativo de forma inteligente
    if (analysis.sinal === "AGUARDAR") continue;

    // Envia o Sinal Real Gerado pela IA
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🧠 *ANÁLISE DE GÊNIO*\n\n📈 *Ativo:* ${ativo.ticker}\n🎯 *Ação:* ${analysis.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n📊 *Confiança:* ${analysis.confianca}%\n\n🛑 *SL:* ${analysis.stop_loss} | 🎯 *TP:* ${analysis.take_profit}\n\n🕵️‍♂️ *Padrão:* ${analysis.analise_padrao}`,
        parse_mode: 'Markdown'
      })
    });
  }

  return NextResponse.json({ success: true });
}
