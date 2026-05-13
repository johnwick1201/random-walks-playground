// plot.js — minimal Canvas line plot for walker count vs time.
// Single dependency-free implementation. Adequate for one series + axes.

const PLOT_COLORS = {
  bg: '#000000',
  axis: '#cccccc',
  tick: '#9aa0a6',
  grid: '#1a1a1f',
  line: '#83c167',  // ManimGL GREEN_C — matches the existing Manim plot
  extinct: '#fc6255',
  text: '#e8e8ec',
};

// "Nice" tick step (1, 2, 5 × 10^k) for a target tick count.
function niceStep(range, targetTicks = 6) {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step;
  if (norm < 1.5)      step = 1;
  else if (norm < 3.5) step = 2;
  else if (norm < 7.5) step = 5;
  else                 step = 10;
  return step * pow;
}

export function drawWalkerPlot(container, result, currentT = null) {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;

  ctx.fillStyle = PLOT_COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  const { walkerCount, T, extinctAt, peak } = result;
  if (!walkerCount || walkerCount.length === 0) return;

  // Plot area
  const padL = 50, padR = 18, padT = 12, padB = 36;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xMax = T;
  const yMax = Math.max(2, peak);

  const xToPx = (x) => padL + (x / xMax) * plotW;
  const yToPx = (y) => padT + plotH - (y / yMax) * plotH;

  // Gridlines
  ctx.strokeStyle = PLOT_COLORS.grid;
  ctx.lineWidth = 1;
  const yStep = niceStep(yMax, 6);
  for (let v = 0; v <= yMax; v += yStep) {
    const y = yToPx(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
  const xStep = niceStep(xMax, 6);
  for (let v = 0; v <= xMax; v += xStep) {
    const x = xToPx(v);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = PLOT_COLORS.axis;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = PLOT_COLORS.tick;
  ctx.font = '11px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax; v += yStep) {
    const y = yToPx(v);
    ctx.fillText(String(Math.round(v)), padL - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = 0; v <= xMax; v += xStep) {
    const x = xToPx(v);
    ctx.fillText(String(Math.round(v)), x, padT + plotH + 5);
  }

  // Axis labels
  ctx.fillStyle = PLOT_COLORS.text;
  ctx.font = '600 11px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('t', padL + plotW / 2, padT + plotH + 28);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('# walkers', 0, 0);
  ctx.restore();

  // Walker-count line
  ctx.strokeStyle = PLOT_COLORS.line;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(xToPx(0), yToPx(walkerCount[0]));
  for (let t = 1; t < walkerCount.length; t++) {
    ctx.lineTo(xToPx(t), yToPx(walkerCount[t]));
  }
  ctx.stroke();

  // Current-t marker (driven by the player; thin vertical line)
  if (currentT != null && currentT >= 0 && currentT <= xMax) {
    ctx.save();
    ctx.strokeStyle = 'rgba(102, 194, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(xToPx(currentT), padT);
    ctx.lineTo(xToPx(currentT), padT + plotH);
    ctx.stroke();
    // Tiny dot at the current value, on the curve itself.
    const y = walkerCount[currentT];
    if (y != null) {
      ctx.fillStyle = 'rgba(102, 194, 255, 1)';
      ctx.beginPath();
      ctx.arc(xToPx(currentT), yToPx(y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Extinction marker
  if (extinctAt != null) {
    ctx.strokeStyle = PLOT_COLORS.extinct;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(xToPx(extinctAt), padT);
    ctx.lineTo(xToPx(extinctAt), padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PLOT_COLORS.extinct;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.fillText(`extinct at t=${extinctAt}`, xToPx(extinctAt) + 4, padT + 4);
  }
}
