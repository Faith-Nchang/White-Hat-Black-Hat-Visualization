"use strict";

const margins = { top: 24, right: 24, bottom: 40, left: 56 };

const palette = {
  blue: "#0072b2",
  orange: "#e69f00",
  green: "#009e73",
  vermillion: "#d55e00",
  sky: "#56b4e9",
  purple: "#cc79a7",
  yellow: "#f0e442",
  black: "#000000"
};

const categorical = Object.values(palette);

const fmtMt = d3.format(",.1f");
const fmtInt = d3.format(",d");
const fmtPct = d3.format("+.1%");

const formatMt = v => (v == null || Number.isNaN(v) ? "n/a" : `${fmtMt(v)} Mt`);
const formatInt = v => fmtInt(v);
const formatPct = v => (v == null || !Number.isFinite(v) ? "n/a" : fmtPct(v));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const dataStore = (() => {
  let rows = null;
  let loading = null;

  function ensure() {
    if (!rows) throw new Error("Data not loaded yet; await load() first.");
    return rows;
  }

  return {
    load(url = "./data/emissions.csv") {
      if (!loading) {
        loading = d3.csv(url, d3.autoType).then(data => {
          rows = data.filter(d => d.pollutant === "GHG" && d.mt != null);
          return rows;
        });
      }
      return loading;
    },
    allRows() {
      return ensure();
    },
    countryRows() {
      return ensure().filter(d => !d.is_aggregate);
    },
    series(code, measure) {
      return ensure()
        .filter(d => d.code === code && d.measure === measure)
        .sort((a, b) => a.year - b.year)
        .map(d => ({ year: d.year, mt: d.mt }));
    },
    completeCountries(measure, startYear, endYear) {
      const needed = endYear - startYear + 1;
      const years = new Map();
      const names = new Map();
      for (const d of this.countryRows()) {
        if (d.measure !== measure || d.year < startYear || d.year > endYear) continue;
        if (!years.has(d.code)) years.set(d.code, new Set());
        years.get(d.code).add(d.year);
        names.set(d.code, d.country);
      }
      return [...years]
        .filter(([, set]) => set.size === needed)
        .map(([code]) => ({ code, country: names.get(code) }))
        .sort((a, b) => a.country.localeCompare(b.country));
    }
  };
})();


