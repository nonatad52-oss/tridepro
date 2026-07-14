import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// Inicialização segura das credenciais com fallback dinâmico
const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error("Credenciais do Supabase não configuradas no ambiente.");
  }
  return createClient(url, key);
};

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  try {
    const supabase = getSupabaseClient();
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';

    let ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
    
    const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const agora = new Date();
    
    const proximaVela = new Date(agora);
    proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
    proximaVela.setSeconds(0);
    proximaVela.setMilliseconds(0);
    
    const expiracao = new Date(proximaVela);
    expiracao.setMinutes(expiracao.getMinutes() + 5);

    // Salva a operação pendente no banco
    const { data: insertData, error: dbError } = await supabase
      .from('historico_operacoes')
      .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
      .select('id').single();

    if (dbError) {
      console.error(`❌ [BANCO DE DADOS] Falha ao registrar sinal: ${dbError.message}`);
      return;
    }

    if (!insertData) return;

    // Mensagem simplificada, limpa e profissional para o Telegram
    const mensagem = `🏆 *SINAL VIP (M5)* 🏆\n*Ativo:* ${ativoFormatado}\n*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI: ${rsi.toFixed(2)}\n🧠 Confiança: ${iaData.confianca_padrao}`;
    
    const telegramRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, 
        text: mensagem, 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [[
            { text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, 
            { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }
          ]] 
        } 
      }),
    });

    if (!telegramRes.ok) {
      console.error(`❌ [TELEGRAM] Erro no envio da mensagem: ${await telegramRes.text()}`);
    }
  } catch (error: any) {
    console.error("❌ [ENVIO] Falha crítica no processamento do sinal de envio:", error.message || error);
  }
}

