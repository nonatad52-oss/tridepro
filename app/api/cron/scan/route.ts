// ============================================================================
// NÚCLEO DO ROBÔ (EXECUÇÃO PRINCIPAL) - ATUALIZADO COM FILTROS ANTI-LOSS
// ============================================================================
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

    // 1️⃣ CHAMA O AUDITOR AUTOMÁTICO ANTES DE TUDO
    await verificarResultadosPendentes(supabase);

    // 2️⃣ SEGUE O FLUXO NORMAL BUSCANDO NOVAS OPORTUNIDADES
    const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (!ativosDB) {
      return NextResponse.json({ error: "Erro DB" }, { status: 500 });
    }
    
    let ativosBrutos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC'));
    let ativosAtivos = ativosBrutos.filter(ativo => isMercadoAberto(ativo));

    console.log(`📋 Total de ativos abertos no momento: ${ativosAtivos.length}`);

    ativosAtivos.sort(() => Math.random() - 0.5);
    ativosAtivos = ativosAtivos.slice(0, 6);
    
    console.log(`🎰 Sorteados 6 ativos para esta rodada: ${ativosAtivos.join(', ')}`);

    const torneioDeSinais = [];
    const agoraUtcMs = new Date().getTime(); 

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

        // 🛡️ FILTRO 2: HISTÓRICO TÓXICO
        // Se o ativo tem histórico e a taxa caiu pra menos de 55%, pula fora!
        if (totalResolvido >= 4 && taxaAcertoAtual < 55) {
            console.log(`🩸 [CORTE DE SANGRAMENTO] ${ativo} está com taxa de acerto de ${taxaAcertoAtual}%. Bloqueado até melhorar.`);
            continue;
        }

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
            console.log(`⏳ [${ativo}] Pulando: Bloqueio de segurança ativo`);
            continue; 
        }

        const [res5m, res15m] = await Promise.all([
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`, { cache: 'no-store' }),
          fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=15m&range=2d`, { cache: 'no-store' })
        ]);

        if (!res5m.ok || !res15m.ok) continue;
        const json5m = await res5m.json(); const json15m = await res15m.json();
        
        const quote5m = json5m.chart?.result?.[0]?.indicators?.quote?.[0];
        const quote15m = json15m.chart?.result?.[0]?.indicators?.quote?.[0];
        if (!quote5m?.close || !quote15m?.close) continue;

        // SENSOR DE VOLUME
        const timestamps5m = json5m.chart?.result?.[0]?.timestamp;
        if (timestamps5m && timestamps5m.length > 0) {
          const agoraSec = Math.floor(Date.now() / 1000); 
          const ultimaMovimentacao = timestamps5m[timestamps5m.length - 1]; 
          const diferencaMinutos = (agoraSec - ultimaMovimentacao) / 60;

          if (!ativo.includes('-USD') && diferencaMinutos > 20) {
            console.log(`⚠️ [BLOQUEADO] ${ativo} parece estar fechado! Última vela há ${Math.round(diferencaMinutos)} min.`);
            continue; 
          }
        }

        const velas5m = mapearAnatomiaVelas(quote5m, 20);
        const velas15m = mapearAnatomiaVelas(quote15m, 20);
        if (velas5m.length < 15 || velas15m.length < 20) continue;

        const rsi5m = calcularRSI(velas5m);

        // 🛡️ FILTRO 1: ZONA MORTA DE RSI
        // Se o RSI estiver no meio (sem força extrema), economiza API da IA e ignora.
        if (rsi5m > 35 && rsi5m < 65) {
            console.log(`🛡️ [RSI NEUTRO] ${ativo} com RSI em ${rsi5m.toFixed(2)}. Ignorando.`);
            continue;
        }

        const ema20_M15 = calcularEMA(velas15m, 20);
        const padraoMicro = identificarPadraoCandle(velas5m);
        const precoAtual = velas5m[velas5m.length - 1].fechamento;

        let tendenciaMacro = "LATERAL";
        if (ema20_M15) {
          if (velas15m[velas15m.length - 1].fechamento > ema20_M15) tendenciaMacro = "ALTA";
          else if (velas15m[velas15m.length - 1].fechamento < ema20_M15) tendenciaMacro = "BAIXA";
        }

        // 🛡️ FILTRO 3: O CHOQUE DE REALIDADE NO PROMPT
        const prompt = `Você é um Analista Quant de Alta Frequência EXTREMAMENTE RIGOROSO operando ${ativo}.
🧠 DADOS: Placar do Ativo: ${taxaAcertoAtual}% | T. Macro: ${tendenciaMacro} | RSI: ${rsi5m.toFixed(2)} | Padrão: ${padraoMicro}

REGRAS DE REJEIÇÃO (OBRIGATÓRIAS):
1. Se o Placar do Ativo for menor que 60%, você é OBRIGADO a reduzir sua confiança para menos de 60%.
2. Só autorize COMPRA se o RSI estiver próximo a 30 (Sobrevenda) E a tendência for de ALTA.
3. Só autorize VENDA se o RSI estiver próximo a 70 (Sobrecompra) E a tendência for de BAIXA.
4. Na menor dúvida ou conflito de indicadores, retorne NEUTRO.

Retorne JSON EXATO: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Até 15 palavras."}`;

        let iaResposta = null;
        let tentativas = 0;
        
        while (tentativas < 2 && !iaResposta) {
            try {
                await delay(1000); 
                const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'llama-3.1-8b-instant',
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }, 
                        temperature: 0.1 // 🛡️ Temperatura reduzida para IA ser mais fria e exata
                    })
                });
                if (!responseGroq.ok) throw new Error(`Status ${responseGroq.status}`);
                iaResposta = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
            } catch (err: any) {
                tentativas++;
                if (tentativas < 2) await delay(2000); 
            }
        }

        if (!iaResposta) continue; 
        const confiancaNumerica = parseInt(iaResposta.confianca_padrao);

        if ((iaResposta.sinal === 'COMPRA' || iaResposta.sinal === 'VENDA') && confiancaNumerica >= 70) {
            torneioDeSinais.push({ 
                ativo, ia: iaResposta, precoAtual, rsi: rsi5m, padrao: padraoMicro, confianca: confiancaNumerica, 
                stats: { totalOps: totalResolvido, taxaAcerto: taxaAcertoAtual, wins, losses, globalWins, globalLosses, statusBot, taxaAcertoDiaria } 
            });
        }
      } catch (e: any) { 
          continue; 
      }
    }

    console.log("==========================================");
    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0];
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.rsi, alvo.padrao, alvo.stats);
    } else {
      console.log(`🛑 Nenhum sinal com 70%+ de confiança nesta rodada.`);
    }
    console.log("==========================================\n");

    const horaSPParaRelatorio = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    if (horaSPParaRelatorio.getHours() === 23 && horaSPParaRelatorio.getMinutes() >= 50) {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
      
      const msgRelatorio = `📊 *FECHAMENTO DIÁRIO DO BOT* 📊\n*Status:* ${statusBot}\n*Placar:* ${globalWins} WINS ✅ | ${globalLosses} LOSSES ❌\n*Taxa Acerto:* ${taxaAcertoDiaria}% 🎯\n\n_Sistema 100% Automático!_ 🚀`;
      
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msgRelatorio, parse_mode: 'Markdown' })
      });
    }

    return NextResponse.json({ success: true, mensagem: `Análise e Auditoria finalizadas com sucesso.` });
  } catch (error: any) {
    console.error("❌ ERRO FATAL:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