function createState(initial = {}) {
  let selectedCountries = [...(initial.selectedCountries || [])];
  let yearRange = [...(initial.yearRange || [1990, 2022])];
  const listeners = new Set();

  function snapshot() {
    return { selectedCountries: [...selectedCountries], yearRange: [...yearRange] };
  }

  function notify(changed) {
    for (const fn of [...listeners]) fn(snapshot(), changed);
  }

  return {
    get selectedCountries() { return [...selectedCountries]; },
    get yearRange() { return [...yearRange]; },
    snapshot,
    setSelectedCountries(codes) {
      const next = [...new Set(codes)];
      if (next.length === selectedCountries.length && next.every((c, i) => c === selectedCountries[i])) return;
      selectedCountries = next;
      notify("selectedCountries");
    },
    setYearRange(start, end) {
      const next = start <= end ? [start, end] : [end, start];
      if (next[0] === yearRange[0] && next[1] === yearRange[1]) return;
      yearRange = next;
      notify("yearRange");
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}


function createTooltip() {
  const el = d3.select("body").append("div")
    .attr("class", "tooltip")
    .attr("role", "tooltip")
    .attr("aria-hidden", "true");

  return {
    show(html, x, y) {
      el.html(html).classed("visible", true);
      this.move(x, y);
    },
    move(x, y) {
      const node = el.node();
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      const left = Math.min(x + 12, window.innerWidth - w - 8);
      const top = y - h - 12 < 0 ? y + 16 : y - h - 12;
      el.style("left", `${Math.max(8, left)}px`).style("top", `${top}px`);
    },
    hide() {
      el.classed("visible", false);
    }
  };
}


function noData(container, message = "No data available for this selection.") {
  const root = d3.select(container);
  root.selectAll("*").remove();
  root.append("div")
    .attr("class", "no-data")
    .attr("role", "img")
    .attr("aria-label", message)
    .text(message);
}


// Which of the three distortions the reader has fixed in the reveal section.
const reveal = { window: false, axis: false, framing: false };
let lineTooltip = null;

// Keep one fixed cohort across both windows so the reveal changes framing only.
function emissionsTotalSeries() {
  const countries = dataStore.completeCountries("excl", 1990, 2022);
  const codes = new Set(countries.map(d => d.code));
  const rows = dataStore.countryRows().filter(d =>
    codes.has(d.code) && d.measure === "excl" && d.year >= 1990 && d.year <= 2022);
  return {
    countries,
    series: d3.rollups(rows, values => d3.sum(values, d => d.mt), d => d.year)
      .map(([year, mt]) => ({ year, mt })).sort((a, b) => a.year - b.year)
  };
}

function renderEmissionsLine(container, options) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const { countries, series } = emissionsTotalSeries();
  if (!countries.length) return noData(container, "No countries have complete 1990–2022 data.");
  const plotted = options.fullPeriod ? series : series.filter(d => d.year >= 2007 && d.year <= 2020);
  const first = plotted[0], last = plotted[plotted.length - 1];
  const peak = series.find(d => d.year === 2007);
  const dip = series.find(d => d.year === 2020);
  const drop = (1 - dip.mt / peak.mt) * 100;
  const color = options.neutralHeadline ? palette.blue : palette.green;
  root.append("h4").attr("class", "emissions-headline").text(options.neutralHeadline
    ? `Total greenhouse gas emissions, ${first.year}–${last.year}`
    : `Emissions Have Fallen ${drop.toFixed(1)}% Since 2007`);
  // The distorted version leaves the end year out of the chips; it appears only on the x-axis.
  const chipTexts = options.neutralHeadline
    ? [`${countries.length} countries with complete data`, `${first.year}–${last.year}`, "Excluding land use"]
    : [`${countries.length} countries with complete data`, "National totals", "Excluding land use"];
  root.append("ul").attr("class", "wh-stats").attr("aria-label", "Summary")
    .selectAll("li").data(chipTexts).join("li").attr("class", "wh-chip").text(d => d);

  const W = Math.max(300, Math.min(container.clientWidth || 900, 1000));
  const narrow = W < 560;
  const H = narrow ? 320 : Math.round(Math.min(440, W * 0.5));
  const margin = narrow ? { top: 34, right: 18, bottom: 48, left: 56 } : { top: 35, right: 35, bottom: 60, left: 90 };
  const width = W - margin.left - margin.right;
  const height = H - margin.top - margin.bottom;
  const labelSize = narrow ? 11 : 13;
  const chart = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img").attr("aria-label", `Total greenhouse gas emissions from ${first.year} to ${last.year}. ${options.zeroBaseline ? "Zero" : "Truncated"} y-axis baseline.`);
  chart.append("title").text(`Emissions in ${first.year}: ${formatMt(first.mt)}; in ${last.year}: ${formatMt(last.mt)}.`);
  const svg = chart.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  let xScale, yScale, heightShare = 0;


  function updateAxes() {
    xScale = d3.scaleLinear().domain([first.year, last.year]).range([0, width]);
    const [min, max] = d3.extent(plotted, d => d.mt);
    const padding = (max - min) * 0.09 || max * 0.05;
    yScale = d3.scaleLinear().domain([options.zeroBaseline ? 0 : min - padding, max + padding])
      .nice().range([height, 0]);
    // How much of the chart height the first-to-last drop fills (used by the reveal readout).
    heightShare = Math.abs(yScale(first.mt) - yScale(last.mt)) / height;
    svg.append("g").attr("class", "emissions-grid")
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(""))
      .call(g => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).tickValues(options.fullPeriod
        ? (narrow ? [1990, 2000, 2010, 2022] : [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2022])
        : (narrow ? [2007, 2013, 2020] : [2007, 2010, 2013, 2016, 2020])).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(",.0f")));
    svg.append("text").attr("x", 0).attr("y", -16).attr("class", "emissions-unit").style("font-size", narrow ? "11px" : null).text("Million tonnes CO₂ equivalent (Mt CO₂e)");
    svg.append("text").attr("x", width / 2).attr("y", height + (narrow ? 40 : 45)).attr("text-anchor", "middle")
      .attr("font-size", 12).style("fill", "var(--muted)").text("Year");
  }

  function updateVis() {
    if (options.fullPeriod) {
      // Place the selected window behind the data without changing the scales.
      const window = svg.insert("g", ":first-child").attr("class", "selected-window")
        .attr("pointer-events", "none");
      window.append("rect")
        .attr("x", xScale(2007)).attr("y", 0)
        .attr("width", xScale(2020) - xScale(2007)).attr("height", height)
        .attr("fill", palette.orange).attr("fill-opacity", 0.14);
      window.selectAll("line").data([2007, 2020]).join("line")
        .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
        .attr("y1", 0).attr("y2", height)
        .style("stroke", "var(--warn-line)").attr("stroke-dasharray", "4 4");
      svg.append("text")
        .attr("x", (xScale(2007) + xScale(2020)) / 2).attr("y", 18)
        .attr("text-anchor", "middle").style("fill", "var(--warn-ink)")
        .attr("font-size", labelSize).attr("font-weight", 600)
        .text(narrow ? "2007–2020 window" : "2007–2020: window used in distorted chart");
    }
    svg.append("path").datum(plotted).attr("fill", "none").attr("stroke", color)
      .attr("stroke-width", 3).attr("stroke-linejoin", "round")
      .attr("d", d3.line().x(d => xScale(d.year)).y(d => yScale(d.mt)));
    svg.selectAll(".emissions-point").data(plotted, d => d.year).join("circle")
      .attr("class", "emissions-point").attr("cx", d => xScale(d.year))
      .attr("cy", d => yScale(d.mt)).attr("r", 5).attr("fill", color)
      .style("stroke", "var(--surface)").attr("stroke-width", 1.5)
      .on("mousemove", (event, d) => {
        lineTooltip = lineTooltip || createTooltip();
        lineTooltip.show(
          `<strong>${d.year}</strong><br>${formatMt(d.mt)}<br>vs ${first.year}: ${formatPct(d.mt / first.mt - 1)}`,
          event.clientX, event.clientY);
      })
      .on("mouseleave", () => lineTooltip && lineTooltip.hide());
    if (!options.neutralHeadline) {
      // Direct labels draw the eye to the two endpoints that make the decline look largest.
      svg.append("text").attr("x", xScale(first.year) + 10).attr("y", yScale(first.mt) - 12)
        .attr("font-size", labelSize).attr("font-weight", 600)
        .text(`${first.year}: ${formatMt(first.mt)}`);
      svg.append("text").attr("x", xScale(last.year) - 10).attr("y", yScale(last.mt) - 14)
        .attr("text-anchor", "end").attr("font-size", narrow ? 12.5 : 15).attr("font-weight", 700).style("fill", "var(--good-ink)")
        .text(`${formatPct(last.mt / first.mt - 1)} since ${first.year}`);
    }
  }

  updateAxes();
  updateVis();
  root.append("p").attr("class", "caption").text(
    "Source: OECD Air Emissions GHG Inventories (DF_AIR_GHG), data/emissions.csv. Sum of national GHG totals; regional aggregates excluded.");
  if (options.neutralHeadline) {
    root.append("p").attr("class", "caption").text(
      `The 2007–2020 drop is ${drop.toFixed(1)}%. The endpoint coincides with the COVID-19 pandemic. Over 1990–2022, this same cohort changed by ${formatPct(series[series.length - 1].mt / series[0].mt - 1)}.`);
  }
  return { first, last, pct: last.mt / first.mt - 1, heightShare };
}


