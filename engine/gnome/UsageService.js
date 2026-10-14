import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Model from './Model.js';
import * as Costs from './Costs.js';
import * as Wire from './Wire.js';

export class UsageService {
    constructor(path, catalog, changed) {
        this.path = path;
        this.catalog = catalog;
        this.changed = changed;
        this.ids = [];
        this.costEnabled = false;
        this.demo = false;
        this.usage = new Map();
        this.cost = new Map();
        this.jobs = new Map();
        this.deadlines = new Map();
        this.disposed = false;
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this.tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    configure(ids, costEnabled, demo) {
        const modeChanged = this.demo !== demo;
        this.ids = ids;
        this.costEnabled = costEnabled;
        this.demo = demo;
        if (modeChanged) {
            this.cancelAll();
            this.usage.clear();
            this.cost.clear();
            this.deadlines.clear();
        }
        for (const [key, job] of this.jobs) {
            if (demo || !ids.includes(job.id) || (job.costs && !costEnabled)) {
                this.cancel(key);
                this.deadlines.delete(key);
            }
        }
        for (const key of this.deadlines.keys()) {
            const [kind, id] = key.split(':');
            if (!ids.includes(id) || (kind === 'cost' && !costEnabled))
                this.deadlines.delete(key);
        }
        this.tick();
    }

    setDemo() {
        if (!this.demoAt || Date.now() - this.demoAt > 300000) this.demoAt = Date.now();
        const now = this.demoAt;
        const usage = Wire.parse(JSON.stringify({schema: 1, observedAt: now,
            providers: Model.demo(now, '')}), false, this.catalog.map(p => p.id));
        const costs = Wire.parse(JSON.stringify({schema: 1, ...Costs.demo(now, '')}), true,
            this.catalog.map(p => p.id));
        for (const p of usage.providers) this.usage.set(p.id, p);
        for (const p of costs.providers) this.cost.set(p.id, {...p, observedAt: now});
    }

    tick() {
        if (this.disposed) return;
        const now = Date.now();
        if (this.demo) this.setDemo();
        else for (const id of this.ids) {
            for (const costs of this.costEnabled ? [false, true] : [false]) {
                const key = `${costs ? 'cost' : 'usage'}:${id}`;
                if (!this.jobs.has(key) && now >= (this.deadlines.get(key) || 0))
                    this.start(id, costs);
            }
        }
        this.changed();
    }

    refresh() {
        const now = Date.now();
        if (now - (this.lastManual || 0) < 20000) return;
        this.lastManual = now;
        for (const key of this.deadlines.keys())
            if (!this.jobs.has(key)) this.deadlines.delete(key);
        this.tick();
    }

    start(id, costs) {
        const key = `${costs ? 'cost' : 'usage'}:${id}`;
        this.deadlines.set(key, Date.now() + 300000);
        const job = {id, costs, process: null, timeout: 0, cancelled: false};
        this.jobs.set(key, job);
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_SILENCE});
            launcher.setenv('PATH', `${GLib.get_home_dir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`, true);
            const args = ['/bin/sh', '-c',
                'script=$1; shift; /usr/bin/python3 -I -S "$script" --parent "$$" "$@" & wait',
                'headroom', `${this.path}/collectors/headroom-collect`];
            if (costs) args.push('--costs');
            args.push('--providers', id);
            job.process = launcher.spawnv(args);
            job.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 70, () => {
                job.timeout = 0;
                this.cancel(key);
                this.failed(id, costs);
                this.changed();
                return GLib.SOURCE_REMOVE;
            });
            job.process.communicate_utf8_async(null, null, (process, result) => {
                if (job.timeout) GLib.Source.remove(job.timeout);
                job.timeout = 0;
                try {
                    const [, output] = process.communicate_utf8_finish(result);
                    if (job.cancelled || this.disposed) return;
                    if (!process.get_successful()) throw new Error('collector exit');
                    const doc = Wire.parse(output, costs, [id]);
                    if (costs) this.cost.set(id, {...doc.providers[0], observedAt: doc.observedAt});
                    else this.usage.set(id, Model.merge(this.usage.get(id), doc.providers[0]));
                } catch (_error) {
                    if (!job.cancelled && !this.disposed) this.failed(id, costs);
                } finally {
                    if (this.jobs.get(key) === job) this.jobs.delete(key);
                    if (!job.cancelled && !this.disposed) this.changed();
                }
            });
        } catch (_error) {
            this.jobs.delete(key);
            this.failed(id, costs);
        }
    }

    failed(id, costs) {
        if (costs) this.cost.set(id, {id, state: 'unavailable', daily: {}, observedAt: 0,
            message: 'Local costs unavailable · refresh to retry'});
        else this.usage.set(id, Model.merge(this.usage.get(id), {id,
            name: this.catalog.find(p => p.id === id).name, plan: '', state: 'unavailable',
            observedAt: 0, windows: [], message: 'Usage check failed · refresh to retry'}));
    }

    footer() {
        if (this.demo) return 'Sample data';
        if (this.jobs.size) return 'Updating…';
        if (!this.ids.length) return 'Updates paused';
        const deadline = Math.min(...this.deadlines.values());
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        return Number.isFinite(seconds) ? `Next update in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Next update soon';
    }

    cancel(key) {
        const job = this.jobs.get(key);
        if (!job) return;
        job.cancelled = true;
        if (job.timeout) GLib.Source.remove(job.timeout);
        job.timeout = 0;
        job.process?.force_exit();
        this.jobs.delete(key);
    }

    cancelAll() { for (const key of this.jobs.keys()) this.cancel(key); }
    destroy() {
        this.disposed = true;
        GLib.Source.remove(this.timer);
        this.cancelAll();
        this.changed = () => {};
    }
}
