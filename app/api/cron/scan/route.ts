import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAÇÕES DO SERVERLESS (VERCEL) ---
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase não configuradas.");
  
  return createClient(url, key, {
    auth: { persistSession: false }
  });
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// ============================================================================
// BLINDAGEM DE HORÁRIOS DOS MERCADOS 
// ============================================================================
function isMercadoAberto(ticker: string, dataHora: Date) {
  const dia = dataHora.getDay(); 
  const hora = dataHora.getHours();
  const minuto = dataHora.getMinutes();
  const tempoDecimal = hora + (minuto / 60);
  
  const isFimDeSemana = (dia === 0 || dia === 6);
  const tickerUpper = ticker.toUpperCase();

  const moedasFiat = ['EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF', 'JPY', 'USD'];
  const comecaComFiat = moedasFiat.some(moeda => tickerUpper.startsWith(moeda));
  const isForex = tickerUpper.endsWith('=X') || (tickerUpper.endsWith('USD') && comecaComFiat);

  if (isForex) {
    if (dia === 5 && tempoDecimal >= 18) return false; 
    if (dia === 6) return false; 
    if (dia === 0 && tempoDecimal < 18) return false; 
    if (tempoDecimal >= 18 && tempoDecimal < 19) return false;
    return true;
  }

  if (tickerUpper.endsWith('-USD')) return true; 

  if (tickerUpper.endsWith('.SA')) {
    if (isFimDeSemana) return false;
    if (tempoDecimal < 10 || tempoDecimal >= 17.5) return false;
    return true;
  }

  if (isFimDeSemana) return false;
  return true; 
}

function mapearAnatomiaVelas(quote: any, quantidade: number) {
  const blocoVelas = [];
  for (let i = 0; i < quote.close.length; i++) {
    if (quote.close[i] != null && quote.open[i] != null && quote.high[i] != null && quote.low[i] != null) {
      const ab = quote.open[i]; const fc = quote.close[i];
      const max = quote.high[i]; const min = quote.low[i];
      blocoVelas.push({ 
        abertura: ab, maxima: max, minima: min, fechamento: fc,
        corpo: Math.abs(fc - ab), pavio_sup: max - Math.max(ab, fc), pavio_inf: Math.min(ab, fc) - min, 
        direcao: fc >= ab ? "ALTA" : "BAIXA"
      });
    }
  }
  return blocoVelas.slice(-quantidade);
}

function calcularRSI(velas: any[]) {
  if (velas.length < 15) return 50;
  const amostra = velas.slice(-14);
  let ganhos = 0, perdas = 0;
  for (let i = 1; i < amostra.length; i++) {
    const dif = amostra[i].fechamento - amostra[i-1].fechamento;
    if (dif > 0) ganhos += dif; else perdas += Math.abs(dif);
  }
  ganhos /= 14; perdas /= 14;
  if (perdas === 0) return 100;
  return 100 - (100 / (1 + (ganhos / perdas)));
}

function calcularEMA(velas: any[], periodo: number) {
  if (velas.length < periodo) return null;
  const k = 2 / (periodo + 1);
  let ema = velas[0].fechamento;
  for (let i = 1; i < velas.length; i++) ema = (velas[i].fechamento * k) + (ema * (1 - k));
  return ema;
}

function identificarPadraoCandle(velas: any[]) {
  if (velas.length < 2) return "NENHUM";
  const atual = velas[velas.length - 1]; const anterior = velas[velas.length - 2];
  const corpoAtual = atual.corpo; const tamanhoTotalAtual = atual.maxima - atual.minima;
  
  if (corpoAtual < (tamanhoTotalAtual * 0.20)) return "DOJI_EXAUSTAO";
  if (anterior.direcao === "BAIXA" && atual.direcao === "ALTA" && atual.fechamento > anterior.abertura) return "ENGOLFO_DE_ALTA";
  if (anterior.direcao === "ALTA" && atual.direcao === "BAIXA" && atual.fechamento < anterior.abertura) return "ENGOLFO_DE_BAIXA";
  if (atual.pavio_inf > corpoAtual * 1.5 && atual.pavio_sup <= corpoAtual * 0.8) return "MARTELO_REJEICAO_BAIXA";
  if (atual.pavio_sup > corpoAtual * 1.5 && atual.pavio_inf <= corpoAtual * 0.8) return "ESTRELA_CADENTE_REJEICAO_ALTA";
  return "VELA_DE_FORCA_NORMAL";
}

