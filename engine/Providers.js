// Shared selection rules. The catalog is bundled; preferences contain only IDs.
function find(items, id) {
  for (var i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return items[i]
  return null
}

function catalog(raw) {
  try {
    var items = JSON.parse(raw).providers, seen = []
    if (!Array.isArray(items) || !items.length || items.length > 20) return []
    for (var i = 0; i < items.length; i++) {
      var p = items[i]
      if (!p || typeof p.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(p.id)
          || seen.indexOf(p.id) >= 0 || typeof p.name !== "string" || typeof p.shortName !== "string"
          || typeof p.icon !== "string" || !/^[a-z0-9-]+\.svg$/.test(p.icon)
          || typeof p.headline !== "string" || !Array.isArray(p.warningWindows)) return []
      seen.push(p.id)
    }
    return items
  } catch (e) { return [] }
}

function entry(config, id) {
  var layout = config && config.bar && config.bar.layout ? config.bar.layout : {}
  var groups = [layout.left, layout.center, layout.right, config ? config.plugins : []]
  for (var i = 0; i < groups.length; i++) {
    var match = find(Array.isArray(groups[i]) ? groups[i] : [], id)
    if (match) return match
  }
  return {}
}

// `omarchy bar set` stores unquoted values as strings; the settings UI stores
// real types. Accept both.
function boolOf(value, fallback) { return typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback }
function intOf(value) {
  if (typeof value === "string" && /^-?\d{1,6}$/.test(value)) value = parseInt(value, 10)
  return Number.isInteger(value) ? value : null
}

function normalize(items, raw) {
  raw = raw || {}
  var order = [], modes = {}, requested = Array.isArray(raw.providerOrder) && raw.providerOrder.length <= 20 ? raw.providerOrder : []
  requested.concat(items.map(function(p) { return p.id })).forEach(function(id) {
    if (find(items, id) && order.indexOf(id) < 0) order.push(id)
  })
  order.forEach(function(id) {
    var p = raw.providers && raw.providers[id]
    var mode = p && p.display
    mode = ["off", "panel", "bar"].indexOf(mode) >= 0 ? mode : "bar"
    // Retain the top-bar choice while disabled; legacy display values still work.
    modes[id] = {display: mode, showInBar: mode === "off" ? boolOf(p.showInBar, true) : mode === "bar"}
  })
  var position = intOf(raw.costPosition)
  return {providerOrder: order, providers: modes, showCosts: boolOf(raw.showCosts, true), costPosition: position === null ? 0 : Math.max(0, Math.min(order.length, position))}
}

function selected(items, preferences, barOnly, costsOnly) {
  return preferences.providerOrder.filter(function(id) {
    var mode = preferences.providers[id].display, p = find(items, id)
    return p && mode !== "off" && (!barOnly || mode === "bar") && (!costsOnly || p.costs === true)
  })
}

function mergedEntry(existing, preferences) {
  return Object.assign({}, existing, preferences)
}

// Cost is a panel section, never a provider or a collector ID.
function panelOrder(preferences) {
  var order = preferences.providerOrder.slice()
  order.splice(preferences.costPosition || 0, 0, "cost")
  return order
}

// Move relative to an ID so refreshes and hidden providers cannot change the target.
function reordered(preferences, id, targetId, after) {
  var next = JSON.parse(JSON.stringify(preferences)), order = panelOrder(next)
  if (id === targetId || order.indexOf(id) < 0 || order.indexOf(targetId) < 0) return next
  order.splice(order.indexOf(id), 1)
  order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, id)
  next.providerOrder = order.filter(function(value) { return value !== "cost" })
  next.costPosition = order.indexOf("cost")
  return next
}
