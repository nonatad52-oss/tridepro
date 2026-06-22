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
    `⏱ *Expiração:* ${sinal.tempo_expiracao} Minutos`;

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

// 2. MOTOR DE ANÁLISE QUANTITATIVA
export async function GET(request: Request) {
  try {
    // A conexão com o Supabase agora fica AQUI DENTRO (Protegida do erro de Build da Vercel)
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
      // Simulação inicial de detecção da IA
      const padraoDetectado = true; 

      if (padraoDetectado) {
        const sinalDaIA = {
          ticker: ativo.ticker,
          direcao: 'COMPRA',
          horario_entrada: new Date(Date.now() + 5 * 60000).toISOString(),
          tempo_expiracao: 5,
          assertividade_passada: 85.50
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
