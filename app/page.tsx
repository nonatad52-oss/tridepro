'use client';

import { useState, useEffect } from 'react';

interface Sinal {
  id: number;
  ticker: string;
  direcao: string;
  horario_entrada: string;
  tempo_expiracao: number;
  assertividade_passada: number;
  resultado_real: string;
}

export default function Dashboard() {
  const [sinais, setSinais] = useState<Sinal[]>([]);
  const [loading, setLoading] = useState(true);

  // Função real que busca os dados gravados no banco (Com quebra de cache)
  async function carregarSinais() {
    try {
      // O "?v=" com o horário atual obriga o site a não usar memória antiga
      const res = await fetch('/api/sinais?v=' + new Date().getTime(), { cache: 'no-store' });
      if (res.ok) {
        const dados = await res.json();
        setSinais(dados);
      }
    } catch (error) {
      console.error("Erro ao carregar sinais reais:", error);
    } finally {
      setLoading(false);
    }
  }

  // Carrega ao abrir a página e atualiza automaticamente a cada 30 segundos
  useEffect(() => {
    carregarSinais();
    const intervalo = setInterval(carregarSinais, 30000); 
    return () => clearInterval(intervalo);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      <header className="border-b border-slate-800 bg-slate-900/50 p-4 sticky top-0 backdrop-blur z-10">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-emerald-400">TRIDEPRO QUANT</h1>
              <p className="text-xs text-slate-400">Painel de Sinais • Quotex AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-medium text-emerald-400">Robô Ativo 24h</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Assertividade Média</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">89.8%</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold">Status do Sistema</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">Conectado</p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
            <span>📊</span> Sinais em Tempo Real (Supabase + Groq)
          </h2>

          {loading ? (
            <div className="text-center py-12 text-slate-500 text-sm animate-pulse">
              Conectando ao banco de dados...
            </div>
          ) : sinais.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-slate-800 rounded-2xl">
              Nenhum sinal gerado ainda. Aguardando oportunidades do Groq...
            </div>
          ) : (
            <div className="grid gap-3">
              {sinais.map((sinal) => (
                <div 
                  key={sinal.id} 
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-2xl p-4 flex justify-between items-center"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg tracking-wide">{sinal.ticker}</span>
                      <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400">M{sinal.tempo_expiracao}</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Entrada: {new Date(sinal.horario_entrada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={`inline-block font-extrabold px-3 py-1 rounded-xl text-sm ${
                        sinal.direcao === 'COMPRA' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {sinal.direcao}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1">AI: {sinal.assertividade_passada}%</p>
                    </div>

                    <div className="w-16 text-center">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        sinal.resultado_real === 'WIN' ? 'bg-emerald-500 text-slate-950' : 
                        sinal.resultado_real === 'LOSS' ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {sinal.resultado_real}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
