export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Credenciais ausentes" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Puxa os últimos 30 sinais gerados pelo robô, ordenados pelo mais recente
    const { data: sinais, error } = await supabase
      .from('historico_sinais')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    return NextResponse.json(sinais);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
