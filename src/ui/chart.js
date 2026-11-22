// 小さな SVG グラフ（ライブラリなし）
import { esc } from './util.js';

// rows: [{label, value}]。value は 0〜max。null は欠測
export function lineChart(rows, opts) {
  const o = Object.assign({ max: 100, unit: '%', height: 140 }, opts || {});
  const W = 320, H = o.height, pl = 32, pr = 10, pt = 12, pb = 24;
  const n = rows.length;
  const x = (i) => pl + (n <= 1 ? 0 : (i * (W - pl - pr)) / (n - 1));
  const y = (v) => pt + (1 - v / o.max) * (H - pt - pb);
  let grid = '';
  for (const g of [0, 0.5, 1]) {
    const gy = y(o.max * g);
    grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>' +
      '<text x="' + (pl - 4) + '" y="' + (gy + 4) + '" class="axis" text-anchor="end">' + Math.round(o.max * g) + '</text>';
  }
  let path = '', dots = '', labels = '';
  let pen = false;
  rows.forEach((r, i) => {
    labels += '<text x="' + x(i) + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' + esc(r.label) + '</text>';
    if (r.value == null) { pen = false; return; }
    path += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.value).toFixed(1) + ' ';
    pen = true;
    dots += '<circle cx="' + x(i) + '" cy="' + y(r.value) + '" r="3.5" class="dot"><title>' + esc(r.label + ' ' + Math.round(r.value) + o.unit) + '</title></circle>';
  });
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title || '') + '">' + grid +
    '<path d="' + path + '" class="line"/>' + dots + labels + '</svg>';
}

export function barChart(rows, opts) {
  const o = Object.assign({ max: 600, height: 140, unit: '' }, opts || {});
  const W = 320, H = o.height, pl = 32, pr = 10, pt = 12, pb = 24;
  const n = rows.length;
  const bw = (W - pl - pr) / n;
  const y = (v) => pt + (1 - Math.min(v, o.max) / o.max) * (H - pt - pb);
  let out = '';
  for (const g of [0, 0.5, 1]) {
    const gy = y(o.max * g);
    out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" class="grid"/>' +
      '<text x="' + (pl - 4) + '" y="' + (gy + 4) + '" class="axis" text-anchor="end">' + esc(o.tick ? o.tick(o.max * g) : Math.round(o.max * g)) + '</text>';
  }
  if (o.target != null) out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(o.target) + '" y2="' + y(o.target) + '" class="target"/>';
  rows.forEach((r, i) => {
    const cx = pl + i * bw;
    out += '<text x="' + (cx + bw / 2) + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' + esc(r.label) + '</text>';
    if (r.value == null) return;
    const top = y(r.value);
    out += '<rect x="' + (cx + bw * 0.2) + '" y="' + top + '" width="' + bw * 0.6 + '" height="' + (H - pb - top) + '" rx="3" class="bar"><title>' + esc(r.label + ' ' + (r.text || r.value)) + '</title></rect>';
  });
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title || '') + '">' + out + '</svg>';
}
