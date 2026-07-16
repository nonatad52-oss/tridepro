import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Inicialização do Supabase
const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase ausentes.");
  return createClient(url, key);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Verifica se o que chegou foi um clique em um botão (callback_query)
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const data = callbackQuery.data; // Vai ser "WIN_123" ou "LOSS_123"
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const originalText = callbackQuery.message.text;

      // Separa a ação (WIN/LOSS) do ID da operação no banco
      const [resultado, idOperacao] = data.split('_');

      const supabase = getSupabaseClient();
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

      // 1. Atualiza o resultado da operação no banco de dados
      if (idOperacao) {
        await supabase
          .from('historico_operacoes')
          .update({ resultado: resultado })
          .eq('id', idOperacao);
      }

      // 2. Monta o texto atualizado (Mensagem antiga + Carimbo do resultado)
      const carimbo = resultado === 'WIN' ? '✅ *VITÓRIA (WIN)*' : '❌ *DERROTA (LOSS)*';
      const novoTexto = `${originalText}\n\n🎯 *Resultado:* ${carimbo}`;

      // 3. Edita a mensagem no Telegram (Substitui o texto e SOME com os botões)
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: novoTexto,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] } // Enviar um array vazio aqui é o que faz os botões desaparecerem
        })
      });

      // 4. Responde ao Telegram para parar a animação de "carregando" no botão
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: `Registrado com sucesso: ${resultado}`
        })
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("❌ Erro no webhook do Telegram:", error.message);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
