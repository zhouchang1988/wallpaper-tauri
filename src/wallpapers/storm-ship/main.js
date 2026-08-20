import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

/* =====================================================================
 * 0. 全局常量 —— Gerstner 波浪参数（顶点着色器与 CPU 采样共用同一份）
 * ===================================================================== */
const WAVES = [
  { dx:  0.34, dz:  0.91, amp: 2.60, len: 62.0, speed: 1.00, q: 0.72 }, // 主浪
  { dx: -0.60, dz:  0.74, amp: 1.45, len: 31.0, speed: 1.15, q: 0.62 }, // 次浪
  { dx:  0.87, dz: -0.42, amp: 0.80, len: 17.0, speed: 1.30, q: 0.50 }, // 侧浪
  { dx: -0.95, dz: -0.25, amp: 0.40, len:  8.5, speed: 1.50, q: 0.42 }, // 碎浪
  { dx:  0.55, dz: -0.62, amp: 0.20, len:  4.3, speed: 1.70, q: 0.32 }, // 涟漪
  { dx:  0.12, dz: -0.99, amp: 0.11, len:  2.6, speed: 1.90, q: 0.28 }, // 碎波
  { dx: -0.50, dz:  0.52, amp: 0.07, len:  1.7, speed: 2.10, q: 0.26 }, // 细浪
];
for (const w of WAVES) {
  const l = Math.hypot(w.dx, w.dz);
  w.dx /= l; w.dz /= l;
  w.k = (Math.PI * 2) / w.len;
  w.omega = Math.sqrt(9.8 * w.k) * w.speed;
}

/** CPU 端浪高采样（与着色器中的垂直分量一致），用于船体姿态解算 */
function waveHeight(x, z, t) {
  let y = 0;
  for (const w of WAVES) y += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t);
  return y;
}

/* =====================================================================
 * 1. 渲染器 / 场景 / 相机（固定 45° 俯视 + 圆周巡航，无交互控制）
 * ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f18);
scene.fog = new THREE.FogExp2(0x0d1420, 0.013);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 1200);

// 45° 俯视圆周巡航：高度 = 水平半径（tan45° = 1）
const CAM_RADIUS = 52;          // 巡航半径
const CAM_HEIGHT = 52;          // 45° 俯视
const CAM_SPEED  = 0.055;       // 巡航角速度 rad/s（一圈约 114 秒）
let camAngle = Math.PI * 0.3;

/* =====================================================================
 * 2. 灯光 —— 昏暗环境光 + 冷色平行光 + 闪电灯 + 船上暖光
 * ===================================================================== */
const ambient = new THREE.AmbientLight(0x3a4a66, 1.55);
scene.add(ambient);

const moonLight = new THREE.DirectionalLight(0x6a7fa8, 1.3);
moonLight.position.set(-60, 90, -40);
scene.add(moonLight);

const fillLight = new THREE.DirectionalLight(0x5a6c8e, 1.1);
fillLight.position.set(80, 40, 80);
scene.add(fillLight);

const lightningLight = new THREE.DirectionalLight(0xcfe0ff, 0);
lightningLight.position.set(100, 160, 60);
scene.add(lightningLight);

/* =====================================================================
 * 3. 天空穹顶 —— FBM 噪声乌云，随时间流动，闪电时整体被照亮
 * ===================================================================== */
