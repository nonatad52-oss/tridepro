import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  console.log("🤖 [CRON] Acordando o robô...");

  try {
    // 1. CARREGAMENTO SEGURO DAS VARIÁVEIS DE AMBIENTE (Dentro da função)
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const GROQ_BOT_KEY = process.env.GROQ_BOT_KEY; 
    const CRON_SECRET = process.env.CRON_SECRET;

    // Se faltar a chave do banco, ele avisa no log sem derrubar o servidor
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.log("❌ [ERRO CRÍTICO] Faltam as chaves do Supabase no painel da Vercel.");
      return NextResponse.json({ error: 'Chaves do banco de dados ausentes' }, { status: 500 });
    }

    // Inicialização segura do banco de dados
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Verificação de segurança do Cron (Chave secreta)
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. BUSCA OS ATIVOS NO BANCO DE DADOS
    const { data: ativosDB, error: erroDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
    if (erroDB || !ativosDB) {
      console.log("❌ [ERRO] Falha ao buscar ativos:", erroDB?.message);
      return NextResponse.json({ error: "Erro ao buscar ativos no banco de dados" });
    }
    
    let ativos = ativosDB.map(a => a.ticker);

    // Filtro de Fim de Semana
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const diaDaSemana = horaSP.getDay(); 
    const isFimDeSemana = diaDaSemana === 0 || diaDaSemana === 6;

    if (isFimDeSemana) {
      console.log("📅 Fim de semana: Analisando APENAS Criptomoedas.");
      ativos = ativos.filter(ativo => ativo.endsWith('-USD'));
    }

    const torneioDeSinais: Array<any> = [];
    const agora = new Date();
    
    // Calcula início da vela atual
    const inicioVelaAtual = new Date(agora);
    inicioVelaAtual.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5));
    inicioVelaAtual.setSeconds(0);
    inicioVelaAtual.setMilliseconds(0);
    const inicioVelaISO = inicioVelaAtual.toISOString();

    // 3. O MOTOR DE ANÁLISE E CAÇA AOS PADRÕES
    for (const ativo of ativos) {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
        if (!res.ok) continue;

        const json = await res.json();
        const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
        if (!quote || !quote.close || !quote.open || !quote.high || !quote.low) continue; 

        const blocoVelas = [];
        for (let i = 0; i < quote.close.length; i++) {
          if (quote.close[i] != null && quote.open[i] != null && quote.high[i] != null && quote.low[i] != null) {
            const ab = quote.open[i];
            const fc = quote.close[i];
            const max = quote.high[i];
            const min = quote.low[i];
            
            blocoVelas.push({ 
              abertura: ab, maxima: max, minima: min, fechamento: fc,
              corpo: Math.abs(fc - ab), 
              pavio_sup: max - Math.max(ab, fc), 
              pavio_inf: Math.min(ab, fc) - min, 
              direcao: fc >= ab ? "ALTA" : "BAIXA"
            });
          }
        }

        if (blocoVelas.length < 15) continue;
        const velas = blocoVelas.slice(-30);

        // Cálculo do RSI 14
        const rsi = 100 - (100 / (1 + (velas.slice(-14).reduce((g: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento > arr[i-1].fechamento ? g + (v.fechamento - arr[i-1].fechamento) : g, 0) / 14 / (velas.slice(-14).reduce((p: number, v: any, i: number, arr: any[]) => i > 0 && v.fechamento < arr[i-1].fechamento ? p + (arr[i-1].fechamento - v.fechamento) : p, 0) / 14 || 1)))); 

        const isCrypto = ativo.endsWith('-USD');
        const limiteVenda = isCrypto ? 65 : 70;
        const limiteCompra = isCrypto ? 35 : 30;

        if (rsi >= limiteVenda || rsi <= limiteCompra) {
          if (rsi <= 0.5 || rsi >= 99.5) continue;
          
          const { data: sinalJaEnviado } = await supabase
            .from('historico_operacoes')
            .select('id')
            .eq('ticker', ativo)
            .gte('created_at', inicioVelaISO)
            .limit(1);

          if (sinalJaEnviado && sinalJaEnviado.length > 0) continue; 

          const { data: historico } = await supabase
            .from('historico_operacoes')
            .select('sinal, resultado')
            .eq('ticker', ativo)
            .in('resultado', ['WIN', 'LOSS'])
            .order('id', { ascending: false })
            .limit(5);

          let diarioDeAprendizado = "Nenhuma operação finalizada recentemente.";
          if (historico && historico.length > 0) {
            diarioDeAprendizado = historico.map((h, i) => `[Anterior ${i+1}]: ${h.sinal} -> ${h.resultado}`).join('\n');
          }
          
          const contextoMercado = isCrypto ? `CRIPTO: Procure pavios de rejeição.` : `MERCADO TRADICIONAL: Avalie suporte/resistência.`;
          const prompt = `Você é um robô Especialista em Price Action (M5) para o ativo ${ativo}.
          ${contextoMercado}
          MÉTRICAS DAS ÚLTIMAS 30 VELAS: ${JSON.stringify(velas)}
          RSI: ${rsi.toFixed(2)}
          DIÁRIO: ${diarioDeAprendizado}
          Responda EXCLUSIVAMENTE em JSON: {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%"}`;

          const responseGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_BOT_KEY}`, 'Content-Type': 'application/json' },
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

          if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && confiancaNumerica >= 70) {
            torneioDeSinais.push({ ativo, sinal: ia.sinal, confianca: confiancaNumerica, confianca_padrao: ia.confianca_padrao, precoAtual: velas[velas.length-1].fechamento, rsi });
          }
        }
      } catch (e: any) { 
        console.log(`⚠️ Aviso interno em ${ativo}: pulando para o próximo.`); 
      }
    }

    // 4. FUNÇÃO DE ENVIO PARA O TELEGRAM (Embutida e Protegida)
    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const oMelhor = torneioDeSinais[0];
      
      let ativoFormatado = oMelhor.ativo.endsWith('=X') ? oMelhor.ativo.substring(0, 3) + '/' + oMelhor.ativo.substring(3, 6) : oMelhor.ativo.replace('-', '/');
      const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      
      const proximaVela = new Date(agora);
      proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
      proximaVela.setSeconds(0);
      proximaVela.setMilliseconds(0);
      
      const expiracao = new Date(proximaVela);
      expiracao.setMinutes(expiracao.getMinutes() + 5);

      const { data: insertData, error: dbError } = await supabase
        .from('historico_operacoes')
        .insert([{ ticker: oMelhor.ativo, sinal: oMelhor.sinal, taxa_entrada: oMelhor.precoAtual, resultado: 'PENDENTE' }])
        .select('id').single();

      if (!dbError && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const mensagem = `🏆 *SINAL VIP (M5)* 🏆\n*Ativo:* ${ativoFormatado}\n*Ação:* ${oMelhor.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}\n⏰ *Entrada:* ${formatadorHora.format(proximaVela)}\n⏳ *Expiração:* ${formatadorHora.format(expiracao)}\n📊 RSI: ${oMelhor.rsi.toFixed(2)}\n🧠 Confiança: ${oMelhor.confianca_padrao}`;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            chat_id: TELEGRAM_CHAT_ID, text: mensagem, parse_mode: 'Markdown', 
            reply_markup: { inline_keyboard: [[{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }]] } 
          }),
        });
      } else {
        console.log("❌ Erro ao salvar/enviar sinal. Verifique as chaves do Telegram/Supabase.");
      }
    }

    console.log("✅ [CRON] Varredura finalizada.");
    return NextResponse.json({ success: true, mensagem: 'Varredura finalizada.' });

  } catch (error: any) {
    console.error("❌ Erro crítico geral:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
