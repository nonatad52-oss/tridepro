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

  const agora = new Date();
  const inicioVelaAtual = new Date(agora);
  inicioVelaAtual.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5));
  inicioVelaAtual.setSeconds(0);
  inicioVelaAtual.setMilliseconds(0);
  const inicioVelaISO = inicioVelaAtual.toISOString();

  let analisesFeitas = 0;
  const MAX_ANALISES_POR_MINUTO = 3; 

  for (const ativo of ativos) {
    
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
      if (!res.ok) continue;

      const json = await res.json();
      const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
      
      if (!quote || !quote.close || !quote.open || !quote.high || !quote.low) continue; 

      const blocoVelas = [];
      for (let i = 0; i < quote.close.length; i++) {
        if (quote.close[i] != null && quote.open[i] != null && quote.high[i] != null && quote.low[i] != null) {
          blocoVelas.push({ abertura: quote.open[i], maxima: quote.high[i], minima: quote.low[i], fechamento: quote.close[i] });
        }
      }

      if (blocoVelas.length < 15) continue;
      const velas = blocoVelas.slice(-20);
      analisados.push(ativo); 

      const rsi = 100 - (100 / (1 + (velas.slice(-14).reduce((g: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento > arr[i-1].fechamento ? g + (v.fechamento - arr[i-1].fechamento) : g, 0) / 14 / (velas.slice(-14).reduce((p: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento < arr[i-1].fechamento ? p + (arr[i-1].fechamento - v.fechamento) : p, 0) / 14 || 1)))); 

      const isCrypto = ativo.endsWith('-USD');
      const limiteVenda = isCrypto ? 65 : 70;
      const limiteCompra = isCrypto ? 35 : 30;

      if (rsi >= limiteVenda || rsi <= limiteCompra) {
        
        // 🛡️ FILTRO ANTI-GLITCH: Se o RSI for absurdamente extremo (0.5 para baixo ou 99.5 para cima),
        // significa que o preço travou no Yahoo Finance. Ignoramos para poupar a cota da IA.
        if (rsi <= 0.5 || rsi >= 99.5) {
          console.log(`⚠️ Glitch detectado em ${ativo} (RSI: ${rsi.toFixed(2)} - Sem variação real). Pulando...`);
          continue;
        }

        if (analisesFeitas >= MAX_ANALISES_POR_MINUTO) {
          console.log(`⚠️ Limite de segurança atingido (${MAX_ANALISES_POR_MINUTO}/${MAX_ANALISES_POR_MINUTO}). Pulando ${ativo} para evitar bloqueio do Google.`);
          continue; 
        }

        console.log(`\n🚨 ALERTA RSI VALIDO: ${ativo} (${rsi.toFixed(2)}). Iniciando IA...`);
        
        const { data: sinalJaEnviado } = await supabase
          .from('historico_operacoes')
          .select('id')
          .eq('ticker', ativo)
          .gte('created_at', inicioVelaISO)
          .limit(1);

        if (sinalJaEnviado && sinalJaEnviado.length > 0) {
          console.log(`⏳ IA pulada: Sinal já enviado para ${ativo} nesta vela.`);
          continue; 
        }

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
          ? `ALERTA DE ATIVO: Este é um ativo CRIPTOMOEDA de ALTA VOLATILIDADE. Exija pavios de rejeição CLAROS antes de confirmar uma reversão.` 
          : `ALERTA DE ATIVO: Este é um ativo TRADICIONAL (Forex/Ações). O mercado tende a reverter a média com mais previsibilidade.`;

        const prompt = `Você é uma Inteligência Artificial Master Trader especializada em Price Action avançado e análise de Momentum no tempo gráfico M5 para o ativo ${ativo}.

        ${contextoMercado}

        DADOS ANATOMIA DOS CANDLES (Últimas 20 velas):
        ${JSON.stringify(velas)}

        MOMENTUM ATUAL:
        - RSI (14): ${rsi.toFixed(2)}
        
        SEU DIÁRIO DE APRENDIZADO RECENTE:
        ${diarioDeAprendizado}
        
        Decida se a próxima vela de 5 minutos reverterá ou continuará o movimento analisando o price action e padrões de exaustão. 
        Responda ESTRITAMENTE no formato JSON válido: 
        {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

        await new Promise(resolve => setTimeout(resolve, 2000));

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const resIA = await model.generateContent(prompt);
        analisesFeitas++; 
        
        const textResponse = resIA.response.text();
        const ia = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
        
        console.log(`🧠 [ESPIÃO] Decisão IA para ${ativo} -> SINAL: ${ia.sinal} | CONFIANÇA: ${ia.confianca_padrao}`);

        if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && parseInt(ia.confianca_padrao) >= 85) {
          console.log(`✅ SINAL APROVADO! Enviando ${ativo} para o Telegram...`);
          await enviarSinalTelegram(ativo, ia, velas[velas.length-1].fechamento, rsi);
        } else {
          console.log(`❌ SINAL REJEITADO pela IA.`);
        }
      }
    } catch (e: any) { 
      console.log(`❌ Erro técnico em ${ativo}. Detalhes reais do erro:`, e?.message || e); 
    }
  }

  return NextResponse.json({ 
    success: true, 
    mensagem: `Varredura executada. Total de requisições enviadas ao Google: ${analisesFeitas}`, 
    ativos_analisados: analisados 
  });
}
