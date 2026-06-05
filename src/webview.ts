import * as vscode from 'vscode';

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const mediaUri = vscode.Uri.joinPath(extensionUri, 'dist', 'media');
    const threeJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'lib', 'three.module.js'));
    const orbitJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'lib', 'OrbitControls.js'));
    const chartJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'lib', 'chart.umd.min.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'css', 'style.css'));
    const mainJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'js', 'main.js'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>IMU Orientation Viewer</title>
    <script nonce="${nonce}" type="importmap">
    {
        "imports": {
            "three": "${threeJs}",
            "three/addons/controls/OrbitControls.js": "${orbitJs}"
        }
    }
    </script>
    <script nonce="${nonce}" src="${chartJs}"></script>
</head>
<body>
    <div id="app">
        <header id="header">
            <div id="title-bar">
                <div id="title-left">
                    <h1>IMU Orientation Viewer</h1>
                </div>
                <div id="controls">
                    <label for="port-select">Port</label>
                    <select id="port-select"><option value="">--</option></select>
                    <label for="baud-select">Baud</label>
                    <select id="baud-select">
                        <option value="9600">9600</option>
                        <option value="57600">57600</option>
                        <option value="115200" selected>115200</option>
                        <option value="230400">230400</option>
                        <option value="460800">460800</option>
                        <option value="921600">921600</option>
                    </select>
                    <label for="gyro-range">Gyro</label>
                    <select id="gyro-range">
                        <option value="16.4">2000 dps</option>
                        <option value="32.8">1000 dps</option>
                        <option value="65.5" selected>500 dps</option>
                        <option value="131">250 dps</option>
                        <option value="262.4">125 dps</option>
                    </select>
                    <button id="connect-btn" class="btn-primary">Connect</button>
                    <button id="demo-btn" class="btn-secondary">Demo Mode</button>
                    <button id="reset-btn" class="btn-ghost">Reset</button>
                </div>
            </div>

            <div id="status-bar">
                <label for="filter-select">Filter</label>
                <select id="filter-select">
                    <option value="simple">Accel Only</option>
                    <option value="complementary">Complementary</option>
                    <option value="madgwick">Madgwick</option>
                    <option value="ekf" selected>EKF</option>
                </select>
                <span class="sep">|</span>
                <span id="status"><span class="dot idle" id="status-dot"></span><span id="status-text">Disconnected</span></span>
                <span class="sep">|</span>
                <span>Rate: <strong id="rate-display">0 Hz</strong></span>
            </div>
        </header>

        <main id="main">
            <section id="viewer-panel">
                <div id="viewer-label">3D Orientation</div>
                <div id="viewer-hint">Drag to orbit &middot; Scroll to zoom</div>
                <canvas id="three-canvas"></canvas>
                <div id="euler-overlay">
                    <div class="euler-row"><span class="euler-label">Roll</span><span id="roll-val" class="euler-val">0.0</span></div>
                    <div class="euler-row"><span class="euler-label">Pitch</span><span id="pitch-val" class="euler-val">0.0</span></div>
                    <div class="euler-row"><span class="euler-label">Yaw</span><span id="yaw-val" class="euler-val">0.0</span></div>
                </div>
            </section>

            <aside id="charts-panel">
                <div class="chart-card">
                    <div class="chart-title">
                        <span>Accelerometer</span>
                        <span class="chart-unit">raw LSB</span>
                    </div>
                    <div class="chart-wrap"><canvas id="accel-chart"></canvas></div>
                    <div class="chart-legend">
                        <span class="leg" style="--c:#ff4757">ax</span>
                        <span class="leg" style="--c:#2ed573">ay</span>
                        <span class="leg" style="--c:#1e90ff">az</span>
                    </div>
                    <div class="chart-stats" id="accel-stats">ax  --&#10;ay  --&#10;az  --</div>
                </div>

                <div class="chart-card">
                    <div class="chart-title">
                        <span>Gyroscope</span>
                        <span class="chart-unit">raw LSB</span>
                    </div>
                    <div class="chart-wrap"><canvas id="gyro-chart"></canvas></div>
                    <div class="chart-legend">
                        <span class="leg" style="--c:#ff6b81">gx</span>
                        <span class="leg" style="--c:#7bed9f">gy</span>
                        <span class="leg" style="--c:#70a1ff">gz</span>
                    </div>
                    <div class="chart-stats" id="gyro-stats">gx  --&#10;gy  --&#10;gz  --</div>
                </div>

                <div class="chart-card">
                    <div class="chart-title">
                        <span>Orientation</span>
                        <span class="chart-unit">deg</span>
                    </div>
                    <div class="chart-wrap"><canvas id="orient-chart"></canvas></div>
                    <div class="chart-legend">
                        <span class="leg" style="--c:#ffa502">Roll</span>
                        <span class="leg" style="--c:#00d2d3">Pitch</span>
                        <span class="leg" style="--c:#ff6bcb">Yaw</span>
                    </div>
                </div>
            </aside>
        </main>
    </div>
    <script nonce="${nonce}" type="module" src="${mainJs}"></script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
