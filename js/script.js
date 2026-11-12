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

const NORDIC = ["DNK", "FIN", "ISL", "NOR", "SWE"];

const fmtMt = d3.format(",.1f");
const fmtInt = d3.format(",d");
const fmtPct = d3.format("+.1%");

const formatMt = v => (v == null || Number.isNaN(v) ? "n/a" : `${fmtMt(v)} Mt`);
const formatInt = v => fmtInt(v);
const formatPct = v => (v == null || !Number.isFinite(v) ? "n/a" : fmtPct(v));

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


function placeholder(container, name, rowCount) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const box = root.append("div").attr("class", "placeholder");
  box.append("strong").text(name);
  box.append("span").text(`${formatInt(rowCount)} rows`);
}


function inRange(state) {
  const [start, end] = state.yearRange;
  return d => d.year >= start && d.year <= end;
}

function exclRows(state) {
  return dataStore.countryRows().filter(d => d.measure === "excl").filter(inRange(state));
}

// Keep one fixed cohort across both windows so the reveal changes framing only.
let showEmissionsContext = false;
let lineTooltip = null;

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
  // The distorted version leaves the end year out of the subtitle; it appears only on the x-axis.
  root.append("p").attr("class", "emissions-subtitle").text(options.neutralHeadline
    ? `${countries.length} countries with complete data · ${first.year}–${last.year} · Excluding land use`
    : `${countries.length} countries with complete data · National totals · Excluding land use`);

  const margin = { top: 35, right: 35, bottom: 60, left: 90 };
  const width = 900 - margin.left - margin.right;
  const height = 440 - margin.top - margin.bottom;
  const chart = root.append("svg").attr("viewBox", "0 0 900 440")
    .attr("role", "img").attr("aria-label", `Total greenhouse gas emissions from ${first.year} to ${last.year}. ${options.zeroBaseline ? "Zero" : "Truncated"} y-axis baseline.`);
  chart.append("title").text(`Emissions in ${first.year}: ${formatMt(first.mt)}; in ${last.year}: ${formatMt(last.mt)}.`);
  const svg = chart.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  let xScale, yScale;



  function updateAxes() {
    xScale = d3.scaleLinear().domain([first.year, last.year]).range([0, width]);
    const [min, max] = d3.extent(plotted, d => d.mt);
    const padding = (max - min) * 0.09 || max * 0.05;
    yScale = d3.scaleLinear().domain([options.zeroBaseline ? 0 : min - padding, max + padding])
      .nice().range([height, 0]);
    svg.append("g").attr("class", "emissions-grid")
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(""))
      .call(g => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).tickValues(options.fullPeriod
        ? [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2022]
        : [2007, 2010, 2013, 2016, 2020]).tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(",.0f")));
    svg.append("text").attr("x", 0).attr("y", -16).attr("class", "emissions-unit").text("Million tonnes CO₂ equivalent (Mt CO₂e)");
    svg.append("text").attr("x", width / 2).attr("y", height + 45).attr("text-anchor", "middle").text("Year");
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
        .attr("stroke", "#946000").attr("stroke-dasharray", "4 4");
      svg.append("text")
        .attr("x", (xScale(2007) + xScale(2020)) / 2).attr("y", 18)
        .attr("text-anchor", "middle").attr("fill", "#805200")
        .attr("font-size", 13).attr("font-weight", 600)
        .text("2007–2020: window used in distorted chart");
    }
    svg.append("path").datum(plotted).attr("fill", "none").attr("stroke", color)
      .attr("stroke-width", 3).attr("stroke-linejoin", "round")
      .attr("d", d3.line().x(d => xScale(d.year)).y(d => yScale(d.mt)));
    svg.selectAll(".emissions-point").data(plotted, d => d.year).join("circle")
      .attr("class", "emissions-point").attr("cx", d => xScale(d.year))
      .attr("cy", d => yScale(d.mt)).attr("r", 5).attr("fill", color)
      .attr("stroke", "#fff").attr("stroke-width", 1.5)
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
        .attr("font-size", 13).attr("font-weight", 600).attr("fill", "#1c1c1c")
        .text(`${first.year}: ${formatMt(first.mt)}`);
      svg.append("text").attr("x", xScale(last.year) - 10).attr("y", yScale(last.mt) - 14)
        .attr("text-anchor", "end").attr("font-size", 15).attr("font-weight", 700).attr("fill", "#006e51")
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
}


