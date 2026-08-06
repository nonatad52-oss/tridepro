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

// ============================================================================
// MATEMÁTICA AVANÇADA (A MESCLAGEM DE TUDO QUE FUNCIONA)
// ============================================================================
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

function calcularBollingerBands(velas: any[], periodo: number = 20) {
  if (velas.length < periodo) return null;
  const amostra = velas.slice(-periodo);
  const soma = amostra.reduce((acc, v) => acc + v.fechamento, 0);
  const media = soma / periodo;
  
  const somaDiferencas = amostra.reduce((acc, v) => acc + Math.pow(v.fechamento - media, 2), 0);
  const desvioPadrao = Math.sqrt(somaDiferencas / periodo);
  
  return {
    superior: media + (desvioPadrao * 2),
    inferior: media - (desvioPadrao * 2),
    media: media
  };
}

function calcularMACD(velas: any[]) {
  if (velas.length < 26) return { macd: 0, signal: 0, hist: 0 };
  const ema12 = calcularEMA(velas.slice(-12), 12) || 0;
  const ema26 = calcularEMA(velas.slice(-26), 26) || 0;
  const macdLine = ema12 - ema26;
  // Simplificação matemática do signal (necessita array histórico, aproximando para contexto)
  return { macd: macdLine, cruzamento: macdLine > 0 ? "ALTA" : "BAIXA" }; 
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
  return "VELA_COMUM";
}

