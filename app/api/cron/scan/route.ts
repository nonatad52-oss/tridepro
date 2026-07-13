import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'chave-temporaria';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';
const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || 'chave-temporaria'; 
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  let ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
  
  const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const agora = new Date();
  
  const proximaVela = new Date(agora);
  proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
  proximaVela.setSeconds(0);
  proximaVela.setMilliseconds(0);
  
  const expiracao = new Date(proximaVela);
  expiracao.setMinutes(expiracao.getMinutes() + 5);

  const { data: insertData } = await supabase
    .from('historico_operacoes')
    .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
    .select('id').single();

  if (!insertData) return;

  // Formato limpo, sem explicações extras
  const mensagem = `🏆 *SINAL VIP (M5)* 🏆\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança: ${iaData.confianca_padrao}`;
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }]] } }),
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
  if (!ativosDB) return NextResponse.json({ error: "Erro DB" });

  let ativos = ativosDB.map(a => a.ticker);
  
  // Filtro de mercado (só Cripto no final de semana)
  const diaDaSemana = new Date().getDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) {
    ativos = ativos.filter(ativo => ativo.endsWith('-USD'));
  }

  const torneioDeSinais: Array<{ativo: string, sinal: string, confianca: number, precoAtual: number, rsi: number}> = [];

  for (const ativo of ativos) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
      const json = await res.json();
      const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
      if (!quote || !quote.close) continue;

      const closes = quote.close;
      const rsi = 100 - (100 / (1 + (closes.slice(-14).reduce((g: number, c: number, i: number, arr: number[]) => i > 0 && c > arr[i-1] ? g + (c - arr[i-1]) : g, 0) / 14 / (closes.slice(-14).reduce((p: number, c: number, i: number, arr: number[]) => i > 0 && c < arr[i-1] ? p + (arr[i-1] - c) : p, 0) / 14 || 1))));

      if (rsi < 30 || rsi > 70) {
        // Preparando dados para a IA caçar padrões
        const velasAnat = quote.open.slice(-20).map((o:number, i:number) => ({
          ab: o,
          fc: quote.close[i + (quote.close.length - 20)],
          max: quote.high[i + (quote.high.length - 20)],
          min: quote.low[i + (quote.low.length - 20)]
        }));

        const prompt = `Analise este ativo ${ativo}. RSI: ${rsi.toFixed(2)}. Candles recentes: ${JSON.stringify(velasAnat)}.
        Se houver padrão claro de exaustão ou reversão (Price Action), dê o sinal.
        Responda ESTRITAMENTE em JSON válido: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0.1 })
        });

        const ia = JSON.parse((await resp.json()).choices[0].message.content);
        const conf = parseInt(ia.confianca_padrao);

        if (conf >= 70 && ia.sinal !== 'NEUTRO') {
          torneioDeSinais.push({ ativo, sinal: ia.sinal, confianca: conf, precoAtual: closes[closes.length-1], rsi });
        }
      }
    } catch (e) { continue; }
  }

  if (torneioDeSinais.length > 0) {
    torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
    await enviarSinalTelegram(torneioDeSinais[0].ativo, torneioDeSinais[0], torneioDeSinais[0].precoAtual, torneioDeSinais[0].rsi);
  }

  return NextResponse.json({ success: true });
}
