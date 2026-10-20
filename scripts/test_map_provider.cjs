const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(
  require('node:path').join(__dirname, '../dist/map-provider.js'),
  'utf8',
);
const M = require('../dist/map-provider.js');
for (const point of [
  [116.397, 39.908],
  [121.47, 31.23],
  [113.26, 23.13],
  [120.16, 30.26],
  [135.5, 34.7],
  [2.35, 48.85],
]) {
  const g = M.toGCJ(point),
    w = M.toWGS(g);
  assert.ok(Math.abs(w[0] - point[0]) + Math.abs(w[1] - point[1]) < 1e-7);
}
assert.deepEqual(M.toGCJ([2.35, 48.85]), [2.35, 48.85]);
const t = M.toGCJ([116.397, 39.908]);
assert.ok(t[0] > 116.402 && t[0] < 116.404 && t[1] > 39.909 && t[1] < 39.911);
async function test() {
  let calls = 0;
  const from = { lng: 116.397, lat: 39.908 },
    to = { lng: 116.407, lat: 39.918 };
  const points = [M.toGCJ([from.lng, from.lat]), M.toGCJ([to.lng, to.lat])];
  class Walking {
    search(a, b, cb) {
      calls++;
      assert.deepEqual(Array.from(a), points[0]);
      assert.deepEqual(Array.from(b), points[1]);
      cb('complete', {
        routes: [
          {
            distance: 1400,
            time: 1100,
            steps: [
              {
                road: '测试路',
                instruction: '向北步行',
                distance: 1400,
                path: points.map((c) => ({ lng: c[0], lat: c[1] })),
              },
            ],
          },
        ],
      });
    }
  }
  class PlaceSearch {
    search(q, cb) {
      cb('complete', {
        poiList: {
          pois: [{ name: '测试地点', location: { lng: points[0][0], lat: points[0][1] } }],
        },
      });
    }
  }
  const sandbox = {
    setTimeout,
    clearTimeout,
    URL,
    location: { href: 'https://example.cn/', origin: 'https://example.cn' },
    XJ_MAP_CONFIG: { provider: 'amap', amapKey: 'test', serviceHost: '/_AMapService' },
    AMap: { plugin: (n, cb) => cb(), Walking, PlaceSearch },
    document: { createElement: () => ({ remove() {} }), head: { append: (s) => s.onload() } },
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(await sandbox.XJMaps.initialize(), true);
  assert.equal(sandbox._AMapSecurityConfig.serviceHost, 'https://example.cn/_AMapService');
  const route = await sandbox.XJMaps.route(from, to, 'walk');
  assert.equal(calls, 1);
  assert.ok(Math.abs(route.geometry.coordinates[0][0] - from.lng) < 1e-7);
  assert.equal(route.routeSteps[0].instruction, '向北步行');
  assert.equal(route.distance, 1400);
  const places = await sandbox.XJMaps.search('测试', '北京');
  assert.ok(Math.abs(places[0].lat - from.lat) < 1e-7);
  await assert.rejects(sandbox.XJMaps.route(from, to, 'metro'), /换乘/);
  const missing = { setTimeout, clearTimeout, URL, XJ_MAP_CONFIG: { provider: 'amap' } };
  vm.runInNewContext(source, missing);
  assert.equal(await missing.XJMaps.initialize(), false);
  assert.match(missing.XJMaps.problem, /尚未配置/);
  console.log(
    'Passed: WGS84/GCJ round trips, overseas identity, proxy configuration, search and route boundary conversion, instructions, missing-key fallback. SDK service responses mocked.',
  );
}
test().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
