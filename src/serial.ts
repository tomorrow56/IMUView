import { ProtocolConfig, IMUReading, parsePacket, computePacketSize, computeTotalDataSize, verifyChecksum } from './protocol';

const enum State {
    SYNC,
    DATA,
}

export class SerialConnection {
    private port: any = null;
    private parser: ConfigurableParser;
    private onData: (data: IMUReading) => void;
    private portPath: string;
    private baudRate: number;
    private gyroScale: number = 65.5;
    private config: ProtocolConfig;

    constructor(portPath: string, baudRate: number, config: ProtocolConfig, onData: (data: IMUReading) => void) {
        this.portPath = portPath;
        this.baudRate = baudRate;
        this.config = config;
        this.onData = onData;
        this.parser = new ConfigurableParser(config, (buf) => this.emit(buf));
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
        this.gyroScale = gyroSens;
    }

    updateConfig(config: ProtocolConfig) {
        this.config = config;
        this.parser = new ConfigurableParser(config, (buf) => this.emit(buf));
    }

    private emit(buf: Buffer) {
        const reading = parsePacket(buf, this.config, this.gyroScale);
        this.onData(reading);
    }
}

class ConfigurableParser {
    private syncBytes: number[];
    private syncIdx = 0;
    private dataSize: number;
    private state: State = State.SYNC;
    private buf: Buffer;
    private idx = 0;
    private onPacket: (buf: Buffer) => void;
    private config: ProtocolConfig;

    constructor(config: ProtocolConfig, onPacket: (buf: Buffer) => void) {
        this.syncBytes = config.sync;
        this.dataSize = computeTotalDataSize(config);
        this.buf = Buffer.alloc(this.dataSize);
        this.onPacket = onPacket;
        this.config = config;
    }

    feed(chunk: Buffer) {
        for (const byte of chunk) {
            switch (this.state) {
                case State.SYNC:
                    if (byte === this.syncBytes[this.syncIdx]) {
                        this.syncIdx++;
                        if (this.syncIdx === this.syncBytes.length) {
                            this.state = State.DATA;
                            this.idx = 0;
                            this.syncIdx = 0;
                        }
                    } else {
                        this.syncIdx = (byte === this.syncBytes[0]) ? 1 : 0;
                    }
                    break;

                case State.DATA:
                    this.buf[this.idx++] = byte;
                    if (this.idx === this.dataSize) {
                        if (verifyChecksum(this.buf, this.syncBytes, this.config)) {
                            this.onPacket(Buffer.from(this.buf));
                        }
                        this.state = State.SYNC;
                    }
                    break;
            }
        }
    }
}

export { IMUReading } from './protocol';
