/* Shared, dependency-free route parsing and geometry rules. */
(function (root) {
  'use strict';
  const finite = Number.isFinite;
  const point = (p) =>
    Array.isArray(p) &&
    p.length >= 2 &&
    finite(p[0]) &&
    finite(p[1]) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 85;
  function geometry(input) {
    if (!input) return null;
    if (input.type === 'Feature') input = input.geometry;
    if (input.type === 'FeatureCollection') {
      const lines = (input.features || []).filter((f) => f.geometry?.type === 'LineString');
      if (lines.length !== 1) throw new Error('每次请为这一段导入一个 LineString。');
      input = lines[0].geometry;
    }
    if (Array.isArray(input)) input = { type: 'LineString', coordinates: input };
    if (
      input.type !== 'LineString' ||
      !Array.isArray(input.coordinates) ||
      input.coordinates.length < 2 ||
      input.coordinates.length > 12000 ||
      !input.coordinates.every(point)
    ) {
      throw new Error('路径应为 GeoJSON LineString，坐标顺序为 [经度, 纬度]，使用 WGS84。');
    }
    return { type: 'LineString', coordinates: input.coordinates.map((c) => [c[0], c[1]]) };
  }
  function distance(a, b) {
    const rad = (n) => (n * Math.PI) / 180;
    const dLat = rad(b[1] - a[1]),
      dLon = rad(b[0] - a[0]);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }
  function length(g) {
    return g.coordinates.slice(1).reduce((sum, p, i) => sum + distance(g.coordinates[i], p), 0);
  }
  function located(p) {
    return p && finite(p.lat) && finite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;
  }
  function aligned(g, from, to) {
    return (
      !!g &&
      located(from) &&
      located(to) &&
      distance(g.coordinates[0], [from.lng, from.lat]) < 1000 &&
      distance(g.coordinates.at(-1), [to.lng, to.lat]) < 1000
    );
  }
  function extract(text) {
    if (typeof text !== 'string' || !text.trim())
      throw new Error('先粘贴 AI 生成的 JSON 路线文本。');
    if (text.length > 2000000) throw new Error('路线文本超过2 MB，请减少路径点或通过文件导入。');
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : text).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{'),
        end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch {}
      }
      throw new Error(
        '无法读取 JSON。请完整粘贴 AI 的代码块，检查引号、逗号和括号；不要只粘贴文字行程。',
      );
    }
  }
  function dayDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }
  function normalize(raw) {
    if (raw.trip) raw = raw.trip;
    if (raw.coordinateSystem && raw.coordinateSystem.replace(/[-_]/g, '').toUpperCase() !== 'WGS84')
      throw new Error('请将坐标转换成 WGS84 后导入；不能直接把高德 GCJ-02 当作 WGS84。');
    if (Array.isArray(raw.places) && Array.isArray(raw.days)) return raw;
    if (raw.format !== 'xingjian/1' || !Array.isArray(raw.days))
      throw new Error('请使用行间提示词生成的 xingjian/1 格式，或导入本站导出的旅程文件。');
    if (!raw.days.length || raw.days.length > 31) throw new Error('一次旅程支持1—31天。');
    const byId = new Map(),
      warnings = [];
    const days = raw.days.map((d, di) => {
      if (!dayDate(d.date)) throw new Error(`第${di + 1}天缺少有效日期（YYYY-MM-DD）。`);
      if (!Array.isArray(d.stops) || d.stops.length > 100)
        throw new Error(`第${di + 1}天 stops 必须是数组，最多100站。`);
      const stops = d.stops.map((st, si) => {
        if (typeof st.name !== 'string' || !st.name.trim())
          throw new Error(`第${di + 1}天第${si + 1}站缺少地点名称。`);
        const id = st.id || `p-${di}-${si}`;
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
          throw new Error('地点 id 请使用字母、数字、短横线，且最多80字。');
        const lat = st.lat ?? null,
          lng = st.lng ?? st.lon ?? null;
        if (
          (lat === null) !== (lng === null) ||
          (lat !== null &&
            (!finite(lat) || !finite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180))
        )
          throw new Error(`${st.name} 的经纬度无效；不确定位置请将 lat、lng 都设为 null。`);
        if (byId.has(id) && byId.get(id).name !== st.name)
          throw new Error(`地点编号 ${id} 对应了不同名称，请让 AI 为不同地点使用不同编号。`);
        const p = {
          id,
          name: st.name,
          lat,
          lng,
          description: st.description || '',
          tag: st.tag || '旅途的一站',
          booking: st.booking || '',
          source: st.source || '',
          tips: st.tips || [],
        };
        if (!byId.has(id)) byId.set(id, p);
        if (lat === null) warnings.push(`${st.name}：待定位`);
        return {
          place: id,
          time: st.time || '10:00',
          duration: st.duration || '自由停留',
          optional: st.optional === true,
          note: st.note || '',
        };
      });
      const ids = new Set(stops.map((s) => s.place));
      const legs = (d.legs || []).map((l) => {
        const fromId = l.fromId || l.from,
          toId = l.toId || l.to;
        if (!ids.has(fromId) || !ids.has(toId))
          throw new Error(`第${di + 1}天的路段引用了不在当天 stops 中的地点编号。`);
        if (!['walk', 'bike', 'metro', 'bus', 'drive'].includes(l.mode))
          throw new Error('mode 只能为 walk、bike、metro、bus 或 drive。');
        const g = geometry(l.geometry || l.path);
        return {
          fromId,
          toId,
          mode: l.mode,
          note: l.note || '',
          minutes: finite(l.minutes) ? Math.max(0, l.minutes) : null,
          distanceMeters: finite(l.distanceMeters) ? Math.max(0, l.distanceMeters) : null,
          geometry: g,
          pathKind: g ? 'imported' : 'schematic',
          source: l.source || '',
          via: [],
        };
      });
      for (let i = 1; i < stops.length; i++)
        if (!legs.some((l) => l.fromId === stops[i - 1].place && l.toId === stops[i].place))
          legs.push({
            fromId: stops[i - 1].place,
            toId: stops[i].place,
            mode: 'walk',
            note: '交通方式待确认',
            via: [],
            pathKind: 'schematic',
          });
      return {
        id: 'd' + di,
        date: d.date,
        title: d.title || '自由探索',
        subtitle: d.subtitle || '',
        walk: d.walkKm || d.walk || [0, 0],
        stops,
        legs,
      };
    });
    if (new Set(days.map((d) => d.date)).size !== days.length)
      throw new Error('每天的日期不能重复。');
    for (let i = 1; i < days.length; i++)
      if (days[i].date <= days[i - 1].date) throw new Error('请按日期先后排列 days。');
    const places = [...byId.values()],
      first = places.find(located);
    return {
      schemaVersion: 1,
      id: raw.id,
      title: raw.title || '新旅程',
      city: raw.city || '目的地',
      start: raw.startDate || raw.start || days[0].date,
      end: raw.endDate || raw.end || days.at(-1).date,
      travelers: raw.travelers || 1,
      maxWalkKm: raw.maxWalkKm || 20,
      homeLabel: raw.base || raw.homeLabel || '',
      subtitle: raw.subtitle || '',
      center: first ? [first.lat, first.lng] : [30, 110],
      places,
      days,
      bookings: (raw.reminders || []).map((b, i) => ({
        id: 'bk-ai-' + i,
        place: b.place || '',
        title: b.title || '准备提醒',
        date: b.date,
        detail: b.detail || '',
        level: b.level || '准备提醒',
        url: b.url || '',
      })),
      photos: [],
      _warnings: warnings,
    };
  }
  function parse(text) {
    return normalize(extract(text));
  }
  root.XJCore = {
    geometry,
    distance,
    length,
    located,
    aligned,
    extract,
    normalize,
    parse,
    dayDate,
  };
})(globalThis);
