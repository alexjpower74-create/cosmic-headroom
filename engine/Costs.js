function empty(ids) {
  return {observedAt: 0, providers: (ids || []).map(function(id) {
    return {id: id, state: "loading", daily: {}, message: "Reading local usage…"}
  })}
}

function dayKey(now, offset) {
  var d = new Date(now)
  d.setDate(d.getDate() + offset)
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
}

function amount(doc, id, period, now) {
  var p = doc && doc.providers.filter(function(p) { return p.id === id })[0]
  var observedAt = p && p.observedAt !== undefined ? p.observedAt : doc && doc.observedAt
  if (!p || (p.state !== "fresh" && p.state !== "partial") || typeof observedAt !== "number" || !isFinite(observedAt)
      || observedAt <= 0 || observedAt > now + 5000 || now - observedAt > 600000 || dayKey(observedAt, 0) !== dayKey(now, 0)) return null
  if (period < 2) return p.daily[dayKey(now, period === 0 ? 0 : -1)] || 0
  var sum = 0
  for (var i = 0; i < 30; i++) sum += p.daily[dayKey(now, -i)] || 0
  return sum
}

function total(doc, period, now) {
  if (!doc || !doc.providers.length) return null
  var sum = 0
  for (var i = 0; i < doc.providers.length; i++) {
    var value = amount(doc, doc.providers[i].id, period, now)
    if (value === null) return null
    sum += value
  }
  return sum
}

function message(doc, now) {
  if (!doc) return "Reading local usage…"
  for (var i = 0; i < doc.providers.length; i++) {
    var p = doc.providers[i]
    if (p.state !== "fresh" && p.state !== "partial") return p.message || "Costs unavailable · refresh to retry"
  }
  if (total(doc, 0, now) === null) return "Costs outdated · refresh to update"
  if (doc.providers.some(function(p) { return p.state === "partial" })) return "Partial estimate · some usage may be missing"
  return "Estimated local usage · USD"
}

function demo(now, mode) {
  var doc = empty(["claude", "codex"])
  doc.observedAt = now
  doc.providers.forEach(function(p, i) {
    p.state = mode === "empty" ? "unavailable" : mode === "stale" ? "stale" : "fresh"
    p.message = mode === "empty" ? "No local usage available" : mode === "stale" ? "Costs outdated · refresh to update" : ""
    p.daily[dayKey(now, 0)] = i ? 28.65 : 84.20
    p.daily[dayKey(now, -1)] = i ? 41.30 : 62.10
    p.daily[dayKey(now, -7)] = i ? 215.90 : 740.80
  })
  return doc
}
