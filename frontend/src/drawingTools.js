const COLORS = {
  trend: '#f5a623',
  horizontal: '#26a69a',
  rectangle: '#a371f7',
  fib: '#e3b341',
  vertical: '#58a6ff',
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 1];
const MAX_DRAWINGS = 200;

function validPoint(point) {
  return (
    point &&
    Number.isFinite(point.time) &&
    Number.isFinite(point.price)
  );
}

function validDrawing(drawing) {
  return (
    drawing &&
    typeof drawing.id === 'string' &&
    Object.hasOwn(COLORS, drawing.type) &&
    Array.isArray(drawing.points) &&
    drawing.points.length === 2 &&
    drawing.points.every(validPoint)
  );
}

export function createDrawingTools({ container, chart, series, getTimeframe }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'drawing-canvas';
  container.appendChild(canvas);
  const context = canvas.getContext('2d');

  const timeScale = chart.timeScale();
  let drawings = [];
  let draft = null;
  let tool = 'cursor';
  let dragging = false;
  let width = 0;
  let height = 0;

  const storageKey = () => `xauusd-drawings:${getTimeframe()}`;

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      return Array.isArray(value) ? value.filter(validDrawing).slice(-MAX_DRAWINGS) : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(drawings.slice(-MAX_DRAWINGS)));
    } catch {
      // Drawing persistence is best-effort; the live chart keeps working.
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = container.clientWidth;
    height = container.clientHeight;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function toPixel(point) {
    const x = timeScale.timeToCoordinate(point.time);
    const y = series.priceToCoordinate(point.price);
    return x === null || y === null ? null : { x, y };
  }

  function toPoint(x, y) {
    const time = timeScale.coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time === null || price === null || !Number.isFinite(price)) return null;
    return { time: Number(time), price };
  }

  function localPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function line(from, to, color, widthPx = 1.5) {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = widthPx;
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function label(text, x, y, color) {
    context.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
    const textWidth = context.measureText(text).width;
    const left = Math.min(Math.max(x + 6, 2), Math.max(2, width - textWidth - 8));
    const top = Math.min(Math.max(y - 5, 2), Math.max(2, height - 14));
    context.fillStyle = 'rgba(11, 14, 17, 0.82)';
    context.fillRect(left - 2, top - 1, textWidth + 4, 13);
    context.fillStyle = color;
    context.fillText(text, left, top + 9);
  }

  function draw(drawing) {
    const color = COLORS[drawing.type];
    const first = toPixel(drawing.points[0]);
    const second = toPixel(drawing.points[1]) || first;
    if (!first) return;

    if (drawing.type === 'horizontal') {
      line({ x: 0, y: first.y }, { x: width, y: first.y }, color);
      label(first.price.toFixed(2), width - 62, first.y, color);
      return;
    }

    if (drawing.type === 'vertical') {
      line({ x: first.x, y: 0 }, { x: first.x, y: height }, color);
      label(new Date(first.time * 1000).toLocaleTimeString([], { hour12: false }), first.x, 18, color);
      return;
    }

    if (!second) return;

    if (drawing.type === 'trend') {
      line(first, second, color, 2);
      for (const point of [first, second]) {
        context.beginPath();
        context.fillStyle = color;
        context.arc(point.x, point.y, 3, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }

    if (drawing.type === 'rectangle') {
      const left = Math.min(first.x, second.x);
      const right = Math.max(first.x, second.x);
      const top = Math.min(first.y, second.y);
      const bottom = Math.max(first.y, second.y);
      context.fillStyle = `${color}1f`;
      context.fillRect(left, top, right - left, bottom - top);
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.strokeRect(left, top, right - left, bottom - top);
      return;
    }

    if (drawing.type === 'fib') {
      const left = Math.min(first.x, second.x);
      const right = Math.max(first.x, second.x);
      for (const level of FIB_LEVELS) {
        const price = drawing.points[0].price +
          (drawing.points[1].price - drawing.points[0].price) * level;
        const y = series.priceToCoordinate(price);
        if (y === null) continue;
        line({ x: left, y }, { x: width, y }, color);
        label(`${(level * 100).toFixed(1)}%  ${price.toFixed(2)}`, right, y, color);
      }
    }
  }

  function redraw() {
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    for (const drawing of drawings) draw(drawing);
    if (draft) draw(draft);
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (a.x + ratio * dx), point.y - (a.y + ratio * dy));
  }

  function eraseAt(point) {
    const index = drawings.findLastIndex((drawing) => {
      const first = toPixel(drawing.points[0]);
      const second = toPixel(drawing.points[1]) || first;
      if (!first) return false;
      if (drawing.type === 'horizontal') return Math.abs(point.y - first.y) < 7;
      if (drawing.type === 'vertical') return Math.abs(point.x - first.x) < 7;
      return distanceToSegment(point, first, second) < 7;
    });
    if (index < 0) return;
    drawings.splice(index, 1);
    save();
    redraw();
  }

  function onPointerDown(event) {
    if (tool === 'cursor' || tool === 'erase') {
      if (tool === 'erase') eraseAt(localPoint(event));
      return;
    }
    const { x, y } = localPoint(event);
    const point = toPoint(x, y);
    if (!point) return;
    draft = {
      id: `draw-${Date.now()}`,
      type: tool,
      points: [point, point],
    };
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    redraw();
  }

  function onPointerMove(event) {
    if (!dragging || !draft) return;
    const { x, y } = localPoint(event);
    const point = toPoint(x, y);
    if (point) {
      draft.points[1] = point;
      redraw();
    }
  }

  function onPointerUp(event) {
    if (!dragging || !draft) return;
    dragging = false;
    const first = toPixel(draft.points[0]);
    const second = toPixel(draft.points[1]);
    const moved =
      first && second &&
      (Math.hypot(second.x - first.x, second.y - first.y) > 4 ||
        draft.points[0].price !== draft.points[1].price);
    if (moved) {
      drawings.push(draft);
      save();
    }
    draft = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    redraw();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  timeScale.subscribeVisibleTimeRangeChange(redraw);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  resize();

  return {
    setTool(nextTool) {
      tool = nextTool;
      canvas.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
      canvas.style.cursor = tool === 'erase' ? 'not-allowed' : 'crosshair';
      redraw();
    },
    setTimeframe() {
      drawings = load();
      redraw();
    },
    clear() {
      drawings = [];
      save();
      redraw();
    },
    destroy() {
      observer.disconnect();
      timeScale.unsubscribeVisibleTimeRangeChange(redraw);
      canvas.remove();
    },
  };
}
