import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

// --- CONFIGURAÇÃO SUPABASE ---
const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase não configuradas.");
  return createClient(url, key);
};

// --- FUNÇÕES DE CALENDÁRIO ECONÔMICO (NOTÍCIAS) ---
async function buscarNoticiasAltoImpacto() {
  try {
    // Fonte confiável e amigável para robôs (equivalente aos 3 touros do Investing)
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const dados = await res.json();
    // Filtra apenas notícias de alto impacto ("High")
    return dados.filter((noticia: any) => noticia.impact === 'High');
  } catch (erro) {
    console.error("⚠️ Falha ao buscar calendário econômico:", erro);
    return [];
  }
}

function ativoAfetadoPorNoticia(ticker: string, noticias: any[], dataAtual: Date): boolean {
  if (!noticias || noticias.length === 0) return false;

  // Descobre quais moedas afetam este ativo
  const moedasDoAtivo: string[] = [];
  if (ticker.endsWith('=X')) {
    moedasDoAtivo.push(ticker.substring(0, 3), ticker.substring(3, 6)); // Ex: EUR, USD
  } else if (ticker.endsWith('.SA')) {
    moedasDoAtivo.push('BRL', 'USD'); // Notícias do dólar afetam o Brasil diretamente
  } else {
    moedasDoAtivo.push('USD'); // Criptos e Ações Americanas atreladas ao dólar
  }

  const tempoAtual = dataAtual.getTime();

  for (const noticia of noticias) {
    if (moedasDoAtivo.includes(noticia.country)) {
      const tempoNoticia = new Date(noticia.date).getTime();
      const diferencaMinutos = (tempoAtual - tempoNoticia) / (1000 * 60);

      // Bloqueia se estiver dentro da janela de -15 a +15 minutos do evento
      if (diferencaMinutos >= -15 && diferencaMinutos <= 15) {
        return true; 
      }
    }
  }
  return false;
}

// --- FUNÇÕES MATEMÁTICAS E DE MERCADO ---
function isMercadoAberto(ticker: string, dataHora: Date) {
  const dia = dataHora.getDay(); 
  const hora = dataHora.getHours();
  const minuto = dataHora.getMinutes();
  const tempoDecimal = hora + (minuto / 60);

  if (ticker.endsWith('-USD')) return true;

  const isFimDeSemana = (dia === 0 || dia === 6);

  if (ticker.endsWith('=X')) {
    if (dia === 6) return false; 
    if (dia === 5 && tempoDecimal >= 17) return false; 
    if (dia === 0 && tempoDecimal < 18) return false; 
    return true;
  }

  if (ticker.endsWith('.SA')) {
    if (isFimDeSemana) return false;
    if (tempoDecimal < 10 || tempoDecimal >= 17) return false;
    return true;
  }

  if (isFimDeSemana) return false;
  if (tempoDecimal < 10.5 || tempoDecimal >= 17) return false;
  
  return true;
}

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
  let ganhos = 0, perdas = 0;
  for (let i = 1; i < amostra.length; i++) {
    const diferenca = amostra[i].fechamento - amostra[i-1].fechamento;
    if (diferenca > 0) ganhos += diferenca;
    else perdas += Math.abs(diferenca);
  }
  ganhos /= 14;
  perdas /= 14;
  if (perdas === 0) return 100;
  return 100 - (100 / (1 + (ganhos / perdas)));
}

function calcularEMA(velas: any[], periodo: number) {
  if (velas.length < periodo) return null;
  const k = 2 / (periodo + 1);
  let ema = velas[0].fechamento;
  for (let i = 1; i < velas.length; i++) {
    ema = (velas[i].fechamento * k) + (ema * (1 - k));
  }
  return ema;
}

