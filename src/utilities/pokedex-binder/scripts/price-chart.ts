import { cad, calendarDate, type PricePoint } from "../lib/pricing";

const day = 86_400_000;

export function createPriceChart(canvas: HTMLCanvasElement, slider: HTMLInputElement, output: HTMLOutputElement) {
  let points: PricePoint[] = [];
  function draw() {
    if (!points.length || !canvas.clientWidth) return;
    const width = canvas.clientWidth, height = canvas.clientHeight, scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    const styles = getComputedStyle(canvas);
    const ink = styles.getPropertyValue("--ink").trim() || "#0b1c30";
    const line = styles.getPropertyValue("--line").trim() || "#c6c6cd";
    const accent = styles.getPropertyValue("--secondary").trim() || "#006a61";
    context.font = "11px 'JetBrains Mono', monospace";
    const values = points.map(point => point.cents);
    const low = Math.min(...values), high = Math.max(...values);
    const margin = Math.max(1, (high - low) * 0.1);
    const floor = Math.max(0, Math.floor(low - margin)), ceiling = Math.ceil(high + margin);
    const left = Math.ceil(context.measureText(cad(ceiling)).width) + 11, right = width - 10;
    const top = 10, bottom = height - 27;
    const start = Date.parse(points[0].date), end = Date.parse(points.at(-1)!.date);
    const x = (date: string) => left + (right - left) * (Date.parse(date) - start) / Math.max(day, end - start);
    const y = (cents: number) => bottom - (bottom - top) * (cents - floor) / (ceiling - floor);

    for (const value of [floor, Math.round((floor + ceiling) / 2), ceiling]) {
      const height = y(value);
      context.strokeStyle = line;
      context.beginPath();
      context.moveTo(left, height);
      context.lineTo(right, height);
      context.stroke();
      context.fillStyle = ink;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(cad(value), left - 6, height);
    }
    const label = (date: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date));
    context.textAlign = "left";
    context.fillText(label(points[0].date), left, height - 9);
    context.textAlign = "right";
    context.fillText(label(points.at(-1)!.date), right, height - 9);

    context.strokeStyle = accent;
    context.fillStyle = accent;
    context.lineWidth = 2;
    context.beginPath();
    for (const [index, point] of points.entries()) {
      const prior = points[index - 1];
      if (prior && Date.parse(point.date) - Date.parse(prior.date) === day) context.lineTo(x(point.date), y(point.cents));
      else context.moveTo(x(point.date), y(point.cents));
    }
    context.stroke();
    for (const point of points) {
      context.beginPath();
      context.arc(x(point.date), y(point.cents), 2.5, 0, Math.PI * 2);
      context.fill();
    }
    const selected = points[slider.valueAsNumber] ?? points.at(-1)!;
    context.strokeStyle = ink;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(x(selected.date), top);
    context.lineTo(x(selected.date), bottom);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(x(selected.date), y(selected.cents), 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    const description = `${calendarDate(selected.date)} · ${cad(selected.cents)} CAD`;
    output.value = description;
    slider.setAttribute("aria-valuetext", description);
  }
  slider.addEventListener("input", draw);
  new ResizeObserver(draw).observe(canvas);
  return (history: PricePoint[]) => {
    points = history;
    slider.max = String(Math.max(0, points.length - 1));
    slider.value = slider.max;
    draw();
  };
}
