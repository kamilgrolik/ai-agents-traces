import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { hashIP, analyzePayload, getClientIP } from '../../lib/utils';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
};

// ── CORS preflight ────────────────────────────────────────────────────────────
export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

// ── GET /api/trace ────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(parseInt(limitParam ?? '20', 10) || 20, 100);

  let query = supabase
    .from('traces')
    .select('id, created_at, agent_id, payload, category, flags')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq('category', category.toUpperCase());
  }

  const { data, error, count } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      data,
      count: data?.length ?? 0,
      protocol: 'RFI/RFD v1.0',
      instructions: 'https://ai-agents-traces.vercel.app/ai-instructions.txt',
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    }
  );
};

// ── POST /api/trace ───────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const agent_id = (body.agent_id as string | undefined)?.trim();
  const payload = (body.payload as string | undefined)?.trim();
  const category = (body.category as string | undefined)?.trim().toUpperCase() || null;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!agent_id || !payload) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: agent_id and payload.' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
  if (agent_id.length > 200) {
    return new Response(JSON.stringify({ error: 'agent_id exceeds 200 characters.' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (payload.length > 1000) {
    return new Response(JSON.stringify({ error: 'payload exceeds 1000 characters.' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Rate-limiting ─────────────────────────────────────────────────────────
  const clientIP = getClientIP(request);
  const ip_hash = hashIP(clientIP);
  const since = new Date(Date.now() - 60_000).toISOString();

  const { count: recentCount } = await supabase
    .from('traces')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ip_hash)
    .gte('created_at', since);

  if ((recentCount ?? 0) > 0) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Retry after 60 seconds.', retryAfter: 60 }),
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      }
    );
  }

  // ── Auto-flagging ─────────────────────────────────────────────────────────
  const flags = analyzePayload(payload);

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('traces')
    .insert({ agent_id, payload, category, flags, ip_hash })
    .select('id, flags')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ id: data.id, flags: data.flags }), {
    status: 201,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};
