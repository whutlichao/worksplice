// After transitions inject, clear transform/filter/opacity left on frame wrappers.
// filter/transform (even identity values) create a stacking context on the wrapper,
// which confines the frame's z-indexed overlays BELOW the hoisted videos.
import { readFileSync, writeFileSync } from 'node:fs';
const p = process.argv[2] || 'index.html';
let s = readFileSync(p, 'utf8');
if (s.includes('__stacking-cleared__')) { console.log('stacking patch already applied'); process.exit(0); }
const tweenRe = /tl\.(?:fromTo|to)\("#el-([a-z0-9-]+)",\s*(\{[^}]*\}),\s*(\{[^}]*\}),\s*([0-9.]+)\);/g;
let out = s;
let count = 0;
out = out.replace(tweenRe, (m, id, from, to, at) => {
  // only transitions that introduce transform/filter on entry
  if (!/scale|filter|opacity/.test(from)) return m;
  const dur = Number((to.match(/duration:\s*([0-9.]+)/) || [])[1] || 0.4);
  const clearAt = (Number(at) + dur + 0.05).toFixed(2);
  count++;
  return `${m}\n        tl.set("#el-${id}", { clearProps: "transform,filter" }, ${clearAt});`;
});
if (count) {
  out = out.replace('window.__timelines["main"]', '/* __stacking-cleared__ */\n      window.__timelines["main"]');
  writeFileSync(p, out);
  console.log(`stacking patch: cleared transform/filter after ${count} transition(s)`);
} else {
  console.log('stacking patch: no matching transitions (check injector output format)');
}
