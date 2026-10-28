import * as THREE from 'three';
import type { EnvironmentData } from '../sim/level';

/**
 * Mid-sunset environment: a gradient sky dome with sun and drifting clouds, a low warm
 * sun that casts long shadows, a cool sky fill, and fog whose colour follows the sky's
 * horizon (warm toward the sun, violet away from it) so distant geometry melts into it.
 */

/** Uniforms shared by the sky and every fog-patched material. */
export const envUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 0.15, -1).normalize() },
  // Colours are authored in sRGB; THREE.Color converts them to linear for the shaders.
  uFogSun: { value: new THREE.Color('#f7955a') },
  uFogAway: { value: new THREE.Color('#9a7aa3') },
  uSkyBand: { value: new THREE.Color('#f6a77a') },
  uSkyMid: { value: new THREE.Color('#c27a9c') },
  uSkyHigh: { value: new THREE.Color('#5d4f98') },
  uSkyZenith: { value: new THREE.Color('#1b2252') },
  uSunGlow: { value: new THREE.Color('#ff7a2e') },
  uCloudLit: { value: new THREE.Color('#ff9a6a') },
  uCloudDark: { value: new THREE.Color('#5b4566') },
  uTime: { value: 0 },
};

export function sunDirection(env: EnvironmentData | undefined, out = new THREE.Vector3()): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(env?.sunAzimuth ?? 295);
  const el = THREE.MathUtils.degToRad(env?.sunElevation ?? 9);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

/** GLSL: fog / horizon colour for a view direction. Shared so sky and fog match exactly. */
export const horizonGLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uFogSun;
  uniform vec3 uFogAway;
  vec3 horizonColor(vec3 dir) {
    vec3 flatDir = normalize(vec3(dir.x, 0.0001, dir.z));
    vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
    float s = max(dot(flatDir, flatSun), 0.0);
    return mix(uFogAway, uFogSun, pow(s, 2.5));
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const skyFragment = /* glsl */ `
  ${horizonGLSL}
  uniform float uTime;
  uniform vec3 uSkyBand, uSkyMid, uSkyHigh, uSkyZenith, uSunGlow, uCloudLit, uCloudDark;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = max(dot(d, uSunDir), 0.0);
    vec3 horizon = horizonColor(d);

    // Horizon → peach band → rose → violet → deep indigo zenith.
    vec3 col = mix(horizon, uSkyBand, smoothstep(0.0, 0.08, h) * (0.55 + 0.45 * pow(sd, 1.5)));
    col = mix(col, uSkyMid, smoothstep(0.06, 0.26, h));
    col = mix(col, uSkyHigh, smoothstep(0.2, 0.5, h));
    col = mix(col, uSkyZenith, smoothstep(0.45, 1.0, h));
    if (h < 0.0) col = mix(horizon, horizon * 0.7, smoothstep(0.0, -0.25, h));

    // Warm glow around the sun, strongest low in the sky.
    float low = 1.0 - smoothstep(0.0, 0.5, h);
    col += uSunGlow * pow(sd, 5.0) * 0.45 * low;
    col += uSunGlow * pow(sd, 40.0) * 0.6;
    // Sun disc.
    col = mix(col, vec3(1.0, 0.82, 0.55) * 1.6, smoothstep(0.9994, 0.99965, sd));

    // Clouds: fbm projected onto a high plane, lit pink-orange on the sun side.
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.08) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
      float n = fbm(uv * 1.3);
      float streak = fbm(vec2(uv.x * 0.45, uv.y * 2.4) + 3.7);
      float c = smoothstep(0.52, 0.78, n * 0.6 + streak * 0.55) * smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.55, 0.9, h));
      float lit = pow(sd, 2.0);
      vec3 cloud = mix(uCloudDark, uCloudLit, 0.2 + 0.8 * lit);
      cloud += uSunGlow * pow(sd, 20.0) * 0.6; // bright rim near the sun
      col = mix(col, cloud, c * 0.88);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight('#ffa866', 3.4);
  readonly fill = new THREE.HemisphereLight('#b3a6e6', '#8a6048', 1.9);
  readonly sunDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: envUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -75;
    c.right = c.top = 75;
    c.near = 1;
    c.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;

    scene.add(this.sky, this.sun, this.sun.target, this.fill);
    scene.fog = new THREE.FogExp2('#c08a8a', 0.0042);
  }

  configure(env: EnvironmentData | undefined): void {
    sunDirection(env, this.sunDir);
    envUniforms.uSunDir.value.copy(this.sunDir);
  }

  /** Keep the sky centred on the camera and the shadow box centred on the player. */
  update(camera: THREE.Camera, focus: THREE.Vector3, time: number, shadows: boolean): void {
    this.sky.position.copy(camera.position);
    envUniforms.uTime.value = time;
    // Snap the shadow box to texel-sized steps so shadows don't shimmer as you move.
    const step = 150 / 4096;
    const fx = Math.round(focus.x / step) * step, fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 250);
    this.sun.castShadow = shadows;
  }
}

/**
 * Patch a built-in material so its fog uses the sky's horizon colour in the view
 * direction instead of a single flat colour.
 */
export function patchFog(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, envUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vFogWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogWorld;\n${horizonGLSL}`)
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          vec3 fogDir = normalize(vFogWorld - cameraPosition);
          float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, horizonColor(fogDir), fogF);
        #endif`,
      );
  };
  return material;
}
