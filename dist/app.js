'use strict';
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safeUrl = (u) => {
  try {
    const x = new URL(u, location.href);
    return ['http:', 'https:'].includes(x.protocol) ? x.href : '#';
  } catch {
    return '#';
  }
};
let KEY = 'xingjian-route-beijing-autumn-2026';
const LIBRARY_KEY = 'xingjian-journeys-v1';
let library = [],
  builtinTrip,
  editingJourneyId = null,
  pickingLocation = false,
  searchResults = [],
  lastSearchAt = 0;
let trip,
  places,
  photosMeta = {},
  map,
  mapGroup,
  tileLayer,
  schematic,
  streetOn = true,
  selectedDay = 'd0',
  editing = false,
  overviewMode = false,
  photoFilter = 'all',
  localPhotos = [],
  pendingPhoto = null,
  toastTimer,
  db;
let state = { edits: {}, orders: {}, bookings: {} };
let fitAllStops = false;
let mapMode = 'plan',
  activeSegment = null,
  stagedImport = null,
  drawing = null,
  drawingLayer = null,
  lastRouteRequest = 0;
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3800);
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    notify('当前浏览器无法保存修改，请导出行程备份。');
  }
}
function normalState(s) {
  const out = { edits: {}, orders: {}, bookings: {} };
  if (!s || typeof s !== 'object') return out;
  for (const [k, v] of Object.entries(s.edits || {})) {
    if (!/^d\d{1,2}-\d{1,3}$/.test(k) || !v || typeof v !== 'object') continue;
    out.edits[k] = {
      note: typeof v.note === 'string' ? v.note.slice(0, 160) : '',
      skip: v.skip === true,
    };
    if (/^\d{2}:\d{2}$/.test(v.time)) out.edits[k].time = v.time;
  }
  for (const [k, v] of Object.entries(s.orders || {})) {
    if (/^d\d{1,2}$/.test(k) && Array.isArray(v))
      out.orders[k] = [
        ...new Set(v.filter((x) => typeof x === 'string' && /^d\d{1,2}-\d{1,3}$/.test(x))),
      ].slice(0, 40);
  }
  for (const [k, v] of Object.entries(s.bookings || {}))
    if (/^bk-[a-z0-9-]+$/.test(k)) out.bookings[k] = v === true;
  return out;
}
function encodeState(v) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decodeState(v) {
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    ),
  );
}
function dayStops(day, includeSkipped = false) {
  const arr = day.stops.map((s, i) => ({
    ...s,
    key: `${day.id}-${i}`,
    ...state.edits[`${day.id}-${i}`],
  }));
  const order = state.orders[day.id];
  if (order) {
    const by = new Map(arr.map((s) => [s.key, s]));
    const ordered = order.map((k) => by.get(k)).filter(Boolean);
    const used = new Set(ordered.map((s) => s.key));
    ordered.push(...arr.filter((s) => !used.has(s.key)));
    return includeSkipped ? ordered : ordered.filter((s) => !s.skip);
  }
  return includeSkipped ? arr : arr.filter((s) => !s.skip);
}
function currentDay() {
  return trip.days.find((d) => d.id === selectedDay) || trip.days[0];
}
function photoFor(place) {
  const own = mergedPhotos().find((p) => p.place === place.id);
  if (own)
    return {
      file: null,
      src: own.src,
      title: own.caption || place.name,
      author: '我们的旅行照片',
      license: '',
      source: null,
      own: true,
    };
  return isBeijing() ? photosMeta[place.scene] || {} : {};
}
function photoSrc(meta) {
  return meta.file ? `assets/photos/${meta.file}` : '';
}
function amap(place) {
  return (
    'https://uri.amap.com/search?keyword=' +
    encodeURIComponent(
      place.id === 'home' ? trip.homeLabel || place.name : place.name.split(' · ')[0],
    ) +
    '&city=' +
    encodeURIComponent(trip.city || '') +
    '&view=map'
  );
}
function renderTabs() {
  $('#dayTabs').innerHTML = trip.days
    .map(
      (d, i) =>
        `<button id="tab-${d.id}" class="day-tab ${!overviewMode && d.id === selectedDay ? 'active' : ''}" style="--day:${d.color}" role="tab" aria-selected="${!overviewMode && d.id === selectedDay}" data-day="${d.id}"><span class="tab-date">${d.label}</span><small>${d.weekday} / DAY ${String(i + 1).padStart(2, '0')}</small><span class="tab-name">${esc(d.title)}</span></button>`,
    )
    .join('');
}
function renderDay() {
  const day = currentDay();
  document.documentElement.style.setProperty('--day', day.color);
  $('#mapDay').textContent = pickingLocation
    ? '点击地图，选定地点位置'
    : overviewMode
      ? '旅程总览 / ' + trip.city
      : `DAY ${String(trip.days.indexOf(day) + 1).padStart(2, '0')} / ${day.label}`;
  const walk = day.walk || [0, 0],
    known = walk[1] > 0;
  $('#daySummary').innerHTML =
    `<div class="day-summary"><span class="day-kicker">${day.date} / ${day.weekday}</span>${editing ? `<input class="day-name-input" id="dayNameInput" aria-label="当天主题" value="${esc(day.title)}" maxlength="80">` : `<h3>${esc(day.title)}</h3>`}<p>${esc(day.subtitle || '在地图上添加想去的地方，慢慢连成一天。')}</p><div class="walk-metric"><span>预计步行</span><strong>${known ? walk[0] + '—' + walk[1] + ' km' : '尚未估算'}</strong><span class="walk-bar"><i style="width:${Math.min(100, (walk[1] / trip.maxWalkKm) * 100)}%"></i></span><span>上限 ${trip.maxWalkKm} km</span></div>${editing ? `<div class="edit-fields"><label>步行估算 <input aria-label="预计最少步行公里" id="walkMin" type="number" min="0" max="${trip.maxWalkKm}" value="${walk[0]}"></label><label>至 <input aria-label="预计最多步行公里" id="walkMax" type="number" min="0" max="${trip.maxWalkKm}" value="${walk[1]}"> km</label></div>` : ''}</div>`;
  $('#routeNotice').textContent = pickingLocation
    ? '在地图上点击一个位置；系统会带着坐标返回添加地点表单。'
    : editing
      ? '修改顺序会更新地图连线；交通说明和步行估计需要手动复核。'
      : '实线为道路算路参考；虚线仅示意连接。园区入口、开放与现场通行请再确认。';
  $('#editHelp').hidden = !editing;
  $('#editToggle').setAttribute('aria-pressed', String(editing));
  $('#editToggle').textContent = editing ? '完成调整' : '调整行程';
  const stops = dayStops(day, true);
  $('#timeline').innerHTML = stops.length
    ? stops
        .map((stop, i) => {
          const p = places[stop.place];
          if (!p) return '';
          return `<li class="timeline-row ${stop.optional ? 'optional' : ''} ${stop.skip ? 'skipped' : ''}" data-key="${stop.key}"><span class="timeline-time">${esc(stop.time)}</span><span class="timeline-dot">${p.id === 'home' ? '⌂' : i + 1}</span><div class="timeline-main"><button class="stop-title" data-place="${p.id}">${esc(p.name)}${stop.optional ? '<span class="stop-tags">可选</span>' : ''}${!XJCore.located(p) ? '<span class="unlocated-tag">待定位</span>' : ''}${p.booking && p.booking.includes('提前') ? '<span class="booking-tag">预约</span>' : ''}</button><div class="stop-sub">${esc(stop.duration)}${stop.note ? ' · ' + esc(stop.note) : ''}</div>${editing ? `<div class="edit-fields"><input aria-label="${esc(p.name)}时间" type="time" data-time="${stop.key}" value="${esc(stop.time)}"><input aria-label="${esc(p.name)}备注" class="note" data-note="${stop.key}" value="${esc(stop.note || '')}" maxlength="160" placeholder="写一句备注"><button data-move="${stop.key}" data-dir="-1" aria-label="上移${esc(p.name)}">↑</button><button data-move="${stop.key}" data-dir="1" aria-label="下移${esc(p.name)}">↓</button><label class="skip-label"><input type="checkbox" data-skip="${stop.key}" ${stop.skip ? 'checked' : ''}>略过</label></div>` : ''}</div></li>`;
        })
        .join('')
    : '<li class="empty-timeline">这一天还是空白的。<br>点击「添加地点」，搜索位置或在地图上选点。<br>景点、餐馆、住宿都可以成为一站。</li>';
  renderTabs();
  renderMap();
}
function selectDay(id) {
  fitAllStops = false;
  selectedDay = id;
  overviewMode = false;
  renderDay();
}
function openPlace(id) {
  const p = places[id];
  if (!p) return;
  const photo = photoFor(p),
    src = photo.src || (photo.file ? photoSrc(photo) : '');
  $('#placeContent').innerHTML =
    `${src ? `<div class="place-cover"><img src="${esc(src)}" alt="${esc(photo.title || p.name)}"></div>` : ''}<div class="place-body"><span class="place-tags">${esc(p.tag || '旅途的一站')}${p.booking ? ' / ' + esc(p.booking) : ''}</span><h2>${esc(p.name)}</h2><p>${esc(p.description || '给这一站留一些时间，也留一张照片。')}</p>${p.tips ? '<ul>' + p.tips.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : ''}<div class="place-actions"><a class="button dark small" href="${esc(amap(p))}" target="_blank" rel="noopener noreferrer">打开高德地图 ↗</a><a class="button outline small" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}" target="_blank" rel="noopener noreferrer">国际地图 ↗</a>${p.source ? `<a class="button outline small" href="${esc(safeUrl(p.source))}" target="_blank" rel="noopener noreferrer">参观资料 ↗</a>` : ''}<button class="button outline small" data-photo-place="${p.id}">为这里加照片 ＋</button><button class="text-button" data-edit-place="${p.id}">修改地点</button></div>${photo.own ? '<p class="image-credit">我们的旅行照片 · 保存在此旅程相册。</p>' : photo.file ? `<p class="image-credit">${esc(photo.title)}。${esc(photo.author || '')} · ${esc(photo.license || '')} ${photo.source ? `<a href="${esc(safeUrl(photo.source))}" target="_blank" rel="noopener noreferrer">来源及许可 ↗</a>` : ''}<br>参考实景拍摄于不同年份、季节，不代表旅行当天叶色、光线或天气。</p>` : ''}</div>`;
  $('#placeDialog').showModal();
  renderPlaceAlbum(id);
}
function beijingSchematicSvg() {
  const w = 1000,
    h = 950,
    box = { west: 116.25, east: 116.51, south: 39.82, north: 40.035 };
  const xy = (lat, lng) => [
    ((lng - box.west) / (box.east - box.west)) * w,
    ((box.north - lat) / (box.north - box.south)) * h,
  ];
  const path = (coords) =>
    coords.map(([lat, lng], i) => `${i ? 'L' : 'M'}${xy(lat, lng).join(' ')}`).join(' ');
  const ring = (s, n, wst, e) => [
    [s, wst],
    [n, wst],
    [n, e],
    [s, e],
    [s, wst],
  ];
  let roads = '';
  for (const c of [
    ring(39.881, 39.95, 116.35, 116.432),
    ring(39.858, 39.977, 116.31, 116.454),
    ring(39.835, 39.991, 116.275, 116.484),
  ])
    roads += `<path d="${path(c)}" fill="none" stroke="#d7d9c8" stroke-width="12" stroke-linejoin="round"/><path d="${path(c)}" fill="none" stroke="#fdfcf2" stroke-width="5"/>`;
  for (const c of [
    [
      [39.9067, 116.25],
      [39.9067, 116.51],
    ],
    [
      [39.835, 116.3913],
      [40.03, 116.3913],
    ],
    [
      [39.8457, 116.28],
      [39.8457, 116.5],
    ],
    [
      [39.974, 116.27],
      [39.974, 116.49],
    ],
    [
      [39.88, 116.41],
      [39.96, 116.41],
    ],
  ])
    roads += `<path d="${path(c)}" stroke="#fffdf3" stroke-width="7" fill="none"/>`;
  let lakes = '';
  for (const [lat, lng, rx, ry] of [
    [39.93, 116.383, 15, 32],
    [39.938, 116.382, 21, 17],
    [39.945, 116.378, 18, 13],
    [40.016, 116.385, 38, 23],
  ]) {
    const [x, y] = xy(lat, lng);
    lakes += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#c5d7cd" stroke="#b4c9be"/>`;
  }
  let labels = '';
  for (const [name, lat, lng] of [
    ['中关村', 39.989, 116.306],
    ['奥林匹克公园', 40.005, 116.404],
    ['东城', 39.95, 116.425],
    ['什刹海', 39.944, 116.36],
    ['西城', 39.92, 116.34],
    ['国贸 CBD', 39.92, 116.467],
    ['长 安 街', 39.904, 116.36],
    ['宋家庄', 39.835, 116.432],
    ['北京南站', 39.859, 116.372],
  ]) {
    const [x, y] = xy(lat, lng);
    labels += `<text x="${x}" y="${y}" fill="#929c83" font-size="17" font-family="sans-serif">${name}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="1000" height="950" fill="#eaecdf"/><path d="${path(ring(39.914, 39.924, 116.381, 116.4))}" fill="#dfe3ca"/><path d="${path(ring(40.004, 40.032, 116.365, 116.408))}" fill="#d7dfc1"/>${roads}${lakes}${labels}<text x="35" y="45" font-family="sans-serif" font-size="17" fill="#78876a">N ↑ · 北京地理示意 / 非导航底图</text></svg>`;
}
function setupMap() {
  if (map) {
    map.remove();
    map = null;
  }
  if (!window.L) {
    streetOn = false;
    $('#tileToggle').hidden = true;
    renderMap();
    return;
  }
  streetOn = true;
  $('#tileToggle').hidden = false;
  $('#tileToggle').textContent = '切换示意底图';
  map = L.map('map', {
    zoomControl: false,
    scrollWheelZoom: false,
    minZoom: 2,
    maxZoom: 18,
    attributionControl: true,
  }).setView(trip.center || [30, 110], 10);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 90 }).addTo(map);
  map.createPane('schematic');
  map.getPane('schematic').style.zIndex = 150;
  const bounds = isBeijing()
    ? [
        [39.82, 116.25],
        [40.035, 116.51],
      ]
    : [
        [-85, -180],
        [85, 180],
      ];
  schematic = L.imageOverlay(
    'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(isBeijing() ? beijingSchematicSvg() : worldSchematicSvg()),
    bounds,
    { pane: 'schematic', interactive: false },
  ).addTo(map);
  map.attributionControl.addAttribution('示意线非导航');
  tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  });
  let errors = 0;
  tileLayer.on('tileerror', () => {
    if (streetOn && ++errors >= 3) {
      toggleTiles(false);
      notify('街道底图暂时不可用，已切换示意图；可用外部地图导航。');
    }
  });
  tileLayer.addTo(map);
  mapGroup = L.featureGroup().addTo(map);
  map.on('click', (e) => {
    if (drawing) {
      addDrawingPoint(e.latlng);
      return;
    }
    if (pickingLocation) {
      $('#stopLat').value = e.latlng.lat.toFixed(6);
      $('#stopLng').value = e.latlng.lng.toFixed(6);
      pickingLocation = false;
      $('.map-shell').classList.remove('map-picking');
      renderDay();
      $('#stopDialog').showModal();
    }
  });
}
function toggleTiles(on) {
  streetOn = on;
  if (map) {
    if (on) tileLayer.addTo(map);
    else map.removeLayer(tileLayer);
  }
  $('#tileToggle').textContent = on ? '切换示意底图' : '加载街道底图';
}
function renderMap() {
  if (!trip) return;
  const all = mergedPhotos();
  $('#mapPhotoCount').textContent = all.length;
  $('#planMode').classList.toggle('active', mapMode === 'plan');
  $('#memoryMode').classList.toggle('active', mapMode === 'memories');
  $('#planMode').setAttribute('aria-pressed', String(mapMode === 'plan'));
  $('#memoryMode').setAttribute('aria-pressed', String(mapMode === 'memories'));
  const days = overviewMode ? trip.days : [currentDay()];
  if (!map) {
    renderSvgMap(days);
    return;
  }
  mapGroup.clearLayers();
  const bounds = [];
  let unresolved = 0;
  if (mapMode === 'memories') {
    const grouped = new Map();
    for (const photo of all) {
      const p = places[photo.place];
      if (!XJCore.located(p)) {
        unresolved++;
        continue;
      }
      if (!grouped.has(p.id)) grouped.set(p.id, []);
      grouped.get(p.id).push(photo);
    }
    for (const [id, items] of grouped) {
      const p = places[id];
      bounds.push([p.lat, p.lng]);
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'memory-marker-wrap',
          html: `<span class="memory-pin"><img src="${esc(items[0].src)}" alt="${esc(p.name)}"><b>${items.length}</b></span>`,
          iconSize: [47, 47],
          iconAnchor: [23, 23],
        }),
        title: p.name,
      }).addTo(mapGroup);
      marker.bindTooltip(esc(p.name) + ' · ' + items.length + '张', {
        permanent: $('#showLabels').checked,
        direction: 'top',
        offset: [0, -23],
        className: 'place-name-tooltip',
      });
      marker.on('click', () => openPlace(id));
    }
    $('#mapDay').textContent = '照片足迹 / ' + trip.city;
    if (!bounds.length) {
      const p = trip.places.find(XJCore.located);
      if (p) bounds.push([p.lat, p.lng]);
      $('#routeNotice').textContent = all.length
        ? '照片的地点还未定位。点击地点修改位置，照片就会出现在地图上。'
        : '这条旅程还没有照片。先为一个地点添加照片，地图上就会出现相册图钉。';
    } else
      $('#routeNotice').textContent =
        `${grouped.size} 个地点 · ${all.length} 张照片。点击照片图钉，打开这个地方的照片集。${unresolved ? '另有 ' + unresolved + ' 张照片待关联或定位。' : ''}`;
  } else {
    for (const d of days) {
      const stops = dayStops(d);
      for (let i = 1; i < stops.length; i++) {
        const p = places[stops[i - 1].place],
          q = places[stops[i].place];
        if (!XJCore.located(p) || !XJCore.located(q) || p.id === q.id) continue;
        const leg = d.legs.find((l) => l.fromId === p.id && l.toId === q.id);
        const usable = leg?.geometry && XJCore.aligned(leg.geometry, p, q);
        const path = usable
          ? leg.geometry.coordinates.map((c) => [c[1], c[0]])
          : [[p.lat, p.lng], ...(leg?.via || []), [q.lat, q.lng]];
        const calculated = usable && leg.pathKind === 'calculated';
        const line = L.polyline(path, {
          color: d.color,
          weight: usable ? 4 : 2.5,
          opacity: overviewMode ? 0.5 : 0.85,
          dashArray: calculated ? undefined : usable ? '3 4' : '7 8',
        }).addTo(mapGroup);
        if (usable) {
          const first = leg.geometry.coordinates[0],
            last = leg.geometry.coordinates.at(-1);
          for (const [a, b] of [
            [
              [p.lat, p.lng],
              [first[1], first[0]],
            ],
            [
              [last[1], last[0]],
              [q.lat, q.lng],
            ],
          ]) {
            if (XJCore.distance([a[1], a[0]], [b[1], b[0]]) > 12) {
              L.polyline([a, b], { color: d.color, weight: 1.5, opacity: 0.55, dashArray: '2 5' })
                .bindTooltip('附近点位与道路匹配点的连接示意，入口需核对')
                .addTo(mapGroup);
            }
          }
        }
        line.bindTooltip(esc(pathLabel(leg, p, q)) + ' · ' + esc(leg?.note || '请细化此路段'));
        line.on('click', () => {
          if (!overviewMode) openSegment(i - 1);
        });
      }
      const seen = new Set();
      stops.forEach((st, i) => {
        const p = places[st.place];
        if (!XJCore.located(p)) {
          unresolved++;
          return;
        }
        if (seen.has(p.id)) return;
        seen.add(p.id);
        bounds.push([p.lat, p.lng]);
        const count = all.filter((ph) => ph.place === p.id).length;
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'map-marker-wrap',
            html: `<span class="map-number ${p.id === 'home' ? 'home' : ''}" style="--pin:${d.color}">${p.id === 'home' ? '⌂' : i + 1}${count ? '<b class="map-photo-badge">' + count + '</b>' : ''}</span>`,
            iconSize: [27, 27],
            iconAnchor: [13, 13],
          }),
          title: p.name,
          draggable: editing && !overviewMode,
        }).addTo(mapGroup);
        marker.bindTooltip(esc(p.name), {
          permanent: $('#showLabels').checked,
          direction: 'right',
          offset: [13, 0],
          className: 'place-name-tooltip',
        });
        marker.on('click', () => {
          if (!drawing) openPlace(p.id);
        });
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          p.lat = ll.lat;
          p.lng = ll.lng;
          invalidatePaths(p.id);
          trip.customized = true;
          saveJourney();
          renderDay();
          notify('地点已移动，相关路径需重新计算。');
        });
      });
    }
    if (unresolved)
      $('#routeNotice').textContent =
        `${unresolved} 处地点待定位，暂不画到地图上。点击行程中的地点，可搜索或在地图上选点。`;
  }
  const activityBounds = dayStops(currentDay())
    .map((st) => places[st.place])
    .filter((p) => XJCore.located(p) && !['home', 'south'].includes(p.id))
    .map((p) => [p.lat, p.lng]);
  const fitBounds =
    mapMode === 'plan' && !overviewMode && !fitAllStops && activityBounds.length >= 3
      ? activityBounds
      : bounds;
  $('#mapReset').textContent = fitAllStops ? '⌖ 聚焦游览街区' : '⌖ 含通勤完整路线';
  if (fitBounds.length)
    map.fitBounds(fitBounds, { padding: [48, 65], maxZoom: 16, animate: false });
  else map.setView(trip.center || [30, 110], 10, { animate: false });
  setTimeout(() => map.invalidateSize(), 80);
  renderSegmentList();
}
function renderSvgMap(days) {
  let pts = days.flatMap((d) => dayStops(d).map((s) => places[s.place])).filter(XJCore.located);
  if (!pts.length) {
    $('#map').innerHTML =
      '<div class="scene-placeholder"><span>⌖</span><small>添加地点后，这里会出现路线。地图组件暂不可用时，可通过搜索位置或输入坐标添加。</small></div>';
    return;
  }
  let minLat = Math.min(...pts.map((p) => p.lat)) - 0.016,
    maxLat = Math.max(...pts.map((p) => p.lat)) + 0.016,
    minLng = Math.min(...pts.map((p) => p.lng)) - 0.022,
    maxLng = Math.max(...pts.map((p) => p.lng)) + 0.022;
  const W = 740,
    H = 620;
  const xy = (p) => [
    ((p.lng - minLng) / (maxLng - minLng)) * W,
    H - ((p.lat - minLat) / (maxLat - minLat)) * H,
  ];
  let svg = `<svg class="svg-fallback" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#e9ecdd"/><defs><pattern id="grid" width="70" height="70" patternUnits="userSpaceOnUse"><path d="M70 0H0V70" fill="none" stroke="#d9decb"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#grid)"/><text x="22" y="70">N ↑ · 地理示意 / 非导航底图</text>`;
  for (const d of days) {
    const stops = dayStops(d).filter((s) => XJCore.located(places[s.place]));
    svg += `<polyline points="${stops.map((s) => xy(places[s.place]).join(',')).join(' ')}" fill="none" stroke="${d.color}" stroke-width="3" stroke-dasharray="6 5"/>`;
    const seen = new Set();
    stops.forEach((s, i) => {
      const p = places[s.place];
      if (seen.has(p.id)) return;
      seen.add(p.id);
      const [x, y] = xy(p);
      svg += `<g class="fallback-marker" data-place="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}"><circle cx="${x}" cy="${y}" r="14" fill="${d.color}" stroke="white" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:white;font-size:10px">${p.id === 'home' ? '⌂' : i + 1}</text><text x="${x + 19}" y="${y + 4}" font-size="11">${esc(p.name.slice(0, 9))}</text></g>`;
    });
  }
  $('#map').innerHTML = svg + '</svg>';
}
function renderScenes() {
  const ids = isBeijing()
    ? ['guomao', 'ditan', 'yonghe', 'wudaoying', 'tower', 'beihai', 'jingshan', 'corner']
    : trip.places
        .filter((p) => !['home', 'south', 'xidan', 'dongdan'].includes(p.id))
        .map((p) => p.id);
  const visibleIds = ids.filter((id) => places[id]);
  $('#sceneGrid').innerHTML = visibleIds.length
    ? visibleIds
        .slice(0, 16)
        .map((id) => {
          const p = places[id],
            photo = photoFor(p),
            src = photo.src || (photo.file ? photoSrc(photo) : '');
          return `<button class="scene-card" data-place="${id}"><div class="scene-image">${src ? `<img src="${esc(src)}" alt="${esc(photo.title || p.name)}" loading="lazy">` : '<div class="scene-placeholder"><span>⌖</span><small>到访后，放上我们的照片</small></div>'}<span class="scene-day">${esc(p.tag || '旅途的一站')}</span>${src ? `<span class="photo-note">${photo.own ? '我们的记忆' : esc(photo.title)}</span>` : ''}</div><h3>${esc(p.name.split(' · ')[0])}</h3><p>${esc(p.tag || '下一站，慢慢走')}</p><span class="arrow">↗</span></button>`;
        })
        .join('')
    : '<div class="empty-scene">地图上的第一站，<br>会成为这里的第一张风景。</div>';
  let hero = isBeijing() ? photosMeta.cbd : null;
  const own = mergedPhotos()[0];
  $('#heroPhoto').style.backgroundImage = own
    ? `url("${own.src}")`
    : hero?.file
      ? `url("${photoSrc(hero)}")`
      : '';
  $('#heroPhoto').style.backgroundColor = isBeijing() ? '#293039' : '#536350';
  $('#heroCredit').innerHTML = own
    ? '我们的旅行照片'
    : hero
      ? `<a href="${esc(safeUrl(hero.source))}" target="_blank" rel="noopener noreferrer">${esc(hero.author)} / ${esc(hero.license)}</a>`
      : '';
  $('#heroPlace').textContent = own
    ? '此程的一个瞬间'
    : isBeijing()
      ? '北京 · 国贸夜色'
      : trip.city + ' · 故事尚待发生';
}
function renderBookings() {
  $('#bookingList').innerHTML = trip.bookings.length
    ? trip.bookings
        .map(
          (b) =>
            `<div class="booking-row ${state.bookings[b.id] ? 'done' : ''}"><input class="booking-check" type="checkbox" data-booking="${b.id}" aria-label="${esc(b.title)}已准备" ${state.bookings[b.id] ? 'checked' : ''}><span class="booking-level">${esc(b.level || '准备提醒')}</span><div class="booking-copy"><h3>${esc(b.title)}</h3><p>${esc(b.detail)}</p></div><div class="booking-actions">${b.url ? `<a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener noreferrer">查看官方入口 ↗</a>` : ''}<button class="text-button" data-calendar="${b.id}">日历提醒 ＋</button><button class="text-button" data-remove-booking="${b.id}">移除提醒</button></div></div>`,
        )
        .join('')
    : '<div class="booking-empty">还没有准备提醒。把门票、餐厅、天气或交通检查加进来。</div>';
  $('#bookingCount').textContent =
    `${trip.bookings.filter((b) => state.bookings[b.id]).length} / ${trip.bookings.length} 已准备`;
  $('#bookingIntroText').textContent = isBeijing()
    ? '北京资料核查：2026.10.19 · 日期是建议检查日，放票以官方为准。'
    : '提醒按你填写的日期导出到日历；不会自动查询目的地开放或放票信息。';
  $('#bookingFootnote').textContent = isBeijing()
    ? '雍和宫、恭王府优先实名购票，三人携带有效证件。角楼、北大红楼与奥林匹克塔按外观安排。'
    : '提醒需要下载并导入日历后生效。实际预约、开放和交通规则，请以目的地官方信息为准。';
  $('#calendarAll').disabled = !trip.bookings.length;
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
function calendar(bookings) {
  const events = bookings.map((b) => {
    const date = b.date.replaceAll('-', '');
    const next = new Date(b.date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return [
      'BEGIN:VEVENT',
      `UID:${trip.id}-${b.id}@xingjian`,
      `DTSTAMP:20261019T000000Z`,
      `DTSTART:${date}T010000Z`,
      `DTEND:${date}T013000Z`,
      `SUMMARY:${icsEscape('旅行准备 · ' + b.title)}`,
      `DESCRIPTION:${icsEscape(b.detail + ' 官方入口：' + b.url + ' 这是建议检查日，不是官方放票日。')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:检查旅行准备',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  download(
    trip.title + '-准备提醒.ics',
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Beijing Together//Trip//ZH',
      'CALSCALE:GREGORIAN',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n'),
    'text/calendar;charset=utf-8',
  );
  notify('已下载日历文件；导入你的日历后生效。');
}
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xingjian-memories-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}
function allDbPhotos() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('photos').objectStore('photos').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function saveDbPhoto(p) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ ...p, tripId: trip.id });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function deleteDbPhoto(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function mergedPhotos() {
  const unique = new Map(
    (trip.photos || []).filter(validPhoto).map((p) => [p.id, { ...p, published: true }]),
  );
  for (const p of localPhotos.filter((p) => p.tripId === trip.id)) unique.set(p.id, p);
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}
function validPhoto(p) {
  return (
    p &&
    typeof p.id === 'string' &&
    typeof p.src === 'string' &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(p.src) &&
    p.src.length < 8e6 &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
    typeof p.caption === 'string' &&
    p.caption.length <= 500 &&
    typeof p.place === 'string'
  );
}
function renderPhotos() {
  const all = mergedPhotos(),
    photos = all.filter((p) => photoFilter === 'all' || p.date === photoFilter);
  $('#photoCount').textContent = all.length
    ? `${all.length} 张照片 · ${photoFilter === 'all' ? '全部' : photoFilter.slice(5).replace('-', '.')}记忆`
    : '等待第一张照片';
  $('#photoGrid').innerHTML = photos.length
    ? photos
        .map(
          (p) =>
            `<article class="photo-card"><img src="${esc(p.src)}" alt="${esc(p.caption || '旅行照片')}" loading="lazy">${!p.published ? `<button class="photo-delete" data-delete-photo="${esc(p.id)}" aria-label="删除照片">×</button>` : ''}<h3>${esc(p.caption || '旅途的一刻')}</h3><button class="photo-relocate" data-relocate-photo="${esc(p.id)}">${places[p.place] ? '调整地点归属 ↗' : '关联地点，放上地图 ↗'}</button><p>${esc(p.date.replaceAll('-', '.'))} / ${esc(places[p.place]?.name || p.place || trip.city)} ${p.published ? '· 已发布' : ''}</p></article>`,
        )
        .join('')
    : `<div class="memory-empty"><span class="empty-art">❧</span><div><h3>${all.length ? '这一天，还没有照片。' : '给还没发生的故事，留一页空白。'}</h3><p>一段街巷，一顿晚饭，一个不经意的瞬间。<br>每个旅程有独立的相册，随时添加喜欢的照片。</p></div></div>`;
  renderMap();
}
function openPhotoForm(placeId) {
  $('#placeDialog').close();
  if (!db) {
    notify('此浏览器暂不支持本地相册存储，可换浏览器重试。');
    return;
  }
  if (!trip.places.length) {
    notify('先为这条旅程添加一个地点，再把照片放进去。');
    return;
  }
  pendingPhoto = null;
  $('#photoForm').reset();
  $('#photoDate').value = currentDay().date;
  $('#photoPreview').hidden = true;
  if (placeId) $('#photoPlace').value = placeId;
  $('#photoDialog').showModal();
}
async function compressPhoto(file) {
  if (file.size > 35e6) throw new Error('请选小于35 MB的照片。');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 照片。');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height)),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}
function materializeTrip(withPhotos = false) {
  const copy = JSON.parse(JSON.stringify(trip));
  for (const d of copy.days)
    d.stops = dayStops(trip.days.find((x) => x.id === d.id)).map((s) => ({
      place: s.place,
      time: s.time,
      duration: s.duration,
      ...(s.optional ? { optional: true } : {}),
      ...(s.note ? { note: s.note } : {}),
    }));
  copy.photos = withPhotos ? mergedPhotos().map(({ published, ...p }) => p) : [];
  return copy;
}
async function share() {
  const url = new URL(location.href);
  const payload = {
    version: 2,
    state,
    day: selectedDay,
    trip: !isBeijing() || trip.customized ? { ...trip, photos: [] } : undefined,
  };
  let bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > 300000)
    return notify('此旅程含较多路径数据，请导出旅程文件分享，避免链接过长。');
  let prefix = 'j.';
  if (typeof CompressionStream !== 'undefined') {
    bytes = new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    prefix = 'z.';
  }
  url.hash =
    'trip=' +
    prefix +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  if (url.href.length > 70000) return notify('路线内容较多，请导出旅程文件交给同行导入。');
  try {
    await navigator.clipboard.writeText(url.href);
    notify('已复制分享链接，包含此旅程和路线修改；不含本地照片。');
  } catch {
    $('#infoContent').innerHTML =
      '<div class="eyebrow">SHARE THE JOURNEY</div><h2>把旅程发给同行。</h2><p>复制下面链接。此旅程与路线修改会随链接分享，本地相册不包含在链接中。</p><input id="shareUrl" aria-label="分享链接" readonly>';
    $('#infoDialog').showModal();
    $('#shareUrl').value = url.href;
    $('#shareUrl').select();
  }
}
function credits() {
  const items = Object.values(photosMeta);
  $('#infoContent').innerHTML =
    `<div class="eyebrow">PHOTO CREDITS / SOURCES</div><h2>感谢这些真实的风景。</h2><p>参考照片来自 Wikimedia Commons。照片各自适用其原许可；项目代码的 MIT 许可不覆盖第三方照片。这些参考图属于北京示例，不会自动用作其他城市的景色。</p>${items.map((m) => `<div class="credit-item"><h3>${esc(m.title)}</h3><p>${esc(m.author)} · ${esc(m.license)} · ${esc(m.changes || '原图缩放显示')}<br><a href="${esc(safeUrl(m.source))}" target="_blank" rel="noopener noreferrer">原始文件及许可 ↗</a></p></div>`).join('')}<h3>资料核查与地图说明</h3><p>核查日期：2026.10.19。路线时间、通勤和步行距离为规划估计；坐标为景点附近位置，线条仅表示顺序。OpenStreetMap 街道瓦片需网络，本地示意底图不提供导航。</p>${trip.places
      .filter((p) => p.source)
      .map(
        (p) =>
          `<p><a href="${esc(safeUrl(p.source))}" target="_blank" rel="noopener noreferrer">${esc(p.name)} · 参观资料 ↗</a></p>`,
      )
      .join('')}`;
  $('#infoDialog').showModal();
}
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest(
      '[data-day],[data-place],[data-close],[data-move],[data-photo-place],[data-calendar],[data-delete-photo]',
    );
    if (!b) return;
    if (b.dataset.day) selectDay(b.dataset.day);
    if (b.dataset.place) openPlace(b.dataset.place);
    if (b.hasAttribute('data-close')) b.closest('dialog').close();
    if (b.dataset.photoPlace) openPhotoForm(b.dataset.photoPlace);
    if (b.dataset.calendar) calendar(trip.bookings.filter((x) => x.id === b.dataset.calendar));
    if (b.dataset.move) {
      const arr = dayStops(currentDay(), true).map((s) => s.key),
        i = arr.indexOf(b.dataset.move),
        j = i + Number(b.dataset.dir);
      if (j >= 0 && j < arr.length) {
        [arr[i], arr[j]] = [arr[j], arr[i]];
        state.orders[selectedDay] = arr;
        persist();
        renderDay();
      }
    }
    if (b.dataset.deletePhoto) {
      try {
        await deleteDbPhoto(b.dataset.deletePhoto);
        localPhotos = await allDbPhotos();
        renderPhotos();
        renderScenes();
        notify('已从此浏览器移除照片。');
      } catch {
        notify('照片删除失败，请重试。');
      }
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.booking) {
      state.bookings[el.dataset.booking] = el.checked;
      persist();
      renderBookings();
    }
    if (el.dataset.time || el.dataset.note || el.dataset.skip) {
      const key = el.dataset.time || el.dataset.note || el.dataset.skip;
      state.edits[key] ||= {};
      if (el.dataset.time) state.edits[key].time = el.value;
      if (el.dataset.note) state.edits[key].note = el.value.slice(0, 160);
      if (el.dataset.skip) state.edits[key].skip = el.checked;
      persist();
      renderDay();
    }
  });
  $('#editToggle').onclick = () => {
    editing = !editing;
    renderDay();
  };
  $('#overview').onclick = () => {
    overviewMode = !overviewMode;
    renderDay();
  };
  $('#mapReset').onclick = () => {
    fitAllStops = !fitAllStops;
    renderMap();
  };
  $('#tileToggle').onclick = () => toggleTiles(!streetOn);
  $('#shareTop').onclick = share;
  $('#calendarAll').onclick = () => calendar(trip.bookings);
  $('#credits').onclick = credits;
  $('#addPhoto').onclick = () => openPhotoForm();
  $('#photoTabs').onclick = (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    photoFilter = button.dataset.filter;
    $$('#photoTabs button').forEach((b) => b.classList.toggle('active', b === button));
    renderPhotos();
  };
  $('#photoInput').onchange = async () => {
    const file = $('#photoInput').files[0];
    if (!file) return;
    $('#photoSubmit').disabled = true;
    try {
      pendingPhoto = await compressPhoto(file);
      $('#photoPreview').src = pendingPhoto;
      $('#photoPreview').hidden = false;
    } catch (err) {
      pendingPhoto = null;
      notify(err.message);
    } finally {
      $('#photoSubmit').disabled = false;
    }
  };
  $('#photoForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!pendingPhoto) return notify('请先选一张照片。');
    $('#photoSubmit').disabled = true;
    try {
      await saveDbPhoto({
        id: crypto.randomUUID(),
        src: pendingPhoto,
        date: $('#photoDate').value,
        place: $('#photoPlace').value,
        caption: $('#photoCaption').value.slice(0, 160),
      });
      localPhotos = await allDbPhotos();
      renderPhotos();
      renderScenes();
      $('#photoDialog').close();
      notify('已收藏到此浏览器；记得导出完整备份。');
    } catch {
      notify('本地保存失败，可能是浏览器存储空间不足。');
    } finally {
      $('#photoSubmit').disabled = false;
    }
  };
  $$('dialog').forEach((d) =>
    d.addEventListener('click', (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          d.close();
      }
    }),
  );
}
function isBeijing() {
  return trip?.id === 'beijing-autumn-2026';
}
function worldSchematicSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1000"><defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d6ddc8" stroke-width=".6"/></pattern></defs><rect width="2000" height="1000" fill="#e9eddf"/><rect width="2000" height="1000" fill="url(#g)"/></svg>';
}
function validateTrip(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray(input.places) ||
    !Array.isArray(input.days) ||
    !input.days.length ||
    input.days.length > 31
  )
    throw new Error('旅程格式不正确，单程支持1—31天。');
  const text = (x, n = 1000) => (typeof x === 'string' ? x.slice(0, n) : '');
  const id = /^[a-zA-Z0-9-]{1,80}$/.test(input.id || '') ? input.id : 'trip-' + crypto.randomUUID();
  const t = {
    schemaVersion: 1,
    id,
    title: text(input.title, 70) || '新旅程',
    city: text(input.city, 70) || '目的地',
    subtitle: text(input.subtitle, 160),
    homeLabel: text(input.homeLabel, 100),
    start: text(input.start, 10),
    end: text(input.end, 10),
    travelers: Math.min(50, Math.max(1, Number(input.travelers) || 1)),
    maxWalkKm: Math.min(50, Math.max(1, Number(input.maxWalkKm) || 20)),
    checkedAt: text(input.checkedAt, 10),
    center:
      Array.isArray(input.center) &&
      input.center.length === 2 &&
      input.center.every(Number.isFinite)
        ? input.center
        : [30, 110],
    customized: input.customized === true,
    places: [],
    days: [],
    bookings: [],
    photos: [],
  };
  const validId = (x) => typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x);
  for (const p of input.places.slice(0, 400)) {
    if (
      !validId(p.id) ||
      !(
        (p.lat === null && p.lng === null) ||
        (Number.isFinite(p.lat) &&
          Number.isFinite(p.lng) &&
          Math.abs(p.lat) <= 85 &&
          Math.abs(p.lng) <= 180)
      )
    )
      throw new Error('地点坐标或编号不正确。');
    t.places.push({
      id: p.id,
      name: text(p.name, 100) || '未命名地点',
      lat: p.lat,
      lng: p.lng,
      tag: text(p.tag, 80),
      scene: text(p.scene, 40),
      description: text(p.description),
      booking: text(p.booking, 100),
      source: p.source ? safeUrl(p.source) : undefined,
      tips: Array.isArray(p.tips) ? p.tips.slice(0, 20).map((x) => text(x, 500)) : undefined,
    });
  }
  if (new Set(t.places.map((p) => p.id)).size !== t.places.length)
    throw new Error('地点编号重复。');
  const ids = new Set(t.places.map((p) => p.id));
  for (let i = 0; i < input.days.length; i++) {
    const d = input.days[i];
    if (!XJCore.dayDate(d.date) || !Array.isArray(d.stops))
      throw new Error('每天的日期或路线格式不正确。');
    const date = new Date(d.date + 'T12:00:00Z');
    if (Number.isNaN(date.valueOf())) throw new Error('旅程日期不正确。');
    const day = {
      id: 'd' + i,
      date: d.date,
      label: d.date.slice(5).replace('-', '.'),
      weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(date),
      title: text(d.title, 80) || '自由探索',
      subtitle: text(d.subtitle, 160),
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : dayColor(i),
      walk:
        Array.isArray(d.walk) &&
        d.walk.length === 2 &&
        d.walk.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
          ? d.walk
          : [0, 0],
      stops: [],
      legs: [],
    };
    for (const st of d.stops.slice(0, 100)) {
      if (!ids.has(st.place)) throw new Error('路线引用了不存在的地点。');
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(st.time) ? st.time : '10:00';
      day.stops.push({
        place: st.place,
        time,
        duration: text(st.duration, 60) || '自由停留',
        optional: st.optional === true,
        note: text(st.note, 160),
      });
    }
    for (const leg of (Array.isArray(d.legs) ? d.legs : []).slice(0, 100)) {
      if (ids.has(leg.fromId) && ids.has(leg.toId))
        day.legs.push({
          fromId: leg.fromId,
          toId: leg.toId,
          mode: ['walk', 'bike', 'metro', 'bus', 'drive'].includes(leg.mode) ? leg.mode : 'walk',
          note: text(leg.note, 200),
          geometry: leg.geometry ? XJCore.geometry(leg.geometry) : null,
          pathKind: ['calculated', 'manual', 'imported'].includes(leg.pathKind)
            ? leg.pathKind
            : 'schematic',
          source: text(leg.source, 300),
          minutes: Number.isFinite(leg.minutes) ? Math.max(0, leg.minutes) : null,
          distanceMeters: Number.isFinite(leg.distanceMeters)
            ? Math.max(0, leg.distanceMeters)
            : null,
          calculatedAt: text(leg.calculatedAt, 30),
          routeSteps: Array.isArray(leg.routeSteps)
            ? leg.routeSteps.slice(0, 300).map((st) => ({
                name: text(st.name, 200),
                type: text(st.type, 60),
                modifier: text(st.modifier, 60),
                distanceMeters: Number.isFinite(st.distanceMeters)
                  ? Math.max(0, st.distanceMeters)
                  : 0,
              }))
            : [],
          via: Array.isArray(leg.via)
            ? leg.via
                .filter(
                  (c) =>
                    Array.isArray(c) &&
                    c.length === 2 &&
                    c.every(Number.isFinite) &&
                    Math.abs(c[0]) <= 85 &&
                    Math.abs(c[1]) <= 180,
                )
                .slice(0, 50)
            : [],
        });
    }
    t.days.push(day);
  }
  for (const b of (Array.isArray(input.bookings) ? input.bookings : []).slice(0, 100)) {
    if (!validId(b.id) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) continue;
    t.bookings.push({
      id: b.id,
      place: ids.has(b.place) ? b.place : '',
      level: text(b.level, 40) || '准备提醒',
      title: text(b.title, 100),
      date: b.date,
      detail: text(b.detail),
      url: b.url ? safeUrl(b.url) : '',
    });
  }
  t.start = XJCore.dayDate(t.start) ? t.start : t.days[0].date;
  t.end = XJCore.dayDate(t.end) ? t.end : t.days.at(-1).date;
  t.photos = (Array.isArray(input.photos) ? input.photos : []).filter(validPhoto).slice(0, 200);
  return t;
}
function dayColor(i) {
  return ['#b75338', '#b98b2d', '#4e796d', '#777095', '#6386a1', '#9d6673'][i % 6];
}
function makeDays(start, end, existing = []) {
  const first = new Date(start + 'T12:00:00Z'),
    last = new Date(end + 'T12:00:00Z');
  const count = Math.round((last - first) / 86400000) + 1;
  if (!Number.isFinite(count) || count < 1 || count > 31)
    throw new Error('结束日期须不早于出发日期，每次旅程支持1—31天。');
  if (existing.slice(count).some((d) => d.stops.length))
    throw new Error('缩短日期会移除已有路线；请先将末尾几天的地点移走。');
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(+first + i * 86400000).toISOString().slice(0, 10);
    return {
      id: 'd' + i,
      date,
      label: date.slice(5).replace('-', '.'),
      weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(
        new Date(date + 'T12:00:00Z'),
      ),
      title: existing[i]?.title || '自由探索',
      subtitle: existing[i]?.subtitle || '给未知的风景，留一点空间。',
      color: dayColor(i),
      walk: existing[i]?.walk || [0, 0],
      stops: existing[i]?.stops || [],
      legs: existing[i]?.legs || [],
    };
  });
}
function saveJourney() {
  const i = library.findIndex((t) => t.id === trip.id);
  const snapshot = JSON.parse(JSON.stringify(trip));
  snapshot.photos = [];
  if (i >= 0) library[i] = snapshot;
  else library.push(snapshot);
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library.map((t) => ({ ...t, photos: [] }))));
  } catch {
    notify('旅程较多或浏览器存储已满，请导出备份。');
  }
  renderJourneyCards();
}
function renderJourneyCards() {
  $('#journeyCards').innerHTML = library
    .map(
      (t) =>
        `<button class="journey-card ${t.id === trip.id ? 'active' : ''}" data-journey="${t.id}"><span class="trip-city">${esc(t.city)} / ${t.travelers} 人同行</span>${t.id === trip.id ? '<span class="trip-badge">正在打开 ↗</span>' : ''}<h3>${esc(t.title)}</h3><span class="trip-dates">${esc(t.start || t.days[0].date)} — ${esc(t.end || t.days.at(-1).date)}</span><span class="trip-status">${t.days.length} 天</span></button>`,
    )
    .join('');
}
function renderJourneyHeader() {
  $('#heroTrip').textContent = '当前旅程 · ' + trip.title;
  $('#tripStrip').innerHTML =
    `<div><span class="strip-label">这一次的时间</span><strong>${trip.start.slice(5).replace('-', '月')}日 — ${trip.end.slice(5).replace('-', '月')}日</strong><small>${trip.days.length} 天 · ${trip.travelers} 人同行</small></div><div><span class="strip-label">目的地 / 每天的起点</span><strong>${esc(trip.city)}</strong><small>${esc(trip.homeLabel || '住宿待定，慢慢计划')}</small></div><div><span class="strip-label">按自己的步调</span><strong>每天最多 ${trip.maxWalkKm} km 步行</strong><button class="trip-settings" id="journeySettings">旅程设置 ↗</button></div><div class="strip-last"><span class="mini-leaf">❧</span><p>${esc(trip.subtitle || '看见更多风景，也留下更多故事。')}</p></div>`;
  $('#photoTabs').innerHTML =
    '<button class="active" data-filter="all">全部记忆</button>' +
    trip.days.map((d) => `<button data-filter="${d.date}">${d.label}</button>`).join('');
  $('#photoPlace').innerHTML =
    '<option value="">选择照片所属地点</option>' +
    trip.places
      .filter((p) => !['home', 'south', 'xidan', 'dongdan'].includes(p.id))
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join('');
  document.title = trip.title + ' · 行间';
}
async function activateJourney(id, shared = null) {
  trip = JSON.parse(JSON.stringify(library.find((t) => t.id === id) || library[0]));
  if (trip.id === builtinTrip.id && !(trip.photos || []).length)
    trip.photos = builtinTrip.photos || [];
  places = Object.fromEntries(trip.places.map((p) => [p.id, p]));
  KEY = 'xingjian-route-' + trip.id;
  try {
    state = normalState(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    state = normalState({});
  }
  selectedDay = trip.days[0].id;
  if (shared) {
    state = normalState(shared.state);
    if (trip.days.some((d) => d.id === shared.day)) selectedDay = shared.day;
    persist();
    notify('已载入同行分享的旅程。');
  }
  editing = false;
  overviewMode = false;
  photoFilter = 'all';
  pickingLocation = false;
  mapMode = 'plan';
  fitAllStops = false;
  drawing = null;
  localStorage.setItem('xingjian-active-trip', trip.id);
  saveJourney();
  renderJourneyHeader();
  setupMap();
  renderDay();
  renderScenes();
  renderBookings();
  renderPhotos();
  updateUndoButton();
}
async function decodeShared(str) {
  if (str.length > 100000) throw new Error('分享链接过长');
  if (!str.startsWith('z.') && !str.startsWith('j.')) return decodeState(str);
  const prefix = str.slice(0, 2),
    raw = str.slice(2).replace(/-/g, '+').replace(/_/g, '/');
  let bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (prefix === 'z.') {
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持压缩分享链接');
    bytes = new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer(),
    );
  }
  if (bytes.length > 300000) throw new Error('分享内容过大');
  return JSON.parse(new TextDecoder().decode(bytes));
}
const CITY_CENTERS = {
  北京: [39.925, 116.397],
  上海: [31.2304, 121.4737],
  杭州: [30.2741, 120.1551],
  南京: [32.0603, 118.7969],
  成都: [30.5728, 104.0668],
  重庆: [29.563, 106.5516],
  西安: [34.3416, 108.9398],
  广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579],
  苏州: [31.2989, 120.5853],
  厦门: [24.4798, 118.0894],
  东京: [35.6762, 139.6503],
  大阪: [34.6937, 135.5023],
  京都: [35.0116, 135.7681],
  巴黎: [48.8566, 2.3522],
  paris: [48.8566, 2.3522],
  伦敦: [51.5072, -0.1276],
  london: [51.5072, -0.1276],
  纽约: [40.7128, -74.006],
  'new york': [40.7128, -74.006],
};
function openJourneyForm(edit = false) {
  editingJourneyId = edit ? trip.id : null;
  $('#journeyForm').reset();
  $('#journeyFormTitle').textContent = edit ? '这一程，按自己的想法来。' : '准备下一次出发。';
  $('#journeySubmit').textContent = edit ? '保存旅程设置' : '创建旅程';
  if (edit) {
    $('#journeyTitle').value = trip.title;
    $('#journeyCity').value = trip.city;
    $('#journeyStart').value = trip.start;
    $('#journeyEnd').value = trip.end;
    $('#journeyTravelers').value = trip.travelers;
    $('#journeyWalk').value = trip.maxWalkKm;
    $('#journeyHome').value = trip.homeLabel;
    $('#journeySubtitle').value = trip.subtitle;
  } else {
    const date = new Date().toLocaleDateString('en-CA');
    $('#journeyStart').value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '2026-11-15';
    $('#journeyEnd').value = $('#journeyStart').value;
  }
  $('#journeyDialog').showModal();
}
let editingPlaceId = null;
function openStopForm(id = null) {
  editingPlaceId = id;
  $('#stopForm').reset();
  $('#placeSearchResults').innerHTML = '';
  const p = id ? places[id] : null;
  const st = p ? currentDay().stops.find((s) => s.place === id) : null;
  $('#stopName').value = p?.name || '';
  $('#stopLat').value = p?.lat ?? trip.center[0];
  $('#stopLng').value = p?.lng ?? trip.center[1];
  $('#stopTime').value = st?.time || '10:00';
  $('#stopDuration').value = st?.duration || '约60分钟';
  $('#stopDescription').value = p?.description || '';
  $('#stopOptional').checked = st?.optional === true;
  $('#stopSubmit').textContent = id ? '保存地点' : '加到当天路线';
  $('#placeDialog').close();
  $('#stopDialog').showModal();
}
async function searchLocations(query) {
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1100) throw new Error('请稍等一秒再搜索。');
  lastSearchAt = Date.now();
  const response = await fetch(
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
      encodeURIComponent(query),
    {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7' },
    },
  );
  if (!response.ok) throw new Error('位置服务暂不可用，请在地图上选点。');
  return response.json();
}
function publicTrip() {
  const data = materializeTrip(true);
  data.id = trip.id;
  return data;
}
async function importJourneyFile(file) {
  if (!file) return;
  if (file.size > 80e6) throw new Error('文件超过80 MB，请先精简照片。');
  const raw = JSON.parse(await file.text());
  const incoming = validateTrip(XJCore.normalize(raw.trip || raw));
  const incomingState = raw.state ? normalState(raw.state) : normalState({});
  const importPhotos = raw.photos || incoming.photos || [];
  if (!Array.isArray(importPhotos) || !importPhotos.every(validPhoto))
    throw new Error('照片数据不正确。');
  if (importPhotos.length && !db) throw new Error('此浏览器不支持相册保存。');
  const oldTrip = trip;
  trip = incoming;
  for (const p of importPhotos)
    await saveDbPhoto({ id: p.id, src: p.src, date: p.date, place: p.place, caption: p.caption });
  trip = oldTrip;
  incoming.photos = [];
  const at = library.findIndex((t) => t.id === incoming.id);
  if (at >= 0) library[at] = incoming;
  else library.push(incoming);
  localStorage.setItem('xingjian-route-' + incoming.id, JSON.stringify(incomingState));
  if (db) localPhotos = await allDbPhotos();
  await activateJourney(incoming.id);
  notify('旅程已导入；各旅程相册独立保存。');
}
function bindJourneyEvents() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest(
      '[data-journey],[data-edit-place],[data-search-index],[data-remove-booking],#journeySettings',
    );
    if (!el) return;
    if (el.dataset.journey) await activateJourney(el.dataset.journey);
    if (el.id === 'journeySettings') openJourneyForm(true);
    if (el.dataset.editPlace) openStopForm(el.dataset.editPlace);
    if (el.dataset.searchIndex) {
      const item = searchResults[Number(el.dataset.searchIndex)];
      if (item) {
        $('#stopLat').value = Number(item.lat).toFixed(6);
        $('#stopLng').value = Number(item.lon).toFixed(6);
        $('#placeSearchResults').innerHTML =
          '<p class="scene-note">位置已填写：' + esc(item.display_name) + '</p>';
        if (map) map.setView([Number(item.lat), Number(item.lon)], 14);
      }
    }
    if (el.dataset.removeBooking) {
      trip.bookings = trip.bookings.filter((b) => b.id !== el.dataset.removeBooking);
      trip.customized = true;
      saveJourney();
      renderBookings();
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'dayNameInput') {
      currentDay().title = e.target.value.slice(0, 80) || '自由探索';
      trip.customized = true;
      saveJourney();
      renderTabs();
    }
    if (['walkMin', 'walkMax'].includes(e.target.id)) {
      const a = Number($('#walkMin').value),
        b = Number($('#walkMax').value);
      if (a < 0 || b < a || b > trip.maxWalkKm) {
        notify('步行区间需从小到大，且不超过每天的上限。');
        renderDay();
        return;
      }
      currentDay().walk = [a, b];
      trip.customized = true;
      saveJourney();
      renderDay();
    }
  });
  $('#newJourney').onclick = () => openJourneyForm();
  $('#journeyForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const start = $('#journeyStart').value,
        end = $('#journeyEnd').value,
        edit = editingJourneyId === trip.id;
      const d = makeDays(start, end, edit ? trip.days : []);
      const city = $('#journeyCity').value.trim();
      const center =
        CITY_CENTERS[city] || CITY_CENTERS[city.toLowerCase()] || (edit ? trip.center : [30, 110]);
      const next = validateTrip({
        id: edit ? trip.id : 'trip-' + crypto.randomUUID(),
        title: $('#journeyTitle').value.trim(),
        city,
        start,
        end,
        travelers: Number($('#journeyTravelers').value),
        maxWalkKm: Number($('#journeyWalk').value),
        homeLabel: $('#journeyHome').value.trim(),
        subtitle: $('#journeySubtitle').value.trim(),
        center,
        places: edit ? trip.places : [],
        days: d,
        bookings: edit ? trip.bookings : [],
        photos: [],
        customized: true,
      });
      const i = library.findIndex((t) => t.id === next.id);
      if (i >= 0) library[i] = next;
      else library.push(next);
      $('#journeyDialog').close();
      await activateJourney(next.id);
      notify(edit ? '旅程设置已保存。' : '新旅程已创建。点击添加地点，开始画路线。');
      $('#atlas').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      notify(err.message);
    }
  };
  $('#addStop').onclick = () => openStopForm();
  $('#pickMap').onclick = () => {
    if (!map) return notify('地图组件不可用，请搜索位置或填写坐标。');
    pickingLocation = true;
    $('#stopDialog').close();
    $('.map-shell').classList.add('map-picking');
    $('#mapDay').textContent = '点击地图，选定地点位置';
    $('#routeNotice').textContent = '点击地图选位置，将自动返回地点表单。支持拖动、缩放地图。';
    $('#atlas').scrollIntoView({ behavior: 'smooth' });
  };
  $('#searchPlace').onclick = async () => {
    const name = $('#stopName').value.trim();
    if (!name) return notify('先写一个地点名称。');
    $('#searchPlace').disabled = true;
    try {
      searchResults = await searchLocations(trip.city + ' ' + name);
      $('#placeSearchResults').innerHTML = searchResults.length
        ? searchResults
            .map(
              (r, i) =>
                `<button type="button" class="search-result" data-search-index="${i}">${esc(r.display_name)}</button>`,
            )
            .join('')
        : '<p class="scene-note">没有找到，试试更完整的名称，或在地图上选点。</p>';
    } catch {
      notify('搜索暂不可用，可以在地图上选点或填写坐标。');
    } finally {
      $('#searchPlace').disabled = false;
    }
  };
  $('#stopForm').onsubmit = (e) => {
    e.preventDefault();
    const lat = Number($('#stopLat').value),
      lng = Number($('#stopLng').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180)
      return notify('请先选择有效的位置。');
    const id = editingPlaceId || 'p-' + crypto.randomUUID();
    const previous = places[id];
    const p = {
      ...previous,
      id,
      name: $('#stopName').value.trim(),
      lat,
      lng,
      tag: previous?.tag || '旅途的一站',
      scene: previous?.scene || '',
      description: $('#stopDescription').value.trim(),
    };
    if (!p.name) return;
    const st = {
      place: id,
      time: $('#stopTime').value,
      duration: $('#stopDuration').value.trim() || '自由停留',
      optional: $('#stopOptional').checked,
    };
    if (previous) {
      trip.places[trip.places.findIndex((x) => x.id === id)] = p;
      const s = currentDay().stops.find((x) => x.place === id);
      if (s) Object.assign(s, st);
    } else {
      trip.places.push(p);
      const last = dayStops(currentDay()).at(-1);
      currentDay().stops.push(st);
      if (last)
        currentDay().legs.push({
          fromId: last.place,
          toId: id,
          mode: $('#stopMode').value,
          note: '自行规划：' + $('#stopMode').selectedOptions[0].textContent,
          via: [],
        });
    }
    places[id] = p;
    trip.customized = true;
    saveJourney();
    $('#stopDialog').close();
    renderJourneyHeader();
    renderDay();
    renderScenes();
    notify(previous ? '地点已修改。' : '已添加到当天路线。步行距离请按实际路线估算。');
  };
  $('#addBooking').onclick = () => {
    $('#bookingForm').reset();
    $('#bookingDate').value = trip.start;
    $('#bookingDialog').showModal();
  };
  $('#bookingForm').onsubmit = (e) => {
    e.preventDefault();
    trip.bookings.push({
      id: 'bk-' + crypto.randomUUID(),
      place: '',
      level: '准备提醒',
      title: $('#bookingTitle').value.trim(),
      date: $('#bookingDate').value,
      detail: $('#bookingDetail').value.trim(),
      url: $('#bookingUrl').value.trim(),
    });
    trip.customized = true;
    saveJourney();
    renderBookings();
    $('#bookingDialog').close();
    notify('提醒已加入；下载并导入日历后才能收到日历提醒。');
  };
  $('#backup').onclick = () => {
    download(
      trip.title + '-完整旅行备份.json',
      JSON.stringify(
        {
          type: 'xingjian-journey-backup',
          version: 2,
          trip: { ...trip, photos: [] },
          state,
          photos: mergedPhotos().map(({ published, ...p }) => p),
        },
        null,
        2,
      ),
    );
    notify('已导出此旅程和照片，可交给同行导入。');
  };
  $('#exportRoute').onclick = () => {
    download(trip.title + '-旅程.json', JSON.stringify(materializeTrip(false), null, 2));
    notify('已导出此旅程，可从「导入旅程」重新打开。');
  };
  $('#exportPublic').onclick = () => {
    download('trip.json', JSON.stringify(publicTrip(), null, 2));
    notify('替换项目 dist/data/trip.json 并重新部署后，大家可看见此旅程与相册。');
  };
  $('#importButton').onclick = () => $('#journeyImportInput').click();
  $('#importJourney').onclick = () => $('#journeyImportInput').click();
  $('#journeyImportInput').onchange = async () => {
    try {
      await importJourneyFile($('#journeyImportInput').files[0]);
    } catch (err) {
      notify(err.message || '导入失败，请检查旅程文件。');
    } finally {
      $('#journeyImportInput').value = '';
    }
  };
}

function connectedSegments(day = currentDay()) {
  const stops = dayStops(day),
    out = [];
  for (let i = 1; i < stops.length; i++) {
    const from = places[stops[i - 1].place],
      to = places[stops[i].place];
    if (!from || !to || from.id === to.id) continue;
    const leg = day.legs.find((l) => l.fromId === from.id && l.toId === to.id);
    out.push({
      index: i - 1,
      from,
      to,
      leg: leg || {
        fromId: from.id,
        toId: to.id,
        mode: 'unknown',
        note: '请选择交通方式并细化此段',
        via: [],
      },
    });
  }
  return out;
}
function pathLabel(leg, from, to) {
  if (!XJCore.located(from) || !XJCore.located(to)) return '待定位';
  if (!leg?.geometry) return '示意连线 · 未算路';
  if (!XJCore.aligned(leg.geometry, from, to)) return '路径端点待核对';
  return (
    {
      calculated: '沿道路计算 · OSM参考',
      manual: '手绘路径 · 参考',
      imported: '导入路径 · 待核验',
    }[leg.pathKind] || '导入路径 · 待核验'
  );
}
function modeName(mode) {
  return (
    {
      walk: '步行',
      bike: '自行车',
      metro: '地铁 / 公共交通',
      bus: '公交',
      drive: '驾车',
      unknown: '交通待选',
    }[mode] || '交通待选'
  );
}
function renderSegmentList() {
  if (!trip || !$('#segmentList')) return;
  const items = connectedSegments();
  $('#segmentList').innerHTML =
    mapMode === 'memories'
      ? '<h4 class="segment-heading">照片地图</h4><p class="scene-note">每枚图钉代表一个地点的照片集。照片归属和位置都可以重新调整。</p>'
      : items.length
        ? '<h4 class="segment-heading">逐段细化 · ' +
          items.length +
          ' 段</h4>' +
          items
            .map(
              (s) =>
                `<div class="segment-row"><div><strong>${esc(s.from.name)} → ${esc(s.to.name)}</strong><p>${esc(modeName(s.leg.mode))}${Number.isFinite(s.leg.distanceMeters) ? ' · ' + (s.leg.distanceMeters / 1000).toFixed(2) + ' km' : ''}${Number.isFinite(s.leg.minutes) ? ' · ' + Math.round(s.leg.minutes) + '分钟' : ''}</p><span class="path-badge ${s.leg.pathKind === 'calculated' ? 'calculated' : 'pending'}">${esc(pathLabel(s.leg, s.from, s.to))}</span><p>${esc(s.leg.note || '补充入口、换乘与沿途说明。')}</p></div><button data-segment="${s.index}">编辑此段 ↗</button></div>`,
            )
            .join('')
        : '';
}
function storeLeg(day, leg) {
  const i = day.legs.findIndex((l) => l.fromId === leg.fromId && l.toId === leg.toId);
  if (i >= 0) day.legs[i] = leg;
  else day.legs.push(leg);
  trip.customized = true;
  saveJourney();
}
function invalidatePaths(id) {
  for (const d of trip.days)
    for (const leg of d.legs)
      if (leg.fromId === id || leg.toId === id) {
        delete leg.geometry;
        delete leg.routeSteps;
        delete leg.distanceMeters;
        delete leg.minutes;
        leg.pathKind = 'schematic';
      }
}
function openSegment(index) {
  const s = connectedSegments().find((s) => s.index === Number(index));
  if (!s) return;
  activeSegment = { ...s, dayId: currentDay().id, tripId: trip.id };
  $('#segmentTitle').textContent = s.from.name + ' → ' + s.to.name;
  $('#segmentMode').value = s.leg.mode === 'unknown' ? 'walk' : s.leg.mode;
  $('#segmentNote').value = s.leg.note || '';
  $('#segmentMinutes').value = s.leg.minutes ?? '';
  $('#segmentKm').value = Number.isFinite(s.leg.distanceMeters)
    ? (s.leg.distanceMeters / 1000).toFixed(2)
    : '';
  $('#pathStatus').textContent = pathLabel(s.leg, s.from, s.to);
  $('#turnList').innerHTML = (s.leg.routeSteps || [])
    .map(
      (st, i) =>
        `<p>${i + 1}. ${esc(turnText(st))}${st.name ? ' · ' + esc(st.name) : ''} · ${Math.round(st.distanceMeters || 0)} m</p>`,
    )
    .join('');
  $('#segmentDialog').showModal();
}
function turnText(step) {
  if (step.type === 'depart') return '从起点出发';
  if (step.type === 'arrive') return '抵达终点';
  const turn = {
    left: '左转',
    right: '右转',
    'slight left': '稍向左',
    'slight right': '稍向右',
    straight: '继续直行',
    'sharp left': '向左急转',
    'sharp right': '向右急转',
    uturn: '掉头',
  };
  return turn[step.modifier] || '沿路径前进';
}
function currentSegmentLeg() {
  if (!activeSegment || activeSegment.tripId !== trip.id)
    throw new Error('旅程已切换，请重新打开路段。');
  const day = trip.days.find((d) => d.id === activeSegment.dayId);
  if (!day) throw new Error('当天路线已改变。');
  return {
    day,
    leg: {
      ...activeSegment.leg,
      mode: $('#segmentMode').value,
      note: $('#segmentNote').value.trim(),
      minutes: $('#segmentMinutes').value === '' ? null : Number($('#segmentMinutes').value),
      distanceMeters:
        $('#segmentKm').value === '' ? null : Math.round(Number($('#segmentKm').value) * 1000),
    },
  };
}
async function calculateSegment() {
  let record;
  try {
    record = currentSegmentLeg();
  } catch (err) {
    return notify(err.message);
  }
  const { day, leg } = record,
    { from, to } = activeSegment;
  if (!XJCore.located(from) || !XJCore.located(to))
    return notify('先为两个地点确认位置，再计算路径。');
  if (!['walk', 'bike', 'drive'].includes(leg.mode))
    return notify('公交和地铁请填写实际换乘，或导入路线 / 手绘线路。');
  if (Date.now() - lastRouteRequest < 1100) return notify('请稍等一秒再查询。');
  const owner = trip.id,
    coords = [from.lng, from.lat, to.lng, to.lat].join(',');
  lastRouteRequest = Date.now();
  $('#calculatePath').disabled = true;
  $('#pathStatus').textContent = '正在向开源服务查询道路路径…';
  try {
    const profile = { walk: 'foot', bike: 'bike', drive: 'car' }[leg.mode];
    const endpoint = `https://routing.openstreetmap.de/routed-${profile}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(18000) });
    if (!response.ok) throw new Error('服务暂不可用');
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('没有找到可用路径');
    if (owner !== trip.id || coords !== [from.lng, from.lat, to.lng, to.lat].join(','))
      throw new Error('地点已变化，请重新查询');
    const route = data.routes[0],
      g = XJCore.geometry(route.geometry);
    if (!XJCore.aligned(g, from, to)) throw new Error('道路匹配偏离地点较远，请先确认入口');
    Object.assign(leg, {
      geometry: g,
      pathKind: 'calculated',
      source: 'FOSSGIS OSRM / OpenStreetMap',
      distanceMeters: Math.round(route.distance),
      minutes: Math.round(route.duration / 60),
      calculatedAt: new Date().toISOString(),
      routeSteps: route.legs
        .flatMap((l) => l.steps || [])
        .slice(0, 300)
        .map((st) => ({
          name: st.name || '',
          distanceMeters: Math.round(st.distance || 0),
          type: st.maneuver?.type || '',
          modifier: st.maneuver?.modifier || '',
        })),
    });
    storeLeg(day, leg);
    activeSegment.leg = leg;
    $('#segmentDialog').close();
    renderDay();
    openSegment(activeSegment.index);
    notify('路径已计算并保存；公园入口、开放和现场通行仍需确认。');
  } catch (err) {
    $('#pathStatus').textContent =
      '未能取得道路路径：' +
      (err.name === 'TimeoutError' ? '连接超时' : err.message) +
      '。可以手绘或导入 GeoJSON。';
    notify('算路暂不可用，保留明确标注的示意连线。');
  } finally {
    $('#calculatePath').disabled = false;
  }
}
function startDrawing() {
  let record;
  try {
    record = currentSegmentLeg();
  } catch (err) {
    return notify(err.message);
  }
  if (!map) return notify('地图组件暂不可用，请改用路径文件导入。');
  if (!XJCore.located(activeSegment.from) || !XJCore.located(activeSegment.to))
    return notify('先为两个地点定位。');
  drawing = {
    ...record,
    from: activeSegment.from,
    to: activeSegment.to,
    tripId: trip.id,
    points: [[activeSegment.from.lat, activeSegment.from.lng]],
  };
  $('#segmentDialog').close();
  $('#drawingToolbar').hidden = false;
  $('#mapDay').textContent = '手绘参考路径 / 点击添加转折点';
  $('#atlas').scrollIntoView({ behavior: 'smooth' });
  drawScratch();
}
function addDrawingPoint(ll) {
  if (!drawing) return;
  drawing.points.push([ll.lat, ll.lng]);
  drawScratch();
}
function drawScratch() {
  if (!drawing || !map) return;
  if (drawingLayer) map.removeLayer(drawingLayer);
  drawingLayer = L.featureGroup().addTo(map);
  L.polyline([...drawing.points, [drawing.to.lat, drawing.to.lng]], {
    color: '#9c7045',
    weight: 4,
    dashArray: '3 4',
  }).addTo(drawingLayer);
  drawing.points.forEach((p, i) => {
    const marker = L.marker(p, {
      draggable: i > 0,
      icon: L.divIcon({
        className: 'draw-waypoint',
        html: '<span class="map-number" style="--pin:#a27548">' + (i ? '·' : '起') + '</span>',
        iconSize: [25, 25],
        iconAnchor: [12, 12],
      }),
    }).addTo(drawingLayer);
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      drawing.points[i] = [ll.lat, ll.lng];
      drawScratch();
    });
  });
}
function stopDrawing(save = false) {
  if (!drawing) return;
  if (save) {
    const points = [...drawing.points, [drawing.to.lat, drawing.to.lng]];
    const g = XJCore.geometry(points.map((c) => [c[1], c[0]]));
    Object.assign(drawing.leg, {
      geometry: g,
      pathKind: 'manual',
      source: '用户手绘参考',
      distanceMeters: Math.round(XJCore.length(g)),
      routeSteps: [],
    });
    storeLeg(drawing.day, drawing.leg);
    notify('手绘路径已保存，显示为参考路径。');
  }
  drawing = null;
  if (drawingLayer && map) map.removeLayer(drawingLayer);
  drawingLayer = null;
  $('#drawingToolbar').hidden = true;
  renderDay();
}
function renderPlaceAlbum(id) {
  const photos = mergedPhotos().filter((p) => p.place === id);
  const body = $('#placeContent .place-body');
  if (!body) return;
  body.insertAdjacentHTML(
    'beforeend',
    `<section class="place-album"><h3>这个地方的记忆 · ${photos.length} 张</h3>${photos.length ? '<div class="place-album-grid">' + photos.map((p) => `<button data-view-photo="${esc(p.id)}"><img src="${esc(p.src)}" alt="${esc(p.caption || '旅行照片')}"><span>${esc(p.date)} · ${esc(p.caption)}</span></button>`).join('') + '</div>' : '<p>还没有照片。旅行时，给这里留下一张自己的照片。</p>'}</section>`,
  );
}
function showPhoto(id) {
  const p = mergedPhotos().find((p) => p.id === id);
  if (!p) return;
  $('#fullPhoto').src = p.src;
  $('#fullPhotoCaption').textContent =
    (places[p.place]?.name || '地点待关联') + ' · ' + p.date + ' · ' + p.caption;
  $('#imageDialog').showModal();
}
function relocatePhoto(id) {
  const p = mergedPhotos().find((p) => p.id === id);
  if (!p) return;
  $('#infoContent').innerHTML =
    '<div class="eyebrow">PUT IT BACK ON THE MAP</div><h2>这一刻，属于哪个地方？</h2><select id="relocateSelect" class="photo-place-picker">' +
    trip.places
      .map(
        (pt) =>
          `<option value="${pt.id}" ${pt.id === p.place ? 'selected' : ''}>${esc(pt.name)}</option>`,
      )
      .join('') +
    '</select><button id="savePhotoLocation" class="button dark small">保存照片归属</button>';
  $('#infoDialog').showModal();
  $('#savePhotoLocation').onclick = async () => {
    try {
      await saveDbPhoto({ ...p, place: $('#relocateSelect').value, published: undefined });
      localPhotos = await allDbPhotos();
      $('#infoDialog').close();
      renderPhotos();
      renderScenes();
      notify('照片已放回对应地点。');
    } catch {
      notify('保存失败，请重试。');
    }
  };
}
function aiPrompt() {
  const req =
    $('#aiRequirements').value.trim() || '请为我规划或细化一次旅行，优先顺路、留足停留和换乘时间。';
  const current = $('#aiIncludeCurrent').checked ? materializeTrip(false) : null;
  if (current) {
    for (const d of current.days)
      for (const leg of d.legs) {
        delete leg.geometry;
        delete leg.routeSteps;
        delete leg.via;
      }
    delete current.photos;
  }
  const example = {
    format: 'xingjian/1',
    coordinateSystem: 'WGS84',
    title: '一次慢旅行',
    city: '目的地城市',
    startDate: '2027-04-02',
    endDate: '2027-04-02',
    travelers: 2,
    maxWalkKm: 20,
    base: '住宿或起点',
    days: [
      {
        date: '2027-04-02',
        title: '第一天主题',
        walkKm: [4, 7],
        stops: [
          {
            id: 'p-a',
            name: '地点A',
            lat: null,
            lng: null,
            time: '09:00',
            duration: '约90分钟',
            description: '参观重点与入口说明',
            optional: false,
            booking: '是否需预约，未查证写待确认',
            source: '官方资料URL',
          },
          {
            id: 'p-b',
            name: '地点B',
            lat: null,
            lng: null,
            time: '12:00',
            duration: '午餐约60分钟',
          },
        ],
        legs: [
          {
            from: 'p-a',
            to: 'p-b',
            mode: 'walk',
            note: '具体街道或公共交通换乘；未查证请写待确认',
            minutes: 20,
          },
        ],
      },
    ],
    reminders: [
      {
        title: '检查门票预约',
        date: '2027-03-28',
        detail: '官方可售日待确认，提醒日只是建议检查日',
        url: '',
      },
    ],
  };
  return `你是一位细致的旅行规划助手。请根据用户需求生成能直接导入“行间”网站的 JSON 路线，而非仅输出文字攻略。\n\n用户需求：\n${req}\n\n${current ? '当前旅程（请在此基础上细化，保留原地点 id 以关联照片）：\n' + JSON.stringify(current, null, 2) + '\n\n' : ''}要求：\n1. 只输出一个完整的 JSON 代码块，format 固定为 "xingjian/1"，结构参照下面示例。\n2. 每一天都写准确日期，按日期先后排列。时间合理、留出吃饭、排队、地铁进出和返程缓冲。每天步行不超过用户上限。\n3. 地点用稳定、不重复的英文字母/数字/短横线 id；重复到访同一地点复用 id。legs 的 from/to 必须引用当天 stops 的 id。\n4. 坐标只能使用已核实的 WGS84，lat 是纬度，lng 是经度。不要把高德/百度坐标直接当 WGS84。不确定位置时 lat、lng 都填 null，网站会标为待定位。\n5. mode 仅可为 walk、bike、metro、bus、drive。公交/地铁说明应写线路、换乘、上下车站和预留时间；不确定的事实明确写待确认。\n6. 不要编造沿道路的折线路径或路径点。只有从可信算路服务/真实轨迹得到完整线路时，才可在 leg 中加入 geometry:{"type":"LineString","coordinates":[[经度,纬度],...]}；否则省略，网站会显示示意线，之后可逐段算路。\n7. 预约、开放、餐馆和季节景色请查官方或可靠资料；无法联网时明确待核实。reminders 日期是建议检查日，不能假装官方放票日。\n8. walkKm 是含园内游览的规划估计，无法估算写 [0,0]。不要用直线距离当实际步行距离。\n\n格式示例（示例中的未知坐标不要照抄成真）：\n${JSON.stringify(example, null, 2)}`;
}
function updatePromptPreview() {
  $('#aiPromptPreview').textContent = aiPrompt();
}
function openAiPlanner() {
  stagedImport = null;
  $('#aiImportError').textContent = '';
  $('#aiImportPreview').hidden = true;
  $('#confirmAiImport').disabled = true;
  updatePromptPreview();
  $('#aiDialog').showModal();
}
function importPreview() {
  stagedImport = null;
  $('#confirmAiImport').disabled = true;
  $('#aiImportError').textContent = '';
  try {
    const raw = XJCore.parse($('#aiImportText').value),
      incoming = validateTrip(raw);
    const missing = incoming.places.filter((p) => !XJCore.located(p)).length;
    const segments = incoming.days.flatMap((d) => d.legs),
      paths = segments.filter((l) => l.geometry).length;
    const warnings = [];
    if (missing) warnings.push(missing + ' 处地点待定位；暂不画到地图上。');
    if (paths) warnings.push(paths + ' 段导入路径会标为参考，不自动视为真实导航。');
    if (incoming.days.some((d) => d.walk[1] > incoming.maxWalkKm))
      warnings.push('有日期的步行估算超过设定上限，请导入后调整。');
    if (incoming.days.some((d) => d.stops.some((s, i, a) => i > 0 && s.time < a[i - 1].time)))
      warnings.push('有一天的时间顺序不递增，请复核。');
    stagedImport = incoming;
    $('#aiImportPreview').innerHTML =
      `<div class="import-preview-box"><strong>${esc(incoming.title)} · ${esc(incoming.city)}</strong><p>${incoming.days.length} 天 / ${incoming.places.length} 个地点 / ${segments.length} 段交通 / ${incoming.bookings.length} 个提醒</p><ul>${incoming.days.map((d) => '<li>' + d.date + ' · ' + esc(d.title) + ' · ' + d.stops.length + '站</li>').join('')}</ul>${warnings.map((w) => '<p>△ ' + esc(w) + '</p>').join('')}</div>`;
    $('#aiImportPreview').hidden = false;
    $('#confirmAiImport').disabled = false;
  } catch (err) {
    $('#aiImportError').textContent = err.message;
    $('#aiImportPreview').hidden = true;
  }
}
async function applyAiImport() {
  if (!stagedImport) return;
  const incoming = JSON.parse(JSON.stringify(stagedImport));
  if ($('#aiImportMode').value === 'update') {
    const oldId = trip.id;
    try {
      localStorage.setItem(
        'xingjian-before-ai-' + oldId,
        JSON.stringify({ trip: { ...trip, photos: [] }, state }),
      );
    } catch {
      return notify('无法保存更新前的版本；请导出备份后选择作为新旅程导入。');
    }
    const mapping = new Map();
    for (const p of incoming.places) {
      const match =
        trip.places.find((old) => old.id === p.id) ||
        trip.places.find((old) => old.name.trim() === p.name.trim());
      if (match) mapping.set(p.id, match.id);
    }
    for (const p of incoming.places) if (mapping.has(p.id)) p.id = mapping.get(p.id);
    for (const d of incoming.days) {
      for (const st of d.stops) st.place = mapping.get(st.place) || st.place;
      for (const l of d.legs) {
        l.fromId = mapping.get(l.fromId) || l.fromId;
        l.toId = mapping.get(l.toId) || l.toId;
      }
    }
    for (const b of incoming.bookings) b.place = mapping.get(b.place) || b.place;
    const photoPlaces = new Set(mergedPhotos().map((p) => p.place));
    for (const p of trip.places)
      if (photoPlaces.has(p.id) && !incoming.places.some((x) => x.id === p.id))
        incoming.places.push(p);
    incoming.id = oldId;
    incoming.photos = trip.photos || [];
    state = normalState({});
    localStorage.setItem('xingjian-route-' + oldId, JSON.stringify(state));
  } else incoming.id = 'trip-' + crypto.randomUUID();
  incoming.customized = true;
  const checked = validateTrip(incoming),
    i = library.findIndex((t) => t.id === checked.id);
  if (i >= 0) library[i] = checked;
  else library.push(checked);
  $('#aiDialog').close();
  await activateJourney(checked.id);
  notify('方案已导入。可调整顺序、定位地点，再逐段补全路径。');
  $('#atlas').scrollIntoView({ behavior: 'smooth' });
}
function updateUndoButton() {
  const existing = $('#undoAiUpdate');
  if (existing) existing.remove();
  if (!trip || !localStorage.getItem('xingjian-before-ai-' + trip.id)) return;
  const b = document.createElement('button');
  b.id = 'undoAiUpdate';
  b.className = 'text-button';
  b.textContent = '撤销上次 AI 更新 ↶';
  b.onclick = async () => {
    try {
      const saved = JSON.parse(localStorage.getItem('xingjian-before-ai-' + trip.id));
      const old = validateTrip(saved.trip);
      library[library.findIndex((t) => t.id === trip.id)] = old;
      localStorage.setItem('xingjian-route-' + trip.id, JSON.stringify(normalState(saved.state)));
      localStorage.removeItem('xingjian-before-ai-' + trip.id);
      await activateJourney(old.id);
      notify('已恢复更新前方案，照片保留。');
    } catch {
      notify('无法恢复，请导入之前的备份。');
    }
  };
  $('#atlas .head-actions').append(b);
}
function bindMapFeatures() {
  const switchMode = (mode) => {
    mapMode = mode;
    renderDay();
  };
  $('#planMode').onclick = () => switchMode('plan');
  $('#memoryMode').onclick = () => switchMode('memories');
  $('#openMemoryMap').onclick = () => {
    switchMode('memories');
    $('#atlas').scrollIntoView({ behavior: 'smooth' });
  };
  $('#showLabels').onchange = renderMap;
  $('#focusMap').onclick = () => {
    $('#atlas').classList.toggle('focused');
    $('#focusMap').textContent = $('#atlas').classList.contains('focused')
      ? '收起地图 ⤡'
      : '展开地图 ⤢';
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 30);
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-segment],[data-view-photo],[data-relocate-photo]');
    if (el?.dataset.segment !== undefined) openSegment(el.dataset.segment);
    if (el?.dataset.viewPhoto) showPhoto(el.dataset.viewPhoto);
    if (el?.dataset.relocatePhoto) relocatePhoto(el.dataset.relocatePhoto);
    if (e.target.matches('.photo-card>img')) {
      const card = e.target.closest('.photo-card');
      const button = card.querySelector('[data-relocate-photo]');
      if (button) showPhoto(button.dataset.relocatePhoto);
    }
  });
  $('#segmentForm').onsubmit = (e) => {
    e.preventDefault();
    try {
      const { day, leg } = currentSegmentLeg();
      if (activeSegment.leg.mode !== leg.mode) {
        delete leg.geometry;
        delete leg.routeSteps;
        leg.pathKind = 'schematic';
      }
      storeLeg(day, leg);
      $('#segmentDialog').close();
      renderDay();
      notify('这一段已更新。');
    } catch (err) {
      notify(err.message);
    }
  };
  $('#calculatePath').onclick = calculateSegment;
  $('#drawPath').onclick = startDrawing;
  $('#undoWaypoint').onclick = () => {
    if (drawing?.points.length > 1) {
      drawing.points.pop();
      drawScratch();
    }
  };
  $('#finishDrawing').onclick = () => stopDrawing(true);
  $('#cancelDrawing').onclick = () => stopDrawing(false);
  $('#segmentGeometryInput').onchange = async () => {
    const file = $('#segmentGeometryInput').files[0];
    if (!file) return;
    try {
      if (file.size > 3e6) throw new Error('路径文件请小于3 MB。');
      const g = XJCore.geometry(JSON.parse(await file.text())),
        { day, leg } = currentSegmentLeg();
      Object.assign(leg, {
        geometry: g,
        pathKind: 'imported',
        source: '用户导入 GeoJSON',
        distanceMeters: Math.round(XJCore.length(g)),
        routeSteps: [],
      });
      storeLeg(day, leg);
      $('#pathStatus').textContent = pathLabel(leg, activeSegment.from, activeSegment.to);
      activeSegment.leg = leg;
      renderDay();
      notify('路径已导入；请确认端点与实际通行。');
    } catch (err) {
      notify(err.message);
    } finally {
      $('#segmentGeometryInput').value = '';
    }
  };
  $('#aiPlanner').onclick = openAiPlanner;
  $('#aiRequirements').oninput = updatePromptPreview;
  $('#aiIncludeCurrent').onchange = updatePromptPreview;
  $('#copyAiPrompt').onclick = async () => {
    const prompt = aiPrompt();
    updatePromptPreview();
    try {
      await navigator.clipboard.writeText(prompt);
      notify('提示词已复制。发给常用 AI，再把完整 JSON 贴回来。');
    } catch {
      $('#aiPromptPreview').parentElement.open = true;
      notify('请从展开的提示词中手动复制。');
    }
  };
  $('#previewAiImport').onclick = importPreview;
  $('#aiImportText').oninput = () => {
    stagedImport = null;
    $('#confirmAiImport').disabled = true;
  };
  $('#confirmAiImport').onclick = applyAiImport;
  $('#loadAiExample').onclick = async () => {
    const response = await fetch('data/ai-example.json');
    $('#aiImportText').value = JSON.stringify(await response.json(), null, 2);
    importPreview();
  };
  const oldStopSubmit = $('#stopForm').onsubmit;
  $('#stopForm').onsubmit = (e) => {
    const old = editingPlaceId ? places[editingPlaceId] : null;
    const before = old ? [old.lat, old.lng].join(',') : null;
    oldStopSubmit(e);
    if (old && before !== [places[old.id].lat, places[old.id].lng].join(',')) {
      invalidatePaths(old.id);
      saveJourney();
      renderDay();
    }
  };
  updateUndoButton();
}