function setupEmissionsToggle(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();

  const full = emissionsTotalSeries().series;
  const fullPct = full[full.length - 1].mt / full[0].mt - 1;

  const FIXES = [
    { key: "window", title: "Show the full time period",
      off: "Now: 2007–2020 only", on: "Now: every year, 1990–2022",
      still: "The chart starts at the 2007 peak and stops at the 2020 pandemic low." },
    { key: "axis", title: "Start the vertical axis at zero",
      off: "Now: zoomed-in axis", on: "Now: axis starts at 0",
      still: "The vertical axis is zoomed in, which makes the drop look larger." },
    { key: "framing", title: "Use a neutral title and color",
      off: "Now: upbeat headline, green line", on: "Now: descriptive title, blue line",
      still: "The headline and green line frame the decline as good news." }
  ];

  // Presets
  const presets = root.append("div").attr("class", "toggle-group")
    .attr("role", "group").attr("aria-label", "Presets");
  const presetButtons = presets.selectAll("button")
    .data([{ all: false, label: "Distorted" }, { all: true, label: "Fix everything" }])
    .join("button").attr("type", "button").text(d => d.label)
    .on("click", (event, d) => {
      FIXES.forEach(f => { reveal[f.key] = d.all; });
      update();
    });

  // One independent switch per trick
  const list = root.append("div").attr("class", "fix-list")
    .attr("role", "group").attr("aria-label", "Fix one distortion at a time");
  const fixes = list.selectAll("label").data(FIXES).join("label").attr("class", "fix");
  fixes.append("input").attr("type", "checkbox").attr("role", "switch")
    .on("change", (event, d) => { reveal[d.key] = event.target.checked; update(); });
  fixes.append("span").attr("class", "fix-track").attr("aria-hidden", "true");
  const fixText = fixes.append("span").attr("class", "fix-text");
  fixText.append("strong").text(d => d.title);
  const fixState = fixText.append("span").attr("class", "fix-state");

  // Live readout of what the chart now says
  const readout = root.append("div").attr("class", "reveal-readout").attr("aria-live", "polite");
  const chart = root.append("div").attr("id", "emissions-comparison-chart");
  const explanation = root.append("div").attr("class", "comparison-explanation");

  function update() {
    fixes.select("input").property("checked", d => reveal[d.key]);
    fixState.text(d => (reveal[d.key] ? d.on : d.off));
    const allFixed = FIXES.every(f => reveal[f.key]);
    const noneFixed = FIXES.every(f => !reveal[f.key]);
    presetButtons.attr("aria-pressed", d => String(d.all ? allFixed : noneFixed));

    const info = renderEmissionsLine(chart.node(), {
      fullPeriod: reveal.window,
      zeroBaseline: reveal.axis,
      neutralHeadline: reveal.framing
    });

    readout.selectAll("*").remove();
    if (info) {
      const stats = [
        { label: "Change the chart shows", value: formatPct(info.pct), sub: `${info.first.year}–${info.last.year}` },
        { label: "Drop fills", value: `${Math.round(info.heightShare * 100)}%`, sub: "of the chart height" },
        { label: "Tone", value: reveal.framing ? "Neutral" : "Upbeat", sub: reveal.framing ? "blue line" : "green line" }
      ];
      const cell = readout.selectAll("div").data(stats).join("div").attr("class", "reveal-stat");
      cell.append("span").attr("class", "reveal-stat-value").text(d => d.value);
      cell.append("span").attr("class", "reveal-stat-label").text(d => d.label);
      cell.append("span").attr("class", "reveal-stat-sub").text(d => d.sub);
    }

    explanation.selectAll("*").remove();
    if (allFixed) {
      explanation.append("strong").text("What changed?");
      explanation.append("p").text(
        `Every year from 1990 to 2022 is shown, the vertical axis starts at zero, and the title and color are neutral. Across the full period, total emissions changed ${formatPct(fullPct)}. The countries and data are exactly the same.`);
    } else {
      explanation.append("strong").text(noneFixed ? "What is missing?" : "Still distorted");
      explanation.append("p").text(FIXES.filter(f => !reveal[f.key]).map(f => f.still).join(" "));
    }
  }

  update();
}

// ---- White hat 1: change by country --------------------------------------
let changeSort = "value";
let changeMeasure = "pct";
let changeTooltip = null;

// Per-country % change, absolute change and share of the cohort's net change.
function changeByCountryData(startYear, endYear) {
  const cohort = dataStore.completeCountries("excl", startYear, endYear);
  const rows = cohort.map(({ code, country }) => {
    const s = dataStore.series(code, "excl");
    const a = s.find(d => d.year === startYear).mt;
    const b = s.find(d => d.year === endYear).mt;
    return { code, country, start: a, end: b, abs: b - a, pct: b / a - 1 };
  });
  const startTotal = d3.sum(rows, d => d.start);
  const endTotal = d3.sum(rows, d => d.end);
  const netAbs = endTotal - startTotal;
  rows.forEach(d => { d.share = netAbs === 0 ? null : d.abs / netAbs; });
  const included = new Set(rows.map(d => d.code));
  const excluded = new Map();
  for (const d of dataStore.countryRows()) {
    if (d.measure === "excl" && !included.has(d.code)) excluded.set(d.code, d.country);
  }
  return {
    rows,
    total: { country: `All ${rows.length} countries`, start: startTotal, end: endTotal, abs: netAbs, pct: endTotal / startTotal - 1, isTotal: true },
    excluded: [...excluded.values()].sort((a, b) => a.localeCompare(b))
  };
}

