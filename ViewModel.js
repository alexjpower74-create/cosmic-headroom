// What the COSMIC applet draws, worked out from Headroom's model: the panel text and the popup's
// rows, as plain data. Pure: no I/O and no clock of its own. Headroom's Model and Pace (engine/) are
// passed in, so this file loads the same way they do (see tests/viewmodel.test.cjs) and the wording
// stays the GNOME extension's wording.
// The same defaults as the GNOME extension's settings schema.
var DEFAULT_PROVIDERS = ["claude", "codex"]
var DEFAULT_BAR_WINDOWS = ["weekly"]

function definition(catalog, id) {
  for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i]
  return null
}

// Positions on the meter, to the nearest hundredth: fine enough to draw, and steady enough that a
// reading does not look new every second just because the clock moved.
function hundredths(value) { return Math.round(value * 100) / 100 }

// The settings file's text -> settings that are safe to use. Anything missing or wrong falls back.
function settings(raw, catalog) {
  var parsed = null
  try { parsed = JSON.parse(raw) } catch (e) { parsed = null }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {}
  var wanted = Array.isArray(parsed.providers) ? parsed.providers : DEFAULT_PROVIDERS
  var providers = wanted.filter(function(id, i) { return definition(catalog, id) && wanted.indexOf(id) === i })
  var display = {}
  catalog.forEach(function(p) {
    display[p.id] = parsed.display && typeof parsed.display === "object" && parsed.display[p.id] === "used" ? "used" : "remaining"
  })
  return {
    providers: providers,
    barWindows: Array.isArray(parsed.barWindows) ? parsed.barWindows : DEFAULT_BAR_WINDOWS,
    display: display,
    demo: parsed.demo === true
  }
}

// usage(id) returns that provider's latest reading, or nothing while the first one is on its way.
function view(Model, Pace, catalog, prefs, usage, footer, now) {
  var barWindows = Model.barWindows(prefs.barWindows)
  var bar = [], providers = []
  prefs.providers.forEach(function(id) {
    var entry = definition(catalog, id)
    if (!entry) return
    var mode = prefs.display[id]
    var reading = usage(id)
    var fresh = Model.fresh(reading, now)
    bar.push({id: id, icon: entry.icon, text: Model.barText(reading, barWindows, now, mode, function(window) {
      if (!fresh) return " !"
      var pace = Pace.evaluate(window, reading ? reading.observedAt : undefined, now, fresh)
      return pace && (pace.status === "urgent" || pace.status === "exhausted") ? " 🔥" : ""
    })})
    var shown = reading || Model.empty(id, entry.name)
    providers.push({
      id: id, name: entry.name, icon: entry.icon, plan: shown.plan || "", status: Model.message(shown, now),
      windows: (shown.windows || []).map(function(window) {
        var pace = Pace.evaluate(window, shown.observedAt, now, fresh)
        var percent = Model.percentage(window, now, mode)
        var known = percent !== "—"
        var marker = known ? Pace.marker(pace) : null
        return {
          id: window.id, title: window.title,
          value: known ? percent + (mode === "used" ? " used" : " left") : percent,
          fill: known ? hundredths(Model.meterFill(window, mode)) : null,
          // The marker is the elapsed share of the window; in remaining mode it counts down from the
          // right, in used mode up from the left.
          marker: marker === null ? null : hundredths(mode === "used" ? marker : 1 - marker),
          severity: known ? Pace.severity(window, pace, now, fresh) : "none",
          dim: !fresh,
          reset: window.resetAt > 0 ? "Resets " + Pace.duration(window.resetAt - now) : "Reset time unavailable",
          warning: pace && pace.status !== "calm" ? ((pace.status === "caution" ? "⌛ " : "🔥 ") + Pace.summary(pace, now)).trim() : "",
          tooltip: Pace.tooltip(pace)
        }
      })
    })
  })
  return {schema: 1, bar: bar, providers: providers, footer: footer, demo: prefs.demo === true}
}

// The line under "Headroom" in the popup, to the minute so it changes once a minute, not once a second.
function footer(state, now) {
  if (state.demo) return "Sample data"
  if (state.updating) return "Updating…"
  if (!state.selected) return "Updates paused"
  var remaining = state.nextRefreshAt - now
  if (!isFinite(remaining) || remaining <= 0) return "Next update soon"
  if (remaining < 60000) return "Next update in <1 min"
  return "Next update in " + Math.floor(remaining / 60000) + " min"
}
