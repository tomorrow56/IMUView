import { SimpleFilter, ComplementaryFilter, MadgwickFilter, EKFFilter } from './filters.js';
import { IMUVisualizer } from './visualizer.js';
import { RealtimeCharts } from './charts.js';

const vscode = acquireVsCodeApi();
const DEG2RAD = Math.PI / 180;
const CHART_THROTTLE_MS = 100;
const STAT_WINDOW_MS = 5000;

class App {
    constructor() {
        this.filter = new EKFFilter();
        this.lastTime = null;
        this.frameCount = 0;
        this.lastChartTime = 0;
        this.lastStatsTime = 0;
        this.visualizer = null;
        this.charts = new RealtimeCharts();
        this.isConnected = false;
        this.isDemo = false;
        this.simTimer = null;
        this.simTime = 0;
        this._statBufs = { ax: [], ay: [], az: [], gx: [], gy: [], gz: [] };
    }

    init() {
        this.charts.init();
        this.visualizer = new IMUVisualizer(document.getElementById('three-canvas'));

        const connectBtn = document.getElementById('connect-btn');
        const demoBtn = document.getElementById('demo-btn');
        const resetBtn = document.getElementById('reset-btn');
        const portSel = document.getElementById('port-select');
        const baudSel = document.getElementById('baud-select');

        connectBtn.addEventListener('click', () => {
            if (this.isConnected) {
                vscode.postMessage({ command: 'disconnect' });
            } else {
                const port = portSel.value;
                if (!port) {
                    this._setStatus('Select a port first', 'error');
                    return;
                }
                vscode.postMessage({
                    command: 'connect',
                    port,
                    baudRate: Number(baudSel.value),
                });
            }
        });

        demoBtn.addEventListener('click', () => this._toggleDemo());
        resetBtn.addEventListener('click', () => {
            this._reset();
            vscode.postMessage({ command: 'reset' });
        });

        document.getElementById('filter-select').addEventListener('change', (e) => {
            this._setFilter(e.target.value);
        });

        // Request port list on init
        vscode.postMessage({ command: 'listPorts' });

        // Listen for messages from extension
        window.addEventListener('message', (event) => {
            this._handleExtMessage(event.data);
        });
    }

    _handleExtMessage(msg) {
        switch (msg.command) {
            case 'imuData':
                this._onIMUData(msg.data);
                break;
            case 'portList':
                this._populatePorts(msg.ports);
                break;
            case 'connected':
                this.isConnected = true;
                document.getElementById('connect-btn').textContent = 'Disconnect';
                this._setStatus('Connected', 'ok');
                break;
            case 'disconnected':
                this.isConnected = false;
                document.getElementById('connect-btn').textContent = 'Connect';
                this._setStatus('Disconnected', 'idle');
                break;
            case 'error':
                this._setStatus(msg.message, 'error');
                break;
        }
    }

    _populatePorts(ports) {
        const sel = document.getElementById('port-select');
        sel.innerHTML = '<option value="">--</option>';
        for (const p of ports) {
            const opt = document.createElement('option');
            opt.value = p.path;
            opt.textContent = p.path + (p.manufacturer ? ` (${p.manufacturer})` : '');
            sel.appendChild(opt);
        }
    }

    _onIMUData(imu) {
        const now = performance.now();
        const dt = this.lastTime ? (now - this.lastTime) / 1000 : 0.02;
        this.lastTime = now;

        const orientation = this.filter.update(imu, dt);

        this.visualizer.updateOrientation(orientation.roll, orientation.pitch, orientation.yaw);
        document.getElementById('roll-val').textContent = orientation.roll.toFixed(1);
        document.getElementById('pitch-val').textContent = orientation.pitch.toFixed(1);
        document.getElementById('yaw-val').textContent = orientation.yaw.toFixed(1);

        // Throttle chart updates
        if (now - this.lastChartTime > CHART_THROTTLE_MS) {
            this.lastChartTime = now;
            this.charts.update(imu, orientation);
        }

        // Stats
        const ts = now;
        for (const k of ['ax', 'ay', 'az', 'gx', 'gy', 'gz']) {
            this._statBufs[k].push({ t: ts, v: imu[k] });
            while (this._statBufs[k].length && ts - this._statBufs[k][0].t > STAT_WINDOW_MS) {
                this._statBufs[k].shift();
            }
        }
        if (now - this.lastStatsTime > 500) {
            this.lastStatsTime = now;
            this._updateStats();
        }

        // Rate display
        this.frameCount++;
        if (this.frameCount % 50 === 0) {
            const elapsed = (now - (this._rateStart || now)) / 1000;
            if (elapsed > 0) {
                document.getElementById('rate-display').textContent =
                    Math.round(this.frameCount / elapsed) + ' Hz';
            }
            if (this.frameCount > 500) {
                this.frameCount = 0;
                this._rateStart = now;
            }
        }
        if (!this._rateStart) { this._rateStart = now; }
    }

