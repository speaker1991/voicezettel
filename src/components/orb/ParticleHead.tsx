"use client";

import { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

// ── constants ────────────────────────────────────────────────
const DEFAULT_PARTICLES = 20000;

// ── Mood sequence config ─────────────────────────────────────
const MOOD_NAMES = ["idle", "bored", "sigh", "look_left", "curious"] as const;
const MOOD_DURATIONS: Record<string, number> = {
    idle: 7,
    bored: 6,
    sigh: 5,
    look_left: 6,
    curious: 7,
};
const BLEND_DURATION = 0.8;

// ── vertex shader ────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */ `
    attribute float aPhase;
    attribute vec3 aNormal;

    uniform float uTime;
    uniform float uScaledTime;
    uniform float uMood;
    uniform float uMoodPrev;
    uniform float uMoodBlend;
    uniform float uMoodTime;

    varying float vAlpha;
    varying float vFacing;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 xx = x_ * ns.x + ns.yyyy;
        vec4 yy = y_ * ns.x + ns.yyyy;
        vec4 zz = 1.0 - abs(xx) - abs(yy);
        vec4 a0 = xx; vec4 b0 = yy;
        vec4 s0 = floor(a0) * 2.0 + 1.0;
        vec4 s1 = floor(b0) * 2.0 + 1.0;
        vec4 sh = -step(zz, vec4(0.0));
        vec4 a0b = a0 + s0 * sh.xxyy;
        vec4 a1b = vec4(b0.xy + s1.xy * sh.xy, b0.zw + s1.zw * sh.zw);
        vec3 p0 = vec3(a0b.x, a1b.x, zz.x);
        vec3 p1 = vec3(a0b.y, a1b.y, zz.y);
        vec3 p2 = vec3(a0b.z, a1b.z, zz.z);
        vec3 p3 = vec3(a0b.w, a1b.w, zz.w);
        vec4 norm = 1.79284291400159 - 0.85373472095314 *
            vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    // ── Y-axis rotation ──
    vec3 rotateY(vec3 p, float angle) {
        float cs = cos(angle);
        float sn = sin(angle);
        return vec3(cs * p.x + sn * p.z, p.y, -sn * p.x + cs * p.z);
    }

    // ── Mood pose function ──
    // Returns displaced position for a given mood index and moodTime
    vec3 applyMood(vec3 pos, vec3 nDir, float mood, float mt, float st) {
        vec3 p = pos;

        // ─── 0: idle ─────────────────────────────────
        if (mood < 0.5) {
            float n = snoise(p * 0.4 + st * 0.35) * 0.02;
            p += nDir * n;
            p += nDir * sin(uTime * 0.55) * 0.01;               // breathe
            p.x += sin(uTime * 0.22) * 0.05;                     // sway X
            p.y += sin(uTime * 0.17 + 0.8) * 0.025;             // sway Y
            p.y += sin(uTime * 0.13) * 0.008 * p.z * 0.2;       // nod
        }

        // ─── 1: bored ────────────────────────────────
        else if (mood < 1.5) {
            float slowSt = st * 0.33;   // shimmer 3x slower
            float n = snoise(p * 0.4 + slowSt * 0.35) * 0.015;
            p += nDir * n;
            p += nDir * sin(uTime * 0.35) * 0.006;               // sluggish breathe

            // Head tilts down 15deg and right 5deg
            float tiltDown = radians(-15.0);
            float tiltRight = radians(5.0);
            p.y += sin(tiltDown) * p.z * 0.15;
            p.z += cos(tiltDown) * 0.0;
            p.x += sin(tiltRight) * p.z * 0.05;

            // Shoulders droop (lower parts sink)
            float shoulderMask = smoothstep(0.0, -0.5, p.y);
            p.y -= shoulderMask * 0.06;

            // Minimal sway
            p.x += sin(uTime * 0.12) * 0.02;
        }

        // ─── 2: sigh ─────────────────────────────────
        else if (mood < 2.5) {
            float dur = 5.0;
            float phase = mt / dur;
            float n = snoise(p * 0.4 + st * 0.35) * 0.02;
            p += nDir * n;

            float shoulderMask = smoothstep(0.0, -0.5, p.y);
            float chestMask = smoothstep(-0.2, 0.3, p.y) * smoothstep(-0.5, 0.3, p.z);

            if (phase < 0.4) {
                // Phase 1: inhale (0-2s)
                float t = phase / 0.4;
                float ease = t * t * (3.0 - 2.0 * t); // smoothstep
                p.y += shoulderMask * 0.08 * ease;
                p.z += chestMask * 0.04 * ease;
                p.y += 0.01 * ease * p.z; // head forward
            } else if (phase < 0.6) {
                // Phase 2: hold (2-3s)
                p.y += shoulderMask * 0.08;
                p.z += chestMask * 0.04;
                p.y += 0.01 * p.z;
            } else {
                // Phase 3: exhale (3-5s)
                float t = (phase - 0.6) / 0.4;
                float ease = 1.0 - t * t * (3.0 - 2.0 * t);
                p.y += shoulderMask * 0.08 * ease;
                p.z += chestMask * 0.04 * ease;
                p.y += 0.01 * ease * p.z;
            }

            p += nDir * sin(uTime * 0.55) * 0.008;
        }

        // ─── 3: look_left ────────────────────────────
        else if (mood < 3.5) {
            float dur = 6.0;
            float phase = mt / dur;
            float n = snoise(p * 0.4 + st * 0.35) * 0.02;
            p += nDir * n;
            p += nDir * sin(uTime * 0.55) * 0.01;

            float angle = 0.0;
            float maxAngle = radians(35.0);

            if (phase < 0.333) {
                // Phase 1: turn left (0-2s)
                float t = phase / 0.333;
                angle = maxAngle * t * t * (3.0 - 2.0 * t);
            } else if (phase < 0.5) {
                // Phase 2: hold (2-3s)
                angle = maxAngle;
            } else {
                // Phase 3: return (3-6s)
                float t = (phase - 0.5) / 0.5;
                angle = maxAngle * (1.0 - t * t * (3.0 - 2.0 * t));
            }

            p = rotateY(p, angle);

            // Eye zone shimmer during turn
            float eyeMask = step(0.5, p.y) * step(0.0, p.z);
            p.x += eyeMask * sin(uTime * 3.0 + aPhase) * 0.008 * sin(angle);

            p.x += sin(uTime * 0.18) * 0.03;
        }

        // ─── 4: curious ──────────────────────────────
        else {
            float fastSt = st * 1.5;   // shimmer 1.5x faster
            float n = snoise(p * 0.4 + fastSt * 0.35) * 0.025;
            p += nDir * n;
            p += nDir * sin(uTime * 0.65) * 0.012;

            // Head sways ±12deg on Y
            float headSwing = sin(uTime * 0.7) * radians(12.0);
            p = rotateY(p, headSwing);

            // Energetic X sway
            p.x += sin(uTime * 0.35) * 0.08;
            p.y += sin(uTime * 0.28 + 1.0) * 0.03;

            // Micro shoulder movements
            float shoulderMask = smoothstep(0.0, -0.5, p.y);
            p.y += shoulderMask * sin(uTime * 1.2) * 0.015;
        }

        return p;
    }

    void main() {
        vec3 nDir = length(aNormal) > 0.01 ? aNormal : vec3(0.0, 0.0, 1.0);

        // Compute pose for current and previous mood
        vec3 posCurr = applyMood(position, nDir, uMood, uMoodTime, uScaledTime);
        vec3 posPrev = applyMood(position, nDir, uMoodPrev, uMoodTime, uScaledTime);

        // Blend between moods during transition
        vec3 pos = mix(posPrev, posCurr, uMoodBlend);

        // Facing ratio for depth shading
        vec3 viewDir = normalize(cameraPosition - (modelMatrix * vec4(pos, 1.0)).xyz);
        vFacing = max(dot(normalize(nDir), viewDir), 0.0);

        vAlpha = 1.0;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = 2.2;
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    varying float vAlpha;
    varying float vFacing;

    void main() {
        float facing = 0.5 + vFacing * 0.5;
        float rim = pow(1.0 - vFacing, 2.0) * 0.4;
        vec3 col = uColorA * facing + uColorA * rim;
        float alpha = 0.65 + vFacing * 0.35;
        gl_FragColor = vec4(col, vAlpha * alpha);
    }
`;

// ── props ────────────────────────────────────────────────────
interface ParticleHeadProps {
    particleCount?: number;
}

// ── component ────────────────────────────────────────────────
export function ParticleHead({
    particleCount = DEFAULT_PARTICLES,
}: ParticleHeadProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<{
        renderer: THREE.WebGLRenderer;
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        material: THREE.ShaderMaterial;
        points: THREE.Points;
        clock: THREE.Clock;
        animId: number;
    } | null>(null);

    const init = useCallback(
        (container: HTMLDivElement) => {
            const width = container.clientWidth;
            const height = container.clientHeight;

            const renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: false,
            });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(width, height);
            renderer.setClearColor(0x000000, 0);
            container.appendChild(renderer.domElement);

            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(
                45,
                width / height,
                0.1,
                100,
            );
            camera.position.set(0, 0, 12);

            const material = new THREE.ShaderMaterial({
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                uniforms: {
                    uTime: { value: 0 },
                    uScaledTime: { value: 0 },
                    uMood: { value: 0 },
                    uMoodPrev: { value: 0 },
                    uMoodBlend: { value: 1.0 },
                    uMoodTime: { value: 0 },
                    uColorA: { value: new THREE.Color(0xBA38BE) },
                    uColorB: { value: new THREE.Color(0x06B6D4) },
                },
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const loader = new GLTFLoader();
            loader.load("/head.glb", (gltf) => {
                let headMesh: THREE.Mesh | null = null;
                gltf.scene.traverse((child) => {
                    if (child instanceof THREE.Mesh && !headMesh) {
                        headMesh = child;
                    }
                });
                if (!headMesh) return;

                const sampler = new MeshSurfaceSampler(headMesh).build();
                const tempPos = new THREE.Vector3();
                const tempNorm = new THREE.Vector3();

                const geometry = new THREE.BufferGeometry();
                const positions = new Float32Array(particleCount * 3);
                const normals = new Float32Array(particleCount * 3);
                const phases = new Float32Array(particleCount);

                for (let i = 0; i < particleCount; i++) {
                    sampler.sample(tempPos, tempNorm);
                    positions[i * 3] = tempPos.x;
                    positions[i * 3 + 1] = tempPos.y;
                    positions[i * 3 + 2] = tempPos.z;
                    normals[i * 3] = tempNorm.x;
                    normals[i * 3 + 1] = tempNorm.y;
                    normals[i * 3 + 2] = tempNorm.z;
                    phases[i] = Math.random() * Math.PI * 2;
                }

                geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
                geometry.setAttribute("aNormal", new THREE.BufferAttribute(normals, 3));
                geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

                const points = new THREE.Points(geometry, material);
                scene.add(points);

                const clock = new THREE.Clock();
                let scaledTime = 0;
                let lastTime = 0;

                // ── Mood sequencer state ──
                let currentMoodIdx = 0;
                let prevMoodIdx = 0;
                let moodStartTime = 0;
                let blendStartTime = 0;
                let blendDone = true;

                const animate = () => {
                    const animId = requestAnimationFrame(animate);
                    if (sceneRef.current) {
                        sceneRef.current.animId = animId;
                    }

                    const elapsed = clock.getElapsedTime();
                    const dt = elapsed - lastTime;
                    lastTime = elapsed;
                    scaledTime += dt * 0.08;

                    // ── Mood transition logic ──
                    const moodName = MOOD_NAMES[currentMoodIdx];
                    const moodDuration = MOOD_DURATIONS[moodName];
                    const moodElapsed = elapsed - moodStartTime;

                    if (moodElapsed >= moodDuration) {
                        prevMoodIdx = currentMoodIdx;
                        currentMoodIdx = (currentMoodIdx + 1) % MOOD_NAMES.length;
                        moodStartTime = elapsed;
                        blendStartTime = elapsed;
                        blendDone = false;
                    }

                    // Compute blend factor (0→1 over BLEND_DURATION)
                    let blend = 1.0;
                    if (!blendDone) {
                        const blendElapsed = elapsed - blendStartTime;
                        blend = Math.min(blendElapsed / BLEND_DURATION, 1.0);
                        // Smooth ease in-out
                        blend = blend * blend * (3 - 2 * blend);
                        if (blend >= 1.0) blendDone = true;
                    }

                    const u = material.uniforms;
                    u.uTime.value = elapsed;
                    u.uScaledTime.value = scaledTime;
                    u.uMood.value = currentMoodIdx;
                    u.uMoodPrev.value = prevMoodIdx;
                    u.uMoodBlend.value = blend;
                    u.uMoodTime.value = elapsed - moodStartTime;

                    renderer.render(scene, camera);
                };

                const animId = requestAnimationFrame(animate);
                sceneRef.current = {
                    renderer, scene, camera, material, points, clock, animId,
                };
            });

            if (!sceneRef.current) {
                sceneRef.current = {
                    renderer, scene, camera, material,
                    points: new THREE.Points(),
                    clock: new THREE.Clock(),
                    animId: 0,
                };
            }
        },
        [particleCount],
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        init(container);

        const handleResize = () => {
            if (!sceneRef.current || !container) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            sceneRef.current.renderer.setSize(w, h);
            sceneRef.current.camera.aspect = w / h;
            sceneRef.current.camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            if (sceneRef.current) {
                cancelAnimationFrame(sceneRef.current.animId);
                sceneRef.current.renderer.dispose();
                if (sceneRef.current.points.geometry) {
                    sceneRef.current.points.geometry.dispose();
                }
                sceneRef.current.material.dispose();
                if (container.contains(sceneRef.current.renderer.domElement)) {
                    container.removeChild(sceneRef.current.renderer.domElement);
                }
                sceneRef.current = null;
            }
        };
    }, [init]);

    return (
        <div
            ref={containerRef}
            className="relative aspect-square w-full max-w-[280px] select-none sm:max-w-[320px]"
        />
    );
}
