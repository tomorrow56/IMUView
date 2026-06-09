export interface ProtocolChannel {
    name: string;
    type: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
    endian: 'le' | 'be';
    scale?: number;
    offset?: number;
    negate?: boolean;
    role?: 'ax' | 'ay' | 'az' | 'gx' | 'gy' | 'gz' | 'mx' | 'my' | 'mz';
}

export interface ProtocolChecksum {
    type: 'sum8' | 'xor' | 'crc8' | 'crc16';
    scope?: 'data' | 'all';
}

export interface ProtocolConfig {
    name: string;
    sync: number[];
    channels: ProtocolChannel[];
    checksum?: ProtocolChecksum;
}

export const DEFAULT_PROTOCOL: ProtocolConfig = {
    name: 'Default Protocol',
    sync: [0xAA, 0xFF],
    channels: [
        { name: 'ax', type: 'int16', endian: 'le', scale: 1, negate: true, role: 'ax' },
        { name: 'ay', type: 'int16', endian: 'le', scale: 1, role: 'ay' },
        { name: 'az', type: 'int16', endian: 'le', scale: 1, role: 'az' },
        { name: 'gx', type: 'int16', endian: 'le', scale: 1, role: 'gx' },
        { name: 'gy', type: 'int16', endian: 'le', scale: 1, negate: true, role: 'gy' },
        { name: 'gz', type: 'int16', endian: 'le', scale: 1, negate: true, role: 'gz' },
        { name: 'mx', type: 'int16', endian: 'le', scale: 1, role: 'mx' },
        { name: 'my', type: 'int16', endian: 'le', scale: 1, role: 'my' },
        { name: 'mz', type: 'int16', endian: 'le', scale: 1, role: 'mz' },
    ],
};

const TYPE_SIZE: Record<string, number> = {
    int8: 1, uint8: 1,
    int16: 2, uint16: 2,
    int32: 4, uint32: 4,
    float32: 4,
};

function readValue(buf: Buffer, offset: number, ch: ProtocolChannel): number {
    const le = ch.endian === 'le';
    switch (ch.type) {
        case 'int8':    return buf.readInt8(offset);
        case 'uint8':   return buf.readUInt8(offset);
        case 'int16':   return le ? buf.readInt16LE(offset) : buf.readInt16BE(offset);
        case 'uint16':  return le ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
        case 'int32':   return le ? buf.readInt32LE(offset) : buf.readInt32BE(offset);
        case 'uint32':  return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
        case 'float32': return le ? buf.readFloatLE(offset) : buf.readFloatBE(offset);
        default:        return 0;
    }
}

export function computePacketSize(config: ProtocolConfig): number {
    let size = 0;
    for (const ch of config.channels) {
        size += TYPE_SIZE[ch.type] || 2;
    }
    return size;
}

export function computeChecksumSize(config: ProtocolConfig): number {
    if (!config.checksum) return 0;
    return config.checksum.type === 'crc16' ? 2 : 1;
}

export function computeTotalDataSize(config: ProtocolConfig): number {
    return computePacketSize(config) + computeChecksumSize(config);
}

function calcSum8(data: Buffer): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum & 0xFF;
}

function calcXor(data: Buffer): number {
    let x = 0;
    for (let i = 0; i < data.length; i++) x ^= data[i];
    return x;
}

function calcCrc8(data: Buffer): number {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
        }
    }
    return crc;
}

function calcCrc16(data: Buffer): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
        }
    }
    return crc;
}

export function verifyChecksum(fullBuf: Buffer, syncBytes: number[], config: ProtocolConfig): boolean {
    if (!config.checksum) return true;

    const dataSize = computePacketSize(config);
    const checksumSize = computeChecksumSize(config);
    const scope = config.checksum.scope || 'data';

    let target: Buffer;
    if (scope === 'all') {
        target = Buffer.concat([Buffer.from(syncBytes), fullBuf.subarray(0, dataSize)]);
    } else {
        target = fullBuf.subarray(0, dataSize);
    }

    const checksumBytes = fullBuf.subarray(dataSize, dataSize + checksumSize);

    let expected: number;
    switch (config.checksum.type) {
        case 'sum8': expected = calcSum8(target); break;
        case 'xor':  expected = calcXor(target); break;
        case 'crc8': expected = calcCrc8(target); break;
        case 'crc16': expected = calcCrc16(target); break;
        default: return true;
    }

    if (checksumSize === 2) {
        const received = checksumBytes[0] | (checksumBytes[1] << 8);
        return received === expected;
    } else {
        return checksumBytes[0] === expected;
    }
}

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
    [key: string]: number;
}

