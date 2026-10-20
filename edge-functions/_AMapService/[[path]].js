// Same-origin proxy for the official AMap JS API. Never proxy arbitrary URLs.
const allowedPaths = new Set([
  '/v3/place/text', '/v3/place/around', '/v3/assistant/inputtips',
  '/v3/direction/walking', '/v3/direction/driving', '/v4/direction/bicycling',
  '/v5/direction/walking', '/v5/direction/driving', '/v5/direction/bicycling',
  '/v3/direction/transit/integrated', '/v5/direction/transit/integrated',
]);
export async function onRequest({ request, env }) {
  const reply = (text, status) => new Response(text, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return reply('Method not allowed', 405);
  const incoming = new URL(request.url);
  const path = incoming.pathname.replace(/^\/_AMapService/, '').replace(/\/$/, '');
  if (!allowedPaths.has(path)) return reply('Unsupported map service', 404);
  if (!env.AMAP_JS_KEY || !env.AMAP_SECURITY_CODE) return reply('Map service not configured', 503);
  const referer = request.headers.get('Referer');
  if (referer) {
    try { if (new URL(referer).origin !== incoming.origin) return reply('Forbidden', 403); }
    catch { return reply('Forbidden', 403); }
  }
  const upstream = new URL('https://restapi.amap.com' + path);
  upstream.search = incoming.search;
  upstream.searchParams.set('key', env.AMAP_JS_KEY);
  upstream.searchParams.set('jscode', env.AMAP_SECURITY_CODE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(upstream, { signal: controller.signal, redirect: 'error' });
    return new Response(result.body, { status: result.status, headers: {
      'Content-Type': result.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return reply('Map provider temporarily unavailable', 502); }
  finally { clearTimeout(timer); }
}
