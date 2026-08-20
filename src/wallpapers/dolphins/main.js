import * as THREE from 'three';

// ---------- 渲染器 / 场景 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const WATER = 0x0b3d63;
scene.background = new THREE.Color(WATER);
scene.fog = new THREE.FogExp2(WATER, 0.026);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 240);

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0xa8d8f0, 0x06283d, 1.3));
const sun = new THREE.DirectionalLight(0xe8f4ff, 2.0);
sun.position.set(8, 30, 5);
scene.add(sun);

// ---------- 海底 ----------
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(90, 48),
  new THREE.MeshStandardMaterial({ color: 0x11486a, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -7;
scene.add(floor);

// 背景渐变球：上方透光亮蓝、下方深海暗蓝（平视视角的天空/深渊）
const skyGeo = new THREE.SphereGeometry(120, 24, 16);
{
  const sp = skyGeo.attributes.position;
  const sc = new Float32Array(sp.count * 3);
  const top = new THREE.Color(0x2e86b8);
  const bottom = new THREE.Color(0x052238);
  const c = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const k = THREE.MathUtils.smoothstep(sp.getY(i), -60, 80);
    c.lerpColors(bottom, top, k);
    sc[i * 3] = c.r;
    sc[i * 3 + 1] = c.g;
    sc[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
}
scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, fog: false,
})));

// 几块礁石
const rockMat = new THREE.MeshStandardMaterial({ color: 0x0d3550, roughness: 1 });
for (let i = 0; i < 7; i++) {
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), rockMat);
  const a = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 22;
  rock.position.set(Math.cos(a) * r, -7 + Math.random() * 0.4, Math.sin(a) * r);
  rock.scale.set(1 + Math.random() * 2.5, 0.6 + Math.random() * 1.2, 1 + Math.random() * 2.5);
  rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
  scene.add(rock);
}

// ---------- 海豚（程序化建模，前进方向 +Z） ----------
const COLOR_TOP = new THREE.Color(0x4e6d84);   // 背部深灰蓝
const COLOR_BELLY = new THREE.Color(0xdce9f2); // 腹部浅白
const finMat = new THREE.MeshStandardMaterial({ color: 0x54748c, roughness: 0.4, metalness: 0.05 });
const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.3 });
const BODY_LEN = 4.2;

// 身体半径包络：t=0 尾端 -> t=1 吻尖，含额隆与吻部 taper
function bodyRadius(t) {
  let r = Math.sin(Math.PI * Math.pow(1 - t, 0.65)) * 0.55; // 基础纺锤
  r = Math.min(r, 0.07 + t * 0.8);                          // 尾柄收窄
  if (t > 0.86) r *= 1 - ((t - 0.86) / 0.14) * 0.75;        // 吻尖收细
  r += Math.exp(-Math.pow((t - 0.78) / 0.09, 2)) * 0.06;    // 额隆隆起
  return Math.max(r, 0.012);
}

function buildBodyGeometry() {
  const profile = [];
  const SEGS = 40;
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    profile.push(new THREE.Vector2(bodyRadius(t), t * BODY_LEN));
  }
  const geo = new THREE.LatheGeometry(profile, 32);
  geo.rotateX(Math.PI / 2);           // +Y -> +Z（吻在 +Z）
  geo.translate(0, 0, -BODY_LEN / 2); // 身体居中
  // 双色涂装：按高度在背部色与腹部色之间过渡
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.smoothstep(pos.getY(i), -0.3, 0.28);
    c.lerpColors(COLOR_BELLY, COLOR_TOP, k);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// 曲面挤出的鳍（shape 平面：x 朝后、y 朝上，挤出厚度居中后转到横跨身体的 X 轴）
function buildFinGeometry(shape, thickness) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateY(Math.PI / 2); // shape x -> -Z（朝后），厚度 -> +X
  return geo;
}

// 背鳍：前缘隆起、向后下方回落的弯刀形
function buildDorsalFin() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.12, 0.6, 0.42, 0.85);
  s.quadraticCurveTo(0.5, 0.45, 0.72, 0.02);
  s.quadraticCurveTo(0.35, -0.04, 0, 0);
  return new THREE.Mesh(buildFinGeometry(s, 0.09), finMat);
}

// 胸鳍：小巧后掠的水滴形
function buildPectoralFin() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.1, 0.28, 0.5, 0.42);
  s.quadraticCurveTo(0.42, 0.12, 0.55, -0.02);
  s.quadraticCurveTo(0.28, -0.08, 0, 0);
  return new THREE.Mesh(buildFinGeometry(s, 0.06), finMat);
}

// 尾鳍：水平新月形（shape 平面俯视，x 展开、y 后掠，翻转到 XZ 平面）
function buildTailFluke() {
  const s = new THREE.Shape();
  s.moveTo(0.78, 0.42);
  s.quadraticCurveTo(0.45, 0.26, 0.08, 0.0);
  s.quadraticCurveTo(0.0, -0.03, -0.08, 0.0);
  s.quadraticCurveTo(-0.45, 0.26, -0.78, 0.42);
  s.quadraticCurveTo(-0.5, 0.02, -0.16, -0.22);
  s.quadraticCurveTo(0.0, -0.28, 0.16, -0.22);
  s.quadraticCurveTo(0.5, 0.02, 0.78, 0.42);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.06, bevelEnabled: true,
    bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16,
  });
  geo.translate(0, 0, -0.03);
  geo.rotateX(-Math.PI / 2); // shape y -> -Z（后掠），厚度 -> +Y
  return new THREE.Mesh(geo, finMat);
}

