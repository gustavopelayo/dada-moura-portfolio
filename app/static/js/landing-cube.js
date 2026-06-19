import * as THREE from "/static/js/three.module.min.js";

const canvas = document.getElementById("landingCubeCanvas");
const cubeProjectsData = document.getElementById("cube-projects-data");
const focusControls = document.getElementById("landingFocusControls");
const focusPrevButton = document.getElementById("landingFocusPrev");
const focusNextButton = document.getElementById("landingFocusNext");

const horizontalFaceSequence = [4, 1, 5, 0];

function getCubeProjects() {
    if (!cubeProjectsData) return [];
    try {
        const parsed = JSON.parse(cubeProjectsData.textContent || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function createFaceMaterials(project) {
    const fallback = new THREE.MeshStandardMaterial({
        color: 0xc9b8a2, emissive: 0x2a221a, emissiveIntensity: 0.18,
        metalness: 0.15, roughness: 0.45,
    });
    if (!project || !Array.isArray(project.images) || project.images.length === 0) {
        return Array.from({ length: 6 }, () => fallback.clone());
    }
    const loader = new THREE.TextureLoader();
    const orderedImages = project.images.slice(0, 6);
    const faceOrder = [1, 0, 2, 3, 4, 5];
    return faceOrder.map((imageIndex) => {
        const imageUrl = orderedImages[imageIndex] || orderedImages[0];
        const texture = loader.load(imageUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return new THREE.MeshStandardMaterial({
            map: texture, emissive: 0x111111, emissiveIntensity: 0.1,
            metalness: 0.05, roughness: 0.8,
        });
    });
}

function getFrontRotationForMaterial(materialIndex) {
    switch (materialIndex) {
        case 0: return { x: 0, y: -Math.PI / 2, z: 0 };
        case 1: return { x: 0, y: Math.PI / 2, z: 0 };
        case 2: return { x: Math.PI / 2, y: 0, z: 0 };
        case 3: return { x: -Math.PI / 2, y: 0, z: 0 };
        case 4: return { x: 0, y: 0, z: 0 };
        case 5: return { x: 0, y: Math.PI, z: 0 };
        default: return { x: 0, y: 0, z: 0 };
    }
}

function buildFaceSequence(materialIndex) {
    if (horizontalFaceSequence.includes(materialIndex)) {
        const start = horizontalFaceSequence.indexOf(materialIndex);
        const rotated = horizontalFaceSequence.slice(start).concat(horizontalFaceSequence.slice(0, start));
        return rotated.concat([2, 3]);
    }
    if (materialIndex === 2) return [2].concat(horizontalFaceSequence, [3]);
    if (materialIndex === 3) return [3].concat(horizontalFaceSequence, [2]);
    return horizontalFaceSequence.concat([2, 3]);
}

function easeInOutCubic(v) {
    return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function setFocusControlsVisible(visible) {
    if (!focusControls) return;
    focusControls.classList.toggle("visible", visible);
    focusControls.setAttribute("aria-hidden", visible ? "false" : "true");
}

if (canvas) {
    const cubeProjects = getCubeProjects();

    if (cubeProjects.length === 0) {
        canvas.style.display = "none";
        setFocusControlsVisible(false);
    } else {
        const scene = new THREE.Scene();
        const renderer = new THREE.WebGLRenderer({
            canvas, alpha: true, antialias: true, powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;

        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        camera.position.set(0, 0, 8);
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const selectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const clickPoint = new THREE.Vector3();
        const clock = new THREE.Clock();

        let activeEntry = null;
        let activeFaceSequence = horizontalFaceSequence.slice();
        let activeFaceIndex = 0;
        let bounds = { minX: -5, maxX: 5, minY: -3.5, maxY: 3.5 };

        function computeBounds() {
            const aspect = window.innerWidth / window.innerHeight;
            const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
            bounds.minX = -halfHeight * aspect;
            bounds.maxX = halfHeight * aspect;
            bounds.minY = -halfHeight;
            bounds.maxY = halfHeight;
        }

        const CUBE_SIZE = 2.2;
        const COLLISION_R = CUBE_SIZE * Math.SQRT2 / 2;

        const CUBE_SCALE = 1.0;
        const CUBE_FOCUS_SCALE = 1.4;

        const baseConfigsDesktop = [
            { x: 2.2, y: 0.1, z: 0, spinX: 0.16, spinY: 0.24, spinZ: 0.08, wireColor: 0x241d18, wireOpacity: 0.8 },
            { x: -2.4, y: -1.3, z: -0.8, spinX: -0.12, spinY: 0.18, spinZ: -0.07, wireColor: 0x182029, wireOpacity: 0.78 },
            { x: -0.35, y: 1.65, z: -1.2, spinX: 0.11, spinY: -0.16, spinZ: 0.05, wireColor: 0x2b261f, wireOpacity: 0.74 },
        ];

        const baseConfigsMobile = [
            { x: 0, y: 1.95, z: 0, spinX: 0.16, spinY: 0.24, spinZ: 0.08, wireColor: 0x241d18, wireOpacity: 0.8 },
            { x: -1.35, y: -1.85, z: -0.8, spinX: -0.12, spinY: 0.18, spinZ: -0.07, wireColor: 0x182029, wireOpacity: 0.78 },
            { x: 1.45, y: -0.45, z: -1.1, spinX: 0.11, spinY: -0.16, spinZ: 0.05, wireColor: 0x2b261f, wireOpacity: 0.74 },
        ];

        const cubeEntries = cubeProjects.slice(0, 3).map((project, index) => {
            const config = baseConfigsDesktop[index];
            const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
            const mesh = new THREE.Mesh(geometry, createFaceMaterials(project));
            mesh.userData.project = project;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.scale.setScalar(CUBE_SCALE);
            scene.add(mesh);

            const wireframe = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: config.wireColor, transparent: true, opacity: config.wireOpacity })
            );
            mesh.add(wireframe);

            const shadowGeo = new THREE.PlaneGeometry(CUBE_SIZE * 1.2, CUBE_SIZE * 1.2);
            const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
            const shadow = new THREE.Mesh(shadowGeo, shadowMat);
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = -CUBE_SIZE * 0.52;
            mesh.add(shadow);

            const speed = 0.25 + Math.random() * 0.2;
            const angle = Math.random() * Math.PI * 2;

            return {
                mesh, shadow,
                state: {
                    spinX: config.spinX, spinY: config.spinY, spinZ: config.spinZ,
                    idleSpinX: config.spinX, idleSpinY: config.spinY, idleSpinZ: config.spinZ,
                    focusProgress: 0, focusTarget: 0,
                    homeScale: CUBE_SCALE, focusedScale: CUBE_FOCUS_SCALE,
                    frontRotation: { x: 0, y: 0, z: 0 },
                    targetQuaternion: new THREE.Quaternion(),
                    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                    z: config.z, returning: false,
                    returnTarget: { x: 0, y: 0 },
                },
                desktop: config, mobile: baseConfigsMobile[index],
            };
        });

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xfff4e8, 2.8);
        keyLight.position.set(5, 6, 8);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 30;
        keyLight.shadow.camera.left = -8;
        keyLight.shadow.camera.right = 8;
        keyLight.shadow.camera.top = 8;
        keyLight.shadow.camera.bottom = -8;
        keyLight.shadow.radius = 4;
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x8f7d68, 1.5);
        rimLight.position.set(-5, -2, 3);
        scene.add(rimLight);

        const fillLight = new THREE.DirectionalLight(0xc4d4e8, 0.6);
        fillLight.position.set(-2, 4, -3);
        scene.add(fillLight);

        const groundGeo = new THREE.PlaneGeometry(50, 50);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.12 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -5;
        ground.receiveShadow = true;
        scene.add(ground);

        function clampToBounds(entry) {
            const pos = entry.mesh.position;
            if (pos.x - COLLISION_R < bounds.minX) { pos.x = bounds.minX + COLLISION_R; entry.state.vx = Math.abs(entry.state.vx); }
            else if (pos.x + COLLISION_R > bounds.maxX) { pos.x = bounds.maxX - COLLISION_R; entry.state.vx = -Math.abs(entry.state.vx); }
            if (pos.y - COLLISION_R < bounds.minY) { pos.y = bounds.minY + COLLISION_R; entry.state.vy = Math.abs(entry.state.vy); }
            else if (pos.y + COLLISION_R > bounds.maxY) { pos.y = bounds.maxY - COLLISION_R; entry.state.vy = -Math.abs(entry.state.vy); }
        }

        function resolveCollision(a, b) {
            const dx = b.mesh.position.x - a.mesh.position.x;
            const dy = b.mesh.position.y - a.mesh.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = COLLISION_R * 2;
            if (dist >= minDist || dist < 0.001) return;

            const nx = dx / dist;
            const ny = dy / dist;
            const penetration = minDist - dist;
            const pushForce = penetration * 0.15;

            a.state.vx -= nx * pushForce;
            a.state.vy -= ny * pushForce;
            b.state.vx += nx * pushForce;
            b.state.vy += ny * pushForce;

            const separate = penetration * 0.51;
            a.mesh.position.x -= nx * separate;
            a.mesh.position.y -= ny * separate;
            b.mesh.position.x += nx * separate;
            b.mesh.position.y += ny * separate;
        }

        function pickReturnTarget(entry) {
            entry.state.returnTarget = {
                x: bounds.minX + COLLISION_R + Math.random() * (bounds.maxX - bounds.minX - COLLISION_R * 2),
                y: bounds.minY + COLLISION_R + Math.random() * (bounds.maxY - bounds.minY - COLLISION_R * 2),
            };
        }

        function applyFaceFocus(entry, materialIndex) {
            activeFaceSequence = buildFaceSequence(materialIndex);
            activeFaceIndex = 0;
            entry.state.frontRotation = getFrontRotationForMaterial(activeFaceSequence[activeFaceIndex]);
            entry.state.targetQuaternion.setFromEuler(
                new THREE.Euler(entry.state.frontRotation.x, entry.state.frontRotation.y, entry.state.frontRotation.z)
            );
        }

        function focusCube(entry, materialIndex = 4) {
            activeEntry = entry;
            cubeEntries.forEach((ce) => {
                ce.state.focusTarget = ce === entry ? 1 : 0;
                ce.state.spinX = ce === entry ? 0 : ce.state.idleSpinX;
                ce.state.spinY = ce === entry ? 0 : ce.state.idleSpinY;
                ce.state.spinZ = ce === entry ? 0 : ce.state.idleSpinZ;
                ce.state.returning = false;
            });
            applyFaceFocus(entry, materialIndex);
            setFocusControlsVisible(true);
        }

        function resetFocus() {
            activeEntry = null;
            activeFaceIndex = 0;
            cubeEntries.forEach((entry) => {
                entry.state.focusTarget = 0;
                entry.state.spinX = entry.state.idleSpinX;
                entry.state.spinY = entry.state.idleSpinY;
                entry.state.spinZ = entry.state.idleSpinZ;
                entry.state.returning = true;
                pickReturnTarget(entry);
                const angle = Math.atan2(
                    entry.state.returnTarget.y - entry.mesh.position.y,
                    entry.state.returnTarget.x - entry.mesh.position.x
                );
                const speed = 0.3 + Math.random() * 0.15;
                entry.state.vx = Math.cos(angle) * speed;
                entry.state.vy = Math.sin(angle) * speed;
            });
            setFocusControlsVisible(false);
        }

        function cycleFocusedCube(direction) {
            if (!activeEntry) return;
            activeFaceIndex = (activeFaceIndex + direction + activeFaceSequence.length) % activeFaceSequence.length;
            activeEntry.state.frontRotation = getFrontRotationForMaterial(activeFaceSequence[activeFaceIndex]);
            activeEntry.state.targetQuaternion.setFromEuler(
                new THREE.Euler(activeEntry.state.frontRotation.x, activeEntry.state.frontRotation.y, activeEntry.state.frontRotation.z)
            );
        }

        function updateCube(entry, delta, elapsed) {
            const { mesh, state } = entry;
            state.focusProgress = lerp(state.focusProgress, state.focusTarget, delta * 1.7);
            const focusMix = easeInOutCubic(Math.min(Math.max(state.focusProgress, 0), 1));

            if (focusMix < 0.5) {
                if (state.returning) {
                    const dx = state.returnTarget.x - mesh.position.x;
                    const dy = state.returnTarget.y - mesh.position.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 0.15) {
                        state.returning = false;
                        const a = Math.random() * Math.PI * 2;
                        const s = 0.25 + Math.random() * 0.2;
                        state.vx = Math.cos(a) * s;
                        state.vy = Math.sin(a) * s;
                    } else {
                        const arriveSpeed = Math.max(dist * 1.2, 0.3);
                        state.vx = (dx / dist) * arriveSpeed;
                        state.vy = (dy / dist) * arriveSpeed;
                    }
                }

                mesh.position.x += state.vx * delta;
                mesh.position.y += state.vy * delta;
                mesh.position.z = state.z + Math.sin(elapsed * 0.7 + entry.mesh.id) * 0.12;
                clampToBounds(entry);

                if (!state.returning) {
                    const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                    state.vx *= 0.998;
                    state.vy *= 0.998;
                    if (speed < 0.15) { const s = 0.15 / (speed || 1); state.vx *= s; state.vy *= s; }
                    else if (speed > 0.6) { const s = 0.6 / speed; state.vx *= s; state.vy *= s; }
                }
            }

            mesh.position.x = lerp(mesh.position.x, 0.12, focusMix);
            mesh.position.y = lerp(mesh.position.y, 0.08, focusMix);
            mesh.position.z = lerp(mesh.position.z, 2.2, focusMix);
            mesh.scale.setScalar(lerp(state.homeScale, state.focusedScale, focusMix));
            mesh.rotation.x += state.spinX * delta;
            mesh.rotation.y += state.spinY * delta;
            mesh.rotation.z += state.spinZ * delta;

            if (state.focusTarget > 0.5) {
                mesh.quaternion.slerp(state.targetQuaternion, Math.min(delta * 4.2, 1));
            }

            entry.shadow.material.opacity = lerp(0.22, 0.08, focusMix);
            entry.shadow.position.y = lerp(-CUBE_SIZE * 0.52, -CUBE_SIZE * 0.3, focusMix);
        }

        function handlePointerDown(event) {
            const rect = canvas.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(pointer, camera);
            const meshes = cubeEntries.map((e) => e.mesh);
            const intersects = raycaster.intersectObjects(meshes, true);
            const hit = intersects.find((i) => meshes.includes(i.object));

            if (activeEntry) {
                if (hit) {
                    const target = cubeEntries.find((e) => e.mesh === hit.object);
                    if (target === activeEntry) { cycleFocusedCube(1); return; }
                }
                resetFocus();
                return;
            }

            if (hit) {
                const target = cubeEntries.find((e) => e.mesh === hit.object);
                if (target) { focusCube(target, hit.face?.materialIndex ?? 4); return; }
            }

            if (raycaster.ray.intersectPlane(selectionPlane, clickPoint)) {
                const threshold = window.innerWidth < 768 ? 2.6 : 2.9;
                const nearest = cubeEntries
                    .map((e) => ({ e, d: e.mesh.position.distanceTo(clickPoint) }))
                    .sort((a, b) => a.d - b.d)[0];
                if (nearest && nearest.d < threshold) { focusCube(nearest.e, 4); return; }
            }
        }

        function resize() {
            renderer.setSize(window.innerWidth, window.innerHeight, false);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            computeBounds();
        }

        function randomPlaceCubes() {
            const placed = [];
            cubeEntries.forEach((entry) => {
                let x, y, attempts = 0;
                do {
                    x = bounds.minX + COLLISION_R + Math.random() * (bounds.maxX - bounds.minX - COLLISION_R * 2);
                    y = bounds.minY + COLLISION_R + Math.random() * (bounds.maxY - bounds.minY - COLLISION_R * 2);
                    attempts++;
                } while (
                    attempts < 50 &&
                    placed.some((p) => Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2) < COLLISION_R * 2 + 0.3)
                );
                entry.mesh.position.set(x, y, entry.state.z);
                placed.push({ x, y });
            });
        }

        function animate() {
            const delta = Math.min(clock.getDelta(), 0.033);
            const elapsed = clock.elapsedTime;

            camera.position.x = Math.sin(elapsed * 0.08) * 0.15;
            camera.position.y = Math.cos(elapsed * 0.06) * 0.1;
            camera.lookAt(0, 0, 0);

            for (let i = 0; i < cubeEntries.length; i++) {
                for (let j = i + 1; j < cubeEntries.length; j++) {
                    if (!activeEntry) resolveCollision(cubeEntries[i], cubeEntries[j]);
                }
            }

            cubeEntries.forEach((entry) => updateCube(entry, delta, elapsed));
            renderer.render(scene, camera);
            window.requestAnimationFrame(animate);
        }

        resize();
        randomPlaceCubes();
        canvas.addEventListener("pointerdown", handlePointerDown);
        focusPrevButton?.addEventListener("click", (e) => { e.stopPropagation(); cycleFocusedCube(1); });
        focusNextButton?.addEventListener("click", (e) => { e.stopPropagation(); cycleFocusedCube(-1); });
        window.addEventListener("resize", resize);
        animate();
    }
}