function renderChangeByCountry(container, state) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const [startYear, endYear] = state.yearRange;
  const { rows, total, excluded } = changeByCountryData(startYear, endYear);
  if (!rows.length) return noData(container, `No countries have complete ${startYear}–${endYear} data.`);

  const measures = {
    pct: {
      label: "% change",
      title: `% change in emissions, ${startYear} → ${endYear}`,
      fmt: d3.format("+.1%"), tick: d3.format("+.0%"), word: "%"
    },
    abs: {
      label: "Absolute change (Mt)",
      title: `Change in emissions (Mt CO₂e), ${startYear} → ${endYear}`,
      fmt: v => `${v > 0 ? "+" : ""}${d3.format(",.0f")(v)}`, tick: d3.format("+,.0f"), word: "Mt"
    }
  };
  const key = changeMeasure;
  const M = measures[key];

  // Sort by the measure on screen (largest cut first), or alphabetically.
  rows.sort(changeSort === "alpha"
    ? (a, b) => a.country.localeCompare(b.country)
    : (a, b) => a[key] - b[key]);

  const nDown = rows.filter(d => d.pct < 0).length;
  root.append("h4").attr("class", "emissions-headline")
    .text(`How much did each country's greenhouse gas emissions change, ${startYear}–${endYear}?`);
  // Summary chips double as the color legend (blue = fell, red-orange = rose).
  const stats = root.append("ul").attr("class", "wh-stats").attr("aria-label", "Summary");
  const chips = [
    { text: `${rows.length} countries with complete data` },
    { text: `${nDown} fell`, color: palette.blue },
    { text: `${rows.length - nDown} rose or stayed flat`, color: palette.vermillion },
    { text: "Totals exclude land use" }
  ];
  const chip = stats.selectAll("li").data(chips).join("li").attr("class", "wh-chip");
  chip.filter(d => d.color).append("span").attr("class", "wh-swatch")
    .attr("aria-hidden", "true").style("background", d => d.color);
  chip.append("span").text(d => d.text);

  const rerender = () => renderChangeByCountry(container, state);
  const toolbar = root.append("div").attr("class", "wh-toolbar");
  const control = (label, items, current, onPick, level, visibleLabel) => {
    const wrap = toolbar.append("div").attr("class", `wh-control wh-control-${level}`);
    wrap.append("span").attr("class", "wh-label").attr("aria-hidden", "true").text(visibleLabel);
    const group = wrap.append("div").attr("class", "segmented")
      .attr("role", "group").attr("aria-label", label);
    group.selectAll("button").data(items).join("button")
      .attr("type", "button").text(d => d.label)
      .attr("aria-pressed", d => String(d.k === current))
      .on("click", (event, d) => { onPick(d.k); rerender(); });
  };
  control("Measure shown",
    [{ k: "pct", label: "% change" }, { k: "abs", label: "Absolute change (Mt)" }],
    changeMeasure, k => { changeMeasure = k; }, "primary", "Show");
  control("Sort countries by",
    [{ k: "value", label: "By value" }, { k: "alpha", label: "A–Z" }],
    changeSort, k => { changeSort = k; }, "secondary", "Sort");

  const W = Math.max(320, Math.min(container.clientWidth || 1000, 1100));
  const narrow = W < 620;
  const rowH = 20, sep = 14;
  const m = narrow ? { top: 46, bottom: 44, left: 112, right: 26 } : { top: 52, bottom: 48, left: 185, right: 150 };
  const panelW = W - m.left - m.right;
  const labelSize = narrow ? 11 : 12.5, valueSize = narrow ? 10.5 : 11.5;
  const rowLabel = d => (narrow && d.country.length > 17 ? `${d.country.slice(0, 16)}…` : d.country);
  const H = m.top + rowH * (rows.length + 1) + sep + m.bottom;
  const innerH = H - m.top - m.bottom;

  const all = [total, ...rows];
  const y = d => (d.isTotal ? 0 : rowH + sep + rows.indexOf(d) * rowH);
  const [lo, hi] = d3.extent(all, d => d[key]);
  const pad = (Math.max(hi, 0) - Math.min(lo, 0)) * (narrow ? 0.14 : 0.12);
  const x = d3.scaleLinear().domain([Math.min(lo, 0) - pad, Math.max(hi, 0) + pad]).nice().range([0, panelW]);

  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", `Bar chart of the ${key === "pct" ? "percent" : "absolute"} change in greenhouse gas emissions for ${rows.length} countries from ${startYear} to ${endYear}. The cohort total changed ${formatPct(total.pct)} (${formatMt(total.abs)}).`);
  svg.append("title").text(`Change in emissions by country, ${startYear}–${endYear}`);
  svg.append("text").attr("x", narrow ? 8 : m.left).attr("y", 20).attr("font-weight", 600).attr("font-size", narrow ? 12 : 13).text(M.title);
  const g = svg.append("g").attr("transform", `translate(0,${m.top})`);
  const pg = g.append("g").attr("transform", `translate(${m.left},0)`);

  pg.append("g").attr("class", "emissions-grid")
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 7).tickSize(innerH).tickFormat(""))
    .call(a => a.select(".domain").remove());
  pg.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 7).tickFormat(M.tick));

  pg.selectAll(".bar").data(all).join("rect").attr("class", "bar")
    .attr("x", d => x(Math.min(0, d[key])))
    .attr("width", d => Math.abs(x(d[key]) - x(0)))
    .attr("y", d => y(d) + 3).attr("height", rowH - 6)
    .attr("fill", d => (d[key] < 0 ? palette.blue : palette.vermillion))
    .style("stroke", d => (d.isTotal ? "var(--text)" : "none")).attr("stroke-width", 1.5);
  pg.selectAll(".val").data(all).join("text").attr("class", "val")
    // On narrow screens negative values are labelled just right of the zero line,
    // so they never run into the country names.
    .attr("x", d => (d[key] < 0 && narrow ? x(0) + 4 : x(d[key]) + (d[key] < 0 ? -4 : 4)))
    .attr("y", d => y(d) + rowH / 2 + 4)
    .attr("text-anchor", d => (d[key] < 0 && !narrow ? "end" : "start"))
    .attr("font-size", valueSize).attr("font-weight", d => (d.isTotal ? 700 : 400))
    .text(d => M.fmt(d[key]));
  pg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", innerH)
    .style("stroke", "var(--text)").attr("stroke-width", 1.25);
  pg.append("line").attr("x1", 0).attr("x2", panelW).attr("y1", rowH + sep / 2).attr("y2", rowH + sep / 2)
    .style("stroke", "var(--border-strong)");

  g.selectAll(".row-label").data(all).join("text").attr("class", "row-label")
    .attr("x", m.left - 8).attr("y", d => y(d) + rowH / 2 + 4).attr("text-anchor", "end")
    .attr("font-size", labelSize).attr("font-weight", d => (d.isTotal ? 700 : 400)).text(rowLabel);

  // Callouts for the largest cut and largest rise of the measure on screen.
  const minRow = rows.reduce((b, d) => (d[key] < b[key] ? d : b), rows[0]);
  const maxRow = rows.reduce((b, d) => (d[key] > b[key] ? d : b), rows[0]);
  const noteRows = [];
  if (minRow[key] < 0) noteRows.push({ d: minRow, text: "Largest cut", color: "var(--cut-ink)" });
  if (maxRow[key] > 0) noteRows.push({ d: maxRow, text: "Largest rise", color: "var(--rise-ink)" });
  g.selectAll(".callout").data(narrow ? [] : noteRows).join("text").attr("class", "callout")
    .attr("x", m.left + panelW + 20).attr("y", n => y(n.d) + rowH / 2 + 4)
    .attr("font-size", 11.5).attr("font-weight", 700).style("fill", n => n.color)
    .text(n => `← ${n.text}`);

  changeTooltip = changeTooltip || createTooltip();
  const tipHtml = d =>
    `<strong>${d.country}</strong><br>${startYear}: ${formatMt(d.start)}<br>${endYear}: ${formatMt(d.end)}<br>` +
    `Change: ${formatMt(d.abs)} (${formatPct(d.pct)})` +
    (d.share != null && !d.isTotal ? `<br>Share of cohort net change: ${d3.format(".1%")(d.share)}` : "");
  const rowDescription = d =>
    `${d.country}: ${formatPct(d.pct)}, ${formatMt(d.abs)}. ${startYear}: ${formatMt(d.start)}. ${endYear}: ${formatMt(d.end)}.`;
  // Rows are keyboard-reachable: Tab to the chart, then arrow keys move between rows.
  const hits = g.append("g").attr("role", "group")
    .attr("aria-label", "Countries. Use the up and down arrow keys to move between rows.")
    .selectAll(".hit").data(all).join("rect").attr("class", "hit").attr("role", "img")
    .attr("tabindex", (d, i) => (i === 0 ? 0 : -1)).attr("aria-label", rowDescription)
    .attr("x", 0).attr("width", W).attr("y", d => y(d)).attr("height", rowH)
    .attr("fill", "transparent")
    .on("mousemove", (event, d) => changeTooltip.show(tipHtml(d), event.clientX, event.clientY))
    .on("mouseleave", () => changeTooltip.hide())
    .on("focus", (event, d) => {
      const r = event.currentTarget.getBoundingClientRect();
      changeTooltip.show(tipHtml(d), r.left + r.width / 2, r.top);
    })
    .on("blur", () => changeTooltip.hide())
    .on("keydown", event => {
      const nodes = hits.nodes();
      const i = nodes.indexOf(event.currentTarget);
      let j = i;
      if (event.key === "ArrowDown") j = Math.min(i + 1, nodes.length - 1);
      else if (event.key === "ArrowUp") j = Math.max(i - 1, 0);
      else if (event.key === "Home") j = 0;
      else if (event.key === "End") j = nodes.length - 1;
      else return;
      event.preventDefault();
      nodes[i].setAttribute("tabindex", "-1");
      nodes[j].setAttribute("tabindex", "0");
      nodes[j].focus();
    });

  root.append("p").attr("class", "caption").text(key === "pct"
    ? `Percent change is relative to each country's own ${startYear} level, so a country with small emissions can show a very large percentage. Switch to absolute change to see how many tonnes that is. The bold top row sums all ${rows.length} countries.`
    : `Absolute change is in million tonnes CO₂ equivalent, so large emitters dominate. Switch to % change to compare countries relative to their own ${startYear} level. The bold top row sums all ${rows.length} countries.`);
  root.append("p").attr("class", "caption").text(
    `Included: countries reporting every year ${startYear}–${endYear} (${excluded.length} other reporting countries have gaps and are left out so each bar spans the same years; names listed below). Totals exclude land use, land-use change and forestry. Hover a row, or Tab to the chart and use the arrow keys, for start and end values and its share of the net change. Source: OECD Air Emissions GHG Inventories (DF_AIR_GHG), data/emissions.csv.`);
  if (excluded.length) {
    const details = root.append("details").attr("class", "caption");
    details.append("summary").text(`Show the ${excluded.length} countries left out`);
    details.append("p").text(excluded.join(", "));
  }
}