export function parsePacket(buf: Buffer, config: ProtocolConfig, gyroScale: number): IMUReading {
    const reading: IMUReading = {
        ax: 0, ay: 0, az: 0,
        gx: 0, gy: 0, gz: 0,
        gxRaw: 0, gyRaw: 0, gzRaw: 0,
        mx: 0, my: 0, mz: 0,
    };

    let offset = 0;
    for (const ch of config.channels) {
        let val = readValue(buf, offset, ch);
        offset += TYPE_SIZE[ch.type] || 2;

        if (ch.negate) val = -val;

        const raw = val;
        const scale = ch.scale ?? 1;
        val = val * scale + (ch.offset ?? 0);

        if (ch.role) {
            if (ch.role === 'gx' || ch.role === 'gy' || ch.role === 'gz') {
                reading[ch.role] = val * (1 / gyroScale);
                reading[ch.role.replace('g', 'g') + 'Raw'] = raw;
            } else {
                reading[ch.role] = val;
            }
        }
        reading[ch.name] = val;
    }

    return reading;
}

export const PROTOCOL_PRESETS: Record<string, ProtocolConfig> = {
    'default': DEFAULT_PROTOCOL,
    'mpu6050': {
        name: 'MPU6050 6-axis',
        sync: [0xAA, 0xFF],
        channels: [
            { name: 'ax', type: 'int16', endian: 'be', scale: 1, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'be', scale: 1, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'be', scale: 1, role: 'az' },
            { name: 'gx', type: 'int16', endian: 'be', scale: 1, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'be', scale: 1, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'be', scale: 1, role: 'gz' },
        ],
    },
    'witmotion': {
        name: 'WitMotion JY901',
        sync: [0x55, 0x51],
        channels: [
            { name: 'ax', type: 'int16', endian: 'le', scale: 0.0004788, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'le', scale: 0.0004788, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'le', scale: 0.0004788, role: 'az' },
            { name: 'temp', type: 'int16', endian: 'le', scale: 0.01 },
        ],
        checksum: { type: 'sum8', scope: 'all' },
    },
    'bmi160': {
        name: 'BMI160 6-axis',
        sync: [0xAA, 0x55],
        channels: [
            { name: 'gx', type: 'int16', endian: 'le', scale: 1, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'le', scale: 1, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'le', scale: 1, role: 'gz' },
            { name: 'ax', type: 'int16', endian: 'le', scale: 1, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'le', scale: 1, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'le', scale: 1, role: 'az' },
        ],
    },
    'icm20948': {
        name: 'ICM-20948 9-axis',
        sync: [0xAA, 0xFF],
        channels: [
            { name: 'ax', type: 'int16', endian: 'be', scale: 1, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'be', scale: 1, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'be', scale: 1, role: 'az' },
            { name: 'gx', type: 'int16', endian: 'be', scale: 1, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'be', scale: 1, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'be', scale: 1, role: 'gz' },
            { name: 'mx', type: 'int16', endian: 'le', scale: 1, role: 'mx' },
            { name: 'my', type: 'int16', endian: 'le', scale: 1, role: 'my' },
            { name: 'mz', type: 'int16', endian: 'le', scale: 1, role: 'mz' },
        ],
    },
    'lsm6dsl': {
        name: 'LSM6DSL 6-axis',
        sync: [0xAA, 0x5A],
        channels: [
            { name: 'gx', type: 'int16', endian: 'le', scale: 1, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'le', scale: 1, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'le', scale: 1, role: 'gz' },
            { name: 'ax', type: 'int16', endian: 'le', scale: 1, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'le', scale: 1, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'le', scale: 1, role: 'az' },
        ],
    },
    'ano': {
        name: 'ANO Protocol',
        sync: [0xAA, 0xAF],
        channels: [
            { name: 'ax', type: 'int16', endian: 'le', scale: 1, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'le', scale: 1, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'le', scale: 1, role: 'az' },
            { name: 'gx', type: 'int16', endian: 'le', scale: 1, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'le', scale: 1, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'le', scale: 1, role: 'gz' },
        ],
        checksum: { type: 'sum8', scope: 'all' },
    },
    'xsens': {
        name: 'Xsens MTi (simplified)',
        sync: [0xFA, 0xFF],
        channels: [
            { name: 'ax', type: 'float32', endian: 'be', scale: 1, role: 'ax' },
            { name: 'ay', type: 'float32', endian: 'be', scale: 1, role: 'ay' },
            { name: 'az', type: 'float32', endian: 'be', scale: 1, role: 'az' },
            { name: 'gx', type: 'float32', endian: 'be', scale: 1, role: 'gx' },
            { name: 'gy', type: 'float32', endian: 'be', scale: 1, role: 'gy' },
            { name: 'gz', type: 'float32', endian: 'be', scale: 1, role: 'gz' },
            { name: 'mx', type: 'float32', endian: 'be', scale: 1, role: 'mx' },
            { name: 'my', type: 'float32', endian: 'be', scale: 1, role: 'my' },
            { name: 'mz', type: 'float32', endian: 'be', scale: 1, role: 'mz' },
        ],
    },
    'vectornav': {
        name: 'VectorNav VN-IMU',
        sync: [0xFA, 0x01],
        channels: [
            { name: 'ax', type: 'float32', endian: 'le', scale: 1, role: 'ax' },
            { name: 'ay', type: 'float32', endian: 'le', scale: 1, role: 'ay' },
            { name: 'az', type: 'float32', endian: 'le', scale: 1, role: 'az' },
            { name: 'gx', type: 'float32', endian: 'le', scale: 1, role: 'gx' },
            { name: 'gy', type: 'float32', endian: 'le', scale: 1, role: 'gy' },
            { name: 'gz', type: 'float32', endian: 'le', scale: 1, role: 'gz' },
            { name: 'mx', type: 'float32', endian: 'le', scale: 1, role: 'mx' },
            { name: 'my', type: 'float32', endian: 'le', scale: 1, role: 'my' },
            { name: 'mz', type: 'float32', endian: 'le', scale: 1, role: 'mz' },
        ],
        checksum: { type: 'crc16', scope: 'data' },
    },
    'gpchc': {
        name: 'GPCHC (CHC Navigation)',
        sync: [0xAA, 0x55],
        channels: [
            { name: 'ax', type: 'float32', endian: 'le', scale: 1, role: 'ax' },
            { name: 'ay', type: 'float32', endian: 'le', scale: 1, role: 'ay' },
            { name: 'az', type: 'float32', endian: 'le', scale: 1, role: 'az' },
            { name: 'gx', type: 'float32', endian: 'le', scale: 1, role: 'gx' },
            { name: 'gy', type: 'float32', endian: 'le', scale: 1, role: 'gy' },
            { name: 'gz', type: 'float32', endian: 'le', scale: 1, role: 'gz' },
        ],
        checksum: { type: 'xor', scope: 'data' },
    },
    'pashr': {
        name: 'NMEA-0183 PASHR (binary)',
        sync: [0xAA, 0x44],
        channels: [
            { name: 'ax', type: 'int16', endian: 'le', scale: 0.001, role: 'ax' },
            { name: 'ay', type: 'int16', endian: 'le', scale: 0.001, role: 'ay' },
            { name: 'az', type: 'int16', endian: 'le', scale: 0.001, role: 'az' },
            { name: 'gx', type: 'int16', endian: 'le', scale: 0.01, role: 'gx' },
            { name: 'gy', type: 'int16', endian: 'le', scale: 0.01, role: 'gy' },
            { name: 'gz', type: 'int16', endian: 'le', scale: 0.01, role: 'gz' },
        ],
        checksum: { type: 'xor', scope: 'all' },
    },
};