const skyUniforms = {
  uTime:  { value: 0 },
  uFlash: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(560, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uFlash;
      varying vec3 vDir;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 horizon = vec3(0.10, 0.125, 0.17);
        vec3 zenith  = vec3(0.03, 0.045, 0.08);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));

        vec2 uv = vDir.xz / (vDir.y + 0.18);
        float cloud = fbm(uv * 1.6 + vec2(uTime * 0.016, uTime * 0.006));
        cloud = smoothstep(0.32, 0.78, cloud);

        vec3 moonDir = normalize(vec3(-0.45, 0.52, -0.30));
        float mdot = max(dot(normalize(vDir), moonDir), 0.0);
        col += (pow(mdot, 600.0) * 1.6 + pow(mdot, 24.0) * 0.12)
             * vec3(0.78, 0.84, 0.96) * (1.0 - cloud * 0.9) * smoothstep(0.05, 0.4, h);

        vec3 cloudCol = mix(vec3(0.10, 0.12, 0.16), vec3(0.23, 0.26, 0.32), cloud);
        col = mix(col, cloudCol, cloud * smoothstep(0.0, 0.28, h));

        col += uFlash * cloud * vec3(0.75, 0.82, 1.0) * (1.2 - h * 0.8);
        col += uFlash * 0.10 * vec3(0.7, 0.8, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
scene.add(sky);

/* =====================================================================
 * 4. 海洋 —— Gerstner 波顶点着色器 + 泡沫/渐变色片元着色器
 * ===================================================================== */
const oceanUniforms = {
  uTime:   { value: 0 },
  uFlash:  { value: 0 },
  uWaves:  { value: WAVES.map(w => new THREE.Vector4(w.dx, w.dz, w.amp, w.k)) },
  uOmega:  { value: WAVES.map(w => w.omega) },
  uSteep:  { value: WAVES.map(w => w.q) },
  uDeep:   { value: new THREE.Color(0x0a2231) },
  uShallow:{ value: new THREE.Color(0x36506a) },
  uFoamCol:{ value: new THREE.Color(0xcfe0e8) },
  uFogColor:{ value: new THREE.Color(0x0d1420) },
  uFogDensity:{ value: 0.013 },
};

const oceanGeo = new THREE.PlaneGeometry(1100, 1100, 340, 340);
oceanGeo.rotateX(-Math.PI / 2);

const oceanMat = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform vec4  uWaves[7];
    uniform float uOmega[7];
    uniform float uSteep[7];

    varying vec3  vWorldPos;
    varying vec3  vNormal;
    varying float vHeight;
    varying float vCrest;

    void main() {
      vec3 p = position;
      float y = 0.0;
      float dHdx = 0.0, dHdz = 0.0;
      float crest = 0.0;

      for (int i = 0; i < 7; i++) {
        vec2  dir = uWaves[i].xy;
        float amp = uWaves[i].z;
        float k   = uWaves[i].w;
        float ph  = k * dot(dir, p.xz) - uOmega[i] * uTime;
        float s = sin(ph), c = cos(ph);

        y += amp * s;
        p.x += uSteep[i] * amp * dir.x * c;
        p.z += uSteep[i] * amp * dir.y * c;
        dHdx += amp * k * dir.x * c;
        dHdz += amp * k * dir.y * c;
        crest += s * (amp / 2.6);
      }
      p.y = y;

      vWorldPos = p;
      vNormal   = normalize(vec3(-dHdx, 1.0, -dHdz));
      vHeight   = clamp(y / 4.5 * 0.5 + 0.5, 0.0, 1.0);
      vCrest    = clamp(crest * 0.5 + 0.5, 0.0, 1.0);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3  uDeep, uShallow, uFoamCol, uFogColor;
    uniform float uFlash, uTime, uFogDensity;

    varying vec3  vWorldPos;
    varying vec3  vNormal;
    varying float vHeight;
    varying float vCrest;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                 mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }

    void main() {
      vec3 col = mix(uDeep * 0.55, uDeep, smoothstep(0.0, 0.42, vHeight));
      col = mix(col, uShallow, smoothstep(0.45, 0.95, vHeight));

      float rn1 = noise(vWorldPos.xz * 1.3 + vec2(uTime * 0.55, -uTime * 0.38));
      float rn2 = noise(vWorldPos.xz * 3.2 + vec2(-uTime * 0.72, uTime * 0.47));
      vec3 nrm = normalize(vNormal + vec3(rn1 - 0.5, 0.0, rn2 - 0.5) * 0.6);

      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fres = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.0);
      col += fres * vec3(0.10, 0.14, 0.18) * (0.7 + 0.6 * rn2);

      vec3 moonDir = normalize(vec3(-0.45, 0.52, -0.30));
      float spec = pow(max(dot(nrm, normalize(moonDir + viewDir)), 0.0), 120.0);
      col += spec * vec3(0.30, 0.36, 0.46) * (0.5 + 0.5 * rn1);

      float n = noise(vWorldPos.xz * 0.9 + uTime * 0.35)
              * noise(vWorldPos.xz * 0.23 - uTime * 0.12);
      float breakup = 0.35 + 0.65 * noise(vWorldPos.xz * 2.6 + uTime * 0.5);
      float foam = smoothstep(0.68, 1.0, vCrest * 0.8 + vHeight * 0.3 + n * 0.45 + (rn1 - 0.5) * 0.22 - 0.2);
      col = mix(col, uFoamCol, foam * breakup * 0.9);

      vec3 lDir = normalize(vec3(0.45, 0.75, 0.3));
      float lit = max(dot(nrm, lDir), 0.0);
      col += uFlash * (0.25 + lit) * vec3(0.62, 0.70, 0.92);
      col += uFlash * pow(max(dot(nrm, normalize(lDir + viewDir)), 0.0), 60.0) * vec3(0.9, 0.95, 1.0) * 1.4;

      float dist = length(cameraPosition - vWorldPos);
      float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }`
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.frustumCulled = false;
scene.add(ocean);

/* =====================================================================
 * 5. 程序化纹理 —— 老旧木板 & 破损帆布 & 柔和圆点
 * ===================================================================== */
function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4a3524';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    const y = row * 32;
    const tone = 52 + Math.random() * 22;
    g.fillStyle = `rgb(${tone + 14},${tone - 4},${tone - 20})`;
    g.fillRect(0, y, 256, 30);
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(0, y + 30, 256, 2);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(190,200,190,.06)';
      g.fillRect(Math.random() * 256, y + Math.random() * 30, 1 + Math.random() * 22, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSailTexture(torn) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9bda4';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 36) {
    g.fillStyle = 'rgba(90,78,60,.35)';
    g.fillRect(x, 0, 2, 256);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(80,70,55,${0.05 + Math.random() * 0.10})`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 26, 0, 7);
    g.fill();
  }
  if (torn) {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const x = 30 + Math.random() * 200, y = 60 + Math.random() * 170;
      g.beginPath();
      for (let a = 0; a < 6.3; a += 0.5) {
        const r = 6 + Math.random() * 14;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.fill();
    }
    g.beginPath();
    g.moveTo(0, 256);
    for (let x = 0; x <= 256; x += 12) g.lineTo(x, 226 + Math.random() * 22);
    g.lineTo(256, 256);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const woodTex = makeWoodTexture();
const sailTex = makeSailTexture(false);
const sailTornTex = makeSailTexture(true);

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dotTex = makeDotTexture();

const woodMat  = new THREE.MeshStandardMaterial({ map: woodTex, color: 0xbb9a70, roughness: 0.92, metalness: 0.05 });
const darkWood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x83694a, roughness: 0.95 });