async function init() {
  const [data, meta] = await Promise.all([
    fetch('data/trip.json').then((r) => {
      if (!r.ok) throw new Error('旅程数据未能加载');
      return r.json();
    }),
    fetch('assets/photos/manifest.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
  ]);
  builtinTrip = validateTrip(data);
  photosMeta = meta;
  try {
    library = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]').map(validateTrip);
  } catch {
    library = [];
  }
  if (!library.some((t) => t.id === builtinTrip.id)) library.unshift(builtinTrip);
  let preferred = localStorage.getItem('xingjian-active-trip') || builtinTrip.id;
  let shared = null;
  if (location.hash.startsWith('#trip=')) {
    try {
      shared = await decodeShared(location.hash.slice(6));
      if (shared.trip) {
        const incoming = validateTrip(shared.trip);
        const i = library.findIndex((t) => t.id === incoming.id);
        if (i >= 0) library[i] = incoming;
        else library.push(incoming);
        preferred = incoming.id;
      } else preferred = builtinTrip.id;
    } catch {
      notify('分享链接无法读取，已显示自己的旅程。');
    }
  }
  try {
    await openDb();
    localPhotos = await allDbPhotos();
  } catch {
    notify('当前浏览器无法保存照片，路线仍可使用。');
  }
  await activateJourney(preferred, shared);
  bindEvents();
  bindJourneyEvents();
  bindMapFeatures();
}
init().catch((err) => {
  console.error(err);
  $('#daySummary').innerHTML =
    '<div class="day-summary"><h3>暂时无法加载行程</h3><p>请刷新重试；本地预览需要通过 HTTP 服务打开，不能直接双击 HTML。</p></div>';
  notify('行程加载失败，请刷新。');
});
