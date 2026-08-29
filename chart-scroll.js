function positionChartAtLatest(container) {
  if (!container || container.dataset.initialScrollDone === "true") return;

  window.requestAnimationFrame(() => {
    container.scrollLeft = container.scrollWidth;
    container.dataset.initialScrollDone = "true";
  });
}

function observeInitialChart(selector) {
  const container = document.querySelector(selector);
  if (!container) return;

  if (container.firstElementChild) {
    positionChartAtLatest(container);
    return;
  }

  const observer = new MutationObserver(() => {
    if (!container.firstElementChild) return;
    positionChartAtLatest(container);
    observer.disconnect();
  });

  observer.observe(container, { childList: true });
}

observeInitialChart("#monthly-chart");
observeInitialChart("#comparison-chart");
