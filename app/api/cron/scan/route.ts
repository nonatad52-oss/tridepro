export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 1. Coleta Avançada de Dados (Mercado Tradicional e Cripto)
async function getAdvancedMarketData(ticker: string) {
  try {
    // @ts-ignore
    const quote = await yahooFinance.quote(ticker);
    
    // Busca os últimos 30 dias para entender a tendência macro
    const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
    console.error(`Erro ao buscar dados do ativo ${ticker}:`, e);
    return null; 
  }
}

// 2. Cérebro de Análise Híbrido (Cripto + Opções Binárias)
async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Você é um algoritmo de Alta Frequência (HFT) e especialista em Price Action e Fluxo de Ordens.
      Analise o ativo ${ticker} para os mercados de Cripto, Forex ou Opções Binárias:
      
      DADOS DO ATIVO:
      - Preço Atual: ${mkt.precoAtual} (Variação no Dia: ${mkt.variacaoDia}%)
      - Médias Móveis: SMA50=${mkt.media50} | SMA200=${mkt.media200}
      - Volume de Negociação Atual: ${mkt.volumeHoje} (Média 3M: ${mkt.volumeMedio3M})
      - Histórico de Fechamentos (Últimos 15 períodos): [${mkt.historico15Dias}]

      DIRETRIZES DE ANÁLISE:
      1. Se o mercado estiver sem volume ou muito lateralizado no histórico, retorne "AGUARDAR".
      2. Para COMPRA (CALL): O preço deve estar demonstrando força de reversão ou tendência de alta clara.
      3. Para VENDA (PUT): O preço deve estar demonstrando exaustão de compradores ou forte fluxo vendedor.
      4. Defina o tempo de expiração ideal para Opções Binárias (1m, 5m ou 15m) com base na volatilidade do ativo.

      Retorne APENAS um objeto JSON válido, sem qualquer texto adicional fora das chaves:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "stop_loss": number, "take_profit": number, "expiracao_ob": "1 Minuto"|"5 Minutos"|"15 Minutos", "gatilho_tecnico": "string explicando o padrão gráfico encontrado"}
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
        response_format: { type: "json_object" },
        temperature: 0.15 // Máxima precisão matemática, sem espaço para invenções
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return { sinal: "AGUARDAR", confianca: 0, stop_loss: 0, take_profit: 0, expiracao_ob: "5 Minutos", gatilho_tecnico: "Erro no processamento da IA" };
  }
}

// 3. Rota Principal de Disparo
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_monitorados').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) {
    return NextResponse.json({ success: true, message: "Nenhum ativo configurado como ativo=true no banco." });
  }
  
  for (const ativo of ativos) {
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);

    // Se o sinal for de aguardar ou a confiança for menor que 85%, ignora o disparo
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 85) continue;

    // Configura os emojis e termos baseado na direção
    const isCompra = analysis.sinal === 'COMPRA';
    const tagAcao = isCompra ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';

    // Layout Unificado: Cripto + Opções Binárias
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🧠 *SINAL GÊNIO QUANT PRO*\n\n📈 *Ativo:* #${ativo.ticker.replace('-','_')}\n🎯 *Operação:* ${tagAcao}\n🔥 *Confiança:* ${analysis.confianca}%\n\n⏱️ *OPÇÕES BINÁRIAS (OB):*\n⏳ *Expiração:* ${analysis.expiracao_ob}\n\n🪙 *MERCADO CRIPTO / TRADICIONAL:*\n💲 *Preço de Entrada:* $${mkt.precoAtual}\n🛑 *Stop Loss:* $${analysis.stop_loss}\n🎯 *Take Profit:* $${analysis.take_profit}\n\n⚡ *Análise de Filtro:* ${analysis.gatilho_tecnico}`,
        parse_mode: 'Markdown'
      })
    });
  }

  return NextResponse.json({ success: true });
}