// ---- Overview: dataset at a glance ---------------------------------------
function renderOverview(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const rows = dataStore.countryRows().filter(d => d.measure === "excl");
  const codes = new Set(rows.map(d => d.code));
  const [winStart, winEnd] = [1990, 2022];
  const complete = dataStore.completeCountries("excl", winStart, winEnd).length;
  const left = codes.size - complete;
  const tiles = [
    { cls: "kpi-primary", label: "Countries with complete data", value: formatInt(complete),
      unit: `of ${formatInt(codes.size)} reporting`,
      bar: [complete, left],
      legend: [
        { color: palette.blue, text: `${complete} used in every chart` },
        { color: palette.orange, text: `${left} left out (gaps in ${winStart}–${winEnd})` }
      ],
      link: { href: "#coverage", text: "See which countries" } },
    { label: "Period analysed", value: `${winStart}–${winEnd}`,
      sub: `${winEnd - winStart + 1} years. The data file spans ${d3.min(rows, d => d.year)}–${d3.max(rows, d => d.year)}.` },
    { label: "Measure", value: "Total GHG",
      sub: "Excluding land use, in million tonnes CO₂ equivalent (Mt)." }
  ];
  const tile = root.selectAll("div.kpi").data(tiles).join("div")
    .attr("class", d => `kpi${d.cls ? ` ${d.cls}` : ""}`);
  tile.append("span").attr("class", "kpi-label").text(d => d.label);
  const value = tile.append("span").attr("class", "kpi-value").text(d => d.value);
  value.filter(d => d.unit).append("span").attr("class", "kpi-unit").text(d => d.unit);
  tile.filter(d => d.sub).append("span").attr("class", "kpi-sub").text(d => d.sub);
  tile.filter(d => d.bar).append("div").attr("class", "kpi-bar").attr("aria-hidden", "true")
    .selectAll("span").data(d => d.bar).join("span")
    .style("flex", v => String(v)).style("background", (v, i) => (i === 0 ? palette.blue : palette.orange));
  const legend = tile.filter(d => d.legend).append("ul").attr("class", "kpi-legend");
  legend.selectAll("li").data(d => d.legend).join("li").each(function (item) {
    d3.select(this).append("span").attr("class", "wh-swatch").attr("aria-hidden", "true").style("background", item.color);
    d3.select(this).append("span").text(item.text);
  });
  tile.filter(d => d.link).append("a").attr("class", "kpi-link")
    .attr("href", d => d.link.href).text(d => `${d.link.text} →`);
}

