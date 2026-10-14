function empty(id, name) {
  return {id: id, name: name || id, plan: "", state: "loading", message: "Checking usage…", observedAt: 0, windows: []}
}

function fresh(provider, now) {
  return provider && provider.state === "fresh" && typeof provider.observedAt === "number"
    && provider.observedAt > 0 && now >= provider.observedAt - 5000
    && now - provider.observedAt <= 600000
}

// mode is "remaining" (default: headroom left) or "used" (spent so far); chosen per provider.
function percentage(window, now, mode) {
  if (!window || typeof window.used !== "number" || !isFinite(window.used)) return "—"
  if (window.resetAt > 0 && now >= window.resetAt) return "—"
  var used = Math.max(0, Math.min(1, window.used))
  return Math.round((mode === "used" ? used : 1 - used) * 100) + "%"
}

function displayMode(value) { return value === "used" ? "used" : "remaining" }

// Fraction of the meter to fill for a window in the given mode.
function meterFill(window, mode) {
  var used = Math.max(0, Math.min(1, window.used))
  return mode === "used" ? used : 1 - used
}

// Windows the top bar may show, in display order. Unknown IDs are dropped and
// an empty choice falls back to the weekly headline.
var BAR_WINDOWS = ["session", "weekly"]
function barWindows(value) {
  var ids = BAR_WINDOWS.filter(function(id) { return Array.isArray(value) && value.indexOf(id) >= 0 })
  return ids.length ? ids : ["weekly"]
}

// Short window name for the top bar: derived from the duration so it stays
// stable across providers ("5h", "7d"), falling back to the window title.
function shortTitle(window) {
  if (!window) return ""
  var ms = window.durationMs
  if (typeof ms === "number" && isFinite(ms) && ms > 0) {
    var minutes = Math.round(ms / 60000)
    var hours = minutes / 60
    if (hours >= 24 && hours % 24 === 0) return (hours / 24) + "d"
    if (hours >= 1 && hours % 1 === 0) return hours + "h"
    if (minutes >= 1) return minutes + "m"
  }
  return typeof window.title === "string" ? window.title : ""
}

// Top-bar text for one provider: the selected windows in order. Labels appear
// only when more than one window is shown. A missing window is skipped; with
// none available the bar shows a dash. decorate(window) may add a per-window
// suffix such as a stale mark or a flame.
function barText(provider, windowIds, now, mode, decorate) {
  var parts = []
  var ids = Array.isArray(windowIds) ? windowIds : []
  for (var i = 0; i < ids.length; i++) {
    var window = find(provider, ids[i])
    if (!window) continue
    var suffix = decorate ? decorate(window) || "" : ""
    parts.push({label: shortTitle(window), text: percentage(window, now, mode) + suffix})
  }
  if (!parts.length) return "—"
  return parts.map(function(part) {
    return parts.length > 1 && part.label ? part.label + " " + part.text : part.text
  }).join(" · ")
}

function find(provider, id) {
  var list = provider ? provider.windows || [] : []
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

function message(provider, now) {
  if (!provider) return "Waiting for the usage service"
  if (provider.state !== "fresh") return provider.message || "Usage unavailable"
  if (!fresh(provider, now)) return "Outdated · refresh to check usage"
  for (var i = 0; i < provider.windows.length; i++)
    if (provider.windows[i].resetAt > 0 && now >= provider.windows[i].resetAt) return "Window reset · awaiting fresh usage"
  return ""
}

function merge(previous, incoming) {
  // Preserve last-good numbers, but never carry forward their freshness.
  if (incoming.state !== "fresh" && !incoming.windows.length && previous && previous.windows.length) {
    incoming = Object.assign({}, incoming, {windows: previous.windows, observedAt: previous.observedAt, plan: previous.plan})
  }
  return incoming
}

function demo(now, mode) {
  function win(id, title, used, period, elapsed) {
    return {id: id, title: title, used: used, resetAt: now + period - elapsed, durationMs: period}
  }
  var hour = 3600000, week = 168 * hour
  var providers = [
    {id: "claude", name: "Claude Code", plan: "Max", state: "fresh", message: "", observedAt: now,
      windows: [win("session", "Session", 0.4, 5 * hour, hour), win("weekly", "Weekly", 0.24, week, 72 * hour), win("fable-weekly", "Fable Weekly", 0.485, week, 84 * hour)]},
    {id: "codex", name: "Codex", plan: "Pro", state: "fresh", message: "", observedAt: now,
      windows: [win("session", "Session", 0.2, 5 * hour, 2 * hour), win("weekly", "Weekly", 0.35, week, 96 * hour)]}
  ]
  if (mode === "stale") providers.forEach(function(p) { p.state = "stale"; p.message = "Last reading · refresh failed"; p.observedAt -= 900000 })
  if (mode === "empty") providers.forEach(function(p) { p.state = "unavailable"; p.message = "Sign in with the provider CLI, then refresh"; p.windows = []; p.observedAt = 0 })
  return providers
}

// Use the same deadlines as the service timer, including the separate cost worker.
function refreshLabel(service, now) {
  if (!service) return "Updates unavailable"
  if (service.demoMode !== "") return "Sample data"
  if (service.refreshing || service.costsRefreshing) return "Updating…"
  var deadlines = []
  if (service.selectedIds.length) deadlines.push(service.nextRefreshAt)
  if (service.costIds.length) deadlines.push(service.nextCostRefreshAt)
  if (!deadlines.length) return "Updates paused"
  var remaining = Math.min.apply(null, deadlines) - now
  if (remaining <= 0) return "Next update soon"
  if (remaining < 60000) return "Next update in <1 min"
  return "Next update in " + Math.floor(remaining / 60000) + " min"
}
