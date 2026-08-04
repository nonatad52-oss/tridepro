import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- DESTRUIDORES DE CACHE ---
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

// --- FUNÇÃO AUXILIAR DE DELAY ---
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

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

    let operacaoId = null;
    try {
      const { data: insertData } = await supabase.from('historico_operacoes')
        .insert([{ 
          ticker: ativo, 
          sinal: iaData.sinal, 
          taxa_entrada: precoAtual, 
          resultado: 'PENDENTE',
          created_at: new Date().toISOString()
        }])
        .select('id').single();
      if (insertData) operacaoId = insertData.id;
    } catch (dbErr: any) {
      console.error("⚠️ Aviso: Falha ao registrar no Supabase antes do envio:", dbErr.message);
    }

    let iconeDesempenho = "📊";
    if (stats.taxaAcerto >= 65) iconeDesempenho = "🏆";
    else if (stats.taxaAcerto <= 45 && stats.totalOps > 0) iconeDesempenho = "⚠️";

    const mensagem = `🤖 *SINAL IA - INTELIGÊNCIA AGRESSIVA* 🤖
*Ativo:* ${ativoFormatado}
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}
⏰ *Entrada:* ${formatadorHora.format(proximaVela)}
⏳ *Expiração:* ${formatadorHora.format(expiracao)}

${iconeDesempenho} *Histórico do Ativo:*
*Acertos:* ${stats.taxaAcerto}% (${stats.wins}W / ${stats.losses}L)

🌐 *PLACAR DO DIA (BOT):*
*Status:* ${stats.statusBot}
*Acertos Hoje:* ${stats.taxaAcertoDiaria}% 🎯
*Total:* ${stats.globalWins} WINS ✅ / ${stats.globalLosses} LOSSES ❌

📊 *Gatilho Identificado:* ${padrao.replace(/_/g, ' ')}
🔥 *RSI (Força):* ${rsi.toFixed(2)}
🧠 *Mapeamento IA:* ${iaData.motivo}
🎯 *Confiança:* ${iaData.confianca_padrao}`;
    
    const payload: any = { 
      chat_id: TELEGRAM_CHAT_ID, 
      text: mensagem, 
      parse_mode: 'Markdown' 
    };

    if (operacaoId) {
      payload.reply_markup = { 
        inline_keyboard: [
          [{ text: '✅ WIN', callback_data: `WIN_${operacaoId}` }, { text: '❌ LOSS', callback_data: `LOSS_${operacaoId}` }],
          [{ text: '🗑️ NÃO PEGUEI', callback_data: `DEL_${operacaoId}` }]
        ] 
      };
    }
    
    const resTg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const tgJson = await resTg.json();
    if (!tgJson.ok) {
      console.error(`❌ [TELEGRAM ERRO API]:`, tgJson);
    } else {
      console.log(`✅ [TELEGRAM] Sinal enviado com sucesso para ${ativo}!`);
    }
  } catch (error: any) {
    console.error(`❌ [TELEGRAM ERRO CRÍTICO]:`, error.message);
  }
}

