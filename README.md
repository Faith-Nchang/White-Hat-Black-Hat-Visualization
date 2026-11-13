# White Hat / Black Hat: Greenhouse Gas Emissions

CMSC 471, Assignment 2. An interactive D3.js page that shows the same greenhouse gas emissions data two ways: an honest ("white hat") visualization and a deliberately misleading ("black hat") one. The page explains each design choice and lets you undo the distortions one at a time.

## What's on the page

- **White Hat**: a sorted bar chart of emissions change by country, with a toggle between % change and absolute change, plus a coverage grid showing which countries report which years.
- **Black Hat**: a line chart claiming "Emissions Have Fallen 13.6% Since 2007", built from true numbers using a cherry-picked time window, a truncated y-axis and a loaded title.
- **Write-ups**: the reasoning behind both charts (data transformation, marks and encodings, titles and labels).
- **Review the distortions** (extra credit): switches that fix the time window, axis and title one at a time, and a heatmap of every possible start and end year.
- **Accessibility** (extra credit): keyboard navigation, screen reader labels, a colorblind-safe palette and reduced-motion support.
- **Appendix**: data source, data preparation, tools and development process.

## Data

OECD, Air Emissions GHG Inventories (dataset `DF_AIR_GHG`), from the [OECD Data Explorer](https://data-explorer.oecd.org/vis?df[ds]=DisseminateFinalDMZ&df[id]=DSD_AIR_GHG@DF_AIR_GHG&df[ag]=OECD.ENV.EPI).

The full download (about 178 MB) is not included. The site loads a reduced file, `data/emissions.csv`, with values in million tonnes CO₂ equivalent. Charts use the national total excluding land use, for the 61 countries that report every year from 1990 to 2022. Regional aggregates such as the EU total are excluded. See `EDA.md` and the appendix on the page for details.

## Run locally

The page loads the CSV with `fetch`, so open it through a local web server rather than double-clicking `index.html`:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Project structure

```
index.html       Page markup and write-ups
css/styles.css   Styles
js/script.js     D3 charts and interactions
data/emissions.csv  Reduced dataset
```

## Tools

- [D3.js](https://d3js.org/) v7.9.0, loaded from the jsDelivr CDN
- Inter and Source Serif 4, loaded from Google Fonts

## Authors

Faith Nchang and Dillon Monkam
