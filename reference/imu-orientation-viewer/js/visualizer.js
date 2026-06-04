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

    // ── Setup ──────────────────────────────────────────────────────────

    _initRenderer(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0d1117);
        this.scene.fog = new THREE.FogExp2(0x0d1117, 0.06);

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
        key.shadow.camera.far  = 30;
        key.shadow.camera.left = key.shadow.camera.bottom = -6;
        key.shadow.camera.right = key.shadow.camera.top   =  6;
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

    // ── Board geometry ─────────────────────────────────────────────────

    _buildBoard() {
        this.imuGroup = new THREE.Group();
        this.scene.add(this.imuGroup);

        // PCB base (green)
        const pcb = new THREE.Mesh(
            new THREE.BoxGeometry(3.2, 0.1, 2.0),
            new THREE.MeshPhongMaterial({ color: 0x1a6b3c, specular: 0x223322, shininess: 40 })
        );
        pcb.castShadow = true;
        this.imuGroup.add(pcb);

        // PCB edge highlight (wireframe)
        const edgeGeo = new THREE.EdgesGeometry(pcb.geometry);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x2ea043, linewidth: 1 });
        this.imuGroup.add(new THREE.LineSegments(edgeGeo, edgeMat));

        // IC chip (dark gray square)
        const chip = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.12, 0.55),
            new THREE.MeshPhongMaterial({ color: 0x111111, specular: 0x333333, shininess: 80 })
        );
        chip.position.set(0, 0.11, 0);
        chip.castShadow = true;
        this.imuGroup.add(chip);

        // Chip label dot (gold)
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffd700 })
        );
        dot.position.set(-0.2, 0.175, -0.2);
        this.imuGroup.add(dot);

        // Pin headers (gold pads along two edges)
        this._addPins( 1.5, 0, 0,  7, 0.3);
        this._addPins(-1.5, 0, 0,  7, 0.3);
    }

    _addPins(x, y, z0, count, spacing) {
        const mat = new THREE.MeshPhongMaterial({ color: 0xd4a017, shininess: 100 });
        for (let i = 0; i < count; i++) {
            const pin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), mat);
            pin.position.set(x, y + 0.125, z0 + (i - (count - 1) / 2) * spacing / count);
            this.imuGroup.add(pin);
        }
    }

    // ── Axis arrows + labels ───────────────────────────────────────────

    _buildAxes() {
        // Axes attached to the board (rotate with it)
        // X along the long axis of the PCB (3.2 units), Y into the scene, Z down
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

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Apply Kalman-filtered orientation to the 3D board.
     * Euler order YXZ — yaw first (world Y), then pitch & roll in body.
     */
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
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        cancelAnimationFrame(this._raf);
        this._ro.disconnect();
        this.renderer.dispose();
    }
}
