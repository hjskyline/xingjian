import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const load = async p => import('data:text/javascript;base64,'+Buffer.from(await fs.readFile(new URL(p,import.meta.url))).toString('base64'));
const config = await load('../edge-functions/api/map-config.js');
const proxy = await load('../edge-functions/_AMapService/[[path]].js');
const env = {AMAP_JS_KEY:'test-browser-key',AMAP_SECURITY_CODE:'test-security-code'};
assert.equal(config.onRequest({request:new Request('https://example.cn/api/map-config',{method:'POST'}),env}).status,405);
const publicConfig = await config.onRequest({request:new Request("https://example.cn/api/map-config"),env}).json();
assert.equal(publicConfig.amapKey,env.AMAP_JS_KEY);
assert.ok(!JSON.stringify(publicConfig).includes(env.AMAP_SECURITY_CODE));
assert.equal(config.onRequest({request:new Request("https://example.cn/api/map-config"),env:{}}).status,503);
const request = (path,options={})=>new Request('https://example.cn/_AMapService'+path,options);
assert.equal((await proxy.onRequest({request:request('/v3/place/text',{method:'POST'}),env})).status,405);
assert.equal((await proxy.onRequest({request:request('/unknown'),env})).status,404);
assert.equal((await proxy.onRequest({request:request('/v3/place/text'),env:{}})).status,503);
assert.equal((await proxy.onRequest({request:request('/v3/place/text',{headers:{referer:'https://another.example/'}}),env})).status,403);
const originalFetch=globalThis.fetch;
try {
 let calls=0;
 globalThis.fetch=async (url,options)=>{
   calls++;assert.equal(url.origin,'https://restapi.amap.com');
   assert.equal(url.searchParams.get('key'),env.AMAP_JS_KEY);
   assert.equal(url.searchParams.get('jscode'),env.AMAP_SECURITY_CODE);
   assert.equal(url.searchParams.get('keywords'),'北海');assert.equal(options.redirect,'error');
   return new Response('{"status":"1"}',{headers:{'Content-Type':'application/json'}});
 };
 const result=await proxy.onRequest({request:request('/v3/place/text?key=wrong&jscode=wrong&keywords=%E5%8C%97%E6%B5%B7'),env});
 assert.equal(calls,1);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
 assert.ok(!(await result.text()).includes(env.AMAP_SECURITY_CODE));
 const transit=await proxy.onRequest({request:request('/v3/direction/transit/integrated?keywords=%E5%8C%97%E6%B5%B7'),env});
 assert.equal(transit.status,200);
 globalThis.fetch=async()=>{throw Error('network failure with sensitive upstream URL');};
 const failed=await proxy.onRequest({request:request('/v3/place/text'),env});
 assert.equal(failed.status,502);assert.equal(await failed.text(),'Map provider temporarily unavailable');
} finally {globalThis.fetch=originalFetch;}
console.log('Passed EdgeOne configuration/proxy checks: no secret in public config, fixed upstream, path/method restrictions, same-origin check, server-owned credentials, safe failure. Provider responses mocked.');
