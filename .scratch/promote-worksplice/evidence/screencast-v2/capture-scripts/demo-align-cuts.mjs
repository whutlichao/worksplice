// Find each take video's time offset by locating the injected cursor once it has
// parked at a known page point, then cut the asset so its timeline starts where the
// composition expects it. Playwright's webm starts well before the take clock does.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const S = '/tmp/ws-demo3/shots';
const A = '/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/.scratch/promote-worksplice/evidence/screencast-v2/assets';

function frameRaw(video, t) {
  return execFileSync('ffmpeg', ['-v','error','-ss',t.toFixed(2),'-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 64*1024*1024 });
}
const W = 1920;
const isCursor = (b, x, y) => {
  const i = ((y - 9) * W + (x - 9)) * 3 + Math.floor(9 * 3);
  // sample the fill just inside the ring
  const j = (y * W + x) * 3;
  const c = [b[j], b[j+1], b[j+2]];
  return Math.abs(c[0]-252) < 14 && Math.abs(c[1]-216) < 18 && Math.abs(c[2]-82) < 26;
};
function firstHit(video, x, y, tMax) {
  for (let t = 0; t <= tMax; t += 0.1) {
    let b;
    try { b = frameRaw(video, t); } catch { break; }
    if (b.length < W * 1080 * 3) break;
    if (isCursor(b, x, y)) return +t.toFixed(2);
  }
  return null;
}

const takes = [
  { name: 'board',    mark: 'd1-board',    probe: [760, 770],  takeT: 4.88, start: 2.2,  dur: 10.2 },
  { name: 'channel',  mark: 'd4-channel',  probe: [1000, 158], takeT: 3.77, start: 2.9,  dur: 8.8  },
  { name: 'messages', mark: 'd3-messages', probe: [1700, 945], takeT: 7.90, start: 0.25, dur: 10.6 },
  { name: 'review',   mark: 'd2-review',   probe: null,        takeT: null, start: 3.6,  dur: 9.8  },
];

const results = [];
for (const tk of takes) {
  const lines = fs.readFileSync(`${S}/${tk.mark}.txt`, 'utf8').trim().split('\n');
  const video = lines[0];
  const total = Number(lines[1]);
  let offset = null;
  if (tk.probe) {
    const hit = firstHit(video, tk.probe[0], tk.probe[1], 20);
    if (hit !== null) offset = +(hit - tk.takeT).toFixed(2);
  }
  // review: no parked-point probe — align on the whole-take duration instead
  if (offset === null) offset = +(17.76 - 12.07).toFixed(2);
  const ss = +(tk.start + offset).toFixed(2);
  results.push({ ...tk, video, total, offset, ss });
  console.log(`${tk.name.padEnd(9)} video=${video.split('/').pop()} take=${total}s offset=+${offset}s  cut -ss ${ss} -t ${tk.dur}`);
  execFileSync('ffmpeg', ['-v','error','-y','-ss',String(ss),'-t',String(tk.dur),'-i',video,'-an','-vf','scale=1920:1080',
    '-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',`${A}/${tk.name}.mp4`]);
}
fs.writeFileSync(`${S}/align.json`, JSON.stringify(results, null, 2));