/* =====================================================================
 * 6. 帆船 —— 程序化建模：船体 / 甲板 / 桅杆 / 帆 / 索具 / 灯
 * ===================================================================== */
const ship = new THREE.Group();
scene.add(ship);

const HULL = { len: 34, sections: 24, across: 13 };

function hullHalfWidth(t) {
  const bow = Math.pow(Math.sin(Math.min(t / 0.18, 1) * Math.PI / 2), 0.75);
  const mid = Math.sin(Math.PI * (0.12 + t * 0.85)) * 0.4 + 0.75;
  return 4.3 * bow * mid;
}
function hullKeelY(t) { return -4.6 + Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 2.6; }
function hullGunwaleY(t) { return 2.0 + Math.pow(Math.abs(t - 0.45) * 2, 2.5) * 1.5; }

(function buildHull() {
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= HULL.sections; i++) {
    const t = i / HULL.sections;
    const z = (t - 0.5) * HULL.len;
    const hw = hullHalfWidth(t);
    const ky = hullKeelY(t);
    const gy = hullGunwaleY(t);
    for (let j = 0; j <= HULL.across; j++) {
      const s = (j / HULL.across) * 2 - 1;
      const x = hw * s;
      const y = ky + (gy - ky) * Math.pow(Math.abs(s), 0.62);
      pos.push(x, y, z);
      uvs.push(t * 5, j / HULL.across);
    }
  }
  const row = HULL.across + 1;
  for (let i = 0; i < HULL.sections; i++)
    for (let j = 0; j < HULL.across; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const hull = new THREE.Mesh(geo, woodMat);
  hull.material.side = THREE.DoubleSide;
  ship.add(hull);
})();

(function buildDeck() {
  const pos = [], uvs = [], idx = [];
  const STEP = 24;
  for (let i = 0; i <= STEP; i++) {
    const t = 0.04 + (i / STEP) * 0.92;
    const z = (t - 0.5) * HULL.len;
    const hw = hullHalfWidth(t) * 0.96;
    const y = hullGunwaleY(t) - 1.15;
    pos.push(-hw, y, z, hw, y, z);
    uvs.push(t * 5, 0, t * 5, 1);
  }
  for (let i = 0; i < STEP; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: woodTex, color: 0xa5906c, roughness: 0.9, side: THREE.DoubleSide,
  }));
  ship.add(deck);
})();

function addBox(w, h, d, x, y, z, mat = darkWood) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  ship.add(m);
  return m;
}
addBox(6.4, 3.2, 7.5, 0, 3.0, -12.2);
addBox(5.2, 2.6, 5.0, 0, 5.6, -12.8);
addBox(4.6, 1.8, 4.0, 0, 2.4, 11.6);
addBox(1.2, 1.4, 1.2, 0, 3.4, -9.0, darkWood);
const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 8, 16), darkWood);
wheel.position.set(0, 4.3, -9.0);
ship.add(wheel);
const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 1.4), darkWood);
rudder.position.set(0, -1.2, -17.2);
rudder.rotation.x = 0.18;
ship.add(rudder);
const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 9, 8), darkWood);
bowsprit.rotation.x = Math.PI / 2 - 0.32;
bowsprit.position.set(0, 3.4, 19.5);
ship.add(bowsprit);

