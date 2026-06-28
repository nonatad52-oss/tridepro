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
  const { data: insertData, error } = await supabase
    .from('historico_operacoes')
    .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
    .select('id').single();

  if (error || !insertData) return;

  const mensagem = `🎯 *SINAL (M5)* 🎯\n*Ativo:* ${ativo}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n*Preço:* ${precoAtual}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança: ${iaData.confianca_padrao}`;
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

    // 📡 RADAR DE MODELOS AUTOMÁTICO (Fim dos erros 404)
    let nomeDoModelo = "gemini-1.5-flash"; 
    const checkModelos = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
    const jsonModelos = await checkModelos.json();
    
    if (jsonModelos.error) {
       return NextResponse.json({ 
         sucesso: false, 
         motivo: "O Google recusou a sua chave da API!", 
         detalhes: jsonModelos.error 
       });
    }

    if (jsonModelos.models) {
        const geradores = jsonModelos.models.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'));
        const modeloIdeal = geradores.find((m: any) => m.name.includes('flash')) || geradores.find((m: any) => m.name.includes('pro')) || geradores[0];
        if (modeloIdeal) {
            nomeDoModelo = modeloIdeal.name.replace('models/', '');
        }
    }

    // Validação do Supabase
    const { data: ativosDB, error: erroDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (erroDB) {
      return NextResponse.json({ sucesso: false, motivo: "O Supabase bloqueou a conexão!", detalhes_do_erro: erroDB });
    }
    if (!ativosDB || ativosDB.length === 0) {
      return NextResponse.json({ sucesso: true, message: "Conectou no banco perfeito, mas a tabela ativos_global está vazia." });
    }

    const ativos = ativosDB.map(a => a.ticker);
    let varreduras = 0;

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

        varreduras++;
        const prompt = `Ativo ${ativo}. RSI ${rsiAtual.toFixed(2)}. Gatilho ${preSinal}.
        Últimas 20 velas M5: ${JSON.stringify(validas)}.
        Qual o tamanho de fractal recente valida esse sinal para a próx vela? Responda estrito JSON: {"sinal": "COMPRA"|"VENDA"|"NEUTRO", "confianca_padrao": "XX%", "motivo_fractal": "..."} - SÓ SINAL SE CONFIANÇA >= 85%.`;

        // Chama a IA usando o modelo perfeito que o Radar encontrou
        const result = await genAI.getGenerativeModel({ model: nomeDoModelo }).generateContent(prompt);
        const textResponse = result.response.text();
        const iaData = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
        
        if (iaData.sinal === preSinal && parseInt(iaData.confianca_padrao) >= 85) {
          await enviarSinalTelegram(ativo, iaData, validas[validas.length - 1].fechamento, rsiAtual);
        }
      } catch (e) { 
        console.error(`Erro ao analisar ${ativo}:`, e); 
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: "Varredura Concluída com Sucesso", 
      moedas_analisadas: ativos.length,
      modelo_ia_utilizado: nomeDoModelo
    });

  } catch (error) {
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}
