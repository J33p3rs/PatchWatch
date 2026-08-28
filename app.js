const DATA_URL = "data/patches.json";

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

function renderBarChart(container, items, options) {
  container.replaceChildren();

  const width = options.width;
  const height = options.height;
  const margin = options.margin;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const gap = options.gap;
  const barWidth = Math.max((innerWidth - gap * (items.length - 1)) / items.length, 1);

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": options.ariaLabel,
    preserveAspectRatio: "xMidYMid meet",
  });

  const gridLines = 4;
  for (let i = 0; i <= gridLines; i += 1) {
    const ratio = i / gridLines;
    const y = margin.top + innerHeight - ratio * innerHeight;
    const grid = createSvgElement("line", {
      x1: margin.left,
      y1: y,
      x2: width - margin.right,
      y2: y,
      class: "grid-line",
    });
    svg.appendChild(grid);

    const label = createSvgElement("text", {
      x: margin.left - 10,
      y: y + 4,
      class: "axis-label axis-label-y",
      "text-anchor": "end",
    });
    label.textContent = formatNumber(Math.round(maxValue * ratio));
    svg.appendChild(label);
  }

  items.forEach((item, index) => {
    const x = margin.left + index * (barWidth + gap);
    const barHeight = (item.value / maxValue) * innerHeight;
    const y = margin.top + innerHeight - barHeight;

    const group = createSvgElement("g", { class: "bar-group" });
    const bar = createSvgElement("rect", {
      x,
      y,
      width: barWidth,
      height: barHeight,
      rx: Math.min(4, barWidth / 3),
      class: item.partial ? "bar bar-partial" : "bar",
      tabindex: "0",
      role: "img",
      "aria-label": `${item.label}: ${formatNumber(item.value)} new Microsoft CVEs${item.partial ? ", year to date" : ""}`,
    });

    const title = createSvgElement("title");
    title.textContent = `${item.label}: ${formatNumber(item.value)} new Microsoft CVEs${item.partial ? " (YTD)" : ""}`;
    bar.appendChild(title);
    group.appendChild(bar);

    const shouldShowLabel = options.labelEvery === 1 || index % options.labelEvery === 0 || index === items.length - 1;
    if (shouldShowLabel) {
      const label = createSvgElement("text", {
        x: x + barWidth / 2,
        y: height - margin.bottom + 20,
        class: "axis-label axis-label-x",
        "text-anchor": "middle",
      });
      label.textContent = item.shortLabel;
      group.appendChild(label);
    }

    if (options.showValues) {
      const valueLabel = createSvgElement("text", {
        x: x + barWidth / 2,
        y: Math.max(y - 8, margin.top + 12),
        class: "bar-value",
        "text-anchor": "middle",
      });
      valueLabel.textContent = formatNumber(item.value);
      group.appendChild(valueLabel);
    }

    svg.appendChild(group);
  });

  container.appendChild(svg);
}

function renderMonthly(monthly) {
  const items = monthly.map((entry) => ({
    label: formatMonth(entry.month),
    shortLabel: entry.month.slice(2, 7).replace("-", "/"),
    value: entry.new_microsoft_cves,
  }));

  renderBarChart(document.querySelector("#monthly-chart"), items, {
    width: 1200,
    height: 430,
    margin: { top: 28, right: 16, bottom: 58, left: 62 },
    gap: 5,
    labelEvery: 6,
    showValues: false,
    ariaLabel: "Bar chart of monthly Microsoft Patch Tuesday CVE counts for the most recent 60 releases",
  });

  const average = monthly.reduce((sum, entry) => sum + entry.new_microsoft_cves, 0) / monthly.length;
  document.querySelector("#monthly-summary").textContent = `Average ${Math.round(average)} new CVEs per release across this window.`;
}

function renderAnnual(annual) {
  const items = annual.map((entry) => ({
    label: String(entry.year),
    shortLabel: entry.partial_year ? `${entry.year} YTD` : String(entry.year),
    value: entry.new_microsoft_cves,
    partial: Boolean(entry.partial_year),
  }));

  renderBarChart(document.querySelector("#annual-chart"), items, {
    width: 900,
    height: 390,
    margin: { top: 42, right: 28, bottom: 62, left: 78 },
    gap: 34,
    labelEvery: 1,
    showValues: true,
    ariaLabel: "Bar chart of annual Microsoft Patch Tuesday CVE totals from 2022 to 2026",
  });
}

function populateHeadline(data) {
  const latest = data.monthly.at(-1);
  document.querySelector("#latest-month").textContent = formatMonth(latest.month);
  document.querySelector("#latest-count").textContent = formatNumber(latest.new_microsoft_cves);
  document.querySelector("#generated-date").textContent = data.metadata.generated;
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

async function initialise() {
  try {
    const response = await fetch(DATA_URL, {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Data request failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.monthly) || !Array.isArray(data.annual) || data.monthly.length === 0) {
      throw new Error("Patch Watch data is missing the expected monthly or annual series");
    }

    populateHeadline(data);
    renderMonthly(data.monthly);
    renderAnnual(data.annual);
  } catch (error) {
    console.error("Patch Watch failed to initialise", error);
    showError("Patch Watch could not load its data. Please try again later.");
  }
}

initialise();
