/**
 * BLE モックサーバー
 * Android Sensor BLE アプリの代わりに PC 上で BLE ペリフェラルとして動作し、
 * IMUView (BLE セントラル) からの接続を受け付けてセンサーデータを送信します。
 *
 * 使用ライブラリ: @abandonware/bleno
 * インストール: npm install --ignore-scripts --save-dev @abandonware/bleno
 * 実行: node test/ble-mock-server.mjs
 *
 * Linux の場合は事前に以下を実行してください:
 *   sudo setcap cap_net_raw+eip $(which node)
 */

import bleno from '@abandonware/bleno';

const SERVICE_UUID        = '0000180a-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '00002a57-0000-1000-8000-00805f9b34fb';
const DEVICE_NAME         = 'AndroidSensorBLE-Mock';

// --- センサーデータ生成 ---
let t = 0;
function makeSensorJson() {
    t += 0.05;
    // 静止 + 緩やかな揺れをシミュレート
    const ax =  0.05 * Math.sin(0.3 * t);
    const ay =  0.03 * Math.cos(0.5 * t);
    const az =  9.81 + 0.02 * Math.sin(0.7 * t);
    // rad/s (Android 単位) — IMUView が deg/s に変換することを検証
    const gx =  0.01 * Math.sin(0.4 * t);
    const gy = -0.02 * Math.cos(0.3 * t);
    const gz =  0.005;
    const mx =  22.5 + 0.5 * Math.sin(0.1 * t);
    const my = -10.3 + 0.3 * Math.cos(0.1 * t);
    const mz =  45.1;
    return JSON.stringify({
        timestamp: Date.now(),
        accelerometer: { x: ax, y: ay, z: az },
        gyroscope:     { x: gx, y: gy, z: gz },
        magnetometer:  { x: mx, y: my, z: mz },
        gravity:       { x: 0,  y: 0,  z: 9.81 },
        light:         { lux: 300 },
        proximity:     { distance: 5 }
    });
}

// --- GATT Characteristic ---
class SensorCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: CHARACTERISTIC_UUID,
            properties: ['read', 'notify'],
            descriptors: [
                new bleno.Descriptor({
                    uuid: '2902',
                    value: Buffer.alloc(2)
                })
            ]
        });
        this._updateValueCallback = null;
        this._interval = null;
    }

    onReadRequest(offset, callback) {
        callback(this.RESULT_SUCCESS, Buffer.from(makeSensorJson(), 'utf-8'));
    }

    onSubscribe(maxValueSize, updateValueCallback) {
        console.log('[Mock] セントラルが Notification を購読しました');
        this._updateValueCallback = updateValueCallback;
        this._interval = setInterval(() => {
            if (this._updateValueCallback) {
                const data = Buffer.from(makeSensorJson(), 'utf-8');
                this._updateValueCallback(data);
            }
        }, 100); // 10 Hz
    }

    onUnsubscribe() {
        console.log('[Mock] セントラルが Notification を解除しました');
        clearInterval(this._interval);
        this._interval = null;
        this._updateValueCallback = null;
    }
}

// --- GATT Service ---
const sensorService = new bleno.PrimaryService({
    uuid: SERVICE_UUID,
    characteristics: [new SensorCharacteristic()]
});

// --- BLE 起動 ---
bleno.on('stateChange', (state) => {
    console.log(`[Mock] Bluetooth 状態: ${state}`);
    if (state === 'poweredOn') {
        bleno.startAdvertising(DEVICE_NAME, [SERVICE_UUID], (err) => {
            if (err) console.error('[Mock] アドバタイズ開始エラー:', err);
            else     console.log(`[Mock] アドバタイズ開始: ${DEVICE_NAME}`);
        });
    } else {
        bleno.stopAdvertising();
    }
});

bleno.on('advertisingStart', (err) => {
    if (err) { console.error('[Mock] advertisingStart エラー:', err); return; }
    bleno.setServices([sensorService], (err2) => {
        if (err2) console.error('[Mock] setServices エラー:', err2);
        else      console.log('[Mock] GATT サービス登録完了。IMUView から接続してください。');
    });
});

bleno.on('accept',     (addr) => console.log(`[Mock] 接続受付: ${addr}`));
bleno.on('disconnect', (addr) => console.log(`[Mock] 切断: ${addr}`));

console.log('[Mock] BLE モックサーバーを起動しています...');
console.log('[Mock] 終了するには Ctrl+C を押してください\n');
