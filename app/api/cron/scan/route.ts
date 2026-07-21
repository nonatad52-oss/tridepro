import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error("Credenciais do Supabase não configuradas no ambiente.");
  }
  return createClient(url, key);
};

function mapearAnatomiaVelas(quote: any, quantidade: number) {
  const blocoVelas = [];
  for (let i = 0; i < quote.close.length; i++) {
    if (quote.close[i] != null && quote.open[i] != null && quote.high[i] != null && quote.low[i] != null) {
      const ab = quote.open[i];
      const fc = quote.close[i];
      const max = quote.high[i];
      const min = quote.low[i];
      
      const tamanhoCorpo = Math.abs(fc - ab);
      const pavioSuperior = max - Math.max(ab, fc);
      const pavioInferior = Math.min(ab, fc) - min;
      
      blocoVelas.push({ 
        abertura: ab, maxima: max, minima: min, fechamento: fc,
        corpo: tamanhoCorpo, pavio_sup: pavioSuperior, pavio_inf: pavioInferior, 
        direcao: fc >= ab ? "ALTA" : "BAIXA"
      });
    }
  }
  return blocoVelas.slice(-quantidade);
}

function calcularRSI(velas: any[]) {
  if (velas.length < 15) return 50;
  const amostra = velas.slice(-14);
  const ganhos = amostra.reduce((g: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento > arr[i-1].fechamento ? g + (v.fechamento - arr[i-1].fechamento) : g, 0) / 14;
  const perdas = amostra.reduce((p: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento < arr[i-1].fechamento ? p + (arr[i-1].fechamento - v.fechamento) : p, 0) / 14;
  if (perdas === 0) return 100;
  return 100 - (100 / (1 + (ganhos / perdas)));
}

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  try {
    const supabase = getSupabaseClient();
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

    let ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
    
    const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const agora = new Date();
    
    const proximaVela = new Date(agora);
    proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
    proximaVela.setSeconds(0);
    proximaVela.setMilliseconds(0);
    
    const expiracao = new Date(proximaVela);
    expiracao.setMinutes(expiracao.getMinutes() + 5);

    const { data: insertData, error: dbError } = await supabase
      .from('historico_operacoes')
      .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
      .select('id').single();

    if (dbError || !insertData) return;

    const mensagem = `🏆 *SINAL VIP FRACTAL (M5 + M15)* 🏆\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 *Confluência:* RSI ${rsi.toFixed(2)}\n🧠 *Confiança IA:* ${iaData.confianca_padrao}`;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, 
        text: mensagem, 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [
            [
              { text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, 
              { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }
            ],
            [
              { text: '🗑️ NÃO PEGUEI (Apagar)', callback_data: `DEL_${insertData.id}` }
            ]
          ] 
        } 
      }),
    });
  } catch (error: any) {
    console.error("❌ [ENVIO] Falha crítica no processamento do sinal:", error.message);
  }
}

