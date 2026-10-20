import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
trip=json.loads((root/'dist/data/trip.json').read_text())
ids={p['id'] for p in trip['places']}
assert len(ids)==len(trip['places'])
for day in trip['days']:
 assert 0<=day['walk'][0]<=day['walk'][1]<=20,day['id']
 for s in day['stops']:
  assert s['place'] in ids,s
  h,m=map(int,s['time'].split(':'));assert 0<=h<24 and 0<=m<60
 for leg in day['legs']:
  assert leg['fromId'] in ids and leg['toId'] in ids
  assert leg['mode'] in ['walk','bike','metro','bus','drive']
for item in trip['bookings']:
 assert item['place'] in ids and item['url'].startswith('https://')
manifest=json.loads((root/'dist/assets/photos/manifest.json').read_text())
for key,p in manifest.items():
 assert (root/'dist/assets/photos'/p['file']).is_file(),key
 assert p['source'].startswith('https://') and p['license'] and p['author']
for f in ['index.html','styles.css','app.js','route-core.js','assets/vendor/leaflet.js','assets/vendor/leaflet.css']:
 assert (root/'dist'/f).is_file(),f
print(f'Validated {len(ids)} places, {len(trip["days"])} days, {len(manifest)} licensed photo references; all walking ranges within 20 km.')
