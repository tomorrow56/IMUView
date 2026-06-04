import { KalmanAngle } from './kalman.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const ALPHA   = 0.99;

function wrapAngle(a) {
    while (a >  Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// Port of acc_mag2euler() from euler_angles.c
// Returns {roll, pitch, yaw} in radians.
// yaw = 0 when mag is absent or zero.
function accMag2Euler(imu) {
    const an = Math.sqrt(imu.ax * imu.ax + imu.ay * imu.ay + imu.az * imu.az);
    if (an === 0) return { roll: 0, pitch: 0, yaw: 0 };
    const anx = imu.ax / an, any = imu.ay / an, anz = imu.az / an;

    const ay_az = Math.sqrt(any * any + anz * anz);
    const pitch  = Math.atan2(-anx, ay_az);
    const roll   = Math.atan2(any, anz);

    const mn = (imu.mx != null)
        ? Math.sqrt(imu.mx * imu.mx + imu.my * imu.my + imu.mz * imu.mz)
        : 0;

    let yaw = 0;
    if (mn > 0) {
        const mnx = imu.mx / mn, mny = imu.my / mn, mnz = imu.mz / mn;
        const ps = -anx;
        const pc = ay_az;
        const rs = ay_az > 0 ? any / ay_az : 0;
        const rc = ay_az > 0 ? anz / ay_az : 1;
        yaw = Math.atan2(mnz * rs - mny * rc,
                         mnx * pc + ps * (mnz * rc + mny * rs));
    }

    return { roll, pitch, yaw };
}

// Converts acc+mag Euler (radians) to unit quaternion [q0,q1,q2,q3] via ZYX convention.
function _quatFromAccMag(imu) {
    const e  = accMag2Euler(imu);
    const cr = Math.cos(e.roll  / 2), sr = Math.sin(e.roll  / 2);
    const cp = Math.cos(e.pitch / 2), sp = Math.sin(e.pitch / 2);
    const cy = Math.cos(e.yaw   / 2), sy = Math.sin(e.yaw   / 2);
    return [
        cr*cp*cy + sr*sp*sy,
        sr*cp*cy - cr*sp*sy,
        cr*sp*cy + sr*cp*sy,
        cr*cp*sy - sr*sp*cy,
    ];
}

// ── Simple filter ──────────────────────────────────────────────────────────────
// Stateless acc + mag only. No gyro, no drift, but noisy on fast motion.
export class SimpleFilter {
    update(imu, _dt) {
        const e = accMag2Euler(imu);
        return { roll: e.roll * RAD2DEG, pitch: e.pitch * RAD2DEG, yaw: e.yaw * RAD2DEG };
    }
    reset() {}
}

// ── Complementary filter ───────────────────────────────────────────────────────
// Port of complementary_filter_euler() from euler_angles.c.
// Gyro integration (Euler kinematics) corrected by acc/mag at weight (1 - ALPHA).
export class ComplementaryFilter {
    constructor() { this._e = null; }

    update(imu, dt) {
        if (!this._e) {
            this._e = accMag2Euler(imu);
        } else {
            this._integrateGyro(imu, dt);
            const am = accMag2Euler(imu);
            const hasMag = imu.mx != null &&
                Math.sqrt(imu.mx * imu.mx + imu.my * imu.my + imu.mz * imu.mz) > 0;
            this._e.roll  += (1 - ALPHA) * wrapAngle(am.roll  - this._e.roll);
            this._e.pitch += (1 - ALPHA) * wrapAngle(am.pitch - this._e.pitch);
            if (hasMag) {
                this._e.yaw += (1 - ALPHA) * wrapAngle(am.yaw - this._e.yaw);
            }
        }
        return {
            roll:  this._e.roll  * RAD2DEG,
            pitch: this._e.pitch * RAD2DEG,
            yaw:   this._e.yaw   * RAD2DEG,
        };
    }

    // Port of update_euler_gyro() — full Euler kinematic equations
    _integrateGyro(imu, dt) {
        const gx = imu.gx * DEG2RAD * dt;
        const gy = imu.gy * DEG2RAD * dt;
        const gz = imu.gz * DEG2RAD * dt;

        const ps = Math.sin(this._e.pitch);
        const pc = Math.cos(this._e.pitch);
        const rs = Math.sin(this._e.roll);
        const rc = Math.cos(this._e.roll);

        const safe_pc = Math.abs(pc) > 1e-6 ? pc : 1e-6 * Math.sign(pc || 1);

        this._e.roll  += gx + (ps / safe_pc) * (gy * rs + gz * rc);
        this._e.pitch += gy * rc - gz * rs;
        this._e.yaw   += (gy * rs + gz * rc) / safe_pc;

        // Gimbal-lock alternative solution (from original C code)
        if (Math.cos(this._e.pitch) < 0) {
            this._e.pitch = Math.PI - this._e.pitch;
            this._e.roll  = Math.PI + this._e.roll;
            this._e.yaw   = Math.PI + this._e.yaw;
        }

        this._e.roll  = wrapAngle(this._e.roll);
        this._e.pitch = wrapAngle(this._e.pitch);
        this._e.yaw   = wrapAngle(this._e.yaw);
    }

    reset() { this._e = null; }
}

// ── Kalman wrapper ─────────────────────────────────────────────────────────────
// Wraps the existing KalmanAngle for roll/pitch; integrates gyro for yaw.
export class KalmanWrapper {
    constructor() {
        this._roll  = new KalmanAngle();
        this._pitch = new KalmanAngle();
        this._yaw   = 0;
    }

    update(imu, dt) {
        const rollAccel  = Math.atan2(imu.ay, imu.az) * RAD2DEG;
        const pitchAccel = Math.atan2(-imu.ax,
            Math.sqrt(imu.ay ** 2 + imu.az ** 2)) * RAD2DEG;
        const roll  = this._roll.update(rollAccel,  imu.gx, dt);
        const pitch = this._pitch.update(pitchAccel, imu.gy, dt);
        this._yaw  += imu.gz * dt;
        return { roll, pitch, yaw: this._yaw };
    }

    reset() {
        this._roll.reset();
        this._pitch.reset();
        this._yaw = 0;
    }
}

// ── Madgwick filter ────────────────────────────────────────────────────────────
// Gradient-descent quaternion filter. β = gyro measurement error magnitude (rad/s).
export class MadgwickFilter {
    constructor(beta = 0.1) {
        this.beta  = beta;
        this._q    = [1, 0, 0, 0]; // [q0, q1, q2, q3] — q0 scalar
        this._init = false;
    }

    update(imu, dt) {
        if (!this._init) { this._q = _quatFromAccMag(imu); this._init = true; }
        let [q0, q1, q2, q3] = this._q;

        const gx = imu.gx * DEG2RAD;
        const gy = imu.gy * DEG2RAD;
        const gz = imu.gz * DEG2RAD;

        const an = Math.sqrt(imu.ax**2 + imu.ay**2 + imu.az**2);
        if (an === 0) return this._toEuler();
        const ax = imu.ax/an, ay = imu.ay/an, az = imu.az/an;

        // Accel objective function
        const f1 = 2*(q1*q3 - q0*q2) - ax;
        const f2 = 2*(q0*q1 + q2*q3) - ay;
        const f3 = 2*(0.5 - q1**2 - q2**2) - az;

        // Gradient: J_g^T × [f1, f2, f3]
        let g0 = -2*q2*f1 + 2*q1*f2;
        let g1 =  2*q3*f1 + 2*q0*f2 - 4*q1*f3;
        let g2 = -2*q0*f1 + 2*q3*f2 - 4*q2*f3;
        let g3 =  2*q1*f1 + 2*q2*f2;

        // Magnetometer correction
        if (imu.mx != null) {
            const mn = Math.sqrt(imu.mx**2 + imu.my**2 + imu.mz**2);
            if (mn > 0) {
                const mx = imu.mx/mn, my = imu.my/mn, mz = imu.mz/mn;
                const hx = 2*(mx*(0.5-q2**2-q3**2) + my*(q1*q2-q0*q3) + mz*(q1*q3+q0*q2));
                const hy = 2*(mx*(q1*q2+q0*q3) + my*(0.5-q1**2-q3**2) + mz*(q2*q3-q0*q1));
                const hz = 2*(mx*(q1*q3-q0*q2) + my*(q2*q3+q0*q1) + mz*(0.5-q1**2-q2**2));
                const bx = Math.sqrt(hx**2 + hy**2), bz = hz;
                const fm1 = 2*bx*(0.5-q2**2-q3**2) + 2*bz*(q1*q3-q0*q2) - mx;
                const fm2 = 2*bx*(q1*q2-q0*q3)     + 2*bz*(q0*q1+q2*q3) - my;
                const fm3 = 2*bx*(q0*q2+q1*q3)     + 2*bz*(0.5-q1**2-q2**2) - mz;
                g0 += -2*bz*q2*fm1 + (-2*bx*q3+2*bz*q1)*fm2 + 2*bx*q2*fm3;
                g1 +=  2*bz*q3*fm1 + (2*bx*q2+2*bz*q0)*fm2  + (2*bx*q3-4*bz*q1)*fm3;
                g2 += (-4*bx*q2-2*bz*q0)*fm1 + (2*bx*q1+2*bz*q3)*fm2 + (2*bx*q0-4*bz*q2)*fm3;
                g3 += (-4*bx*q3+2*bz*q1)*fm1 + (-2*bx*q0+2*bz*q2)*fm2 + 2*bx*q1*fm3;
            }
        }

        // Normalize gradient
        const gn = Math.sqrt(g0**2 + g1**2 + g2**2 + g3**2);
        if (gn > 0) { g0/=gn; g1/=gn; g2/=gn; g3/=gn; }

        // Gyro derivative: q̇ = 0.5 × q ⊗ [0, gx, gy, gz]
        const qd0 = 0.5*(-q1*gx - q2*gy - q3*gz);
        const qd1 = 0.5*( q0*gx + q2*gz - q3*gy);
        const qd2 = 0.5*( q0*gy - q1*gz + q3*gx);
        const qd3 = 0.5*( q0*gz + q1*gy - q2*gx);

        // Integrate and renormalize
        q0 += (qd0 - this.beta*g0) * dt;
        q1 += (qd1 - this.beta*g1) * dt;
        q2 += (qd2 - this.beta*g2) * dt;
        q3 += (qd3 - this.beta*g3) * dt;
        const qn = Math.sqrt(q0**2 + q1**2 + q2**2 + q3**2);
        this._q = [q0/qn, q1/qn, q2/qn, q3/qn];
        return this._toEuler();
    }

    _toEuler() {
        const [q0, q1, q2, q3] = this._q;
        return {
            roll:  Math.atan2(2*(q0*q1+q2*q3), 1-2*(q1**2+q2**2)) * RAD2DEG,
            pitch: Math.asin( 2*(q0*q2-q3*q1))                     * RAD2DEG,
            yaw:   Math.atan2(2*(q0*q3+q1*q2), 1-2*(q2**2+q3**2)) * RAD2DEG,
        };
    }

    reset() { this._q = [1, 0, 0, 0]; this._init = false; }
}

// ── Matrix utilities (arr-of-arr, row-major) ───────────────────────────────────
function _mm(A, B) {
    return A.map(ar => B[0].map((_, j) => ar.reduce((s, v, k) => s + v * B[k][j], 0)));
}
function _add(A, B) { return A.map((r, i) => r.map((v, j) => v + B[i][j])); }
function _sub(A, B) { return A.map((r, i) => r.map((v, j) => v - B[i][j])); }
function _T(A) { return A[0].map((_, j) => A.map(r => r[j])); }
function _eye(n) { return Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => +(i === j))); }
function _diag(v) { return v.map((vi, i) => v.map((_, j) => i === j ? vi : 0)); }
function _inv(A) {
    const n = A.length;
    const M = A.map(r => [...r]), I = _eye(n);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        [M[c], M[p]] = [M[p], M[c]]; [I[c], I[p]] = [I[p], I[c]];
        const sc = M[c][c];
        if (Math.abs(sc) < 1e-12) continue;
        M[c] = M[c].map(v => v / sc); I[c] = I[c].map(v => v / sc);
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c];
            M[r] = M[r].map((v, k) => v - f * M[c][k]);
            I[r] = I[r].map((v, k) => v - f * I[c][k]);
        }
    }
    return I;
}

