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

    // ── STM32 Blue Pill Board (merged geometry for performance) ─────────

    _buildBoard() {
        this.imuGroup = new THREE.Group();
        this.scene.add(this.imuGroup);

        const W = 2.66, H = 0.08, D = 1.14;
        const TOP = H / 2;

        // PCB base
        const pcbMat = new THREE.MeshPhongMaterial({ color: 0x2f6fa8, specular: 0x4c5f72, shininess: 24 });
        const pcb = new THREE.Mesh(this._makeRoundedBoardGeometry(W, H, D, 0.08), pcbMat);
        pcb.castShadow = true;
        pcb.receiveShadow = true;
        this.imuGroup.add(pcb);

        // Merge all gold-colored geometry (pins) into one mesh
        const goldGeos = [];
        const pinGeo = new THREE.BoxGeometry(0.02, 0.35, 0.02);
        const spacing = (W - 0.4) / 19;
        const startX = -(W - 0.4) / 2;
        const zRows = [D / 2 - 0.06, -(D / 2 - 0.06)];

        for (const zPos of zRows) {
            for (let i = 0; i < 20; i++) {
                const m = new THREE.Matrix4().makeTranslation(startX + i * spacing, TOP - 0.1, zPos);
                goldGeos.push(pinGeo.clone().applyMatrix4(m));
            }
        }

        // LQFP48 chip pins (12 per side)
        const chipX = 0.15, chipZ = 0;
        const bodyW = 0.5, bodyD = 0.5;
        const chipPinY = TOP + 0.018;
        const chipPinGeo = new THREE.BoxGeometry(0.06, 0.018, 0.025);
        const chipPinGeoV = new THREE.BoxGeometry(0.025, 0.018, 0.06);
        const pitch = bodyD / 13;
        for (let i = 0; i < 12; i++) {
            const offset = (i - 5.5) * pitch;
            // Left
            goldGeos.push(chipPinGeo.clone().applyMatrix4(
                new THREE.Matrix4().makeTranslation(chipX - bodyW/2 - 0.03, chipPinY, chipZ + offset)));
            // Right
            goldGeos.push(chipPinGeo.clone().applyMatrix4(
                new THREE.Matrix4().makeTranslation(chipX + bodyW/2 + 0.03, chipPinY, chipZ + offset)));
            // Top
            goldGeos.push(chipPinGeoV.clone().applyMatrix4(
                new THREE.Matrix4().makeTranslation(chipX + offset, chipPinY, chipZ - bodyD/2 - 0.03)));
            // Bottom
            goldGeos.push(chipPinGeoV.clone().applyMatrix4(
                new THREE.Matrix4().makeTranslation(chipX + offset, chipPinY, chipZ + bodyD/2 + 0.03)));
        }

        // SWD header pins
        for (let i = 0; i < 4; i++) {
            goldGeos.push(pinGeo.clone().applyMatrix4(
                new THREE.Matrix4().makeTranslation(W/2 - 0.1, TOP + 0.04, (i - 1.5) * 0.08)));
        }

        // Jumper pins (2 groups x 3 pins)
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 3; j++) {
                const smallPin = new THREE.BoxGeometry(0.015, 0.12, 0.015);
                goldGeos.push(smallPin.applyMatrix4(
                    new THREE.Matrix4().makeTranslation(-0.25 + i*0.12 + (j-1)*0.04, TOP + 0.04, -0.42)));
            }
        }

        // Merge all gold pins into a single mesh
        const mergedGold = this._mergeGeometries(goldGeos);
        if (mergedGold) {
            const goldMat = new THREE.MeshPhongMaterial({ color: 0xb9913b, specular: 0xd8c27a, shininess: 58 });
            const goldMesh = new THREE.Mesh(mergedGold, goldMat);
            this.imuGroup.add(goldMesh);
        }

        // Merge all dark/black geometry (chip body, pin bases, jumper caps, passives)
        const darkGeos = [];

        // STM32 chip body
        darkGeos.push(new THREE.BoxGeometry(bodyW, 0.06, bodyD).applyMatrix4(
            new THREE.Matrix4().makeTranslation(chipX, TOP + 0.03, chipZ)));

        // Pin header black bases
        for (const zPos of zRows) {
            darkGeos.push(new THREE.BoxGeometry(W - 0.3, 0.04, 0.08).applyMatrix4(
                new THREE.Matrix4().makeTranslation(0, TOP + 0.02, zPos)));
        }

        // Jumper caps
        for (let i = 0; i < 2; i++) {
            darkGeos.push(new THREE.BoxGeometry(0.07, 0.06, 0.04).applyMatrix4(
                new THREE.Matrix4().makeTranslation(-0.25 + i*0.12 - 0.02, TOP + 0.08, -0.42)));
        }

        // Voltage regulator body
        darkGeos.push(new THREE.BoxGeometry(0.15, 0.08, 0.1).applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.8, TOP + 0.04, -0.3)));

        // Resistors
        const ress = [[0.3, 0.35], [0.4, 0.35], [-0.5, -0.35], [-0.6, -0.35]];
        for (const [rx, rz] of ress) {
            darkGeos.push(new THREE.BoxGeometry(0.05, 0.02, 0.025).applyMatrix4(
                new THREE.Matrix4().makeTranslation(rx, TOP + 0.01, rz)));
        }

        // Reset button base
        darkGeos.push(new THREE.BoxGeometry(0.12, 0.04, 0.12).applyMatrix4(
            new THREE.Matrix4().makeTranslation(0.85, TOP + 0.02, -0.38)));

        const mergedDark = this._mergeGeometries(darkGeos);
        if (mergedDark) {
            const darkMat = new THREE.MeshPhongMaterial({ color: 0x2d3136, specular: 0x565c62, shininess: 42 });
            const darkMesh = new THREE.Mesh(mergedDark, darkMat);
            darkMesh.castShadow = true;
            this.imuGroup.add(darkMesh);
        }

        // Merge silver geometry (crystals, USB, regulator tab)
        const silverGeos = [];
        silverGeos.push(new THREE.BoxGeometry(0.18, 0.04, 0.08).applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.45, TOP + 0.02, 0.15)));
        silverGeos.push(new THREE.BoxGeometry(0.12, 0.035, 0.06).applyMatrix4(
            new THREE.Matrix4().makeTranslation(0.85, TOP + 0.0175, 0.2)));
        silverGeos.push(new THREE.BoxGeometry(0.32, 0.13, 0.38).applyMatrix4(
            new THREE.Matrix4().makeTranslation(-W/2 + 0.32/2 - 0.05, TOP + 0.065, 0)));
        silverGeos.push(new THREE.BoxGeometry(0.15, 0.01, 0.06).applyMatrix4(
            new THREE.Matrix4().makeTranslation(-0.8, TOP + 0.08, -0.26)));

        const mergedSilver = this._mergeGeometries(silverGeos);
        if (mergedSilver) {
            const silverMat = new THREE.MeshPhongMaterial({ color: 0xb2b7bd, specular: 0xe1e5e9, shininess: 62 });
            const silverMesh = new THREE.Mesh(mergedSilver, silverMat);
            silverMesh.castShadow = true;
            this.imuGroup.add(silverMesh);
        }

        const usbFaceX = -W / 2 - 0.052;
        const usbMouthMat = new THREE.MeshPhongMaterial({ color: 0x1f242a, specular: 0x111111, shininess: 18 });
        const usbMouth = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.072, 0.25), usbMouthMat);
        usbMouth.position.set(usbFaceX, TOP + 0.066, 0);
        usbMouth.castShadow = false;
        this.imuGroup.add(usbMouth);

        const usbTongueMat = new THREE.MeshPhongMaterial({ color: 0x2f6fa8, specular: 0x4c5f72, shininess: 20 });
        const usbTongue = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.15), usbTongueMat);
        usbTongue.position.set(usbFaceX - 0.004, TOP + 0.061, 0);
        this.imuGroup.add(usbTongue);

        const usbLipMat = new THREE.MeshPhongMaterial({ color: 0xd5d9dd, specular: 0xffffff, shininess: 70 });
        const usbLipTop = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.28), usbLipMat);
        usbLipTop.position.set(usbFaceX - 0.002, TOP + 0.107, 0);
        this.imuGroup.add(usbLipTop);

        // Capacitors (brown, merged)
        const capGeos = [];
        const caps = [[-0.3, 0.3], [-0.3, -0.3], [0.5, 0.3], [0.5, -0.15], [-0.7, 0.1], [-0.7, -0.1]];
        for (const [cx, cz] of caps) {
            capGeos.push(new THREE.BoxGeometry(0.06, 0.025, 0.04).applyMatrix4(
                new THREE.Matrix4().makeTranslation(cx, TOP + 0.012, cz)));
        }
        const mergedCaps = this._mergeGeometries(capGeos);
        if (mergedCaps) {
            const capMat = new THREE.MeshPhongMaterial({ color: 0x8c7652, shininess: 28 });
            this.imuGroup.add(new THREE.Mesh(mergedCaps, capMat));
        }

        // LEDs (keep separate for emissive)
        this.ledGreenMat = new THREE.MeshPhongMaterial({
            color: 0x4fae63,
            emissive: 0x4fae63,
            emissiveIntensity: 0.55,
            transparent: true,
            opacity: 0.95,
        });
        const ledGreen = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.03, 0.04),
            this.ledGreenMat
        );
        ledGreen.position.set(0.55, TOP + 0.015, -0.38);
        this.imuGroup.add(ledGreen);

        this.ledRedMat = new THREE.MeshPhongMaterial({
            color: 0xc95d4d,
            emissive: 0xc95d4d,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.95,
        });
        const ledRed = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.03, 0.04),
            this.ledRedMat
        );
        ledRed.position.set(0.7, TOP + 0.015, -0.38);
        this.imuGroup.add(ledRed);

        // Reset button top (yellow)
        const btnMat = new THREE.MeshPhongMaterial({ color: 0xb99a35, shininess: 36 });
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), btnMat);
        btn.position.set(0.85, TOP + 0.055, -0.38);
        this.imuGroup.add(btn);

        // Chip label
        // const textSprite = this._makeChipLabel('STM32F103');
        // textSprite.position.set(chipX, TOP + 0.065, chipZ);
        // textSprite.scale.set(0.4, 0.15, 1);
        // this.imuGroup.add(textSprite);
    }

    _makeRoundedBoardGeometry(width, height, depth, radius) {
        const x0 = -width / 2, x1 = width / 2;
        const z0 = -depth / 2, z1 = depth / 2;
        const r = Math.min(radius, width / 2, depth / 2);
        const shape = new THREE.Shape();

        shape.moveTo(x0 + r, z0);
        shape.lineTo(x1 - r, z0);
        shape.quadraticCurveTo(x1, z0, x1, z0 + r);
        shape.lineTo(x1, z1 - r);
        shape.quadraticCurveTo(x1, z1, x1 - r, z1);
        shape.lineTo(x0 + r, z1);
        shape.quadraticCurveTo(x0, z1, x0, z1 - r);
        shape.lineTo(x0, z0 + r);
        shape.quadraticCurveTo(x0, z0, x0 + r, z0);

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: height,
            bevelEnabled: true,
            bevelThickness: 0.006,
            bevelSize: 0.006,
            bevelSegments: 2,
            curveSegments: 8,
        });
        geometry.translate(0, 0, -height / 2);
        geometry.rotateX(-Math.PI / 2);
        geometry.computeVertexNormals();
        return geometry;
    }

    _mergeGeometries(geos) {
        if (!geos.length) return null;
        const merged = new THREE.BufferGeometry();
        let totalVerts = 0, totalIdx = 0;
        for (const g of geos) {
            totalVerts += g.attributes.position.count;
            totalIdx += g.index ? g.index.count : 0;
        }
        const positions = new Float32Array(totalVerts * 3);
        const normals = new Float32Array(totalVerts * 3);
        const indices = new Uint32Array(totalIdx);
        let vOffset = 0, iOffset = 0, iBase = 0;
        for (const g of geos) {
            const pos = g.attributes.position;
            const nor = g.attributes.normal;
            for (let i = 0; i < pos.count * 3; i++) {
                positions[vOffset * 3 + i] = pos.array[i];
                normals[vOffset * 3 + i] = nor.array[i];
            }
            if (g.index) {
                for (let i = 0; i < g.index.count; i++) {
                    indices[iOffset + i] = g.index.array[i] + iBase;
                }
                iOffset += g.index.count;
            }
            iBase += pos.count;
            vOffset += pos.count;
        }
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        if (totalIdx > 0) merged.setIndex(new THREE.BufferAttribute(indices, 1));
        merged.computeBoundingSphere();
        return merged;
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
        ctx.font = `bold ${Math.round(size * 0.65)}px Arial`;
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

    // ── Public API ─────────────────────────────────────────────────────

    updateOrientation(roll, pitch, yaw) {
        this.imuGroup.rotation.order = 'YZX';
        this.imuGroup.rotation.y = -yaw  * DEG2RAD;
        this.imuGroup.rotation.z =  pitch * DEG2RAD;
        this.imuGroup.rotation.x =  roll  * DEG2RAD;
    }

    reset() {
        this.imuGroup.rotation.set(0, 0, 0);
    }

    // ── Render loop ────────────────────────────────────────────────────

    _animate() {
        this._raf = requestAnimationFrame(() => this._animate());
        this._updateLedPulse(performance.now() * 0.001);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    _updateLedPulse(t) {
        if (this.ledGreenMat) {
            this.ledGreenMat.emissiveIntensity = 0.45 + 0.75 * (0.5 + 0.5 * Math.sin(t * 4.2));
        }
        if (this.ledRedMat) {
            const blink = (Math.sin(t * 9.5) > 0.72) ? 1 : 0;
            this.ledRedMat.emissiveIntensity = 0.35 + 0.95 * blink;
        }
    }

    dispose() {
        cancelAnimationFrame(this._raf);
        this._ro.disconnect();
        this.renderer.dispose();
    }
}
