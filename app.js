const THEME_STORAGE_KEY = "patchwatch-theme";
const DEFAULT_VENDOR = "microsoft";

const VENDORS = {
  microsoft: {
    dataUrl: "data/patches.json",
    valueKey: "new_microsoft_cves",
    eyebrow: "Microsoft Patch Tuesday",
    lede: "New Microsoft CVEs counted at Patch Tuesday release time, tracked month by month.",
    latestTitle: "Latest release",
    latestNote: "new Microsoft CVEs",
    valueDescription: "new Microsoft CVEs",
    monthlyAria: "Bar chart of monthly Microsoft Patch Tuesday CVE counts for the most recent 60 releases",
    annualAria: "Bar chart of annual Microsoft Patch Tuesday CVE totals from 2022 to 2026",
    averageSuffix: "new CVEs per release across this window.",
    method: [
      "Patch Watch uses a consistent release-day count of new Microsoft CVEs. It excludes republished third-party and Chromium CVEs and, where the release-day source does so, items already resolved by Microsoft.",
      "The live Microsoft CVRF feed is retained for future enrichment, but is not used as the historical headline count because those monthly documents can be revised after Patch Tuesday.",
    ],
  },
  fortinet: {
    dataUrl: "data/fortinet.json",
    valueKey: "fortinet_cna_cves",
    eyebrow: "Fortinet disclosures",
    lede: "Fortinet-assigned CNA CVEs published each calendar month, including regular and out-of-cycle disclosures.",
    latestTitle: "Latest month",
    latestNote: "Fortinet CNA CVEs",
    valueDescription: "Fortinet CNA CVEs",
    monthlyAria: "Bar chart of monthly Fortinet-assigned CNA CVE publication counts for the most recent 60 months",
    annualAria: "Bar chart of annual Fortinet-assigned CNA CVE publication totals from 2022 to 2026",
    averageSuffix: "Fortinet CNA CVEs per month across this window.",
    method: [
      "Patch Watch counts Fortinet-assigned CNA CVEs by their CVE List publication month. This includes both Fortinet's regular monthly PSIRT disclosures and out-of-cycle publications.",
      "This is disclosure volume, not a claim that every Fortinet CVE belongs to a Patch-Tuesday-style release. Fortinet's historical advisory cadence changed and critical or actively exploited vulnerabilities can be released out of cycle.",
    ],
  },
};

const monthFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const datasets = new Map();
let activeVendor = DEFAULT_VENDOR;

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
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
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
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  const isDark = resolvedTheme === "dark";
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;

  const toggle = document.querySelector("#theme-toggle");
  const label = document.querySelector("#theme-toggle-label");
  if (toggle && label) {
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    label.textContent = isDark ? "Light mode" : "Dark mode";
  }
  if (persist) saveTheme(resolvedTheme);
}

function initialiseTheme() {
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      applyTheme(current === "dark" ? "light" : "dark", true);
    });
  }
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

function renderVendor(vendor) {
  const config = VENDORS[vendor];
  const data = datasets.get(vendor);
  if (!config || !data) return;
  activeVendor = vendor;

  document.querySelectorAll(".vendor-button").forEach((button) => {
    const selected = button.dataset.vendor === vendor;
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

  const methodCopy = document.querySelector("#method-copy");
  methodCopy.replaceChildren();
  config.method.forEach((text, index) => {
    const paragraph = document.createElement("p");
    if (index === 0) {
      const strongText = vendor === "microsoft" ? "new Microsoft CVEs" : "Fortinet-assigned CNA CVEs";
      const [before, after = ""] = text.split(strongText);
      paragraph.append(document.createTextNode(before));
      const strong = document.createElement("strong");
      strong.textContent = strongText;
      paragraph.append(strong, document.createTextNode(after));
    } else {
      paragraph.textContent = text;
    }
    methodCopy.appendChild(paragraph);
  });
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
  document.querySelectorAll(".vendor-button").forEach((button) => {
    button.addEventListener("click", () => renderVendor(button.dataset.vendor));
  });

  try {
    await Promise.all(Object.keys(VENDORS).map(loadDataset));
    renderVendor(activeVendor);
  } catch (error) {
    console.error("Patch Watch failed to initialise", error);
    showError("Patch Watch could not load its data. Please try again later.");
  }
}

initialise();
