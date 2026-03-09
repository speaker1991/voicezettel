"use client";

import { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import type { OrbState } from "@/types/chat";

// ── types ────────────────────────────────────────────────────
interface ParticleOrbProps {
    state: OrbState;
    audioLevel?: number;
    particleCount?: number;
    onClick?: () => void;
}

// ── constants ────────────────────────────────────────────────
const DEFAULT_PARTICLES = 5000;
const SPHERE_RADIUS = 2.0;

// ── vertex shader ────────────────────────────────────────────
// Instead of discrete state switching, uses two continuous params:
//   uIntensity:  0 = calm/idle, 1 = max intensity (thinking)
//   uAudioReact: 0 = no audio response, 1 = full audio pulse
const VERTEX_SHADER = /* glsl */ `
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aRadius;

    uniform float uTime;
    uniform float uScaledTime;
    uniform float uRotTime;
    uniform float uAudioLevel;
    uniform float uIntensity;
    uniform float uAudioReact;

    varying float vAlpha;

    // ── simplex noise ──
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

    void main() {
        vec3 dir = normalize(position);
        float r = aRadius;

        // ── Noise uses accumulated scaled time (no jumps on state change) ──
        float noiseAmp = 0.2 + uIntensity * 0.5;
        float n1 = snoise(dir * 2.0 + uScaledTime * 2.0) * noiseAmp;
        float n2 = snoise(dir * 4.0 - uScaledTime * 1.5) * noiseAmp * 0.4;
        r += n1 + n2;

        // ── Breathing (always present, slightly fades with intensity) ──
        float breathAmp = 0.05 * (1.0 - uIntensity * 0.3);
        float breath = sin(uTime * 0.8 + aPhase) * breathAmp;
        r += breath;

        // ── Audio reactivity: pulse + ripple ──
        float audioPulse = uAudioLevel * uAudioReact * 0.4 *
            sin(uTime * 5.0 + aPhase * 3.0);
        r += audioPulse;

        // ── Position ──
        vec3 newPos = dir * r;

        // ── Rotation: accumulated, not multiplied by total time ──
        float angle = uRotTime * aSpeed * 0.35;
        float cs = cos(angle);
        float sn = sin(angle);
        newPos = vec3(
            cs * newPos.x + sn * newPos.z,
            newPos.y,
            -sn * newPos.x + cs * newPos.z
        );

        vAlpha = 1.0;

        vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Voice-reactive particle size
        float baseSize = 2.2;
        float audioBoost = uAudioLevel * uAudioReact * 4.0;
        gl_PointSize = baseSize + audioBoost;
    }
`;

// ── fragment shader ──────────────────────────────────────────
const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 uColorBase;
    uniform vec3 uColorSpeak;
    uniform float uColorBlend;

    varying float vAlpha;

    void main() {
        vec3 col = mix(uColorBase, uColorSpeak, uColorBlend);
        gl_FragColor = vec4(col, vAlpha);
    }
`;

// ── state → continuous params ────────────────────────────────
interface OrbParams {
    intensity: number;
    audioReact: number;
    colorBlend: number; // 0 = base purple, 1 = speaking color
}

function stateToParams(state: OrbState): OrbParams {
    switch (state) {
        case "idle":
            return { intensity: 0.0, audioReact: 0.0, colorBlend: 0.0 };
        case "listening":
            return { intensity: 0.15, audioReact: 1.0, colorBlend: 0.0 };
        case "thinking":
            return { intensity: 0.85, audioReact: 0.0, colorBlend: 0.3 };
        case "speaking":
            return { intensity: 0.4, audioReact: 0.8, colorBlend: 1.0 };
        case "backgroundListening":
            return { intensity: 0.05, audioReact: 0.2, colorBlend: 0.0 };
    }
}

// ── geometry ─────────────────────────────────────────────────
function createParticleGeometry(count: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();

    const cols = Math.round(Math.sqrt(count * 2));
    const rows = Math.round(count / cols);
    const total = rows * cols;

    const positions = new Float32Array(total * 3);
    const phases = new Float32Array(total);
    const speeds = new Float32Array(total);
    const radii = new Float32Array(total);

    let idx = 0;
    for (let row = 0; row < rows; row++) {
        const phi = (Math.PI * (row + 0.5)) / rows;
        for (let col = 0; col < cols; col++) {
            const theta = (2 * Math.PI * col) / cols;
            const r = SPHERE_RADIUS;

            positions[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[idx * 3 + 1] = r * Math.cos(phi);
            positions[idx * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            phases[idx] = Math.random() * Math.PI * 2;
            speeds[idx] = 0.3 + Math.random() * 1.2;
            radii[idx] = r;
            idx++;
        }
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1));

    return geometry;
}

// ── component ────────────────────────────────────────────────
export function ParticleOrb({
    state,
    audioLevel = 0,
    particleCount = DEFAULT_PARTICLES,
    onClick,
}: ParticleOrbProps) {
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

    const stateRef = useRef(state);
    const audioRef = useRef(audioLevel);

    // синхронизируем refs с пропами после рендера
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        audioRef.current = audioLevel;
    }, [audioLevel]);

    const init = useCallback(
        (container: HTMLDivElement) => {
            const width = container.clientWidth;
            const height = container.clientHeight;

            const renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: false,
            });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
            camera.position.z = 7;

            const material = new THREE.ShaderMaterial({
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                uniforms: {
                    uTime: { value: 0 },
                    uScaledTime: { value: 0 },
                    uRotTime: { value: 0 },
                    uAudioLevel: { value: 0 },
                    uIntensity: { value: 0 },
                    uAudioReact: { value: 0 },
                    uColorBase: { value: new THREE.Color(0x8B5CF6) },
                    uColorSpeak: { value: new THREE.Color(0xBA38BE) },
                    uColorBlend: { value: 0 },
                },
                transparent: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });

            const geometry = createParticleGeometry(particleCount);
            const points = new THREE.Points(geometry, material);
            scene.add(points);

            const clock = new THREE.Clock();

            // smooth values — lerp factor ~0.02 = very gradual (~3s to settle)
            let smoothIntensity = 0;
            let smoothAudioReact = 0;
            let smoothAudio = 0;
            let smoothColorBlend = 0;
            let scaledTime = 0;
            let rotTime = 0;
            let lastTime = 0;
            const LERP_STATE = 0.006;
            const LERP_AUDIO = 0.08;

            const animate = () => {
                const animId = requestAnimationFrame(animate);
                sceneRef.current!.animId = animId;

                const elapsed = clock.getElapsedTime();
                const dt = elapsed - lastTime;
                lastTime = elapsed;
                const params = stateToParams(stateRef.current);
                const targetAudio = audioRef.current;

                // gradual ramp — takes ~3 seconds to fully transition
                smoothIntensity +=
                    (params.intensity - smoothIntensity) * LERP_STATE;
                smoothAudioReact +=
                    (params.audioReact - smoothAudioReact) * LERP_STATE;
                smoothColorBlend +=
                    (params.colorBlend - smoothColorBlend) * 0.03;
                smoothAudio += (targetAudio - smoothAudio) * LERP_AUDIO;

                // accumulate scaled time: base speed + intensity boost
                scaledTime += dt * (0.12 + smoothIntensity * 0.45);
                rotTime += dt * smoothIntensity;

                material.uniforms.uTime.value = elapsed;
                material.uniforms.uScaledTime.value = scaledTime;
                material.uniforms.uRotTime.value = rotTime;
                material.uniforms.uAudioLevel.value = smoothAudio;
                material.uniforms.uIntensity.value = smoothIntensity;
                material.uniforms.uAudioReact.value = smoothAudioReact;
                material.uniforms.uColorBlend.value = smoothColorBlend;

                // gentle auto-rotation
                points.rotation.y = elapsed * 0.08;
                points.rotation.x = Math.sin(elapsed * 0.04) * 0.15;

                renderer.render(scene, camera);
            };

            const animId = requestAnimationFrame(animate);

            sceneRef.current = {
                renderer,
                scene,
                camera,
                material,
                points,
                clock,
                animId,
            };
        },
        [particleCount],
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        try {
            init(container);
        } catch {
            // WebGL not available — CSS fallback remains visible
        }

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
                sceneRef.current.points.geometry.dispose();
                (
                    sceneRef.current.points
                        .material as THREE.ShaderMaterial
                ).dispose();
                if (container.contains(sceneRef.current.renderer.domElement)) {
                    container.removeChild(
                        sceneRef.current.renderer.domElement,
                    );
                }
                sceneRef.current = null;
            }
        };
    }, [init]);

    return (
        <div
            ref={containerRef}
            className="relative aspect-square w-full max-w-[280px] cursor-pointer select-none sm:max-w-[320px]"
            onClick={onClick}
            role="button"
            tabIndex={0}
            aria-label="Toggle voice session"
        >

        </div>
    );
}

