const THEME_STORAGE_KEY = "patchwatch-theme";
const VALID_THEMES = new Set(["light", "dark", "patchwatch90"]);
const VALUE_KEY = "nvd_published_cves";

const monthFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function parseMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

function formatMonth(month) {
  return monthFormatter.format(parseMonth(month));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-AU").format(value);
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
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
  if (selector) selector.addEventListener("change", () => applyTheme(selector.value, true));
  applyTheme(readStoredTheme() ?? systemTheme());
}

function renderBarChart(container, items, options) {
  container.replaceChildren();
  const { width, height, margin, gap } = options;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const barWidth = Math.max((innerWidth - gap * (items.length - 1)) / items.length, 1);
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": options.ariaLabel,
    preserveAspectRatio: "xMidYMid meet",
  });

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const y = margin.top + innerHeight - ratio * innerHeight;
    svg.appendChild(createSvgElement("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "grid-line" }));
    const label = createSvgElement("text", { x: margin.left - 10, y: y + 4, class: "axis-label axis-label-y", "text-anchor": "end" });
    label.textContent = formatNumber(Math.round(maxValue * ratio));
    svg.appendChild(label);
  }

  items.forEach((item, index) => {
    const x = margin.left + index * (barWidth + gap);
    const barHeight = (item.value / maxValue) * innerHeight;
    const y = margin.top + innerHeight - barHeight;
    const group = createSvgElement("g", { class: "bar-group" });
    const bar = createSvgElement("rect", {
      x, y, width: barWidth, height: barHeight, rx: Math.min(4, barWidth / 3),
      class: item.partial ? "bar bar-partial" : "bar",
      tabindex: "0", role: "img",
      "aria-label": `${item.label}: ${formatNumber(item.value)} NVD published CVEs${item.partial ? ", year to date" : ""}`,
    });
    const title = createSvgElement("title");
    title.textContent = `${item.label}: ${formatNumber(item.value)} NVD published CVEs${item.partial ? " (YTD)" : ""}`;
    bar.appendChild(title);
    group.appendChild(bar);

    if (options.labelEvery === 1 || index % options.labelEvery === 0 || index === items.length - 1) {
      const label = createSvgElement("text", { x: x + barWidth / 2, y: height - margin.bottom + 20, class: "axis-label axis-label-x", "text-anchor": "middle" });
      label.textContent = item.shortLabel;
      group.appendChild(label);
    }

    if (options.showValues) {
      const value = createSvgElement("text", { x: x + barWidth / 2, y: Math.max(y - 8, margin.top + 12), class: "bar-value", "text-anchor": "middle" });
      value.textContent = formatNumber(item.value);
      group.appendChild(value);
    }
    svg.appendChild(group);
  });
  container.appendChild(svg);
}

function showError() {
  ["#monthly-chart", "#annual-chart"].forEach((selector) => {
    const container = document.querySelector(selector);
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "error-message";
    paragraph.textContent = "Patch Watch could not load the NVD data. Please try again later.";
    container.appendChild(paragraph);
  });
}

async function initialise() {
  initialiseTheme();
  try {
    const response = await fetch("data/nvd.json", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`NVD data request failed with HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.monthly) || !Array.isArray(data.annual) || data.monthly.length === 0) throw new Error("NVD dataset is missing expected series");

    const latest = data.monthly.at(-1);
    document.querySelector("#latest-month").textContent = formatMonth(latest.month);
    document.querySelector("#latest-count").textContent = formatNumber(latest[VALUE_KEY]);
    document.querySelector("#generated-date").textContent = data.metadata.generated;
    document.querySelector("#monthly-window-label").textContent = `${data.monthly.length} months`;
    document.querySelector("#annual-window-label").textContent = `${data.annual.length} calendar years`;

    const monthlyItems = data.monthly.map((entry) => ({
      label: formatMonth(entry.month),
      shortLabel: entry.month.slice(2, 7).replace("-", "/"),
      value: entry[VALUE_KEY],
    }));
    renderBarChart(document.querySelector("#monthly-chart"), monthlyItems, {
      width: 1200, height: 430, margin: { top: 28, right: 16, bottom: 58, left: 70 }, gap: 5, labelEvery: 6, showValues: false,
      ariaLabel: "Bar chart of non-rejected CVEs published in NVD by month",
    });
    const average = monthlyItems.reduce((sum, item) => sum + item.value, 0) / monthlyItems.length;
    document.querySelector("#monthly-summary").textContent = `Average ${formatNumber(Math.round(average))} NVD published CVEs per month across this window.`;

    const annualItems = data.annual.map((entry) => ({
      label: String(entry.year),
      shortLabel: entry.partial_year ? `${entry.year} YTD` : String(entry.year),
      value: entry[VALUE_KEY],
      partial: Boolean(entry.partial_year),
    }));
    renderBarChart(document.querySelector("#annual-chart"), annualItems, {
      width: 900, height: 390, margin: { top: 42, right: 28, bottom: 62, left: 90 }, gap: 34, labelEvery: 1, showValues: true,
      ariaLabel: "Bar chart of annual non-rejected CVEs published in NVD",
    });
    const partial = data.annual.findLast((entry) => entry.partial_year);
    document.querySelector("#annual-note").textContent = partial ? `${partial.year} is year-to-date through ${formatMonth(latest.month).split(" ")[0]}.` : "";
  } catch (error) {
    console.error("Patch Watch NVD view failed to initialise", error);
    showError();
  }
}

initialise();