export async function GET(request: Request) {
  console.log("==========================================");
  console.log("🤖 INICIANDO CICLO DO ROBÔ...");
  console.log("==========================================");

  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || ''; 
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      console.log("❌ Acesso negado. Chave incorreta.");
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) {
      console.log("❌ Erro ao buscar ativos no banco de dados.");
      return NextResponse.json({ error: "Erro DB" }, { status: 500 });
    }
    
    let ativosBrutos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC'));
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    let ativosAtivos = ativosBrutos.filter(ativo => isMercadoAberto(ativo, horaSP));

    console.log(`📋 Total de ativos abertos no momento: ${ativosAtivos.length}`);

    // --- ROLETA DE 6 ATIVOS PARA VELOCIDADE MÁXIMA ---
    ativosAtivos.sort(() => Math.random() - 0.5);
    ativosAtivos = ativosAtivos.slice(0, 6);
    
    console.log(`🎰 Sorteados 6 ativos para esta rodada: ${ativosAtivos.join(', ')}`);

    const torneioDeSinais = [];
    const agoraUtcMs = new Date().getTime(); 

    // --- CÁLCULO DO PLACAR DIÁRIO GLOBAL ---
    const hojeBR = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const { data: globalOps } = await supabase
      .from('historico_operacoes')
      .select('resultado, created_at')
      .in('resultado', ['WIN', 'LOSS'])
      .order('created_at', { ascending: false })
      .limit(1000); 

    let globalWins = 0; let globalLosses = 0;
    if (globalOps) {
      const opsDeHoje = globalOps.filter(op => {
         const dataOp = new Date(op.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
         return dataOp === hojeBR;
      });
      globalWins = opsDeHoje.filter(op => op.resultado === 'WIN').length;
      globalLosses = opsDeHoje.filter(op => op.resultado === 'LOSS').length;
    }
    
    const saldoDiario = globalWins - globalLosses;
    const totalOpsDiaria = globalWins + globalLosses;
    const taxaAcertoDiaria = totalOpsDiaria > 0 ? Math.round((globalWins / totalOpsDiaria) * 100) : 0;
    const statusBot = saldoDiario > 0 ? "🟢 POSITIVO" : (saldoDiario < 0 ? "🔴 NEGATIVO" : "⚪ ZERO");

    for (const ativo of ativosAtivos) {
      try {
        const { data: historicoTotal } = await supabase
          .from('historico_operacoes')
          .select('resultado')
          .eq('ticker', ativo)
          .in('resultado', ['WIN', 'LOSS'])
          .limit(300);

        let wins = 0; let losses = 0;
        if (historicoTotal) {
          wins = historicoTotal.filter(op => op.resultado === 'WIN').length;
          losses = historicoTotal.filter(op => op.resultado === 'LOSS').length;
        }
        const totalResolvido = wins + losses;
        const taxaAcertoAtual = totalResolvido > 0 ? Math.round((wins / totalResolvido) * 100) : 0;

        const { data: ultimasOps } = await supabase
          .from('historico_operacoes')
          .select('resultado, created_at')
          .eq('ticker', ativo)
          .order('created_at', { ascending: false })
          .limit(5);

        let bloqueado = false;
        let sequenciaRecente = "Sem histórico imediato.";

        if (ultimasOps && ultimasOps.length > 0) {
          sequenciaRecente = ultimasOps.map(op => op.resultado).join(" -> ");
          for (const op of ultimasOps) {
             let dataStr = op.created_at;
             if (!dataStr.includes('Z') && !dataStr.includes('+')) dataStr += 'Z';
             
             const tempoOpDB = new Date(dataStr).getTime();
             const minDecorridos = (agoraUtcMs - tempoOpDB) / (1000 * 60);

             if (minDecorridos >= 0) { 
                 if (op === ultimasOps[0] && minDecorridos < 10) {
                     bloqueado = true;
                 }
                 if (op.resultado === 'LOSS' && minDecorridos < 25) {
                     bloqueado = true;
                 }
             }
          }
        }

        if (bloqueado) {
            console.log(`⏳ [${ativo}] Pulando: Bloqueio de segurança (Operou recentemente)`);
            continue; 
        }

        // --- BUSCA DE DADOS YAHOO FINANCE ---
        const [res5m, res15m] = await Promise.all([
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
        ]);

        if (!res5m.ok || !res15m.ok) {
            console.log(`⚠️ [${ativo}] Falha ao buscar dados no Yahoo Finance.`);
            continue;
        }
        const json5m = await res5m.json(); const json15m = await res15m.json();
        
        const timestamps5m = json5m.chart?.result?.[0]?.timestamp;
        if (!timestamps5m) continue;
        const lastTime = timestamps5m[timestamps5m.length - 1];
        const agoraSec = Math.floor(Date.now() / 1000);
        if (agoraSec - lastTime > 1200) {
            console.log(`⚠️ [${ativo}] Ativo parece estar sem volume/fechado agora.`);
            continue; 
        }

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

        const prompt = `Você é o Cérebro de uma IA de Alta Frequência operando ${ativo}.
Sua missão: Identificar boas oportunidades no fluxo do preço. Seja inteligente e rápido.

🧠 **DADOS DO ATIVO:**
- Placar: ${taxaAcertoAtual}% (${wins} Wins / ${losses} Losses)
- Últimos Resultados: ${sequenciaRecente}

📊 **MAPEAMENTO TÉCNICO:**
- Tendência Macro (M15): ${tendenciaMacro}
- Força RSI (M5): ${rsi5m.toFixed(2)}
- Ação de Preço (M5): ${padraoMicro}

**REGRAS DE DECISÃO:**
1. Fluxo Inteligente: Se houver indícios de força a favor da Tendência Macro ou exaustão técnica, APROVE a entrada.
2. Se o mercado estiver indeciso ou sem padrão claro, declare NEUTRO.

Retorne EXCLUSIVAMENTE em JSON:
{"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Análise rápida em até 15 palavras."}`;

        // --- SISTEMA OTIMIZADO GROQ (MODELO INSTANTÂNEO) ---
        let iaResposta = null;
        let tentativas = 0;
        const maxTentativas = 2;

        console.log(`🧠 [${ativo}] Enviando dados para a Inteligência Artificial...`);

        while (tentativas < maxTentativas && !iaResposta) {
            try {
                await delay(1000); 
                const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'llama-3.1-8b-instant', // <--- MODELO RÁPIDO E SEM LIMITES RÍGIDOS DE RATE-LIMIT
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }, 
                        temperature: 0.2 
                    })
                });

                if (!responseGroq.ok) throw new Error(`Status ${responseGroq.status}`);
                iaResposta = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
            } catch (err: any) {
                tentativas++;
                console.log(`⚠️ [${ativo}] Falha na IA (${err.message}). Tentativa ${tentativas} de ${maxTentativas}`);
                if (tentativas < maxTentativas) await delay(2000); 
            }
        }

        if (!iaResposta) {
            console.log(`❌ [${ativo}] IA não respondeu após várias tentativas.`);
            continue; 
        }

        const confiancaNumerica = parseInt(iaResposta.confianca_padrao);
        console.log(`🎯 [${ativo}] IA Respondeu: SINAL ${iaResposta.sinal} | CONFIANÇA: ${confiancaNumerica}% | MOTIVO: ${iaResposta.motivo}`);

        // --- SISTEMA DE CONFIANÇA (>= 70%) ---
        if ((iaResposta.sinal === 'COMPRA' || iaResposta.sinal === 'VENDA') && confiancaNumerica >= 70) {
           torneioDeSinais.push({ 
               ativo, ia: iaResposta, precoAtual, rsi: rsi5m, padrao: padraoMicro, confianca: confiancaNumerica, 
               stats: { totalOps: totalResolvido, taxaAcerto: taxaAcertoAtual, wins, losses, globalWins, globalLosses, statusBot, taxaAcertoDiaria } 
           });
        }
      } catch (e: any) { 
          console.error(`💥 [${ativo}] Erro crítico durante processamento:`, e.message);
          continue; 
      }
    }

    console.log("==========================================");
    if (torneioDeSinais.length > 0) {
      console.log(`🏆 TORNEIO FINALIZADO! Tivemos ${torneioDeSinais.length} ativo(s) aprovados pela IA.`);
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0];
      
      console.log(`🥇 VENCEDOR: ${alvo.ativo} com ${alvo.confianca}% de confiança. Enviando para o Telegram...`);
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.rsi, alvo.padrao, alvo.stats);
    } else {
      console.log(`🛑 FIM DA RODADA: Nenhum sinal atingiu a confiança mínima de 70%. Aguardando próximo ciclo.`);
    }
    console.log("==========================================\n");

    // --- GATILHO DE RELATÓRIO DIÁRIO NO TELEGRAM ---
    if (horaSP.getHours() === 23 && horaSP.getMinutes() >= 50) {
      console.log("📊 Horário de Relatório Diário atingido. Enviando para o Telegram...");
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
      
      const msgRelatorio = `📊 *FECHAMENTO DIÁRIO DO BOT* 📊
      
*Status Geral do Dia:* ${statusBot}
*Placar Total:* ${globalWins} WINS ✅ | ${globalLosses} LOSSES ❌
*Taxa de Acerto Hoje:* ${taxaAcertoDiaria}% 🎯
*Total de Operações:* ${totalOpsDiaria}

_Modo de Aprendizado Contínuo. O sistema estará pronto para operar amanhã!_ 🚀`;
      
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msgRelatorio, parse_mode: 'Markdown' })
      });
    }

    return NextResponse.json({ success: true, mensagem: `Análise finalizada. Logs gerados com sucesso.` });
  } catch (error: any) {
    console.error("❌ ERRO FATAL NA EXECUÇÃO:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
