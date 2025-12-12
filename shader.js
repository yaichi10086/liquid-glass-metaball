// ---- 顶点着色器：保持不变 + 修复 Y 镜像 ----
const vert = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;

void main() {
  // 翻转 Y（镜像修复）
  vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);

  vec4 pos = vec4(aPosition, 1.0);
  pos.xy = pos.xy * 2.0 - 1.0;
  gl_Position = pos;
}
`;

// ---- 片元着色器：多球 + metaball + 玻璃折射 + 投影 ----
const frag = `
precision mediump float;

varying vec2 vTexCoord;

// 背景文字贴图
uniform sampler2D uTexture;

// 多球信息
const int MAX_BALLS = 64;
uniform int   uNumBalls;
uniform vec2  ballPos[MAX_BALLS];      // UV [0,1]
uniform float ballRadius[MAX_BALLS];   // 半径（UV 单位）

// ------- 高斯型 metaball 场 ----------
float field(vec2 p) {
  float sum = 0.0;

  for (int i = 0; i < MAX_BALLS; i++) {
    if (i >= uNumBalls) break;

    vec2  c = ballPos[i];
    float r = ballRadius[i];

    float dNorm = length(p - c) / (r + 1e-4); // 距离 / 半径
    float influence = exp(-dNorm * dNorm * 2.0);

    sum += influence;
  }
  return sum;
}

void main() {
  vec2 uv = vTexCoord;

  // 原始背景（黑底白字）
  vec3 bgCol = texture2D(uTexture, uv).rgb;

  // metaball 场（当前像素）
  float f = field(uv);

  // 球体等值线阈值
  float threshold = 0.2;

  // ---------- 阴影：在光线反方向偏移的场强 ----------
  // 光从左上打来 → 阴影往右下偏一点
  vec2 shadowOffset = vec2(0.03, -0.04);   // 这里可以小调：x 越大阴影越往右，y 越负越往下
  vec2 shadowUV = uv + shadowOffset;

  float fShadow = field(shadowUV);
  // 阴影用更宽一点的软阈值，形成柔和的大片影子
  float shadowMask = smoothstep(threshold, threshold + 0.35, fShadow);
  float shadowStrength = 0.75;             // 阴影强度，0 ~ 1

  // 有阴影的背景
  vec3 bgShadow = mix(bgCol, bgCol * (1.0 - shadowStrength), shadowMask);

  // ---------- 玻璃 mask ----------
  float hardMask = step(threshold, f);

  // 球体外部：只显示“带阴影”的背景
  if (hardMask <= 0.0) {
    gl_FragColor = vec4(bgShadow, 1.0);
    return;
  }

  // 软边 mask （内部渐变 & 融合用）
  float edgeWidth = 0.25;
  float softMask = smoothstep(threshold, threshold + edgeWidth, f);
  softMask = pow(softMask, 0.7);

  // 边缘 ring，用来加强边缘畸变和暗边
  float edgeMask = smoothstep(threshold - 0.04, threshold + 0.04, f);

  // ---------- 估算法线（场强梯度） ----------
  vec2 eps = vec2(0.003, 0.0);
  float fx = field(uv + eps.xy) - field(uv - eps.xy);
  float fy = field(uv + eps.yx) - field(uv - eps.yx);


float sRaw = clamp(softMask, 0.0, 1.0);
float s = pow(sRaw, 2.5);
float zShape = 1.0 - pow(1.0 - s, 6.0);
zShape = smoothstep(0.0, 1.0, zShape);

float zComp = mix(0.8, 1.9, zShape);

vec3 normal = normalize(vec3(fx, fy, zComp));

  // ---------- Fresnel：边缘反射强，中间弱 ----------
  vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
  float NdotV  = max(dot(normal, viewDir), 0.0);
  float fresnel = pow(1.0 - NdotV, 3.0);   // 越靠边越接近 1

  // ---------- 折射 + 轻微 RGB 色散 ----------
  vec2 refractDir = -normal.xy;

  // 略微加强折射，并让“中心比边缘更放大”一点
  float baseRefract = 0.55;           // 全局折射更强一点
  float centerBoost = 0.0;           // 中心额外增强
  float edgeBoost   = 0.05;           // 边缘轻微增强即可

  // softMask：中心 ≈1 边缘 ≈0
  float refractStrength =
      baseRefract
    + centerBoost * softMask
    + edgeBoost   * edgeMask;

  // 为 RGB 稍微用不同的偏移 → 模拟色散
  vec2 uvR = uv - refractDir * (refractStrength * 1.05);
  vec2 uvG = uv - refractDir * (refractStrength * 1.00);
  vec2 uvB = uv - refractDir * (refractStrength * 0.95);

  uvR = clamp(uvR, 0.0, 1.0);
  uvG = clamp(uvG, 0.0, 1.0);
  uvB = clamp(uvB, 0.0, 1.0);

  vec3 refrR = texture2D(uTexture, uvR).rgb;
  vec3 refrG = texture2D(uTexture, uvG).rgb;
  vec3 refrB = texture2D(uTexture, uvB).rgb;

  // 组合成略带色散的折射颜色（整体仍接近黑白）
  vec3 refracted = vec3(refrR.r, refrG.g, refrB.b);

  // ---------- 环境（顶部亮、底部暗 + 法线方向） ----------
  float envN = normal.y * 0.5 + 0.5;   // [-1,1] → [0,1]

  vec3 envTop    = vec3(-0.75, -0.75, -0.75);   // 顶部亮
  vec3 envBottom = vec3(1.0, 1.0, 1.0);// 底部暗（环境黑）

  vec3 envCol = mix(envTop, envBottom, envN);

  // Fresnel 控制反射强度（边缘更接近 envCol）
  vec3 reflection = envCol * (0.2 + 0.6 * fresnel);

  // ---------- 基础“玻璃体”颜色 ----------
  // 折射文字为主体，环境反射覆盖在上
  vec3 glass = refracted * 1.6;          // 提亮一点
  glass = mix(glass, reflection, 0.55);  // 加一点环境反射

  // ---------- 定向光 & 高光 ----------
  vec3 lightDir = normalize(vec3(-0.2, 0.7, 0.6));  // 左上光源
  float diff = max(dot(normal, lightDir), 2.5);
  float rim  = pow(1.5 - NdotV, 3.0);               // 轮廓高光

  // 漫反射略微抬亮
  glass *= (0.9 + 0.5 * diff);

  // 强一点的 spec 高光（偏冷白）
  float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 32.0);
  vec3 specCol = vec3(1.0, 1.0, 1.0) * (spec * 1.4 + rim * 0.5);
  glass += specCol;

  // ---------- 边缘做一圈暗边，强化球轮廓 ----------
  float edgeDark = edgeMask * 0.6;
  glass = mix(glass, glass * 0.35, edgeDark);

  // ---------- 最终与“带阴影背景”混合 ----------
  vec3 finalCol = mix(bgShadow, glass, hardMask);

  gl_FragColor = vec4(finalCol, 1.0);
}
`;