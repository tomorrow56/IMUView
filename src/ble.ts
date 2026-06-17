/**
 * ble.ts
 * Android Sensor BLE (https://github.com/tomorrow56/Android_Sensor_BLE) との
 * BLE GATT Notification 接続を担うモジュール。
 *
 * Android アプリが送信する JSON フォーマット:
 * {
 *   "timestamp": <ms>,
 *   "accelerometer": { "x": <m/s²>, "y": <m/s²>, "z": <m/s²> },
 *   "gyroscope":     { "x": <rad/s>, "y": <rad/s>, "z": <rad/s> },
 *   "magnetometer":  { "x": <μT>,   "y": <μT>,   "z": <μT>   },
 *   "gravity":       { "x": <m/s²>, "y": <m/s²>, "z": <m/s²> },
 *   "light":         { "lux": <lux> },
 *   "proximity":     { "distance": <cm> },
 *   "gps":           { "latitude": ..., "longitude": ..., ... }
 * }
 *
 * IMUView の filters.js は gx/gy/gz を deg/s として扱うため、
 * Android の rad/s → deg/s 変換 (× 180/π) をここで行う。
 */

import { IMUReading } from './protocol';

// Android Sensor BLE アプリで定義されている GATT UUID
export const BLE_SERVICE_UUID        = '0000180a-0000-1000-8000-00805f9b34fb';
export const BLE_CHARACTERISTIC_UUID = '00002a57-0000-1000-8000-00805f9b34fb';

const RAD_TO_DEG = 180 / Math.PI;

/** noble の Peripheral 型に依存しないよう最低限の型だけ定義 */
interface NoblePeripheral {
    id: string;
    advertisement: { localName?: string; serviceUuids?: string[] };
    connect(cb: (err: Error | null) => void): void;
    disconnect(cb?: (err: Error | null) => void): void;
    discoverSomeServicesAndCharacteristics(
        serviceUuids: string[],
        characteristicUuids: string[],
        cb: (err: Error | null, services: any[], characteristics: any[]) => void
    ): void;
    on(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
}

interface NobleCharacteristic {
    subscribe(cb: (err: Error | null) => void): void;
    unsubscribe(cb?: (err: Error | null) => void): void;
    on(event: 'data', listener: (data: Buffer, isNotification: boolean) => void): this;
    removeAllListeners(event?: string): this;
}

export type BleStatusCallback = (text: string, type: 'ok' | 'error' | 'idle' | 'scanning') => void;
export type BleDataCallback   = (data: IMUReading) => void;

export class BleConnection {
    private noble: any = null;
    private peripheral: NoblePeripheral | null = null;
    private characteristic: NobleCharacteristic | null = null;
    private onData: BleDataCallback;
    private onStatus: BleStatusCallback;
    private scanTimeout: ReturnType<typeof setTimeout> | null = null;
    private _connected = false;

    constructor(onData: BleDataCallback, onStatus: BleStatusCallback) {
        this.onData   = onData;
        this.onStatus = onStatus;
    }

    get isConnected(): boolean {
        return this._connected;
    }

