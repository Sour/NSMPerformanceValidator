import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { miles } from "../domain/pace";
import { VOLUME_CATEGORIES, type VolumeCategory, type VolumeWeek } from "../domain/weeklyVolume";
import { formatDate, formatHours, formatMiles } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/** Weekly Volume: one bar of miles per Training Week, stacked by Run Type, with a table of the same numbers. */
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

/** The CSS variable naming each Run Type's color, so it follows the Run Type into every chart. */
const COLOR_VARS: Record<VolumeCategory, string> = {
  "Quality Run": "--run-quality",
  "Easy Run": "--run-easy",
  "Long Run": "--run-long",
  "Unplanned Run": "--run-unplanned",
};

interface ChartColors {
  series: Record<VolumeCategory, string>;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: Object.fromEntries(VOLUME_CATEGORIES.map((c) => [c, v(COLOR_VARS[c])])) as Record<VolumeCategory, string>,
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
    series: VOLUME_CATEGORIES.map((category) => ({
      type: "bar",
      name: category,
      stack: "volume",
      barMaxWidth: 28,
      color: c.series[category],
      // A surface-colored edge keeps a gap between stacked segments.
      itemStyle: { borderColor: c.surface, borderWidth: 1 },
      emphasis: { disabled: true },
      data: weeks.map((w) => Number(miles(w.byRunType[category].distance).toFixed(2))),
    })),
  };
}

function weekTooltip(week: VolumeWeek, c: ChartColors): string {
  const rows = VOLUME_CATEGORIES.filter((category) => week.byRunType[category].movingTime > 0).map((category) => {
    const v = week.byRunType[category];
    const swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${c.series[category]}"></span>`;
    return `<div>${swatch}${category}: ${formatMiles(v.distance)} · ${formatHours(v.movingTime)}</div>`;
  });
  return [
    `<strong>${formatDate(week.start)} – ${formatDate(week.end)}</strong>`,
    ...rows,
    `<div>Total: ${formatMiles(week.total.distance)} · ${formatHours(week.total.movingTime)}</div>`,
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
            {VOLUME_CATEGORIES.map((category) => (
              <th key={category}>{category}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {[...weeks].reverse().map((w) => (
            <tr key={w.start}>
              <td>{formatDate(w.start)}</td>
              {VOLUME_CATEGORIES.map((category) => (
                <td key={category}>{formatMiles(w.byRunType[category].distance)}</td>
              ))}
              <td>
                {formatMiles(w.total.distance)} · {formatHours(w.total.movingTime)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
