# US store map — Aesop & Apple

Builds `public/us-store-map.html`: a self-contained, mobile-first interactive map
of Aesop and Apple retail locations in the United States. No runtime network
access, no map tiles, no JS dependencies — geometry and store data are inlined at
build time and the page renders as plain SVG.

## Build

```sh
npm i --no-save us-atlas@3 topojson-client d3-geo
node scripts/store-map/build.mjs          # -> map-data.json
```

`build.mjs` reads `data/apple_us.json` and `data/aesop_us.json`, projects every
store through `d3.geoAlbersUsa()` (scale 1300, 975x610 viewBox) and writes the
same-projection state outlines alongside the projected points. The template is
then filled in:

```sh
node -e "const fs=require('fs');fs.writeFileSync('public/us-store-map.html',
  fs.readFileSync('scripts/store-map/template.html','utf8')
    .replace('__DATA__', fs.readFileSync('map-data.json','utf8')))"
```

## Verify

`verify.mjs` drives the built page in Chromium (Playwright) across iPhone,
small-phone and desktop viewports, checking layout, pan/zoom/pinch, pin
hit-testing, search, brand filters, both colour themes and horizontal overflow.

```sh
node scripts/store-map/verify.mjs
```

## Data provenance

**Apple — 272 stores, 45 states.** From the [All The Places](https://www.alltheplaces.xyz/)
open dataset, whose `apple` spider scrapes Apple's own retail pages. Names,
street addresses, phone numbers and coordinates are Apple's own and are surveyed
to the storefront. This is a **2022 snapshot**; Apple currently reports roughly
270 US stores, so a handful of openings, closures and relocations since 2022 are
not reflected.

**Aesop — 59 stores, 16 states.** Compiled from Aesop's public store-locator
pages. Aesop's locator API was not reachable from the build environment, so
entries were gathered store by store. Aesop's locator reports **78** US
locations, so this layer is a substantial sample rather than the complete set.
Coordinates are street- or mall-level (accurate to roughly a block); stores that
share a shopping centre with an Apple Store reuse that surveyed centre
coordinate. Permanently closed locations (San Francisco Centre, Oakbrook) are
excluded.

Both caveats are stated in the page's own "About this map" dialog — the map does
not present itself as more complete than it is.

## Projection note

Albers equal-area conic with Alaska and Hawaii inset at their conventional
positions, so distances between the insets and the mainland are not to scale.
