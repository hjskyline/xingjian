# Xingjian · Journeys, Together

[简体中文](README.md) | **English**

> Plan the next stop on a map. Keep the memories where they happened.

Xingjian (行间) is a lightweight, self-hostable travel planner and journal. Plan a trip, refine its route, and attach photos to the places you visited. Each journey has its own dates, itinerary, reminders, and photo collection.

The Beijing autumn itinerary is the first example, not the product's boundary. You can create trips for other cities and countries. The current application interface is in Chinese; this README documents the project in English.

**Status:** v0.1.0 foundation prototype. No account, backend database, or paid AI API is required to run it.

## Preview

![Day-by-day route map with road geometry and an editable itinerary](docs/images/route-map.png)

Map data © OpenStreetMap contributors. Beijing is a sample itinerary; the screenshot demonstrates planning features, not a completed trip.

<details>
<summary>AI itinerary import on mobile</summary>

<img src="docs/images/ai-import.png" alt="Mobile AI itinerary import dialog" width="320">

</details>

## What works today

- **Multiple journeys:** set dates, party size, accommodation, and a daily walking limit; organize stops by day.
- **Editable map:** labeled places, north indicator, scale, daily routes, and a whole-trip overview. Search for a place, pick it on the map, change times/order, skip optional stops, or drag markers in edit mode.
- **Leg-by-leg planning:** choose transport, duration, distance, entrances, and transfer notes. Request walking/cycling/driving road geometry, draw a reference path, or import a GeoJSON LineString.
- **AI text workflow:** describe your requirements → copy a structured prompt to an AI tool → paste its JSON response → preview and validate → create a new journey or update the current one. One previous AI update can be restored.
- **Place-based memories:** upload and resize photos, associate them with places, and open each place's album from its map pin. Photos can be reassigned to another place.
- **Preparation checklist:** add ticket, restaurant, weather, or transport checks and export calendar reminders.
- **Portable data:** share route changes in a link, import/export journeys and backups, and export a public album for static hosting.

## Run locally

The application has no runtime package-install or build step. From the repository root, use Python 3:

```sh
python3 -m http.server 4174 --directory dist
```

Open `http://localhost:4174`. Do not open the HTML file directly: the application fetches its data using relative HTTP URLs.

## Refine an itinerary with AI

1. Open **AI 路线助手** (AI route assistant).
2. Describe the destination, dates, must-see places, exclusions, walking tolerance, and transport preferences.
3. Keep **把当前旅程一起交给 AI** checked to refine the existing journey, or uncheck it to plan a new one.
4. Copy the generated prompt into your preferred AI tool. It specifies the `xingjian/1` JSON format.
5. Paste the complete response back into the website, inspect the preview and warnings, then import it as a new journey or update the current one.
6. Resolve uncertain locations and refine each transport leg on the map.

The first version **does not call GPT or another model from the website**. There is no API-key field. Prompt generation, validation, and visualization run in the browser. This keeps the basic workflow usable without setting up an AI backend.

See the [format specification](docs/route-format.md) (Chinese) and the [importable example](dist/data/ai-example.json). The importer accepts plain JSON and common Markdown JSON code blocks.

## Understanding the map

| Display | Meaning |
| --- | --- |
| Solid road-calculated line | Geometry returned by a road-routing service; still a reference, not live navigation |
| Dotted, manually drawn path | A reference path drawn by the user |
| Dotted, imported path | Geometry imported from text or GeoJSON, not automatically verified |
| Dashed schematic connection | Connects stops without road geometry; not an actual navigation route |
| Pending location | No reliable coordinates; the app does not invent a position or use the map origin |

The default development configuration uses OpenStreetMap. An official AMap JS API adapter is available for a mainland deployment, including place search and road routing. See the [hosting preparation guide](docs/mainland-hosting.md) (Chinese). Mainland hosting has not yet been provisioned or verified.