export function validateProtocol(config: any): string | null {
    if (!config || typeof config !== 'object') return 'Protocol config must be an object';
    if (!Array.isArray(config.sync) || config.sync.length === 0) return 'sync must be a non-empty array of bytes';
    for (const b of config.sync) {
        if (typeof b !== 'number' || b < 0 || b > 255) return `Invalid sync byte: ${b}`;
    }
    if (!Array.isArray(config.channels) || config.channels.length === 0) return 'channels must be a non-empty array';
    const validTypes = Object.keys(TYPE_SIZE);
    for (let i = 0; i < config.channels.length; i++) {
        const ch = config.channels[i];
        if (!ch.name) return `Channel ${i}: missing name`;
        if (!validTypes.includes(ch.type)) return `Channel ${i} (${ch.name}): invalid type "${ch.type}"`;
        if (ch.endian && ch.endian !== 'le' && ch.endian !== 'be') return `Channel ${i} (${ch.name}): endian must be "le" or "be"`;
    }
    if (config.checksum) {
        const validChecksums = ['sum8', 'xor', 'crc8', 'crc16'];
        if (!validChecksums.includes(config.checksum.type)) {
            return `Invalid checksum type: "${config.checksum.type}". Must be one of: ${validChecksums.join(', ')}`;
        }
        if (config.checksum.scope && config.checksum.scope !== 'data' && config.checksum.scope !== 'all') {
            return `Invalid checksum scope: "${config.checksum.scope}". Must be "data" or "all"`;
        }
    }
    return null;
}
