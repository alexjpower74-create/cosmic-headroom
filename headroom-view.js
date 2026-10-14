// Headroom's numbers for the COSMIC applet, ready to draw: one JSON line on stdout each time what
// should be on screen changes (see ViewModel.js for its shape).
//
// The engine is Headroom's own, unchanged (engine/): its modules and its UsageService.js, which runs
// the collectors every five minutes. Only the drawing is the applet's. Runs from the built layout
// (build.py), where those modules carry their exports.
//
//   gjs -m headroom-view.js            keep running; a line "refresh" on stdin asks for an update,
//                                      and the end of stdin (the applet is gone) stops it
//   gjs -m headroom-view.js --once     print one settled reading and stop
//   gjs -m headroom-view.js --demo     sample data, no collection
//
// Settings: ~/.config/headroom/cosmic.json (optional; read again whenever it changes)
//   for example {"providers": ["claude"], "barWindows": ["session", "weekly"], "display": {"claude": "used"}}

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import System from 'system';

import * as Model from './Model.js';
import * as Pace from './Pace.js';
import * as Providers from './Providers.js';
import * as ViewModel from './ViewModel.js';
import {UsageService} from './UsageService.js';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const once = ARGV.includes('--once');
const forceDemo = ARGV.includes('--demo');
const configPath = GLib.getenv('HEADROOM_CONFIG') ||
    GLib.build_filenamev([GLib.get_user_config_dir(), 'headroom', 'cosmic.json']);

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

const catalog = Providers.catalog(readText(`${here}/providers.json`));
if (!catalog.length) {
    printerr('Headroom: invalid bundled catalog');
    System.exit(1);
}

const loop = new GLib.MainLoop(null, false);
let prefs = ViewModel.settings(readText(configPath), catalog);
let last = '';
let service = null;

function emit() {
    if (!service)
        return;
    const now = Date.now();
    const demo = forceDemo || prefs.demo;
    const state = {demo, updating: service.jobs.size > 0, selected: prefs.providers.length > 0,
        nextRefreshAt: Math.min(...service.deadlines.values())};
    const doc = ViewModel.view(Model, Pace, catalog, {...prefs, demo}, id => service.usage.get(id),
        ViewModel.footer(state, now), now);
    const line = JSON.stringify(doc);
    if (line !== last) {
        last = line;
        print(line);
    }
    if (once && !service.jobs.size && prefs.providers.every(id => service.usage.has(id)))
        loop.quit();
}

function configure() {
    service.configure(prefs.providers, false, forceDemo || prefs.demo);
}

service = new UsageService(here, catalog, emit);
configure();

// Settings are a small file; pick up an edit without a restart.
const configFile = Gio.File.new_for_path(configPath);
let monitor = null;
try {
    monitor = configFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', () => {
        prefs = ViewModel.settings(readText(configPath), catalog);
        configure();
        emit();
    });
} catch (e) {
    printerr(`Headroom: not watching ${configPath}: ${e.message}`);
}

if (once) {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 75, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
} else {
    const commands = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
    const next = () => {
        commands.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            let line = null;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch {}
            if (line === null) {
                loop.quit();
                return;
            }
            if (line.trim() === 'refresh')
                service.refresh();
            next();
        });
    };
    next();
}

loop.run();
monitor?.cancel();
service.destroy();
