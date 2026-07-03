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

  const mensagem = `🎯 *SINAL (M5)* 🎯\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança IA: ${iaData.confianca_padrao}`;
  
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

      if (rsi >= 70 || rsi <= 30) {
        
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
        
        // Prompt Avançado enviando a anatomia completa do candle para a nova IA estável
        const prompt = `Você é uma Inteligência Artificial Master Trader especializada em Price Action avançado e análise de Momentum no tempo gráfico M5 para o ativo ${ativo}.

        DADOS ANATOMIA DOS CANDLES (Últimas 20 velas em ordem cronológica contendo Abertura, Máxima, Mínima e Fechamento):
        ${JSON.stringify(velas)}

        ESTADO DE MOMENTUM ATUAL:
        - RSI (14) Atual: ${rsi.toFixed(2)}
        
        SEU DIÁRIO DE APRENDIZADO RECENTE (Evite repetir erros anteriores se houver uma tendência forte):
        ${diarioDeAprendizado}
        
        SUA MISSÃO ANALÍTICA:
        1. Avalie o Price Action puro analisando o tamanho do corpo dos candles e, principalmente, os pavios (sombras) de rejeição nas regiões críticas indicadas pelo RSI.
        2. Identifique a presença de padrões de candles altamente preditivos (ex: Martelos, Estrelas Cadentes, Engolfos, Dojis de Rejeição) que confirmem o esgotamento do movimento atual.
        3. Cruze a estrutura gráfica com seu Diário de Aprendizado para calibrar sua taxa de acerto. Se o mercado estiver rompendo consistentemente seus setups passados, seja conservador.

        Decida se a próxima vela de 5 minutos reverterá ou continuará o movimento. 
        Responda ESTRITAMENTE no formato JSON válido: 
        {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

        // CORREÇÃO AQUI: Mudança para o modelo estável atualizado
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
    mensagem: "Varredura Concluída com Loop de Aprendizado Ativo e IA Atualizada", 
    ativos_analisados: analisados 
  });
}