    // ── Demo Mode ──────────────────────────────────────────────────────

    _toggleDemo() {
        if (this.isDemo) {
            clearInterval(this.simTimer);
            this.simTimer = null;
            this.isDemo = false;
            document.getElementById('demo-btn').textContent = 'Demo Mode';
            this._setStatus('Demo stopped', 'idle');
            return;
        }
        this.isDemo = true;
        this.simTime = 0;
        this.lastTime = null;
        document.getElementById('demo-btn').textContent = 'Stop Demo';
        this._setStatus('Demo running', 'ok');

        const BIAS_X = 0.5, BIAS_Y = -0.3, BIAS_Z = 0.2;
        this.simTimer = setInterval(() => {
            this.simTime += 0.02;
            const t = this.simTime;
            const gauss = () => {
                let u = 0, v = 0;
                while (u === 0) u = Math.random();
                while (v === 0) v = Math.random();
                return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
            };
            const gx = 30 * Math.sin(t * 0.7) + BIAS_X + gauss() * 0.5;
            const gy = 20 * Math.cos(t * 0.5) + BIAS_Y + gauss() * 0.5;
            const gz = 10 * Math.sin(t * 0.3) + BIAS_Z + gauss() * 0.5;

            const roll = 20 * Math.sin(t * 0.7) * DEG2RAD;
            const pitch = 15 * Math.cos(t * 0.5) * DEG2RAD;
            const cr = Math.cos(roll), sr = Math.sin(roll);
            const cp = Math.cos(pitch), sp = Math.sin(pitch);
            const ax = -sp + gauss() * 0.01;
            const ay = sr * cp + gauss() * 0.01;
            const az = cr * cp + gauss() * 0.01;

            this._onIMUData({
                ax, ay, az,
                gx, gy, gz,
                gxRaw: gx * 65.5, gyRaw: gy * 65.5, gzRaw: gz * 65.5,
                mx: 0, my: 0, mz: 0,
            });
        }, 20);
    }

    // ── Filter ─────────────────────────────────────────────────────────

    _setFilter(name) {
        const map = { simple: SimpleFilter, complementary: ComplementaryFilter, madgwick: MadgwickFilter, ekf: EKFFilter };
        this.filter = new (map[name] || EKFFilter)();
        this.lastTime = null;
    }

    // ── Helpers ────────────────────────────────────────────────────────

    _reset() {
        this.filter.reset();
        this.lastTime = null;
        this.visualizer.reset();
        document.getElementById('roll-val').textContent = '0.0';
        document.getElementById('pitch-val').textContent = '0.0';
        document.getElementById('yaw-val').textContent = '0.0';
        for (const b of Object.values(this._statBufs)) b.length = 0;
        document.getElementById('accel-stats').textContent = 'ax  —\nay  —\naz  —';
        document.getElementById('gyro-stats').textContent = 'gx  —\ngy  —\ngz  —';
    }

    _updateStats() {
        const calc = buf => {
            if (!buf.length) return { m: 0, s: 0 };
            const mean = buf.reduce((a, e) => a + e.v, 0) / buf.length;
            const std = Math.sqrt(buf.reduce((a, e) => a + (e.v - mean) ** 2, 0) / buf.length);
            return { m: mean, s: std };
        };
        const fmt = (m, s) => `${m.toFixed(1)}±${s.toFixed(1)}`;
        const { ax, ay, az, gx, gy, gz } = this._statBufs;
        const [sa, sb, sc] = [ax, ay, az].map(calc);
        const [sd, se, sf] = [gx, gy, gz].map(calc);
        document.getElementById('accel-stats').textContent =
            `ax  ${fmt(sa.m, sa.s)}\nay  ${fmt(sb.m, sb.s)}\naz  ${fmt(sc.m, sc.s)}`;
        document.getElementById('gyro-stats').textContent =
            `gx  ${fmt(sd.m, sd.s)}\ngy  ${fmt(se.m, se.s)}\ngz  ${fmt(sf.m, sf.s)}`;
    }

    _setStatus(msg, type) {
        document.getElementById('status-text').textContent = msg;
        document.getElementById('status-dot').className = `dot ${type}`;
    }
}

const app = new App();
app.init();
