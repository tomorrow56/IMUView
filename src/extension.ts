import * as vscode from 'vscode';
import { SerialConnection } from './serial';
import { BleConnection } from './ble';
import { getWebviewContent } from './webview';
import { ProtocolConfig, DEFAULT_PROTOCOL, PROTOCOL_PRESETS, validateProtocol } from './protocol';

export function activate(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('imuViewer.open', () => {
        IMUViewerPanel.createOrShow(context.extensionUri);
    });
    context.subscriptions.push(command);

    const sidebarProvider = new IMUSidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('imuViewer.launcher', sidebarProvider)
    );
}

// ── Sidebar: Connection + Algorithm Controls ───────────────────────────

class IMUSidebarProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private serial: SerialConnection | null = null;
    private ble: BleConnection | null = null;
    private protocol: ProtocolConfig = DEFAULT_PROTOCOL;
    private context: vscode.ExtensionContext;

    // State tracking for sync
    private isConnected = false;
    private isDemoRunning = false;
    private currentFilter = 'ekf';
    private currentGyroRange = '65.5';
    private statusText = 'Disconnected';
    private statusType = 'idle';
    private currentPreset = 'default';
    private connectionMode: 'serial' | 'ble' = 'serial';

    constructor(private readonly extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.context = context;
        this.loadSavedProtocolSync();
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

        // Auto-open editor panel when sidebar first loads
        this.ensurePanel();

        // Notify sidebar of current protocol name
        if (this.protocol.name !== DEFAULT_PROTOCOL.name) {
            webviewView.webview.postMessage({ command: 'protocolLoaded', name: this.protocol.name });
        }

        // Sync full state after HTML loads
        setTimeout(() => this.syncState(), 100);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.ensurePanel();
                this.syncState();
            }
        });
    }

    private syncState() {
        if (!this.view) return;
        this.view.webview.postMessage({
            command: 'syncState',
            isConnected: this.isConnected,
            isDemoRunning: this.isDemoRunning,
            filter: this.currentFilter,
            gyroRange: this.currentGyroRange,
            statusText: this.statusText,
            statusType: this.statusType,
            protocolName: this.protocol.name,
            protocolPreset: this.currentPreset,
            connectionMode: this.connectionMode,
        });
    }

    private async handleMessage(msg: any) {
        switch (msg.command) {
            case 'connect':
                if (msg.mode === 'ble') {
                    await this.connectBle();
                } else {
                    await this.connectSerial(msg.port, msg.baudRate);
                }
                break;
            case 'disconnect':
                await this.disconnect();
                break;
            case 'listPorts':
                await this.listPorts();
                break;
            case 'setConnectionMode':
                this.connectionMode = msg.mode;
                break;
            case 'demo':
                this.ensurePanel();
                this.isDemoRunning = true;
                IMUViewerPanel.postMessage({ command: 'startDemo', gyroRange: msg.gyroRange });
                this.sendStatus('Demo running', 'ok');
                break;
            case 'stopDemo':
                this.isDemoRunning = false;
                IMUViewerPanel.postMessage({ command: 'stopDemo' });
                this.sendStatus('Disconnected', 'idle');
                break;
            case 'setFilter':
                this.currentFilter = msg.filter;
                IMUViewerPanel.postMessage({ command: 'setFilter', filter: msg.filter });
                break;
            case 'setGyroRange':
                this.currentGyroRange = msg.value;
                IMUViewerPanel.postMessage({ command: 'setGyroRange', value: msg.value });
                if (this.serial) { this.serial.setScale(parseFloat(msg.value)); }
                break;
            case 'reset':
                IMUViewerPanel.postMessage({ command: 'reset' });
                break;
            case 'chartPause':
                IMUViewerPanel.postMessage({ command: 'chartPause' });
                break;
            case 'chartResume':
                IMUViewerPanel.postMessage({ command: 'chartResume' });
                break;
            case 'chartClear':
                IMUViewerPanel.postMessage({ command: 'chartClear' });
                break;
            case 'loadProtocol':
                await this.loadProtocolFile();
                break;
            case 'resetProtocol':
                this.protocol = DEFAULT_PROTOCOL;
                this.currentPreset = 'default';
                this.sendStatus('Protocol: default', 'ok');
                this.view?.webview.postMessage({ command: 'protocolLoaded', name: this.protocol.name, preset: 'default' });
                this.saveProtocolPath(undefined);
                break;
            case 'selectPreset':
                this.applyPreset(msg.preset);
                break;
            case 'openProtocolDoc':
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/charcoal141/IMUView#protocol'));
                break;
        }
    }

    private async listPorts() {
        if (!this.view) return;
        try {
            const { SerialPort } = await import('serialport');
            const ports = await SerialPort.list();
            this.view.webview.postMessage({
                command: 'portList',
                ports: ports.map(p => ({
                    path: p.path,
                    manufacturer: p.manufacturer || '',
                })),
            });
        } catch (e: any) {
            this.sendStatus(`Error: ${e.message}`, 'error');
        }
    }

    private async connectSerial(port: string, baudRate: number) {
        if (!this.view) return;
        try {
            await this.disconnect();
            this.ensurePanel();
            this.serial = new SerialConnection(port, baudRate, this.protocol, (data) => {
                IMUViewerPanel.postMessage({ command: 'imuData', data });
            });
            await this.serial.open();
            this.isConnected = true;
            this.sendStatus('Connected', 'ok');
            this.view.webview.postMessage({ command: 'connected' });
        } catch (e: any) {
            this.sendStatus(`Failed: ${e.message}`, 'error');
        }
    }

    private async connectBle() {
        if (!this.view) return;
        try {
            await this.disconnect();
            this.ensurePanel();

            this.ble = new BleConnection(
                (data) => {
                    IMUViewerPanel.postMessage({ command: 'imuData', data });
                },
                (text, type) => {
                    this.sendStatus(text, type);
                    if (type === 'ok') {
                        this.isConnected = true;
                        this.view?.webview.postMessage({ command: 'connected' });
                    } else if (type === 'idle') {
                        this.isConnected = false;
                        this.view?.webview.postMessage({ command: 'disconnected' });
                    }
                }
            );

            await this.ble.startScan();
        } catch (e: any) {
            this.sendStatus(`BLE failed: ${e.message}`, 'error');
            this.ble = null;
        }
    }

    private async disconnect() {
        if (this.serial) {
            await this.serial.close();
            this.serial = null;
        }
        if (this.ble) {
            await this.ble.disconnect();
            this.ble = null;
        }
        if (this.isConnected) {
            this.isConnected = false;
            this.sendStatus('Disconnected', 'idle');
            this.view?.webview.postMessage({ command: 'disconnected' });
        }
    }

    private sendStatus(text: string, type: string) {
        this.statusText = text;
        this.statusType = type;
        this.view?.webview.postMessage({ command: 'status', text, type });
    }

    private ensurePanel() {
        if (!IMUViewerPanel.currentPanel) {
            vscode.commands.executeCommand('imuViewer.open');
        }
    }

    private async loadProtocolFile() {
        const files = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Protocol JSON': ['json'] },
            title: 'Select IMU Protocol File',
        });
        if (!files || files.length === 0) return;

        try {
            const content = await vscode.workspace.fs.readFile(files[0]);
            const config = JSON.parse(Buffer.from(content).toString('utf-8'));
            const error = validateProtocol(config);
            if (error) {
                this.sendStatus(`Protocol error: ${error}`, 'error');
                return;
            }
            this.protocol = config;
            this.currentPreset = 'custom';
            if (this.serial) { this.serial.updateConfig(config); }
            this.sendStatus(`Protocol: ${config.name || 'custom'}`, 'ok');
            this.view?.webview.postMessage({ command: 'protocolLoaded', name: config.name || 'custom' });
            this.saveProtocolPath(files[0].fsPath);
        } catch (e: any) {
            this.sendStatus(`Failed to load: ${e.message}`, 'error');
        }
    }

    private applyPreset(key: string) {
        const preset = PROTOCOL_PRESETS[key];
        if (!preset) return;
        this.protocol = preset;
        this.currentPreset = key;
        if (this.serial) { this.serial.updateConfig(preset); }
        this.sendStatus(`Protocol: ${preset.name}`, 'ok');
        this.view?.webview.postMessage({ command: 'protocolLoaded', name: preset.name, preset: key });
        this.saveProtocolPath(undefined);
    }

    private loadSavedProtocolSync() {
        const savedPath = this.getSavedProtocolPath();
        if (!savedPath) return;

        try {
            const fs = require('fs');
            const content = fs.readFileSync(savedPath, 'utf-8');
            const config = JSON.parse(content);
            const error = validateProtocol(config);
            if (!error) {
                this.protocol = config;
            } else {
                this.saveProtocolPath(undefined);
            }
        } catch {
            this.saveProtocolPath(undefined);
        }
    }

    private getSavedProtocolPath(): string | undefined {
        const configPath = vscode.Uri.joinPath(this.extensionUri, '.imu-protocol-path');
        try {
            const fs = require('fs');
            const content = fs.readFileSync(configPath.fsPath, 'utf-8').trim();
            return content || undefined;
        } catch {
            return undefined;
        }
    }

    private saveProtocolPath(filePath: string | undefined) {
        const configPath = vscode.Uri.joinPath(this.extensionUri, '.imu-protocol-path');
        const fs = require('fs');
        if (filePath) {
            fs.writeFileSync(configPath.fsPath, filePath, 'utf-8');
        } else {
            try { fs.unlinkSync(configPath.fsPath); } catch {}
        }
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
<style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; overflow-x: hidden; }
    body { margin: 0; font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); font-size: 12px; padding: 14px 12px 46px; color: var(--vscode-foreground); }
    .section { margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-input-border)); }
    .section:last-of-type { border-bottom: none; }
    .section-title { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .row { display: flex; flex-direction: column; align-items: stretch; gap: 5px; margin-bottom: 12px; }
    label { font-size: 11px; color: var(--vscode-descriptionForeground); }
    select { width: 100%; max-width: 100%; min-height: 28px; padding: 4px 7px; font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
    button { min-height: 28px; padding: 5px 10px; font-size: 12px; border-radius: 4px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-ghost { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-input-border); }
    .btn-ghost:hover { background: var(--vscode-list-hoverBackground); }
    .btn-full { width: 100%; margin-top: 6px; }
    .btn-row { display: flex; gap: 8px; margin-top: 8px; }
    .btn-row button { flex: 1; min-width: 0; }
    #protocol-name { display: block; width: 100%; min-height: 24px; padding: 5px 7px; border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; gap: 7px; padding: 8px 12px; background: var(--vscode-input-background); border-top: 1px solid var(--vscode-input-border); font-size: 11px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #888; }
    .dot.ok { background: #4ec9b0; }
    .dot.error { background: #f44747; }
    .dot.idle { background: #888; }
    .dot.scanning { background: #d7ba7d; animation: blink 0.8s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .rate { margin-left: auto; font-family: monospace; color: var(--vscode-descriptionForeground); }
    /* BLE/Serial タブ */
    .mode-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .mode-tab { flex: 1; min-height: 26px; font-size: 11px; border-radius: 4px; cursor: pointer; border: 1px solid var(--vscode-input-border); background: transparent; color: var(--vscode-foreground); }
    .mode-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .mode-panel { display: none; }
    .mode-panel.active { display: block; }
    /* BLE ヒント */
    .ble-hint { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; line-height: 1.5; }
</style>
</head>
<body>
    <div class="section">
        <div class="section-title">Connection</div>

        <!-- モード切り替えタブ -->
        <div class="mode-tabs">
            <button class="mode-tab active" id="tab-serial" onclick="switchMode('serial')">Serial</button>
            <button class="mode-tab"        id="tab-ble"    onclick="switchMode('ble')">BLE</button>
        </div>

        <!-- Serial パネル -->
        <div class="mode-panel active" id="panel-serial">
            <div class="row">
                <label>Port</label>
                <select id="port-select"><option value="">--</option></select>
            </div>
            <div class="row">
                <label>Baud</label>
                <select id="baud-select">
                    <option value="9600">9600</option>
                    <option value="57600">57600</option>
                    <option value="115200" selected>115200</option>
                    <option value="230400">230400</option>
                    <option value="460800">460800</option>
                    <option value="921600">921600</option>
                </select>
            </div>
            <div class="btn-row">
                <button id="refresh-btn" class="btn-primary">Refresh</button>
                <button id="connect-serial-btn" class="btn-primary">Connect</button>
            </div>
        </div>

        <!-- BLE パネル -->
        <div class="mode-panel" id="panel-ble">
            <p class="ble-hint">
                Scans for <strong>Android Sensor BLE</strong> app automatically.<br>
                Make sure the app is advertising before connecting.
            </p>
            <div class="btn-row">
                <button id="connect-ble-btn" class="btn-primary">Scan &amp; Connect</button>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Algorithm</div>
        <div class="row">
            <label>Filter</label>
            <select id="filter-select">
                <option value="simple">Accel Only</option>
                <option value="complementary">Complementary</option>
                <option value="madgwick">Madgwick</option>
                <option value="ekf" selected>EKF</option>
            </select>
        </div>
        <div class="row">
            <label>Gyro</label>
            <select id="gyro-range">
                <option value="16.4">2000 dps</option>
                <option value="32.8">1000 dps</option>
                <option value="65.5" selected>500 dps</option>
                <option value="131">250 dps</option>
                <option value="262.4">125 dps</option>
            </select>
        </div>
        <div class="btn-row">
            <button id="reset-btn" class="btn-primary">Reset</button>
            <button id="demo-btn" class="btn-primary">Demo Mode</button>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Chart</div>
        <div class="btn-row">
            <button id="chart-pause-btn" class="btn-primary">Pause</button>
            <button id="chart-clear-btn" class="btn-primary">Clear</button>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Protocol</div>
        <div class="row">
            <label>Preset</label>
            <select id="protocol-select">
                <option value="default">Default 9-axis</option>
                <option value="mpu6050">MPU6050 6-axis</option>
                <option value="witmotion">WitMotion JY901</option>
                <option value="bmi160">BMI160 6-axis</option>
                <option value="icm20948">ICM-20948 9-axis</option>
                <option value="lsm6dsl">LSM6DSL 6-axis</option>
                <option value="ano">ANO Protocol</option>
                <option value="xsens">Xsens MTi</option>
                <option value="vectornav">VectorNav VNBIN</option>
                <option value="gpchc">GPCHC</option>
                <option value="pashr">NMEA PASHR</option>
                <option value="custom">Custom JSON...</option>
            </select>
        </div>
        <div class="row">
            <span id="protocol-name">Default Protocol</span>
        </div>
        <div class="btn-row">
            <button id="load-protocol-btn" class="btn-primary">Load Custom JSON</button>
        </div>
        <button id="protocol-doc-btn" class="btn-ghost btn-full">Protocol Description</button>
    </div>

    <div class="status">
        <span class="dot idle" id="status-dot"></span>
        <span id="status-text">Disconnected</span>
        <span class="rate" id="rate-display"></span>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const portSel   = document.getElementById('port-select');
        const baudSel   = document.getElementById('baud-select');
        const filterSel = document.getElementById('filter-select');
        const gyroSel   = document.getElementById('gyro-range');
        const demoBtn   = document.getElementById('demo-btn');
        const protocolSel = document.getElementById('protocol-select');

        let connected    = false;
        let demoRunning  = false;
        let currentMode  = 'serial'; // 'serial' | 'ble'

        // ── モード切り替え ──────────────────────────────────────────
        function switchMode(mode) {
            currentMode = mode;
            document.getElementById('tab-serial').classList.toggle('active', mode === 'serial');
            document.getElementById('tab-ble').classList.toggle('active', mode === 'ble');
            document.getElementById('panel-serial').classList.toggle('active', mode === 'serial');
            document.getElementById('panel-ble').classList.toggle('active', mode === 'ble');
            vscode.postMessage({ command: 'setConnectionMode', mode });
        }

        // ── Serial 接続 ─────────────────────────────────────────────
        document.getElementById('refresh-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'listPorts' });
        });

        document.getElementById('connect-serial-btn').addEventListener('click', () => {
            if (connected) {
                vscode.postMessage({ command: 'disconnect' });
            } else {
                const port = portSel.value;
                if (!port) return;
                vscode.postMessage({ command: 'connect', mode: 'serial', port, baudRate: Number(baudSel.value) });
            }
        });

        // ── BLE 接続 ────────────────────────────────────────────────
        document.getElementById('connect-ble-btn').addEventListener('click', () => {
            if (connected) {
                vscode.postMessage({ command: 'disconnect' });
            } else {
                vscode.postMessage({ command: 'connect', mode: 'ble' });
            }
        });

        // ── Demo ────────────────────────────────────────────────────
        demoBtn.addEventListener('click', () => {
            if (demoRunning) {
                vscode.postMessage({ command: 'stopDemo' });
                demoBtn.textContent = 'Demo Mode';
                demoRunning = false;
            } else {
                vscode.postMessage({ command: 'demo', gyroRange: gyroSel.value });
                demoBtn.textContent = 'Stop Demo';
                demoRunning = true;
            }
        });

        document.getElementById('reset-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'reset' });
        });

        filterSel.addEventListener('change', () => {
            vscode.postMessage({ command: 'setFilter', filter: filterSel.value });
        });

        gyroSel.addEventListener('change', () => {
            vscode.postMessage({ command: 'setGyroRange', value: gyroSel.value });
        });

        const chartPauseBtn = document.getElementById('chart-pause-btn');
        let chartPaused = false;
        chartPauseBtn.addEventListener('click', () => {
            chartPaused = !chartPaused;
            chartPauseBtn.textContent = chartPaused ? 'Resume' : 'Pause';
            vscode.postMessage({ command: chartPaused ? 'chartPause' : 'chartResume' });
        });

        document.getElementById('chart-clear-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'chartClear' });
        });

        protocolSel.addEventListener('change', () => {
            const val = protocolSel.value;
            if (val === 'custom') {
                vscode.postMessage({ command: 'loadProtocol' });
            } else {
                vscode.postMessage({ command: 'selectPreset', preset: val });
            }
        });

        document.getElementById('load-protocol-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'loadProtocol' });
        });

        document.getElementById('protocol-doc-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'openProtocolDoc' });
        });

        // ── メッセージ受信 ──────────────────────────────────────────
        window.addEventListener('message', (e) => {
            const msg = e.data;
            switch (msg.command) {
                case 'portList':
                    portSel.innerHTML = '<option value="">--</option>';
                    for (const p of msg.ports) {
                        const opt = document.createElement('option');
                        opt.value = p.path;
                        opt.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
                        portSel.appendChild(opt);
                    }
                    break;
                case 'connected':
                    connected = true;
                    document.getElementById('connect-serial-btn').textContent = 'Disconnect';
                    document.getElementById('connect-ble-btn').textContent    = 'Disconnect';
                    break;
                case 'disconnected':
                    connected = false;
                    document.getElementById('connect-serial-btn').textContent = 'Connect';
                    document.getElementById('connect-ble-btn').textContent    = 'Scan & Connect';
                    break;
                case 'status':
                    document.getElementById('status-text').textContent = msg.text;
                    document.getElementById('status-dot').className = 'dot ' + msg.type;
                    break;
                case 'protocolLoaded':
                    document.getElementById('protocol-name').textContent = msg.name;
                    if (msg.preset) { protocolSel.value = msg.preset; }
                    else { protocolSel.value = 'custom'; }
                    break;
                case 'syncState':
                    connected   = msg.isConnected;
                    demoRunning = msg.isDemoRunning;
                    document.getElementById('connect-serial-btn').textContent = connected ? 'Disconnect' : 'Connect';
                    document.getElementById('connect-ble-btn').textContent    = connected ? 'Disconnect' : 'Scan & Connect';
                    demoBtn.textContent = demoRunning ? 'Stop Demo' : 'Demo Mode';
                    filterSel.value = msg.filter;
                    gyroSel.value   = msg.gyroRange;
                    document.getElementById('status-text').textContent = msg.statusText;
                    document.getElementById('status-dot').className = 'dot ' + msg.statusType;
                    document.getElementById('protocol-name').textContent = msg.protocolName;
                    if (msg.protocolPreset) { protocolSel.value = msg.protocolPreset; }
                    if (msg.connectionMode) { switchMode(msg.connectionMode); }
                    break;
            }
        });

        // Request ports on load
        vscode.postMessage({ command: 'listPorts' });
    </script>
</body>
</html>`;
    }
}

// ── Editor Panel (3D + Charts only) ───────────────────────────────────

class IMUViewerPanel {
    public static currentPanel: IMUViewerPanel | undefined;
    private static readonly viewType = 'imuViewer';

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (IMUViewerPanel.currentPanel) {
            IMUViewerPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            IMUViewerPanel.viewType,
            'IMU View',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
            }
        );

        IMUViewerPanel.currentPanel = new IMUViewerPanel(panel, extensionUri);
    }

    public static postMessage(msg: any) {
        IMUViewerPanel.currentPanel?.panel.webview.postMessage(msg);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.panel.webview.html = getWebviewContent(this.panel.webview, extensionUri);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    private dispose() {
        IMUViewerPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}

export function deactivate() {}
