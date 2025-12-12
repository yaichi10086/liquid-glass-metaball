let liquidGlassShader;

let bigBalls = [];
let smallBalls = [];

const NUM_BIG   = 5;     // 大球个数
const EMIT_PROB = 0.2;  // 大球发射小球概率
const MAX_SMALL = 10;    // 小球上限

const ANIM_FRAMES = 30;  // 点击张开动画 1s@30fps

let isBurst    = false;
let burstFrame = 0;

let centerX, centerY;
let bg; // 背景文字图层

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(30);
  noStroke();

  // shader 来自 shader tab
  liquidGlassShader = createShader(vert, frag);

  centerX = width  / 2;
  centerY = height / 2;

  // -------- 创建黑底白字背景（做折射用） --------
  rebuildBackground();
  rebuildBalls();

  // 初始化多个大球
  for (let i = 0; i < NUM_BIG; i++) {
    bigBalls.push(new OscBall(true));
  }
}
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  centerX = width / 2;
  centerY = height / 2;

  rebuildBackground();
  rebuildBalls();
}

// ---------- 缓动 ----------
function easeOutCubic(t) {
  return 1 - pow(1 - t, 3);
}

// ---------- 主循环 ----------
function draw() {
  background(0);

  // 1. 更新球的位置（张开 or 正常往返）
  if (isBurst) {
    burstFrame++;
    let t = burstFrame / ANIM_FRAMES;

    for (let b of bigBalls) b.updateBurst(t);
    for (let s of smallBalls) s.updateBurst(t);

    if (burstFrame >= ANIM_FRAMES) {
      isBurst = false;
      for (let b of bigBalls) b.finishBurst();
      for (let s of smallBalls) s.finishBurst();
    }
  } else {
    for (let b of bigBalls) b.updateOsc();
    for (let s of smallBalls) s.updateOsc();
  }

  // 2. 在正常阶段，大球随机发射小球
  if (!isBurst) {
    for (let b of bigBalls) b.maybeEmit();
  }

  // 3. 用 shader 绘制“超级流体玻璃融球”
  shader(liquidGlassShader);

  // 背景文字贴图
  liquidGlassShader.setUniform("uTexture", bg);

  // 收集所有球（大 + 小），转成 shader 所需的 UV 坐标
  let allBalls = [];
  for (let b of bigBalls) allBalls.push(b);
  for (let s of smallBalls) allBalls.push(s);

  let n = min(allBalls.length, 64);
  let pos = [];
  let rad = [];

  for (let i = 0; i < n; i++) {
    let ball = allBalls[i];

    // 画布坐标 → UV
    let u = ball.x / width;
    let v = 1.0 - (ball.y / height);
    pos.push(u, v);

    // 半径归一化为 UV
    rad.push((ball.d * 0.5) / width);
  }

  liquidGlassShader.setUniform("uNumBalls", n);
  liquidGlassShader.setUniform("ballPos", pos);
  liquidGlassShader.setUniform("ballRadius", rad);

  rectMode(CORNER);
  rect(0, 0, width, height); // 铺满整屏

  // 结束 shader，方便后面如果要叠加 2D 元素
  resetShader();
}

// ---------- 点击：随机化方向 & 触发一次“张开” ----------
function mousePressed() {
  for (let b of bigBalls) b.reseed();
  for (let s of smallBalls) s.reseed();

  isBurst = true;
  burstFrame = 0;

  for (let b of bigBalls) b.startBurst();
  for (let s of smallBalls) s.startBurst();
}

// ---------- 大球 / 小球 共用类 ----------
class OscBall {
  constructor(isBig = false, parent = null) {
    this.isBig = isBig;
    this.parent = parent;

    if (isBig) {
      this.d = min(width, height) * random(0.15, 0.22);
    } else {
      this.d = parent.d * random(1 / 2, 3/4);
    }

    let ang = random(TAU);
    this.dirX = cos(ang);
    this.dirY = sin(ang);

    let base = min(width, height) * random(0.10, 0.30);
    this.distA = base * random(1.0, 1.3); // 向外最大
    this.distB = base * random(0.8, 1.1); // 向内折返

    this.r = random(-this.distB, this.distA);
    this.sgn = random() < 0.5 ? 1 : -1;

    this.speed = 2.5;

    this.updatePos();
  }

  // --- 点击后张开动画用 ---
  startBurst() {
    this.r_start = this.r;
    this.r_target = this.distA;
  }

  updateBurst(t) {
    let e = easeOutCubic(t);
    this.r = lerp(this.r_start, this.r_target, e);
    this.updatePos();
  }

  finishBurst() {
    this.r = this.distA;
    this.sgn = -1;
    this.updatePos();
  }

  // --- 正常往返运动 ---
  updateOsc() {
    let next = this.r + this.sgn * this.speed;

    if (next > this.distA) {
      next = this.distA;
      this.sgn = -1;
    } else if (next < -this.distB) {
      next = -this.distB;
      this.sgn = 1;
    }

    this.r = lerp(this.r, next, 0.25);
    this.updatePos();
  }

  updatePos() {
    if (this.isBig) {
      this.x = centerX + this.dirX * this.r;
      this.y = centerY + this.dirY * this.r;
    } else {
      this.x = this.parent.x + this.dirX * this.r;
      this.y = this.parent.y + this.dirY * this.r;
    }
  }

  // --- 大球发射小球 ---
  maybeEmit() {
    if (!this.isBig) return;
    if (smallBalls.length >= MAX_SMALL) return;
    if (random() < EMIT_PROB) {
      smallBalls.push(new OscBall(false, this));
    }
  }

  // --- 每次点击重新随机方向 / 区间 ---
  reseed() {
    let ang = random(TAU);
    this.dirX = cos(ang);
    this.dirY = sin(ang);

    let base = min(width, height) * random(0.10, 0.30);
    this.distA = base * random(1.0, 1.3);
    this.distB = base * random(0.8, 1.1);

    this.r = random(-this.distB, this.distA);
    this.sgn = random() < 0.5 ? 1 : -1;

    this.updatePos();
  }
}
function rebuildBackground() {
  bg = createGraphics(width, height);
  bg.pixelDensity(1);
  bg.background(0);

  bg.fill(255);
  bg.textAlign(LEFT, TOP);

  // 字号随屏幕比例缩放（关键）
  let fontSize = min(width, height) * 0.11;
  bg.textSize(fontSize);
  bg.textLeading(fontSize * 0.9);

  bg.text(
    "DESIGN       *\nBY_BINU®\nMAKE A CITY\nMORE \nVIBRANT\n\nDESIGN       *\nBY_BINU®",
    fontSize * 0.7,
    fontSize * 0.7
  );
}
function rebuildBalls() {
  bigBalls = [];
  smallBalls = [];

  for (let i = 0; i < NUM_BIG; i++) {
    bigBalls.push(new OscBall(true));
  }

  isBurst = false;
  burstFrame = 0;
}