const sails = [];

function makeSail(w, h, torn) {
  const geo = new THREE.PlaneGeometry(w, h, 10, 8);
  const mat = new THREE.MeshStandardMaterial({
    map: torn ? sailTornTex : sailTex,
    color: 0xd8ccb4, roughness: 0.85,
    emissive: 0x322c22,
    side: THREE.DoubleSide,
    transparent: true, alphaTest: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.billow = {
    base: geo.attributes.position.array.slice(),
    w, h,
    phase: Math.random() * Math.PI * 2,
    amp: 0.9 + w * 0.14,
  };
  sails.push(mesh);
  return mesh;
}

function makeMast(z, height, sailDefs) {
  const g = new THREE.Group();
  const baseY = 1.0;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, height, 8), darkWood);
  mast.position.y = baseY + height / 2;
  g.add(mast);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, height * 0.28, 8), darkWood);
  top.position.y = baseY + height + height * 0.12;
  g.add(top);

  for (const sd of sailDefs) {
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, sd.w + 1.6, 8), darkWood);
    yard.rotation.z = Math.PI / 2;
    yard.position.y = sd.y;
    g.add(yard);

    const sail = makeSail(sd.w, sd.h, sd.torn);
    sail.position.y = sd.y - sd.h / 2 - 0.15;
    g.add(sail);
  }

  g.position.z = z;
  ship.add(g);
  return g;
}

makeMast( 9.5, 21, [
  { y: 19.0, w: 10.5, h: 5.0, torn: false },
  { y: 13.2, w: 12.5, h: 6.0, torn: true  },
]);
makeMast(-1.0, 26, [
  { y: 23.5, w: 12.0, h: 5.6, torn: false },
  { y: 16.8, w: 14.0, h: 6.8, torn: false },
  { y: 10.0, w: 12.0, h: 5.2, torn: true  },
]);
makeMast(-11.0, 17, [
  { y: 14.5, w: 8.0, h: 4.4, torn: false },
]);

(function buildJib() {
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 20.0,  9.5,
    0,  4.5, 22.5,
    0,  4.0, 10.5,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 0, 0, 0]), 2));
  geo.computeVertexNormals();
  const jib = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: sailTex, color: 0xb5a98f, roughness: 0.9,
    side: THREE.DoubleSide, transparent: true, opacity: 0.96,
  }));
  ship.add(jib);
})();

(function buildRigging() {
  const pts = [];
  const addLine = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const masts = [
    { z:  9.5, top: 23.5 },
    { z: -1.0, top: 29.5 },
    { z: -11.0, top: 19.0 },
  ];
  for (const m of masts) {
    addLine(new THREE.Vector3( 3.4, 2.2, m.z + 1.5), new THREE.Vector3(0, m.top, m.z));
    addLine(new THREE.Vector3(-3.4, 2.2, m.z + 1.5), new THREE.Vector3(0, m.top, m.z));
  }
  addLine(new THREE.Vector3(0, 23.5, 9.5),  new THREE.Vector3(0, 4.5, 22.5));
  addLine(new THREE.Vector3(0, 29.5, -1.0), new THREE.Vector3(0, 23.5, 9.5));
  addLine(new THREE.Vector3(0, 19.0, -11),  new THREE.Vector3(0, 29.5, -1.0));
  addLine(new THREE.Vector3(0, 19.0, -11),  new THREE.Vector3(0, 6.0, -15.5));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  ship.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0.85 })));
})();

(function buildRailings() {
  const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6);
  const railPts = [];
  for (let side = -1; side <= 1; side += 2) {
    let prevTop = null;
    for (let i = 0; i <= 13; i++) {
      const t = 0.05 + (i / 13) * 0.9;
      const z = (t - 0.5) * HULL.len;
      const hw = hullHalfWidth(t) * 0.95;
      const gy = hullGunwaleY(t);
      const post = new THREE.Mesh(postGeo, darkWood);
      post.position.set(side * hw, gy + 0.45, z);
      ship.add(post);
      const top = new THREE.Vector3(side * hw, gy + 0.95, z);
      if (prevTop) railPts.push(prevTop.x, prevTop.y, prevTop.z, top.x, top.y, top.z);
      prevTop = top;
    }
  }
  const railGeo = new THREE.BufferGeometry();
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPts, 3));
  ship.add(new THREE.LineSegments(railGeo, new THREE.LineBasicMaterial({ color: 0x2a1f14 })));
})();

