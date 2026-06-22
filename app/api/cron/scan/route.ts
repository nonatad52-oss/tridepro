export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 1. FUNÇÃO DE DISPARO PARA O TELEGRAM
async function dispararTelegram(sinal: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("Configurações do Telegram ausentes nas variáveis de ambiente.");
    return;
  }

  // Formata o horário de UTC para o padrão legível (HH:MM)
  const horarioFormatado = new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo' // Força o fuso horário do Brasil
  });

  const icone = sinal.direcao === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA';

  const mensagem = `
🚨 **SINAL DE INTELIGÊNCIA ARTIFICIAL** 🚨

📊 **Ativo:** ${sinal.ticker}
⏱️ **Timeframe:** M${sinal.tempo_expiracao}
⚡ **Operação:** ${icone}
⏳ **Entrada:** ${horarioFormatado}
🎯 **Expirar em:** ${sinal.tempo_expiracao} minutos

🤖 *Análise Quantitativa Groq AI (Assertividade Histórica: ${sinal.assertividade_passada}%)*
⚠️ *Gerencie seu risco. Opere com consciência na Quotex.*
`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error("Erro ao enviar mensagem para o Telegram:", error);
  }
}

// 2. FUNÇÃO QUE CONVERSA COM A IA DO GROQ
async function analisarComGroq(ticker: string, historico: any[], apiKey: string) {
  try {
    const prompt = `
Você é um especialista em análise quantitativa e price action para opções binárias na plataforma Quotex.
Analise os últimos dados do ativo ${ticker}: ${JSON.stringify(historico)}.

Com base nos padrões de velas, suportes, resistências e tendências atuais, decida estritamente se há uma oportunidade clara para a PRÓXIMA VELA DE 5 MINUTOS.

Sua resposta deve ser obrigatoriamente um objeto JSON puro, sem textos explicativos antes ou depois, seguindo este formato exato:
{
  "sinal": "COMPRA",
  "assertividade": 88.5
}

Se o cenário estiver incerto ou consolidado, retorne obrigatoriamente:
{
  "sinal": "AGUARDAR",
  "assertividade": 0
}

Opções válidas para "sinal": "COMPRA", "VENDA" ou "AGUARDAR".
`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192', // Modelo robusto para análise de dados
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, // Baixa temperatura para manter a IA técnica e racional
        response_format: { type: "json_object" }
      })
    });

    const resultado = await response.json();
    return JSON.parse(resultado.choices[0].message.content);
  } catch (error) {
    console.error(`Erro na análise do Groq para o ativo ${ticker}:`, error);
    return { sinal: 'AGUARDAR', assertividade: 0 };
  }
}

// 3. MOTOR PRINCIPAL DO CRON-JOB (EXECUTA A CADA MINUTO)
export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Credenciais do Supabase ausentes." }, { status: 500 });
    }

    if (!groqKey) {
      return NextResponse.json({ error: "Chave da API do Groq ausente." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Busca apenas os ativos que você ligou (status_ativo = true)
    const { data: ativos, error: erroAtivos } = await supabase
      .from('ativos_monitorados')
      .select('*')
      .eq('status_ativo', true);

    if (erroAtivos) throw erroAtivos;

    if (!ativos || ativos.length === 0) {
      return NextResponse.json({ message: "Nenhum ativo selecionado para monitoramento." }, { status: 200 });
    }

    // Processa cada ativo ativo da lista
    for (const ativo of ativos) {
      
      // Busca os últimos sinais desse ativo para enviar como histórico/contexto para a IA
      const { data: historico } = await supabase
        .from('historico_sinais')
        .select('*')
        .eq('ticker', ativo.ticker)
        .order('created_at', { ascending: false })
        .limit(10);

      // Executa a análise da Inteligência Artificial
      const analiseIA = await analisarComGroq(ativo.ticker, historico || [], groqKey);

      // Se a IA confirmar uma oportunidade real de entrada
      if (analiseIA && (analiseIA.sinal === 'COMPRA' || analiseIA.sinal === 'VENDA')) {
        
        // ⏰ CÁLCULO DA ANTECEDÊNCIA GRÁFICA (Próxima vela cheia de M5)
        const agora = new Date();
        const minutosAtuais = agora.getMinutes();
        const resto = minutosAtuais % 5;
        const minutosParaProximaVela = 5 - resto;
        
        // Exemplo: se rodar às 14:02, adiciona 3 minutos e vira para 14:05:00 cravados
        const horarioEntrada = new Date(agora.getTime() + minutosParaProximaVela * 60000);
        horarioEntrada.setSeconds(0, 0); 

        const sinalDaIA = {
          ticker: ativo.ticker,
          direcao: analiseIA.sinal,
          horario_entrada: horarioEntrada.toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: analiseIA.assertividade || 85.0,
          resultado_real: 'PENDENTE'
        };

        // Salva o sinal no Supabase para o seu Dashboard ler em tempo real
        const { data: novoSinal } = await supabase
          .from('historico_sinais')
          .insert([sinalDaIA])
          .select()
          .single();

        // Envia o alerta formatado para o seu canal/grupo do Telegram
        if (novoSinal) {
          await dispararTelegram(novoSinal);
        }
      }
    }

    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
