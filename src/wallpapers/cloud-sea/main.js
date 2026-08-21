import * as THREE from 'three';

// ---------- 渲染器 / 场景 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 晨雾：略提亮，避免脏暗；与浅玫瑰地平线衔接
scene.fog = new THREE.FogExp2(0x5c5a72, 0.0024);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);

// ---------- 天空穹顶（冷调底 + 浅粉金地平线，保留日出而不回到橙金） ----------
{
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 hor = vec3(0.96, 0.78, 0.66);   // 浅粉金，不是南瓜橙
        vec3 mid = vec3(0.52, 0.52, 0.70);   // 薰衣草蓝
        vec3 top = vec3(0.10, 0.14, 0.32);   // 冷蓝天顶
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.24, h));
        col = mix(col, top, smoothstep(0.18, 0.68, h));
        col = mix(vec3(0.12, 0.12, 0.20), col, smoothstep(-0.12, 0.02, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 20), skyMat));
}

// ---------- 太阳方向（略抬高，保证 45° 巡航时上半画幅能看到日盘） ----------
const SUN_DIR = new THREE.Vector3(0.50, 0.22, -0.76).normalize();

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0x9aa4c4, 0x2a2838, 1.05));
const sunLight = new THREE.DirectionalLight(0xffe0c4, 1.75);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

// ---------- 太阳 + 光晕（径向渐变羽化，避免硬边同心圆） ----------
function radialSunTexture(stops) {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [t, color] of stops) g.addColorStop(t, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const sunGroup = new THREE.Group();
{
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshBasicMaterial({
      map: radialSunTexture([
        [0.00, 'rgba(255,247,236,1)'],
        [0.32, 'rgba(255,240,220,0.95)'],
        [0.52, 'rgba(255,220,188,0.40)'],
        [0.72, 'rgba(255,210,180,0.0)'],
        [1.00, 'rgba(255,210,180,0.0)'],
      ]),
      transparent: true, depthWrite: false, fog: false,
    })
  );
  sunGroup.add(core);

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshBasicMaterial({
      map: radialSunTexture([
        [0.00, 'rgba(255,210,170,0.50)'],
        [0.18, 'rgba(255,190,150,0.22)'],
        [0.42, 'rgba(255,170,140,0.08)'],
        [1.00, 'rgba(255,160,130,0.0)'],
      ]),
      transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.position.z = -0.5;
  sunGroup.add(halo);
}
sunGroup.position.copy(SUN_DIR).multiplyScalar(380);
scene.add(sunGroup);

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
function fbm(x, y, octaves = 5) {
  let h = 0, amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    h += noise2(x * f, y * f) * amp;
    sum += amp;
    f *= 2.05;
    amp *= 0.5;
  }
  return h / sum;
}
function ridge(x, y) {
  return 1 - Math.abs(2 * noise2(x, y) - 1);
}
function ridgedFbm(x, y) {
  let h = 0, amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < 6; i++) {
    h += ridge(x * f, y * f) * amp;
    sum += amp;
    f *= 2.03;
    amp *= 0.48;
  }
  return h / sum;
}

// ---------- 写实群峰：大部分没入云海，只有峰顶刺破 ----------
const SIZE = 240, SEG = 200;
const HEIGHT_SCALE = 40; // 高度图编码上限，供云层相交渐隐采样
const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI / 2);
const heightPixels = new Uint8Array((SEG + 1) * (SEG + 1));
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const wx = fbm(x * 0.012 + 8, z * 0.012 + 8, 3);
    const wz = fbm(x * 0.012 + 21, z * 0.012 + 21, 3);
    const ridges = ridgedFbm(x * 0.016 + wx * 1.8, z * 0.016 + wz * 1.8);
    const base = fbm(x * 0.007 + 3, z * 0.007 + 3, 4);
    // 水位线：低于阈值的全沉入云下，只留孤峰岛屿
    let n = ridges * 0.70 + base * 0.30;
    n = Math.max(0, (n - 0.40) / 0.60);
    let h = Math.pow(n, 1.45) * 24;
    if (h > 14) h += (noise2(x * 0.12, z * 0.12) - 0.5) * 0.45;
    pos.setY(i, h);
    heightPixels[i] = Math.min(255, Math.round((h / HEIGHT_SCALE) * 255));
  }
  pos.needsUpdate = true;
  terrainGeo.computeVertexNormals();

  const nrm = terrainGeo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x4a4860);
  const cRock = new THREE.Color(0x8a8490); // 露出云面的岩体提亮，避免焦斑
  const cGlow = new THREE.Color(0xf4d0bc); // 浅粉金 alpenglow
  const c = new THREE.Color();
  const nVec = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < 10.0) {
      c.copy(cLow);
    } else {
      nVec.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      const sunLit = THREE.MathUtils.clamp(nVec.dot(SUN_DIR), 0, 1);
      const steep = 1 - nrm.getY(i);
      const jitter = (hash(i, 13) - 0.5) * 1.6;
      const exposed = THREE.MathUtils.smoothstep(h + jitter, 13.0, 18.0);
      const glowK = exposed * (0.28 + 0.72 * sunLit) * (1 - steep * 0.4);
      c.lerpColors(cRock, cGlow, THREE.MathUtils.clamp(glowK, 0, 1));
      c.lerp(cLow, 1 - THREE.MathUtils.smoothstep(h, 11.0, 16.0));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
const heightMap = new THREE.DataTexture(heightPixels, SEG + 1, SEG + 1, THREE.RedFormat);
heightMap.magFilter = THREE.LinearFilter;
heightMap.minFilter = THREE.LinearFilter;
heightMap.wrapS = THREE.ClampToEdgeWrapping;
heightMap.wrapT = THREE.ClampToEdgeWrapping;
heightMap.needsUpdate = true;

scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: false, roughness: 0.78, metalness: 0.04,
})));

