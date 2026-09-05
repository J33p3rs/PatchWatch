const NOTES_DATA_URL = "data/notes.json";
const VALID_MONTH = /^\d{4}-\d{2}$/;
const SMALL_YOY_BASELINE = 10;
const THEME_STORAGE_KEY = "patchwatch-theme";
const VALID_THEMES = new Set(["light", "dark", "patchwatch90"]);

function readUrlTheme() {
  try {
    const theme = new URL(window.location.href).searchParams.get("theme");
    return VALID_THEMES.has(theme) ? theme : null;
  } catch (error) {
    return null;
  }
}

function readStoredTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(stored) ? stored : null;
  } catch (error) {
    console.warn("Patch Watch could not read the saved theme preference", error);
    return null;
  }
}

function saveTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Patch Watch could not save the theme preference", error);
  }
}

function systemTheme() {
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch (error) {
    console.warn("Patch Watch could not read the system colour scheme", error);
  }
  return "light";
}

function updateThemeUrl(theme) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("theme", theme);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    console.warn("Patch Watch could not update the theme URL parameter", error);
  }
}

function applyTheme(theme, persist = false) {
  const resolved = VALID_THEMES.has(theme) ? theme : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved === "light" ? "light" : "dark";
  const selector = document.querySelector("#theme-select");
  if (selector) selector.value = resolved;
  if (persist) saveTheme(resolved);
}

function initialiseTheme() {
  const selector = document.querySelector("#theme-select");
  if (selector) {
    selector.addEventListener("change", () => {
      applyTheme(selector.value, true);
      updateThemeUrl(selector.value);
    });
  }
  applyTheme(readUrlTheme() ?? readStoredTheme() ?? systemTheme());
}

function readRequestedMonth() {
  try {
    const month = new URL(window.location.href).searchParams.get("month");
    return month && VALID_MONTH.test(month) ? month : null;
  } catch (error) {
    return null;
  }
}

function setRequestedMonth(month) {
  const url = new URL(window.location.href);
  url.searchParams.set("month", month);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function fmtNumber(value) {
  return new Intl.NumberFormat("en-AU").format(value);
}

function fmtDelta(value) {
  if (value === null || value === undefined) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function fmtYearComparison(metric) {
  const baseline = metric.same_month_last_year;
  if (baseline === null || baseline === undefined) return "n/a";
  if (baseline < SMALL_YOY_BASELINE) return `${fmtNumber(metric.value)} vs ${fmtNumber(baseline)}`;
  return fmtDelta(metric.versus_last_year_pct);
}

function observationMetric(text, metrics) {
  return metrics.find((metric) => text.startsWith(`${metric.label}:`)) || null;
}

function formatObservation(text, metrics) {
  const metric = observationMetric(text, metrics);
  if (!metric) return text;
  const baseline = metric.same_month_last_year;
  if (baseline === null || baseline === undefined || baseline >= SMALL_YOY_BASELINE) return text;
  const pct = fmtDelta(metric.versus_last_year_pct);
  const raw = fmtYearComparison(metric);
  return text.replace(
    `${pct} versus the same month last year`,
    `${raw} versus the same month last year`,
  );
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, number - 1, 1)));
}

function groupArticlesByYear(articles) {
  const years = new Map();
  articles.forEach((article) => {
    if (!years.has(article.year)) years.set(article.year, []);
    years.get(article.year).push(article);
  });
  [...years.values()].forEach((items) => items.sort((a, b) => b.month.localeCompare(a.month)));
  return years;
}

function selectArticle(articles, requestedMonth) {
  return articles.find((article) => article.month === requestedMonth) || articles[0] || null;
}