    /** BLE スキャンを開始し、Android Sensor BLE デバイスへ自動接続する */
    async startScan(timeoutMs = 15000): Promise<void> {
        if (this._connected) {
            await this.disconnect();
        }

        // noble は動的インポートで読み込む（VS Code 拡張の外部モジュール扱い）
        if (!this.noble) {
            try {
                this.noble = await import('@abandonware/noble');
            } catch (e: any) {
                this.onStatus(`BLE library not found: ${e.message}`, 'error');
                throw e;
            }
        }

        return new Promise<void>((resolve, reject) => {
            const noble = this.noble;

            // スキャンタイムアウト
            this.scanTimeout = setTimeout(() => {
                noble.stopScanning();
                this.onStatus('BLE scan timeout: device not found', 'error');
                reject(new Error('BLE scan timeout'));
            }, timeoutMs);

            const onDiscover = async (peripheral: NoblePeripheral) => {
                const uuids = peripheral.advertisement.serviceUuids ?? [];
                const matched = uuids.some(
                    (u: string) => u.toLowerCase() === BLE_SERVICE_UUID.toLowerCase()
                );
                if (!matched) return;

                noble.stopScanning();
                noble.removeListener('discover', onDiscover);
                if (this.scanTimeout) {
                    clearTimeout(this.scanTimeout);
                    this.scanTimeout = null;
                }

                const name = peripheral.advertisement.localName ?? peripheral.id;
                this.onStatus(`Found: ${name} — connecting…`, 'scanning');

                try {
                    await this._connectPeripheral(peripheral);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };

            noble.on('discover', onDiscover);

            const startScanWhenReady = () => {
                noble.startScanning([BLE_SERVICE_UUID], false, (err: Error | null) => {
                    if (err) {
                        this.onStatus(`Scan error: ${err.message}`, 'error');
                        reject(err);
                    } else {
                        this.onStatus('Scanning for Android Sensor BLE…', 'scanning');
                    }
                });
            };

            if (noble.state === 'poweredOn') {
                startScanWhenReady();
            } else {
                noble.once('stateChange', (state: string) => {
                    if (state === 'poweredOn') {
                        startScanWhenReady();
                    } else {
                        this.onStatus(`Bluetooth not available: ${state}`, 'error');
                        reject(new Error(`Bluetooth state: ${state}`));
                    }
                });
            }
        });
    }

    /** 発見した Peripheral に接続し、Notification を開始する */
    private _connectPeripheral(peripheral: NoblePeripheral): Promise<void> {
        this.peripheral = peripheral;

        return new Promise<void>((resolve, reject) => {
            peripheral.connect((err) => {
                if (err) {
                    this.onStatus(`Connect failed: ${err.message}`, 'error');
                    return reject(err);
                }

                peripheral.on('disconnect', () => {
                    this._connected = false;
                    this.characteristic = null;
                    this.onStatus('BLE disconnected', 'idle');
                });

                peripheral.discoverSomeServicesAndCharacteristics(
                    [BLE_SERVICE_UUID],
                    [BLE_CHARACTERISTIC_UUID],
                    (err2, _services, characteristics) => {
                        if (err2 || !characteristics || characteristics.length === 0) {
                            this.onStatus(`Service discovery failed: ${err2?.message ?? 'no characteristic'}`, 'error');
                            return reject(err2 ?? new Error('Characteristic not found'));
                        }

                        const char = characteristics[0] as NobleCharacteristic;
                        this.characteristic = char;

                        char.on('data', (data: Buffer) => {
                            this._handleNotification(data);
                        });

                        char.subscribe((err3) => {
                            if (err3) {
                                this.onStatus(`Subscribe failed: ${err3.message}`, 'error');
                                return reject(err3);
                            }
                            this._connected = true;
                            const name = peripheral.advertisement.localName ?? peripheral.id;
                            this.onStatus(`BLE connected: ${name}`, 'ok');
                            resolve();
                        });
                    }
                );
            });
        });
    }

    /** BLE Notification を受信し、JSON を IMUReading に変換して onData を呼ぶ */
    private _handleNotification(data: Buffer): void {
        let json: any;
        try {
            json = JSON.parse(data.toString('utf-8'));
        } catch {
            return; // 不正な JSON は無視
        }

        const reading = androidJsonToIMUReading(json);
        if (reading) {
            this.onData(reading);
        }
    }

    /** Notification を停止し、デバイスから切断する */
    async disconnect(): Promise<void> {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }
        try { this.noble?.stopScanning(); } catch {}

        if (this.characteristic) {
            await new Promise<void>((resolve) => {
                this.characteristic!.unsubscribe(() => resolve());
            });
            this.characteristic.removeAllListeners();
            this.characteristic = null;
        }

        if (this.peripheral) {
            await new Promise<void>((resolve) => {
                this.peripheral!.disconnect(() => resolve());
            });
            this.peripheral.removeAllListeners();
            this.peripheral = null;
        }

        this._connected = false;
    }
}

/**
 * Android Sensor BLE の JSON ペイロードを IMUView の IMUReading に変換する。
 *
 * 単位変換:
 *   - 加速度 (m/s²)  → そのまま使用 (filters.js は正規化するため単位不問)
 *   - ジャイロ (rad/s) → deg/s (× 180/π)  ← filters.js が deg/s を期待
 *   - 磁気 (μT)      → そのまま使用
 */
export function androidJsonToIMUReading(json: any): IMUReading | null {
    const accel  = json?.accelerometer;
    const gyro   = json?.gyroscope;
    const mag    = json?.magnetometer;

    // 加速度とジャイロは必須
    if (!accel || !gyro) return null;

    const ax = Number(accel.x ?? 0);
    const ay = Number(accel.y ?? 0);
    const az = Number(accel.z ?? 0);

    // rad/s → deg/s
    const gxDeg = Number(gyro.x ?? 0) * RAD_TO_DEG;
    const gyDeg = Number(gyro.y ?? 0) * RAD_TO_DEG;
    const gzDeg = Number(gyro.z ?? 0) * RAD_TO_DEG;

    const mx = Number(mag?.x ?? 0);
    const my = Number(mag?.y ?? 0);
    const mz = Number(mag?.z ?? 0);

    return {
        ax, ay, az,
        gx: gxDeg,
        gy: gyDeg,
        gz: gzDeg,
        gxRaw: gxDeg,
        gyRaw: gyDeg,
        gzRaw: gzDeg,
        mx, my, mz,
    };
}
