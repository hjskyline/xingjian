// Contract tests against a mocked official SDK. Live AMap requires the owner's key.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(),
  errors = [],
  outbound = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/openstreetmap|nominatim/.test(r.url())) outbound.push(r.url());
});
await page.route('**/map-config.js', (r) =>
  r.fulfill({
    contentType: 'application/javascript',
    body: 'window.XJ_MAP_CONFIG={provider:"amap",amapKey:"mock",serviceHost:"/_AMapService"};',
  }),
);
await page.route('https://webapi.amap.com/**', (r) =>
  r.fulfill({
    contentType: 'application/javascript',
    body: `
(()=>{
const L=window.L;window.__amapMarkers=[];
const ll=p=>L.latLng(p[1],p[0]);const lnglat=p=>({lng:p.lng,lat:p.lat});
class Base {setMap(m){if(this.m)this.m.l.removeLayer(this.l);this.m=m;if(m)this.l.addTo(m.l);}on(n,cb){this.l.on(n,e=>cb({lnglat:lnglat(e.latlng||this.l.getLatLng?.()||{lng:0,lat:0})}));}}
class Map {constructor(id,o){this.l=L.map(id,{zoomControl:false}).setView(ll(o.center),o.zoom);}setZoomAndCenter(z,c){this.l.setView(ll(c),z);}setBounds(b){this.l.fitBounds([ll(b.a),ll(b.b)]);}getZoom(){return this.l.getZoom();}setZoom(z){this.l.setZoom(z);}on(n,cb){this.l.on(n,e=>cb({lnglat:e.latlng?lnglat(e.latlng):null}));}resize(){this.l.invalidateSize();}destroy(){this.l.remove();}addControl(){}getContainer(){return this.l.getContainer();}}
class Marker extends Base {constructor(o){super();this.options=o;this.l=L.marker(ll(o.position),{draggable:o.draggable,icon:L.divIcon({className:'amap-test-marker',html:o.content.outerHTML,iconSize:[27,27],iconAnchor:[-o.offset.x,-o.offset.y]})});window.__amapMarkers.push(this);}getPosition(){return lnglat(this.l.getLatLng());}setLabel(){} }
class Polyline extends Base {constructor(o){super();this.points=o.path;this.l=L.polyline(o.path.map(ll),{color:o.strokeColor,weight:o.strokeWeight,dashArray:o.strokeStyle==='dashed'?'5 5':null});}getPath(){return this.points.map(p=>({lng:p[0],lat:p[1]}));}}
class Walking{search(a,b,cb){cb('complete',{routes:[{distance:1050,time:780,steps:[{road:'光华路',instruction:'沿光华路向北步行',distance:1050,path:[a,b].map(p=>({lng:p[0],lat:p[1]}))}]}]});}}
class Transfer{search(a,b,cb){cb('complete',{plans:[{distance:5000,time:1800,path:[a,b],segments:[{transit_mode:'SUBWAY',instruction:'乘坐地铁5号线，在测试站下车',distance:5000,transit:{lines:[{name:'地铁5号线'}]}}]}]});}}
class PlaceSearch{search(q,cb){cb('complete',{poiList:{pois:[{name:'测试地点',location:{lng:116.403243,lat:39.909403}}]}});}}
class InfoWindow{setContent(){}open(){}close(){}}
window.AMap={Map,Marker,Polyline,Walking,Transfer,TransferPolicy:{LEAST_TIME:0,NO_SUBWAY:5},Riding:Walking,Driving:Walking,PlaceSearch,InfoWindow,ToolBar:class{},Scale:class{},Pixel:class{constructor(x,y){this.x=x;this.y=y;}},Bounds:class{constructor(a,b){this.a=a;this.b=b;}},plugin:(n,cb)=>cb()};window.__xingjianAMapReady();
})();`,
  }),
);
await page.goto(process.env.XINGJIAN_BASE_URL || 'http://127.0.0.1:4174/', {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('.timeline-row');
assert.match(await page.locator('#mapServiceStatus').innerText(), /高德地图/);
assert.ok((await page.locator('.map-number').count()) > 0);
await page.locator('#completeDayRoutes').click();
await page.waitForFunction(
  () => document.querySelector('#dayRouteProgress').textContent.includes('计算完成'),
  { timeout: 20000 },
);
assert.match(await page.locator('#dayRouteProgress').innerText(), /已保存 3 段/);
await page.locator('[data-segment="0"]').click();
assert.match(await page.locator('#turnList').innerText(), /地铁5号线/);
assert.match(await page.locator('#pathStatus').innerText(), /公交 \/ 地铁线路/);
await page.locator('#segmentDialog [data-close]').click();
await page.reload();
await page.waitForSelector('.timeline-row');
assert.match(await page.locator('#segmentList').innerText(), /沿公交 \/ 地铁线路/);
await page.locator('[data-segment="2"]').click();
await page.locator('#calculatePath').click();
await page.waitForFunction(() =>
  document.querySelector('#pathStatus').textContent.includes('沿道路计算'),
);
assert.match(await page.locator('#turnList').innerText(), /沿光华路向北步行/);
const route = await page.evaluate(() =>
  currentDay().legs.find((l) => l.source === '高德地图 JS API' && l.mode === 'walk'),
);
assert.ok(route.geometry.coordinates[0][0] < 116.46);
assert.equal(route.distanceMeters, 1050);
await page.locator('#segmentDialog [data-close]').click();
await page.locator('[data-segment="2"]').click();
await page.locator('#drawPath').click();
await page.locator('#map').click({ position: { x: 310, y: 240 } });
await page.locator('#finishDrawing').click();
assert.match(await page.locator('#segmentList').innerText(), /手绘路径/);
await page.locator('.timeline [data-place="guomao"]').click();
await page.locator('[data-photo-place="guomao"]').click();
await page.locator('#photoInput').setInputFiles(root + '/dist/assets/photos/cbd.jpg');
await page.waitForFunction(() => !document.querySelector('#photoPreview').hidden);
await page.locator('#photoSubmit').click();
await page.waitForSelector('.photo-card');
await page.locator('#memoryMode').click();
assert.equal(await page.locator('.memory-pin').count(), 1);
await page.locator('.memory-pin').click();
assert.equal(await page.locator('.place-album-grid img').count(), 1);
assert.deepEqual(errors, []);
assert.deepEqual(outbound, []);
const fallback = await browser.newContext();
const fail = await fallback.newPage();
const failRequests = [];
fail.on('request', (r) => {
  if (/openstreetmap|nominatim|amap.com/.test(r.url())) failRequests.push(r.url());
});
await fail.route('**/map-config.js', (r) =>
  r.fulfill({
    contentType: 'application/javascript',
    body: 'window.XJ_MAP_CONFIG={provider:"amap",amapKey:""};',
  }),
);
await fail.goto(process.env.XINGJIAN_BASE_URL || 'http://127.0.0.1:4174/');
await fail.waitForSelector('.timeline-row');
assert.match(await fail.locator('#mapServiceStatus').innerText(), /尚未配置/);
assert.deepEqual(failRequests, []);
console.log(
  'Passed AMap SDK contract UI: route + Chinese instructions, manual drawing, photo map album, no overseas service requests, missing-key local fallback. Live key and mainland network still required.',
);
await browser.close();
