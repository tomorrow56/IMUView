# IMU Orientation Viewer

<p align="center">
  <img src="screenshoot/logo.png" alt="IMU Orientation Viewer" width="200">
</p>

[English](README.md) | [中文](README_CN.md)

A VSCode extension for real-time IMU sensor visualization. Connect your hardware via USB serial, watch orientation come alive in 3D, and debug sensor data with live charts — all without leaving your editor.

![Demo](docs/demo.gif)

## Features

- **3D Orientation** — STM32-style board model rotates in real-time based on sensor fusion output
- **4 Fusion Algorithms** — Switch between Accel-only, Complementary, Madgwick, and Extended Kalman Filter with one click
- **Live Sensor Charts** — Accelerometer, gyroscope, and orientation angles updating in real-time
- **Serial Port Integration** — Direct USB serial connection via Node.js `serialport`, no browser limitations
- **Demo Mode** — Physically accurate simulated IMU data for testing without hardware
- **Gyro Range Config** — Supports 125 to 2000 dps full-scale settings

## Quick Start

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run `IMU Viewer: Open`
3. Select your COM port and baud rate
4. Click **Connect**

No hardware? Click **Demo Mode** to see it in action.

## Data Protocol

The firmware should send a **20-byte binary packet** per reading:

```
0xAA 0xFF [ax_L ax_H] [ay_L ay_H] [az_L az_H]
           [gx_L gx_H] [gy_L gy_H] [gz_L gz_H]
           [mx_L mx_H] [my_L my_H] [mz_L mz_H]
```

- Sync bytes: `0xAA 0xFF`
- Values: signed int16, little-endian
- Magnetometer: send `0x0000` per axis if not present

Compatible firmware: [stm32-simple-imu-reading](https://github.com/Steppeschool/stm32-simple-imu-reading)

## Supported Filters

| Filter | Description | Use Case |
|--------|-------------|----------|
| Accel Only | Direct acc/mag angle calculation | Static orientation, no gyro needed |
| Complementary | High-pass gyro + low-pass accel blend | Simple, low compute |
| Madgwick | Gradient descent quaternion fusion | Good balance of speed and accuracy |
| EKF | Extended Kalman Filter with full 4×4 state | Best accuracy, handles bias drift |

## Build from Source

```bash
npm install
npm run compile
```

Press `F5` in VSCode to launch the extension development host.

## Tech Stack

- **Extension**: TypeScript + Node.js `serialport` for serial communication
- **3D Rendering**: Three.js with merged geometry for performance
- **Charts**: Chart.js with throttled updates
- **Filters**: Pure JavaScript implementations (no native dependencies)

## Architecture

```
Extension (Node.js)              Webview (Chromium)
┌──────────────────────┐        ┌───────────────────────────┐
│ serialport            │        │ Three.js 3D viewport      │
│ Binary protocol       │─ msg ─>│ Chart.js realtime graphs  │
│ parser                │        │ EKF / Madgwick / etc.     │
└──────────────────────┘        └───────────────────────────┘
```

## License

MIT
