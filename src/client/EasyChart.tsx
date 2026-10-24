import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { EasyRunType, EasyTrendRun } from "../domain/easyTrend";
import { formatDuration, secondsPerMile } from "../domain/pace";
import { escapeHtml, formatDate, formatHr, formatPace } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/**
 * Easy GAP and Easy HR over time for every Matched Easy Run and Long Run, Easy Efficiency below them,
 * and a table of the same numbers.
 */
export function EasyChart({ runs }: { runs: EasyTrendRun[] }) {
  if (runs.length === 0) return <p className="rest">No Easy Runs or Long Runs yet</p>;
  return (
    <section className="easy">
      <EasyLines runs={runs} option={chartOption} />
      <EasyLines runs={runs} option={efficiencyOption} className="easy-chart efficiency" />
      <EasyTable runs={runs} />
    </section>
  );
}

function EasyLines({
  runs,
  option,
  className = "easy-chart",
}: {
  runs: EasyTrendRun[];
  option: (runs: EasyTrendRun[], c: ChartColors) => echarts.EChartsCoreOption;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(option(runs, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [runs, option, dark]);

  return <div ref={ref} className={className} />;
}

interface ChartColors {
  gap: string;
  hr: string;
  efficiency: string;
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
    efficiency: v("--series-3"),
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

/** What both Easy charts share: the legend, a per-run tooltip and a time axis spanning the runs. */
function baseOption(runs: EasyTrendRun[], c: ChartColors) {
  const byId = new Map(runs.map((r) => [r.activityId, r]));
  const times = runs.map(time);
  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: { top: 0, left: 0, selectedMode: false, textStyle: { color: c.muted }, itemWidth: 22 },
    tooltip: {
      trigger: "item",
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { data: { id: string } }) => runTooltip(byId.get(params.data.id)),
    },
    xAxis: {
      type: "time",
      min: Math.min(...times) - DAY_MS,
      max: Math.max(...times) + DAY_MS,
      minInterval: DAY_MS,
      axisLabel: {
        ...axisLabel(c),
        hideOverlap: true,
        formatter: (v: number) => formatDate(new Date(v).toLocaleDateString("en-CA")),
      },
      axisLine: { lineStyle: { color: c.grid } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
  };
}

const axisLabel = (c: ChartColors) => ({ color: c.muted, fontSize: 11 });

/** The Run Types among `runs`, in legend order. */
const runTypesIn = (runs: EasyTrendRun[]) =>
  (Object.keys(RUN_TYPE_STYLE) as EasyRunType[]).filter((t) => runs.some((r) => r.runType === t));

/** One line of `runType`'s runs that have a `value`; each point keeps its run's id for the tooltip. */
function runLine(
  runs: EasyTrendRun[],
  runType: EasyRunType,
  c: ChartColors,
  line: { name: string; color: string; value: (r: EasyTrendRun) => number | null; yAxisIndex?: number },
) {
  return {
    name: line.name,
    type: "line",
    yAxisIndex: line.yAxisIndex ?? 0,
    data: runs
      .filter((r) => r.runType === runType && line.value(r) !== null)
      .map((r) => ({ value: [time(r), line.value(r)], id: r.activityId })),
    color: line.color,
    symbol: RUN_TYPE_STYLE[runType].symbol,
    symbolSize: runType === "Long Run" ? 11 : 8,
    itemStyle: { borderColor: c.surface, borderWidth: 1 },
    lineStyle: { width: 2, type: RUN_TYPE_STYLE[runType].line },
    emphasis: { disabled: true },
  };
}

function chartOption(runs: EasyTrendRun[], c: ChartColors): echarts.EChartsCoreOption {
  const axisName = { color: c.muted, fontSize: 11 };
  const gap = (r: EasyTrendRun) => (r.easyGap === null ? null : secondsPerMile(r.easyGap));
  return {
    ...baseOption(runs, c),
    grid: { left: 48, right: 48, top: 64, bottom: 28 },
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
        axisLabel: { ...axisLabel(c), formatter: (v: number) => formatDuration(v) },
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
        axisLabel: axisLabel(c),
        splitLine: { show: false },
        splitNumber: 4,
      },
    ],
    series: runTypesIn(runs).flatMap((t) => [
      runLine(runs, t, c, { name: `${t} GAP`, color: c.gap, value: gap }),
      runLine(runs, t, c, { name: `${t} HR`, color: c.hr, value: (r) => r.easyHr, yAxisIndex: 1 }),
    ]),
  };
}

/** Easy Efficiency over time; Easy Runs and Long Runs told apart as on the Easy GAP / Easy HR chart. */
function efficiencyOption(runs: EasyTrendRun[], c: ChartColors): echarts.EChartsCoreOption {
  return {
    ...baseOption(runs, c),
    grid: { left: 48, right: 48, top: 48, bottom: 28 },
    yAxis: {
      type: "value",
      name: "Easy Efficiency m/beat",
      nameTextStyle: { color: c.muted, fontSize: 11, align: "left" as const, padding: [0, 0, 0, -40] },
      scale: true,
      axisLabel: { ...axisLabel(c), formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { color: c.grid } },
      splitNumber: 4,
    },
    series: runTypesIn(runs).map((t) =>
      runLine(runs, t, c, { name: `${t} Efficiency`, color: c.efficiency, value: (r) => r.easyEfficiency }),
    ),
  };
}

function runTooltip(r: EasyTrendRun | undefined): string {
  if (!r) return "";
  const lines = [`<strong>${formatDate(r.date)}</strong> · ${r.runType}`, escapeHtml(r.name)];
  if (r.easyGap !== null) lines.push(`Easy GAP ${formatPace(r.easyGap)}`);
  if (r.easyHr !== null) lines.push(`Easy HR ${formatHr(r.easyHr)}`);
  if (r.easyEfficiency !== null) lines.push(`Easy Efficiency ${r.easyEfficiency.toFixed(2)} m/beat`);
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
            <th>Easy Efficiency</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((r) => (
            <tr key={r.activityId}>
              <td>{formatDate(r.date)}</td>
              <td>{r.runType}</td>
              <td>{r.easyGap === null ? "–" : formatPace(r.easyGap)}</td>
              <td>{r.easyHr === null ? "–" : formatHr(r.easyHr)}</td>
              <td>{r.easyEfficiency === null ? "–" : `${r.easyEfficiency.toFixed(2)} m/beat`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
