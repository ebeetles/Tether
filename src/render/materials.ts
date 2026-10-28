import * as THREE from 'three';

// Flat, high-contrast look: banded lighting plus a world-space metre grid, so speed and
// distance read clearly on grey-box geometry (spec: Art and audio for feel).

export const SKY = new THREE.Color('#c7d3df');
export const ANCHOR_GLOW = new THREE.Color('#29e3ff');

const vertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSky;
  uniform float uOpacity;
  uniform float uGrid;
  uniform float uFogDensity;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float gridLines(vec2 p, float scale) {
    vec2 c = p / scale;
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 L = normalize(vec3(0.45, 0.8, 0.3));
    float d = max(dot(n, L), 0.0);
    float band = d > 0.65 ? 1.0 : d > 0.3 ? 0.84 : 0.7;
    band += 0.08 * max(n.y, 0.0);
    vec3 col = uColor * band;

    if (uGrid > 0.0) {
      vec3 a = abs(n);
      vec2 uv = a.y > a.x && a.y > a.z ? vWorld.xz : a.x > a.z ? vWorld.zy : vWorld.xy;
      float minor = gridLines(uv, 1.0);
      float major = gridLines(uv, 4.0);
      col *= 1.0 - 0.08 * minor * uGrid - 0.12 * major * uGrid;
    }

    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    gl_FragColor = vec4(mix(col, uSky, clamp(fog, 0.0, 1.0)), uOpacity);
    #include <colorspace_fragment>
  }
`;

const cache = new Map<string, THREE.ShaderMaterial>();

export function levelMaterial(color: string, opts: { opacity?: number; grid?: boolean } = {}): THREE.ShaderMaterial {
  const opacity = opts.opacity ?? 1;
  const grid = opts.grid ?? true;
  const key = `${color}|${opacity}|${grid}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSky: { value: SKY },
        uOpacity: { value: opacity },
        uGrid: { value: grid ? 1 : 0 },
        uFogDensity: { value: 0.0045 },
      },
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
    });
    cache.set(key, m);
  }
  return m;
}

/** Soft round glow used for anchor halos. */
export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