// ============================================================================
// MÓDULO: AUDITORIA AUTOMÁTICA DE RESULTADOS (WIN / LOSS)
// ============================================================================
async function verificarResultadosPendentes(supabase: any) {
  const tempoLimite = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  
  const { data: pendentes } = await supabase
    .from('historico_operacoes')
    .select('*')
    .eq('resultado', 'PENDENTE')
    .lt('created_at', tempoLimite);

  if (!pendentes || pendentes.length === 0) return;

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

  for (const op of pendentes) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${op.ticker}?interval=1m&range=1d`, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      
      const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
      if (!quote || !quote.close) continue;

      const precoFechamento = quote.close[quote.close.length - 1];
      
      let resultadoFinal = 'LOSS';
      if (op.sinal === 'COMPRA' && precoFechamento > op.taxa_entrada) resultadoFinal = 'WIN';
      if (op.sinal === 'VENDA' && precoFechamento < op.taxa_entrada) resultadoFinal = 'WIN';
      if (precoFechamento === op.taxa_entrada) resultadoFinal = 'EMPATE';

      await supabase.from('historico_operacoes').update({ resultado: resultadoFinal }).eq('id', op.id);
      
      const icone = resultadoFinal === 'WIN' ? '✅ WIN TÁ NO BOLSO!' : (resultadoFinal === 'LOSS' ? '❌ LOSS' : '⚪ EMPATE');
      const ativoFormatado = op.ticker.endsWith('=X') ? op.ticker.substring(0, 3) + '/' + op.ticker.substring(3, 6) : op.ticker.replace('-', '/');
      
      const msg = `🧾 *RESULTADO DA OPERAÇÃO* 🧾\n*Ativo:* ${ativoFormatado}\n*Direção:* ${op.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n\n*Veredito:* ${icone}\n\n💸 *Taxa de Entrada:* ${op.taxa_entrada.toFixed(4)}\n🛑 *Fechamento:* ${precoFechamento.toFixed(4)}`;

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
      });

      await delay(500); 
    } catch (e: any) { }
  }
}

// ============================================================================
// FUNÇÃO DE ENVIO DE SINAL 
// ============================================================================
async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number, padrao: string, stats: any) {
  try {
    const supabase = getSupabaseClient();
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
    const ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
    const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const agora = new Date();
    
    const proximaVela = new Date(agora);
    proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
    proximaVela.setSeconds(0); proximaVela.setMilliseconds(0);
    const expiracao = new Date(proximaVela); expiracao.setMinutes(expiracao.getMinutes() + 5);

    await supabase.from('historico_operacoes').insert([{ 
      ticker: ativo, 
      sinal: iaData.sinal, 
      taxa_entrada: precoAtual, 
      resultado: 'PENDENTE',
      created_at: new Date().toISOString()
    }]);

    let iconeDesempenho = "📊";
    if (stats.taxaAcerto >= 65) iconeDesempenho = "🏆";
    else if (stats.taxaAcerto <= 45 && stats.totalOps > 0) iconeDesempenho = "⚠️";

    const mensagem = `🤖 *SINAL IA - INTELIGÊNCIA AGRESSIVA* 🤖\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n💲 *Preço Atual:* ${precoAtual.toFixed(4)}\n\n${iconeDesempenho} *Histórico do Ativo:*\n*Acertos:* ${stats.taxaAcerto}% (${stats.wins}W / ${stats.losses}L)\n\n🌐 *PLACAR DO DIA (BOT):*\n*Status:* ${stats.statusBot}\n*Acertos Hoje:* ${stats.taxaAcertoDiaria}% 🎯\n*Total:* ${stats.globalWins} WINS ✅ / ${stats.globalLosses} LOSSES ❌\n\n📊 *Gatilho Identificado:* ${padrao.replace(/_/g, ' ')}\n🔥 *RSI (Força):* ${rsi.toFixed(2)}\n🧠 *Mapeamento IA:* ${iaData.motivo}\n🎯 *Confiança:* ${iaData.confianca_padrao}\n\n_O robô verificará o resultado desta operação automaticamente em 6 minutos._ ⏳`;
    
    const payload: any = { chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown' };
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error: any) { }
}

// ============================================================================
// NÚCLEO DO ROBÔ (MEMÓRIA DE ERROS E EXCLUSÃO DE ATIVOS)
// ============================================================================
export async function GET(request: Request) {
  const inicioExecucao = Date.now();
  console.log("==========================================");
  console.log("🤖 INICIANDO CICLO COM MEMÓRIA DE LOSS...");

  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || ''; 
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    await verificarResultadosPendentes(supabase);

    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) return NextResponse.json({ error: "Erro DB" }, { status: 500 });
    
    let ativosBrutos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC'));
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    
    let ativosAtivos = ativosBrutos.filter(ativo => isMercadoAberto(ativo, horaSP));

    const { data: todasOperacoes } = await supabase
      .from('historico_operacoes')
      .select('ticker, resultado, sinal, created_at')
      .in('ticker', ativosAtivos)
      .order('created_at', { ascending: false });

    const historicoPorAtivo = new Map<string, any[]>();
    if (todasOperacoes) {
      for (const op of todasOperacoes) {
        if (!historicoPorAtivo.has(op.ticker)) historicoPorAtivo.set(op.ticker, []);
        historicoPorAtivo.get(op.ticker)!.push(op);
      }
    }

    const torneioDeSinais: any[] = [];
    const agoraUtcMs = new Date().getTime(); 

    const hojeBR = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const opsDeHoje = (todasOperacoes || []).filter(op => {
      if (op.resultado !== 'WIN' && op.resultado !== 'LOSS') return false;
      const dataOp = new Date(op.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      return dataOp === hojeBR;
    });

    const globalWins = opsDeHoje.filter(op => op.resultado === 'WIN').length;
    const globalLosses = opsDeHoje.filter(op => op.resultado === 'LOSS').length;
    const saldoDiario = globalWins - globalLosses;
    const totalOpsDiaria = globalWins + globalLosses;
    const taxaAcertoDiaria = totalOpsDiaria > 0 ? Math.round((globalWins / totalOpsDiaria) * 100) : 0;
    const statusBot = saldoDiario > 0 ? "🟢 POSITIVO" : (saldoDiario < 0 ? "🔴 NEGATIVO" : "⚪ ZERO");

    const TAMANHO_LOTE = 6;
    
    for (let i = 0; i < ativosAtivos.length; i += TAMANHO_LOTE) {
      if (Date.now() - inicioExecucao > 48000) break;

      const loteAtual = ativosAtivos.slice(i, i + TAMANHO_LOTE);

      await Promise.all(loteAtual.map(async (ativo) => {
        try {
          const historicoAtivo = historicoPorAtivo.get(ativo) || [];
          const resolvidos = historicoAtivo.filter(op => op.resultado === 'WIN' || op.resultado === 'LOSS');
          
          const wins = resolvidos.filter(op => op.resultado === 'WIN').length;
          const losses = resolvidos.filter(op => op.resultado === 'LOSS').length;
          const totalResolvido = wins + losses;
          const taxaAcertoAtual = totalResolvido > 0 ? Math.round((wins / totalResolvido) * 100) : 0;

          const ultimasOps = historicoAtivo.slice(0, 5);
          let bloqueado = false;
          let ultimaOpFoiLoss = false;
          let direcaoProibida = "NENHUMA";

          // 🧠 LÓGICA DE APRENDIZAGEM E PUNIÇÃO DE LOSS
          if (ultimasOps.length > 0) {
            // 1. Blacklist de Duplo Loss (Se errar 2x seguidas, expulsa o ativo)
            if (ultimasOps.length >= 2 && ultimasOps[0].resultado === 'LOSS' && ultimasOps[1].resultado === 'LOSS') {
              console.log(`💀 [BLACKLIST] ${ativo} deu 2 losses seguidos. Ignorando hoje.`);
              return; 
            }

            if (ultimasOps[0].resultado === 'LOSS') {
              ultimaOpFoiLoss = true;
              direcaoProibida = ultimasOps[0].sinal;
            }

            for (const op of ultimasOps) {
              let dataStr = op.created_at;
              if (!dataStr.includes('Z') && !dataStr.includes('+')) dataStr += 'Z';
              const tempoOpDB = new Date(dataStr).getTime();
              const minDecorridos = (agoraUtcMs - tempoOpDB) / (1000 * 60);

              if (minDecorridos >= 0) { 
                if (op === ultimasOps[0] && minDecorridos < 15) bloqueado = true; // 15 min genérico
                if (op.resultado === 'LOSS' && minDecorridos < 60) bloqueado = true; // 60 MINUTOS de geladeira pós-loss!
              }
            }
          }

          if (bloqueado) return;

          const [res5m, res15m] = await Promise.all([
            fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
            fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
          ]);

          if (!res5m.ok || !res15m.ok) return;
          const json5m = await res5m.json(); const json15m = await res15m.json();
          
          const quote5m = json5m.chart?.result?.[0]?.indicators?.quote?.[0];
          const quote15m = json15m.chart?.result?.[0]?.indicators?.quote?.[0];
          if (!quote5m?.close || !quote15m?.close) return;

          const velas5m = mapearAnatomiaVelas(quote5m, 20);
          const velas15m = mapearAnatomiaVelas(quote15m, 20);
          if (velas5m.length < 15 || velas15m.length < 20) return;

          const rsi5m = calcularRSI(velas5m);

          if (rsi5m > 35 && rsi5m < 65) return;

          const ema20_M15 = calcularEMA(velas15m, 20);
          const padraoMicro = identificarPadraoCandle(velas5m);
          const precoAtual = velas5m[velas5m.length - 1].fechamento;

          let tendenciaMacro = "LATERAL";
          if (ema20_M15) {
            if (velas15m[velas15m.length - 1].fechamento > ema20_M15) tendenciaMacro = "ALTA";
            else if (velas15m[velas15m.length - 1].fechamento < ema20_M15) tendenciaMacro = "BAIXA";
          }

          // 🧠 INJEÇÃO DE CONTEXTO NA IA (O ROBÔ SABE O QUE FEZ)
          let avisoMemoriaIA = "";
          if (ultimaOpFoiLoss) {
            avisoMemoriaIA = `⚠️ ATENÇÃO: Nossa última operação neste ativo foi LOSS em ${direcaoProibida}. O mercado pode estar em forte tendência direcional. SÓ AUTORIZE uma nova ${direcaoProibida} se o mercado formou um novo cenário com RSI extremo (< 25 ou > 75).`;
          }

          const prompt = `Você é um Analista Quant EXTREMAMENTE RIGOROSO operando ${ativo}.
🧠 DADOS: Placar: ${taxaAcertoAtual}% | T. Macro: ${tendenciaMacro} | RSI: ${rsi5m.toFixed(2)} | Padrão: ${padraoMicro}
${avisoMemoriaIA}

REGRAS OBRIGATÓRIAS DE REJEIÇÃO:
1. Só autorize COMPRA se o RSI estiver próximo a 30 (Sobrevenda) E a tendência for de ALTA.
2. Só autorize VENDA se o RSI estiver próximo a 70 (Sobrecompra) E a tendência for de BAIXA.
3. Se a direção do sinal for a mesma da proibida, SEJA IMPLACÁVEL NA EXIGÊNCIA DO SINAL.
4. Na menor divergência entre os dados ou falta de clareza, retorne NEUTRO.
Retorne JSON EXATO: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Até 15 palavras."}`;

          let iaResposta = null;
          let tentativas = 0;
          
          while (tentativas < 2 && !iaResposta) {
            try {
              const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'llama-3.1-8b-instant',
                  messages: [{ role: 'user', content: prompt }],
                  response_format: { type: 'json_object' }, 
                  temperature: 0.1
                })
              });
              if (!responseGroq.ok) throw new Error(`Status ${responseGroq.status}`);
              iaResposta = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
            } catch (err: any) {
              tentativas++;
              if (tentativas < 2) await delay(1000); 
            }
          }

          if (!iaResposta) return; 
          const confiancaNumerica = parseInt(iaResposta.confianca_padrao);

          if ((iaResposta.sinal === 'COMPRA' || iaResposta.sinal === 'VENDA') && confiancaNumerica >= 70) {
            torneioDeSinais.push({ 
              ativo, ia: iaResposta, precoAtual, rsi: rsi5m, padrao: padraoMicro, confianca: confiancaNumerica, 
              stats: { totalOps: totalResolvido, taxaAcerto: taxaAcertoAtual, wins, losses, globalWins, globalLosses, statusBot, taxaAcertoDiaria } 
            });
          }
        } catch (e: any) { return; }
      }));
    }

    const tempoGasto = ((Date.now() - inicioExecucao) / 1000).toFixed(2);
    console.log(`⏱️ Tempo total de varredura: ${tempoGasto}s`);
    
    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0];
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.rsi, alvo.padrao, alvo.stats);
    } else {
      console.log(`🛑 Nenhum sinal atendeu aos critérios de rigor da IA.`);
    }

    return NextResponse.json({ success: true, mensagem: `Concluído.` });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
