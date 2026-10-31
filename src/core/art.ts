/* ============================================================
   Shared art assets: toon materials, gradient ramps, fake
   shadows and the capture orb look.
   ============================================================ */

import * as THREE from 'three';

const INK = 0x2a1246;

export const palette = {
  ink: INK,
  sun: 0xffd93d,
  mint: 0x2de1c2,
  coral: 0xff8a5b,
  pink: 0xff6b9d,
};

let gradientMap: THREE.DataTexture | null = null;

export function toonRamp(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  // four-step ramp = chunky cartoon shading, cheap and readable on a phone
  const steps = new Uint8Array([70, 140, 205, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientMap = tex;
  return tex;
}

export type BodyMaterial = THREE.MeshToonMaterial;

/** Shared clock so every shiny monster shimmers in step. */
export const timeUniform = { value: 0 };

const RIM_GLSL = /* glsl */ `
  float _rim = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float _edge = smoothstep(0.62, 0.95, _rim);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.11, 0.05, 0.22), _edge * 0.85);
  // faint warm bounce from the floor so monsters don't look pasted on
  gl_FragColor.rgb += vec3(0.05, 0.04, 0.02) * smoothstep(-0.3, 1.0, normal.y);
`;

/**
 * Vertex-coloured toon material with a darkened rim. The rim is what makes
 * blobs merged from primitives read as "drawn" instead of "3D".
 */
export function makeBodyMaterial(): BodyMaterial {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `${RIM_GLSL}\n#include <dithering_fragment>`);
  };
  mat.customProgramCacheKey = () => 'mh-body';
  return mat;
}

/** Shiny variant: the palette slides around the colour wheel over time. */
export function makeShinyBodyMaterial(): BodyMaterial {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.fragmentShader = `uniform float uTime;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        float _h = sin(uTime * 1.6) * 0.5 + 0.5;
        vec3 _rain = 0.6 + 0.45 * cos(6.2831853 * (_h + vec3(0.0, 0.33, 0.67)));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (0.35 + _rain), 0.5);
        gl_FragColor.rgb += vec3(0.16) * (0.5 + 0.5 * sin(uTime * 9.0));
        ${RIM_GLSL}
        #include <dithering_fragment>
      `,
    );
  };
  mat.customProgramCacheKey = () => 'mh-shiny';
  return mat;
}

/** Single shared instance of the plain body material. */
export const BODY_MAT = makeBodyMaterial();
/** Single shared instance of the shiny body material. */
export const SHINY_MAT = makeShinyBodyMaterial();
/** Single shared instance of the eye material. */
export const EYE_MAT = makeEyeMaterial();
/** Single shared instance of the outline material. */
export const OUTLINE_MAT = makeOutlineMaterial();

/** Eyes / gems: bright and flat-ish so they stay cute at any distance. */
export function makeEyeMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1a1a22, emissiveIntensity: 0.55 });
  return mat;
}

/** Inverted-hull outline: geometry is pre-expanded along smooth normals at build time. */
export function makeOutlineMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
}

// ------------------------------------------------------------------ shadow

let shadowTex: THREE.Texture | null = null;

function blobShadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(20,10,40,0.85)');
  g.addColorStop(0.45, 'rgba(20,10,40,0.42)');
  g.addColorStop(1, 'rgba(20,10,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  shadowTex = tex;
  return tex;
}

let glowTex: THREE.Texture | null = null;

export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTex = tex;
  return tex;
}

const SHADOW_GEO = new THREE.CircleGeometry(1, 24);

/** A soft pool on the floor under a monster — the single biggest AR tell. */
export function makeGroundShadow(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    map: blobShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.75,
    blending: THREE.NormalBlending,
  });
  const m = new THREE.Mesh(SHADOW_GEO, mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Element-coloured light pad, also on the floor, sells "standing on your carpet". */
export function makeGlowPad(color: THREE.ColorRepresentation): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(SHADOW_GEO, mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

// ------------------------------------------------------------------ orb

export function makeOrb(colorA: THREE.ColorRepresentation = '#fff3c9', colorB: THREE.ColorRepresentation = '#ff5f7e'): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshToonMaterial({ color: colorA, gradientMap: toonRamp() }),
  );
  const bottom = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 18, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshToonMaterial({ color: colorB, gradientMap: toonRamp() }),
  );
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.056, 0.008, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0x2a1246 }),
  );
  band.rotation.x = Math.PI / 2;
  const button = new THREE.Mesh(
    new THREE.SphereGeometry(0.017, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  button.position.set(0, 0, 0.052);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.021, 0.005, 6, 14),
    new THREE.MeshBasicMaterial({ color: 0x2a1246 }),
  );
  ring.position.set(0, 0, 0.05);
  g.add(top, bottom, band, button, ring);
  return g;
}

// ------------------------------------------------------------------ capture beam

export function makeBeam(color: THREE.ColorRepresentation): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.02, 0.34, 1, 16, 1, true);
  geo.translate(0, -0.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  return m;
}

export function makeRing(color: THREE.ColorRepresentation): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
