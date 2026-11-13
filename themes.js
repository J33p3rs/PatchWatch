(function () {
  "use strict";

  const PERMANENT_THEMES = [
    { key: "light", label: "Light" },
    { key: "dark", label: "Dark" },
    { key: "patchwatch90", label: "PatchWatch 90" },
  ];

  // Add future seasonal themes here. Fixed windows are inclusive and recur annually.
  // A future rule type can support calculated occasions such as Easter without
  // changing the selector/application contract used by each page.
  const SEASONAL_THEMES = [
    {
      key: "christmas8bit",
      label: "Christmas",
      rule: { type: "fixed", start: [11, 1], end: [12, 31] },
    },
  ];

  function monthDayValue(month, day) {
    return month * 100 + day;
  }

  function fixedWindowActive(rule, date) {
    const current = monthDayValue(date.getMonth() + 1, date.getDate());
    const start = monthDayValue(rule.start[0], rule.start[1]);
    const end = monthDayValue(rule.end[0], rule.end[1]);
    return start <= end ? current >= start && current <= end : current >= start || current <= end;
  }

  function seasonalThemeActive(theme, date = new Date()) {
    if (!theme || !theme.rule) return false;
    if (theme.rule.type === "fixed") return fixedWindowActive(theme.rule, date);
    return false;
  }

  function availableThemes(date = new Date()) {
    return [
      ...PERMANENT_THEMES,
      ...SEASONAL_THEMES.filter((theme) => seasonalThemeActive(theme, date)),
    ];
  }

  function populateSelector(selector, date = new Date()) {
    if (!selector) return availableThemes(date);
    const themes = availableThemes(date);
    selector.replaceChildren();
    themes.forEach((theme) => {
      const option = document.createElement("option");
      option.value = theme.key;
      option.textContent = theme.label;
      selector.appendChild(option);
    });
    return themes;
  }

  window.PatchWatchThemes = Object.freeze({
    permanent: PERMANENT_THEMES,
    seasonal: SEASONAL_THEMES,
    availableThemes,
    seasonalThemeActive,
    populateSelector,
  });
}());
