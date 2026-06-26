import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================================
// CONFIGURAÇÕES GERAIS E LIMITES DA VERCEL
// ============================================================================
export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'chave-temporaria-para-build';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'chave-temporaria';
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

async function enviarAvisoTelegram(texto: string) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: texto, parse_mode: 'Markdown' }),
    });
  } catch (e) {
    console.error("Erro ao enviar aviso no Telegram:", e);
  }
}

async function enviarSinalTelegram(ativo: string, iaData: any, precoAtual: number, rsi: number) {
  const { data: insertData, error } = await supabase
    .from('historico_operacoes')
    .insert([{
      ticker: ativo,
      sinal: iaData.sinal,
      taxa_entrada: precoAtual,
      resultado: 'PENDENTE'
    }])
    .select('id')
    .single();

  if (error || !insertData) {
    console.error(`Erro ao salvar ${ativo} no banco:`, error);
    return;
  }

  const mensagem = `
🎯 *SINAL QUANTITATIVO (M5)* 🎯
    
*Ativo:* ${ativo} (Yahoo Finance)
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA (CALL)' : '🔴 VENDA (PUT)'}
*Preço:* ${precoAtual}
*Expiração:* Próxima Vela (5 min)
    
📊 *Métricas:*
_RSI (14):_ ${rsi.toFixed(2)}
_Confiança IA:_ ${iaData.confianca_padrao}
  `;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
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
          ]
        ]
      }
    }),
  });
}

async function verificarLockdown(ativo: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('historico_operacoes')
      .select('resultado, criado_em')
      .eq('ticker', ativo)
      .order('criado_em', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return false;
    return data[0].resultado === 'LOSS';
  } catch (e) {
    return false;
  }
}

function calcularRSI(velas: any[], periodos = 14) {
  if (velas.length < periodos + 1) return 50;
  
  let ganhos = 0;
  let perdas = 0;
  
  for (let i = velas.length - periodos; i < velas.length; i++) {
    const diferenca = velas[i].fechamento - velas[i - 1].fechamento;
    if (diferenca >= 0) ganhos += diferenca;
    else perdas -= diferenca;
  }
  
  const mediaGanhos = ganhos / periodos;
  const mediaPerdas = perdas / periodos;
  
  if (mediaPerdas === 0) return 100;
  const rs = mediaGanhos / mediaPerdas;
  return 100 - (100 / (1 + rs));
}

// ============================================================================
// MOTOR PRINCIPAL (CRON JOB)
// ============================================================================
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const agora = new Date();
    const hora = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit" });
    const minuto = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", minute: "2-digit" });
    const horarioAtual = `${hora}:${minuto}`;

    if (horarioAtual === "21:00") {
      await enviarAvisoTelegram("🌏 *Mercado Asiático Aberto!*\nMonitorando volatilidade inicial via Yahoo Finance...");
    } else if (horarioAtual === "04:00") {
      await enviarAvisoTelegram("🇪🇺 *Mercado Europeu Aberto!*\nBuscando variações de fractais em alta liquidez...");
    } else if (horarioAtual === "10:30") {
      await enviarAvisoTelegram("🇺🇸 *Mercado Americano Aberto!*\nPico máximo de volume real detectado. Varredura adaptativa iniciada...");
    }

    const { data: ativosDB, error: erroDB } = await supabase
      .from('ativos_global')
      .select('ticker')
      .eq('status', 'ativo');

    if (erroDB || !ativosDB || ativosDB.length === 0) {
      return NextResponse.json({ success: true, message: "Nenhum ativo configurado ou ativo no banco." });
    }

    const ativos = ativosDB.map(a => a.ticker);

    for (const ativo of ativos) {
      try {
        if (await verificarLockdown(ativo)) {
          console.log(`[${ativo}] Ignorado: Quarentena de LOSS ativa.`);
          continue;
        }

        // URL pública do Yahoo Finance para gráficos de 5 minutos trazendo o último dia
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativo}?interval=5m&range=1d`);
        if (!res.ok) {
          console.error(`[${ativo}] Falha ao buscar dados na API do Yahoo.`);
          continue;
        }
        
        const json = await res.json();
        const resultadoYahoo = json.chart?.result?.[0];
        if (!resultadoYahoo) continue;

        const timestamps = resultadoYahoo.timestamp || [];
        const quote = resultadoYahoo.indicators?.quote?.[0];
        if (!quote || timestamps.length === 0) continue;

        // Reconstrói e limpa a estrutura de velas tratando os arrays paralelos do Yahoo
        const blocoCompletoVelas: any[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          const o = quote.open[i];
          const h = quote.high[i];
          const l = quote.low[i];
          const c = quote.close[i];

          // Filtra valores nulos comuns em momentos de fechamento/baixa liquidez do Yahoo
          if (o !== null && h !== null && l !== null && c !== null && 
              o !== undefined && h !== undefined && l !== undefined && c !== undefined) {
            blocoCompletoVelas.push({
              abertura: parseFloat(o),
              maxima: parseFloat(h),
              minima: parseFloat(l),
              fechamento: parseFloat(c)
            });
          }
        }

        // Corta para focar estritamente nas últimas 20 velas válidas
        const blocoVelasVálidas = blocoCompletoVelas.slice(-20);
        if (blocoVelasVálidas.length < 15) {
          console.log(`[${ativo}] Histórico insuficiente após filtragem de nulos.`);
          continue;
        }

        const rsiAtual = calcularRSI(blocoVelasVálidas, 14);
        let preSinalMatematico = 'NEUTRO';
        
        if (rsiAtual >= 75) preSinalMatematico = 'VENDA';
        else if (rsiAtual <= 25) preSinalMatematico = 'COMPRA';

        if (preSinalMatematico === 'NEUTRO') continue;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const promptAdaptativo = `
          Você é um algoritmo matemático avançado de trading autônomo.
          O RSI calculou exaustão em ${rsiAtual.toFixed(2)} e predefiniu direção de ${preSinalMatematico} para o ativo ${ativo}.
          
          Analise o histórico cronológico deste bloco com as últimas 20 velas de M5:
          ${JSON.stringify(blocoVelasVálidas)}
          
          Sua missão é tentar autonomamente diferentes comprimentos de combinações recentes (ex: analisar o padrão isolado das últimas 3 velas, 4 velas, 6 velas ou 10 velas). 
          Descubra qual variação possui a maior força estatística para confirmar a reversão e projetar a EXATA PRÓXIMA VELA de 5 minutos.
          
          Retorne estritamente um JSON neste formato (sem markdown ou textos adicionais):
          {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo_fractal": "Sinergia estrutural encontrada."}
          
          SÓ confirme o sinal se encontrar uma variação com probabilidade real superior a 85% para a próxima vela. Caso contrário, saia como NEUTRO.
        `;

        const result = await model.generateContent(promptAdaptativo);
        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const iaData = JSON.parse(responseText);
        
        const confiancaNumero = parseInt(iaData.confianca_padrao.replace('%', ''));

        if (iaData.sinal === preSinalMatematico && confiancaNumero >= 85) {
          // Pega o fechamento da última vela disponível como preço atual
          const ultimoPreco = blocoVelasVálidas[blocoVelasVálidas.length - 1].fechamento;
          await enviarSinalTelegram(ativo, iaData, ultimoPreco, rsiAtual);
        }
        
      } catch (erroAtivo) {
        console.error(`[${ativo}] Erro processando ativo de forma isolada:`, erroAtivo);
      }
    }

    return NextResponse.json({ success: true, message: "Varredura Autônoma Concluída com Sucesso." });

  } catch (error) {
    console.error("Erro crítico no motor principal:", error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
