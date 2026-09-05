const THEME_STORAGE_KEY = "patchwatch-theme";
const VALID_THEMES = new Set(["light", "dark", "patchwatch90"]);
const VALUE_KEY = "nvd_published_cves";
const DEFAULT_COMPARISON = "microsoft";
const ROLLING_WINDOW = 12;

const COMPARISON_SERIES = {
  microsoft: { label: "Microsoft", dataUrl: "data/patches.json", valueKey: "new_microsoft_cves" },
  fortinet: { label: "Fortinet", dataUrl: "data/fortinet.json", valueKey: "fortinet_cna_cves" },
  ios: { label: "iOS", dataUrl: "data/ios.json", valueKey: "ios_security_cves" },
  macos: { label: "macOS", dataUrl: "data/macos.json", valueKey: "macos_security_cves" },
  chrome: { label: "Chrome", dataUrl: "data/chrome.json", valueKey: "chrome_release_cves" },
  firefox: { label: "Firefox", dataUrl: "data/firefox.json", valueKey: "firefox_security_cves" },
  linux: { label: "Linux kernel", dataUrl: "data/linux-kernel.json", valueKey: "linux_kernel_cna_cves" },
};

const VALID_COMPARISONS = new Set(Object.keys(COMPARISON_SERIES));
const comparisonDatasets = new Map();

function readUrlParam(name, validValues) {
  try {
    const value = new URL(window.location.href).searchParams.get(name);
    return validValues.has(value) ? value : null;
  } catch (error) {
    console.warn(`Patch Watch could not read the ${name} URL parameter`, error);
    return null;
  }
}

function updateUrlParam(name, value) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(name, value);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    console.warn(`Patch Watch could not update the ${name} URL parameter`, error);
  }
}

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

function formatSignedPercent(value) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
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
  if (selector) {
    selector.addEventListener("change", () => {
      applyTheme(selector.value, true);
      updateUrlParam("theme", selector.value);
    });
  }
  applyTheme(readUrlParam("theme", VALID_THEMES) ?? readStoredTheme() ?? systemTheme());
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

function buildRollingComparison(vendorData, vendorConfig, nvdData) {
  const vendorByMonth = new Map(vendorData.monthly.map((entry) => [entry.month, entry[vendorConfig.valueKey]]));
  const nvdByMonth = new Map(nvdData.monthly.map((entry) => [entry.month, entry[VALUE_KEY]]));
  const commonMonths = [...vendorByMonth.keys()].filter((month) => nvdByMonth.has(month)).sort();

  if (commonMonths.length < ROLLING_WINDOW) {
    throw new Error(`Need at least ${ROLLING_WINDOW} common months for trend comparison`);
  }

  const rolling = [];
  for (let index = ROLLING_WINDOW - 1; index < commonMonths.length; index += 1) {
    const windowMonths = commonMonths.slice(index - ROLLING_WINDOW + 1, index + 1);
    const vendorAverage = windowMonths.reduce((sum, month) => sum + Number(vendorByMonth.get(month)), 0) / ROLLING_WINDOW;
    const nvdAverage = windowMonths.reduce((sum, month) => sum + Number(nvdByMonth.get(month)), 0) / ROLLING_WINDOW;
    rolling.push({ month: commonMonths[index], vendorAverage, nvdAverage });
  }

  const baseline = rolling[0];
  if (baseline.vendorAverage <= 0 || baseline.nvdAverage <= 0) {
    throw new Error("Trend comparison baseline must be greater than zero");
  }

  return rolling.map((entry) => ({
    month: entry.month,
    vendorIndex: (entry.vendorAverage / baseline.vendorAverage) * 100,
    nvdIndex: (entry.nvdAverage / baseline.nvdAverage) * 100,
  }));
}

