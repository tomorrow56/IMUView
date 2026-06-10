# IMU View

<div align="center">
  <a href="https://github.com/whiteSHADOW1234/TypingSVG">
    <img src="https://typingsvg.vercel.app/api/svg?width=350&height=50&backgroundOpacity=0&border=false&lines=%5B%7B%22text%22%3A%22Use+and+Delete%22%2C%22fontSize%22%3A30%2C%22typingSpeed%22%3A0.1%2C%22deleteSpeed%22%3A0.05%7D%5D" alt="Typing SVG">
  </a>
</div>

<p align="center">
  <img src="screenshoot/logo.png" alt="IMU View" width="300">
</p>

[English](README.md) | [中文](README_CN.md)

Real-time IMU visualization inside VS Code. 3D orientation, live charts, 11 protocol presets — plug in your board and go.

<p align="center">
  <img src="screenshoot/picture2.gif" alt="IMU View Demo" width="600">
</p>

## Features

- **Super Lightweight** — Under 1MB packaged, instant install
- **3D Orientation** — model rotates in real-time
- **4 Fusion Algorithms** — Accel-only, Complementary, Madgwick, EKF
- **Live Charts** — Accel / Gyro / Euler angles with pause & clear
- **11 Protocol Presets** — MPU6050, WitMotion, ICM-20948, VectorNav, ANO, GPCHC, Xsens, and more
- **Custom Protocol** — Load any binary format via JSON config with checksum support
- **Serial Port** — Direct USB connection, no browser needed
- **Demo Mode** — Test without hardware

<p align="center">
  <img src="screenshoot/picture1.png" alt="IMU View Screenshot" width="800">
</p>

## Install

1. Extensions panel (`Ctrl+Shift+X`)
2. Search **"IMU View"**
3. Install

## Usage

Click the **IMU** icon in the Activity Bar. The 3D panel opens automatically.

- Select protocol preset or load custom JSON
- Pick your COM port and baud rate → Connect
- No hardware? Hit **Demo Mode**

## Protocol

Default binary packet (20 bytes):

```
[0xAA 0xFF] [ax ay az gx gy gz mx my mz] (int16 LE × 9)
```

### Default 9-axis Example

```json
{
  "name": "Default Protocol",
  "sync": [170, 255],
  "channels": [
    { "name": "ax", "type": "int16", "endian": "le", "scale": 1, "negate": true, "role": "ax" },
    { "name": "ay", "type": "int16", "endian": "le", "scale": 1, "role": "ay" },
    { "name": "az", "type": "int16", "endian": "le", "scale": 1, "role": "az" },
    { "name": "gx", "type": "int16", "endian": "le", "scale": 1, "role": "gx" },
    { "name": "gy", "type": "int16", "endian": "le", "scale": 1, "negate": true, "role": "gy" },
    { "name": "gz", "type": "int16", "endian": "le", "scale": 1, "negate": true, "role": "gz" },
    { "name": "mx", "type": "int16", "endian": "le", "scale": 1, "role": "mx" },
    { "name": "my", "type": "int16", "endian": "le", "scale": 1, "role": "my" },
    { "name": "mz", "type": "int16", "endian": "le", "scale": 1, "role": "mz" }
  ]
}
```

### Presets

| Preset | Axes | Checksum |
|--------|------|----------|
| Default 9-axis | accel + gyro + mag | — |
| MPU6050 | 6-axis (BE) | — |
| WitMotion JY901 | accel | sum8 |
| BMI160 | 6-axis | — |
| ICM-20948 | 9-axis (BE) | — |
| LSM6DSL | 6-axis | — |
| ANO Protocol | 6-axis | sum8 |
| Xsens MTi | 9-axis float32 | — |
| VectorNav VNBIN | 9-axis float32 | CRC16 |
| GPCHC | 6-axis float32 | XOR |
| NMEA PASHR | 6-axis scaled | XOR |

### Custom JSON

```json
{
  "name": "My Protocol",
  "sync": [170, 255],
  "channels": [
    { "name": "ax", "type": "int16", "endian": "le", "scale": 1, "role": "ax" },
    { "name": "ay", "type": "int16", "endian": "le", "scale": 1, "role": "ay" },
    { "name": "az", "type": "int16", "endian": "le", "scale": 1, "role": "az" }
  ],
  "checksum": { "type": "xor", "scope": "data" }
}
```

Supported types: `int8` `uint8` `int16` `uint16` `int32` `uint32` `float32`  
Checksum: `sum8` `xor` `crc8` `crc16`

## Filters

| Filter | Best for |
|--------|----------|
| Accel Only | Static, no gyro |
| Complementary | Low compute |
| Madgwick | Balanced |
| EKF | Best accuracy |

## License

MIT
