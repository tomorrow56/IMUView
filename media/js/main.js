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
        this.isDemo = false;
        this.simTimer = null;
        this.simTime = 0;
        this.chartPaused = false;
        this._statBufs = { ax: [], ay: [], az: [], gx: [], gy: [], gz: [] };
    }

    init() {
        this.charts.init();
        this.visualizer = new IMUVisualizer(document.getElementById('three-canvas'));

        window.addEventListener('message', (event) => {
            this._handleExtMessage(event.data);
        });
    }

    _handleExtMessage(msg) {
        switch (msg.command) {
            case 'imuData':
                this._onIMUData(msg.data);
                break;
            case 'startDemo':
                this._startDemo();
                break;
            case 'stopDemo':
                this._stopDemo();
                break;
            case 'setFilter':
                this._setFilter(msg.filter);
                break;
            case 'setGyroRange':
                break;
            case 'reset':
                this._reset();
                break;
            case 'chartPause':
                this.chartPaused = true;
                break;
            case 'chartResume':
                this.chartPaused = false;
                break;
            case 'chartClear':
                this.charts.clear();
                break;
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

        if (!this.chartPaused && now - this.lastChartTime > CHART_THROTTLE_MS) {
            this.lastChartTime = now;
            this.charts.update(imu, orientation);
        }

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

        this.frameCount++;
    }

    _startDemo() {
        // Clear any existing timer first (handles F5 restart without stop)
        if (this.simTimer) {
            clearInterval(this.simTimer);
            this.simTimer = null;
        }
        this.isDemo = true;
        this.simTime = 0;
        this.lastTime = null;

        const BIAS_X = 0.6, BIAS_Y = -0.4, BIAS_Z = 0.2;
        const noise = (s) => (Math.random() + Math.random() + Math.random() - 1.5) * s;

        this.simTimer = setInterval(() => {
            this.simTime += 0.02;
            const t = this.simTime;

            const rollTrue  = 40 * Math.sin(0.45 * t);
            const pitchTrue = 28 * Math.sin(0.28 * t + 1.1);
            const rollR  = rollTrue * DEG2RAD;
            const pitchR = pitchTrue * DEG2RAD;

            const g = 9.81;
            const ax = -g * Math.sin(pitchR) + noise(0.4);
            const ay =  g * Math.cos(pitchR) * Math.sin(rollR) + noise(0.4);
            const az =  g * Math.cos(pitchR) * Math.cos(rollR) + noise(0.4);

            const gx = 40 * 0.45 * Math.cos(0.45 * t) + BIAS_X + noise(1.5);
            const gy = 28 * 0.28 * Math.cos(0.28 * t + 1.1) + BIAS_Y + noise(1.5);
            const gz = 12 + BIAS_Z + noise(1.0);

            this._onIMUData({
                ax, ay, az,
                gx, gy, gz,
                gxRaw: gx * 65.5, gyRaw: gy * 65.5, gzRaw: gz * 65.5,
                mx: 0, my: 0, mz: 0,
            });
        }, 20);
    }

    _stopDemo() {
        if (!this.isDemo) return;
        clearInterval(this.simTimer);
        this.simTimer = null;
        this.isDemo = false;
    }

    _setFilter(name) {
        const map = { simple: SimpleFilter, complementary: ComplementaryFilter, madgwick: MadgwickFilter, ekf: EKFFilter };
        this.filter = new (map[name] || EKFFilter)();
        this.lastTime = null;
    }

    _reset() {
        this.filter.reset();
        this.lastTime = null;
        this.visualizer.reset();
        document.getElementById('roll-val').textContent = '0.0';
        document.getElementById('pitch-val').textContent = '0.0';
        document.getElementById('yaw-val').textContent = '0.0';
        for (const b of Object.values(this._statBufs)) b.length = 0;
        document.getElementById('accel-stats').textContent = 'ax  --\nay  --\naz  --';
        document.getElementById('gyro-stats').textContent = 'gx  --\ngy  --\ngz  --';
    }

    _updateStats() {
        const calc = buf => {
            if (!buf.length) return { m: 0, s: 0 };
            const mean = buf.reduce((a, e) => a + e.v, 0) / buf.length;
            const std = Math.sqrt(buf.reduce((a, e) => a + (e.v - mean) ** 2, 0) / buf.length);
            return { m: mean, s: std };
        };
        const fmt = (m, s) => `${m.toFixed(1)} +/- ${s.toFixed(1)}`;
        const { ax, ay, az, gx, gy, gz } = this._statBufs;
        const [sa, sb, sc] = [ax, ay, az].map(calc);
        const [sd, se, sf] = [gx, gy, gz].map(calc);
        document.getElementById('accel-stats').textContent =
            `ax  ${fmt(sa.m, sa.s)}\nay  ${fmt(sb.m, sb.s)}\naz  ${fmt(sc.m, sc.s)}`;
        document.getElementById('gyro-stats').textContent =
            `gx  ${fmt(sd.m, sd.s)}\ngy  ${fmt(se.m, se.s)}\ngz  ${fmt(sf.m, sf.s)}`;
    }
}

const app = new App();
app.init();
