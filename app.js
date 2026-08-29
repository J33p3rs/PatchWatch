const THEME_STORAGE_KEY = "patchwatch-theme";
const VISIT_STORAGE_KEY = "patchwatch-local-visits";
const DEFAULT_VIEW = "all";
const VALID_THEMES = new Set(["light", "dark", "patchwatch90"]);

const VENDORS = {
  microsoft: {
    label: "Microsoft",
    dataUrl: "data/patches.json",
    valueKey: "new_microsoft_cves",
    includeInAll: true,
    eyebrow: "Microsoft Patch Tuesday",
    lede: "New Microsoft CVEs counted at Patch Tuesday release time, tracked month by month.",
    latestTitle: "Latest release",
    latestNote: "new Microsoft CVEs",
    valueDescription: "new Microsoft CVEs",
    monthlyAria: "Bar chart of monthly Microsoft Patch Tuesday CVE counts for the most recent releases",
    annualAria: "Bar chart of annual Microsoft Patch Tuesday CVE totals",
    averageSuffix: "new CVEs per release across this window.",
    strongText: "new Microsoft CVEs",
    method: [
      "Patch Watch uses a consistent release-day count of new Microsoft CVEs. It excludes republished third-party and Chromium CVEs and, where the release-day source does so, items already resolved by Microsoft.",
      "The live Microsoft CVRF feed is retained for future enrichment, but is not used as the historical headline count because those monthly documents can be revised after Patch Tuesday.",
    ],
  },
  fortinet: {
    label: "Fortinet",
    dataUrl: "data/fortinet.json",
    valueKey: "fortinet_cna_cves",
    includeInAll: true,
    eyebrow: "Fortinet disclosures",
    lede: "Fortinet-assigned CNA CVEs published each calendar month, including regular and out-of-cycle disclosures.",
    latestTitle: "Latest month",
    latestNote: "Fortinet CNA CVEs",
    valueDescription: "Fortinet CNA CVEs",
    monthlyAria: "Bar chart of monthly Fortinet-assigned CNA CVE publication counts",
    annualAria: "Bar chart of annual Fortinet-assigned CNA CVE publication totals",
    averageSuffix: "Fortinet CNA CVEs per month across this window.",
    strongText: "Fortinet-assigned CNA CVEs",
    method: [
      "Patch Watch counts Fortinet-assigned CNA CVEs by their CVE List publication month. This includes both Fortinet's regular monthly PSIRT disclosures and out-of-cycle publications.",
      "This is disclosure volume, not a claim that every Fortinet CVE belongs to a Patch-Tuesday-style release. Fortinet's historical advisory cadence changed and critical or actively exploited vulnerabilities can be released out of cycle.",
    ],
  },
};

const ALL_VIEW = {
  label: "All",
  eyebrow: "All tracked vendors",
  lede: "Combined headline vulnerability counts across every vendor currently tracked by Patch Watch.",
  latestTitle: "Latest common month",
  latestNote: "combined tracked-vendor count",
  valueDescription: "combined tracked-vendor CVEs",
  monthlyAria: "Bar chart of combined monthly headline vulnerability counts across all tracked Patch Watch vendors",
  annualAria: "Bar chart of combined annual headline vulnerability counts across all tracked Patch Watch vendors",
  averageSuffix: "combined tracked-vendor CVEs per common month across this window.",
  strongText: "existing Patch Watch headline metric",
  method: [
    "The All vendors view sums each vendor's existing Patch Watch headline metric for months where every included vendor has data.",
    "The total is an operational comparison measure, not a count of globally unique CVEs and not a claim that each vendor uses the same disclosure or patch-release process. Adding a future vendor to the configured dataset automatically adds it to this view unless it is explicitly excluded.",
  ],
};

const monthFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const datasets = new Map();
let activeView = DEFAULT_VIEW;

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
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(storedTheme) ? storedTheme : null;
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
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch (error) {
    console.warn("Patch Watch could not read the system colour scheme", error);
  }
  return "light";
}

function applyTheme(theme, persist = false) {
  const resolvedTheme = VALID_THEMES.has(theme) ? theme : "light";
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme === "light" ? "light" : "dark";

  const selector = document.querySelector("#theme-select");
  if (selector) selector.value = resolvedTheme;
  if (persist) saveTheme(resolvedTheme);
}

function initialiseTheme() {
  const selector = document.querySelector("#theme-select");
  if (selector) {
    selector.addEventListener("change", () => applyTheme(selector.value, true));
  }
  applyTheme(readStoredTheme() ?? systemTheme());
}