(function buildDeckCargo() {
  const barrelGeo = new THREE.CylinderGeometry(0.5, 0.55, 1.1, 10);
  for (const [x, z] of [[2.2, 4.5], [-2.4, 2.0], [1.8, -4.0], [-2.0, -6.5]]) {
    const b = new THREE.Mesh(barrelGeo, darkWood);
    b.position.set(x, 1.45, z);
    ship.add(b);
  }
  addBox(1.6, 1.2, 1.6, -1.8, 1.6, 6.8);
  addBox(1.2, 0.9, 1.2, -0.6, 1.5, 7.4);
})();

const flag = (function () {
  const geo = new THREE.PlaneGeometry(3.2, 1.6, 12, 4);
  geo.translate(1.6, 0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x7a2020, roughness: 0.85, side: THREE.DoubleSide,
  }));
  mesh.position.set(0, 30.5, -1.0);
  mesh.userData.base = geo.attributes.position.array.slice();
  ship.add(mesh);
  return mesh;
})();

const cabinLight = new THREE.PointLight(0xff9a3c, 22, 26, 2.0);
cabinLight.position.set(0, 4.4, -13.0);
ship.add(cabinLight);
const windowMat = new THREE.MeshStandardMaterial({
  color: 0x201408, emissive: 0xffb45e, emissiveIntensity: 2.6,
});
for (let i = -1; i <= 1; i++) {
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), windowMat);
  win.position.set(i * 1.6, 5.6, -15.35);
  win.rotation.y = Math.PI;
  ship.add(win);
}
const lantern = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x442200, emissive: 0xffc470, emissiveIntensity: 3.5 })
);
lantern.position.set(0, 8.2, -15.2);
ship.add(lantern);
const lanternLight = new THREE.PointLight(0xffa050, 14, 30, 2.0);
lanternLight.position.copy(lantern.position);
ship.add(lanternLight);
const deckGlow = new THREE.PointLight(0x9fb8dc, 46, 80, 1.7);
deckGlow.position.set(0, 26, 0);
ship.add(deckGlow);

/* =====================================================================
 * 7. 雨幕 —— LineSegments 雨丝粒子，斜向飘落，环绕相机循环
 * ===================================================================== */
const RAIN_COUNT = 2200;
const RAIN_AREA = 130, RAIN_TOP = 60;
const rainPos = new Float32Array(RAIN_COUNT * 6);
const rainVel = new Float32Array(RAIN_COUNT * 3);

