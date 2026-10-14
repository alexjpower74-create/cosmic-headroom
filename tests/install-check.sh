#!/usr/bin/env bash
# The installer, start to finish, in a throwaway home folder: install, add to the panel, run the
# installed usage reader on sample data, remove. Nothing of yours is touched; the only thing shared
# with a normal install is the applet's build cache.
#
#   tests/install-check.sh
#
# Needs what install.sh needs (README.md, "Install"). Every result is captured and counted; the
# count decides at the end.
set -u

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# The id the installer registers with the panel. The applet has to have been built with the same one.
APP_ID="$(sed -n 's/^APP_ID=//p' "$root/install.sh")"
fixtures="$root/tests/fixtures"

# cargo and rustup keep their files in the real home folder; leave them reachable from the fake one.
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/headroom-cosmic-target}"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

passed=0
failed=0
ok() { passed=$((passed + 1)); echo "ok    $1"; }
bad() { failed=$((failed + 1)); echo "FAIL  $1"; }
check() { if [ "$1" = 0 ]; then ok "$2"; else bad "$2"; fi; }
same() { if cmp -s -- "$1" "$2"; then ok "$3"; else bad "$3"; diff -- "$1" "$2" | head -n 10; fi; }

# A fresh home folder, and a system data folder that holds only what the case puts there.
fresh() {
  home="$work/$1/home"
  system="$work/$1/system"
  mkdir -p "$home" "$system/cosmic/com.system76.CosmicPanel.Panel/v1"
  bin="$home/.local/bin/cosmic-applet-headroom"
  share="$home/.local/share/headroom-cosmic"
  desktop="$home/.local/share/applications/$APP_ID.desktop"
  wings="$home/.config/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
}
installer() {
  env -u XDG_DATA_HOME -u XDG_CONFIG_HOME -u XDG_CACHE_HOME HOME="$home" XDG_DATA_DIRS="$system" \
    "$root/install.sh" "$@" > "$work/out.log" 2>&1
}
# The right-hand list of a layout file, one id per line, in order.
right_side() {
  python3 - "$1" <<'PY'
import re, sys
lists = re.findall(r'\[(.*?)\]', open(sys.argv[1]).read(), re.S)
print('\n'.join(re.findall(r'"([^"]+)"', lists[1])) if len(lists) > 1 else '')
PY
}
installed() {
  [ -x "$bin" ]; check $? "$1: the applet is installed and can run"
  count="$(grep -c -a -F "$APP_ID" "$bin")"
  [ "$count" -gt 0 ]; check $? "$1: the applet was built with the id the installer registers"
  [ -f "$desktop" ] && grep -q -x "Exec=$bin" "$desktop" && grep -q -x 'X-CosmicApplet=true' "$desktop"
  check $? "$1: the panel entry points at the applet"
  [ -f "$share/headroom-view.js" ] && [ -x "$share/collectors/headroom-collect" ] && [ -f "$share/LICENSE.headroom" ]
  check $? "$1: the usage reader, its collectors and Headroom's licence are in place"
}
removed() {
  left="$(find "$home/.local" -type f 2>/dev/null | wc -l)"
  [ "$left" = 0 ]; check $? "$1: nothing installed is left behind"
}

# 1. A panel that has never been changed: no layout file in the home folder, the system's only.
fresh stock
cp -- "$fixtures/plugins_wings.stock" "$system/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
installer --panel; check $? "stock panel: install --panel succeeds"
installed "stock panel"
first="$(right_side "$wings" 2>/dev/null | head -n 1)"
[ "$first" = "$APP_ID" ]; check $? "stock panel: Headroom is first on the right"
right_side "$wings" 2>/dev/null | tail -n +2 > "$work/after"
right_side "$fixtures/plugins_wings.stock" > "$work/before"
same "$work/before" "$work/after" "stock panel: every applet that was there is still there, in order"

# The installed usage reader, on sample data: one settled line, then it stops by itself.
line="$(env HOME="$home" timeout 60 gjs -m "$share/headroom-view.js" --demo --once 2>"$work/gjs.log")"
python3 - "$line" <<'PY'
import json, sys
doc = json.loads(sys.argv[1])
assert doc['schema'] == 1 and doc['demo'] is True and doc['footer'] == 'Sample data', doc
assert [item['id'] for item in doc['bar']] == ['claude', 'codex'], doc['bar']
assert all('%' in item['text'] for item in doc['bar']), doc['bar']
assert all(len(provider['windows']) >= 2 for provider in doc['providers']), doc['providers']
PY
check $? "stock panel: the installed usage reader prints sample data for both providers"

installer; check $? "stock panel: installing again succeeds"
grep -q 'the panel is restarting it' "$work/out.log"; check $? "stock panel: installing again restarts the applet"
first="$(right_side "$wings" | head -n 1)"
[ "$first" = "$APP_ID" ]; check $? "stock panel: Headroom is still first on the right after that"
installer --remove; check $? "stock panel: remove succeeds"
removed "stock panel"
same "$fixtures/plugins_wings.stock" "$wings" "stock panel: the layout is the system's again, byte for byte"

# 2. A panel that has been changed: its own layout file, one id per line.
fresh changed
mkdir -p "$(dirname -- "$wings")"
cp -- "$fixtures/plugins_wings.changed" "$wings"
installer --panel; check $? "changed panel: install --panel succeeds"
installed "changed panel"
first="$(right_side "$wings" | head -n 1)"
[ "$first" = "$APP_ID" ]; check $? "changed panel: Headroom is first on the right"
cp -- "$wings" "$work/added"
installer --panel; check $? "changed panel: install --panel a second time succeeds"
same "$work/added" "$wings" "changed panel: a second --panel does not add it twice"
installer --remove; check $? "changed panel: remove succeeds"
removed "changed panel"
same "$fixtures/plugins_wings.changed" "$wings" "changed panel: the layout is as it was, byte for byte"

# 3. No layout anywhere (not a COSMIC desktop): it installs, says so, and does not pretend.
fresh none
installer --panel
[ $? -ne 0 ]; check $? "no panel: --panel reports that it could not add the applet"
grep -q 'Settings > Desktop > Panel > Applets' "$work/out.log"; check $? "no panel: it says how to add it by hand"
installed "no panel"
[ ! -e "$wings" ]; check $? "no panel: no layout file is made up"
installer --remove; check $? "no panel: remove succeeds"
removed "no panel"

echo
echo "$passed passed, $failed failed"
[ "$failed" = 0 ] && [ "$passed" -gt 0 ]
