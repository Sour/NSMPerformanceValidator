import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { EasyPaceTrend, EasyRunType, EasyTrend, EasyTrendRun } from "../domain/easyTrend";
import { formatDuration, secondsPerMile } from "../domain/pace";
import { escapeHtml, formatDate, formatHr, formatPace } from "./format";
import { usePrefersDark } from "./usePrefersDark";

echarts.use([LineChart, ScatterChart, BarChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

/**
 * Easy Pace over time for every Matched Easy Run and Long Run, with each Run Type's 6-Training-Week trend and its
 * change in a headline, minutes walked per run below, and a table of the same numbers.
 */
export function EasyChart({ easy }: { easy: EasyTrend }) {
  if (easy.runs.length === 0) return <p className="rest">No Easy Runs or Long Runs yet</p>;
  return (
    <section className="easy">
      {easy.referenceHr === null ? (
        <p className="rest">
          Easy Pace cannot be computed: it needs the Max HR of your intervals.icu Run settings and an Easy HR Target in the
          plan
        </p>
      ) : (
        <>
          <Headlines easy={easy} />
          <EasyPaceChart easy={easy} />
        </>
      )}
      <EasyTable runs={easy.runs} />
    </section>
  );
}

/** Each Run Type's change in Easy Pace over the window, e.g. "Easy Run −8 s/mi over 6 weeks · 2 Grey Zone Runs". */
function Headlines({ easy }: { easy: EasyTrend }) {
  return (
    <div className="easy-headlines">
      {runTypesIn(easy.runs).map((t) => (
        <p key={t} className="easy-headline">
          <span className="threshold-name">{t}</span> <strong>{change(easy.trends[t])}</strong>
          {easy.trends[t].greyZoneRuns > 0 && (
            <span className="range">
              {" "}
              · {easy.trends[t].greyZoneRuns} Grey Zone Run{easy.trends[t].greyZoneRuns === 1 ? "" : "s"}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

/** The trend line's change in seconds per mile; negative is faster. */
function change(trend: EasyPaceTrend): string {
  if (trend.line === null) return "Not enough data";
  const seconds = Math.round(secondsPerMile(trend.line.end) - secondsPerMile(trend.line.start));
  return `${seconds > 0 ? "+" : seconds < 0 ? "−" : "±"}${Math.abs(seconds)} s/mi over 6 weeks`;
}

function EasyPaceChart({ easy }: { easy: EasyTrend }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = usePrefersDark();

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(chartOption(easy, chartColors()));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [easy, dark]);

  return <div ref={ref} className="easy-chart" />;
}

interface ChartColors {
  pace: string;
  trend: string;
  walk: string;
  overTarget: string;
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

function chartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    pace: v("--series-1"),
    trend: v("--series-2"),
    walk: v("--series-3"),
    overTarget: v("--over-target"),
    text: v("--text"),
    muted: v("--muted"),
    grid: v("--border"),
    surface: v("--surface"),
  };
}

/** Easy Runs and Long Runs are told apart by marker shape and line style. */
const RUN_TYPE_STYLE: Record<EasyRunType, { symbol: string; line: "solid" | "dashed" }> = {
  "Easy Run": { symbol: "circle", line: "solid" },
  "Long Run": { symbol: "diamond", line: "dashed" },
};

const DAY_MS = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00`);

/** The Run Types among `runs`, in legend order. */
const runTypesIn = (runs: EasyTrendRun[]) =>
  (Object.keys(RUN_TYPE_STYLE) as EasyRunType[]).filter((t) => runs.some((r) => r.runType === t));

/**
 * Easy Pace on top, faster upward, with one line per Run Type through the runs that count, Grey Zone Runs as hollow
 * markers off the line, and each trend line; minutes walked per run below on the same time axis.
 */
function chartOption(easy: EasyTrend, c: ChartColors): echarts.EChartsCoreOption {
  const { runs, trends, referenceHr } = easy;
  const byId = new Map(runs.map((r) => [r.activityId, r]));
  const times = runs.map((r) => time(r.date));
  const axisLabel = { color: c.muted, fontSize: 11 };
  const axisName = { color: c.muted, fontSize: 11, align: "left" as const, padding: [0, 0, 0, -40] };
  const symbolSize = (t: EasyRunType) => (t === "Long Run" ? 11 : 8);
  const pace = (r: EasyTrendRun) => secondsPerMile(r.easyPace!);
  /** A run's point, ringed in red when the run was Over Target. */
  const point = (r: EasyTrendRun) => ({
    value: [time(r.date), pace(r)],
    id: r.activityId,
    ...(r.overTarget && { itemStyle: { borderColor: c.overTarget, borderWidth: 3 } }),
  });
  const xAxis = (grid: number) => ({
    type: "time",
    gridIndex: grid,
    min: Math.min(...times) - DAY_MS,
    max: Math.max(...times) + DAY_MS,
    minInterval: DAY_MS,
    axisLabel: {
      ...axisLabel,
      show: grid === 1,
      hideOverlap: true,
      formatter: (v: number) => formatDate(new Date(v).toLocaleDateString("en-CA")),
    },
    axisLine: { lineStyle: { color: c.grid } },
    axisTick: { show: false },
    splitLine: { show: false },
  });
  const types = runTypesIn(runs);
  const hasWalkTime = runs.some((r) => r.walkBreakTime !== null);
  const hasOverTarget = runs.some((r) => r.overTarget && !r.greyZone);
  const hasGreyZone = runs.some((r) => r.greyZone && r.easyPace !== null);

  return {
    animation: false,
    textStyle: { fontFamily: "system-ui, sans-serif" },
    legend: {
      top: 0,
      left: 0,
      data: [...types, "Trend", ...(hasOverTarget ? ["Over Target"] : []), ...(hasGreyZone ? ["Grey Zone Run"] : [])],
      selectedMode: false,
      textStyle: { color: c.muted },
      itemWidth: 22,
    },
    tooltip: {
      trigger: "item",
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.text },
      formatter: (params: { data: { id?: string } }) => runTooltip(params.data.id ? byId.get(params.data.id) : undefined),
    },
    grid: [
      { left: 48, right: 16, top: 64, bottom: hasWalkTime ? 140 : 28 },
      { left: 48, right: 16, height: hasWalkTime ? 64 : 0, bottom: 28 },
    ],
    xAxis: [xAxis(0), xAxis(1)],
    yAxis: [
      {
        type: "value",
        name: `Easy Pace at ${formatHr(referenceHr!)}`,
        nameTextStyle: axisName,
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
        gridIndex: 1,
        show: hasWalkTime,
        name: "Walked min",
        nameTextStyle: axisName,
        minInterval: 1,
        axisLabel,
        splitLine: { lineStyle: { color: c.grid } },
        splitNumber: 2,
      },
    ],
    series: [
      ...types.flatMap((t) => {
        const ofType = runs.filter((r) => r.runType === t && r.easyPace !== null);
        const style = RUN_TYPE_STYLE[t];
        const line = trends[t].line;
        return [
          {
            name: t,
            type: "line",
            data: ofType.filter((r) => !r.greyZone).map(point),
            color: c.pace,
            symbol: style.symbol,
            symbolSize: symbolSize(t),
            itemStyle: { borderColor: c.surface, borderWidth: 1 },
            lineStyle: { width: 2, type: style.line },
            emphasis: { disabled: true },
          },
          {
            name: "Grey Zone Run",
            type: "scatter",
            data: ofType.filter((r) => r.greyZone).map((r) => ({ value: [time(r.date), pace(r)], id: r.activityId })),
            symbol: style.symbol,
            symbolSize: symbolSize(t),
            itemStyle: { color: c.surface, borderColor: c.pace, borderWidth: 2 },
            emphasis: { disabled: true },
          },
          {
            name: "Trend",
            type: "line",
            data:
              line === null
                ? []
                : [
                    [time(trends[t].from), secondsPerMile(line.start)],
                    [time(trends[t].to), secondsPerMile(line.end)],
                  ],
            color: c.trend,
            symbol: "none",
            silent: true,
            lineStyle: { width: 2, type: style.line },
            tooltip: { show: false },
          },
        ];
      }),
      /** No points of its own: it puts the red ring that marks Over Target runs in the legend. */
      {
        name: "Over Target",
        type: "scatter",
        data: [],
        symbolSize: 9,
        itemStyle: { color: c.surface, borderColor: c.overTarget, borderWidth: 2 },
      },
      {
        name: "Walked",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: runs.filter((r) => r.walkBreakTime !== null).map((r) => ({ value: [time(r.date), r.walkBreakTime! / 60], id: r.activityId })),
        color: c.walk,
        barMaxWidth: 6,
        emphasis: { disabled: true },
      },
    ],
  };
}

function runTooltip(r: EasyTrendRun | undefined): string {
  if (!r) return "";
  const lines = [`<strong>${formatDate(r.date)}</strong> · ${r.runType}`, escapeHtml(r.name)];
  if (r.easyPace !== null) lines.push(`Easy Pace ${formatPace(r.easyPace)}`);
  if (r.easyGap !== null) lines.push(`Easy GAP ${formatPace(r.easyGap)}`);
  if (r.easyHr !== null) lines.push(`Easy HR ${formatHr(r.easyHr)}`);
  if (r.walkBreakTime !== null) lines.push(`walked ${formatDuration(r.walkBreakTime)}`);
  lines.push(hrCheck(r));
  return lines.join("<br>");
}

/** How the run went against its Easy HR Target, e.g. "Grey Zone Run: 31% above 141 bpm, not in the trend". */
function hrCheck(r: EasyTrendRun): string {
  if (r.easyHrTargetTop === null) return "HR check not possible: no Max HR or Easy HR Target";
  if (r.timeAboveTarget === null) return "HR check not possible: no heart-rate stream";
  const above = `${timeAbove(r.timeAboveTarget)} above ${formatHr(r.easyHrTargetTop)}`;
  if (r.greyZone) return `<span class="over-target">Grey Zone Run: ${above}, not in the trend</span>`;
  if (r.overTarget) return `<span class="over-target">Over Target: ${above}</span>`;
  return above;
}

const timeAbove = (share: number) => `${Math.round(share * 100)}%`;

function EasyTable({ runs }: { runs: EasyTrendRun[] }) {
  return (
    <details className="runs">
      <summary>Easy Runs and Long Runs</summary>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Run Type</th>
            <th>Easy Pace</th>
            <th>Easy GAP</th>
            <th>Easy HR</th>
            <th>Walked</th>
            <th>Above target</th>
          </tr>
        </thead>
        <tbody>
          {[...runs].reverse().map((r) => (
            <tr key={r.activityId}>
              <td>{formatDate(r.date)}</td>
              <td>{r.runType}</td>
              <td>{r.easyPace === null ? "–" : formatPace(r.easyPace)}</td>
              <td>{r.easyGap === null ? "–" : formatPace(r.easyGap)}</td>
              <td>{r.easyHr === null ? "–" : formatHr(r.easyHr)}</td>
              <td>{r.walkBreakTime === null ? "–" : formatDuration(r.walkBreakTime)}</td>
              <td>
                {r.timeAboveTarget === null ? "–" : timeAbove(r.timeAboveTarget)}
                {r.greyZone ? (
                  <span className="over-target"> Grey Zone Run</span>
                ) : (
                  r.overTarget && <span className="over-target"> Over Target</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
