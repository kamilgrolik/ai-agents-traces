import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase';

export const GET: APIRoute = async ({ request }) => {
  const siteUrl = new URL(request.url).origin;
  const now = new Date().toISOString();

  // Fetch the most recent 50 traces for sitemap entries
  const { data: traces } = await supabase
    .from('traces')
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const staticUrls = [
    { loc: `${siteUrl}/`, lastmod: now, changefreq: 'always', priority: '1.0' },
    { loc: `${siteUrl}/api/trace`, lastmod: now, changefreq: 'always', priority: '0.9' },
    { loc: `${siteUrl}/ai-instructions.txt`, lastmod: '2026-05-14', changefreq: 'monthly', priority: '0.8' },
  ];

  const traceUrls = (traces ?? []).map((t) => ({
    loc: `${siteUrl}/api/trace`,
    lastmod: t.created_at,
    changefreq: 'always',
    priority: '0.7',
  }));

  const allUrls = [...staticUrls, ...traceUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod.slice(0, 10)}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300',
    },
  });
};
