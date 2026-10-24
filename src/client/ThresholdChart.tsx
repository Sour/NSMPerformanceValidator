import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { formatDuration, secondsPerMile } from "../domain/pace";
import type { ThresholdWeek } from "../domain/thresholdPace";
import { formatDate, formatPace } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/** LT1 Pace and LT2 Pace as of each Training Week; a week with Not enough data is a gap. */
export function ThresholdChart({ weeks }: { weeks: ThresholdWeek[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    if (!weeks.some((w) => w.lt2Pace !== null)) return;
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

  if (!weeks.some((w) => w.lt2Pace !== null)) return null;
  return <div ref={ref} className="threshold-chart" />;
}

interface ChartColors {
  lt1: string;
  lt2: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    lt1: v("--series-1"),
    lt2: v("--series-2"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

const SERIES = [
  { name: "LT1 Pace", pace: (w: ThresholdWeek) => w.lt1Pace, color: (c: ChartColors) => c.lt1, symbol: "circle" },
  { name: "LT2 Pace", pace: (w: ThresholdWeek) => w.lt2Pace, color: (c: ChartColors) => c.lt2, symbol: "diamond" },
] as const;

function chartOption(weeks: ThresholdWeek[], c: ChartColors): echarts.EChartsCoreOption {
  const axisLabel = { color: c.muted, fontSize: 11 };
  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: { top: 0, left: 0, selectedMode: false, textStyle: { color: c.muted }, itemWidth: 22 },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { dataIndex: number }[]) => weekTooltip(weeks[params[0]!.dataIndex]!),
    },
    grid: { left: 48, right: 16, top: 40, bottom: 28 },
    xAxis: {
      type: "category",
      data: weeks.map((w) => formatDate(w.start)),
      axisLabel: { ...axisLabel, hideOverlap: true },
      axisLine: { lineStyle: { color: c.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "Pace /mi",
      nameTextStyle: { color: c.muted, fontSize: 11, align: "left" as const, padding: [0, 0, 0, -40] },
      // Faster paces are smaller numbers; inverting puts improvement upward, as on the other pace charts.
      inverse: true,
      nameLocation: "start",
      scale: true,
      minInterval: 1,
      axisLabel: { ...axisLabel, formatter: (v: number) => formatDuration(v) },
      splitLine: { lineStyle: { color: c.grid } },
      splitNumber: 4,
    },
    series: SERIES.map((s) => ({
      name: s.name,
      type: "line",
      // A null breaks the line, so a week with Not enough data shows as a gap.
      data: weeks.map((w) => {
        const pace = s.pace(w);
        return pace === null ? null : secondsPerMile(pace);
      }),
      connectNulls: false,
      color: s.color(c),
      symbol: s.symbol,
      symbolSize: 8,
      itemStyle: { borderColor: c.surface, borderWidth: 1 },
      lineStyle: { width: 2 },
      emphasis: { disabled: true },
    })),
  };
}

function weekTooltip(w: ThresholdWeek): string {
  const pace = (p: number | null) => (p === null ? "Not enough data" : formatPace(p));
  return [`<strong>Week of ${formatDate(w.start)}</strong>`, `LT1 Pace ${pace(w.lt1Pace)}`, `LT2 Pace ${pace(w.lt2Pace)}`].join(
    "<br>",
  );
}
