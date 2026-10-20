// The JS API key is a browser identifier; the security code is never returned.
export function onRequestGet({ env }) {
  if (!env.AMAP_JS_KEY || !env.AMAP_SECURITY_CODE) {
    return Response.json({ error: '地图服务尚未配置' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ provider: 'amap', amapKey: env.AMAP_JS_KEY, serviceHost: '/_AMapService' }, {
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
