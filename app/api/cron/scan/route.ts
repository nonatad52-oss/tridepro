import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ============================================================================
// CONFIGURAÇÕES GERAIS E LIMITES DA VERCEL
// ============================================================================
export const maxDuration = 60; // 60 segundos para a IA processar a análise
export const dynamic = 'force-dynamic';

// Variáveis de Ambiente
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET; 

// Inicialização dos Clientes
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

// 1. Enviar Aviso de Mercado
async function enviarAvisoTelegram(texto: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: texto,
      parse_mode: 'Markdown',
    }),
  });
}

// 2. Enviar Sinal Híbrido (Com Botões)
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
🎯 *SINAL DE ALTA PRECISÃO (M5)* 🎯
    
*Ativo:* ${ativo} (Mercado Aberto)
*Ação:* ${iaData.sinal === 'COMPRA' ? '🟢 COMPRA (CALL)' : '🔴 VENDA (PUT)'}
*Preço de Entrada:* ${precoAtual}
*Expiração:* Próxima Vela (5 minutos)
    
📊 *Guardião Matemático:*
_Exaustão RSI (14):_ ${rsi.toFixed(2)}

🧠 *Auditoria da IA (Fractal 5 Velas):*
_Probabilidade (Próxima Vela):_ ${iaData.confianca_padrao}
_Justificativa:_ ${iaData.motivo_fractal}
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

// 3. Verificar Lockdown (Trava de Segurança Pós-Loss)
async function verificarLockdown(ativo: string): Promise<boolean> {
  const { data } = await supabase
    .from('historico_operacoes')
    .select('resultado, criado_em')
    .eq('ticker', ativo)
    .order('criado_em', { ascending: false })
    .limit(1); // Olha apenas a última operação

  if (!data || data.length === 0) return false;
  
  if (data[0].resultado === 'LOSS') {
    return true; // Bloqueia o ativo se a última entrada foi Loss
  }
  return false;
}

// 4. Cálculo do Indicador RSI
function calcularRSI(velas: any[], periodos = 14) {
  if (velas.length < periodos + 1) return 50;
  let ganhos = 0, perdas = 0;
  
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
    // 1. Verificação da Chave
    const { searchParams } = new URL(request.url);
    if (searchParams.get('key') !== CRON_SECRET) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Alertas de Abertura de Mercado
    const agora = new Date();
    const hora = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit" });
    const minuto = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", minute: "2-digit" });
    const horarioAtual = `${hora}:${minuto}`;

    if (horarioAtual === "21:00") {
      await enviarAvisoTelegram("🌏 *Mercado Asiático Aberto!*\nAnalisando volatilidade inicial...");
    } else if (horarioAtual === "04:00") {
      await enviarAvisoTelegram("🇪🇺 *Mercado Europeu Aberto!*\nBuscando padrões institucionais de alto volume...");
    } else if (horarioAtual === "10:30") {
      await enviarAvisoTelegram("🇺🇸 *Mercado Americano Aberto!*\nPico de volatilidade detectado. Varredura agressiva iniciada...");
    }

    // 3. Buscar Ativos da Tabela Global (Apenas ativos do mercado real)
    const { data: ativosDB, error: erroDB } = await supabase
      .from('ativos_global')
      .select('ticker')
      .eq('status', 'ativo');

    if (erroDB || !ativosDB || ativosDB.length === 0) {
      return NextResponse.json({ success: true, message: "Nenhum ativo listado ou ativo no banco." });
    }

    const ativos = ativosDB.map(a => a.ticker);

    // 4. Iniciar Varredura Híbrida
    for (const ativo of ativos) {
      if (await verificarLockdown(ativo)) {
        console.log(`[${ativo}] Ignorado: Quarentena de LOSS ativada.`);
        continue;
      }

      // Busca 20 velas de 5 minutos na Binance
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${ativo}&interval=5m&limit=20`);
      if (!res.ok) continue;
      
      const dadosBrutos = await res.json();
      const velasMatematica = dadosBrutos.map((c: any) => ({ fechamento: parseFloat(c[4]) }));
      
      // Isola apenas as últimas 5 velas para a IA analisar
      const ultimas5Velas = dadosBrutos.slice(-5).map((c: any) => ({
        abertura: parseFloat(c[1]), maxima: parseFloat(c[2]), minima: parseFloat(c[3]), fechamento: parseFloat(c[4])
      }));

      // AVALIAÇÃO 1: MATEMÁTICA (RSI Exaustão)
      const rsiAtual = calcularRSI(velasMatematica, 14);
      let preSinalMatematico = 'NEUTRO';
      
      if (rsiAtual >= 75) preSinalMatematico = 'VENDA'; // Muito sobrecomprado
      else if (rsiAtual <= 25) preSinalMatematico = 'COMPRA'; // Muito sobrevendido

      if (preSinalMatematico === 'NEUTRO') continue; // Pula se não houver exaustão

      // AVALIAÇÃO 2: AUDITORIA DA IA
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const promptHibrido = `
        O indicador RSI detectou exaustão extrema (${rsiAtual.toFixed(2)}) e sugere ${preSinalMatematico} para ${ativo}.
        
        Você é um algoritmo Quant. Analise estas últimas 5 velas de 5 minutos:
        ${JSON.stringify(ultimas5Velas)}
        
        Regra:
        1. Projeção Imediata: Baseado na geometria deste fractal, qual é o comportamento estatístico da EXATA PRÓXIMA VELA de 5 minutos?
        
        Retorne estritamente um JSON neste formato:
        {"sinal": "COMPRA" | "VENDA" | "NEUTRO", "confianca_padrao": "XX%", "motivo_fractal": "Sinergia exata encontrada..."}
        
        SÓ valide o sinal se concordar com a indicação da matemática (${preSinalMatematico}) E a probabilidade de acerto na próxima vela for maior que 85%.
      `;

      try {
        const result = await model.generateContent(promptHibrido);
        const responseText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const iaData = JSON.parse(responseText);
        
        const confiancaNumero = parseInt(iaData.confianca_padrao.replace('%', ''));

        // Sinergia alcançada: Matemática + IA
        if (iaData.sinal === preSinalMatematico && confiancaNumero >= 85) {
          console.log(`[${ativo}] SINAL VALIDADO: RSI ${rsiAtual.toFixed(2)} + IA ${iaData.confianca_padrao}`);
          await enviarSinalTelegram(ativo, iaData, ultimas5Velas[4].fechamento, rsiAtual);
        } else {
          console.log(`[${ativo}] Descartado pela IA. Confiança: ${iaData.confianca_padrao}`);
        }
      } catch (e) {
        console.error(`[${ativo}] Erro ao ler resposta da IA. Ignorando.`);
      }
    }

    return NextResponse.json({ success: true, message: "Varredura Concluída." });

  } catch (error) {
    console.error("Erro geral no sistema:", error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