// ── EKF filter ─────────────────────────────────────────────────────────────────
// Extended Kalman Filter — quaternion state, accel + optional mag measurements.
// Based on Steppe School lecture notes (Yerkebulan Massalim), with corrected Jacobian.
export class EKFFilter {
    constructor() {
        this._q = [1, 0, 0, 0];          // quaternion state [q0, q1, q2, q3]
        this._P = _eye(4);                // error covariance
        this._Q = _diag([1e-4, 1e-4, 1e-4, 1e-4]);  // process noise
        this._Ra = 0.1;                   // accel measurement noise variance
        this._Rm = 0.5;                   // mag measurement noise variance
        this._Mx      = 1.0;              // Earth field horizontal component
        this._Mz      = 0.0;              // Earth field vertical component (NED positive down)
        this._magInit = false;
        this._init    = false;
    }

    update(imu, dt) {
        if (!this._init) { this._q = _quatFromAccMag(imu); this._init = true; }
        const [q0, q1, q2, q3] = this._q;
        const gx = imu.gx * DEG2RAD;
        const gy = imu.gy * DEG2RAD;
        const gz = imu.gz * DEG2RAD;

        // ── Prediction ──────────────────────────────────────────────────────
        // F ≈ I + 0.5·dt·Ω(ω)  (first-order quaternion kinematics)
        const h = dt * 0.5;
        const F = [
            [1,      -h*gx, -h*gy, -h*gz],
            [h*gx,   1,      h*gz, -h*gy],
            [h*gy,  -h*gz,   1,     h*gx],
            [h*gz,   h*gy,  -h*gx,  1   ],
        ];
        const qv  = _mm(F, [[q0],[q1],[q2],[q3]]).map(r => r[0]);
        const qn  = Math.hypot(...qv);
        const [p0, p1, p2, p3] = qv.map(v => v / qn);
        let P = _add(_mm(_mm(F, this._P), _T(F)), this._Q);

        // ── Measurement update ───────────────────────────────────────────────
        const an = Math.hypot(imu.ax, imu.ay, imu.az);
        if (an < 1e-6) { this._q = [p0,p1,p2,p3]; this._P = P; return this._euler(); }
        const ax = imu.ax / an, ay = imu.ay / an, az = imu.az / an;

        // Normalise magnetometer; initialise Earth field reference on first use
        const mn = imu.mx != null ? Math.hypot(imu.mx, imu.my, imu.mz) : 0;
        let useMag = mn > 1e-6;
        let nmx = 0, nmy = 0, nmz = 0;
        if (useMag) {
            nmx = imu.mx / mn; nmy = imu.my / mn; nmz = imu.mz / mn;
            if (!this._magInit) {
                // Rotate body mag vector to world frame to estimate Earth field
                const Mxw = (1-2*(p2**2+p3**2))*nmx + 2*(p1*p2-p0*p3)*nmy + 2*(p1*p3+p0*p2)*nmz;
                const Myw =  2*(p1*p2+p0*p3)*nmx + (1-2*(p1**2+p3**2))*nmy + 2*(p2*p3-p0*p1)*nmz;
                const Mzw =  2*(p1*p3-p0*p2)*nmx +  2*(p2*p3+p0*p1)*nmy + (1-2*(p1**2+p2**2))*nmz;
                this._Mx = Math.hypot(Mxw, Myw);  // horizontal (x-y plane)
                this._Mz = Mzw;                    // vertical
                this._magInit = true;
            }
        }

        const Mx = this._Mx, Mz = this._Mz;

        // ── Predicted measurement h(q) and Jacobian Jh ──────────────────────
        // Gravity: h_acc = R_nb^T · [0,0,1]
        const hax = 2*(p1*p3 - p0*p2);
        const hay = 2*(p0*p1 + p2*p3);
        const haz = p0**2 - p1**2 - p2**2 + p3**2;   // = 1-2q1²-2q2² for unit q

        let Jh, z, hz, Rv;
        if (useMag) {
            // Mag: h_mag = R_nb^T · [Mx,0,Mz]
            const hmx = Mx*(p0**2+p1**2-p2**2-p3**2) + 2*Mz*(p1*p3-p0*p2);
            const hmy = 2*Mx*(p1*p2-p0*p3)           + 2*Mz*(p0*p1+p2*p3);
            const hmz = 2*Mx*(p0*p2+p1*p3)           + Mz*(p0**2-p1**2-p2**2+p3**2);
            hz = [hax, hay, haz, hmx, hmy, hmz];
            z  = [ax,  ay,  az,  nmx, nmy, nmz];
            Rv = [this._Ra, this._Ra, this._Ra, this._Rm, this._Rm, this._Rm];
            // 6×4 Jacobian (corrected per slide 49 errata)
            Jh = [
                // ∂ax/∂q
                [-2*p2,              2*p3,              -2*p0,             2*p1             ],
                // ∂ay/∂q  ← corrected: col3=2q3, col4=2q2
                [ 2*p1,              2*p0,               2*p3,             2*p2             ],
                // ∂az/∂q
                [ 2*p0,             -2*p1,              -2*p2,             2*p3             ],
                // ∂mx/∂q
                [ 2*p0*Mx-2*p2*Mz,  2*p1*Mx+2*p3*Mz,  -2*p2*Mx-2*p0*Mz, -2*p3*Mx+2*p1*Mz],
                // ∂my/∂q  ← corrected: full Mx+Mz terms
                [-2*p3*Mx+2*p1*Mz,  2*p2*Mx+2*p0*Mz,   2*p1*Mx+2*p3*Mz, -2*p0*Mx+2*p2*Mz],
                // ∂mz/∂q  ← corrected: full Mx+Mz terms
                [ 2*p2*Mx+2*p0*Mz,  2*p3*Mx-2*p1*Mz,   2*p0*Mx-2*p2*Mz,  2*p1*Mx+2*p3*Mz],
            ];
        } else {
            hz = [hax, hay, haz];
            z  = [ax,  ay,  az ];
            Rv = [this._Ra, this._Ra, this._Ra];
            // 3×4 accel-only Jacobian
            Jh = [
                [-2*p2,  2*p3, -2*p0,  2*p1],
                [ 2*p1,  2*p0,  2*p3,  2*p2],
                [ 2*p0, -2*p1, -2*p2,  2*p3],
            ];
        }

        // ── Kalman gain and correction ───────────────────────────────────────
        const innov = z.map((v, i) => v - hz[i]);
        const R     = _diag(Rv);
        const PJhT  = _mm(P, _T(Jh));                  // 4×n
        const S     = _add(_mm(Jh, PJhT), R);           // n×n
        const Kg    = _mm(PJhT, _inv(S));               // 4×n

        const dq  = _mm(Kg, innov.map(v => [v])).map(r => r[0]);
        const qu  = [p0+dq[0], p1+dq[1], p2+dq[2], p3+dq[3]];
        const qn2 = Math.hypot(...qu);
        this._q   = qu.map(v => v / qn2);
        this._P   = _mm(_sub(_eye(4), _mm(Kg, Jh)), P);

        return this._euler();
    }

    _euler() {
        const [q0, q1, q2, q3] = this._q;
        return {
            roll:  Math.atan2(2*(q0*q1+q2*q3), 1-2*(q1**2+q2**2)) * RAD2DEG,
            pitch: Math.asin(Math.max(-1, Math.min(1, 2*(q0*q2-q3*q1)))) * RAD2DEG,
            yaw:   Math.atan2(2*(q0*q3+q1*q2), 1-2*(q2**2+q3**2))       * RAD2DEG,
        };
    }

    reset() {
        this._q       = [1, 0, 0, 0];
        this._P       = _eye(4);
        this._magInit = false;
        this._init    = false;
    }
}
