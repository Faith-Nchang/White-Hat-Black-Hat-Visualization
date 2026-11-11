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
      placeholder(container, this.name, exclRows(state).length);
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
    name: "Reveal the distortions",
    techniques: [
      { id: "technique1", label: "Distortion technique 1" },
      { id: "technique2", label: "Distortion technique 2" },
      { id: "technique3", label: "Distortion technique 3" }
    ],
    render(container, state) {
      const rows = dataStore.countryRows().filter(inRange(state));
      const root = d3.select(container);
      root.selectAll("*").remove();

      root.append("div")
        .attr("class", "toggle-group")
        .attr("role", "group")
        .attr("aria-label", "Distortion techniques")
        .selectAll("button")
        .data(this.techniques)
        .join("button")
        .attr("type", "button")
        .attr("data-technique", d => d.id)
        .attr("aria-pressed", "false")
        .text(d => d.label)
        .on("click", function () {
          const pressed = this.getAttribute("aria-pressed") === "true";
          this.setAttribute("aria-pressed", String(!pressed));
        });

      placeholder(root.append("div").node(), this.name, rows.length);
    }
  },
  linkedBrushing: {
    name: "Linked brushing",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
    }
  },
  windowExplorer: {
    name: "Window explorer",
    render(container, state) {
      placeholder(container, this.name, exclRows(state).length);
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
