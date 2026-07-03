import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60; 
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'chave-temporaria';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'token-temporario';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'id-temporario';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'chave-temporaria';
const CRON_SECRET = process.env.CRON_SECRET || '17a85b09'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('key') !== CRON_SECRET) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { data: ativosDB } = await supabase.from('ativos_global').select('ticker').eq('status', 'ativo');
  if (!ativosDB) return NextResponse.json({ error: "Erro ao buscar ativos no Supabase" });

  const ativos = ativosDB.map(a => a.ticker);
  
  // Vamos testar diretamente o primeiro ativo da lista para capturar o erro global
  const ativoTeste = ativos[0] || 'BTC-USD'; 

  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ativoTeste}?interval=5m&range=1d`);
    const json = await res.json();
    const quote = json.chart?.result?.[0]?.indicators?.quote?.[0];
    
    if (!quote || !quote.close) {
      return NextResponse.json({ success: false, erro: `Yahoo Finance não retornou dados para o ativo de teste: ${ativoTeste}` });
    }

    const blocoVelas = [];
    for (let i = 0; i < quote.close.length; i++) {
      if (quote.close[i] != null) blocoVelas.push({ fechamento: quote.close[i] });
    }

    // 1. Testando a chamada da Inteligência Artificial
    const prompt = `Responda estritamente com este JSON: {"sinal": "COMPRA", "confianca_padrao": "95%"}`;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    let textResponse = "";
    try {
      const resIA = await model.generateContent(prompt);
      textResponse = resIA.response.text();
    } catch (errIA: any) {
      return NextResponse.json({
        success: false,
        fase: "ERRO NA COMINICAÇÃO COM A GEMINI AI",
        detalhes: errIA.message || String(errIA),
        solucao: "Verifique se a sua GEMINI_API_KEY está correta nas variáveis de ambiente da Vercel."
      });
    }

    // 2. Testando a decodificação do JSON
    let iaData;
    try {
      iaData = JSON.parse(textResponse.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (errJson) {
      return NextResponse.json({
        success: false,
        fase: "ERRO AO DECODIFICAR RESPOSTA DA IA",
        resposta_bruta_da_ia: textResponse,
        detalhes: String(errJson)
      });
    }

    // 3. Testando o envio do Telegram
    try {
      const msgTeste = `🚨 *TESTE DE INFRAESTRUTURA*\nAtivo: ${ativoTeste}\nConexão com a IA e Banco de dados: OK!`;
      const resTel = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msgTeste, parse_mode: 'Markdown' }),
      });
      const jsonTel = await resTel.json();
      if (!jsonTel.ok) throw new Error(JSON.stringify(jsonTel));
    } catch (errTel: any) {
      return NextResponse.json({
        success: false,
        fase: "ERRO AO ENVIAR MENSAGEM PARA O TELEGRAM",
        detalhes: errTel.message || String(errTel),
        solucao: "Verifique se o TELEGRAM_BOT_TOKEN e o TELEGRAM_CHAT_ID estão corretos na Vercel."
      });
    }

    return NextResponse.json({ 
      success: true, 
      mensagem: "Todos os sistemas estão integrados! O sinal de teste foi enviado para o Telegram.",
      ativo_usado: ativoTeste
    });

  } catch (e: any) {
    return NextResponse.json({ 
      success: false, 
      fase: "ERRO GERAL INESPERADO", 
      detalhes: e.message || String(e) 
    });
  }
}