// ---------- 云海（加厚抬高；按地形高差渐隐，避免平面切山硬边） ----------
const cloudVert = `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const cloudFrag = `
  uniform float uTime;
  uniform vec2 uDrift;
  uniform vec3 uSunDir;
  uniform float uAlpha;
  uniform sampler2D uHeight;
  uniform float uSize;
  uniform float uLayerY;
  uniform float uHeightScale;
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.55;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * amp;
      p *= 2.15;
      amp *= 0.5;
    }
    return v;
  }
  void main() {
    vec2 p = vWorld.xz * 0.010 + uDrift * uTime;
    float w = fbm(p * 1.6 + vec2(uTime * 0.01, 0.0));
    float n = fbm(p + w * 1.7);
    // 低阈值：大片连绵云海，不是稀疏散斑
    float a = smoothstep(0.16, 0.50, n);
    a *= 1.0 - smoothstep(280.0, 380.0, length(vWorld.xz));

    // 山体靠近本层时渐隐，避免平面切山的硬边/锯齿
    vec2 huv = vWorld.xz / uSize + 0.5;
    float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
    float terrainH = texture2D(uHeight, clamp(huv, 0.0, 1.0)).r * uHeightScale * inside;
    a *= smoothstep(0.5, 5.0, uLayerY - terrainH);

    float sunFace = clamp(dot(normalize(vWorld), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 shade = vec3(0.62, 0.60, 0.70);
    vec3 lit = vec3(1.00, 0.90, 0.82); // 向阳面浅粉金
    vec3 col = mix(shade, lit, sunFace * (0.40 + 0.60 * n));

    gl_FragColor = vec4(col, a * uAlpha);
  }`;

const cloudMats = [];
const CLOUD_LAYERS = [
  { y: 12.0, drift: [0.006, 0.002], alpha: 0.98, size: 780 },
  { y: 15.5, drift: [-0.004, 0.005], alpha: 0.90, size: 760 },
  { y: 19.0, drift: [0.003, -0.006], alpha: 0.72, size: 740 },
  { y: 22.5, drift: [-0.002, -0.003], alpha: 0.42, size: 720 },
];
CLOUD_LAYERS.forEach((def, i) => {
  const mat = new THREE.ShaderMaterial({
    vertexShader: cloudVert,
    fragmentShader: cloudFrag,
    uniforms: {
      uTime: { value: 0 },
      uDrift: { value: new THREE.Vector2(...def.drift) },
      uSunDir: { value: SUN_DIR },
      uAlpha: { value: def.alpha },
      uHeight: { value: heightMap },
      uSize: { value: SIZE },
      uLayerY: { value: def.y },
      uHeightScale: { value: HEIGHT_SCALE },
    },
    transparent: true,
    depthWrite: false,
  });
  const layer = new THREE.Mesh(new THREE.PlaneGeometry(def.size, def.size), mat);
  layer.rotation.x = -Math.PI / 2;
  layer.position.y = def.y;
  layer.renderOrder = 10 + i;
  scene.add(layer);
  cloudMats.push(mat);
});

// ---------- 动画 ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // 45° 巡航；视线抬到 y=40，让日盘留在上半画幅，下半是云海
  const CR = 64;
  camera.position.set(Math.cos(t * 0.04) * CR, CR, Math.sin(t * 0.04) * CR);
  camera.lookAt(0, 40, 0);

  sunGroup.lookAt(camera.position);

  for (const mat of cloudMats) mat.uniforms.uTime.value = t;

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
