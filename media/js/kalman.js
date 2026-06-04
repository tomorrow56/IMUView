/**
 * 1-D Kalman filter for a single angle axis.
 *
 * State vector  x = [ angle, gyro_bias ]^T
 * Process model     angle_k+1 = angle_k + (gyro - bias) * dt
 *                   bias_k+1  = bias_k
 *
 * The accelerometer provides a noisy direct measurement of the angle,
 * which corrects the gyro-integrated prediction and estimates the bias.
 *
 * Reference: Lauszus, "A Practical Approach to Kalman Filter and How to
 * Implement it" (2012); also used in the TKJElectronics Balance robot.
 */
export class KalmanAngle {
    constructor({
        Q_angle   = 0.001,   // process noise: angle random walk (rad²/s)
        Q_bias    = 0.003,   // process noise: gyro bias random walk (rad/s²)
        R_measure = 0.03,    // measurement noise: accelerometer angle (rad²)
    } = {}) {
        this.Q_angle   = Q_angle;
        this.Q_bias    = Q_bias;
        this.R_measure = R_measure;

        this.angle = 0;      // estimated angle (degrees)
        this.bias  = 0;      // estimated gyro bias (deg/s)

        // 2×2 error covariance matrix
        this.P = [[0, 0], [0, 0]];
    }

    /**
     * @param {number} measuredAngle  Angle from accelerometer (degrees)
     * @param {number} gyroRate       Raw gyro rate for this axis (deg/s)
     * @param {number} dt             Time step (seconds)
     * @returns {number}              Filtered angle (degrees)
     */
    update(measuredAngle, gyroRate, dt) {
        // ── Predict ───────────────────────────────────────────────────────
        const rate = gyroRate - this.bias;
        this.angle += dt * rate;

        // P = F·P·Fᵀ + Q   (F = [[1,-dt],[0,1]])
        this.P[0][0] += dt * (dt * this.P[1][1] - this.P[0][1] - this.P[1][0] + this.Q_angle);
        this.P[0][1] -= dt * this.P[1][1];
        this.P[1][0] -= dt * this.P[1][1];
        this.P[1][1] += this.Q_bias * dt;

        // ── Update ────────────────────────────────────────────────────────
        const S  = this.P[0][0] + this.R_measure;   // innovation covariance
        const K0 = this.P[0][0] / S;                // Kalman gain for angle
        const K1 = this.P[1][0] / S;                // Kalman gain for bias

        const innovation = measuredAngle - this.angle;
        this.angle += K0 * innovation;
        this.bias  += K1 * innovation;

        // P = (I − K·H)·P   (save pre-update elements first)
        const P00 = this.P[0][0], P01 = this.P[0][1];
        this.P[0][0] -= K0 * P00;
        this.P[0][1] -= K0 * P01;
        this.P[1][0] -= K1 * P00;
        this.P[1][1] -= K1 * P01;

        return this.angle;
    }

    /** Reset state (e.g. after a reconnect or manual re-zero). */
    reset(angle = 0) {
        this.angle = angle;
        this.bias  = 0;
        this.P     = [[0, 0], [0, 0]];
    }
}
