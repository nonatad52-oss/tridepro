export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// 1. FUNÇÃO DE DISPARO PARA O TELEGRAM
async function dispararTelegram(sinal: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("Configurações do Telegram ausentes.");
    return;
  }

  const horarioFormatado = new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });

  const icone = sinal.direcao === 'COMPRA' ? '🟢 COMPRA' : '🔴 VENDA';

  const mensagem = `
🚨 **SINAL DE TESTE FORÇADO** 🚨

📊 **Ativo:** ${sinal.ticker}
⏱️ **Timeframe:** M${sinal.tempo_expiracao}
⚡ **Operação:** ${icone}
⏳ **Entrada:** ${horarioFormatado}

🤖 *Este é um teste de sistema para validar a conexão.*
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

// 2. FUNÇÃO QUE CONVERSA COM A IA DO GROQ (Mantida aqui para usarmos depois)
async function analisarComGroq(ticker: string, historico: any[], apiKey: string) {
  try {
    const prompt = `...`; // Resumido para o teste, pois não será chamado agora
    return { sinal: 'AGUARDAR', assertividade: 0 };
  } catch (error) {
    return { sinal: 'AGUARDAR', assertividade: 0 };
  }
}

// 3. MOTOR PRINCIPAL
export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Credenciais do Supabase ausentes." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: ativos, error: erroAtivos } = await supabase
      .from('ativos_monitorados')
      .select('*')
      .eq('status_ativo', true);

    if (erroAtivos) throw erroAtivos;

    if (!ativos || ativos.length === 0) {
      return NextResponse.json({ message: "Nenhum ativo selecionado. Vá ao Supabase e ative os ativos mudando status_ativo para true." }, { status: 200 });
    }

    for (const ativo of ativos) {
      
      // =================================================================
      // TESTE FORÇADO: Ignora a análise do Groq temporariamente
      // =================================================================
      const analiseIA = { sinal: 'COMPRA', assertividade: 99.9 }; 
      
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
        }
      }
      
      // O código roda apenas 1 vez (para o primeiro ativo) e já para, para não encher de mensagens repetidas no teste
      break; 
    }

    return NextResponse.json({ success: true, aviso: "TESTE FORÇADO EXECUTADO COM SUCESSO", timestamp: new Date().toISOString() });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
