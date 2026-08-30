(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PatchWatchBarSelection = api;
})(typeof window !== "undefined" ? window : null, function () {
  const CHART_SELECTOR = "#monthly-chart, #annual-chart";
  const BAR_SELECTOR = ".bar";
  const enhancedBars = new WeakSet();

  function isActivationKey(key) {
    return key === "Enter" || key === " ";
  }

  function selectedSummary(label) {
    return `Selected: ${label}`;
  }

  function ensureSummary(container) {
    const summaryId = `${container.id}-selection`;
    let summary = document.getElementById(summaryId);
    if (!summary) {
      summary = document.createElement("p");
      summary.id = summaryId;
      summary.className = "chart-selection";
      summary.setAttribute("aria-live", "polite");
      summary.hidden = true;
      container.parentElement.insertBefore(summary, container);
    }
    return summary;
  }

  function resetSelection(container, summary) {
    summary.hidden = true;
    summary.textContent = "";
    container.querySelectorAll(BAR_SELECTOR).forEach((bar) => {
      bar.classList.remove("bar-selected");
      bar.setAttribute("aria-pressed", "false");
    });
  }

  function selectBar(container, summary, bar) {
    container.querySelectorAll(BAR_SELECTOR).forEach((candidate) => {
      const selected = candidate === bar;
      candidate.classList.toggle("bar-selected", selected);
      candidate.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    const label = bar.getAttribute("aria-label") || "Selected chart value";
    summary.textContent = selectedSummary(label);
    summary.hidden = false;
  }

  function enhanceBar(container, summary, bar) {
    if (enhancedBars.has(bar)) return;
    enhancedBars.add(bar);
    bar.setAttribute("role", "button");
    bar.setAttribute("aria-pressed", "false");

    bar.addEventListener("click", () => selectBar(container, summary, bar));
    bar.addEventListener("keydown", (event) => {
      if (!isActivationKey(event.key)) return;
      event.preventDefault();
      selectBar(container, summary, bar);
    });
  }

  function enhanceChart(container) {
    const bars = [...container.querySelectorAll(BAR_SELECTOR)];
    if (bars.length === 0) return;
    const summary = ensureSummary(container);
    resetSelection(container, summary);
    bars.forEach((bar) => enhanceBar(container, summary, bar));
  }

  function initialise() {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;

    document.querySelectorAll(CHART_SELECTOR).forEach((container) => {
      const observer = new MutationObserver(() => enhanceChart(container));
      observer.observe(container, { childList: true, subtree: true });
      enhanceChart(container);
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
      initialise();
    }
  }

  return { isActivationKey, selectedSummary };
});