// ============================================================================
// MÓDULO: AUDITORIA AUTOMÁTICA DE RESULTADOS 
// ============================================================================
async function verificarResultadosPendentes(supabase: any) {
  const { data: pendentes } = await supabase.from('historico_operacoes').select('*').eq('resultado', 'PENDENTE');
  if (!pendentes || pendentes.length === 0) return;

  const agora = Date.now();
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

  for (const op of pendentes) {
    try {
      const dataSinal = new Date(op.created_at);
      const minutosSinal = dataSinal.getMinutes();
      const minutosRestantes = 5 - (minutosSinal % 5);
      
      const dataEntrada = new Date(dataSinal);
      dataEntrada.setMinutes(minutosSinal + minutosRestantes);
      dataEntrada.setSeconds(0); dataEntrada.setMilliseconds(0);

      const tempoExpiracao = dataEntrada.getTime() + (5 * 60 * 1000); 

      if (agora < tempoExpiracao + 60000) continue; 

      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${op.ticker}?interval=5m&range=1d`, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = await res.json();
      
      const timestampArray = json.chart?.result?.[0]?.timestamp;
      const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
      
      if (!timestampArray || !quote || !quote.close || !quote.open) continue;

      const targetTimestamp = Math.floor(dataEntrada.getTime() / 1000);
      let targetIndex = -1;

      for (let i = timestampArray.length - 1; i >= 0; i--) {
        if (Math.abs(timestampArray[i] - targetTimestamp) <= 120) { targetIndex = i; break; }
      }

      if (targetIndex === -1) {
        if (agora > tempoExpiracao + (120 * 60 * 1000)) await supabase.from('historico_operacoes').update({ resultado: 'CANCELADO' }).eq('id', op.id);
        continue;
      }

      const precoAbertura = quote.open[targetIndex]; const precoFechamento = quote.close[targetIndex];
      if (precoAbertura == null || precoFechamento == null) continue;

      let resultadoFinal = 'LOSS';
      if (op.sinal === 'COMPRA' && precoFechamento > precoAbertura) resultadoFinal = 'WIN';
      if (op.sinal === 'VENDA' && precoFechamento < precoAbertura) resultadoFinal = 'WIN';
      if (precoFechamento === precoAbertura) resultadoFinal = 'EMPATE';

      await supabase.from('historico_operacoes').update({ resultado: resultadoFinal }).eq('id', op.id);
      
      let casasDecimais = precoAbertura < 10 ? 5 : 3; 
      const icone = resultadoFinal === 'WIN' ? '✅ WIN TÁ NO BOLSO!' : (resultadoFinal === 'LOSS' ? '❌ LOSS' : '⚪ EMPATE');
      const ativoFormatado = op.ticker.endsWith('=X') ? op.ticker.substring(0, 3) + '/' + op.ticker.substring(3, 6) : op.ticker.replace('-', '/');
      
      const msg = `🧾 *RESULTADO* 🧾\n*Ativo:* ${ativoFormatado}\n*Direção:* ${op.sinal === 'COMPRA' ? '🟢' : '🔴'} ${op.sinal}\n\n*Veredito:* ${icone}\n💸 Abertura: ${precoAbertura.toFixed(casasDecimais)}\n🛑 Fechamento: ${precoFechamento.toFixed(casasDecimais)}`;

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
      });
      await delay(500); 
    } catch (e: any) { }
  }
}

// ============================================================================
// ENVIO DE SINAL NOVO MODELO
// ============================================================================
async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, analise: any, stats: any) {
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
      ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE', created_at: new Date().toISOString()
    }]);

    const mensagem = `🤖 *SINAL IA - MODO CONFLUÊNCIA* 🤖
*Ativo:* ${ativoFormatado}
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}
⏰ *Entrada:* ${formatadorHora.format(proximaVela)}
⏳ *Expiração:* ${formatadorHora.format(expiracao)}

📊 *CONFLUÊNCIAS DETECTADAS:*
• RSI (Força): ${analise.rsi.toFixed(2)}
• Bollinger: ${analise.posicaoBollinger}
• MACD: ${analise.macdDirection}
• Padrão Vela: ${analise.padrao.replace(/_/g, ' ')}

🧠 *IA:* ${iaData.motivo} (Confiança: ${iaData.confianca_padrao})

🌐 *PLACAR DO DIA:* ${stats.statusBot} | Acertos Hoje: ${stats.taxaAcertoDiaria}% 🎯`;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown' }),
    });
  } catch (error: any) { }
}

// ============================================================================
// NÚCLEO DO ROBÔ: PROCESSAMENTO CONTROLADO
// ============================================================================
export async function GET(request: Request) {
  const inicioExecucao = Date.now();
  console.log("==========================================");
  console.log("🤖 INICIANDO MODO QUANT-HÍBRIDO (ANTI-TRAVAMENTO)...");

  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || ''; 
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const supabase = getSupabaseClient();
    await verificarResultadosPendentes(supabase);

    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) return NextResponse.json({ error: "Erro DB" }, { status: 500 });
    
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    let ativosAtivos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC') && isMercadoAberto(a, horaSP));
    
    // 🔥 A MÁGICA PARA NÃO TRAVAR A VERCEL NEM A IA 🔥
    // Mistura os ativos e pega no máximo 12 para analisar por minuto
    ativosAtivos = ativosAtivos.sort(() => 0.5 - Math.random()).slice(0, 12);
    
    console.log(`📡 Analisando lote otimizado de ${ativosAtivos.length} ativos...`);

    const { data: opsDeHojeDB } = await supabase
      .from('historico_operacoes')
      .select('resultado')
      .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());
      
    const opsDeHoje = opsDeHojeDB || [];
    const globalWins = opsDeHoje.filter(op => op.resultado === 'WIN').length;
    const globalLosses = opsDeHoje.filter(op => op.resultado === 'LOSS').length;
    const totalOpsDiaria = globalWins + globalLosses;
    const taxaAcertoDiaria = totalOpsDiaria > 0 ? Math.round((globalWins / totalOpsDiaria) * 100) : 0;
    const statusBot = globalWins > globalLosses ? "🟢 POSITIVO" : (globalWins < globalLosses ? "🔴 NEGATIVO" : "⚪ ZERO");

    const torneioDeSinais: any[] = [];
    
    // Analisa de 4 em 4 para não dar pico de memória
    for (let i = 0; i < ativosAtivos.length; i += 4) {
      if (Date.now() - inicioExecucao > 45000) break; // Trava de segurança da Vercel
      
      const loteAtual = ativosAtivos.slice(i, i + 4);

      await Promise.all(loteAtual.map(async (ativo) => {
        try {
          const [res5m, res15m] = await Promise.all([
            fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
            fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
          ]);

          if (!res5m.ok || !res15m.ok) return;
          const json5m = await res5m.json(); const json15m = await res15m.json();
          const quote5m = json5m.chart?.result?.[0]?.indicators?.quote?.[0];
          const quote15m = json15m.chart?.result?.[0]?.indicators?.quote?.[0];
          
          if (!quote5m?.close || !quote15m?.close) return;
          const velas5m = mapearAnatomiaVelas(quote5m, 30);
          const velas15m = mapearAnatomiaVelas(quote15m, 20);
          if (velas5m.length < 26) return;

          const precoAtual = velas5m[velas5m.length - 1].fechamento;
          const rsi = calcularRSI(velas5m);
          const bb = calcularBollingerBands(velas5m) || { superior: 999999, inferior: 0 };
          const macd = calcularMACD(velas5m);
          const padrao = identificarPadraoCandle(velas5m);

          // Filtro primário agressivo: Ignora imediatamente se não estiver nos extremos (Economiza requisições pra IA)
          if (rsi > 40 && rsi < 60) {
            console.log(`[IGNORE] ${ativo} - Mercado sem definição clara (RSI ${rsi.toFixed(2)})`);
            return;
          }

          let posicaoBollinger = "DENTRO DAS BANDAS";
          if (precoAtual >= bb.superior) posicaoBollinger = "ROMPENDO BANDA SUPERIOR (ALTA EXTREMA)";
          if (precoAtual <= bb.inferior) posicaoBollinger = "ROMPENDO BANDA INFERIOR (BAIXA EXTREMA)";

          let tendenciaMacro = "LATERAL";
          const ema20_M15 = calcularEMA(velas15m, 20);
          if (ema20_M15) {
            if (velas15m[velas15m.length - 1].fechamento > ema20_M15) tendenciaMacro = "ALTA";
            else if (velas15m[velas15m.length - 1].fechamento < ema20_M15) tendenciaMacro = "BAIXA";
          }

          console.log(`[ANÁLISE HÍBRIDA] ${ativo} | RSI: ${rsi.toFixed(1)} | BB: ${posicaoBollinger} | MACD: ${macd.cruzamento} | Padrão: ${padrao}`);

          const prompt = `Você é um Algoritmo de Alta Frequência analisando Confluências Técnicas.
Ativo: ${ativo}
Preço: ${precoAtual}
Tendência Macro (M15): ${tendenciaMacro}
RSI M5: ${rsi.toFixed(2)}
Bollinger: ${posicaoBollinger}
Momentum MACD: ${macd.cruzamento}
Padrão de Candle: ${padrao}

Regra Operacional Híbrida:
- Para COMPRAR: O ativo precisa ter batido no fundo (Bollinger Inferior ou RSI < 35) E apresentar padrão de reversão.
- Para VENDER: O ativo precisa ter batido no teto (Bollinger Superior ou RSI > 65) E apresentar padrão de reversão.
Se as métricas entrarem em conflito (ex: MACD caindo mas preço subindo sem padrão), aborte a operação.

Responda SOMENTE em JSON: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Máximo 15 palavras do motivo técnico."}`;

          const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }, 
              temperature: 0.1
            })
          });
          
          if (responseGroq.ok) {
            const iaResposta = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
            console.log(`↳ 🤖 Veredito: [${iaResposta.sinal}] ${iaResposta.motivo}`);
            
            if (iaResposta.sinal !== 'NEUTRO' && parseInt(iaResposta.confianca_padrao) >= 70) {
              torneioDeSinais.push({
                ativo, ia: iaResposta, precoAtual, 
                analise: { rsi, posicaoBollinger, macdDirection: macd.cruzamento, padrao },
                confianca: parseInt(iaResposta.confianca_padrao),
                stats: { globalWins, globalLosses, statusBot, taxaAcertoDiaria }
              });
            }
          }
        } catch (e: any) { return; }
      }));
    }

    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0]; // Pega apenas o mais confiante
      console.log(`🚀 SINAL HÍBRIDO ENCONTRADO! Enviando: ${alvo.ia.sinal} para ${alvo.ativo}`);
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.analise, alvo.stats);
    } else {
      console.log(`🛑 Nenhum cenário perfeito encontrado neste ciclo.`);
    }

    return NextResponse.json({ success: true, mensagem: `Ciclo concluído sem sobrecarga.` });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