// ---- White hat: which countries report which years -------------------------
let coverageOpen = false;

function renderCoverage(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const [winStart, winEnd] = [1990, 2022];
  const rows = dataStore.countryRows().filter(d => d.measure === "excl");
  if (!rows.length) return noData(container);

  const countries = [...d3.group(rows, d => d.code)].map(([code, rs]) => {
    const years = new Set(rs.map(d => d.year));
    const min = d3.min(years), max = d3.max(years);
    let complete = true;
    for (let yr = winStart; yr <= winEnd; yr++) if (!years.has(yr)) complete = false;
    return { code, country: rs[0].country, years, min, max, count: years.size, complete, gaps: max - min + 1 - years.size };
  });
  const included = countries.filter(c => c.complete).sort((a, b) => a.country.localeCompare(b.country));
  const left = countries.filter(c => !c.complete).sort((a, b) => a.min - b.min || a.country.localeCompare(b.country));
  const startsLate = left.filter(c => c.min > winStart).length;
  const endsEarly = left.filter(c => c.max < winEnd).length;
  const hasGaps = left.filter(c => c.gaps > 0).length;

  root.append("p").attr("class", "emissions-subtitle").text(
    `${included.length} of ${countries.length} countries report every year from ${winStart} to ${winEnd}`);
  root.append("p").attr("class", "cherry-takeaway cherry-takeaway-blue").text(
    `Only those ${included.length} countries are used in the charts on this page. The other ${left.length} are left out: ${startsLate} start reporting after ${winStart}, ${endsEarly} stop before ${winEnd}, and ${hasGaps} have missing years in between (some fit more than one group). Countries with long, complete reporting histories are over-represented, so the results describe them and not the whole world.`);

  const legend = root.append("ul").attr("class", "wh-stats").attr("aria-label", "Legend");
  const legendItems = [
    { text: `Data reported, used in the charts (${included.length})`, color: palette.blue },
    { text: `Data reported, left out (${left.length})`, color: palette.orange },
    { text: "No data that year", color: "var(--track)" }
  ];
  const li = legend.selectAll("li").data(legendItems).join("li").attr("class", "wh-chip");
  li.append("span").attr("class", "wh-swatch").attr("aria-hidden", "true").style("background", d => d.color)
    .style("border", "1px solid var(--border-strong)");
  li.append("span").text(d => d.text);

  const yearMin = d3.min(countries, c => c.min), yearMax = d3.max(countries, c => c.max);
  const yearList = d3.range(yearMin, yearMax + 1);
  const margin = { left: 190, right: 24 };
  const plotW = 640, rowH = 11, headH = 20;
  const W = margin.left + plotW + margin.right;
  const x = d3.scaleBand().domain(yearList).range([0, plotW]);
  const items = [{ header: `In the charts: ${included.length} countries` }, ...included,
    { header: `Left out: ${left.length} countries` }, ...left];
  let cursor = 0;
  items.forEach(it => { it.y = cursor; cursor += it.header ? headH : rowH; });
  const bodyH = cursor + 8;

  // The summary above stays visible; only the grid itself collapses.
  const toggle = root.append("button").attr("type", "button").attr("class", "coverage-toggle")
    .attr("aria-controls", "coverage-grid");
  const panel = root.append("div").attr("id", "coverage-grid");
  const syncToggle = () => {
    toggle.attr("aria-expanded", String(coverageOpen))
      .text(coverageOpen ? "Hide the grid of countries and years" : "Show the grid of countries and years");
    panel.property("hidden", !coverageOpen);
  };
  toggle.on("click", () => { coverageOpen = !coverageOpen; syncToggle(); });
  syncToggle();

  const scroller = panel.append("div").attr("class", "coverage-scroll")
    .attr("tabindex", "0").attr("role", "region")
    .attr("aria-label", "Coverage grid, scrollable");
  const tickYears = yearList.filter(v => v % 5 === 0 || v === winEnd);

  const axisWrap = scroller.append("div").attr("class", "coverage-axis");
  const axisSvg = axisWrap.append("svg").attr("viewBox", `0 0 ${W} 34`).attr("aria-hidden", "true");
  axisSvg.append("g").attr("transform", `translate(${margin.left},30)`).attr("class", "axis")
    .call(d3.axisTop(x).tickValues(tickYears).tickSize(4).tickFormat(d3.format("d")))
    .call(a => a.select(".domain").remove());

  axisSvg.append("text").attr("x", margin.left - 8).attr("y", 26).attr("text-anchor", "end")
    .attr("font-size", 11).style("fill", "var(--muted)").text("Year");

  const svg = scroller.append("svg").attr("viewBox", `0 0 ${W} ${bodyH}`).attr("role", "img")
    .attr("aria-label", `Grid of which years each of ${countries.length} countries reports data. ${included.length} report every year from ${winStart} to ${winEnd}; ${left.length} do not.`);
  const g = svg.append("g").attr("transform", `translate(${margin.left},0)`);

  const countryItems = items.filter(it => !it.header);
  const rowsG = g.selectAll("g.cov-row").data(countryItems).join("g").attr("class", "cov-row")
    .attr("transform", d => `translate(0,${d.y})`);
  rowsG.append("title").text(d =>
    `${d.country}: ${d.count} years of data (${d.min}–${d.max})${d.gaps ? `, ${d.gaps} missing in between` : ""}`);
  rowsG.append("rect").attr("x", 0).attr("y", 1).attr("width", plotW).attr("height", rowH - 2).style("fill", "var(--track)");
  rowsG.each(function (d) {
    d3.select(this).selectAll("rect.yr").data([...d.years]).join("rect").attr("class", "yr")
      .attr("x", yr => x(yr)).attr("y", 1).attr("width", x.bandwidth()).attr("height", rowH - 2)
      .attr("fill", d.complete ? palette.blue : palette.orange);
  });
  rowsG.append("text").attr("x", -6).attr("y", rowH - 2.5).attr("text-anchor", "end").attr("font-size", 9.5)
    .text(d => d.country);

  svg.selectAll("text.cov-head").data(items.filter(it => it.header)).join("text").attr("class", "cov-head")
    .attr("x", 6).attr("y", d => d.y + 14).attr("font-size", 12).attr("font-weight", 700).text(d => d.header);

  // The window used by every chart on the page.
  for (const yr of [winStart, winEnd]) {
    const lx = margin.left + x(yr) + (yr === winStart ? 0 : x.bandwidth());
    svg.append("line").attr("x1", lx).attr("x2", lx).attr("y1", 0).attr("y2", bodyH)
      .style("stroke", "var(--text)").attr("stroke-dasharray", "4 3").attr("pointer-events", "none");
  }

  panel.append("p").attr("class", "caption").text(
    `Dashed lines mark ${winStart} and ${winEnd}, the period used by the charts. Scroll the grid to see every country; hover a row for its number of years.`);
  root.append("p").attr("class", "caption").text(
    "Source: OECD Air Emissions GHG Inventories (DF_AIR_GHG), data/emissions.csv, totals excluding land use.");
}

