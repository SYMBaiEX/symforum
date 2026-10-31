// Instrument the installed, real renderer, not a replacement chart API.
// @ts-expect-error The production ESM file uses the package's separate declaration file.
import * as production from "../../../node_modules/lightweight-charts/dist/lightweight-charts.production.mjs";
import type * as ChartLibrary from "lightweight-charts";

const real = production as typeof ChartLibrary;
export const { CandlestickSeries, HistogramSeries, ColorType } = real;
export const evidence = { created: 0, removed: 0, fit: 0, autoScale: 0 };
let active: ChartLibrary.IChartApi | null = null;
Object.assign(window, {
  chartEvidence: evidence,
  panFixtureChart: () =>
    active?.timeScale().setVisibleLogicalRange({ from: 8, to: 12 }),
  fixtureChartRange: () => active?.timeScale().getVisibleLogicalRange(),
});
export const createChart: typeof ChartLibrary.createChart = (...args) => {
  if (location.search.includes("canvasfail"))
    throw Error("Invented renderer failure");
  const chart = real.createChart(...args);
  active = chart;
  evidence.created++;
  const remove = chart.remove.bind(chart);
  chart.remove = () => {
    evidence.removed++;
    if (active === chart) active = null;
    remove();
  };
  const timeScale = chart.timeScale();
  const fit = timeScale.fitContent.bind(timeScale);
  timeScale.fitContent = () => {
    evidence.fit++;
    fit();
  };
  const priceScale = chart.priceScale.bind(chart);
  chart.priceScale = (...parameters) => {
    const scale = priceScale(...parameters);
    const apply = scale.applyOptions.bind(scale);
    scale.applyOptions = (options) => {
      if (options.autoScale) evidence.autoScale++;
      apply(options);
    };
    return scale;
  };
  return chart;
};

// Only the fixture bundle substitutes its dynamic-import boundary. Resolution
// remains the installed real renderer, but tests can defer it across themes.
let deferred = false;
const imports: Array<() => void> = [];
Object.assign(window, {
  __loadFixtureChartLibrary: () => {
    const library = {
      createChart,
      CandlestickSeries,
      HistogramSeries,
      ColorType,
    };
    return deferred
      ? new Promise((resolve) => imports.push(() => resolve(library)))
      : Promise.resolve(library);
  },
  __deferChartImports: () => {
    deferred = true;
  },
  __pendingChartImports: () => imports.length,
  __releaseChartImport: () => imports.shift()?.(),
});
