// Pure quota arithmetic. Times are epoch milliseconds; usage is a fraction.
// Observation time stays fixed between refreshes. The display clock only
// advances countdowns and invalidates stale or expired observations.
var MAX_AGE_MS = 10 * 60 * 1000

function finite(value) { return typeof value === "number" && isFinite(value) }
function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)) }

function evaluate(window, observedAt, now, fresh) {
  if (!window || !fresh || !finite(observedAt) || !finite(now)
      || observedAt > now + 5000 || now - observedAt > MAX_AGE_MS) return null
  var u = window.used
  var duration = window.durationMs
  var reset = window.resetAt
  if (!finite(u) || u < 0 || (finite(reset) && reset > 0 && reset <= now)) return null
  // Match the whole-percent headline: a visible zero is already spent.
  if (Math.round(clamp(1 - u, 0, 1) * 100) === 0)
    return {status: "exhausted", projected: null, spare: 0, exhaustionAt: null, marker: null}
  if (!finite(reset) || reset <= now || !finite(duration) || duration <= 0 || u === 0) return null
  var elapsed = observedAt - (reset - duration)
  if (elapsed < Math.max(60000, duration * 0.01) || elapsed >= duration) return null
  var rate = u / elapsed
  var projected = rate * duration
  var spare = 1 - projected
  // Whole-percent usage is too coarse to extrapolate an alarm near empty.
  if (spare < 0.1 - 1e-10 && u < 0.05) return null
  return {
    status: spare >= 0.1 - 1e-10 ? "calm" : Math.round(spare * 100) >= 1 ? "caution" : "urgent",
    projected: projected,
    spare: spare,
    exhaustionAt: projected > 1 + 1e-10 ? observedAt + (1 - u) / rate : null,
    marker: clamp((now - (reset - duration)) / duration, 0, 1)
  }
}

function duration(ms) {
  if (!finite(ms) || ms <= 0) return "now"
  var m = Math.max(1, Math.ceil(ms / 60000))
  var h = Math.floor(m / 60)
  var d = Math.floor(h / 24)
  if (d) return d + "d " + (h % 24) + "h"
  if (h) return h + "h " + (m % 60) + "m"
  return m + "m"
}

function summary(result, now) {
  if (!result || result.status === "calm") return ""
  if (result.status === "exhausted") return "Limit reached"
  if (result.exhaustionAt !== null)
    return result.exhaustionAt > now ? "Limit in " + duration(result.exhaustionAt - now) : "Limit expected now"
  // With no meaningful ETA, the flame carries the warning alone.
  if (result.status === "urgent") return ""
  return "~" + Math.round(result.spare * 100) + "% spare"
}

function tooltip(result) {
  if (!result) return ""
  if (result.status === "exhausted") return "Limit reached"
  var projection = result.status === "calm"
    ? "~" + Math.round(result.spare * 100) + "% left at reset."
    : result.projected > 1
      ? "~" + Math.max(1, Math.round((result.projected - 1) * 100)) + "% over the allowance at reset."
      : "~" + Math.round(result.projected * 100) + "% used at reset."
  return projection + " Based on average use since this window began, not recent activity or additional charges."
}

function severity(window, result, now, fresh) {
  if (!window || !finite(window.used) || window.used < 0 || (window.resetAt > 0 && now >= window.resetAt)) return "none"
  if (!fresh) return "normal"
  if (result) return result.status === "calm" ? "normal" : result.status === "caution" ? "warning" : "critical"
  // A current reading with no usable reset window still has an absolute level.
  var used = Math.round(clamp(window.used, 0, 1) * 100)
  return used >= 90 ? "critical" : used >= 80 ? "warning" : "normal"
}

function marker(result) {
  return result && (result.status === "caution" || result.status === "urgent") ? result.marker : null
}