// ---- Reveal: every possible window ---------------------------------------
const BLACK_HAT_WINDOW = [2007, 2020];
let cherryTooltip = null;

// Change in total emissions for every start year / end year pair (same cohort as the black hat chart).
function windowChanges() {
  const { countries, series } = emissionsTotalSeries();
  const mt = new Map(series.map(d => [d.year, d.mt]));
  const years = series.map(d => d.year);
  const windows = [];
  for (const start of years) {
    for (const end of years) {
      if (end > start) {
        windows.push({ start, end, from: mt.get(start), to: mt.get(end), pct: mt.get(end) / mt.get(start) - 1 });
      }
    }
  }
  return { countries, years, windows };
}

function renderCherryHeatmap(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const { countries, years, windows } = windowChanges();
  if (!windows.length) return noData(container, "No windows can be computed from this data.");

  const [bhStart, bhEnd] = BLACK_HAT_WINDOW;
  const bh = windows.find(w => w.start === bhStart && w.end === bhEnd);
  const byFlattering = [...windows].sort((a, b) => a.pct - b.pct);
  const rank = bh ? byFlattering.indexOf(bh) + 1 : null;
  const nRise = windows.filter(w => w.pct > 0).length;
  const first = years[0], last = years[years.length - 1];

  root.append("p").attr("class", "emissions-subtitle").text(
    `Every start year and end year from ${first} to ${last} · ${countries.length} countries · excluding land use. Each cell is the change in total emissions over that window.`);

  if (bh) {
    const takeaway = root.append("p").attr("class", "cherry-takeaway");
    takeaway.append("strong").text(rank === 1
      ? `${bhStart}–${bhEnd} is the most flattering of all ${windows.length} possible windows.`
      : `${bhStart}–${bhEnd} is the ${rank}th most flattering of ${windows.length} possible windows.`);
    takeaway.append("span").text(
      ` It shows ${formatPct(bh.pct)}. Meanwhile ${nRise} of the ${windows.length} windows (${d3.format(".0%")(nRise / windows.length)}) show emissions rising.`);
  }

  // Geometry: x = end year, y = start year.
  const available = Math.max(300, Math.min(container.clientWidth || 900, 1100));
  const narrow = available < 700;
  const margin = narrow ? { top: 48, right: 10, bottom: 100, left: 56 } : { top: 56, right: 250, bottom: 24, left: 64 };
  const cell = narrow ? Math.max(6, Math.floor((available - margin.left - margin.right) / (years.length - 1))) : 18;
  const plotW = cell * (years.length - 1), plotH = cell * (years.length - 1);
  const W = margin.left + plotW + margin.right, H = margin.top + plotH + margin.bottom;
  const x = d3.scaleBand().domain(years.slice(1)).range([0, plotW]);
  const y = d3.scaleBand().domain(years.slice(0, -1)).range([0, plotH]);
  const maxAbs = d3.max(windows, w => Math.abs(w.pct));
  const interpolator = d3.interpolateRgbBasis([palette.blue, cssVar("--surface-2"), palette.vermillion]);
  const color = d3.scaleDiverging(interpolator).domain([-maxAbs, 0, maxAbs]);

  const wrap = root.append("div").attr("class", "cherry-wrap");
  if (!narrow) wrap.attr("tabindex", "0").attr("role", "region").attr("aria-label", "Heatmap, scrollable");
  const svg = wrap.append("svg").classed("cherry-fit", narrow).attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", `Heatmap of the change in total emissions for every start year and end year from ${first} to ${last}. ${nRise} of ${windows.length} windows show a rise.${bh ? ` The ${bhStart} to ${bhEnd} window, ${formatPct(bh.pct)}, is ranked ${rank} for how flattering it is.` : ""}`);
  svg.append("title").text("Change in total emissions for every possible time window");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  cherryTooltip = cherryTooltip || createTooltip();
  g.selectAll("rect.cell").data(windows).join("rect").attr("class", "cell")
    .attr("x", w => x(w.end)).attr("y", w => y(w.start))
    .attr("width", x.bandwidth() - 1).attr("height", y.bandwidth() - 1)
    .attr("fill", w => color(w.pct))
    .on("mousemove", (event, w) => cherryTooltip.show(
      `<strong>${w.start} → ${w.end}</strong><br>${formatMt(w.from)} → ${formatMt(w.to)}<br>Change: ${formatPct(w.pct)}`,
      event.clientX, event.clientY))
    .on("mouseleave", () => cherryTooltip.hide());

  const tickYears = domain => {
    const lastYear = domain[domain.length - 1];
    return narrow
      ? domain.filter(v => (v % 10 === 0 && lastYear - v >= 4) || v === lastYear)
      : domain.filter(v => v % 5 === 0 || v === lastYear);
  };
  g.append("g").attr("class", "axis")
    .call(d3.axisTop(x).tickValues(tickYears(x.domain())).tickSize(3).tickFormat(d3.format("d")))
    .call(a => a.select(".domain").remove());
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickValues(tickYears(y.domain())).tickSize(3).tickFormat(d3.format("d")))
    .call(a => a.select(".domain").remove());
  svg.append("text").attr("x", margin.left).attr("y", 14).attr("font-weight", 600).attr("font-size", 13)
    .text("End year →");
  svg.append("text").attr("transform", `translate(${narrow ? 10 : 14},${margin.top + plotH / 2}) rotate(-90)`)
    .attr("text-anchor", "middle").attr("font-weight", 600).attr("font-size", 13).text("Start year →");

  // The window used by the black hat chart.
  if (bh) {
    const cx = x(bhEnd), cy = y(bhStart);
    g.append("rect").attr("x", cx - 1).attr("y", cy - 1)
      .attr("width", x.bandwidth() + 1).attr("height", y.bandwidth() + 1)
      .attr("fill", "none").style("stroke", "var(--text)").attr("stroke-width", 2.5).attr("pointer-events", "none");
    if (!narrow) {
      const midY = cy + y.bandwidth() / 2;
      g.append("line").attr("x1", cx + x.bandwidth() + 2).attr("x2", plotW + 16)
        .attr("y1", midY).attr("y2", midY).style("stroke", "var(--text)").attr("pointer-events", "none");
      g.append("text").attr("x", plotW + 22).attr("y", midY - 2).attr("font-size", 13).attr("font-weight", 700)
        .text(`${bhStart}→${bhEnd}: ${formatPct(bh.pct)}`);
      g.append("text").attr("x", plotW + 22).attr("y", midY + 14).attr("font-size", 12).style("fill", "var(--muted)")
        .text("window used in the black hat chart");
    }
  }

  // Legend (diverging, zero marked).
  const legW = narrow ? Math.min(220, W - margin.left - 12) : 190;
  const legX = narrow ? margin.left : margin.left + plotW + 28;
  const legY = narrow ? margin.top + plotH + 30 : margin.top + 6;
  const gradId = "cherry-gradient";
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient").attr("id", gradId);
  d3.range(0, 1.01, 0.1).forEach(t => grad.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", interpolator(t)));
  svg.append("text").attr("x", legX).attr("y", legY - 8).attr("font-size", 12).attr("font-weight", 600)
    .text("Change in total emissions");
  svg.append("rect").attr("x", legX).attr("y", legY).attr("width", legW).attr("height", 12)
    .attr("fill", `url(#${gradId})`).style("stroke", "var(--border-strong)");
  svg.append("line").attr("x1", legX + legW / 2).attr("x2", legX + legW / 2).attr("y1", legY - 2).attr("y2", legY + 14)
    .style("stroke", "var(--text)");
  const legendLabel = (px, anchor, txt) => svg.append("text").attr("x", px).attr("y", legY + 28)
    .attr("text-anchor", anchor).attr("font-size", 11).text(txt);
  legendLabel(legX, "start", d3.format("+.0%")(-maxAbs));
  legendLabel(legX + legW / 2, "middle", "0%");
  legendLabel(legX + legW, "end", d3.format("+.0%")(maxAbs));
  svg.append("text").attr("x", legX).attr("y", legY + 44).attr("font-size", 11).style("fill", "var(--muted)").text("← emissions fell");
  svg.append("text").attr("x", legX + legW).attr("y", legY + 44).attr("text-anchor", "end")
    .attr("font-size", 11).style("fill", "var(--muted)").text("emissions rose →");

  if (narrow && bh) {
    root.append("p").attr("class", "caption").text(
      `Outlined cell: ${bhStart}→${bhEnd} (${formatPct(bh.pct)}), the window used in the black hat chart.`);
  }
  root.append("p").attr("class", "caption").text(
    "Only windows that run forward in time are shown (end year after start year). Same countries and totals as the black hat chart. Source: OECD Air Emissions GHG Inventories (DF_AIR_GHG), data/emissions.csv.");
  const details = root.append("details").attr("class", "caption");
  details.append("summary").text("Show the five most flattering windows");
  const list = details.append("ol");
  byFlattering.slice(0, 5).forEach(w => list.append("li").text(`${w.start}–${w.end}: ${formatPct(w.pct)}`));
}

