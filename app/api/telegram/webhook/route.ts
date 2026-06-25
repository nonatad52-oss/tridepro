import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Verifica se a requisição veio de um clique de botão no Telegram
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const data = callbackQuery.data; // Exemplo: "res_WIN_15"
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const textoOriginal = callbackQuery.message.text;

      if (data.startsWith('res_')) {
        const partes = data.split('_');
        const resultado = partes[1]; // 'WIN' ou 'LOSS'
        const idOperacao = partes[2];

        // Conecta ao Supabase e atualiza a operação
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await supabase.from('historico_operacoes').update({ resultado }).eq('id', idOperacao);

        // Edita a mensagem no Telegram: remove os botões e carimba o resultado
        const carimbo = resultado === 'WIN' ? '\n\n🏆 *RESULTADO FINAL: ✅ WIN*' : '\n\n💀 *RESULTADO FINAL: ❌ LOSS*';
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: textoOriginal.replace('👇 *Registre o resultado abaixo:*', '') + carimbo,
            parse_mode: 'Markdown'
          })
        });

        // Informa ao Telegram que o clique foi processado (tira o ícone de relógio do botão)
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro no processamento do Webhook' }, { status: 500 });
  }
}