function initialiseLocalVisitCounter() {
  let visits = 1;
  try {
    const previous = Number.parseInt(window.localStorage.getItem(VISIT_STORAGE_KEY) ?? "0", 10);
    visits = Number.isFinite(previous) && previous >= 0 ? previous + 1 : 1;
    window.localStorage.setItem(VISIT_STORAGE_KEY, String(visits));
  } catch (error) {
    console.warn("Patch Watch could not update the local visit counter", error);
  }

  const counter = document.querySelector("#retro-visit-count");
  if (counter) counter.value = String(visits).padStart(6, "0");
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
    svg.appendChild(createSvgElement("line", {
      x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: "grid-line",
    }));
    const label = createSvgElement("text", {
      x: margin.left - 10, y: y + 4, class: "axis-label axis-label-y", "text-anchor": "end",
    });
    label.textContent = formatNumber(Math.round(maxValue * ratio));
    svg.appendChild(label);
  }

  items.forEach((item, index) => {
    const x = margin.left + index * (barWidth + gap);
    const barHeight = (item.value / maxValue) * innerHeight;
    const y = margin.top + innerHeight - barHeight;
    const group = createSvgElement("g", { class: "bar-group" });
    const suffix = item.partial ? ", year to date" : "";
    const bar = createSvgElement("rect", {
      x, y, width: barWidth, height: barHeight, rx: Math.min(4, barWidth / 3),
      class: item.partial ? "bar bar-partial" : "bar",
      tabindex: "0", role: "img",
      "aria-label": `${item.label}: ${formatNumber(item.value)} ${options.valueDescription}${suffix}`,
    });
    const title = createSvgElement("title");
    title.textContent = `${item.label}: ${formatNumber(item.value)} ${options.valueDescription}${item.partial ? " (YTD)" : ""}`;
    bar.appendChild(title);
    group.appendChild(bar);

    if (options.labelEvery === 1 || index % options.labelEvery === 0 || index === items.length - 1) {
      const label = createSvgElement("text", {
        x: x + barWidth / 2, y: height - margin.bottom + 20,
        class: "axis-label axis-label-x", "text-anchor": "middle",
      });
      label.textContent = item.shortLabel;
      group.appendChild(label);
    }

    if (options.showValues) {
      const valueLabel = createSvgElement("text", {
        x: x + barWidth / 2, y: Math.max(y - 8, margin.top + 12),
        class: "bar-value", "text-anchor": "middle",
      });
      valueLabel.textContent = formatNumber(item.value);
      group.appendChild(valueLabel);
    }
    svg.appendChild(group);
  });
  container.appendChild(svg);
}

function aggregateVendorKeys() {
  return Object.keys(VENDORS).filter((key) => VENDORS[key].includeInAll !== false);
}

function intersectSets(sets) {
  if (sets.length === 0) return [];
  return [...sets[0]].filter((value) => sets.every((set) => set.has(value)));
}

function deriveAnnualFromMonthly(monthly) {
  const byYear = new Map();
  monthly.forEach((entry) => {
    const year = Number(entry.month.slice(0, 4));
    const current = byYear.get(year) ?? { total: 0, months: 0 };
    current.total += entry.combined_vendor_cves;
    current.months += 1;
    byYear.set(year, current);
  });

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-5)
    .map(([year, summary]) => ({
      year,
      combined_vendor_cves: summary.total,
      partial_year: summary.months < 12,
    }));
}

function buildCombinedDataset() {
  const vendorKeys = aggregateVendorKeys();
  const vendorData = vendorKeys.map((key) => ({ key, config: VENDORS[key], data: datasets.get(key) }));
  if (vendorData.some((entry) => !entry.data)) return null;

  const monthSets = vendorData.map(({ data }) => new Set(data.monthly.map((entry) => entry.month)));
  const commonMonths = intersectSets(monthSets).sort().slice(-60);
  const monthly = commonMonths.map((month) => {
    const total = vendorData.reduce((sum, { config, data }) => {
      const entry = data.monthly.find((item) => item.month === month);
      return sum + entry[config.valueKey];
    }, 0);
    return { month, combined_vendor_cves: total };
  });

  const generatedDates = vendorData
    .map(({ data }) => data.metadata?.generated)
    .filter(Boolean)
    .sort();

  return {
    metadata: {
      generated: generatedDates[0] ?? "—",
      included_vendors: vendorKeys,
    },
    monthly,
    annual: deriveAnnualFromMonthly(monthly),
  };
}

function viewDefinition(view) {
  if (view === "all") {
    return {
      config: { ...ALL_VIEW, valueKey: "combined_vendor_cves" },
      data: buildCombinedDataset(),
    };
  }
  return { config: VENDORS[view], data: datasets.get(view) };
}

