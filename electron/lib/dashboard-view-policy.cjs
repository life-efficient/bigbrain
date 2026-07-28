const crypto = require("crypto");

function dashboardPartition(brainId) {
  const digest = crypto.createHash("sha256").update(String(brainId || "")).digest("hex").slice(0, 24);
  return `persist:bigbrain-dashboard-${digest}`;
}

function dashboardViewBounds(contentSize, chromeHeight) {
  const [width, height] = contentSize;
  return {
    x: 0,
    y: chromeHeight,
    width: Math.max(1, width),
    height: Math.max(1, height - chromeHeight),
  };
}

function isAllowedDashboardNavigation(url, dashboardOrigin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === dashboardOrigin) return true;
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

module.exports = {
  dashboardPartition,
  dashboardViewBounds,
  isAllowedDashboardNavigation,
};
