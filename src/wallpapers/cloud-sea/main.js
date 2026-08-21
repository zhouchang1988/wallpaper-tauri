import * as THREE from 'three';

// ---------- 渲染器 / 场景 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// 黄昏雾色：与地平线粉紫色衔接，远处群峰没入暮霭
scene.fog = new THREE.FogExp2(0x4a3050, 0.0034);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);

// ---------- 天空穹顶（反向球体渐变：橙金地平线 → 粉紫 → 深蓝紫天顶） ----------
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
        vec3 hor = vec3(1.00, 0.62, 0.34);   // 地平线橙金
        vec3 mid = vec3(0.62, 0.34, 0.50);   // 粉紫过渡带
        vec3 top = vec3(0.10, 0.12, 0.30);   // 天顶深蓝紫
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.18, 0.65, h));
        // 地平线以下沉为暗紫，避免露出底色
        col = mix(vec3(0.14, 0.09, 0.18), col, smoothstep(-0.12, 0.02, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 20), skyMat));
}

// ---------- 太阳方向（光照与盘面共用；压得极低，巡航朝向它时落日半隐于山海） ----------
const SUN_DIR = new THREE.Vector3(0.55, 0.12, -0.8).normalize();

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0x8a6aa0, 0x2a1c30, 0.85));
const sunLight = new THREE.DirectionalLight(0xffb070, 1.9);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

// ---------- 太阳 + 光晕（每帧朝向相机） ----------
const sunGroup = new THREE.Group();
{
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(22, 48),
    new THREE.MeshBasicMaterial({ color: 0xfff0d0, fog: false })
  );
  sunGroup.add(disc);

  // 两层加法混合光晕，营造熔金质感
  const halo1 = new THREE.Mesh(
    new THREE.CircleGeometry(44, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffb060, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
  );
  halo1.position.z = -0.5;
  sunGroup.add(halo1);

  const halo2 = new THREE.Mesh(
    new THREE.CircleGeometry(90, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff7a50, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
  );
  halo2.position.z = -1;
  sunGroup.add(halo2);
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
function fbm(x, y) {
  let h = 0, amp = 0.55, f = 1;
  for (let i = 0; i < 5; i++) {
    h += noise2(x * f, y * f) * amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return h;
}

// ---------- 低多边形群峰 ----------
// 峰峦刺破云海（云层在 y≈4~9），顶峰染 alpenglow 粉金
const SIZE = 220, SEG = 130;
const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h = fbm(x * 0.024 + 4, z * 0.024 + 4);
    h = Math.max(0, Math.pow(h, 2.6) * 52 - 5); // 幂次造就陡峭峰线，洼地沉入云海之下
    pos.setY(i, h);
  }
  terrainGeo.computeVertexNormals();

  // 顶点着色：云下暗紫岩壁 → 暖棕山腰 → 粉金峰顶（坡度大处挂不住光）
  const nrm = terrainGeo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x35243e);
  const cRock = new THREE.Color(0x6e4a44);
  const cGlow = new THREE.Color(0xffc9a0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < 3.0) {
      c.copy(cLow);
    } else {
      const steep = 1 - nrm.getY(i);
      const jitter = (hash(i, 13) - 0.5) * 3.0;
      const glowK = THREE.MathUtils.smoothstep(h + jitter, 12.0, 22.0) * (1 - steep * 1.2);
      c.lerpColors(cRock, cGlow, THREE.MathUtils.clamp(glowK, 0, 1));
      // 低处向暗紫岩壁过渡
      c.lerp(cLow, 1 - THREE.MathUtils.smoothstep(h, 3.0, 8.0));
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

// ---------- 云海（三层噪声着色器平面，絮状云缓慢漂移） ----------
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
    vec2 p = vWorld.xz * 0.014 + uDrift * uTime;
    // domain warping 让云团边缘呈絮状翻卷
    float w = fbm(p * 1.6 + vec2(uTime * 0.01, 0.0));
    float n = fbm(p + w * 1.7);
    float a = smoothstep(0.34, 0.72, n);
    // 远处径向淡出：云系融入暮霭，避免平面边缘穿帮
    a *= 1.0 - smoothstep(240.0, 360.0, length(vWorld.xz));

    // 云色：背光面粉紫，向阳面染金
    float sunFace = clamp(dot(normalize(vWorld), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 shade = vec3(0.58, 0.46, 0.62);
    vec3 lit = vec3(1.00, 0.84, 0.66);
    vec3 col = mix(shade, lit, sunFace * (0.35 + 0.65 * n));

    gl_FragColor = vec4(col, a * uAlpha);
  }`;

const cloudMats = [];
const CLOUD_LAYERS = [
  { y: 4.0, drift: [0.006, 0.002], alpha: 0.96, size: 760 },
  { y: 6.0, drift: [-0.004, 0.005], alpha: 0.85, size: 740 },
  { y: 8.5, drift: [0.003, -0.006], alpha: 0.6, size: 720 },
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
    },
    transparent: true,
    depthWrite: false,
  });
  const layer = new THREE.Mesh(new THREE.PlaneGeometry(def.size, def.size), mat);
  layer.rotation.x = -Math.PI / 2;
  layer.position.y = def.y;
  layer.renderOrder = 10 + i; // 由低到高依序绘制
  scene.add(layer);
  cloudMats.push(mat);
});

// ---------- 飞鸟剪影（双翼扇动，绕群峰盘旋） ----------
const birds = [];
{
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c1224, side: THREE.DoubleSide, fog: false });
  const wingGeo = new THREE.PlaneGeometry(1.0, 0.28); // 小而窄，远看呈「人」字剪影
  wingGeo.translate(0.5, 0, 0); // 翼根在原点，便于扇动旋转
  for (let i = 0; i < 6; i++) {
    const bird = new THREE.Group();
    const left = new THREE.Mesh(wingGeo, birdMat);
    const right = new THREE.Mesh(wingGeo, birdMat);
    right.rotation.y = Math.PI;
    bird.add(left, right);
    scene.add(bird);
    birds.push({
      obj: bird, left, right,
      r: 22 + Math.random() * 14,          // 盘旋半径
      h: 17 + Math.random() * 9,           // 飞行高度
      speed: 0.05 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      flap: 6 + Math.random() * 3,
    });
  }
}

// ---------- 动画 ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // 相机：45° 俯视角匀速圆周巡航（高度 = 水平半径）；视线抬高，给天穹与落日留构图
  const CR = 64;
  camera.position.set(Math.cos(t * 0.04) * CR, CR, Math.sin(t * 0.04) * CR);
  camera.lookAt(0, 30, 0);

  // 太阳盘面始终朝向相机
  sunGroup.lookAt(camera.position);

  // 云海漂移
  for (const mat of cloudMats) mat.uniforms.uTime.value = t;

  // 飞鸟：沿圆盘旋 + 双翼扇动
  for (const b of birds) {
    const a = t * b.speed + b.phase;
    b.obj.position.set(Math.cos(a) * b.r, b.h + Math.sin(t * 0.5 + b.phase) * 1.2, Math.sin(a) * b.r);
    b.obj.rotation.y = -a - Math.PI / 2; // 朝向切线方向
    const flap = Math.sin(t * b.flap + b.phase) * 0.55;
    b.left.rotation.z = flap;
    b.right.rotation.z = -flap;
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