for (let i = 0; i < RAIN_COUNT; i++) {
  rainPos[i * 6]     = (Math.random() - 0.5) * RAIN_AREA * 2;
  rainPos[i * 6 + 1] = Math.random() * RAIN_TOP;
  rainPos[i * 6 + 2] = (Math.random() - 0.5) * RAIN_AREA * 2;
  rainVel[i * 3]     = -13 + Math.random() * 3;
  rainVel[i * 3 + 1] = -46 - Math.random() * 14;
  rainVel[i * 3 + 2] = 4 + Math.random() * 3;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
  color: 0x8fa5bd, transparent: true, opacity: 0.24,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
rain.frustumCulled = false;
scene.add(rain);

function updateRain(dt) {
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < RAIN_COUNT; i++) {
    const i6 = i * 6, i3 = i * 3;
    let x = rainPos[i6], y = rainPos[i6 + 1], z = rainPos[i6 + 2];
    x += rainVel[i3] * dt;
    y += rainVel[i3 + 1] * dt;
    z += rainVel[i3 + 2] * dt;
    if (y < -2) {
      y = RAIN_TOP - Math.random() * 12;
      x = cx + (Math.random() - 0.5) * RAIN_AREA * 2;
      z = cz + (Math.random() - 0.5) * RAIN_AREA * 2;
    }
    rainPos[i6] = x; rainPos[i6 + 1] = y; rainPos[i6 + 2] = z;
    rainPos[i6 + 3] = x - rainVel[i3] * 0.028;
    rainPos[i6 + 4] = y - rainVel[i3 + 1] * 0.028;
    rainPos[i6 + 5] = z - rainVel[i3 + 2] * 0.028;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

/* =====================================================================
 * 8. 船首浪花 —— CPU 粒子：破浪喷溅 + 重力回落
 * ===================================================================== */
const SPLASH_MAX = 360;
const splashPos = new Float32Array(SPLASH_MAX * 3);
const splashVel = new Float32Array(SPLASH_MAX * 3);
const splashLife = new Float32Array(SPLASH_MAX).fill(0);
const splashGeo = new THREE.BufferGeometry();
splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
const splash = new THREE.Points(splashGeo, new THREE.PointsMaterial({
  color: 0xdfeaf2, size: 0.55, map: dotTex, transparent: true, opacity: 0.75,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
splash.frustumCulled = false;
scene.add(splash);

function spawnSplash(wx, wy, wz, strength) {
  for (let n = 0; n < 5; n++) {
    for (let i = 0; i < SPLASH_MAX; i++) {
      if (splashLife[i] > 0) continue;
      splashLife[i] = 0.7 + Math.random() * 0.6;
      splashPos[i * 3]     = wx + (Math.random() - 0.5) * 2.4;
      splashPos[i * 3 + 1] = wy;
      splashPos[i * 3 + 2] = wz + (Math.random() - 0.5) * 2.4;
      splashVel[i * 3]     = (Math.random() - 0.5) * 7 * strength;
      splashVel[i * 3 + 1] = (3 + Math.random() * 7) * strength;
      splashVel[i * 3 + 2] = (2 + Math.random() * 5) * strength;
      break;
    }
  }
}

function updateSplash(dt) {
  for (let i = 0; i < SPLASH_MAX; i++) {
    if (splashLife[i] <= 0) { splashPos[i * 3 + 1] = -999; continue; }
    splashLife[i] -= dt;
    splashVel[i * 3 + 1] -= 22 * dt;
    splashPos[i * 3]     += splashVel[i * 3] * dt;
    splashPos[i * 3 + 1] += splashVel[i * 3 + 1] * dt;
    splashPos[i * 3 + 2] += splashVel[i * 3 + 2] * dt;
  }
  splashGeo.attributes.position.needsUpdate = true;
}

/* =====================================================================
 * 8b. 船迹泡沫 —— 舷侧与船尾持续留下的泡沫带
 * ===================================================================== */
const FOAM_MAX = 700;
const foamPos  = new Float32Array(FOAM_MAX * 3);
const foamCol  = new Float32Array(FOAM_MAX * 3);
const foamVel  = new Float32Array(FOAM_MAX * 3);
const foamLife = new Float32Array(FOAM_MAX).fill(0);
const foamSpan = new Float32Array(FOAM_MAX);
const foamBase = new Float32Array(FOAM_MAX);
let foamCursor = 0;
const foamGeo = new THREE.BufferGeometry();
foamGeo.setAttribute('position', new THREE.BufferAttribute(foamPos, 3));
foamGeo.setAttribute('color', new THREE.BufferAttribute(foamCol, 3));
const foam = new THREE.Points(foamGeo, new THREE.PointsMaterial({
  size: 0.95, map: dotTex, vertexColors: true, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
foam.frustumCulled = false;
scene.add(foam);

function spawnFoam(wx, wz, brightness, spread = 1.2) {
  const i = foamCursor;
  foamCursor = (foamCursor + 1) % FOAM_MAX;
  foamSpan[i] = foamLife[i] = 1.6 + Math.random() * 1.8;
  foamBase[i] = brightness;
  foamPos[i * 3]     = wx + (Math.random() - 0.5) * spread;
  foamPos[i * 3 + 1] = -999;
  foamPos[i * 3 + 2] = wz + (Math.random() - 0.5) * spread;
  foamVel[i * 3]     = (Math.random() - 0.5) * 0.8;
  foamVel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
}

function updateFoam(dt, t) {
  for (let i = 0; i < FOAM_MAX; i++) {
    if (foamLife[i] <= 0) continue;
    foamLife[i] -= dt;
    foamPos[i * 3]     += foamVel[i * 3] * dt;
    foamPos[i * 3 + 2] += foamVel[i * 3 + 2] * dt;
    if (foamLife[i] <= 0) { foamPos[i * 3 + 1] = -999; foamCol[i * 3] = foamCol[i * 3 + 1] = foamCol[i * 3 + 2] = 0; continue; }
    foamPos[i * 3 + 1] = waveHeight(foamPos[i * 3], foamPos[i * 3 + 2], t) + 0.18;
    const c = foamBase[i] * Math.pow(foamLife[i] / foamSpan[i], 1.4) * 0.5;
    foamCol[i * 3] = c * 0.9; foamCol[i * 3 + 1] = c * 0.96; foamCol[i * 3 + 2] = c;
  }
  foamGeo.attributes.position.needsUpdate = true;
  foamGeo.attributes.color.needsUpdate = true;
}

/* =====================================================================
 * 9. 闪电系统 —— 随机多脉冲闪烁 + 天空/海面/屏幕联动 + 可见闪电折线
 * ===================================================================== */
const flashOverlay = document.getElementById('flash-overlay');
let flash = 0;
let nextFlashAt = 2.5;
let flashPulse = null;

const BOLT_SEGS = 20, BOLT_BRANCHES = 3, BRANCH_SEGS = 7;
const boltPos = new Float32Array((BOLT_SEGS + BOLT_BRANCHES * BRANCH_SEGS) * 2 * 3);
const boltGeo = new THREE.BufferGeometry();
boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
const bolt = new THREE.LineSegments(boltGeo, new THREE.LineBasicMaterial({
  color: 0xdde8ff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
bolt.frustumCulled = false;
scene.add(bolt);

const boltGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTex, color: 0xbdd2ff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
boltGlow.scale.set(120, 90, 1);
scene.add(boltGlow);

function regenerateBolt() {
  const ang = Math.random() * Math.PI * 2;
  const dist = 180 + Math.random() * 220;
  let x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
  let o = 0;
  const main = [];
  for (let i = 0; i <= BOLT_SEGS; i++) {
    main.push([x, 260 * (1 - i / BOLT_SEGS), z]);
    x += (Math.random() - 0.5) * 22;
    z += (Math.random() - 0.5) * 22;
  }
  for (let i = 0; i < BOLT_SEGS; i++) {
    boltPos.set(main[i], o); o += 3;
    boltPos.set(main[i + 1], o); o += 3;
  }
  for (let b = 0; b < BOLT_BRANCHES; b++) {
    let [bx, by, bz] = main[3 + Math.floor(Math.random() * (BOLT_SEGS - 8))];
    const dx = (Math.random() - 0.5) * 9, dz = (Math.random() - 0.5) * 9;
    for (let s = 0; s < BRANCH_SEGS; s++) {
      const nx = bx + dx + (Math.random() - 0.5) * 10;
      const ny = by - 8 - Math.random() * 14;
      const nz = bz + dz + (Math.random() - 0.5) * 10;
      boltPos[o++] = bx; boltPos[o++] = by; boltPos[o++] = bz;
      boltPos[o++] = nx; boltPos[o++] = ny; boltPos[o++] = nz;
      bx = nx; by = ny; bz = nz;
    }
  }
  boltGeo.attributes.position.needsUpdate = true;
  const base = main[BOLT_SEGS];
  boltGlow.position.set(base[0], 14, base[2]);
  lightningLight.position.set(base[0], 160, base[2]);
}

function scheduleFlash(now) {
  const pulses = [];
  const n = 2 + Math.floor(Math.random() * 3);
  let t = 0;
  for (let i = 0; i < n; i++) {
    pulses.push({ t, amp: 0.5 + Math.random() * 0.5, dur: 0.07 + Math.random() * 0.09 });
    t += 0.12 + Math.random() * 0.2;
  }
  flashPulse = { start: now, pulses };
  regenerateBolt();
  nextFlashAt = now + 2.5 + Math.random() * 6.5;
}

function updateFlash(now) {
  flash = 0;
  if (flashPulse) {
    const e = now - flashPulse.start;
    for (const p of flashPulse.pulses) {
      const d = (e - p.t) / p.dur;
      if (d >= 0 && d <= 1) flash = Math.max(flash, p.amp * Math.sin(d * Math.PI));
    }
    if (e > 1.2) flashPulse = null;
  }
  lightningLight.intensity = flash * 4.2;
  ambient.intensity = 1.55 + flash * 1.2;
  skyUniforms.uFlash.value = flash;
  oceanUniforms.uFlash.value = flash;
  bolt.material.opacity = flash * 0.9;
  boltGlow.material.opacity = flash * 0.55;
  bloom.strength = 0.55 + flash * 0.85;
  flashOverlay.style.opacity = (flash * 0.22).toFixed(3);
}

/* =====================================================================
 * 10. 后期处理 —— Render + UnrealBloom + Output
 * ===================================================================== */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.65, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* =====================================================================
 * 11. 动画辅助 —— 帆布鼓风 / 旗帜飘扬 / 船体随浪姿态
 * ===================================================================== */
const tmpV = new THREE.Vector3();

function updateSails(t) {
  for (const sail of sails) {
    const b = sail.userData.billow;
    const pos = sail.geometry.attributes.position;
    const base = b.base;
    const wind = 1.0 + Math.sin(t * 0.7 + b.phase) * 0.25;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      const x = base[ix], y = base[ix + 1];
      const u = x / b.w + 0.5;
      const v = y / b.h + 0.5;
      let z = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * b.amp * wind;
      const edge = 1.0 - v;
      z += Math.sin(t * 5.2 + u * 7.0 + b.phase) * 0.22 * edge * edge * wind;
      z += Math.sin(t * 9.0 + u * 13.0 + b.phase * 2.0) * 0.08 * edge * wind;
      pos.array[ix]     = x;
      pos.array[ix + 1] = y;
      pos.array[ix + 2] = z;
    }
    pos.needsUpdate = true;
    sail.geometry.computeVertexNormals();
    sail.rotation.y = 0.10 + Math.sin(t * 0.5 + b.phase) * 0.05;
  }
}

function updateFlag(t) {
  const pos = flag.geometry.attributes.position;
  const base = flag.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const ix = i * 3;
    const x = base[ix];
    const k = x / 3.2;
    pos.array[ix + 1] = base[ix + 1] + Math.sin(t * 8 + x * 2.2) * 0.16 * k;
    pos.array[ix + 2] = Math.sin(t * 10 + x * 3.0) * 0.42 * k;
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
}

const shipState = { pitch: 0, roll: 0, heave: 0, heading: -0.12 };
const SHIP_SPEED = 2.4;
const TURN_RATE = SHIP_SPEED / 210;
function updateShip(t, dt) {
  shipState.heading += TURN_RATE * dt;
  ship.position.x += Math.sin(shipState.heading) * SHIP_SPEED * dt;
  ship.position.z += Math.cos(shipState.heading) * SHIP_SPEED * dt;

  const bow = tmpV.set(0, 0, 14);  ship.localToWorld(bow);
  const hBow = waveHeight(bow.x, bow.z, t);
  const hStern = waveHeight(ship.position.x, ship.position.z - 14, t);
  const hPort = waveHeight(ship.position.x - 5, ship.position.z, t);
  const hStar = waveHeight(ship.position.x + 5, ship.position.z, t);
  const hMid = waveHeight(ship.position.x, ship.position.z, t);

  const targetHeave = hMid + 1.6;
  const targetPitch = Math.atan2(hStern - hBow, 28) * 1.15;
  const targetRoll  = Math.atan2(hPort - hStar, 10) * 1.35;

  const k = Math.min(dt * 2.2, 1);
  shipState.heave += (targetHeave - shipState.heave) * k;
  shipState.pitch += (targetPitch - shipState.pitch) * k;
  shipState.roll  += (targetRoll  - shipState.roll)  * k;

  ship.position.y = shipState.heave;
  ship.rotation.x = shipState.pitch;
  ship.rotation.z = shipState.roll + Math.sin(t * 0.45) * 0.03;
  ship.rotation.y = shipState.heading + Math.sin(t * 0.22) * 0.04;

  const bowWorldY = ship.position.y + Math.sin(-shipState.pitch) * 14;
  if (bowWorldY < hBow + 0.6 && Math.random() < 0.55) {
    const wp = tmpV.set(0, 0, 15); ship.localToWorld(wp);
    spawnSplash(wp.x, hBow + 0.3, wp.z, 1.0 + Math.random() * 0.6);
  }
  if (Math.abs(shipState.roll) > 0.12 && Math.random() < 0.10) {
    const side = shipState.roll > 0 ? 4.5 : -4.5;
    const wp = tmpV.set(side, 0, (Math.random() - 0.5) * 18); ship.localToWorld(wp);
    spawnSplash(wp.x, hMid + 0.4, wp.z, 0.6);
  }
  for (let n = 0; n < 2; n++) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const wp = tmpV.set(side * 4.1, 0, 12 - Math.random() * 27); ship.localToWorld(wp);
    spawnFoam(wp.x, wp.z, 0.4 + Math.random() * 0.25);
  }
  const stern = tmpV.set((Math.random() - 0.5) * 3, 0, -16.5); ship.localToWorld(stern);
  spawnFoam(stern.x, stern.z, 0.55, 2.2);
}

/* =====================================================================
 * 12. 自适应窗口 & 主循环（相机 = 45° 俯视 + 绕船圆周巡航）
 * ===================================================================== */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let elapsed = 0;
const shakeOffset = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  skyUniforms.uTime.value = elapsed;
  oceanUniforms.uTime.value = elapsed;

  if (elapsed >= nextFlashAt && !flashPulse) scheduleFlash(elapsed);
  updateFlash(elapsed);

  updateShip(elapsed, dt);
  updateSails(elapsed);
  updateFlag(elapsed);
  updateRain(dt);
  updateSplash(dt);
  updateFoam(dt, elapsed);

  // 圆周巡航：以船为圆心，45° 俯视角缓慢绕圈
  camAngle += CAM_SPEED * dt;
  const tx = ship.position.x, tz = ship.position.z;
  const ty = 6 + shipState.heave * 0.6;
  camera.position.set(
    tx + Math.cos(camAngle) * CAM_RADIUS,
    CAM_HEIGHT + shipState.heave * 0.5,
    tz + Math.sin(camAngle) * CAM_RADIUS
  );
  // 闪电瞬间镜头轻颤 + 持续的微弱海面晃动感
  shakeOffset.set(
    (Math.random() - 0.5) * flash * 0.55,
    (Math.random() - 0.5) * flash * 0.4 + Math.sin(elapsed * 1.7) * 0.05,
    (Math.random() - 0.5) * flash * 0.55
  );
  camera.position.add(shakeOffset);
  camera.lookAt(tx, ty, tz);

  composer.render();
}
animate();