function identificarPadraoCandle(velas: any[]) {
  if (velas.length < 2) return "NENHUM";
  const atual = velas[velas.length - 1];
  const anterior = velas[velas.length - 2];
  const corpoAtual = atual.corpo;
  const tamanhoTotalAtual = atual.maxima - atual.minima;
  
  if (anterior.direcao === "BAIXA" && atual.direcao === "ALTA" && atual.fechamento > anterior.abertura && atual.abertura < anterior.fechamento) {
    return "ENGOLFO_DE_ALTA";
  }
  if (anterior.direcao === "ALTA" && atual.direcao === "BAIXA" && atual.fechamento < anterior.abertura && atual.abertura > anterior.fechamento) {
    return "ENGOLFO_DE_BAIXA";
  }
  if (atual.pavio_inf > corpoAtual * 2 && atual.pavio_sup < corpoAtual * 0.5 && tamanhoTotalAtual > 0) {
    return "MARTELO_REJEICAO_BAIXA";
  }
  if (atual.pavio_sup > corpoAtual * 2 && atual.pavio_inf < corpoAtual * 0.5 && tamanhoTotalAtual > 0) {
    return "ESTRELA_CADENTE_REJEICAO_ALTA";
  }
  return "VELA_NORMAL";
}

// --- INTEGRAÇÃO TELEGRAM ---
async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number, padrao: string) {
  try {
    const supabase = getSupabaseClient();
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

    let ativoFormatado = ativo.endsWith('=X') ? ativo.substring(0, 3) + '/' + ativo.substring(3, 6) : ativo.replace('-', '/');
    const formatadorHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const agora = new Date();
    
    const proximaVela = new Date(agora);
    proximaVela.setMinutes(agora.getMinutes() + (5 - (agora.getMinutes() % 5)));
    proximaVela.setSeconds(0); proximaVela.setMilliseconds(0);
    
    const expiracao = new Date(proximaVela);
    expiracao.setMinutes(expiracao.getMinutes() + 5);

    const { data: insertData, error: dbError } = await supabase
      .from('historico_operacoes')
      .insert([{ ticker: ativo, sinal: iaData.sinal, taxa_entrada: precoAtual, resultado: 'PENDENTE' }])
      .select('id').single();

    if (dbError || !insertData) return;

    const mensagem = `🏆 *SINAL SNIPER (M5 + M15)* 🏆
*Ativo:* ${ativoFormatado}
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA'}
⏰ *Entrada:* ${formatadorHora.format(proximaVela)}
⏳ *Expiração:* ${formatadorHora.format(expiracao)}

📊 *Gatilho Técnico:* ${padrao.replace(/_/g, ' ')}
🔥 *RSI:* ${rsi.toFixed(2)}
🧠 *Análise IA:* ${iaData.motivo}
🎯 *Confiança:* ${iaData.confianca_padrao}`;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, 
        text: mensagem, 
        parse_mode: 'Markdown', 
        reply_markup: { 
          inline_keyboard: [
            [{ text: '✅ WIN', callback_data: `WIN_${insertData.id}` }, { text: '❌ LOSS', callback_data: `LOSS_${insertData.id}` }],
            [{ text: '🗑️ NÃO PEGUEI', callback_data: `DEL_${insertData.id}` }]
          ] 
        } 
      }),
    });
  } catch (error: any) {
    console.error("❌ Erro ao enviar sinal:", error.message);
  }
}