function buildVendorSelector() {
  const selector = document.querySelector("#vendor-selector");
  if (!selector) return;
  selector.replaceChildren();

  const views = [{ key: "all", label: ALL_VIEW.label }, ...Object.entries(VENDORS).map(([key, config]) => ({ key, label: config.label }))];
  views.forEach(({ key, label }) => {
    const button = document.createElement("button");
    button.className = "vendor-button";
    button.type = "button";
    button.dataset.vendor = key;
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => renderView(key));
    selector.appendChild(button);
  });
}

function renderMethod(config) {
  const methodCopy = document.querySelector("#method-copy");
  methodCopy.replaceChildren();
  config.method.forEach((text, index) => {
    const paragraph = document.createElement("p");
    if (index === 0 && config.strongText && text.includes(config.strongText)) {
      const [before, after = ""] = text.split(config.strongText);
      paragraph.append(document.createTextNode(before));
      const strong = document.createElement("strong");
      strong.textContent = config.strongText;
      paragraph.append(strong, document.createTextNode(after));
    } else {
      paragraph.textContent = text;
    }
    methodCopy.appendChild(paragraph);
  });
}

function renderView(view) {
  const { config, data } = viewDefinition(view);
  if (!config || !data || data.monthly.length === 0) return;
  activeView = view;

  document.querySelectorAll(".vendor-button").forEach((button) => {
    const selected = button.dataset.vendor === view;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  document.querySelector("#vendor-eyebrow").textContent = config.eyebrow;
  document.querySelector("#vendor-lede").textContent = config.lede;
  document.querySelector("#latest-title").textContent = config.latestTitle;
  document.querySelector("#latest-note").textContent = config.latestNote;

  const latest = data.monthly.at(-1);
  document.querySelector("#latest-month").textContent = formatMonth(latest.month);
  document.querySelector("#latest-count").textContent = formatNumber(latest[config.valueKey]);
  document.querySelector("#generated-date").textContent = data.metadata.generated;
  document.querySelector("#monthly-window-label").textContent = `${data.monthly.length} ${view === "all" ? "common " : ""}months`;
  document.querySelector("#annual-window-label").textContent = `${data.annual.length} calendar years`;

  const partialYear = data.annual.findLast((entry) => entry.partial_year);
  const annualNote = document.querySelector("#annual-note");
  annualNote.textContent = partialYear ? `${partialYear.year} is year-to-date through ${formatMonth(latest.month).split(" ")[0]}.` : "";

  const monthlyItems = data.monthly.map((entry) => ({
    label: formatMonth(entry.month),
    shortLabel: entry.month.slice(2, 7).replace("-", "/"),
    value: entry[config.valueKey],
  }));
  renderBarChart(document.querySelector("#monthly-chart"), monthlyItems, {
    width: 1200, height: 430, margin: { top: 28, right: 16, bottom: 58, left: 62 },
    gap: 5, labelEvery: 6, showValues: false,
    ariaLabel: config.monthlyAria, valueDescription: config.valueDescription,
  });
  const average = monthlyItems.reduce((sum, item) => sum + item.value, 0) / monthlyItems.length;
  document.querySelector("#monthly-summary").textContent = `Average ${Math.round(average)} ${config.averageSuffix}`;

  const annualItems = data.annual.map((entry) => ({
    label: String(entry.year),
    shortLabel: entry.partial_year ? `${entry.year} YTD` : String(entry.year),
    value: entry[config.valueKey],
    partial: Boolean(entry.partial_year),
  }));
  renderBarChart(document.querySelector("#annual-chart"), annualItems, {
    width: 900, height: 390, margin: { top: 42, right: 28, bottom: 62, left: 78 },
    gap: 34, labelEvery: 1, showValues: true,
    ariaLabel: config.annualAria, valueDescription: config.valueDescription,
  });

  renderMethod(config);
}

function showError(message) {
  ["#monthly-chart", "#annual-chart"].forEach((selector) => {
    const container = document.querySelector(selector);
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = "error-message";
    paragraph.textContent = message;
    container.appendChild(paragraph);
  });
}

async function loadDataset(vendor) {
  const response = await fetch(VENDORS[vendor].dataUrl, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${vendor} data request failed with HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.monthly) || !Array.isArray(data.annual) || data.monthly.length === 0) {
    throw new Error(`${vendor} data is missing the expected monthly or annual series`);
  }
  datasets.set(vendor, data);
}

async function initialise() {
  initialiseTheme();
  initialiseLocalVisitCounter();
  buildVendorSelector();

  try {
    await Promise.all(Object.keys(VENDORS).map(loadDataset));
    renderView(activeView);
  } catch (error) {
    console.error("Patch Watch failed to initialise", error);
    showError("Patch Watch could not load its data. Please try again later.");
  }
}

initialise();
