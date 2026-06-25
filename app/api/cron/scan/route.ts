export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// 1. Coleta Dinâmica de Dados
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
      volumeMedio3M: quote.averageDailyVolume3Month || 0,
      historico10Dias: ultimosFechamentos.join(', ')
    };
  } catch (e) { 
    return null; 
  }
}

// 2. Cérebro Focado em Day Trade e Opções Binárias
async function getSurgicalSignal(ticker: string, mkt: any) {
  try {
    const prompt = `
      Você é um Trader de Elite especialista em Scalping e Opções Binárias (Price Action micro).
      Analise o ativo ${ticker} para identificar entradas imediatas de CALL/PUT ou Compra/Venda rápida:
      
      MÉTRICAS ATUAIS:
      - Preço Atual: ${mkt.precoAtual} (Variação do Dia: ${mkt.variacaoDia}%)
      - Extremos do Dia: Mínima=${mkt.minimaDia} | Máxima=${mkt.maximaDia}
      - Histórico Recente (Últimos 10 períodos): [${mkt.historico10Dias}]

      ESTRATÉGIA DE ALTA FREQUÊNCIA:
      1. Avalie a posição do Preço Atual em relação à Máxima e Mínima do dia para achar suporte/resistência.
      2. Se o preço atual estiver muito perto da Mínima do dia e o histórico recente mostrar reação, é forte candidato a CALL (Compra).
      3. Se o preço atual estiver muito perto da Máxima do dia com perda de força, é forte candidato a PUT (Venda).
      4. Defina tempos rápidos de expiração para Opções Binárias (1 Minuto ou 5 Minutos).
      5. Só retorne "AGUARDAR" se o preço estiver exatamente travado no mesmo valor do histórico.

      Retorne APENAS um JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "stop_loss": number, "take_profit": number, "expiracao_ob": "1 Minuto"|"5 Minutos"|"15 Minutos", "gatilho_tecnico": "motivo rápido do price action"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.35 // Mais flexível para caçar padrões de velas rápidos
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
    return NextResponse.json({ success: true, message: "Sem ativos." });
  }

  let sinaisEnviados = 0;
  let ativosAnalisados = [];
  
  for (const ativo of ativos) {
    ativosAnalisados.push(ativo.ticker);
    const mkt = await getAdvancedMarketData(ativo.ticker);
    if (!mkt) continue;

    const analysis = await getSurgicalSignal(ativo.ticker, mkt);

    // BARRA DE FILTRO REDUZIDA PARA OPERAÇÕES DIÁRIAS (75% de confiança mínima)
    if (analysis.sinal === "AGUARDAR" || analysis.confianca < 75) continue;

    sinaisEnviados++;
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

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `ℹ️ *Relatório do Gênio:*\nVarredura Concluída.\n\n📋 *Ativos:* ${ativosAnalisados.join(', ')}\n🎯 *Sinais:* ${sinaisEnviados}`,
      parse_mode: 'Markdown'
    })
  });

  return NextResponse.json({ success: true });
}
