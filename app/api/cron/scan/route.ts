export const dynamic = 'force-dynamic'; 

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 1. FUNÇÃO DO TELEGRAM
async function dispararTelegram(sinal: any) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const data = new Date(sinal.horario_entrada);
  const horaFormatada = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const textoMensagem = `🚨 *ENTRADA ${sinal.direcao}*\n\n` +
    `🎯 *Ativo:* ${sinal.ticker}\n` +
    `⏳ *Entrada:* ${horaFormatada}\n` +
    `⏱ *Expiração:* ${sinal.tempo_expiracao} Minutos\n` +
    `🤖 *Análise:* Confirmada via Groq LLM`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: textoMensagem,
      parse_mode: 'Markdown'
    })
  });
}

// 2. FUNÇÃO DA INTELIGÊNCIA ARTIFICIAL (GROQ)
async function analisarComGroq(ticker: string, historico: any[]) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return null;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: 'És um especialista em análise quantitativa de mercados financeiros. Analisa o histórico fornecido e responde EXCLUSIVAMENTE com um objeto JSON no seguinte formato: {"sinal": "COMPRA" ou "VENDA" ou "AGUARDAR", "assertividade": 85.5}'
          },
          {
            role: 'user',
            content: `Analisa o ativo ${ticker}. Histórico recente de operações: ${JSON.stringify(historico)}`
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const result = await response.json();
    const dadosIA = JSON.parse(result.choices[0].message.content);
    return dadosIA;
  } catch (e) {
    console.error("Erro na chamada do Groq:", e);
    return null;
  }
}

// 3. MOTOR DE ANÁLISE QUANTITATIVA
export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Credenciais do Supabase ausentes." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: ativos, error } = await supabase
      .from('ativos_monitorados')
      .select('ticker, categoria')
      .eq('status_ativo', true);

    if (error || !ativos || ativos.length === 0) {
      return NextResponse.json({ message: 'Nenhum ativo selecionado para monitoramento.' });
    }

    for (const ativo of ativos) {
      // Puxa o histórico de feedbacks armazenado no Supabase para injetar no Groq
      const { data: historicoTrader } = await supabase
        .from('historico_sinais')
        .select('direcao, resultado_real')
        .eq('ticker', ativo.ticker)
        .not('resultado_real', 'eq', 'PENDENTE')
        .order('created_at', { ascending: false })
        .limit(20);

      // Executa a análise inteligente com o Groq
      const analiseIA = await analisarComGroq(ativo.ticker, historicoTrader || []);

      // Se o Groq detetar uma oportunidade real de Compra ou Venda
      if (analiseIA && (analiseIA.sinal === 'COMPRA' || analiseIA.sinal === 'VENDA')) {
        const sinalDaIA = {
          ticker: ativo.ticker,
          direcao: analiseIA.sinal,
          horario_entrada: new Date(Date.now() + 5 * 60000).toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: analiseIA.assertividade || 80.0
        };

        const { data: novoSinal } = await supabase
          .from('historico_sinais')
          .insert([sinalDaIA])
          .select()
          .single();

        if (novoSinal) {
          await dispararTelegram(novoSinal);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