// --- FUNÇÃO PRINCIPAL DO ROBÔ ---
export async function GET(request: Request) {
  console.log("🤖 [CRON SNIPER] Acordou! Verificando bolsas abertas e calendário econômico...");

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
    
    let ativosBrutos = ativosDB.map(a => a.ticker).filter(a => !a.toUpperCase().includes('OTC'));
    
    // 1. Filtro de Horário de Mercado
    const horaSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    let ativosAtivos = ativosBrutos.filter(ativo => isMercadoAberto(ativo, horaSP));

    if (ativosAtivos.length === 0) {
       console.log("💤 Todas as bolsas monitoradas estão fechadas agora.");
       return NextResponse.json({ success: true, mensagem: `Mercados fechados no momento.` });
    }

    // 2. Busca Notícias Globais
    const noticiasAltoImpacto = await buscarNoticiasAltoImpacto();
    console.log(`🌍 Calendário Econômico: ${noticiasAltoImpacto.length} notícias de ALTO impacto agendadas para esta semana.`);
    console.log(`📊 Rastreador ativo em ${ativosAtivos.length} mercados abertos neste momento...`);

    const torneioDeSinais = [];
    const agora = new Date();
    const inicioVelaAtual = new Date(agora);
    inicioVelaAtual.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5));
    inicioVelaAtual.setSeconds(0); inicioVelaAtual.setMilliseconds(0);

    const bloqueioTempo = new Date(agora);
    bloqueioTempo.setMinutes(agora.getMinutes() - 60);
    const cooldownISO = bloqueioTempo.toISOString();

    for (const ativo of ativosAtivos) {
      try {
        // 3. Filtro Sniper de Notícia
        if (ativoAfetadoPorNoticia(ativo, noticiasAltoImpacto, agora)) {
          console.log(`⚠️ [ALERTA] Operações em ${ativo} bloqueadas. Notícia de 3 TOUROS acontecendo agora!`);
          continue; // Pula a análise deste ativo
        }

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

        const exaustaoCompra = rsi5m <= 35 && padraoMicro.includes("ALTA");
        const exaustaoVenda = rsi5m >= 65 && padraoMicro.includes("BAIXA");

        if (exaustaoCompra || exaustaoVenda || padraoMicro !== "VELA_NORMAL") {
          
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
            if (ultimoSinal.resultado === 'LOSS') {
              console.log(`⏸️ [PAUSA] ${ativo} ignorado (LOSS recente em menos de 1h).`);
              continue; 
            }
          }

          const prompt = `Você é o Juiz de um Robô Quantitativo operando Opções Binárias no ativo ${ativo}.
Sua missão é emitir um veredito baseado EXCLUSIVAMENTE nos dados abaixo.

📊 **CENÁRIO TÉCNICO:**
- Tendência (EMA 20 no M15): ${tendenciaMacro}
- Indicador RSI (M5): ${rsi5m.toFixed(2)} (${rsi5m > 65 ? 'SOBRECOMPRADO' : rsi5m < 35 ? 'SOBREVENDIDO' : 'NEUTRO'})
- Price Action (M5): ${padraoMicro}

**REGRAS INQUEBRÁVEIS:**
1. Se a Tendência Macro for ALTA, NUNCA recomende VENDA.
2. Se a Tendência Macro for BAIXA, NUNCA recomende COMPRA.
3. Se os dados forem conflitantes, o sinal deve ser "NEUTRO".
4. Confiança só deve ser maior que 70% se a tendência, o RSI e o padrão apontarem para a mesma direção de forma clara.

Responda EXCLUSIVAMENTE em formato JSON:
{"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo": "Explicação técnica de no máximo 15 palavras."}`;

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

          const ia = JSON.parse((await responseGroq.json()).choices[0].message.content.trim());
          const confiancaNumerica = parseInt(ia.confianca_padrao);

          if ((ia.sinal === 'COMPRA' || ia.sinal === 'VENDA') && confiancaNumerica >= 70) {
            torneioDeSinais.push({ ativo, ia, precoAtual, rsi: rsi5m, padrao: padraoMicro, confianca: confiancaNumerica });
          }
        }
      } catch (e: any) { continue; }
    }

    if (torneioDeSinais.length > 0) {
      torneioDeSinais.sort((a, b) => b.confianca - a.confianca);
      const alvo = torneioDeSinais[0];
      console.log(`🎯 TIRO SNIPER: ${alvo.ativo} (${alvo.confianca}%) - Motivo: ${alvo.ia.motivo}`);
      await enviarSinalTelegram(alvo.ativo, alvo.ia, alvo.precoAtual, alvo.rsi, alvo.padrao);
    } else {
      console.log("🔎 Varredura finalizada. Nenhum ativo atendeu a todos os critérios operacionais simultaneamente.");
    }

    return NextResponse.json({ success: true, mensagem: `Análise finalizada com sucesso.` });
  } catch (error: any) {
    console.error("❌ ERRO CRÍTICO NO CRON:", error.message);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
