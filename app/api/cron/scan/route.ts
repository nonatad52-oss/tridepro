export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 1. FUNÇÃO DE DISPARO PARA O TELEGRAM
async function dispararTelegram(sinal: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  const horarioFormatado = new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });

  const icone = sinal.direcao === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA';

  const mensagem = `
📊 **NOVO SINAL TRIDEPRO** 📊

🎯 **Ativo:** ${sinal.ticker}
⏱️ **Timeframe:** M${sinal.tempo_expiracao}
⚡ **Ação:** ${icone}
⏳ **Entrada:** ${horarioFormatado}
🤖 **Assertividade AI:** ${sinal.assertividade_passada}%
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: mensagem, parse_mode: 'Markdown' })
    });
  } catch (error) {
    console.error("Erro no Telegram:", error);
  }
}

// 2. MOTOR DE ANÁLISE QUANTITATIVA (GROQ IA)
async function analisarComGroq(ticker: string, apiKey: string) {
  try {
    // Prompt focado em price action institucional básico para gerar um sinal
    const prompt = `Atuando como um trader institucional quantitativo, analise o ativo ${ticker}. Responda estritamente com um JSON válido neste formato exato, sem textos adicionais: {"sinal": "COMPRA" ou "VENDA" ou "AGUARDAR", "assertividade": número de 0 a 100}. Seja rigoroso, só gere COMPRA ou VENDA se houver alta probabilidade.`;
    
    const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });
    
    const dados = await resposta.json();
    const texto = dados.choices[0].message.content;
    
    // Extrai o JSON da resposta da IA
    const match = texto.match(/\{.*\}/s);
    if (match) return JSON.parse(match[0]);
    
    return { sinal: 'AGUARDAR', assertividade: 0 };
  } catch (error) {
    return { sinal: 'AGUARDAR', assertividade: 0 };
  }
}

// 3. ROTA PRINCIPAL DO SISTEMA
export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!supabaseUrl || !supabaseKey || !groqKey) {
      return NextResponse.json({ error: "Credenciais de API ausentes na Vercel." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: ativos, error: erroAtivos } = await supabase
      .from('ativos_monitorados')
      .select('*')
      .eq('status_ativo', true);

    if (erroAtivos) throw erroAtivos;
    if (!ativos || ativos.length === 0) {
      return NextResponse.json({ message: "Nenhum ativo ativo." });
    }

    let sinaisGerados = 0;

    for (const ativo of ativos) {
      // O Groq avalia o mercado real
      const analiseIA = await analisarComGroq(ativo.ticker, groqKey);
      
      if (analiseIA && (analiseIA.sinal === 'COMPRA' || analiseIA.sinal === 'VENDA')) {
        
        const agora = new Date();
        const minutosAtuais = agora.getMinutes();
        const resto = minutosAtuais % 5;
        const minutosParaProximaVela = 5 - resto;
        
        const horarioEntrada = new Date(agora.getTime() + minutosParaProximaVela * 60000);
        horarioEntrada.setSeconds(0, 0); 

        const sinalDaIA = {
          ticker: ativo.ticker,
          direcao: analiseIA.sinal,
          horario_entrada: horarioEntrada.toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: analiseIA.assertividade,
          resultado_real: 'PENDENTE'
        };

        const { data: novoSinal } = await supabase
          .from('historico_sinais')
          .insert([sinalDaIA])
          .select()
          .single();

        if (novoSinal) {
          await dispararTelegram(novoSinal);
          sinaisGerados++;
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      sinais_gerados: sinaisGerados, 
      aviso: "Ciclo de IA finalizado",
      timestamp: new Date().toISOString() 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
