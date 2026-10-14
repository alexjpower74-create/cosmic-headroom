#!/usr/bin/env python3
"""Assemble the applet's data folder; append ESM exports only to logic copies.

The same idea as Headroom's own gnome/build.py: the modules in engine/ stay exactly as Headroom
released them, and the copies that ship get their exports. Output: build/headroom/ (install.sh
puts it in ~/.local/share/headroom-cosmic and builds the applet itself with cargo).
"""
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parent
engine = root / 'engine'
stage = root / 'build' / 'headroom'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)

shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
# Headroom's own licence and third-party notices travel with its files.
shutil.copy2(engine / 'LICENSE', stage / 'LICENSE.headroom')
shutil.copy2(engine / 'NOTICE', stage / 'NOTICE')
shutil.copy2(engine / 'providers.json', stage / 'providers.json')
shutil.copy2(engine / 'gnome' / 'UsageService.js', stage / 'UsageService.js')
shutil.copy2(root / 'headroom-view.js', stage / 'headroom-view.js')

(stage / 'collectors').mkdir()
for name in ('headroom-collect', 'omarchy-agent-usage-claude', 'omarchy-agent-usage-codex'):
    shutil.copy2(engine / 'gnome' / 'collectors' / name, stage / 'collectors' / name)

# Symbolic icons: one flat colour, which the applet recolours to the panel's text colour.
(stage / 'assets').mkdir()
for icon in ('claude', 'openai'):
    svg = (engine / 'assets' / (icon + '.svg')).read_text()
    svg = re.sub(r'#[0-9a-fA-F]{6}\b', '#2e3436', svg)
    (stage / 'assets' / (icon + '-symbolic.svg')).write_text(svg)

modules = {name: engine / (name + '.js') for name in ('Model', 'Pace', 'Costs', 'Wire', 'Providers')}
modules['ViewModel'] = root / 'ViewModel.js'
for name, path in modules.items():
    text = path.read_text()
    functions = re.findall(r'^function ([A-Za-z][A-Za-z0-9_]*)\(', text, re.M)
    if not functions:
        raise ValueError('No exports found in ' + name)
    (stage / (name + '.js')).write_text(text + '\nexport { ' + ', '.join(functions) + ' };\n')

print(stage)
