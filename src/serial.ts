export interface IMUReading {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    gxRaw: number;
    gyRaw: number;
    gzRaw: number;
    mx: number;
    my: number;
    mz: number;
}

const SYNC1 = 0xaa;
const SYNC2 = 0xff;
const DATA_BYTES = 18;

const enum State {
    SYNC1,
    SYNC2,
    DATA,
}

export class SerialConnection {
    private port: any = null;
    private parser: BinaryParser;
    private onData: (data: IMUReading) => void;
    private portPath: string;
    private baudRate: number;
    private scale = { accel: 1, gyro: 1, mag: 1 };

    constructor(portPath: string, baudRate: number, onData: (data: IMUReading) => void) {
        this.portPath = portPath;
        this.baudRate = baudRate;
        this.onData = onData;
        this.parser = new BinaryParser((buf) => this.emit(buf));
    }

    async open() {
        const { SerialPort } = await import('serialport');
        this.port = new SerialPort({ path: this.portPath, baudRate: this.baudRate });
        this.port.on('data', (chunk: Buffer) => {
            this.parser.feed(chunk);
        });
        return new Promise<void>((resolve, reject) => {
            this.port.on('open', () => resolve());
            this.port.on('error', (err: Error) => reject(err));
        });
    }

    async close() {
        if (this.port && this.port.isOpen) {
            return new Promise<void>((resolve) => {
                this.port.close(() => resolve());
            });
        }
    }

    setScale(gyroSens: number) {
        this.scale.gyro = 1 / gyroSens;
    }

    private emit(buf: Buffer) {
        const reading: IMUReading = {
            ax: -buf.readInt16LE(0) * this.scale.accel,
            ay: buf.readInt16LE(2) * this.scale.accel,
            az: buf.readInt16LE(4) * this.scale.accel,
            gx: buf.readInt16LE(6) * this.scale.gyro,
            gy: -buf.readInt16LE(8) * this.scale.gyro,
            gz: -buf.readInt16LE(10) * this.scale.gyro,
            gxRaw: buf.readInt16LE(6),
            gyRaw: buf.readInt16LE(8),
            gzRaw: buf.readInt16LE(10),
            mx: buf.readInt16LE(12) * this.scale.mag,
            my: buf.readInt16LE(14) * this.scale.mag,
            mz: buf.readInt16LE(16) * this.scale.mag,
        };
        this.onData(reading);
    }
}

class BinaryParser {
    private state: State = State.SYNC1;
    private buf = Buffer.alloc(DATA_BYTES);
    private idx = 0;
    private onPacket: (buf: Buffer) => void;

    constructor(onPacket: (buf: Buffer) => void) {
        this.onPacket = onPacket;
    }

    feed(chunk: Buffer) {
        for (const byte of chunk) {
            switch (this.state) {
                case State.SYNC1:
                    if (byte === SYNC1) { this.state = State.SYNC2; }
                    break;
                case State.SYNC2:
                    if (byte === SYNC2) {
                        this.state = State.DATA;
                        this.idx = 0;
                    } else if (byte !== SYNC1) {
                        this.state = State.SYNC1;
                    }
                    break;
                case State.DATA:
                    this.buf[this.idx++] = byte;
                    if (this.idx === DATA_BYTES) {
                        this.onPacket(Buffer.from(this.buf));
                        this.state = State.SYNC1;
                    }
                    break;
            }
        }
    }
}
