/**
 * SerialManager — binary-only Web Serial API wrapper.
 *
 * Packet format (20 bytes):
 *   [0xAA] [0xFF]  — 2 sync bytes
 *   ax_L ax_H      — int16 LE, accelerometer X
 *   ay_L ay_H      — int16 LE, accelerometer Y
 *   az_L az_H      — int16 LE, accelerometer Z
 *   gx_L gx_H      — int16 LE, gyroscope X
 *   gy_L gy_H      — int16 LE, gyroscope Y
 *   gz_L gz_H      — int16 LE, gyroscope Z
 *   mx_L mx_H      — int16 LE, magnetometer X  (send 0 if absent)
 *   my_L my_H      — int16 LE, magnetometer Y
 *   mz_L mz_H      — int16 LE, magnetometer Z
 *
 * Set `serial.scale = { accel, gyro, mag }` with multipliers that convert
 * raw int16 → physical units (m/s², deg/s, µT).
 */

const SYNC1_BYTE = 0xAA;
const SYNC2_BYTE = 0xFF;
const DATA_BYTES = 18;          // 9 channels × 2 bytes

const S_SYNC1 = 0;
const S_SYNC2 = 1;
const S_DATA  = 2;

export class SerialManager {
    /** @param {(data: IMUReading) => void} onData */
    constructor(onData) {
        this.onData  = onData;
        this.port    = null;
        this.reader  = null;
        this.running = false;
        this.scale   = { accel: 1, gyro: 1, mag: 1 };
    }

    get isSupported() {
        return 'serial' in navigator;
    }

    async connect(baudRate = 115200) {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate });
        this.running = true;
        this._readLoop();
    }

    async disconnect() {
        this.running = false;
        try {
            if (this.reader) { await this.reader.cancel(); this.reader = null; }
        } catch { /* ignore */ }
        try {
            if (this.port?.readable) await this.port.close();
        } catch { /* ignore */ }
        this.port = null;
    }

    async _readLoop() {
        this.reader = this.port.readable.getReader();

        let state   = S_SYNC1;
        const dataBuf = new Uint8Array(DATA_BYTES);
        let dataIdx = 0;

        while (this.running) {
            let value, done;
            try {
                ({ value, done } = await this.reader.read());
            } catch { break; }
            if (done) break;

            // value is a Uint8Array chunk — process byte by byte
            for (const byte of value) {
                switch (state) {
                    case S_SYNC1:
                        if (byte === SYNC1_BYTE) state = S_SYNC2;
                        break;

                    case S_SYNC2:
                        if (byte === SYNC2_BYTE) {
                            state   = S_DATA;
                            dataIdx = 0;
                        } else if (byte !== SYNC1_BYTE) {
                            // 0xAA in SYNC2 → stay (handles 0xAA 0xAA 0xFF sequences)
                            state = S_SYNC1;
                        }
                        break;

                    case S_DATA:
                        dataBuf[dataIdx++] = byte;
                        if (dataIdx === DATA_BYTES) {
                            this._emit(dataBuf);
                            state = S_SYNC1;
                        }
                        break;
                }
            }
        }
    }

    _emit(buf) {
        const v = new DataView(buf.buffer, buf.byteOffset, DATA_BYTES);
        const { accel, gyro, mag } = this.scale;

        this.onData({
            ax: -v.getInt16(0,  true) * accel,
            ay: v.getInt16(2,  true) * accel,
            az: v.getInt16(4,  true) * accel,
            gx: v.getInt16(6,  true) * gyro,
            gy: -v.getInt16(8,  true) * gyro,
            gz: -v.getInt16(10, true) * gyro,
            gxRaw: v.getInt16(6,  true),
            gyRaw: v.getInt16(8,  true),
            gzRaw: v.getInt16(10, true),
            mx: v.getInt16(12, true) * mag,
            my: v.getInt16(14, true) * mag,
            mz: v.getInt16(16, true) * mag,
        });
    }
}
