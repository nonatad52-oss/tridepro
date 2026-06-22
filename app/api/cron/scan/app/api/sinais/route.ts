export const dynamic = 'force-dynamic'; // Garante que a API nunca use cache

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Credenciais do Supabase ausentes." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Busca os últimos 20 sinais no banco de dados, ordenados do mais recente para o mais antigo
    const { data: sinais, error } = await supabase
      .from('historico_sinais')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    return NextResponse.json(sinais || []);

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
