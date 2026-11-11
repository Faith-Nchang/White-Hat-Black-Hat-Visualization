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
    : `Emissions Down ${drop.toFixed(1)}% Since 2007`);
  root.append("p").attr("class", "emissions-subtitle").text(
    `${countries.length} countries with complete data · ${first.year}–${last.year} · Excluding land use`);

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
    svg.append("path").datum(plotted).attr("fill", "none").attr("stroke", color)
      .attr("stroke-width", 3).attr("stroke-linejoin", "round")
      .attr("d", d3.line().x(d => xScale(d.year)).y(d => yScale(d.mt)));
    svg.selectAll(".emissions-point").data(plotted, d => d.year).join("circle")
      .attr("class", "emissions-point").attr("cx", d => xScale(d.year))
      .attr("cy", d => yScale(d.mt)).attr("r", 4).attr("fill", color)
      .append("title").text(d => `${d.year}: ${formatMt(d.mt)}`);
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

let activeRevealTab = 0;

function setupRevealTabs(container) {
  const root = d3.select(container);
  root.selectAll("*").remove();
  const tabs = root.append("div").attr("class", "reveal-tabs")
    .attr("role", "tablist").attr("aria-label", "Black Hat distortion reviews")
    .selectAll("button").data([1, 2, 3]).join("button")
    .attr("type", "button").attr("role", "tab")
    .attr("id", d => `reveal-tab-${d}`)
    .attr("aria-controls", d => `reveal-panel-${d}`)
    .text(d => `Black Hat ${d}`);
  const panels = root.selectAll(".reveal-panel").data([1, 2, 3]).join("div")
    .attr("class", "reveal-panel").attr("role", "tabpanel")
    .attr("id", d => `reveal-panel-${d}`)
    .attr("aria-labelledby", d => `reveal-tab-${d}`).attr("tabindex", 0);

  setupEmissionsToggle(panels.nodes()[0]);
  panels.filter(d => d !== 1).append("p").attr("class", "caption")
    .text(d => `The review for Black Hat ${d} will appear here when its chart is implemented.`);

  function selectTab(index, focus = false) {
    activeRevealTab = index;
    tabs.attr("aria-selected", (d, i) => String(i === index))
      .attr("tabindex", (d, i) => i === index ? 0 : -1);
    panels.property("hidden", (d, i) => i !== index);
    if (focus) tabs.nodes()[index].focus();
  }
  tabs.on("click", (event, d) => selectTab(d - 1))
    .on("keydown", (event, d) => {
      let index = d - 1;
      if (event.key === "ArrowRight") index = (index + 1) % 3;
      else if (event.key === "ArrowLeft") index = (index + 2) % 3;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = 2;
      else return;
      event.preventDefault();
      selectTab(index, true);
    });
  selectTab(activeRevealTab);
}

const views = {
  changeByCountry: {
    name: "Change by country",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
    }
  },
  ukraine: {
    name: "Total with and without Ukraine",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
    }
  },
  transparency: {
    name: "Data transparency",
    render(container) {
      placeholder(container, this.name, dataStore.allRows().length);
    }
  },
  nordic: {
    name: "Nordic with and without land use",
    render(container, state) {
      const rows = dataStore.countryRows().filter(d => NORDIC.includes(d.code)).filter(inRange(state));
      placeholder(container, this.name, rows.length);
    }
  },
  blackHat1: {
    name: "Black Hat view 1",
    render(container, state) {
      renderEmissionsLine(container, { fullPeriod: false, zeroBaseline: false, neutralHeadline: false });
    }
  },
  blackHat2: {
    name: "Black Hat view 2",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
    }
  },
  blackHat3: {
    name: "Black Hat view 3",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
    }
  },
  reveal: {
    name: "Review the distortions",
    render(container) {
      setupRevealTabs(container);
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