In the default configuration, street tiles come from OpenStreetMap. The Beijing example includes a local schematic fallback. Other destinations retain coordinates, markers, and orientation on a grid when street tiles are unavailable.

Coordinates use **WGS84**. Do not mix in GCJ-02 coordinates from Amap or BD-09 coordinates from Baidu without conversion. GeoJSON coordinates are `[longitude, latitude]`.

User-triggered road routing uses FOSSGIS OSRM profiles for walking, cycling, and driving, at no more than one request per second. The endpoints are sent to that service. Failures and timeouts leave clearly marked schematic lines; the app does not fabricate road geometry. Road geometry has been retrieved in a real browser and saved for 15 walking/cycling legs in the Beijing example. Availability may vary by network.

Public transport legs require transfer notes or imported route geometry; the app does not treat them as pedestrian routes. Park entrances, opening hours, construction, and temporary restrictions still need checking in a navigation app or with official sources.

## Storage, photos, and sharing

This is a static, **browser-local** prototype. There is no real-time cloud collaboration.

| Action | Where the data goes |
| --- | --- |
| Edit a journey | This browser's localStorage, separated by journey |
| Add photos | This browser's IndexedDB, associated with a journey and a place |
| Share a route link | Encodes the itinerary and edits, without local photos |
| Export a full backup | Downloads JSON containing the journey, edits, and resized photos |
| Export public album data | Produces `trip.json`; replace `dist/data/trip.json` and redeploy to make it visible to visitors |

Photos are resized to a maximum dimension of 1600 px. This is intended for a curated travel journal, not an original-photo archive. Clearing browser data, changing devices/domains, or using a private window can affect local records. Export backups regularly.

Updating a journey from AI matches existing places by ID or name and retains old places that have photos. Importing as a new journey leaves the original untouched. Photos without an associated place can be reassigned from the album.

Do not commit private documents, ticket codes, credentials, or photos you do not want to publish to a public repository.

## Project structure

```text
dist/
  index.html             Page and editor/import dialogs
  styles.css             Desktop and mobile styles
  app.js                 Journey library, maps, editing, and albums
  route-core.js          Route parsing and coordinate/geometry rules
  data/trip.json         Default example journey
  data/ai-example.json   Import-format demonstration
  assets/photos/         Beijing reference photos and attribution
  assets/vendor/         Bundled Leaflet assets
scripts/
  test_core.cjs          Dependency-free core checks
  check_project.py       Sample-data, asset, and attribution checks
  browser_smoke.mjs      Optional Playwright smoke test
docs/route-format.md     AI import specification (Chinese)
```

## Checks

Node.js and Python 3 are needed for the following checks:

```sh
node --check dist/app.js
node scripts/test_core.cjs
python3 scripts/check_project.py
```

For the optional browser smoke test:

```sh
npm install
npx playwright install chromium
# Start the local server in another terminal first.
npm run test:browser
```

The smoke test uses a clearly mocked routing response to verify the UI, persistence, and geometry rendering. A passing smoke test does not imply that the live routing service is available. Core checks cover fenced AI JSON, unresolved coordinates, invalid references, coordinate systems, and geometry validation.

## Roadmap and contributions

The next priorities are route clarity, provider reliability, and easier iteration. Future work may include configurable mapping/routing providers, a server-side AI integration, invited companions, cloud photo storage, route comparisons, and GPX import. See [ROADMAP.md](ROADMAP.md).

Feedback and bug reports are welcome in [Issues](https://github.com/hjskyline/xingjian/issues). Before submitting a pull request, run the checks above and preserve third-party attribution. Please distinguish implemented features from proposed ideas.

## License and attribution

Project code is released under the [MIT License](LICENSE). Third-party photos and Leaflet retain their original licenses; see [ATTRIBUTION.md](ATTRIBUTION.md) and the photo manifest. Reference photos were taken in different years and seasons and do not represent real-time conditions.
