import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { EasyRunType, EasyTrendRun } from "../domain/easyTrend";
import { formatDuration, secondsPerMile } from "../domain/pace";
import { escapeHtml, formatDate } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/** Easy GAP and Easy HR over time for every Matched Easy Run and Long Run, with a table of the same numbers. */
export function EasyChart({ runs }: { runs: EasyTrendRun[] }) {
  if (runs.length === 0) return <p className="rest">No Easy Runs or Long Runs yet</p>;
  return (
    <section className="easy">
      <EasyLines runs={runs} />
      <EasyTable runs={runs} />
    </section>
  );
}

function EasyLines({ runs }: { runs: EasyTrendRun[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(runs, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [runs, dark]);

  return <div ref={ref} className="easy-chart" />;
}

interface ChartColors {
  gap: string;
  hr: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    gap: v("--series-1"),
    hr: v("--series-2"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

/** Easy Runs and Long Runs are told apart by marker shape and line style, so color stays free for GAP against HR. */
const RUN_TYPE_STYLE: Record<EasyRunType, { symbol: string; line: "solid" | "dashed" }> = {
  "Easy Run": { symbol: "circle", line: "solid" },
  "Long Run": { symbol: "diamond", line: "dashed" },
};

const DAY_MS = 86_400_000;
const time = (r: EasyTrendRun) => Date.parse(`${r.date}T00:00:00`);

function chartOption(runs: EasyTrendRun[], c: ChartColors): echarts.EChartsCoreOption {
  const byId = new Map(runs.map((r) => [r.activityId, r]));
  const runTypes = (Object.keys(RUN_TYPE_STYLE) as EasyRunType[]).filter((t) => runs.some((r) => r.runType === t));
  const axisLabel = { color: c.muted, fontSize: 11 };
  const axisName = { color: c.muted, fontSize: 11 };
  const times = runs.map(time);
  /** One line per Run Type and metric; each point keeps its run's id for the tooltip. */
  const series = (runType: EasyRunType, metric: "GAP" | "HR") => {
    const value = (r: EasyTrendRun) =>
      metric === "GAP" ? (r.gap === null ? null : secondsPerMile(r.gap)) : r.averageHeartrate;
    const color = metric === "GAP" ? c.gap : c.hr;
    return {
      name: `${runType} ${metric}`,
      type: "line",
      yAxisIndex: metric === "GAP" ? 0 : 1,
      data: runs
        .filter((r) => r.runType === runType && value(r) !== null)
        .map((r) => ({ value: [time(r), value(r)], id: r.activityId })),
      color,
      symbol: RUN_TYPE_STYLE[runType].symbol,
      symbolSize: runType === "Long Run" ? 11 : 8,
      itemStyle: { borderColor: c.surface, borderWidth: 1 },
      lineStyle: { width: 2, type: RUN_TYPE_STYLE[runType].line },
      emphasis: { disabled: true },
    };
  };

  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: {
      top: 0,
      left: 0,
      selectedMode: false,
      textStyle: { color: c.muted },
      itemWidth: 22,
    },
    tooltip: {
      trigger: "item",
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { data: { id: string } }) => runTooltip(byId.get(params.data.id)),
    },
    grid: { left: 48, right: 48, top: 64, bottom: 28 },
    xAxis: {
      type: "time",
      min: Math.min(...times) - DAY_MS,
      max: Math.max(...times) + DAY_MS,
      minInterval: DAY_MS,
      axisLabel: {
        ...axisLabel,
        hideOverlap: true,
        formatter: (v: number) => formatDate(new Date(v).toLocaleDateString("en-CA")),
      },
      axisLine: { lineStyle: { color: c.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: "Easy GAP /mi",
        nameTextStyle: { ...axisName, align: "left" as const, padding: [0, 0, 0, -40] },
        // Faster paces are smaller numbers; inverting puts improvement upward, as on the Rep GAP charts.
        inverse: true,
        nameLocation: "start",
        scale: true,
        minInterval: 1,
        axisLabel: { ...axisLabel, formatter: (v: number) => formatDuration(v) },
        splitLine: { lineStyle: { color: c.grid } },
        splitNumber: 4,
      },
      {
        type: "value",
        name: "Easy HR bpm",
        nameTextStyle: { ...axisName, align: "right" as const, padding: [0, -40, 0, 0] },
        position: "right",
        scale: true,
        minInterval: 1,
        axisLabel,
        splitLine: { show: false },
        splitNumber: 4,
      },
    ],
    series: runTypes.flatMap((t) => [series(t, "GAP"), series(t, "HR")]),
  };
}

function runTooltip(r: EasyTrendRun | undefined): string {
  if (!r) return "";
  const lines = [`<strong>${formatDate(r.date)}</strong> · ${r.runType}`, escapeHtml(r.name)];
  if (r.gap !== null) lines.push(`Easy GAP ${formatDuration(secondsPerMile(r.gap))} /mi`);
  if (r.averageHeartrate !== null) lines.push(`Easy HR ${Math.round(r.averageHeartrate)} bpm`);
  return lines.join("<br>");
}

function EasyTable({ runs }: { runs: EasyTrendRun[] }) {
  return (
    <details className="runs">
      <summary>Easy Runs and Long Runs</summary>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Run Type</th>
            <th>Easy GAP</th>
            <th>Easy HR</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((r) => (
            <tr key={r.activityId}>
              <td>{formatDate(r.date)}</td>
              <td>{r.runType}</td>
              <td>{r.gap === null ? "–" : `${formatDuration(secondsPerMile(r.gap))} /mi`}</td>
              <td>{r.averageHeartrate === null ? "–" : `${Math.round(r.averageHeartrate)} bpm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
