import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase não configuradas.");
  return createClient(url, key);
};

// --- FILTRO DE HORÁRIO ---
function isMercadoAberto(ticker: string, dataHora: Date) {
  const dia = dataHora.getDay(); 
  const hora = dataHora.getHours();
  const minuto = dataHora.getMinutes();
  const tempoDecimal = hora + (minuto / 60);
  
  if (ticker.endsWith('-USD')) return true; 
  const isFimDeSemana = (dia === 0 || dia === 6);
  if (ticker.endsWith('.SA')) {
    if (isFimDeSemana) return false;
    if (tempoDecimal < 10 || tempoDecimal >= 17.5) return false;
    return true;
  }
  return true; 
}

// --- ANÁLISE MATEMÁTICA ---
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

// --- ENVIO TELEGRAM ---
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

    const { data: insertData } = await supabase.from('historico_operacoes')
      .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
      .select('id').single();

    if (!insertData) return;

    let iconeDesempenho = "📊";
    if (stats.taxaAcerto >= 70) iconeDesempenho = "🏆";
    else if (stats.taxaAcerto <= 45 && stats.totalOps > 0) iconeDesempenho = "⚠️";

    const mensagem = `🤖 *SINAL IA - INTELIGÊNCIA SUPREMA* 🤖
*Ativo:* ${ativoFormatado}
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}
⏰ *Entrada:* ${formatadorHora.format(proximaVela)}
⏳ *Expiração:* ${formatadorHora.format(expiracao)}

${iconeDesempenho} *Placar Geral do Ativo:*
*Total de Operações:* ${stats.totalOps}
*Acertos:* ${stats.taxaAcerto}% (${stats.wins} W / ${stats.losses} L)

📊 *Gatilho Identificado:* ${padrao.replace(/_/g, ' ')}
🔥 *RSI (Força):* ${rsi.toFixed(2)}
🧠 *Mapeamento IA:* ${iaData.motivo}
🎯 *Confiança Padrão:* ${iaData.confianca_padrao}`;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [
            [{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }],
            [{ text: '🗑️ NÃO PEGUEI', callback_data: `DEL_${insertData.id}` }]
          ] 
        } 
      }),
    });
  } catch (error: any) { console.error("Erro no envio:", error.message); }
}

