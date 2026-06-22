// app/api/cron/scan/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { dispararTelegram } from '../../../../utils/telegram';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    // 1. Busca no Supabase quais ativos estão ativados para análise
    const { data: ativos, error } = await supabase
      .from('ativos_monitorados')
      .select('ticker, categoria')
      .eq('status_ativo', true);

    if (error || !ativos || ativos.length === 0) {
      return NextResponse.json({ message: 'Nenhum ativo selecionado para monitoramento.' });
    }

    // Loop interno para processar cada ativo ativado
    for (const ativo of ativos) {
      // Nota: As funções de busca de mercado e Groq serão conectadas aqui.
      // Para testes iniciais da infraestrutura, simulamos a detecção de um padrão.
      const padraoDetectado = true;

      if (padraoDetectado) {
        // Puxa o histórico de feedbacks do usuário armazenado no Supabase para injetar na IA
        const { data: historicoTrader } = await supabase
          .from('historico_sinais')
          .select('direcao, resultado_real')
          .eq('ticker', ativo.ticker)
          .not('resultado_real', 'eq', 'PENDENTE')
          .order('created_at', { ascending: false })
          .limit(20);

        // Dispara a chamada de ultra-velocidade para o Groq LLM (Simulação para teste estrutural)
        const sinalDaIA = {
          ticker: ativo.ticker,
          direcao: 'COMPRA',
          horario_entrada: new Date(Date.now() + 5 * 60000).toISOString(), // T+5 minutos de antecedência
          tempo_expiracao: 5,
          assertividade_passada: 85.50
        };

        if (sinalDaIA) {
          // Grava no banco de dados (o que aciona o Supabase Realtime na tela do celular)
          const { data: novoSinal } = await supabase
            .from('historico_sinais')
            .insert([sinalDaIA])
            .select()
            .single();

          // Dispara para o canal do Telegram do usuário
          if (novoSinal) {
            await dispararTelegram(novoSinal);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
