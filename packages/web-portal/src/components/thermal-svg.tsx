interface ThermalPoint {
  temperatureC: number;
}

export function ThermalSvg({ points }: { points: readonly ThermalPoint[] }) {
  const width = 320;
  const height = 150;
  const pad = 18;
  const temps = points.map((point) => point.temperatureC);
  const lowest = Math.min(-2.5, ...temps);
  const highest = Math.max(4.5, ...temps);
  const yMin = lowest - 0.4;
  const yMax = highest + 0.6;
  const yOf = (temperatureC: number): number => pad + ((yMax - temperatureC) / (yMax - yMin)) * (height - pad * 2);
  const xOf = (index: number): number => {
    const span = Math.max(points.length - 1, 1);
    return pad + (index / span) * (width - pad * 2);
  };
  const poly = points
    .map((point, index) => `${xOf(index).toFixed(1)},${yOf(point.temperatureC).toFixed(1)}`)
    .join(" ");
  const bandTop = yOf(4);
  const bandBottom = yOf(-2);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Thermal voyage curve" className="h-36 w-full">
      <rect x={pad} y={bandTop} width={width - pad * 2} height={Math.max(bandBottom - bandTop, 0)} fill="#10B981" opacity={0.18} />
      <line x1={pad} x2={width - pad} y1={yOf(4)} y2={yOf(4)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
      <line x1={pad} x2={width - pad} y1={yOf(-2)} y2={yOf(-2)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
      <polyline fill="none" stroke="#34d399" strokeWidth={2} points={poly} />
    </svg>
  );
}
