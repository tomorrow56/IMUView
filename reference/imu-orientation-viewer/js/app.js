import { SimpleFilter, ComplementaryFilter, MadgwickFilter, EKFFilter } from './filters.js';
import { SerialManager }  from './serial.js';
import { IMUVisualizer }  from './visualizer.js';
import { RealtimeCharts, MagCalChart } from './charts.js';

const DEG2RAD = Math.PI / 180;
const CHART_THROTTLE_MS = 33; // ~30 fps chart updates
const STAT_WINDOW_MS    = 5000; // rolling window for mean/std


class App {
    constructor() {
        this.filter   = new EKFFilter();
        this.lastTime = null;

        this.frameCount     = 0;
        this.lastChartTime  = 0;
        this.lastStatsTime  = 0;

        this.serial   = null;
        this.visualizer = null;
        this.charts   = new RealtimeCharts();

        this.isConnected = false;
        this.isDemo      = false;
        this.simTimer    = null;
        this.simTime     = 0;
        this.magCal      = null;
        this._statBufs   = { ax: [], ay: [], az: [], gx: [], gy: [], gz: [] };
    }

    init() {
        this.charts.init();
        this.visualizer = new IMUVisualizer(document.getElementById('three-canvas'));

        const connectBtn = document.getElementById('connect-btn');
        const demoBtn    = document.getElementById('demo-btn');
        const resetBtn   = document.getElementById('reset-btn');
        const baudSel    = document.getElementById('baud-select');

        if (!('serial' in navigator)) {
            connectBtn.disabled = true;
            connectBtn.title = 'Web Serial API is not supported in this browser. Use Chrome or Edge.';
            this._setStatus('Web Serial not supported — use Chrome or Edge', 'error');
        }

        document.getElementById('gyro-range').addEventListener('change', () => {
            if (this.serial) this.serial.scale = this._getGyroScale();
        });

        connectBtn.addEventListener('click', () => {
            if (this.isConnected) {
                this._disconnect();
            } else {
                this._connect(Number(baudSel.value));
            }
        });

        demoBtn.addEventListener('click',  () => this._toggleDemo());
        resetBtn.addEventListener('click', () => this._reset());

        const magCalBtn   = document.getElementById('magcal-btn');
        const magCalPanel = document.getElementById('mag-cal-panel');
        magCalBtn.addEventListener('click', () => {
            const open = magCalPanel.classList.toggle('hidden') === false;
            magCalBtn.textContent = open ? 'Hide Mag Cal' : 'Mag Cal';
            if (open && !this.magCal) {
                this.magCal = new MagCalChart(['mag-cal-0', 'mag-cal-1', 'mag-cal-2']);
            }
        });
        document.getElementById('magcal-clear-btn').addEventListener('click', () => this.magCal?.clear());

        document.getElementById('filter-select').addEventListener('change', e => {
            this._setFilter(e.target.value);
        });

        // Help modal
        const helpModal    = document.getElementById('help-modal');
        const helpBtn      = document.getElementById('help-btn');
        const helpCloseBtn = document.getElementById('help-close-btn');
        const openHelp  = () => helpModal.classList.remove('hidden');
        const closeHelp = () => helpModal.classList.add('hidden');
        helpBtn.addEventListener('click', openHelp);
        helpCloseBtn.addEventListener('click', closeHelp);
        helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });

        // Data-rate counter — updates every second
        setInterval(() => {
            document.getElementById('data-rate').textContent = this.frameCount;
            this.frameCount = 0;
        }, 1000);
    }

    // ── Serial connection ──────────────────────────────────────────────

    async _connect(baudRate) {
        try {
            this._stopDemo();
            this.serial = new SerialManager(d => this._onData(d));
            this.serial.scale = this._getGyroScale();
            await this.serial.connect(baudRate);
            this.isConnected = true;
            document.getElementById('connect-btn').textContent = 'Disconnect';
            this._setStatus(`Connected @ ${baudRate} baud`, 'connected');
        } catch (err) {
            if (err.name !== 'NotFoundError') {
                this._setStatus(`Connection error: ${err.message}`, 'error');
            }
            this.serial = null;
        }
    }

    async _disconnect() {
        if (this.serial) {
            await this.serial.disconnect();
            this.serial = null;
        }
        this.isConnected = false;
        document.getElementById('connect-btn').textContent = 'Connect';
        this._setStatus('Disconnected', 'disconnected');
    }

    // ── Demo / simulation ──────────────────────────────────────────────

    _toggleDemo() {
        if (this.isDemo) {
            this._stopDemo();
        } else {
            this._startDemo();
        }
    }

    _startDemo() {
        this._disconnect();
        this.isDemo  = true;
        this.simTime = 0;
        document.getElementById('demo-btn').textContent = 'Stop Demo';
        this._setStatus('Demo mode — simulated IMU with gyro bias & noise', 'connected');

        // 50 Hz simulation
        this.simTimer = setInterval(() => {
            this.simTime += 0.02;
            this._onData(this._simData(this.simTime));
        }, 20);
    }

    _stopDemo() {
        if (this.simTimer) {
            clearInterval(this.simTimer);
            this.simTimer = null;
        }
        this.isDemo = false;
        document.getElementById('demo-btn').textContent = 'Demo Mode';
        if (!this.isConnected) this._setStatus('Disconnected', 'disconnected');
    }

    /**
     * Generate realistic-looking IMU data from a known smooth trajectory.
     * Adds Gaussian-ish noise and a constant gyro bias so the Kalman filter
     * has something meaningful to do.
     */
    _simData(t) {
        const rollTrue  = 40 * Math.sin(0.45 * t);
        const pitchTrue = 28 * Math.sin(0.28 * t + 1.1);
        const rollR  = rollTrue  * DEG2RAD;
        const pitchR = pitchTrue * DEG2RAD;

        // Gravity vector in body frame
        const g  = 9.81;
        const ax = -g * Math.sin(pitchR);
        const ay =  g * Math.cos(pitchR) * Math.sin(rollR);
        const az =  g * Math.cos(pitchR) * Math.cos(rollR);

        // True angular rates (time-derivative of angles)
        const rollRate  = 40 * 0.45 * Math.cos(0.45 * t);
        const pitchRate = 28 * 0.28 * Math.cos(0.28 * t + 1.1);
        const yawRate   = 12; // constant slow yaw

        const n = (s) => (Math.random() + Math.random() + Math.random() - 1.5) * s; // ~normal

        return {
            ax: ax + n(0.4),
            ay: ay + n(0.4),
            az: az + n(0.4),
            gx: rollRate  + 0.6 + n(1.5),   // 0.6 deg/s bias
            gy: pitchRate - 0.4 + n(1.5),
            gz: yawRate   + 0.2 + n(1.0),
        };
    }

    // ── Core data pipeline ─────────────────────────────────────────────

    _onData(imu) {
        const now = performance.now();
        const dt  = this.lastTime
            ? Math.min((now - this.lastTime) / 1000, 0.1)
            : 0.02;
        this.lastTime = now;

        const orientation = this.filter.update(imu, dt);

        this.visualizer.updateOrientation(orientation.roll, orientation.pitch, orientation.yaw);

        // Push to stat buffers and trim entries older than the window
        const sb = this._statBufs;
        for (const [buf, v] of [
            [sb.ax, imu.ax], [sb.ay, imu.ay], [sb.az, imu.az],
            [sb.gx, imu.gxRaw ?? imu.gx],
            [sb.gy, imu.gyRaw ?? imu.gy],
            [sb.gz, imu.gzRaw ?? imu.gz],
        ]) {
            buf.push({ v, t: now });
            while (buf[0]?.t < now - STAT_WINDOW_MS) buf.shift();
        }

        if (now - this.lastChartTime >= CHART_THROTTLE_MS) {
            this.lastChartTime = now;
            this.charts.update(imu, orientation);
        }

        if (now - this.lastStatsTime >= 500) {
            this.lastStatsTime = now;
            this._updateStats();
        }

        document.getElementById('roll-val').textContent  = orientation.roll.toFixed(1);
        document.getElementById('pitch-val').textContent = orientation.pitch.toFixed(1);
        document.getElementById('yaw-val').textContent   = orientation.yaw.toFixed(1);

        if (this.magCal && imu.mx != null &&
            !document.getElementById('mag-cal-panel').classList.contains('hidden')) {
            this.magCal.push(imu.mx, imu.my, imu.mz);
        }

        this.frameCount++;
    }

    // ── Filter selection ───────────────────────────────────────────────

    _setFilter(name) {
        const map = { simple: SimpleFilter, complementary: ComplementaryFilter, madgwick: MadgwickFilter, ekf: EKFFilter };
        this.filter   = new (map[name] ?? KalmanWrapper)();
        this.lastTime = null;
    }

    // ── Scale ──────────────────────────────────────────────────────────

    _getGyroScale() {
        const sens = parseFloat(document.getElementById('gyro-range').value);
        return { accel: 1, gyro: 1 / sens, mag: 1 };
    }

    // ── Helpers ────────────────────────────────────────────────────────

    _reset() {
        this.filter.reset();
        this.lastTime = null;
        this.visualizer.reset();
        document.getElementById('roll-val').textContent  = '0.0';
        document.getElementById('pitch-val').textContent = '0.0';
        document.getElementById('yaw-val').textContent   = '0.0';
        for (const b of Object.values(this._statBufs)) b.length = 0;
        document.getElementById('accel-stats').textContent = 'ax  —\nay  —\naz  —';
        document.getElementById('gyro-stats').textContent  = 'gx  —\ngy  —\ngz  —';
    }

    _updateStats() {
        const calc = buf => {
            if (!buf.length) return { m: 0, s: 0 };
            const mean = buf.reduce((a, e) => a + e.v, 0) / buf.length;
            const std  = Math.sqrt(buf.reduce((a, e) => a + (e.v - mean) ** 2, 0) / buf.length);
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
        document.getElementById('status-dot').className   = `dot ${type}`;
    }
}

const app = new App();
app.init();
