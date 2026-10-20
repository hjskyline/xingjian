const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/route-core.js', 'utf8'), context);
const c = context.XJCore;
const example = fs.readFileSync('dist/data/ai-example.json', 'utf8');
const trip = c.parse('下面是方案：\n```json\n' + example + '\n```');
assert.equal(trip.days.length, 2);
assert.equal(trip.places.length, 3);
assert.equal(trip.places[2].lat, null);
assert.equal(trip.days[0].legs[0].pathKind, 'schematic');
assert.throws(() => c.parse('{broken json'), /无法读取/);
assert.throws(() => c.normalize({ ...JSON.parse(example), coordinateSystem: 'GCJ02' }), /WGS84/);
const bad = JSON.parse(example);
bad.days[0].stops[0].lat = 999;
assert.throws(() => c.normalize(bad), /无效/);
const wrong = JSON.parse(example);
wrong.days[0].legs[0].to = 'missing';
assert.throws(() => c.normalize(wrong), /不在当天/);
const g = c.geometry({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [116.4, 39.9],
      [116.401, 39.901],
    ],
  },
});
assert.ok(c.length(g) > 100);
assert.ok(c.aligned(g, { lng: 116.4, lat: 39.9 }, { lng: 116.401, lat: 39.901 }));
assert.equal(c.located({ lat: null, lng: null }), false);
assert.throws(
  () =>
    c.geometry({
      type: 'LineString',
      coordinates: [
        [999, 0],
        [0, 0],
      ],
    }),
  /LineString/,
);
assert.equal(c.dayDate('2027-02-30'), false);
console.log(
  'Core checks passed: fenced AI import, unresolved coordinates, invalid references, coordinate systems, geometry and endpoint alignment.',
);
