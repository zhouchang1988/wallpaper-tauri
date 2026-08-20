import * as THREE from 'three';

// ---------- 渲染器 / 场景 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const NIGHT = 0x060b1a;
scene.background = new THREE.Color(NIGHT);
scene.fog = new THREE.FogExp2(NIGHT, 0.011);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0x33456b, 0x0a0f1c, 0.9));
const moonLight = new THREE.DirectionalLight(0xbfd4ff, 1.4);
moonLight.position.set(-40, 55, -25);
scene.add(moonLight);

// ---------- 简易 value noise（无外部依赖，地形用） ----------
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let h = 0, amp = 0.55, f = 1;
  for (let i = 0; i < 5; i++) {
    h += noise2(x * f, y * f) * amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return h;
}

// ---------- 低多边形山地 ----------
const SIZE = 130, SEG = 110;
const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + z * z) / (SIZE * 0.5);
    let h = fbm(x * 0.045 + 10, z * 0.045 + 10);
    h = Math.pow(h, 1.7) * 17;
    h *= Math.max(0, 1 - d * d * 1.15); // 向边缘降到海面以下，形成岛屿
    pos.setY(i, h);
  }
  terrainGeo.computeVertexNormals();

  // 顶点着色：低处暗滩 / 山坡岩壁 / 高处积雪（坡度大处挂不住雪）
  const nrm = terrainGeo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x14202f);
  const cRock = new THREE.Color(0x2c3550);
  const cSnow = new THREE.Color(0xdfe8f5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < 0.4) {
      c.copy(cLow);
    } else {
      const steep = 1 - nrm.getY(i);
      const jitter = (hash(i, 7) - 0.5) * 1.6;
      const snowK = THREE.MathUtils.smoothstep(h + jitter, 5.0, 8.5) * (1 - steep * 1.5);
      c.lerpColors(cRock, cSnow, THREE.MathUtils.clamp(snowK, 0, 1));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 1,
})));

// ---------- 海面（微反射的暗色圆盘，接住岛屿边缘） ----------
const sea = new THREE.Mesh(
  new THREE.CircleGeometry(240, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1626, roughness: 0.3, metalness: 0.55 })
);
sea.rotation.x = -Math.PI / 2;
sea.position.y = 0.05;
scene.add(sea);

// ---------- 星空（上半球随机分布的亮点） ----------
{
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = Math.acos(Math.random());       // 仰角均匀
    const r = 220;
    pos[i * 3] = Math.cos(a) * Math.sin(e) * r;
    pos[i * 3 + 1] = Math.cos(e) * r * 0.6 + 12;
    pos[i * 3 + 2] = Math.sin(a) * Math.sin(e) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 1.1, sizeAttenuation: false,
    transparent: true, opacity: 0.85, fog: false,
  })));
}

// ---------- 月亮 + 光晕 ----------
{
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.MeshBasicMaterial({ color: 0xe8efff, fog: false })
  );
  moon.position.set(-110, 95, -70);
  moon.lookAt(0, 0, 0);
  scene.add(moon);

  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(20, 40),
    new THREE.MeshBasicMaterial({
      color: 0x8fa8d8, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
  );
  halo.position.copy(moon.position).multiplyScalar(1.01);
  halo.lookAt(0, 0, 0);
  scene.add(halo);
}

// ---------- 极光帘幕（着色器波浪 + 加法混合） ----------
const auroraVert = `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += sin(p.x * 0.08 + uTime * 0.6 + uPhase) * 3.0
       + sin(p.x * 0.21 - uTime * 0.4 + uPhase * 2.0) * 1.5;
  p.z += sin(p.x * 0.05 + uTime * 0.25 + uPhase) * 4.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const auroraFrag = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
void main() {
  float pillar = sin(vUv.x * 40.0 + uTime * 0.8 + uPhase) * 0.5 + 0.5; // 竖向光柱纹理
  float a = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  a *= 0.3 + 0.3 * pillar;
  vec3 col = mix(uColorA, uColorB, vUv.y);
  gl_FragColor = vec4(col, a * 0.45);
}`;

const auroras = [];
const AURORA_DEFS = [
  { phase: 0.0, y: 46, z: -60, ry: 0.0, ca: 0x2effa8, cb: 0x7a5cff },
  { phase: 2.1, y: 56, z: -85, ry: 0.35, ca: 0x37d5ff, cb: 0x2effa8 },
  { phase: 4.2, y: 40, z: -45, ry: -0.3, ca: 0x2effa8, cb: 0xff6ad5 },
];
for (const def of AURORA_DEFS) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: auroraVert,
    fragmentShader: auroraFrag,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: def.phase },
      uColorA: { value: new THREE.Color(def.ca) },
      uColorB: { value: new THREE.Color(def.cb) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const band = new THREE.Mesh(new THREE.PlaneGeometry(200, 26, 96, 1), mat);
  band.position.set(0, def.y, def.z);
  band.rotation.y = def.ry;
  scene.add(band);
  auroras.push(mat);
}

// ---------- 动画 ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // 相机：45° 俯视角匀速圆周巡航（高度 = 水平半径）
  const CR = 38;
  camera.position.set(Math.cos(t * 0.05) * CR, CR, Math.sin(t * 0.05) * CR);
  camera.lookAt(0, 5, 0);

  for (const mat of auroras) mat.uniforms.uTime.value = t;

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