function renderMetricTable(metrics) {
  const table = document.createElement("table");
  table.className = "notes-metrics";
  table.innerHTML = "<thead><tr><th>Metric</th><th>Count</th><th>vs previous</th><th>vs 6-month avg</th><th>vs last year</th></tr></thead>";
  const body = document.createElement("tbody");
  metrics.forEach((metric) => {
    const row = document.createElement("tr");
    [metric.label, fmtNumber(metric.value), fmtDelta(metric.versus_previous_pct), fmtDelta(metric.versus_trailing_average_pct), fmtYearComparison(metric)]
      .forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        cell.textContent = value;
        if (index === 0) cell.scope = "row";
        row.appendChild(cell);
      });
    body.appendChild(row);
  });
  table.appendChild(body);
  return table;
}

function renderArticle(article) {
  const target = document.querySelector("#note-article");
  target.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = monthLabel(article.month);

  const title = document.createElement("h1");
  title.textContent = article.title;

  const summary = document.createElement("p");
  summary.className = "notes-summary";
  summary.textContent = article.summary;

  const combined = document.createElement("p");
  combined.className = "notes-combined";
  combined.textContent = `Combined included-vendor count: ${fmtNumber(article.combined_value)} · ${article.combined_trend.replace("-", " ")}`;

  const changedHeading = document.createElement("h2");
  changedHeading.textContent = "What changed";
  const list = document.createElement("ul");
  article.observations.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = formatObservation(text, article.metrics);
    list.appendChild(item);
  });

  const dataHeading = document.createElement("h2");
  dataHeading.textContent = "Across the dataset";
  const dataCopy = document.createElement("p");
  dataCopy.textContent = "Every PatchWatch metric is included below, even when it was not notable enough to feature in the short commentary.";

  const watchHeading = document.createElement("h2");
  watchHeading.textContent = "What I'm watching";
  const watch = document.createElement("p");
  watch.textContent = article.watch;

  const method = document.createElement("p");
  method.className = "notes-method";
  method.textContent = "Trend comparisons use repository counts only: previous month, the preceding six-month average and the same month last year. When the prior-year count is below 10, raw counts are shown instead of a percentage because tiny baselines can exaggerate percentage changes. Different series have different methodologies, so relative movement matters more than comparing unlike raw totals.";

  target.append(eyebrow, title, summary, combined, changedHeading, list, dataHeading, dataCopy, renderMetricTable(article.metrics), watchHeading, watch, method);
}

function renderArchive(articles, selectedMonth) {
  const archive = document.querySelector("#notes-archive");
  archive.replaceChildren();
  const years = groupArticlesByYear(articles);

  [...years.keys()].sort((a, b) => b - a).forEach((year) => {
    const section = document.createElement("section");
    section.className = "archive-year";
    const heading = document.createElement("h3");
    heading.textContent = String(year);
    const list = document.createElement("ul");
    years.get(year).forEach((article) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `notes.html?month=${encodeURIComponent(article.month)}`;
      link.textContent = monthLabel(article.month);
      if (article.month === selectedMonth) link.setAttribute("aria-current", "page");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        setRequestedMonth(article.month);
        renderArticle(article);
        renderArchive(articles, article.month);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      item.appendChild(link);
      list.appendChild(item);
    });
    section.append(heading, list);
    archive.appendChild(section);
  });
}

async function initialiseNotes() {
  const response = await fetch(NOTES_DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`notes data returned ${response.status}`);
  const payload = await response.json();
  const articles = payload.articles || [];
  if (!articles.length) throw new Error("notes data contains no articles");
  const selected = selectArticle(articles, readRequestedMonth());
  renderArticle(selected);
  renderArchive(articles, selected.month);
}

if (typeof module === "object" && module.exports) {
  module.exports = { fmtDelta, fmtYearComparison, observationMetric, formatObservation, monthLabel, groupArticlesByYear, selectArticle };
}

if (typeof document !== "undefined") {
  initialiseTheme();
  initialiseNotes().catch((error) => {
    console.error("Patch Watch notes failed to load", error);
    const target = document.querySelector("#note-article");
    target.textContent = "Monthly notes are temporarily unavailable.";
  });
}