function setupEmissionsToggle(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const controls = root.append("div").attr("class", "toggle-group")
    .attr("role", "group").attr("aria-label", "Chart framing");
  const buttons = controls.selectAll("button")
    .data([{ context: false, label: "Distorted" }, { context: true, label: "Reveal the trick" }])
    .join("button").attr("type", "button")
    .attr("aria-controls", "emissions-comparison-chart")
    .text(d => d.label);
  const chart = root.append("div").attr("id", "emissions-comparison-chart");
  const explanation = root.append("div").attr("class", "comparison-explanation");

  function updateComparison() {
    buttons.attr("aria-pressed", d => String(d.context === showEmissionsContext));
    renderEmissionsLine(chart.node(), {
      fullPeriod: showEmissionsContext,
      zeroBaseline: showEmissionsContext,
      neutralHeadline: showEmissionsContext
    });
    explanation.selectAll("*").remove();
    explanation.append("strong").text(showEmissionsContext ? "What changed?" : "What is missing?");
    explanation.append("p").text(showEmissionsContext
      ? "We now show every year from 1990 to 2022, start the vertical axis at zero, and use a neutral title and blue line. Across the full period, emissions fell only 2.4%. The countries and data are exactly the same."
      : "The chart starts at the 2007 peak and stops at the 2020 pandemic low. Its vertical axis is zoomed in, making the drop look larger. The headline and green line frame that selected decline as good news.");
  }

  buttons.on("click", (event, d) => {
    showEmissionsContext = d.context;
    updateComparison();
  });
  updateComparison();
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

  const W = 1000, rowH = 20, sep = 14;
  const m = { top: 52, bottom: 48, left: 185 };
  const panelW = 560;
  const H = m.top + rowH * (rows.length + 1) + sep + m.bottom;
  const innerH = H - m.top - m.bottom;

  const all = [total, ...rows];
  const y = d => (d.isTotal ? 0 : rowH + sep + rows.indexOf(d) * rowH);
  const [lo, hi] = d3.extent(all, d => d[key]);
  const pad = (Math.max(hi, 0) - Math.min(lo, 0)) * 0.12;
  const x = d3.scaleLinear().domain([Math.min(lo, 0) - pad, Math.max(hi, 0) + pad]).nice().range([0, panelW]);

  const svg = root.append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img")
    .attr("aria-label", `Bar chart of the ${key === "pct" ? "percent" : "absolute"} change in greenhouse gas emissions for ${rows.length} countries from ${startYear} to ${endYear}. The cohort total changed ${formatPct(total.pct)} (${formatMt(total.abs)}).`);
  svg.append("title").text(`Change in emissions by country, ${startYear}–${endYear}`);
  svg.append("text").attr("x", m.left).attr("y", 20).attr("font-weight", 600).attr("font-size", 13).text(M.title);
  const g = svg.append("g").attr("transform", `translate(0,${m.top})`);
  const pg = g.append("g").attr("transform", `translate(${m.left},0)`);

  pg.append("g").attr("class", "emissions-grid")
    .call(d3.axisBottom(x).ticks(7).tickSize(innerH).tickFormat(""))
    .call(a => a.select(".domain").remove());
  pg.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(7).tickFormat(M.tick));

  pg.selectAll(".bar").data(all).join("rect").attr("class", "bar")
    .attr("x", d => x(Math.min(0, d[key])))
    .attr("width", d => Math.abs(x(d[key]) - x(0)))
    .attr("y", d => y(d) + 3).attr("height", rowH - 6)
    .attr("fill", d => (d[key] < 0 ? palette.blue : palette.vermillion))
    .attr("stroke", d => (d.isTotal ? "#000" : "none")).attr("stroke-width", 1.5);
  pg.selectAll(".val").data(all).join("text").attr("class", "val")
    .attr("x", d => x(d[key]) + (d[key] < 0 ? -4 : 4))
    .attr("y", d => y(d) + rowH / 2 + 4)
    .attr("text-anchor", d => (d[key] < 0 ? "end" : "start"))
    .attr("font-size", 11.5).attr("font-weight", d => (d.isTotal ? 700 : 400))
    .text(d => M.fmt(d[key]));
  pg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", innerH)
    .attr("stroke", "#1c1c1c").attr("stroke-width", 1.25);
  pg.append("line").attr("x1", 0).attr("x2", panelW).attr("y1", rowH + sep / 2).attr("y2", rowH + sep / 2)
    .attr("stroke", "#999").attr("stroke-dasharray", "3 3");

  g.selectAll(".row-label").data(all).join("text").attr("class", "row-label")
    .attr("x", m.left - 8).attr("y", d => y(d) + rowH / 2 + 4).attr("text-anchor", "end")
    .attr("font-size", 12.5).attr("font-weight", d => (d.isTotal ? 700 : 400)).text(d => d.country);

  // Callouts for the largest cut and largest rise of the measure on screen.
  const minRow = rows.reduce((b, d) => (d[key] < b[key] ? d : b), rows[0]);
  const maxRow = rows.reduce((b, d) => (d[key] > b[key] ? d : b), rows[0]);
  const noteRows = [];
  if (minRow[key] < 0) noteRows.push({ d: minRow, text: "Largest cut", color: "#005a8c" });
  if (maxRow[key] > 0) noteRows.push({ d: maxRow, text: "Largest rise", color: "#a84800" });
  g.selectAll(".callout").data(noteRows).join("text").attr("class", "callout")
    .attr("x", m.left + panelW + 20).attr("y", n => y(n.d) + rowH / 2 + 4)
    .attr("font-size", 11.5).attr("font-weight", 700).attr("fill", n => n.color)
    .text(n => `◄ ${n.text}`);

  changeTooltip = changeTooltip || createTooltip();
  g.selectAll(".hit").data(all).join("rect").attr("class", "hit")
    .attr("x", 0).attr("width", W).attr("y", d => y(d)).attr("height", rowH)
    .attr("fill", "transparent")
    .on("mousemove", (event, d) => changeTooltip.show(
      `<strong>${d.country}</strong><br>${startYear}: ${formatMt(d.start)}<br>${endYear}: ${formatMt(d.end)}<br>` +
      `Change: ${formatMt(d.abs)} (${formatPct(d.pct)})` +
      (d.share != null && !d.isTotal ? `<br>Share of cohort net change: ${d3.format(".1%")(d.share)}` : ""),
      event.clientX, event.clientY))
    .on("mouseleave", () => changeTooltip.hide());

  root.append("p").attr("class", "caption").text(key === "pct"
    ? `Percent change is relative to each country's own ${startYear} level, so a country with small emissions can show a very large percentage. Switch to absolute change to see how many tonnes that is. The bold top row sums all ${rows.length} countries.`
    : `Absolute change is in million tonnes CO₂ equivalent, so large emitters dominate. Switch to % change to compare countries relative to their own ${startYear} level. The bold top row sums all ${rows.length} countries.`);
  root.append("p").attr("class", "caption").text(
    `Included: countries reporting every year ${startYear}–${endYear} (${excluded.length} other reporting countries have gaps and are left out so each bar spans the same years; names listed below). Totals exclude land use, land-use change and forestry. Hover a row for start and end values and its share of the net change. Source: OECD Air Emissions GHG Inventories (DF_AIR_GHG), data/emissions.csv.`);
  if (excluded.length) {
    const details = root.append("details").attr("class", "caption");
    details.append("summary").text(`Show the ${excluded.length} countries left out`);
    details.append("p").text(excluded.join(", "));
  }
}


const views = {
  changeByCountry: {
    name: "Change by country",
    render(container, state) {
      renderChangeByCountry(container, state);
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
    status.textContent = `Loaded ${formatInt(rows.length)} GHG records (${formatInt(dataStore.countryRows().length)} excluding aggregates).`;
    renderAll();
    state.subscribe(renderAll);
  } catch (error) {
    console.error("Error loading data:", error);
    status.classList.add("error");
    status.textContent = "Could not load data/emissions.csv. Serve the site with a local web server (python -m http.server) and check that the CSV exists.";
  }
}

window.addEventListener("load", init);