const views = {
  changeByCountry: {
    name: "Change by country",
    render(container, state) {
      renderChangeByCountry(container, state);
    }
  },
  overview: {
    name: "Dataset at a glance",
    render(container) {
      renderOverview(container);
    }
  },
  coverage: {
    name: "Which countries report which years",
    render(container) {
      renderCoverage(container);
    }
  },
  blackHat1: {
    name: "Black Hat view 1",
    render(container, state) {
      renderEmissionsLine(container, { fullPeriod: false, zeroBaseline: false, neutralHeadline: false });
    }
  },
  reveal: {
    name: "Review the distortions",
    render(container) {
      setupEmissionsToggle(container);
    }
  },
  cherry: {
    name: "Every possible window",
    render(container) {
      renderCherryHeatmap(container);
    }
  }
};

const state = createState({ selectedCountries: [], yearRange: [1990, 2022] });

function renderAll() {
  for (const [key, view] of Object.entries(views)) {
    const card = document.querySelector(`[data-view="${key}"]`);
    if (!card) continue;
    view.render(card.querySelector("[data-chart]"), state);
  }
}

function setupNav() {
  const links = [...document.querySelectorAll(".site-nav a")];
  const targets = links.map(a => document.querySelector(a.getAttribute("href")));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((a, i) => {
        if (targets[i] === entry.target) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  targets.forEach(t => t && observer.observe(t));
}


async function init() {
  const status = document.getElementById("load-status");
  setupNav();
  try {
    const rows = await dataStore.load();
    status.textContent = "";
    renderAll();
    state.subscribe(renderAll);
    // Charts are drawn at the container's pixel width, so redraw when the width changes,
    // and when the colour scheme changes (the heatmap reads its midpoint colour from CSS).
    let lastWidth = document.documentElement.clientWidth, timer;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = document.documentElement.clientWidth;
        if (Math.abs(w - lastWidth) > 24) { lastWidth = w; renderAll(); }
      }, 200);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  } catch (error) {
    console.error("Error loading data:", error);
    status.classList.add("error");
    status.textContent = "Could not load data/emissions.csv. Serve the site with a local web server (python -m http.server) and check that the CSV exists.";
  }
}

window.addEventListener("load", init);
