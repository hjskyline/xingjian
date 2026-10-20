/* Official AMap JS API adapter. Stored trips remain WGS84 across providers. */
(function (root) {
  'use strict';
  const pi = Math.PI,
    a = 6378245,
    ee = 0.006693421622965943;
  function outside(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function toGCJ(point) {
    const [lng, lat] = point;
    if (outside(lng, lat)) return [lng, lat];
    const x = lng - 105,
      y = lat - 35;
    let dy = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    dy += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
    dy += ((20 * Math.sin(y * pi) + 40 * Math.sin((y * pi) / 3)) * 2) / 3;
    dy += ((160 * Math.sin((y * pi) / 12) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
    let dx = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    dx += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
    dx += ((20 * Math.sin(x * pi) + 40 * Math.sin((x * pi) / 3)) * 2) / 3;
    dx += ((150 * Math.sin((x * pi) / 12) + 300 * Math.sin((x * pi) / 30)) * 2) / 3;
    const r = (lat * pi) / 180,
      magic = 1 - ee * Math.sin(r) ** 2;
    dy = (dy * 180) / (((a * (1 - ee)) / (magic * Math.sqrt(magic))) * pi);
    dx = (dx * 180) / ((a / Math.sqrt(magic)) * Math.cos(r) * pi);
    return [lng + dx, lat + dy];
  }
  function toWGS(point) {
    if (outside(...point)) return [...point];
    const out = [...point];
    for (let i = 0; i < 8; i++) {
      const q = toGCJ(out),
        dx = q[0] - point[0],
        dy = q[1] - point[1];
      out[0] -= dx;
      out[1] -= dy;
      if (Math.abs(dx) + Math.abs(dy) < 1e-9) break;
    }
    return out;
  }
  const coords = (p) => [p.lng ?? p.getLng(), p.lat ?? p.getLat()];
  const latlng = (p) => {
    const c = toWGS(coords(p));
    return { lat: c[1], lng: c[0] };
  };
  const gcjLatLng = (p) => toGCJ([p[1], p[0]]);
  let ready = false,
    problem = '',
    loading;
  const config = () => root.XJ_MAP_CONFIG || { provider: 'osm' };
  async function initialize() {
    if (config().remoteConfig && !loading) {
      let detail = '配置接口连接失败';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const endpoint = new URL(config().remoteConfig, root.location.href);
        if (endpoint.origin !== root.location.origin) {
          detail = '配置地址必须来自本站';
          throw Error('invalid config origin');
        }
        const options = {
          signal: controller.signal,
          credentials: 'same-origin',
          cache: 'no-store',
        };
        let response = await fetch(endpoint, options);
        // A preview token only goes to this same-origin configuration endpoint.
        const page = new URL(root.location.href);
        if (
          [401, 403].includes(response.status) &&
          page.searchParams.has('eo_token') &&
          page.searchParams.has('eo_time')
        ) {
          endpoint.searchParams.set('eo_token', page.searchParams.get('eo_token'));
          endpoint.searchParams.set('eo_time', page.searchParams.get('eo_time'));
          response = await fetch(endpoint, options);
        }
        if (!response.ok) {
          detail = `配置接口返回 HTTP ${response.status}`;
          throw Error('config request failed');
        }
        detail = '配置接口未返回有效 JSON';
        const remote = await response.json();
        if (remote.provider !== 'amap' || typeof remote.amapKey !== 'string' || !remote.amapKey) {
          detail = '配置接口缺少地图应用标识';
          throw Error('invalid config body');
        }
        root.XJ_MAP_CONFIG = {
          provider: 'amap',
          amapKey: remote.amapKey,
          serviceHost: '/_AMapService',
        };
      } catch {
        problem = `地图服务配置暂不可用（${controller.signal.aborted ? '配置接口连接超时' : detail}）。`;
        return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (config().provider !== 'amap') return Promise.resolve(false);
    if (loading) return loading;
    loading = new Promise((resolve) => {
      if (!config().amapKey) {
        problem = '高德地图尚未配置，请联系站点维护者。';
        return resolve(false);
      }
      try {
        const u = new URL(config().serviceHost || '/_AMapService', root.location.href);
        if (u.origin !== root.location.origin || !u.pathname.endsWith('/_AMapService'))
          throw Error('地图服务代理必须使用本站 /_AMapService 路径。');
        root._AMapSecurityConfig = { serviceHost: u.href };
      } catch (err) {
        problem = err.message;
        return resolve(false);
      }
      const script = document.createElement('script');
      let ended = false;
      const finish = (ok) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        ready = ok;
        resolve(ok);
      };
      const timer = setTimeout(() => {
        problem = '高德地图加载超时，可先查看示意路线。';
        script.remove();
        finish(false);
      }, 15000);
      root.__xingjianAMapReady = () => {
        if (!root.AMap) problem = '高德地图未能启动。';
        finish(!!root.AMap);
      };
      script.src =
        'https://webapi.amap.com/maps?v=2.0&callback=__xingjianAMapReady&key=' +
        encodeURIComponent(config().amapKey);
      script.onerror = () => {
        problem = '高德地图连接失败，可先查看示意路线。';
        finish(false);
      };
      document.head.append(script);
    });
    return loading;
  }
  function requireReady() {
    if (!ready) throw Error(problem || '高德地图未准备好，请稍后刷新。');
  }
  function timedSearch(service, args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('地图查询超时，请稍后再试。')), 18000);
      service.search(...args, (status, result) => {
        clearTimeout(timer);
        if (status === 'complete') resolve(result);
        else
          reject(
            Error(
              status === 'no_data'
                ? '没有找到结果，请检查地点或入口。'
                : '高德查询失败，请检查服务配置或稍后重试。',
            ),
          );
      });
    });
  }
  function plugin(name) {
    requireReady();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('地图服务加载超时。')), 12000);
      root.AMap.plugin(name, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  async function search(query, city) {
    await plugin('AMap.PlaceSearch');
    const r = await timedSearch(
      new root.AMap.PlaceSearch({ city: city || '全国', pageSize: 5, extensions: 'base' }),
      [query],
    );
    return (r.poiList?.pois || [])
      .filter((p) => p.location)
      .map((p) => {
        const c = toWGS(coords(p.location));
        return {
          lat: c[1],
          lon: c[0],
          display_name: [p.name, p.pname, p.cityname, p.adname, p.address]
            .filter((v) => typeof v === 'string' && v)
            .join(' · '),
        };
      });
  }
  async function route(from, to, mode) {
    const name = { walk: 'Walking', bike: 'Riding', drive: 'Driving' }[mode];
    if (!name) throw Error('此交通方式请填写实际换乘说明。');
    await plugin('AMap.' + name);
    const r = await timedSearch(new root.AMap[name]({ extensions: 'all' }), [
      toGCJ([from.lng, from.lat]),
      toGCJ([to.lng, to.lat]),
    ]);
    const plan = r.routes?.[0];
    if (!plan) throw Error('没有找到可用路径。');
    const steps = plan.steps || plan.rides || [],
      path = [];
    for (const step of steps)
      for (const p of step.path || []) {
        const c = toWGS(coords(p)),
          prev = path.at(-1);
        if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) path.push(c);
      }
    if (path.length < 2) throw Error('服务未返回完整道路路径。');
    return {
      geometry: { type: 'LineString', coordinates: path },
      distance: plan.distance,
      duration: plan.time,
      source: '高德地图 JS API',
      routeSteps: steps.slice(0, 300).map((st) => ({
        name: st.road || '',
        instruction: st.instruction || '',
        distanceMeters: Number(st.distance) || 0,
      })),
    };
  }
  // A narrow Leaflet-shaped interface keeps journey editing and photo pins provider-independent.
  function library() {
    requireReady();
    const A = root.AMap;
    function group() {
      return {
        items: [],
        host: null,
        addTo(host) {
          this.host = host;
          host.groups.add(this);
          return this;
        },
        add(layer) {
          this.items.push(layer);
          layer.native.setMap(this.host.native);
          layer.host = this.host;
        },
        clearLayers() {
          for (const l of this.items) l.native.setMap(null);
          this.items = [];
        },
      };
    }
    function layer(native) {
      return {
        native,
        host: null,
        addTo(target) {
          target.add(this);
          return this;
        },
        on(name, cb) {
          native.on(name, (e) => cb({ latlng: e.lnglat ? latlng(e.lnglat) : undefined }));
          return this;
        },
        getLatLng() {
          return latlng(native.getPosition());
        },
        bindTooltip(content, options = {}) {
          if (native.setLabel) {
            const label = {
              content: '<span class="xj-amap-label">' + content + '</span>',
              direction: options.direction === 'right' ? 'right' : 'top',
              offset: new A.Pixel(0, -4),
            };
            if (options.permanent) native.setLabel(label);
            else {
              native.on('mouseover', () => native.setLabel(label));
              native.on('mouseout', () => native.setLabel({ content: '' }));
            }
          } else {
            native.on('mouseover', () => {
              if (this.host) {
                this.host.tip.setContent(content);
                this.host.tip.open(this.host.native, native.getPath()[0]);
              }
            });
            native.on('mouseout', () => this.host?.tip.close());
          }
          return this;
        },
      };
    }
    return {
      map(id, options = {}) {
        const n = new A.Map(id, {
          viewMode: '2D',
          resizeEnable: true,
          zoom: 10,
          center: [110, 30],
          zooms: [3, 18],
          rotateEnable: false,
          pitchEnable: false,
          scrollWheel: options.scrollWheelZoom !== false,
        });
        let destroyed = false;
        const m = {
          native: n,
          groups: new Set(),
          tip: new A.InfoWindow({ isCustom: false, autoMove: false }),
          setView(p, z) {
            n.setZoomAndCenter(z, gcjLatLng(p), true);
            return this;
          },
          fitBounds(points, opts = {}) {
            const c = points.map(gcjLatLng),
              xs = c.map((p) => p[0]),
              ys = c.map((p) => p[1]);
            if (
              Math.max(...xs) - Math.min(...xs) < 1e-8 &&
              Math.max(...ys) - Math.min(...ys) < 1e-8
            ) {
              n.setZoomAndCenter(opts.maxZoom || 16, c[0], true);
              return;
            }
            n.setBounds(
              new A.Bounds([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]),
              true,
              [65, 48, 65, 48],
            );
            if (n.getZoom() > (opts.maxZoom || 16)) n.setZoom(opts.maxZoom || 16, true);
          },
          on(name, cb) {
            n.on(name, (e) => cb({ latlng: e.lnglat ? latlng(e.lnglat) : undefined }));
            return this;
          },
          invalidateSize() {
            root.dispatchEvent(new Event('resize'));
          },
          removeLayer(g) {
            g.clearLayers();
            this.groups.delete(g);
          },
          remove() {
            destroyed = true;
            for (const g of this.groups) g.clearLayers();
            this.tip.close();
            n.destroy();
          },
        };
        A.plugin(['AMap.ToolBar', 'AMap.Scale'], () => {
          if (destroyed) return;
          n.addControl(new A.ToolBar({ position: { right: '10px', bottom: '55px' } }));
          n.addControl(new A.Scale({ position: { left: '10px', bottom: '45px' } }));
        });
        return m;
      },
      featureGroup: group,
      divIcon: (o) => o,
      marker(p, o = {}) {
        const content = document.createElement('div');
        content.className = o.icon?.className || '';
        content.innerHTML = o.icon?.html || '';
        return layer(
          new A.Marker({
            position: gcjLatLng(p),
            content,
            offset: new A.Pixel(-(o.icon?.iconAnchor?.[0] || 0), -(o.icon?.iconAnchor?.[1] || 0)),
            title: o.title || '',
            draggable: !!o.draggable,
            bubble: false,
          }),
        );
      },
      polyline(points, o = {}) {
        return layer(
          new A.Polyline({
            path: points.map(gcjLatLng),
            strokeColor: o.color || '#a27548',
            strokeWeight: o.weight || 3,
            strokeOpacity: o.opacity ?? 1,
            strokeStyle: o.dashArray ? 'dashed' : 'solid',
            strokeDasharray: (o.dashArray || '6 6').split(' ').map(Number),
            bubble: false,
          }),
        );
      },
    };
  }
  root.XJMaps = {
    initialize,
    search,
    route,
    library,
    toGCJ,
    toWGS,
    config,
    get ready() {
      return ready;
    },
    get problem() {
      return problem;
    },
  };
  if (typeof module !== 'undefined') module.exports = root.XJMaps;
})(typeof window !== 'undefined' ? window : globalThis);
