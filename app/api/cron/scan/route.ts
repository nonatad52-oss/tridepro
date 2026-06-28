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
  // 1. Formatação do Nome do Ativo (Ex: CHFJPY=X vira CHF/JPY e BTC-USD vira BTC/USD)
  let ativoFormatado = ativo;
  if (ativo.endsWith('=X') && ativo.length === 8) {
    ativoFormatado = ativo.substring(0, 3) + '/' + ativo.substring(3, 6);
  } else if (ativo.includes('-')) {
    ativoFormatado = ativo.replace('-', '/');
  }

  // 2. Cálculo dos Horários para M5 (Fuso de Brasília)
  const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const agora = new Date();
  
  // Arredonda para a próxima vela múltipla de 5 minutos
  const proximaVela = new Date(agora);
  proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
  proximaVela.setSeconds(0);
  
  // Adiciona 5 minutos para o tempo de expiração
  const expiracao = new Date(proximaVela);
  expiracao.setMinutes(expiracao.getMinutes() + 5);

  const strEntrada = formatadorHora.format(proximaVela);
  const strExpiracao = formatadorHora.format(expiracao);

  // 3. Salva no Banco (O preço atual vai pro banco para estatísticas, mas não vai pro Telegram)
  const { data: insertData, error } = await supabase
    .from('historico_operacoes')
    .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
    .select('id').single();

  if (error || !insertData) return;

  // 4. Monta e envia a Mensagem Limpa
  const mensagem = `🎯 *SINAL (M5)* 🎯\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${strEntrada}\n⏳ *Expiração:* ${strExpiracao}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança: ${iaData.confianca_padrao}`;
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }]] }
    }),
  });
}

async function verificarLockdown(ativo: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('historico_operacoes').select('resultado').eq('ticker', ativo).order('criado_em', { ascending: false }).limit(1);
    if (!data || data.length === 0) return false;
    return data[0].resultado === 'LOSS';
  } catch (e) { return false; }
}

function calcularRSI(velas: any[], periodos = 14) {
  if (velas.length < periodos + 1) return 50;
  let ganhos = 0; let perdas = 0;
  for (let i = velas.length - periodos; i < velas.length; i++) {
    const dif = velas[i].fechamento - velas[i - 1].fechamento;
    if (dif >= 0) ganhos += dif; else perdas -= dif;
  }
  const medG = ganhos / periodos; const medP = perdas / periodos;
  if (medP === 0) return 100;
  return 100 - (100 / (1 + (medG / medP)));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    let nomeDoModelo = "gemini-1.5-flash"; 
    const checkModelos = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const jsonModelos = await checkModelos.json();
    
    if (!jsonModelos.error && jsonModelos.models) {
        const geradores = jsonModelos.models.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'));
        const modeloIdeal = geradores.find((m: any) => m.name.includes('flash')) || geradores.find((m: any) => m.name.includes('pro')) || geradores[0];
        if (modeloIdeal) nomeDoModelo = modeloIdeal.name.replace('models/', '');
    }

    const { data: ativosDB, error: erroDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (erroDB || !ativosDB || ativosDB.length === 0) return NextResponse.json({ sucesso: true, message: "Sem ativos ou erro no DB." });

    const ativos = ativosDB.map(a => a.ticker);

    for (const ativo of ativos) {
      try {
        if (await verificarLockdown(ativo)) continue;

        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
        if (!res.ok) continue;
        
        const json = await res.json();
        const resultadoYahoo = json.chart?.result?.[0];
        if (!resultadoYahoo) continue;

        const timestamps = resultadoYahoo.timestamp || [];
        const quote = resultadoYahoo.indicators?.quote?.[0];
        if (!quote || timestamps.length === 0) continue;

        const blocoVelas = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (quote.open[i] != null && quote.close[i] != null) {
            blocoVelas.push({ abertura: quote.open[i], maxima: quote.high[i], minima: quote.low[i], fechamento: quote.close[i] });
          }
        }

        const validas = blocoVelas.slice(-20);
        if (validas.length < 15) continue;

        const rsiAtual = calcularRSI(validas, 14);
        let preSinal = 'NEUTRO';
        if (rsiAtual >= 75) preSinal = 'VENDA'; else if (rsiAtual <= 25) preSinal = 'COMPRA';

        if (preSinal === 'NEUTRO') continue;

        const prompt = `Ativo ${ativo}. RSI ${rsiAtual.toFixed(2)}. Gatilho ${preSinal}.
        Últimas 20 velas M5: ${JSON.stringify(validas)}.
        Qual o tamanho de fractal recente valida esse sinal para a próx vela? Responda estrito JSON: {"sinal": "COMPRA"|"VENDA"|"NEUTRO", "confianca_padrao": "XX%", "motivo_fractal": "..."} - SÓ SINAL SE CONFIANÇA >= 85%.`;

        const result = await genAI.getGenerativeModel({ model: nomeDoModelo }).generateContent(prompt);
        const textResponse = result.response.text();
        const iaData = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
        
        if (iaData.sinal === preSinal && parseInt(iaData.confianca_padrao) >= 85) {
          await enviarSinalTelegram(ativo, iaData, validas[validas.length - 1].fechamento, rsiAtual);
        }
      } catch (e) { console.error(e); }
    }

    return NextResponse.json({ success: true, message: "Varredura Concluída" });

  } catch (error) {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}
