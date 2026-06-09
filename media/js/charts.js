const MAX_PTS = 250;

const BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    elements: { point: { radius: 0 }, line: { borderWidth: 1.35 } },
    plugins: {
        legend: { display: false },
        tooltip: {
            enabled: true,
            animation: false,
            displayColors: true,
            backgroundColor: 'rgba(31,35,40,0.9)',
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
            padding: 8,
            callbacks: {
                title: () => '',
                label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(2)}`,
            },
        },
    },
    scales: {
        x: { display: false },
        y: {
            grid:   { color: 'rgba(217,221,227,0.85)', lineWidth: 1 },
            ticks:  { color: '#66707c', font: { size: 11 }, maxTicksLimit: 5 },
            border: { color: '#d9dde3' },
        },
    },
};

function makeDataset(color, label) {
    return {
        label,
        data: new Array(MAX_PTS).fill(0),
        borderColor: color,
        fill: false,
        tension: 0.3,
    };
}

function buildChart(id, series) {
    const ctx = document.getElementById(id).getContext('2d');
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: new Array(MAX_PTS).fill(''),
            datasets: series.map(({ color, label }) => makeDataset(color, label)),
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
        this._colors  = [[181, 82, 82], [79, 143, 104], [79, 120, 168]];
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
                    x: { grid: { color: '#d9dde3' }, ticks: { color: '#66707c', font: { size: 11 }, maxTicksLimit: 4 } },
                    y: { grid: { color: '#d9dde3' }, ticks: { color: '#66707c', font: { size: 11 }, maxTicksLimit: 4 } },
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
        this.accel = buildChart('accel-chart', [
            { label: 'ax', color: 'rgba(181,82,82,0.88)' },
            { label: 'ay', color: '#4f8f68' },
            { label: 'az', color: 'rgba(79,120,168,0.9)' },
        ]);
        this.gyro = buildChart('gyro-chart', [
            { label: 'gx', color: 'rgba(192,107,107,0.86)' },
            { label: 'gy', color: 'rgba(109,165,124,0.9)' },
            { label: 'gz', color: 'rgba(110,143,184,0.9)' },
        ]);
        this.orient = buildChart('orient-chart', [
            { label: 'Roll', color: 'rgba(184,135,63,0.9)' },
            { label: 'Pitch', color: 'rgba(79,154,160,0.9)' },
            { label: 'Yaw', color: 'rgba(155,111,157,0.88)' },
        ]);
    }

    /** @param {{ ax,ay,az,gx,gy,gz,mx,my,mz }} imu  @param {{ roll,pitch,yaw }} orientation */
    update(imu, orientation) {
        push(this.accel,  [imu.ax, imu.ay, imu.az]);
        push(this.gyro,   [imu.gx, imu.gy, imu.gz]);
        push(this.orient, [orientation.roll, orientation.pitch, orientation.yaw]);
    }

    clear() {
        [this.accel, this.gyro, this.orient].forEach(chart => {
            chart.data.datasets.forEach(ds => { ds.data = new Array(MAX_PTS).fill(0); });
            chart.data.labels = new Array(MAX_PTS).fill('');
            chart.update('none');
        });
    }
}
