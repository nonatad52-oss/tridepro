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

  const mensagem = `🚨 *SINAL DE TESTE FORÇADO* 🚨\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI Real: ${rsi.toFixed(2)}\n🧠 Modo: Teste de Conexão Ativo`;
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }]] } }),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
  if (!ativosDB) return NextResponse.json({ error: "Erro ao buscar ativos" });

  const ativos = ativosDB.map(a => a.ticker);
  const analisados: string[] = [];

  for (const ativo of ativos) {
    console.log(`🚨 MODO TESTE - Forçando análise em: ${ativo}...`);
    
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

      // PROMPT DE TESTE: Obriga a IA a ignorar filtros e emitir um sinal imediato
      const prompt = `Você está participando de um diagnóstico técnico de infraestrutura.
      A análise real de mercado está pausada. Você DEVE escolher aleatoriamente entre COMPRA ou VENDA baseado estritamente na última vela e retornar confiança de 95%. Não retorne NEUTRO sob circunstância alguma.
      
      Ativo: ${ativo}
      Dados: ${JSON.stringify(velas)}

      Responda ESTRITAMENTE neste JSON:
      {"sinal": "COMPRA" | "VENDA", "confianca_padrao": "95%"}`;

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const resIA = await model.generateContent(prompt);
      const textResponse = resIA.response.text();
      const ia = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
      
      // Envia o sinal ignorando qualquer barreira matemática
      await enviarSinalTelegram(ativo, ia, velas[velas.length-1].fechamento, rsi);
      
      console.log(`✅ TESTE REALIZADO COM SUCESSO PARA O ATIVO ${ativo}. Parando loop.`);
      break; 
      
    } catch (e) { 
      console.log(`❌ Erro no teste de ${ativo}, pulando para o próximo.`); 
    }
  }

  return NextResponse.json({ 
    success: true, 
    mensagem: "TESTE FORÇADO EXECUTADO. Verifique o Telegram.", 
    ativos_analisados: analisados 
  });
}
