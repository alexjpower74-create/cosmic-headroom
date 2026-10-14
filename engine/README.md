# engine/

These files are [Headroom](https://github.com/steveclarke/gnome-headroom) by Steve Clarke, copied
unchanged from the release named in `UPSTREAM`. They are the part that reads your Claude Code and
Codex usage and works out the numbers, the countdowns and the forecasts.

Do not edit them here. A fix to the engine belongs in Headroom itself; to pick up a newer release,
run `tools/engine-sync <tag>` from the repository root. `tools/engine-sync --check` (run on every
push) fails if anything in this folder differs from that release.

Headroom's licence is in `LICENSE` and its own third-party notices are in `NOTICE`.
