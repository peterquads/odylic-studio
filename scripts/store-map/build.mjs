import fs from 'fs';
import * as topojson from 'topojson-client';
import { geoAlbersUsa, geoPath } from 'd3-geo';

const topo = JSON.parse(fs.readFileSync('node_modules/us-atlas/states-10m.json','utf8'));
const states = topojson.feature(topo, topo.objects.states);

const W = 975, H = 610;
const proj = geoAlbersUsa().scale(1300).translate([W/2, H/2]);
const path = geoPath(proj);

// AlbersUsa clips territories outside the 50 states -> geoPath returns null.
const shapes = [];
const skipped = [];
for (const f of states.features) {
  const d = path(f);
  if (!d) { skipped.push(f.properties.name); continue; }
  shapes.push({ n: f.properties.name, d: d.replace(/-?\d+\.?\d*/g, m => (+m).toFixed(1)) });
}
const mesh = path(topojson.mesh(topo, topo.objects.states, (a,b)=>a!==b))
  .replace(/-?\d+\.?\d*/g, m => (+m).toFixed(1));

const apple = JSON.parse(fs.readFileSync('apple_us.json','utf8'));
const aesop = JSON.parse(fs.readFileSync('aesop_us.json','utf8'));

const dropped = [];
const pt = (r, brand) => {
  const p = proj([r.lon, r.lat]);
  if (!p) { dropped.push(`${brand}:${r.n} (${r.c}, ${r.s})`); return null; }
  return { n: r.n, a: r.a, c: r.c, s: r.s, p: r.p || '', z: r.z || '', lat: r.lat, lon: r.lon,
           x: +p[0].toFixed(1), y: +p[1].toFixed(1), b: brand };
};
const pts = [...apple.map(r=>pt(r,0)), ...aesop.map(r=>pt(r,1))].filter(Boolean);

console.log('states drawn', shapes.length, '| skipped:', skipped.join(', ') || 'none');
console.log('points projected', pts.length, '| dropped', dropped.length, dropped);
console.log('apple', pts.filter(p=>p.b===0).length, 'aesop', pts.filter(p=>p.b===1).length);
const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
console.log('x', Math.min(...xs).toFixed(0), Math.max(...xs).toFixed(0), '| y', Math.min(...ys).toFixed(0), Math.max(...ys).toFixed(0));

fs.writeFileSync('map-data.json', JSON.stringify({ W, H, shapes, mesh, pts }));
const kb = n => (n/1024).toFixed(0)+'kb';
console.log('total', kb(fs.statSync('map-data.json').size),
            '| land', kb(shapes.reduce((a,s)=>a+s.d.length,0)), '| mesh', kb(mesh.length));
