import * as vscode from 'vscode';
import { SerialConnection } from './serial';
import { getWebviewContent } from './webview';

export function activate(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('imuViewer.open', () => {
        IMUViewerPanel.createOrShow(context.extensionUri);
    });
    context.subscriptions.push(command);
}

class IMUViewerPanel {
    public static currentPanel: IMUViewerPanel | undefined;
    private static readonly viewType = 'imuViewer';

    private readonly panel: vscode.WebviewPanel;
    private serial: SerialConnection | null = null;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (IMUViewerPanel.currentPanel) {
            IMUViewerPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            IMUViewerPanel.viewType,
            'IMU Orientation Viewer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
            }
        );

        IMUViewerPanel.currentPanel = new IMUViewerPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.panel.webview.html = getWebviewContent(this.panel.webview, extensionUri);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            null,
            this.disposables
        );
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
            case 'reset':
                break;
        }
    }

    private async listPorts() {
        try {
            const { SerialPort } = await import('serialport');
            const ports = await SerialPort.list();
            this.panel.webview.postMessage({
                command: 'portList',
                ports: ports.map(p => ({
                    path: p.path,
                    manufacturer: p.manufacturer || '',
                    vendorId: p.vendorId || '',
                    productId: p.productId || '',
                })),
            });
        } catch (e: any) {
            this.panel.webview.postMessage({
                command: 'error',
                message: `Failed to list ports: ${e.message}`,
            });
        }
    }

    private async connect(port: string, baudRate: number) {
        try {
            await this.disconnect();
            this.serial = new SerialConnection(port, baudRate, (data) => {
                this.panel.webview.postMessage({ command: 'imuData', data });
            });
            await this.serial.open();
            this.panel.webview.postMessage({ command: 'connected' });
        } catch (e: any) {
            this.panel.webview.postMessage({
                command: 'error',
                message: `Connection failed: ${e.message}`,
            });
        }
    }

    private async disconnect() {
        if (this.serial) {
            await this.serial.close();
            this.serial = null;
            this.panel.webview.postMessage({ command: 'disconnected' });
        }
    }

    private dispose() {
        IMUViewerPanel.currentPanel = undefined;
        this.disconnect();
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}

export function deactivate() {}