export async function GET(request: Request) {
  console.log("🤖 Iniciando varredura com Inteligência Suprema de Padrões...");

  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || ''; 
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const supabase = getSupabaseClient();
    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) return NextResponse.json({ error: "Erro DB" }, { status: 500 });
    
    let ativosBrutos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC'));
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    let ativosAtivos = ativosBrutos.filter(ativo => isMercadoAberto(ativo, horaSP));

    const torneioDeSinais = [];
    
    // Pega o timestamp atual em UTC exato para evitar bugs de fuso horário
    const agoraUtcMs = new Date().getTime(); 

    for (const ativo of ativosAtivos) {
      try {
        // --- 1. COLETA DE ESTATÍSTICAS GLOBAIS (O PLACAR REAL) ---
        const { data: historicoTotal } = await supabase
          .from('historico_operacoes')
          .select('resultado')
          .eq('ticker', ativo)
          .in('resultado', ['WIN', 'LOSS'])
          .limit(300); // Puxa uma boa amostragem para precisão

        let wins = 0; let losses = 0;
        if (historicoTotal) {
          wins = historicoTotal.filter(op => op.resultado === 'WIN').length;
          losses = historicoTotal.filter(op => op.resultado === 'LOSS').length;
        }
        const totalResolvido = wins + losses;
        const taxaAcertoAtual = totalResolvido > 0 ? Math.round((wins / totalResolvido) * 100) : 0;

        // --- 2. TRAVAS TEMPORAIS BLINDADAS (ANTI-REPETIÇÃO) ---
        const { data: ultimasOps } = await supabase
          .from('historico_operacoes')
          .select('resultado, created_at')
          .eq('ticker', ativo)
          .order('created_at', { ascending: false })
          .limit(3);

        let bloqueado = false;
        let sequenciaRecente = "Sem histórico imediato.";

        if (ultimasOps && ultimasOps.length > 0) {
          const ultimaOp = ultimasOps[0];
          // Garante que o tempo do banco seja lido corretamente
          const tempoOpDB = new Date(ultimaOp.created_at).getTime();
          const minDecorridos = (agoraUtcMs - tempoOpDB) / (1000 * 60);

          // Trava Absoluta: NUNCA envia sinal do mesmo ativo com menos de 10 minutos
          if (minDecorridos < 10) {
             console.log(`⏳ [BLOQUEIO ANTI-SPAM] ${ativo}: Sinal recente (${Math.round(minDecorridos)} min atrás).`);
             bloqueado = true;
          }
          // Trava de Teimosia: Se a última foi LOSS, aguarda 25 minutos obrigatoriamente
          else if (ultimaOp.resultado === 'LOSS' && minDecorridos < 25) {
             console.log(`⛔ [CASTIGO APÓS LOSS] ${ativo}: Resfriando ativo após erro recente.`);
             bloqueado = true;
          }

          sequenciaRecente = ultimasOps.map(op => op.resultado).join(" -> ");
        }

        if (bloqueado) continue; // Pula para o próximo ativo imediatamente

        // --- 3. COLETA TÉCNICA DO GRÁFICO ---
        const [res5m, res15m] = await Promise.all([
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
        ]);

        if (!res5m.ok || !res15m.ok) continue;
        const json5m = await res5m.json(); const json15m = await res15m.json();
        
        // Proteção contra ativo sem liquidez/fechado
        const timestamps5m = json5m.chart?.result?.[0]?.timestamp;
        if (!timestamps5m) continue;
        const lastTime = timestamps5m[timestamps5m.length - 1];
        const agoraSec = Math.floor(Date.now() / 1000);
        if (agoraSec - lastTime > 1200) continue; 

        const quote5m = json5m.chart?.result?.[0]?.indicators?.quote?.[0];
        const quote15m = json15m.chart?.result?.[0]?.indicators?.quote?.[0];
        if (!quote5m?.close || !quote15m?.close) continue;

        const velas5m = mapearAnatomiaVelas(quote5m, 20);
        const velas15m = mapearAnatomiaVelas(quote15m, 20);
        if (velas5m.length < 15 || velas15m.length < 20) continue;

        const rsi5m = calcularRSI(velas5m);
        const ema20_M15 = calcularEMA(velas15m, 20);
        const padraoMicro = identificarPadraoCandle(velas5m);
        const precoAtual = velas5m[velas5m.length - 1].fechamento;

        let tendenciaMacro = "LATERAL";
        if (ema20_M15) {
          if (velas15m[velas15m.length - 1].fechamento > ema20_M15) tendenciaMacro = "ALTA";
          else if (velas15m[velas15m.length - 1].fechamento < ema20_M15) tendenciaMacro = "BAIXA";
        }

        // --- 4. PROMPT: MATRIZ DE RECONHECIMENTO DE PADRÕES ---
        const temPadrao = padraoMicro !== "VELA_DE_FORCA_NORMAL" && padraoMicro !== "NENHUM";
        const rsiOportunidade = rsi5m <= 48 || rsi5m >= 52; 

        if (temPadrao || rsiOportunidade) {
          const prompt = `Você é o Cérebro de uma IA de Alta Frequência operando ${ativo}.
Sua missão: Identificar padrões repetitivos e operar com "Inteligência Suprema" — seja agressivo quando houver confluência técnica, mas rejeite implacavelmente padrões fracos se o histórico deste ativo estiver ruim.

🧠 **DADOS DE APRENDIZADO DESTE ATIVO:**
- Taxa de Acerto Histórica: ${taxaAcertoAtual}% (${wins} Wins / ${losses} Losses)
- Resultados das últimas 3 operações (Mais recente primeiro): ${sequenciaRecente}

📊 **MAPEAMENTO TÉCNICO ATUAL:**
- Tendência Macro (M15): ${tendenciaMacro}
- Força RSI (M5): ${rsi5m.toFixed(2)}
- Padrão de Reversão/Continuidade Atual: ${padraoMicro}

**REGRAS DE DECISÃO:**
1. Agressividade Qualificada: Se o padrão atual estiver A FAVOR da Tendência Macro e o RSI confirmar, aprove com confiança alta (75%+).
2. Memória de Erro: Se a última operação foi LOSS ou a Taxa de Acerto Histórica for menor que 50%, EXIJA um padrão de livro (ex: Engolfo ou Martelo claro). Não aceite incertezas.
3. Se não houver clareza matemática que justifique o risco, declare NEUTRO.

Retorne EXCLUSIVAMENTE em JSON:
{"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Análise direta em até 15 palavras baseada no padrão."}`;

          const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile', 
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }, 
              temperature: 0.2 
            })
          });

          if (!responseGroq.ok) continue;

          const ia = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
          const confiancaNumerica = parseInt(ia.confianca_padrao);

          if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && confiancaNumerica >= 75) {
             torneioDeSinais.push({ 
                 ativo, ia, precoAtual, rsi: rsi5m, padrao: padraoMicro, confianca: confiancaNumerica, 
                 stats: { totalOps: totalResolvido, taxaAcerto: taxaAcertoAtual, wins, losses } 
             });
             console.log(`🎯 [CONFLUÊNCIA] ${ativo}: ${ia.sinal} (${confiancaNumerica}%). Motivo: ${ia.motivo}`);
          }
        }
      } catch (e: any) { continue; }
    }

    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0];
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.rsi, alvo.padrao, alvo.stats);
    }

    return NextResponse.json({ success: true, mensagem: `Análise finalizada.` });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
