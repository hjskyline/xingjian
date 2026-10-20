const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/map-provider.js'),'utf8');
async function run(responses,url='https://example.cn/'){ 
 const calls=[];
 const sandbox={URL,AbortController,setTimeout,clearTimeout,location:{href:url,origin:'https://example.cn'},XJ_MAP_CONFIG:{provider:'amap',remoteConfig:'api/map-config'},AMap:{}};
 sandbox.fetch=async (endpoint,opts)=>{calls.push(String(endpoint));assert.equal(opts.credentials,'same-origin');return responses.shift();};
 sandbox.document={createElement:()=>({remove(){}}),head:{append:()=>sandbox.__xingjianAMapReady()}};
 vm.runInNewContext(source,sandbox);
 const ready=await sandbox.XJMaps.initialize();
 return {ready,calls,problem:sandbox.XJMaps.problem,config:sandbox.XJ_MAP_CONFIG};
}
(async()=>{
 const valid=()=>({ok:true,status:200,json:async()=>({provider:'amap',amapKey:'test-public-key'})});
 const direct=await run([valid()]);assert.equal(direct.ready,true);assert.equal(direct.config.amapKey,'test-public-key');
 const auth=await run([{ok:false,status:401},valid()],'https://example.cn/?eo_token=test&eo_time=123');
 assert.equal(auth.ready,true);assert.equal(auth.calls.length,2);assert.ok(auth.calls[1].includes('eo_token=test'));
 const failure=await run([{ok:false,status:503}]);assert.equal(failure.ready,false);assert.match(failure.problem,/HTTP 503/);
 const malformed=await run([{ok:true,status:200,json:async()=>{throw Error('bad JSON');}}]);assert.match(malformed.problem,/JSON/);
 const missing=await run([{ok:true,status:200,json:async()=>({provider:'amap'})}]);assert.match(missing.problem,/应用标识/);
 console.log('Passed remote-config loading without AbortSignal.timeout: success, same-origin preview auth retry, HTTP diagnostics, invalid JSON, missing identifier.');
})().catch(e=>{console.error(e);process.exitCode=1;});
