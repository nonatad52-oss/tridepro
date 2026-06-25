export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

// ==========================================
// 🧮 MOTOR MATEMÁTICO PROPRIETÁRIO (NÚCLEO QUANT)
// ==========================================

function calcularLinhaEMA(precos: number[], periodos: number): number[] {
  const k = 2 / (periodos + 1);
  let ema = [precos[0]];
  for (let i = 1; i < precos.length; i++) ema.push(precos[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcularRSI(precos: number[], periodos = 14) {
  if (precos.length < periodos + 1) return 50;
  let ganhos = 0; let perdas = 0;
  for (let i = precos.length - periodos; i < precos.length; i++) {
    const dif = precos[i] - precos[i - 1];
    if (dif >= 0) ganhos += dif; else perdas -= dif;
  }
  const rs = (ganhos / periodos) / (perdas / periodos || 1);
  return 100 - (100 / (1 + rs));
}

// PILAR 1: MEDIDOR DE ACELERAÇÃO E EXAUSTÃO DA VELOCIDADE
function calcularMétricasAceleração(fechamentos: number[]) {
  if (fechamentos.length < 5) return { aceleracaoCurta: 0, desvioVelocidade: false };
  
  const atual = fechamentos[fechamentos.length - 1];
  const anterior1 = fechamentos[fechamentos.length - 2];
  const anterior3 = fechamentos[fechamentos.length - 4];

  // Variação percentual imediata (Momento)
  const varizacao1Vela = ((atual - anterior1) / anterior1) * 100;
  const variacao3Velas = ((atual - anterior3) / anterior3) * 100;

  // Se o preço moveu mais na última vela do que nas 3 anteriores combinadas, temos uma anomalia de aceleração (Esticada)
  const desvioVelocidade = Math.abs(varizacao1Vela) > Math.abs(variacao3Velas) * 1.5;

  return {
    aceleracaoCurta: Number(varizacao1Vela.toFixed(4)),
    desvioVelocidade
  };
}

// PILAR 2: SISTEMA DE PONTUAÇÃO DE ESTRESSE (ANOMALIAS DE MERCADO)
function calcularStressScore(fechamentos: number[], rsi: number, precoAtual: number, ema21: number) {
  let score = 0;

  // 1. Distância Crítica da Média (Reversão à Média)
  const distanciaMedia = ((precoAtual - ema21) / ema21) * 100;
  if (Math.abs(distanciaMedia) > 0.35) score += 35; // Preço muito esticado longe da média central
  else if (Math.abs(distanciaMedia) > 0.20) score += 20;

  // 2. Extremos do RSI Customizado
  if (rsi > 75 || rsi < 25) score += 35; // Níveis severos de sobrecompra/sobrevenda
  else if (rsi > 68 || rsi < 32) score += 15;

  // 3. Validação de Velocidade Atípica
  const { desvioVelocidade } = calcularMétricasAceleração(fechamentos);
  if (desvioVelocidade) score += 30; // Movimento parabólico sem base sólida (Exaustão iminente)

  return {
    scoreTotal: score,
    distanciaMedia: distanciaMedia.toFixed(4),
    desvioVelocidade
  };
}

// ==========================================
// 🛡️ PILAR 4: TRAVA DE AUTO-APRENDIZADO E MEMÓRIA DE LOSS
// ==========================================
async function verificarBloqueioPorLoss(supabase: any, ticker: string): Promise<boolean> {
  try {
    const tresHorasAtras = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    
    const { data: ultimasOperacoes } = await supabase
      .from('historico_operacoes')
      .select('resultado')
      .eq('ticker', ticker)
      .gt('criado_em', tresHorasAtras)
      .order('criado_em', { ascending: false })
      .limit(2);

    if (ultimasOperacoes && ultimasOperacoes.length >= 2) {
      const todosLoss = ultimasOperacoes.every((op: any) => op.resultado === 'LOSS');
      if (todosLoss) return true; // Ativo bloqueado: tomou 2 losses seguidos nas últimas 3 horas
    }
    return false;
  } catch (error) {
    // Se a tabela ainda não existir, o bot continua operando normalmente sem quebrar
    return false;
  }
}

async function registrarOperacaoNoBanco(supabase: any, ticker: string, sinal: string, taxa: number) {
  try {
    await supabase.from('historico_operacoes').insert([{
      ticker,
      sinal,
      taxa_entrada: taxa,
      resultado: 'PENDENTE',
      criado_em: new Date().toISOString()
    }]);
  } catch (e) { /* Silencioso */ }
}

// ==========================================
// 👁️ PILAR 3: AUDITORIA COGNITIVA DA IA (GROQ)
// ==========================================
async function auditoriaIA(ticker: string, mkt: any, stress: any) {
  try {
    const prompt = `
      [RELATÓRIO DE ESTRESSE QUANT - AUDITORIA DE RISCO]
      Ativo: ${ticker}
      Preço Atual: ${mkt.precoAtual}
      Score de Estresse Matemático: ${stress.scoreTotal}/100
      Distância da Média Central (EMA21): ${stress.distanciaMedia}%
      Aceleração da Última Vela: ${mkt.aceleracao}%
      RSI de Resiliência: ${mkt.rsi}
      Desvio de Velocidade Histórica Detetado? ${stress.desvioVelocidade ? 'SIM' : 'NÃO'}

      TAREFA AUDITORA EXCLUSIVA:
      A matemática do sistema indica anomalia severa no preço. Como auditor de mercado de Opções Binárias (M5), decida se este movimento configura um esgotamento real (reversão iminente) ou um rompimento com força institucional.
      
      CRITÉRIOS DE REJEIÇÃO:
      - Se o Score de Estresse for menor que 65, force "AGUARDAR".
      - Se a aceleração for violenta de forma contínua sem desvio brusco, force "AGUARDAR" (Tendência forte).

      Retorne RESTRITAMENTE um objeto JSON válido:
      {"sinal": "COMPRA"|"VENDA"|"AGUARDAR", "confianca": number, "justificativa_metrica": "Breve frase do motivo técnico do clique"}
    `;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: "llama3-70b-8192", 
        messages: [{ role: "user", content: prompt }], 
        response_format: { type: "json_object" },
        temperature: 0.15 // Rigidez analítica, focado em lógica estruturada
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) { return { sinal: "AGUARDAR", confianca: 0 }; }
}

// ==========================================
// 🚀 ORQUESTRADOR PRINCIPAL DO CRON
// ==========================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== process.env.CRON_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ativos } = await supabase.from('ativos_global').select('*').eq('status_ativo', true);

  if (!ativos || ativos.length === 0) return NextResponse.json({ success: true });

  // Agendamento milimétrico com 5 minutos de antecedência pré-calculados
  const dataEntrada = new Date();
  dataEntrada.setMinutes(dataEntrada.getMinutes() + 5);
  const horaSinalizada = dataEntrada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

  for (const ativo of ativos) {
    try {
      // Pilar 4: Verifica se o ativo não está de "castigo" por falhar recentemente
      const bloqueado = await verificarBloqueioPorLoss(supabase, ativo.ticker);
      if (bloqueado) continue;

      // Coleta histórica de dados do ativo
      const diasAtras = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      // @ts-ignore
      const historical = await yahooFinance.historical(ativo.ticker, { period1: diasAtras });
      // @ts-ignore
      const quote = await yahooFinance.quote(ativo.ticker);

      const fechamentos = historical.map(dia => Number(dia.close));
      const precoAtual = quote.regularMarketPrice || fechamentos[fechamentos.length - 1];

      // Processamento quantitativo nativo (Sem bibliotecas instáveis)
      const rsi = calcularRSI(fechamentos, 14);
      const ema21 = calcularLinhaEMA(fechamentos, 21).pop() || precoAtual;
      const metricsAcel = calcularMétricasAceleração(fechamentos);

      // Executa o motor de Scoring do Super Analisador
      const stress = calcularStressScore(fechamentos, rsi, precoAtual, ema21);

      // GATILHO DE ATIVAÇÃO DA IA: O ativo precisa estar sob forte anomalia (> 60 de estresse)
      if (stress.scoreTotal < 60) continue;

      const dadosMercado = {
        precoAtual,
        rsi: rsi.toFixed(2),
        aceleracao: metricsAcel.aceleracaoCurta
      };

      // IA entra em cena como Auditora do laudo matemático
      const auditoria = await auditoriaIA(ativo.ticker, dadosMercado, stress);
      
      if (auditoria.sinal === "AGUARDAR" || auditoria.confianca < 75) continue;

      const direcaoSinal = auditoria.sinal === 'COMPRA' ? '🟢 CALL (COMPRA)' : '🔴 PUT (VENDA)';
      const tagAtivo = ativo.ticker.replace('-','_').replace('=','_');

      // Dispara o sinal cirúrgico direto no Telegram com antecedência clara
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `⚡ *SUPER ANALISADOR QUANT*\n\n📈 *Ativo:* #${tagAtivo}\n🎯 *Operação:* ${direcaoSinal}\n⏰ *Entrada:* ${horaSinalizada}\n⏳ *Expiração:* 5 Minutos\n🎯 *Taxa de Alerta:* $${precoAtual}\n\n📊 *Métricas do Clique:*\n🔥 *Confiança:* ${auditoria.confianca}%\n🧬 *Estresse do Preço:* ${stress.scoreTotal}/100\n🌐 *Análise:* _${auditoria.justificativa_metrica}_`,
          parse_mode: 'Markdown'
        })
      });

      // Grava o sinal para fins de auto-aprendizado futuro
      await registrarOperacaoNoBanco(supabase, ativo.ticker, auditoria.sinal, precoAtual);

    } catch (error) {
      continue; // Falha em um ativo isolado não desestabiliza ou para a varredura dos outros ativos
    }
  }

  return NextResponse.json({ success: true });
}
