import React from "react";
import { ResponsiveContainer, Tooltip, Legend } from "recharts";

// Lightweight chart kit on Recharts (the same engine shadcn's charts wrap), themed
// to the app — no Tailwind. Compose Recharts as usual INSIDE <ChartContainer>, and
// use <ChartTooltip>/<ChartLegend> for consistent styling.
//
//   const config = { value: { label: "Exceptions", color: "#c53030" } };
//   <ChartContainer config={config} height={240}>
//     <BarChart data={data}>
//       <XAxis dataKey="name" /><YAxis />
//       <ChartTooltip config={config} formatter={fmt.num} />
//       <Bar dataKey="value" fill="var(--color-value)" radius={[4,4,0,0]} />
//     </BarChart>
//   </ChartContainer>

const cx = (...p) => p.filter(Boolean).join(" ");

// brand-aligned categorical palette (used when a series has no explicit color)
export const CHART_COLORS = [
  "#2a9d8f", "#1f3a5f", "#4880ff", "#b7791f",
  "#2f855a", "#805ad5", "#c53030", "#28b5e1",
];

// pick a color for the Nth series
export const chartColor = (i) => CHART_COLORS[i % CHART_COLORS.length];

// Wraps a chart: exposes each config key as a --color-<key> CSS var and makes it
// responsive. Height in px (default 260).
export function ChartContainer({ config = {}, height = 260, className, children, style }) {
  const vars = {};
  Object.entries(config).forEach(([key, v], i) => {
    vars[`--color-${key}`] = (v && v.color) || chartColor(i);
  });
  return (
    <div className={cx("chart", className)} style={{ ...vars, ...style }}>
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// Styled tooltip body — label on top, one row per series (swatch · name · value).
export function ChartTooltipContent({ active, payload, label, config = {}, formatter, labelFormatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      {label != null && label !== "" && (
        <div className="chart-tooltip-label">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      {payload.map((p, i) => {
        const key = p.dataKey ?? p.name;
        const conf = config[key] || {};
        const color = p.color || (p.payload && p.payload.fill) || conf.color || chartColor(i);
        const name = conf.label || p.name || key;
        const value = formatter ? formatter(p.value, name, p) : p.value;
        return (
          <div className="chart-tooltip-row" key={i}>
            <span className="chart-tooltip-dot" style={{ background: color }} />
            <span className="chart-tooltip-name">{name}</span>
            <span className="chart-tooltip-val">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

// Drop-in Recharts <Tooltip> with our styled content. Pass `config`/`formatter`.
export function ChartTooltip({ config, formatter, labelFormatter, ...rest }) {
  return (
    <Tooltip
      cursor={{ fill: "rgba(31, 58, 95, 0.06)" }}
      content={(p) => (
        <ChartTooltipContent {...p} config={config} formatter={formatter} labelFormatter={labelFormatter} />
      )}
      {...rest}
    />
  );
}

// Legend with the app's typography (styling via .chart .recharts-legend-item in CSS).
export function ChartLegend(props) {
  return <Legend iconType="circle" iconSize={9} {...props} />;
}