function buildDolphin(scale = 1) {
  const dolphin = new THREE.Group();
  dolphin.rotation.order = 'YXZ';

  dolphin.add(new THREE.Mesh(buildBodyGeometry(), skinMat));

  // 背鳍
  const dorsal = buildDorsalFin();
  dorsal.scale.setScalar(0.8);
  dorsal.position.set(0, 0.4, 0.35);
  dolphin.add(dorsal);

  // 胸鳍：向外下方展开
  for (const side of [-1, 1]) {
    const fin = buildPectoralFin();
    fin.position.set(side * 0.42, -0.2, 0.85);
    fin.rotation.z = side * -2.3;
    fin.rotation.y = side * 0.3;
    dolphin.add(fin);
  }

  // 眼睛
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), eyeMat);
    eye.position.set(side * 0.44, 0.06, 1.15);
    dolphin.add(eye);
  }

  // 尾鳍组（用于摆动动画）
  const tail = new THREE.Group();
  tail.position.set(0, 0, -BODY_LEN / 2);
  const fluke = buildTailFluke();
  fluke.position.set(0, 0, -0.05);
  tail.add(fluke);
  dolphin.add(tail);

  dolphin.scale.setScalar(scale);
  return { group: dolphin, tail };
}

// ---------- 海豚群 ----------
const podConfigs = [
  { R: 5,   y: 2.0, w: 0.34,  phase: 0.0, s: 1.05 },
  { R: 5.5, y: 3.4, w: 0.34,  phase: 2.8, s: 0.85 },
  { R: 8.5, y: 1.0, w: -0.26, phase: 1.4, s: 1.2  },
  { R: 10,  y: 4.2, w: 0.22,  phase: 4.2, s: 0.95 },
  { R: 12,  y: 2.8, w: -0.18, phase: 5.3, s: 0.9  },
];
const pod = podConfigs.map((cfg) => {
  const d = buildDolphin(cfg.s);
  scene.add(d.group);
  return { ...cfg, ...d };
});

// ---------- 气泡 ----------
function makeCircleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(230,245,255,0.9)');
  grad.addColorStop(0.6, 'rgba(200,230,255,0.35)');
  grad.addColorStop(1, 'rgba(200,230,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const BUBBLES = 120;
const bubblePos = new Float32Array(BUBBLES * 3);
const bubbleSpeed = new Float32Array(BUBBLES);
for (let i = 0; i < BUBBLES; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * 16;
  bubblePos[i * 3] = Math.cos(a) * r;
  bubblePos[i * 3 + 1] = -6 + Math.random() * 20;
  bubblePos[i * 3 + 2] = Math.sin(a) * r;
  bubbleSpeed[i] = 0.6 + Math.random() * 1.2;
}
const bubbleGeo = new THREE.BufferGeometry();
bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
  map: makeCircleTexture(), size: 0.4, transparent: true, opacity: 0.55,
  depthWrite: false, sizeAttenuation: true,
}));
scene.add(bubbles);

// ---------- 体积光束 ----------
function makeRayTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(215,240,255,0.85)');
  v.addColorStop(1, 'rgba(215,240,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}
const rayTex = makeRayTexture();
const rays = [];
for (let i = 0; i < 6; i++) {
  const ray = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5 + Math.random() * 2.5, 36),
    new THREE.MeshBasicMaterial({
      map: rayTex, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  const a = Math.random() * Math.PI * 2;
  const r = 3 + Math.random() * 11;
  ray.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
  ray.rotation.z = 0.18 + Math.random() * 0.15;
  ray.rotation.y = Math.random() * Math.PI;
  rays.push({ mesh: ray, base: 0.06 + Math.random() * 0.08, phase: Math.random() * Math.PI * 2 });
  scene.add(ray);
}

// ---------- 动画 ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // 相机：海里平视——与海豚群同深度缓慢环绕，带轻微浮沉
  const CR = 13;
  camera.position.set(
    Math.cos(t * 0.04) * CR,
    2.2 + Math.sin(t * 0.1) * 0.5,
    Math.sin(t * 0.04) * CR
  );
  camera.lookAt(0, 2, 0);

  // 海豚群：变速穿梭 + 大幅起伏 + 高频摆尾
  for (const d of pod) {
    const surge = Math.sin(t * 0.45 + d.phase * 2) * 0.35;      // 游速起伏
    const a = d.phase + t * d.w + surge * 0.4;
    const r = d.R + Math.sin(t * 0.3 + d.phase) * 1.6;          // 半径摆动
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = d.y + Math.sin(t * 1.1 + d.phase) * 1.1;          // 上下穿梭
    d.group.position.set(x, y, z);
    const yaw = Math.atan2(-Math.sin(a) * d.w, Math.cos(a) * d.w);
    const swim = Math.sin(t * 6.5 + d.phase * 3);               // 摆动主节拍
    const pitch = -Math.cos(t * 1.1 + d.phase) * 0.3 + swim * 0.06;
    const roll = -Math.sign(d.w) * 0.3;
    d.group.rotation.set(pitch, yaw, roll);
    d.tail.rotation.x = swim * 0.62;
  }

  // 气泡上升
  const pos = bubbleGeo.attributes.position;
  for (let i = 0; i < BUBBLES; i++) {
    let y = pos.getY(i) + bubbleSpeed[i] * 0.016;
    if (y > 14) y = -6;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t * 1.5 + i) * 0.004);
  }
  pos.needsUpdate = true;

  // 光束呼吸
  for (const ray of rays) {
    ray.mesh.material.opacity = ray.base * (0.7 + 0.3 * Math.sin(t * 0.5 + ray.phase));
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
