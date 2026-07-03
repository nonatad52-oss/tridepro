import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'chave-temporaria';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'chave-temporaria';
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  let ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
  
  const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const agora = new Date();
  const proximaVela = new Date(agora);
  proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
  proximaVela.setSeconds(0);
  const expiracao = new Date(proximaVela);
  expiracao.setMinutes(expiracao.getMinutes() + 5);

  const { data: insertData } = await supabase
    .from('historico_operacoes')
    .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
    .select('id').single();

  if (!insertData) return;

  const tipoAtivo = ativo.endsWith('-USD') ? '🪙 CRIPTO' : '💱 FOREX/AÇÕES';
  const mensagem = `🎯 *SINAL (M5) | ${tipoAtivo}* 🎯\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança IA: ${iaData.confianca_padrao}`;
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }]] } }),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
  if (!ativosDB) return NextResponse.json({ error: "Erro ao buscar ativos no banco de dados" });

  const ativos = ativosDB.map(a => a.ticker);
  const analisados: string[] = [];

  for (const ativo of ativos) {
    console.log(`📡 Analisando o ativo: ${ativo}...`);
    
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
      if (!res.ok) continue;

      const json = await res.json();
      const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
      
      if (!quote || !quote.close || !quote.open || !quote.high || !quote.low) continue; 

      const blocoVelas = [];
      for (let i = 0; i < quote.close.length; i++) {
        if (quote.close[i] != null && quote.open[i] != null && quote.high[i] != null && quote.low[i] != null) {
          blocoVelas.push({
            abertura: quote.open[i],
            maxima: quote.high[i],
            minima: quote.low[i],
            fechamento: quote.close[i]
          });
        }
      }

      if (blocoVelas.length < 15) continue;
      const velas = blocoVelas.slice(-20);
      analisados.push(ativo); 

      const rsi = 100 - (100 / (1 + (velas.slice(-14).reduce((g: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento > arr[i-1].fechamento ? g + (v.fechamento - arr[i-1].fechamento) : g, 0) / 14 / (velas.slice(-14).reduce((p: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento < arr[i-1].fechamento ? p + (arr[i-1].fechamento - v.fechamento) : p, 0) / 14 || 1)))); 

      // LÓGICA DINÂMICA DE RSI: Criptomoedas ganham mais espaço (65/35). Forex continua conservador (70/30).
      const isCrypto = ativo.endsWith('-USD');
      const limiteVenda = isCrypto ? 65 : 70;
      const limiteCompra = isCrypto ? 35 : 30;

      if (rsi >= limiteVenda || rsi <= limiteCompra) {
        
        // Memória de Aprendizado do Supabase
        const { data: historico } = await supabase
          .from('historico_operacoes')
          .select('sinal, resultado')
          .eq('ticker', ativo)
          .in('resultado', ['WIN', 'LOSS'])
          .order('id', { ascending: false })
          .limit(5);

        let diarioDeAprendizado = "Nenhuma operação finalizada recentemente para este ativo.";
        if (historico && historico.length > 0) {
          diarioDeAprendizado = historico.map((h, i) => `[Anterior ${i+1}]: Sinal de ${h.sinal} -> Resultado: ${h.resultado}`).join('\n');
        }
        
        const contextoMercado = isCrypto 
          ? `ALERTA DE ATIVO: Este é um ativo CRIPTOMOEDA de ALTA VOLATILIDADE. Criptos tendem a formar tendências fortes (efeito manada). Exija pavios de rejeição CLAROS antes de confirmar uma reversão, pois o RSI pode permanecer esticado por muito tempo.` 
          : `ALERTA DE ATIVO: Este é um ativo TRADICIONAL (Forex/Ações). O mercado tende a respeitar zonas de sobrecompra/sobrevenda com maior precisão e reverter a média.`;

        // Prompt Avançado 
        const prompt = `Você é uma Inteligência Artificial Master Trader especializada em Price Action avançado e análise de Momentum no tempo gráfico M5 para o ativo ${ativo}.

        ${contextoMercado}

        DADOS ANATOMIA DOS CANDLES (Últimas 20 velas em ordem cronológica contendo Abertura, Máxima, Mínima e Fechamento):
        ${JSON.stringify(velas)}

        ESTADO DE MOMENTUM ATUAL:
        - RSI (14) Atual: ${rsi.toFixed(2)} (Filtro aplicado: Compra abaixo de ${limiteCompra}, Venda acima de ${limiteVenda})
        
        SEU DIÁRIO DE APRENDIZADO RECENTE:
        ${diarioDeAprendizado}
        
        SUA MISSÃO ANALÍTICA:
        1. Avalie o Price Action puro: tamanho dos corpos e as sombras (pavios) de rejeição.
        2. Identifique padrões de exaustão (ex: Martelos, Estrelas Cadentes, Engolfos, Dojis). Se não houver rejeição clara no último ou penúltimo candle, a tendência pode continuar (sinal NEUTRO).
        3. Cruze a estrutura gráfica com seu Diário de Aprendizado.

        Decida se a próxima vela de 5 minutos reverterá ou continuará o movimento. 
        Responda ESTRITAMENTE no formato JSON válido: 
        {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const resIA = await model.generateContent(prompt);
        const textResponse = resIA.response.text();
        const ia = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
        
        if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && parseInt(ia.confianca_padrao) >= 85) {
          await enviarSinalTelegram(ativo, ia, velas[velas.length-1].fechamento, rsi);
        }
      }
    } catch (e) { 
      console.log(`❌ Erro em ${ativo}, pulando.`); 
    }
  }

  return NextResponse.json({ 
    success: true, 
    mensagem: "Varredura Concluída com Loop de Aprendizado e Otimização para Criptomoedas ativada.", 
    ativos_analisados: analisados 
  });
}
