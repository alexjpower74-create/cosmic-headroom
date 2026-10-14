#!/usr/bin/env bash
# Build and install Headroom for the COSMIC panel, for this user only (nothing needs sudo).
#
#   ./install.sh            build, install, and restart the applet if it is in the panel
#   ./install.sh --panel    the same, and add it to the top panel (first on the right)
#   ./install.sh --remove   take it out of the panel and delete what was installed
#
# What it needs is listed in README.md under "Install".
set -euo pipefail

APP_ID=io.github.alexjpower74_create.Headroom
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
bin="$HOME/.local/bin/cosmic-applet-headroom"
share="$data/headroom-cosmic"
desktop="$data/applications/$APP_ID.desktop"
wings="${XDG_CONFIG_HOME:-$HOME/.config}/cosmic/com.system76.CosmicPanel.Panel/v1/plugins_wings"
target="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/headroom-cosmic-target}"

in_panel() { [ -f "$wings" ] && grep -q "\"$APP_ID\"" "$wings"; }

# The panel's right-hand list is the second [ ... ] in plugins_wings. The panel re-reads the file
# when it changes and starts or stops applets to match.
panel_add() {
  in_panel && return 0
  python3 - "$wings" "$APP_ID" <<'PY'
import os, re, sys
path, app = sys.argv[1], sys.argv[2]
by_hand = '; add the applet in Settings > Desktop > Panel > Applets'
if os.path.exists(path):
    text = open(path).read()
else:
    # A panel that has never been changed has no layout file of its own: start from the system's,
    # which is what COSMIC Settings does the first time you change the panel.
    text = None
    for base in (os.environ.get('XDG_DATA_DIRS') or '/usr/local/share:/usr/share').split(':'):
        stock = os.path.join(base, 'cosmic', 'com.system76.CosmicPanel.Panel', 'v1', 'plugins_wings')
        if base and os.path.exists(stock):
            text = open(stock).read()
            break
    if text is None:
        sys.exit('Headroom is installed, but no panel layout was found to add it to' + by_hand)
opens = [m.end() for m in re.finditer(r'\[', text)]
if len(opens) < 2:
    sys.exit('Headroom is installed, but the panel layout was not recognised' + by_hand)
at = opens[1]
os.makedirs(os.path.dirname(path), exist_ok=True)
open(path, 'w').write(text[:at] + '\n    "' + app + '",' + text[at:])
PY
}

panel_remove() {
  in_panel || return 0
  python3 - "$wings" "$APP_ID" <<'PY'
import re, sys
path, app = sys.argv[1], sys.argv[2]
text = open(path).read()
open(path, 'w').write(re.sub(r'\n?[ \t]*"' + re.escape(app) + r'",?', '', text))
PY
}

if [ "${1:-}" = "--remove" ]; then
  panel_remove
  rm -f -- "$bin" "$desktop"
  rm -rf -- "${share:?}"
  echo "Headroom removed. Settings in ~/.config/headroom were left alone."
  exit 0
fi

python3 "$here/build.py" >/dev/null
(cd "$here/applet" && CARGO_TARGET_DIR="$target" cargo build --release --locked)

mkdir -p "$(dirname -- "$bin")" "$(dirname -- "$desktop")"
rm -rf -- "${share:?}"
cp -r "$here/build/headroom" "$share"
install -m 755 "$target/release/cosmic-applet-headroom" "$bin.new"
mv -f -- "$bin.new" "$bin"
cat > "$desktop" <<EOF
[Desktop Entry]
Name=Headroom
Comment=Claude Code and Codex quotas, reset countdowns and forecasts
Type=Application
Exec=$bin
Terminal=false
Categories=COSMIC;
Keywords=COSMIC;Applet;Claude;Codex;Quota;Usage;
Icon=utilities-system-monitor-symbolic
StartupNotify=true
NoDisplay=true
X-CosmicApplet=true
X-CosmicHoverPopup=Auto
EOF

if [ "${1:-}" = "--panel" ]; then
  panel_add
  echo "Headroom installed and added to the top panel."
elif in_panel; then
  # Already in the panel. The panel does not start an applet again once it has stopped, but it
  # does re-read its layout: take the applet out and put the layout back as it was (same place).
  layout="$(mktemp)"
  cat -- "$wings" > "$layout"
  panel_remove
  sleep 2
  cat -- "$layout" > "$wings"
  rm -f -- "$layout"
  echo "Headroom installed; the panel is restarting it."
else
  echo "Headroom installed. Add it with: ./install.sh --panel (or Settings > Desktop > Panel > Applets)."
fi
