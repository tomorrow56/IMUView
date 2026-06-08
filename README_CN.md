# IMU Orientation Viewer

<p align="center">
  <img src="screenshoot/logo.png" alt="IMU Orientation Viewer" width="200">
</p>

[English](README.md)

一个 VSCode 插件，用于实时可视化 IMU 传感器数据。通过 USB 串口连接你的硬件，在编辑器内直接观察 3D 姿态旋转、调试传感器波形——无需切换窗口。


![Demo](docs/demo.gif)

## 功能亮点

- **3D 姿态可视化** — STM32 开发板模型随传感器融合输出实时旋转
- **4 种融合算法** — 一键切换：纯加速度计、互补滤波、Madgwick、扩展卡尔曼滤波（EKF）
- **实时传感器图表** — 加速度计、陀螺仪、姿态角波形实时更新
- **串口直连** — 基于 Node.js `serialport`，无浏览器兼容限制
- **Demo 模式** — 物理仿真 IMU 数据，无硬件也能体验完整功能
- **陀螺仪量程配置** — 支持 125～2000 dps 满量程设置

## 快速开始

1. 打开命令面板（`Ctrl+Shift+P`）
2. 输入 `IMU Viewer: Open`
3. 选择串口和波特率
4. 点击 **Connect**

没有硬件？点击 **Demo Mode** 立即体验。

## 数据协议

固件需按以下格式发送 **20 字节二进制包**：

```
0xAA 0xFF [ax_L ax_H] [ay_L ay_H] [az_L az_H]
           [gx_L gx_H] [gy_L gy_H] [gz_L gz_H]
           [mx_L mx_H] [my_L my_H] [mz_L mz_H]
```

- 同步头：`0xAA 0xFF`
- 数据：有符号 int16，小端序
- 无磁力计时每轴发送 `0x0000`

兼容固件示例：[stm32-simple-imu-reading](https://github.com/Steppeschool/stm32-simple-imu-reading)

## 姿态融合算法

| 算法 | 原理 | 适用场景 |
|------|------|----------|
| Accel Only | 加速度计/磁力计直接解算 | 静态姿态，无需陀螺仪 |
| Complementary | 陀螺仪高通 + 加速度计低通互补 | 简单快速，计算量低 |
| Madgwick | 梯度下降四元数融合 | 精度与速度平衡 |
| EKF | 扩展卡尔曼滤波，4×4 状态矩阵 | 最高精度，自动估计陀螺偏置 |

## 从源码构建

```bash
npm install
npm run compile
```

在 VSCode 中按 `F5` 启动扩展开发宿主。

## 技术栈

- **扩展端**：TypeScript + `serialport` 串口通信
- **3D 渲染**：Three.js，几何体合并优化性能
- **图表**：Chart.js，节流刷新
- **滤波算法**：纯 JavaScript 实现，无原生依赖

## 架构

```
扩展端 (Node.js)                 Webview (Chromium)
┌──────────────────────┐         ┌───────────────────────────┐
│ serialport 串口读取    │         │ Three.js 3D 视口           │
│ 二进制协议解析         │─ msg ──>│ Chart.js 实时图表          │
│ 数据转发              │         │ EKF / Madgwick 滤波器      │
└──────────────────────┘         └───────────────────────────┘
```

## 许可证

MIT
