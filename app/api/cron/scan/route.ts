export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 1. Função para buscar dados de mercado em tempo real
async function getMarketData(ticker: string) {
  try {
    const quote = await yahooFinance.quote(ticker);
    return {
      preco: quote.regularMarketPrice,
      variacao: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume
    };
  } catch (e) { return null; }
}

// 2. Lógica de Inteligência do Mago (Groq)
async function getExpertSignal(ticker: string, mkt: any, context: any) {
  const isOverextended = Math.abs(mkt.variacao) > 3.0;
  
  const prompt = `
    Analise o ativo ${ticker}. 
    Dados Atuais: Preço: ${mkt.preco}, Variação: ${mkt.variacao}%, Volume: ${mkt.volume}.
    Contexto: ${context.session}.
    
    ESTRATÉGIA: ${isOverextended ? "REVERSÃO À MÉDIA (O mercado esticou demais)" : "SEGUIR TENDÊNCIA"}
    ${isOverextended ? "Como o ativo esticou mais de 3%, procure sinais de exaustão para operar contra a tendência." : "Busque continuidade com base no fluxo de volume."}
    
    Retorne APENAS JSON estrito: {"sinal": "COMPRA"|"VENDA", "confianca": number, "stop_loss": number, "take_profit": number, "motivo": string}
  `;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: "llama3-70b-8192", messages: [{ role: "user", content: prompt }] })
  });
  
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// 3. Rota Principal
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) return new NextResponse('Unauthorized', { status: 401 });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // Busca apenas ativos ativos
  const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);
  
  const hour = new Date().getUTCHours();
  const context = { session: hour < 8 ? "ASIATICA" : hour < 13 ? "EUROPEIA" : "AMERICANA" };

  for (const ativo of ativos || []) {
    const mkt = await getMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getExpertSignal(ativo.ticker, mkt, context);

    if (analysis.confianca >= 85) {
      await supabase.from('historico_sinais').insert([{
        ticker: ativo.ticker,
        direcao: analysis.sinal,
        assertividade_passada: analysis.confianca,
        stop_loss: analysis.stop_loss,
        take_profit: analysis.take_profit
      }]);
      
      // Envio para Telegram
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `⚡ *SINAL DO MAGO*\n\n📈 *Ativo:* ${ativo.ticker}\n💰 *Preço:* ${mkt.preco}\n🎯 *Direção:* ${analysis.sinal}\n📊 *Confiança:* ${analysis.confianca}%\n\n💡 *Motivo:* ${analysis.motivo}`,
          parse_mode: 'Markdown'
        })
      });
    }
  }
  return NextResponse.json({ success: true });
}
