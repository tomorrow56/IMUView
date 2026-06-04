import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG2RAD = Math.PI / 180;

export class IMUVisualizer {
    constructor(canvas) {
        this._initRenderer(canvas);
        this._initScene();
        this._buildBoard();
        this._buildAxes();
        this._animate();
    }

    _initRenderer(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xeef2f7);
        this.scene.fog = new THREE.FogExp2(0xeef2f7, 0.04);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
        this.camera.position.set(5, 4, 6);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.07;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 20;

        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(canvas.parentElement);
        this._resize();
    }

    _resize() {
        const el = this.renderer.domElement.parentElement;
        const w = el.clientWidth, h = el.clientHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    _initScene() {
        // Ambient
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));

        // Key light
        const key = new THREE.DirectionalLight(0xffffff, 1.2);
        key.position.set(6, 10, 8);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 30;
        key.shadow.camera.left = key.shadow.camera.bottom = -6;
        key.shadow.camera.right = key.shadow.camera.top = 6;
        this.scene.add(key);

        // Rim light (cold blue from behind)
        const rim = new THREE.PointLight(0x4488ff, 0.6, 15);
        rim.position.set(-4, 2, -5);
        this.scene.add(rim);

        // Shadow receiver
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.ShadowMaterial({ opacity: 0.25 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1.2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Grid
        const grid = new THREE.GridHelper(12, 24, 0x21262d, 0x1a1f26);
        grid.position.y = -1.21;
        this.scene.add(grid);
    }

    // ── STM32 Blue Pill Board ──────────────────────────────────────────

    _buildBoard() {
        this.imuGroup = new THREE.Group();
        this.scene.add(this.imuGroup);

        // Board dimensions: 53.3mm x 22.8mm, scaled ~1:20
        const W = 2.66, H = 0.08, D = 1.14;
        const TOP = H / 2;

        // PCB base - blue
        const pcbMat = new THREE.MeshPhongMaterial({
            color: 0x1565c0,
            specular: 0x333344,
            shininess: 35,
        });
        const pcb = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), pcbMat);
        pcb.castShadow = true;
        pcb.receiveShadow = true;
        this.imuGroup.add(pcb);

        // PCB bottom - darker blue
        const pcbBottom = new THREE.Mesh(
            new THREE.PlaneGeometry(W, D),
            new THREE.MeshPhongMaterial({ color: 0x0d47a1, shininess: 20 })
        );
        pcbBottom.rotation.x = Math.PI / 2;
        pcbBottom.position.y = -TOP - 0.001;
        this.imuGroup.add(pcbBottom);

        // Silkscreen traces (thin lines on top)
        this._addTraces(TOP);

        // ── STM32 chip (LQFP48, center-right) ──
        this._addSTM32Chip(0.15, TOP, 0);

        // ── Crystal oscillators ──
        this._addCrystal(-0.45, TOP, 0.15, 0.18, 0.04, 0.08);  // 8MHz (larger)
        this._addCrystal(0.85, TOP, 0.2, 0.12, 0.035, 0.06);   // 32.768kHz (smaller)

        // ── USB Micro-B connector ──
        this._addUSB(-W / 2, TOP);

        // ── Pin headers (2 rows of 20) ──
        this._addPinHeader(20, W, D, TOP);

        // ── Reset button ──
        this._addButton(0.85, TOP, -0.38, 0xccaa00);

        // ── Boot jumpers ──
        this._addJumperPair(-0.25, TOP, -0.42);

        // ── LEDs ──
        this._addLED(0.55, TOP, -0.38, 0x00ff00);  // green power LED
        this._addLED(0.7, TOP, -0.38, 0xff3300);   // red user LED

        // ── Voltage regulator ──
        this._addRegulator(-0.8, TOP, -0.3);

        // ── Capacitors and resistors ──
        this._addPassives(TOP);

        // ── SWD header (4 pins at edge) ──
        this._addSWDHeader(W / 2 - 0.1, TOP, 0);
    }

    _addTraces(top) {
        const traceMat = new THREE.MeshBasicMaterial({ color: 0x90caf9, transparent: true, opacity: 0.3 });
        // A few decorative traces
        const traces = [
            { x: 0, z: 0.45, w: 1.8, d: 0.015 },
            { x: 0, z: -0.45, w: 1.8, d: 0.015 },
            { x: -0.6, z: 0, w: 0.015, d: 0.6 },
            { x: 0.6, z: 0, w: 0.015, d: 0.6 },
        ];
        for (const t of traces) {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(t.w, t.d),
                traceMat
            );
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(t.x, top + 0.001, t.z);
            this.imuGroup.add(mesh);
        }
    }

    _addSTM32Chip(x, top, z) {
        const bodyW = 0.5, bodyH = 0.06, bodyD = 0.5;
        const chipMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, specular: 0x444444, shininess: 90 });

        // Chip body
        const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), chipMat);
        body.position.set(x, top + bodyH / 2, z);
        body.castShadow = true;
        this.imuGroup.add(body);

        // Pin 1 dot
        const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.02, 8),
            new THREE.MeshBasicMaterial({ color: 0xaaaaaa })
        );
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(x - bodyW / 2 + 0.06, top + bodyH + 0.001, z - bodyD / 2 + 0.06);
        this.imuGroup.add(dot);

        // Chip text marking
        const textSprite = this._makeChipLabel('STM32F103');
        textSprite.position.set(x, top + bodyH + 0.01, z);
        textSprite.scale.set(0.4, 0.15, 1);
        this.imuGroup.add(textSprite);

        // LQFP48 pins (12 per side)
        const pinMat = new THREE.MeshPhongMaterial({ color: 0xc0c0c0, shininess: 120 });
        const pinW = 0.025, pinH = 0.01, pinL = 0.06;
        const pinsPerSide = 12;
        const pitch = bodyD / (pinsPerSide + 1);

        for (let i = 0; i < pinsPerSide; i++) {
            const offset = (i - (pinsPerSide - 1) / 2) * pitch;
            // Left side
            const pl = new THREE.Mesh(new THREE.BoxGeometry(pinL, pinH, pinW), pinMat);
            pl.position.set(x - bodyW / 2 - pinL / 2, top + pinH / 2, z + offset);
            this.imuGroup.add(pl);
            // Right side
            const pr = new THREE.Mesh(new THREE.BoxGeometry(pinL, pinH, pinW), pinMat);
            pr.position.set(x + bodyW / 2 + pinL / 2, top + pinH / 2, z + offset);
            this.imuGroup.add(pr);
            // Top side
            const pt = new THREE.Mesh(new THREE.BoxGeometry(pinW, pinH, pinL), pinMat);
            pt.position.set(x + offset, top + pinH / 2, z - bodyD / 2 - pinL / 2);
            this.imuGroup.add(pt);
            // Bottom side
            const pb = new THREE.Mesh(new THREE.BoxGeometry(pinW, pinH, pinL), pinMat);
            pb.position.set(x + offset, top + pinH / 2, z + bodyD / 2 + pinL / 2);
            this.imuGroup.add(pb);
        }
    }

    _addCrystal(x, top, z, w, h, d) {
        const mat = new THREE.MeshPhongMaterial({ color: 0xd0d0d0, specular: 0xffffff, shininess: 150 });
        const crystal = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        crystal.position.set(x, top + h / 2, z);
        crystal.castShadow = true;
        this.imuGroup.add(crystal);
    }

    _addUSB(xEdge, top) {
        // Metal shell
        const shellMat = new THREE.MeshPhongMaterial({ color: 0xa8a8a8, specular: 0xffffff, shininess: 100 });
        const shellW = 0.32, shellH = 0.13, shellD = 0.38;
        const shell = new THREE.Mesh(new THREE.BoxGeometry(shellW, shellH, shellD), shellMat);
        shell.position.set(xEdge + shellW / 2 - 0.05, top + shellH / 2, 0);
        shell.castShadow = true;
        this.imuGroup.add(shell);

        // USB port hole (dark inside)
        const holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        const hole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.22), holeMat);
        hole.position.set(xEdge - 0.01, top + shellH / 2, 0);
        this.imuGroup.add(hole);
    }

    _addPinHeader(count, boardW, boardD, top) {
        const pinMat = new THREE.MeshPhongMaterial({ color: 0xd4a017, specular: 0xffdd44, shininess: 100 });
        const blackMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 30 });
        const spacing = (boardW - 0.4) / (count - 1);
        const startX = -(boardW - 0.4) / 2;
        const zPositions = [boardD / 2 - 0.06, -(boardD / 2 - 0.06)];

        for (const zPos of zPositions) {
            // Black plastic base
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(boardW - 0.3, 0.04, 0.08),
                blackMat
            );
            base.position.set(0, top + 0.02, zPos);
            this.imuGroup.add(base);

            // Gold pins
            for (let i = 0; i < count; i++) {
                const pin = new THREE.Mesh(
                    new THREE.BoxGeometry(0.02, 0.35, 0.02),
                    pinMat
                );
                pin.position.set(startX + i * spacing, top - 0.1, zPos);
                this.imuGroup.add(pin);
            }
        }
    }

    _addButton(x, top, z, color) {
        const baseMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 30 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.12), baseMat);
        base.position.set(x, top + 0.02, z);
        this.imuGroup.add(base);

        const btnMat = new THREE.MeshPhongMaterial({ color, shininess: 60 });
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), btnMat);
        btn.position.set(x, top + 0.055, z);
        this.imuGroup.add(btn);
    }

    _addJumperPair(x, top, z) {
        const pinMat = new THREE.MeshPhongMaterial({ color: 0xd4a017, shininess: 100 });
        const capMat = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 40 });

        for (let i = 0; i < 2; i++) {
            const px = x + i * 0.12;
            // 3 pins each
            for (let j = 0; j < 3; j++) {
                const pin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.015), pinMat);
                pin.position.set(px + (j - 1) * 0.04, top + 0.04, z);
                this.imuGroup.add(pin);
            }
            // Jumper cap on first 2 pins
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.04), capMat);
            cap.position.set(px - 0.02, top + 0.08, z);
            this.imuGroup.add(cap);
        }

        // Label
        const label = this._makeSmallLabel('BOOT');
        label.position.set(x + 0.06, top + 0.13, z);
        label.scale.set(0.2, 0.06, 1);
        this.imuGroup.add(label);
    }

    _addLED(x, top, z, color) {
        const mat = new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.85,
        });
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.04), mat);
        led.position.set(x, top + 0.015, z);
        this.imuGroup.add(led);
    }

    _addRegulator(x, top, z) {
        const mat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 60 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.1), mat);
        body.position.set(x, top + 0.04, z);
        this.imuGroup.add(body);

        // Heat tab
        const tabMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, shininess: 100 });
        const tab = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.06), tabMat);
        tab.position.set(x, top + 0.08, z + 0.04);
        this.imuGroup.add(tab);
    }

    _addPassives(top) {
        const capMat = new THREE.MeshPhongMaterial({ color: 0x8d6e3a, shininess: 40 });
        const resMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 30 });

        // Some capacitors
        const caps = [
            [-0.3, 0.3], [-0.3, -0.3], [0.5, 0.3], [0.5, -0.15],
            [-0.7, 0.1], [-0.7, -0.1],
        ];
        for (const [x, z] of caps) {
            const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.04), capMat);
            c.position.set(x, top + 0.012, z);
            this.imuGroup.add(c);
        }

        // Some resistors
        const ress = [
            [0.3, 0.35], [0.4, 0.35], [-0.5, -0.35], [-0.6, -0.35],
        ];
        for (const [x, z] of ress) {
            const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.025), resMat);
            r.position.set(x, top + 0.01, z);
            this.imuGroup.add(r);
        }
    }

    _addSWDHeader(x, top, z) {
        const pinMat = new THREE.MeshPhongMaterial({ color: 0xd4a017, shininess: 100 });
        for (let i = 0; i < 4; i++) {
            const pin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.015), pinMat);
            pin.position.set(x, top + 0.04, z + (i - 1.5) * 0.08);
            this.imuGroup.add(pin);
        }
    }

    // ── Axis arrows + labels ───────────────────────────────────────────

    _buildAxes() {
        // Axes attached to the board (rotate with it)
        // X along the long axis of the PCB, Y into the scene, Z down
        this._addArrow(new THREE.Vector3( 1,  0,  0), 2.0, 0xff4757, 'X');
        this._addArrow(new THREE.Vector3( 0,  0,  1), 1.6, 0x2ed573, 'Y');
        this._addArrow(new THREE.Vector3( 0, -1,  0), 1.6, 0x1e90ff, 'Z');

        // World-frame labeled reference axes (fixed, bottom-left corner)
        const wOrigin = new THREE.Vector3(-4.5, -1.2, -4);
        const wLen = 0.7;
        for (const [dir, color, lbl] of [
            [new THREE.Vector3( 1,  0,  0), 0xff4757, 'X'],
            [new THREE.Vector3( 0,  0,  1), 0x2ed573, 'Y'],
            [new THREE.Vector3( 0, -1,  0), 0x1e90ff, 'Z'],
        ]) {
            this.scene.add(new THREE.ArrowHelper(
                dir, wOrigin, wLen, color, wLen * 0.22, wLen * 0.10
            ));
            const sp = this._makeLabel(lbl, color);
            sp.position.copy(wOrigin).addScaledVector(dir, wLen + 0.22);
            sp.scale.set(0.32, 0.32, 1);
            this.scene.add(sp);
        }
    }

    _addArrow(dir, length, color, labelText) {
        const arrow = new THREE.ArrowHelper(
            dir.clone().normalize(),
            new THREE.Vector3(0, 0.06, 0),
            length,
            color,
            0.28,
            0.13
        );
        this.imuGroup.add(arrow);

        // Sprite label at arrow tip
        const sprite = this._makeLabel(labelText, color);
        sprite.position.copy(dir).multiplyScalar(length + 0.35);
        sprite.position.y += 0.06;
        this.imuGroup.add(sprite);
    }

    // ── Labels ─────────────────────────────────────────────────────────

    _makeLabel(text, color) {
        const size = 128;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.font = `bold ${Math.round(size * 0.6)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, size / 2, size / 2);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.45, 0.45, 1);
        return sprite;
    }

    _makeChipLabel(text) {
        const w = 256, h = 64;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#cccccc';
        ctx.font = 'bold 28px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        return new THREE.Sprite(mat);
    }

    _makeSmallLabel(text) {
        const w = 128, h = 32;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
        return new THREE.Sprite(mat);
    }

    // ── Public API ─────────────────────────────────────────────────────

    updateOrientation(roll, pitch, yaw) {
        this.imuGroup.rotation.order = 'YZX';
        this.imuGroup.rotation.y = -yaw * DEG2RAD;
        this.imuGroup.rotation.z = pitch * DEG2RAD;
        this.imuGroup.rotation.x = roll * DEG2RAD;
    }

    reset() {
        this.imuGroup.rotation.set(0, 0, 0);
    }

    // ── Render loop ────────────────────────────────────────────────────

    _animate() {
        this._raf = requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        cancelAnimationFrame(this._raf);
        this._ro.disconnect();
        this.renderer.dispose();
    }
}
