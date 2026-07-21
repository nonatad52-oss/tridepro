import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const getSupabaseClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Credenciais do Supabase ausentes.");
  return createClient(url, key);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

    // Verifica se a requisição veio de um clique de botão (Callback Query)
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const data = callbackQuery.data; // Ex: 'WIN_123', 'LOSS_123' ou 'DEL_123'
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const textoOriginal = callbackQuery.message.text;

      const partes = data.split('_');
      const acao = partes[0]; // 'WIN', 'LOSS' ou 'DEL'
      const idOperacao = partes[1];

      const supabase = getSupabaseClient();
      let textoAtualizado = textoOriginal;

      if (acao === 'WIN' || acao === 'LOSS') {
        // 1. Atualiza no Banco de Dados
        await supabase
          .from('historico_operacoes')
          .update({ resultado: acao })
          .eq('id', idOperacao);

        const icone = acao === 'WIN' ? '✅' : '❌';
        textoAtualizado = `${textoOriginal}\n\n${icone} *RESULTADO REGISTRADO: ${acao}*`;

      } else if (acao === 'DEL') {
        // 2. Apaga do Banco de Dados para não sujar a IA
        await supabase
          .from('historico_operacoes')
          .delete()
          .eq('id', idOperacao);

        textoAtualizado = `${textoOriginal}\n\n🗑️ *SINAL IGNORADO E APAGADO DO SISTEMA.*`;
      }

      // 3. Edita a mensagem no Telegram removendo os botões (reply_markup vazio)
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: textoAtualizado,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] } 
        }),
      });

      // 4. Responde ao Telegram para fechar a requisição (tira o reloginho do botão)
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id })
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Erro no Webhook:", error);
    // Sempre retorne 200 pro Telegram, senão ele fica tentando reenviar a notificação para sempre
    return NextResponse.json({ error: error.message }, { status: 200 }); 
  }
}
