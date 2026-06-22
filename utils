// app/utils/telegram.ts

// Função auxiliar para formatar a hora (Ex: 11:30)
function formatarHora(dataString: string) {
  const data = new Date(dataString);
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function dispararTelegram(sinal: any) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  
  // Se não houver as chaves do Telegram configuradas, ele cancela o envio
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  // Montando a mensagem exatamente como exigido no manual
  const textoMensagem = `🚨 *ENTRADA ${sinal.direcao}*\n\n` +
    `🎯 *Ativo:* ${sinal.ticker}\n` +
    `⏳ *Entrada:* ${formatarHora(sinal.horario_entrada)}\n` +
    `⏱ *Expiração:* ${sinal.tempo_expiracao} Minutos`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  // Disparando a requisição para o Telegram
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: textoMensagem,
      parse_mode: 'Markdown'
    })
  });
}
