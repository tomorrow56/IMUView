const MAX_PTS = 250;

const BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
        x: { display: false },
        y: {
            grid:   { color: 'rgba(217,221,227,0.85)', lineWidth: 1 },
            ticks:  { color: '#66707c', font: { size: 10 }, maxTicksLimit: 5 },
            border: { color: '#d9dde3' },
        },
    },
};

function makeDataset(color) {
    return {
        data: new Array(MAX_PTS).fill(0),
        borderColor: color,
        fill: false,
        tension: 0.3,
    };
}

function buildChart(id, colors) {
    const ctx = document.getElementById(id).getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: new Array(MAX_PTS).fill(''),
            datasets: colors.map(makeDataset),
        },
        options: BASE_OPTS,
    });
}

function push(chart, values) {
    chart.data.datasets.forEach((ds, i) => {
        ds.data.push(values[i] ?? 0);
        if (ds.data.length > MAX_PTS) ds.data.shift();
    });
    chart.data.labels.push('');
    if (chart.data.labels.length > MAX_PTS) chart.data.labels.shift();
    chart.update('none');
}

export class MagCalChart {
    constructor(ids) {
        this._maxAge = 30000;
        this._minGap = 300;
        this._lastT  = 0;
        this._bufs   = [[], [], []];
        this._colors  = [[255, 71, 87], [46, 213, 115], [30, 144, 255]];
        this._labels  = [['mx', 'my'], ['my', 'mz'], ['mz', 'mx']];
        this._charts = ids.map((id, i) => this._build(id, i));
    }

    _build(id, i) {
        const ctx = document.getElementById(id).getContext('2d');
        return new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [
                { data: [], pointRadius: 2, backgroundColor: [] },
                { data: [], pointRadius: 8, pointStyle: 'cross',
                  borderColor: '#ffffff', backgroundColor: 'transparent',
                  borderWidth: 2, showLine: false },
            ] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: {
                    x: { grid: { color: '#d9dde3' }, ticks: { color: '#66707c', maxTicksLimit: 4 } },
                    y: { grid: { color: '#d9dde3' }, ticks: { color: '#66707c', maxTicksLimit: 4 } },
                },
            },
        });
    }

    push(mx, my, mz) {
        const now = performance.now();
        if (now - this._lastT < this._minGap) return;
        this._lastT = now;

        [[mx, my], [my, mz], [mz, mx]].forEach(([x, y], i) => {
            const buf = this._bufs[i];
            buf.push({ x, y, t: now });
            while (buf.length && now - buf[0].t > this._maxAge) buf.shift();

            const [r, g, b] = this._colors[i];
            const chart = this._charts[i];

            chart.data.datasets[0].data = buf;
            chart.data.datasets[0].backgroundColor = buf.map(p => {
                const a = (1 - (now - p.t) / this._maxAge).toFixed(2);
                return `rgba(${r},${g},${b},${a})`;
            });

            let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
            for (const p of buf) {
                if (p.x < xMin) xMin = p.x;
                if (p.x > xMax) xMax = p.x;
                if (p.y < yMin) yMin = p.y;
                if (p.y > yMax) yMax = p.y;
            }
            if (xMin !== Infinity) {
                const cx   = (xMin + xMax) / 2;
                const cy   = (yMin + yMax) / 2;
                const half = Math.max(xMax - xMin, yMax - yMin) / 2 * 1.2 + 1;
                chart.options.scales.x.min = cx - half;
                chart.options.scales.x.max = cx + half;
                chart.options.scales.y.min = cy - half;
                chart.options.scales.y.max = cy + half;
                chart.data.datasets[1].data = [{ x: cx, y: cy }];
                const [xl, yl] = this._labels[i];
                const el = document.getElementById(`mag-bias-${i}`);
                if (el) el.textContent = `${cx.toFixed(0)} ${xl}   ${cy.toFixed(0)} ${yl}`;
            }
            chart.update('none');
        });
    }

    clear() {
        this._bufs = [[], [], []];
        this._charts.forEach((c, i) => {
            c.data.datasets[0].data = [];
            c.data.datasets[0].backgroundColor = [];
            c.data.datasets[1].data = [];
            const el = document.getElementById(`mag-bias-${i}`);
            if (el) el.textContent = 'bias  --';
            c.update('none');
        });
    }
}

export class RealtimeCharts {
    init() {
        this.accel  = buildChart('accel-chart',  ['#ff4757', '#2ed573', '#1e90ff']);
        this.gyro   = buildChart('gyro-chart',   ['#ff6b81', '#7bed9f', '#70a1ff']);
        this.orient = buildChart('orient-chart', ['#ffa502', '#00d2d3', '#ff6bcb']);
    }

    /** @param {{ ax,ay,az,gx,gy,gz,mx,my,mz }} imu  @param {{ roll,pitch,yaw }} orientation */
    update(imu, orientation) {
        push(this.accel,  [imu.ax, imu.ay, imu.az]);
        push(this.gyro,   [imu.gx, imu.gy, imu.gz]);
        push(this.orient, [orientation.roll, orientation.pitch, orientation.yaw]);
    }
}
