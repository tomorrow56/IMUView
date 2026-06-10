import * as vscode from 'vscode';
import { SerialConnection } from './serial';
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
        });
    }

    private async handleMessage(msg: any) {
        switch (msg.command) {
            case 'connect':
                await this.connect(msg.port, msg.baudRate);
                break;
            case 'disconnect':
                await this.disconnect();
                break;
            case 'listPorts':
                await this.listPorts();
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

    private async connect(port: string, baudRate: number) {
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

    private async disconnect() {
        if (this.serial) {
            await this.serial.close();
            this.serial = null;
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
    .rate { margin-left: auto; font-family: monospace; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
    <div class="section">
        <div class="section-title">Connection</div>
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
            <button id="connect-btn" class="btn-primary">Connect</button>
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
        const portSel = document.getElementById('port-select');
        const baudSel = document.getElementById('baud-select');
        const connectBtn = document.getElementById('connect-btn');
        const filterSel = document.getElementById('filter-select');
        const gyroSel = document.getElementById('gyro-range');
        const demoBtn = document.getElementById('demo-btn');
        const protocolSel = document.getElementById('protocol-select');
        let connected = false;
        let demoRunning = false;

        document.getElementById('refresh-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'listPorts' });
        });

        connectBtn.addEventListener('click', () => {
            if (connected) {
                vscode.postMessage({ command: 'disconnect' });
            } else {
                const port = portSel.value;
                if (!port) return;
                vscode.postMessage({ command: 'connect', port, baudRate: Number(baudSel.value) });
            }
        });

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
                    connectBtn.textContent = 'Disconnect';
                    break;
                case 'disconnected':
                    connected = false;
                    connectBtn.textContent = 'Connect';
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
                    connected = msg.isConnected;
                    demoRunning = msg.isDemoRunning;
                    connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
                    demoBtn.textContent = demoRunning ? 'Stop Demo' : 'Demo Mode';
                    filterSel.value = msg.filter;
                    gyroSel.value = msg.gyroRange;
                    document.getElementById('status-text').textContent = msg.statusText;
                    document.getElementById('status-dot').className = 'dot ' + msg.statusType;
                    document.getElementById('protocol-name').textContent = msg.protocolName;
                    if (msg.protocolPreset) { protocolSel.value = msg.protocolPreset; }
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
