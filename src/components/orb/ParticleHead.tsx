"use client";

import { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

// ── constants ────────────────────────────────────────────────
const DEFAULT_PARTICLES = 20000;

// ── vertex shader ────────────────────────────────────────────
const VERTEX_SHADER = /* glsl */ `
    attribute float aPhase;
    attribute vec3 aNormal;

    uniform float uTime;
    uniform float uScaledTime;

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

    void main() {
        vec3 pos = position;
        vec3 nDir = length(aNormal) > 0.01 ? aNormal : vec3(0.0, 0.0, 1.0);

        // Subtle particle drift
        float n = snoise(pos * 0.4 + uScaledTime * 0.35) * 0.02;
        pos += nDir * n;

        // Breathing
        float breathe = sin(uTime * 0.55) * 0.01;
        pos += nDir * breathe;

        // Gentle idle sway
        pos.x += sin(uTime * 0.22) * 0.05;
        pos.y += sin(uTime * 0.17 + 0.8) * 0.025;

        // Subtle nod
        pos.y += sin(uTime * 0.13) * 0.008 * pos.z * 0.2;

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

                const animate = () => {
                    const animId = requestAnimationFrame(animate);
                    if (sceneRef.current) {
                        sceneRef.current.animId = animId;
                    }

                    const elapsed = clock.getElapsedTime();
                    const dt = elapsed - lastTime;
                    lastTime = elapsed;
                    scaledTime += dt * 0.08;

                    material.uniforms.uTime.value = elapsed;
                    material.uniforms.uScaledTime.value = scaledTime;

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
