// Use the generic entry point and portable Response constructor on Edge Runtime.
// The browser key is public; the JS API security code is never returned.
export function onRequest({ request, env = {} }) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Xingjian-Map-Config': '2',
    },
  });
  if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (!env.AMAP_JS_KEY || !env.AMAP_SECURITY_CODE)
    return json({ code: 'MAP_ENV_MISSING', error: '地图服务尚未配置' }, 503);
  return json({ provider: 'amap', amapKey: env.AMAP_JS_KEY, serviceHost: '/_AMapService' });
}