export async function GET(request: Request) {
  console.log("🤖 [CRON] Robô acordou! Iniciando varredura analítica avançada...");
  
  try {
    const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY || 'chave-temporaria'; 
    
    const { searchParams } = new URL(request.url);
    const isManual = searchParams.get('key') === CRON_SECRET;

    if (!isManual) {
      console.log("❌ [ERRO] Tentativa de acesso bloqueada (Chave de segurança inválida).");
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    const { data: ativosDB, error: fetchAtivosError } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (fetchAtivosError || !ativosDB) {
      console.log("❌ [ERRO] Falha ao buscar ativos no Supabase:", fetchAtivosError?.message);
      return NextResponse.json({ error: "Erro ao buscar ativos no banco de dados" }, { status: 500 });
    }
    
    let ativos = ativosDB.map(a => a.ticker);

    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaDaSemana = horaSP.getDay(); 
    const isFimDeSemana = diaDaSemana === 0 || diaDaSemana === 6;

    if (isFimDeSemana) {
      console.log("📅 Fim de semana detectado! Analisando APENAS Criptomoedas.");
      ativos = ativos.filter(ativo => ativo.endsWith('-USD'));
    }

    console.log(`📊 Total de ativos válidos para agora: ${ativos.length}`);

    const analisados: string[] = [];
    const torneioDeSinais: Array<{ativo: string, sinal: string, confianca: number, precoAtual: number, rsi: number}> = [];

    const agora = new Date();
    const inicioVelaAtual = new Date(agora);
    inicioVelaAtual.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5));
    inicioVelaAtual.setSeconds(0);
    inicioVelaAtual.setMilliseconds(0);
    const inicioVelaISO = inicioVelaAtual.toISOString();

    for (const ativo of ativos) {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
        if (!res.ok) continue;

        const json = await res.json();
        const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
        
        if (!quote || !quote.close || !quote.open || !quote.high || !quote.low) continue; 

        // 🛠️ MAPEAMENTO MATEMÁTICO ANATÔMICO DO CANDLE (Price Action Puro - Preservado)
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
            const direcao = fc >= ab ? "ALTA" : "BAIXA";

            blocoVelas.push({ 
              abertura: ab, maxima: max, minima: min, fechamento: fc,
              corpo: tamanhoCorpo, pavio_sup: pavioSuperior, pavio_inf: pavioInferior, direcao: direcao
            });
          }
        }

        if (blocoVelas.length < 15) continue;
        const velas = blocoVelas.slice(-20);
        analisados.push(ativo); 

        // Cálculo preciso do RSI
        const rsi = 100 - (100 / (1 + (velas.slice(-14).reduce((g: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento > arr[i-1].fechamento ? g + (v.fechamento - arr[i-1].fechamento) : g, 0) / 14 / (velas.slice(-14).reduce((p: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento < arr[i-1].fechamento ? p + (arr[i-1].fechamento - v.fechamento) : p, 0) / 14 || 1)))); 

        const isCrypto = ativo.endsWith('-USD');
        const limiteVenda = isCrypto ? 65 : 70;
        const limiteCompra = isCrypto ? 35 : 30;

        if (rsi >= limiteVenda || rsi <= limiteCompra) {
          if (rsi <= 0.5 || rsi >= 99.5) continue;

          console.log(`\n🚨 ALERTA RSI VÁLIDO: ${ativo} (${rsi.toFixed(2)}). Solicitando avaliação da IA...`);
          
          const { data: sinalJaEnviado } = await supabase
            .from('historico_operacoes')
            .select('id')
            .eq('ticker', ativo)
            .gte('created_at', inicioVelaISO)
            .limit(1);

          if (sinalJaEnviado && sinalJaEnviado.length > 0) {
            console.log(`⏳ IA Pulada: Sinal já emitido para ${ativo} neste bloco M5.`);
            continue; 
          }

          const { data: historico } = await supabase
            .from('historico_operacoes')
            .select('sinal, resultado')
            .eq('ticker', ativo)
            .in('resultado', ['WIN', 'LOSS'])
            .order('id', { ascending: false })
            .limit(5);

          let diarioDeAprendizado = "Nenhuma operação finalizada recentemente para este ativo.";
          if (historico && historico.length > 0) {
            diarioDeAprendizado = historico.map((h, i) => `[Anterior ${i+1}]: Sinal de ${h.sinal} -> Resultado: ${h.resultado}`).join('\n');
          }
          
          const contextoMercado = isCrypto 
            ? `ALERTA DE VOLATILIDADE CRIPTO: Verifique agressivamente se há pavios longos de exaustão contra a tendência atual.` 
            : `MERCADO TRADICIONAL (Forex/Ações): O ativo tende a retornar à média. Avalie suporte/resistência nos preços das últimas velas.`;

          const prompt = `Você é um robô de Inteligência Artificial Especialista em Reversão de Tendência e Price Action de alta precisão (Gráfico M5) para o ativo ${ativo}.

          ${contextoMercado}

          MÉTRICAS ANATÔMICAS DAS ÚLTIMAS 20 VELAS (Análise estrutural):
          ${JSON.stringify(velas)}

          MOMENTUM ATUAL:
          - RSI (14): ${rsi.toFixed(2)}
          
          SEU DIÁRIO DE APRENDIZADO (Histórico recente de acertos/erros):
          ${diarioDeAprendizado}
          
          REGRAS DE FILTRAGEM ANTI-ERRO:
          1. Se o RSI estiver esticado para VENDA, mas as últimas 3 ou 4 velas forem barras gigantes de ALTA com pavio superior quase ZERO, isso é força compradora esmagadora. Responda "NEUTRO".
          2. Para confirmar "VENDA", procure por velas recentes de alta que deixaram longos pavios superiores (rejeição de topo).
          3. Para confirmar "COMPRA", procure por velas recentes de baixa que deixaram longos pavios inferiores (rejeição de fundo).
          4. Só atribua confiança alta se o padrão gráfico apoiar a exaustão indicada pelo RSI.

          Sua resposta deve ser EXCLUSIVAMENTE um JSON válido, sem qualquer texto adicional:
          {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

          await new Promise(resolve => setTimeout(resolve, 300));

          const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROQ_BOT_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile', 
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }, 
              temperature: 0.1 
            })
          });

          if (!responseGroq.ok) continue;

          const dadosGroq = await responseGroq.json();
          const ia = JSON.parse(dadosGroq.choices[0].message.content.trim());
          
          const confiancaNumerica = parseInt(ia.confianca_padrao);
          console.log(`🧠 [MOTOR ANÁLITICO] ${ativo} -> Sinal: ${ia.sinal} | Confiança: ${confiancaNumerica}%`);

          if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && confiancaNumerica >= 70) {
            console.log(`📥 Guardando ${ativo} para a decisão de elite...`);
            torneioDeSinais.push({
              ativo: ativo,
              sinal: ia.sinal,
              confianca: confiancaNumerica,
              precoAtual: velas[velas.length-1].fechamento,
              rsi: rsi
            });
          }
        }
      } catch (e: any) { 
        console.log(`❌ Erro processando ativo ${ativo}:`, e?.message || e); 
      }
    }

    // Seleção do sinal vencedor do torneio
    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const oMelhor = torneioDeSinais[0];
      
      console.log(`\n🥇 FILTRADO E ENVIADO: ${oMelhor.ativo} com ${oMelhor.confianca}% de precisão analítica.`);

      await enviarSinalTelegram(
        oMelhor.ativo, 
        { sinal: oMelhor.sinal, confianca_padrao: `${oMelhor.confianca}%` }, 
        oMelhor.precoAtual, 
        oMelhor.rsi
      );
    } else {
      console.log("😴 Nenhum ativo passou pelo filtro anti-erros de 70% nesta rodada.");
    }

    console.log("✅ [CRON] Varredura finalizada.");
    return NextResponse.json({ 
      success: true, 
      mensagem: `Varredura com filtro anti-erro ativo. Alvo: >=70%`, 
      ativos_analisados: analisados 
    });

  } catch (error: any) {
    console.error("❌ [ERRO CRÍTICO CRON]:", error.message || error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
