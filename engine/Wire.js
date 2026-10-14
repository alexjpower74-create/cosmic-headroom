// Validate the entire worker boundary before any value reaches the shared shell.
function number(value, max) { return typeof value === "number" && isFinite(value) && value >= 0 && value <= max }
function text(value, max) { return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function parse(raw, costs, expectedIds) {
  if (raw.length > 131072) throw new Error("size")
  // Bound nesting before JSON.parse, ignoring braces inside quoted strings.
  var depth = 0, quoted = false, escaped = false
  for (var i = 0; i < raw.length; i++) {
    var ch = raw[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === "{" || ch === "[") { if (++depth > 12) throw new Error("depth") }
    else if (ch === "}" || ch === "]") depth--
  }
  var doc = JSON.parse(raw)
  if (!object(doc) || doc.schema !== 1 || !number(doc.observedAt, 8640000000000000)
      || !Array.isArray(expectedIds) || expectedIds.length > 20
      || !Array.isArray(doc.providers) || doc.providers.length !== expectedIds.length) throw new Error("report")
  var seen = []
  doc.providers.forEach(function(p) {
    if (!object(p) || expectedIds.indexOf(p.id) < 0 || seen.indexOf(p.id) >= 0 || !text(p.message, 160)) throw new Error("provider")
    seen.push(p.id)
    if (costs) {
      if (["fresh", "partial", "unavailable"].indexOf(p.state) < 0 || !object(p.daily)) throw new Error("cost")
      var days = Object.keys(p.daily)
      if (days.length > 30) throw new Error("days")
      days.forEach(function(day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !number(p.daily[day], 1e12)) throw new Error("amount")
      })
    } else {
      if (["fresh", "stale", "unavailable"].indexOf(p.state) < 0 || !text(p.name, 40) || !text(p.plan, 40)
          || !number(p.observedAt, 8640000000000000) || !Array.isArray(p.windows) || p.windows.length > 50
          || (p.state === "fresh" && (!p.observedAt || !p.windows.length))) throw new Error("usage")
      p.windows.forEach(function(w) {
        if (!object(w) || !text(w.id, 87) || !text(w.title, 80) || !number(w.used, 1e6)
            || !number(w.resetAt, 8640000000000000) || !number(w.durationMs, 31622400000)) throw new Error("window")
      })
    }
  })
  return doc
}