export async function GET(request: Request) {
  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || ''; 
    
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) return NextResponse.json({ error: "Erro ao buscar ativos" }, { status: 500 });
    
    let ativos = ativosDB.map(a => a.ticker);
    ativos = ativos.filter(ativo => !ativo.toUpperCase().includes('OTC'));

    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaSemana = horaSP.getDay(); 
    const horaAtual = horaSP.getHours();

    ativos = ativos.filter(ativo => {
      const isCrypto = ativo.endsWith('-USD');
      if (isCrypto) return true;
      if (diaSemana === 6) return false; 
      if (diaSemana === 5 && horaAtual >= 18) return false; 
      if (diaSemana === 0 && horaAtual < 18) return false; 

      const HORA_ABERTURA = 4;
      const HORA_FECHAMENTO = 17;
      if (horaAtual < HORA_ABERTURA || horaAtual >= HORA_FECHAMENTO) return false;
      return true;
    });

    if (ativos.length === 0) {
       return NextResponse.json({ success: true, mensagem: `Mercados fechados no momento.` });
    }

    const torneioDeSinais: Array<{ativo: string, sinal: string, confianca: number, precoAtual: number, rsi: number}> = [];
    const agora = new Date();
    
    const inicioVelaAtual = new Date(agora);
    inicioVelaAtual.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5));
    inicioVelaAtual.setSeconds(0);
    inicioVelaAtual.setMilliseconds(0);

    const bloqueioTempo = new Date(agora);
    bloqueioTempo.setMinutes(agora.getMinutes() - 60);
    const cooldownISO = bloqueioTempo.toISOString();

    for (const ativo of ativos) {
      try {
        const [res5m, res15m] = await Promise.all([
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
        ]);

        if (!res5m.ok || !res15m.ok) continue;

        const json5m = await res5m.json();
        const json15m = await res15m.json();

        const quote5m = json5m.chart?.result?.[0]?.indicators?.quote?.[0];
        const quote15m = json15m.chart?.result?.[0]?.indicators?.quote?.[0];
        
        if (!quote5m?.close || !quote15m?.close) continue;

        const velas5m = mapearAnatomiaVelas(quote5m, 20);
        const velas15m = mapearAnatomiaVelas(quote15m, 10);

        if (velas5m.length < 15 || velas15m.length < 5) continue;

        const rsi5m = calcularRSI(velas5m);

        if (rsi5m >= 60 || rsi5m <= 40) {
          
          const { data: ultimoSinalData } = await supabase
            .from('historico_operacoes')
            .select('resultado, created_at')
            .eq('ticker', ativo)
            .gte('created_at', cooldownISO)
            .order('created_at', { ascending: false })
            .limit(1);

          if (ultimoSinalData && ultimoSinalData.length > 0) {
            const ultimoSinal = ultimoSinalData[0];
            const tempoDoUltimoSinal = new Date(ultimoSinal.created_at).getTime();

            if (tempoDoUltimoSinal >= inicioVelaAtual.getTime()) continue; 
            if (ultimoSinal.resultado === 'LOSS') continue; 
          }

          const { data: historico } = await supabase
            .from('historico_operacoes')
            .select('sinal, resultado')
            .eq('ticker', ativo)
            .in('resultado', ['WIN', 'LOSS'])
            .order('id', { ascending: false })
            .limit(5);

          let diarioDeAprendizado = "Sem histórico recente.";
          if (historico && historico.length > 0) {
            diarioDeAprendizado = historico.map((h, i) => `[Anterior ${i+1}]: ${h.sinal} -> ${h.resultado}`).join('\n');
          }
          
          const contextoMercado = ativo.endsWith('-USD') 
            ? `Cripto: Volatilidade alta. Foque em rejeições simultâneas nos dois tempos gráficos.` 
            : `Mercado Tradicional: Foque em exaustão e retorno à média.`;

          const prompt = `Você é um robô de Inteligência Artificial de Elite, especialista em Análise Multi-Timeframe e Price Action Fractal para Opções Binárias no ativo ${ativo}.
          Sua missão é cruzar os dados da TENDÊNCIA MACRO (M15) com o GATILHO MICRO (M5).
          ${contextoMercado}
          RSI Atual (M5): ${rsi5m.toFixed(2)}
          📊 TENDÊNCIA MACRO (Últimas 10 velas de M15): ${JSON.stringify(velas15m)}
          🔎 GATILHO MICRO (Últimas 20 velas de M5): ${JSON.stringify(velas5m)}
          Diário de Erros e Acertos Recentes: ${diarioDeAprendizado}
          REGRAS: 1. MICRO-PADRÕES ALINHADOS. 2. Não dependa só de RSI. 3. Cuidado com armadilhas de velas de força. 4. Confiança acima de 70% se alinhado.
          Sua resposta deve ser EXCLUSIVAMENTE um JSON válido: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

          const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile', 
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }, 
              temperature: 0.15 
            })
          });

          if (!responseGroq.ok) continue;

          const ia = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
          const confiancaNumerica = parseInt(ia.confianca_padrao);

          if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && confiancaNumerica >= 70) {
            torneioDeSinais.push({ ativo, sinal: ia.sinal, confianca: confiancaNumerica, precoAtual: velas5m[velas5m.length-1].fechamento, rsi: rsi5m });
          }
        }
      } catch (e: any) { continue; }
    }

    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const oMelhor = torneioDeSinais[0];
      await enviarSinalTelegram(oMelhor.ativo, { sinal: oMelhor.sinal, confianca_padrao: `${oMelhor.confianca}%` }, oMelhor.precoAtual, oMelhor.rsi);
    }

    return NextResponse.json({ success: true, mensagem: `Análise finalizada.` });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
