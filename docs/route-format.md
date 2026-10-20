# AI 路线文本格式：xingjian/1

网站的「AI 路线助手」会自动生成完整提示词。导入前先预览；文本可以是纯 JSON，也可以包在 Markdown 的 `json` 代码块中。

```json
{
  "format": "xingjian/1",
  "coordinateSystem": "WGS84",
  "title": "周末慢游",
  "city": "目的地",
  "startDate": "2027-04-02",
  "endDate": "2027-04-02",
  "travelers": 2,
  "maxWalkKm": 15,
  "base": "住宿待定",
  "days": [{
    "date": "2027-04-02",
    "title": "第一天",
    "walkKm": [0, 0],
    "stops": [
      {"id":"p-a","name":"地点A","lat":null,"lng":null,"time":"09:00","duration":"约90分钟"},
      {"id":"p-b","name":"地点B","lat":null,"lng":null,"time":"12:00","duration":"午餐约60分钟"}
    ],
    "legs": [{"from":"p-a","to":"p-b","mode":"walk","note":"入口和街道待确认","minutes":30}]
  }],
  "reminders": [{"title":"检查预约","date":"2027-03-28","detail":"建议检查日，非官方放票日","url":""}]
}
```

## 规则

- 一次旅程1—31天，`days` 按日期排列，日期不能重复。每一天 `stops` 为数组，最多100站。
- `stops.id` 只用英文字母、数字和短横线，最多80字符。同一地点重复到访时复用 id；不同地点不要复用 id。
- `lat` 是纬度，`lng` 是经度，使用 WGS84。不确定位置时同时填 `null`，不要编坐标。
- `time` 用24小时 `HH:mm`。`description`、`optional`、`note`、`tag`、`booking`、`source`、`tips` 是地点可选字段。
- `legs.from/to` 引用当天地点 id；`mode` 为 `walk`、`bike`、`metro`、`bus`、`drive`。
- `minutes` 与 `distanceMeters` 是路段可选估计值；没有真实数据时不要冒充测量值。
- `walkKm` 是一天含园内游览的估计区间；无法估算用 `[0,0]`，不能用直线长度替代。
- `reminders.date` 是建议检查日，不等于官方放票日；提醒需下载并导入日历后生效。

## 可选的具体路径

只有来自可信算路服务或实际轨迹的数据，才应加入：

```json
{"geometry":{"type":"LineString","coordinates":[[116.4,39.9],[116.401,39.901]]}}
```

这些数字只是格式示例，不是真实出行路线。GeoJSON 的坐标顺序是 **[经度, 纬度]**，与界面分开的纬度/经度输入不同。

导入路径均标为“导入路径 · 待核验”；不会仅因 AI 声称真实就认定可通行。路径偏离地点端点较远时会标为“路径端点待核对”，不作为当天有效道路路径显示。没有几何路径时画示意线，之后可以在路段编辑器中在线算路、手绘或导入单条 LineString GeoJSON。

更新已有旅程时保留地点 id，便于把已有照片放回正确地点。建议先“作为新旅程”比较方案，再决定是否更新原旅程。
