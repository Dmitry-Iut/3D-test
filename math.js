/* Маленькая математика: векторы (V3) и матрицы 4x4 в column-major порядке (M4). */
(function (g) {
  'use strict';

  const V3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    }
  };

  const M4 = {
    // a * b
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      }
      return o;
    },

    perspective(fovy, aspect, near, far) {
      const t = 1 / Math.tan(fovy / 2);
      const o = new Float32Array(16);
      o[0] = t / aspect;
      o[5] = t;
      o[10] = (far + near) / (near - far);
      o[11] = -1;
      o[14] = 2 * far * near / (near - far);
      return o;
    },

    lookAt(eye, target, up) {
      const z = V3.norm(V3.sub(eye, target));
      const x = V3.norm(V3.cross(up, z));
      const y = V3.cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1
      ]);
    },

    // Перенос + поворот (R = Rz * Ry * Rx). Возвращает матрицу 4x4 и отдельно 3x3 для нормалей.
    model(tx, ty, tz, ax, ay, az) {
      const cx = Math.cos(ax), sx = Math.sin(ax);
      const cy = Math.cos(ay), sy = Math.sin(ay);
      const cz = Math.cos(az), sz = Math.sin(az);
      const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
      const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
      const r20 = -sy,     r21 = cy * sx,                r22 = cy * cx;
      return {
        m4: new Float32Array([
          r00, r10, r20, 0,
          r01, r11, r21, 0,
          r02, r12, r22, 0,
          tx, ty, tz, 1
        ]),
        r3: new Float32Array([r00, r10, r20, r01, r11, r21, r02, r12, r22])
      };
    }
  };

  g.V3 = V3;
  g.M4 = M4;
})(typeof window !== 'undefined' ? window : globalThis);
