import assert from 'assert';

const RAD_TO_DEG = 180 / Math.PI;

function androidJsonToIMUReading(json) {
    const accel = json?.accelerometer;
    const gyro  = json?.gyroscope;
    const mag   = json?.magnetometer;
    if (!accel || !gyro) return null;
    const ax = Number(accel.x ?? 0);
    const ay = Number(accel.y ?? 0);
    const az = Number(accel.z ?? 0);
    const gxDeg = Number(gyro.x ?? 0) * RAD_TO_DEG;
    const gyDeg = Number(gyro.y ?? 0) * RAD_TO_DEG;
    const gzDeg = Number(gyro.z ?? 0) * RAD_TO_DEG;
    const mx = Number(mag?.x ?? 0);
    const my = Number(mag?.y ?? 0);
    const mz = Number(mag?.z ?? 0);
    return { ax, ay, az, gx: gxDeg, gy: gyDeg, gz: gzDeg,
             gxRaw: gxDeg, gyRaw: gyDeg, gzRaw: gzDeg, mx, my, mz };
}

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

console.log('\n=== androidJsonToIMUReading() ユニットテスト ===\n');

test('TC-1: 正常系 (9軸)', () => {
    const json = {
        timestamp: 1000,
        accelerometer: { x: 0.12, y: -0.05, z: 9.78 },
        gyroscope:     { x: 0.1,  y: -0.2,  z: 0.05 },
        magnetometer:  { x: 22.5, y: -10.3, z: 45.1 }
    };
    const r = androidJsonToIMUReading(json);
    assert.ok(r !== null);
    assert.strictEqual(r.ax, 0.12);
    assert.strictEqual(r.ay, -0.05);
    assert.strictEqual(r.az, 9.78);
    assert.ok(Math.abs(r.gx - 0.1 * RAD_TO_DEG) < 1e-9, `gx 変換誤差: ${r.gx}`);
    assert.ok(Math.abs(r.gy - (-0.2) * RAD_TO_DEG) < 1e-9, `gy 変換誤差: ${r.gy}`);
    assert.ok(Math.abs(r.gz - 0.05 * RAD_TO_DEG) < 1e-9, `gz 変換誤差: ${r.gz}`);
    assert.strictEqual(r.mx, 22.5);
    assert.strictEqual(r.my, -10.3);
    assert.strictEqual(r.mz, 45.1);
});

test('TC-2: 磁気センサーなし (6軸)', () => {
    const json = {
        timestamp: 2000,
        accelerometer: { x: 0.0, y: 0.0, z: 9.81 },
        gyroscope:     { x: 0.0, y: 0.0, z: 0.0  }
    };
    const r = androidJsonToIMUReading(json);
    assert.ok(r !== null);
    assert.strictEqual(r.mx, 0);
    assert.strictEqual(r.my, 0);
    assert.strictEqual(r.mz, 0);
});

test('TC-3: ジャイロ π rad/s → 180 deg/s', () => {
    const json = {
        accelerometer: { x: 0, y: 0, z: 9.81 },
        gyroscope:     { x: Math.PI, y: Math.PI, z: Math.PI }
    };
    const r = androidJsonToIMUReading(json);
    assert.ok(Math.abs(r.gx - 180) < 1e-9, `期待: 180, 実際: ${r.gx}`);
    assert.ok(Math.abs(r.gy - 180) < 1e-9, `期待: 180, 実際: ${r.gy}`);
    assert.ok(Math.abs(r.gz - 180) < 1e-9, `期待: 180, 実際: ${r.gz}`);
});

test('TC-4: 静止状態 — 重力 9.81 m/s²', () => {
    const json = {
        accelerometer: { x: 0.0, y: 0.0, z: 9.81 },
        gyroscope:     { x: 0.0, y: 0.0, z: 0.0  }
    };
    const r = androidJsonToIMUReading(json);
    assert.strictEqual(r.az, 9.81);
    assert.strictEqual(r.gx, 0);
    assert.strictEqual(r.gy, 0);
    assert.strictEqual(r.gz, 0);
});

test('TC-5: 加速度フィールドなし → null', () => {
    const json = { gyroscope: { x: 0, y: 0, z: 0 } };
    assert.strictEqual(androidJsonToIMUReading(json), null);
});

test('TC-6: ジャイロフィールドなし → null', () => {
    const json = { accelerometer: { x: 0, y: 0, z: 9.81 } };
    assert.strictEqual(androidJsonToIMUReading(json), null);
});

test('TC-7: null 入力 → null', () => {
    assert.strictEqual(androidJsonToIMUReading(null), null);
});

test('TC-8: 数値が文字列型でも変換できる', () => {
    const json = {
        accelerometer: { x: '0.12', y: '-0.05', z: '9.78' },
        gyroscope:     { x: '0.1',  y: '-0.2',  z: '0.05' }
    };
    const r = androidJsonToIMUReading(json);
    assert.ok(r !== null);
    assert.strictEqual(typeof r.ax, 'number');
    assert.strictEqual(typeof r.gx, 'number');
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗\n`);
if (failed > 0) process.exit(1);
