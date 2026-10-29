import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { miles } from "../domain/pace";
import type { Volume, VolumeWeek } from "../domain/weeklyVolume";
import { formatDate, formatMiles, formatVolume } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/** The two parts Weekly Volume is stacked by, bottom up. */
const PARTS = ["Quality", "Easy"] as const;
type Part = (typeof PARTS)[number];

function part(week: VolumeWeek, p: Part): Volume {
  return p === "Quality" ? week.quality : week.easy;
}

/** Weekly Volume: one bar of miles per Training Week, stacked into Quality and Easy, with a table of the same numbers. */
export function VolumeChart({ weeks }: { weeks: VolumeWeek[] }) {
  if (weeks.length === 0) return <p className="rest">No Planned Workouts yet</p>;
  return (
    <section className="volume">
      <VolumeBars weeks={weeks} />
      <VolumeTable weeks={weeks} />
    </section>
  );
}

function VolumeBars({ weeks }: { weeks: VolumeWeek[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(weeks, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [weeks, dark]);

  return <div ref={ref} className="volume-chart" />;
}

/** The CSS variable naming each part's color: Quality takes the Quality Run color, Easy the Easy Run color. */
const COLOR_VARS: Record<Part, string> = {
  Quality: "--run-quality",
  Easy: "--run-easy",
};

interface ChartColors {
  series: Record<Part, string>;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: { Quality: v(COLOR_VARS.Quality), Easy: v(COLOR_VARS.Easy) },
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

function chartOption(weeks: VolumeWeek[], c: ChartColors): echarts.EChartsCoreOption {
  const axisLabel = { color: c.muted, fontSize: 11 };
  return {
    animation: false,
    legend: {
      top: 0,
      left: 0,
      selectedMode: false,
      textStyle: { color: c.muted },
      itemWidth: 14,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { dataIndex: number }[]) => weekTooltip(weeks[params[0]!.dataIndex]!, c),
    },
    grid: { left: 48, right: 8, top: 40, bottom: 28 },
    xAxis: {
      type: "category",
      data: weeks.map((w) => formatDate(w.start)),
      axisLabel: { ...axisLabel, hideOverlap: true },
      axisLine: { lineStyle: { color: c.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel, formatter: "{value} mi" },
      splitLine: { lineStyle: { color: c.grid } },
    },
    series: PARTS.map((p) => ({
      type: "bar",
      name: p,
      stack: "volume",
      barMaxWidth: 28,
      color: c.series[p],
      // A surface-colored edge keeps a gap between stacked segments.
      itemStyle: { borderColor: c.surface, borderWidth: 1 },
      emphasis: { disabled: true },
      data: weeks.map((w) => Number(miles(part(w, p).distance).toFixed(2))),
    })),
  };
}

function weekTooltip(week: VolumeWeek, c: ChartColors): string {
  const rows = PARTS.map((p) => {
    const swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${c.series[p]}"></span>`;
    return `<div>${swatch}${p}: ${formatVolume(part(week, p))}</div>`;
  });
  return [
    `<strong>${formatDate(week.start)} – ${formatDate(week.end)}</strong>`,
    ...rows,
    `<div>Total: ${formatVolume(week.total)}</div>`,
    week.qualityShare === null ? "" : `<div>Quality ${week.qualityShare}% · Easy ${week.easyShare}% of time</div>`,
  ].join("");
}

function VolumeTable({ weeks }: { weeks: VolumeWeek[] }) {
  return (
    <details className="runs">
      <summary>Weeks</summary>
      <table>
        <thead>
          <tr>
            <th>Week of</th>
            {PARTS.map((p) => (
              <th key={p}>{p}</th>
            ))}
            <th>Total</th>
            <th>Quality / Easy Share</th>
          </tr>
        </thead>
        <tbody>
          {[...weeks].reverse().map((w) => (
            <tr key={w.start}>
              <td>{formatDate(w.start)}</td>
              {PARTS.map((p) => (
                <td key={p}>{formatMiles(part(w, p).distance)}</td>
              ))}
              <td>{formatVolume(w.total)}</td>
              <td>{w.qualityShare === null ? "" : `${w.qualityShare}% / ${w.easyShare}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