function renderLineChart(container, items, vendorLabel) {
  container.replaceChildren();
  const width = 1200;
  const height = 430;
  const margin = { top: 30, right: 24, bottom: 58, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = items.flatMap((item) => [item.vendorIndex, item.nvdIndex, 100]);
  let minValue = Math.floor(Math.min(...values) * 0.9);
  let maxValue = Math.ceil(Math.max(...values) * 1.1);
  if (minValue === maxValue) maxValue = minValue + 1;

  const xFor = (index) => margin.left + (index / Math.max(items.length - 1, 1)) * innerWidth;
  const yFor = (value) => margin.top + innerHeight - ((value - minValue) / (maxValue - minValue)) * innerHeight;
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${vendorLabel} versus NVD global 12-month rolling vulnerability trend, indexed to 100 at the first common comparison point`,
    preserveAspectRatio: "xMidYMid meet",
  });

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const value = minValue + (maxValue - minValue) * ratio;
    const y = yFor(value);
    svg.appendChild(createSvgElement("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "grid-line" }));
    const label = createSvgElement("text", { x: margin.left - 10, y: y + 4, class: "axis-label axis-label-y", "text-anchor": "end" });
    label.textContent = String(Math.round(value));
    svg.appendChild(label);
  }

  const baselineY = yFor(100);
  svg.appendChild(createSvgElement("line", {
    x1: margin.left, y1: baselineY, x2: width - margin.right, y2: baselineY, class: "trend-baseline",
  }));

  items.forEach((item, index) => {
    if (index % 6 !== 0 && index !== items.length - 1) return;
    const label = createSvgElement("text", {
      x: xFor(index), y: height - margin.bottom + 20, class: "axis-label axis-label-x", "text-anchor": "middle",
    });
    label.textContent = item.month.slice(2, 7).replace("-", "/");
    svg.appendChild(label);
  });

  const pathFor = (key) => items
    .map((item, index) => `${index === 0 ? "M" : "L"}${xFor(index).toFixed(2)},${yFor(item[key]).toFixed(2)}`)
    .join(" ");

  svg.appendChild(createSvgElement("path", { d: pathFor("vendorIndex"), class: "trend-line trend-line-vendor" }));
  svg.appendChild(createSvgElement("path", { d: pathFor("nvdIndex"), class: "trend-line trend-line-global" }));

  ["vendorIndex", "nvdIndex"].forEach((key) => {
    const className = key === "vendorIndex" ? "trend-point trend-point-vendor" : "trend-point trend-point-global";
    items.forEach((item, index) => {
      if (index % 6 !== 0 && index !== items.length - 1) return;
      const point = createSvgElement("circle", {
        cx: xFor(index), cy: yFor(item[key]), r: 4, class: className,
      });
      const title = createSvgElement("title");
      title.textContent = `${formatMonth(item.month)}: ${key === "vendorIndex" ? vendorLabel : "NVD global"} index ${Math.round(item[key])}`;
      point.appendChild(title);
      svg.appendChild(point);
    });
  });

  container.appendChild(svg);
}

async function loadComparisonDataset(key) {
  if (comparisonDatasets.has(key)) return comparisonDatasets.get(key);
  const config = COMPARISON_SERIES[key];
  const response = await fetch(config.dataUrl, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`${config.label} comparison data request failed with HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.monthly) || data.monthly.length === 0) throw new Error(`${config.label} comparison data is missing its monthly series`);
  comparisonDatasets.set(key, data);
  return data;
}

function renderComparisonSummary(items, vendorLabel) {
  const latest = items.at(-1);
  const vendorChange = latest.vendorIndex - 100;
  const nvdChange = latest.nvdIndex - 100;
  const difference = vendorChange - nvdChange;
  let relationship = "roughly in line with";
  if (difference > 5) relationship = "rising faster than";
  if (difference < -5) relationship = "rising slower than";

  document.querySelector("#comparison-summary").textContent =
    `${vendorLabel}'s 12-month rolling trend is ${formatSignedPercent(vendorChange)} from the common baseline; ` +
    `NVD is ${formatSignedPercent(nvdChange)}. The selected vendor / project is ${relationship} the global trend over this comparison window.`;
}

async function renderComparison(key, nvdData) {
  const config = COMPARISON_SERIES[key];
  if (!config) return;
  const container = document.querySelector("#comparison-chart");
  try {
    const vendorData = await loadComparisonDataset(key);
    const items = buildRollingComparison(vendorData, config, nvdData);
    document.querySelector("#comparison-vendor-label").textContent = config.label;
    renderLineChart(container, items, config.label);
    renderComparisonSummary(items, config.label);
    container.scrollLeft = container.scrollWidth;
  } catch (error) {
    console.error("Patch Watch trend comparison failed", error);
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "error-message";
    paragraph.textContent = `Patch Watch could not compare ${config.label} with NVD. Please try again later.`;
    container.appendChild(paragraph);
    document.querySelector("#comparison-summary").textContent = "";
  }
}

function initialiseComparisonSelector(nvdData) {
  const selector = document.querySelector("#comparison-vendor");
  Object.entries(COMPARISON_SERIES).forEach(([key, config]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = config.label;
    selector.appendChild(option);
  });
  const requestedComparison = readUrlParam("compare", VALID_COMPARISONS) ?? DEFAULT_COMPARISON;
  selector.value = requestedComparison;
  selector.addEventListener("change", () => {
    renderComparison(selector.value, nvdData);
    updateUrlParam("compare", selector.value);
  });
  renderComparison(requestedComparison, nvdData);
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

    initialiseComparisonSelector(data);

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
