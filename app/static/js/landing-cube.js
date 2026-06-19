import * as THREE from "/static/js/three.module.min.js";

const canvas = document.getElementById("landingCubeCanvas");
const cubeProjectsData = document.getElementById("cube-projects-data");
const focusControls = document.getElementById("landingFocusControls");
const focusPrevButton = document.getElementById("landingFocusPrev");
const focusNextButton = document.getElementById("landingFocusNext");

const horizontalFaceSequence = [4, 1, 5, 0];

function getCubeProjects() {
    if (!cubeProjectsData) {
        return [];
    }

    try {
        const parsed = JSON.parse(cubeProjectsData.textContent || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function createFaceMaterials(project) {
    const fallback = new THREE.MeshStandardMaterial({
        color: 0xc9b8a2,
        emissive: 0x2a221a,
        emissiveIntensity: 0.18,
        metalness: 0.15,
        roughness: 0.45,
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
            map: texture,
            emissive: 0x111111,
            emissiveIntensity: 0.1,
            metalness: 0.05,
            roughness: 0.8,
        });
    });
}

function getFrontRotationForMaterial(materialIndex) {
    switch (materialIndex) {
        case 0:
            return { x: 0, y: -Math.PI / 2, z: 0 };
        case 1:
            return { x: 0, y: Math.PI / 2, z: 0 };
        case 2:
            return { x: Math.PI / 2, y: 0, z: 0 };
        case 3:
            return { x: -Math.PI / 2, y: 0, z: 0 };
        case 4:
            return { x: 0, y: 0, z: 0 };
        case 5:
            return { x: 0, y: Math.PI, z: 0 };
        default:
            return { x: 0, y: 0, z: 0 };
    }
}

function buildFaceSequence(materialIndex) {
    if (horizontalFaceSequence.includes(materialIndex)) {
        const startIndex = horizontalFaceSequence.indexOf(materialIndex);
        const rotatedHorizontalFaces = horizontalFaceSequence
            .slice(startIndex)
            .concat(horizontalFaceSequence.slice(0, startIndex));

        return rotatedHorizontalFaces.concat([2, 3]);
    }

    if (materialIndex === 2) {
        return [2].concat(horizontalFaceSequence, [3]);
    }

    if (materialIndex === 3) {
        return [3].concat(horizontalFaceSequence, [2]);
    }

    return horizontalFaceSequence.concat([2, 3]);
}

function easeInOutCubic(value) {
    return value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function setFocusControlsVisible(visible) {
    if (!focusControls) {
        return;
    }

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
            canvas,
            alpha: true,
            antialias: true,
            powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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

        const baseConfigsDesktop = [
            { size: 2.8, x: 2.2, y: 0.1, z: 0, scale: 1.15, focusedScale: 1.15, spinX: 0.16, spinY: 0.24, spinZ: 0.08, wireColor: 0x241d18, wireOpacity: 0.8 },
            { size: 1.8, x: -2.4, y: -1.3, z: -0.8, scale: 1, focusedScale: 1.8, spinX: -0.12, spinY: 0.18, spinZ: -0.07, wireColor: 0x182029, wireOpacity: 0.78 },
            { size: 2.1, x: -0.35, y: 1.65, z: -1.2, scale: 0.98, focusedScale: 1.45, spinX: 0.11, spinY: -0.16, spinZ: 0.05, wireColor: 0x2b261f, wireOpacity: 0.74 },
        ];

        const baseConfigsMobile = [
            { size: 2.8, x: 0, y: 1.95, z: 0, scale: 0.9, focusedScale: 0.9, spinX: 0.16, spinY: 0.24, spinZ: 0.08, wireColor: 0x241d18, wireOpacity: 0.8 },
            { size: 1.8, x: -1.35, y: -1.85, z: -0.8, scale: 0.88, focusedScale: 1.4, spinX: -0.12, spinY: 0.18, spinZ: -0.07, wireColor: 0x182029, wireOpacity: 0.78 },
            { size: 2.1, x: 1.45, y: -0.45, z: -1.1, scale: 0.8, focusedScale: 1.2, spinX: 0.11, spinY: -0.16, spinZ: 0.05, wireColor: 0x2b261f, wireOpacity: 0.74 },
        ];

        const cubeEntries = cubeProjects.slice(0, 3).map((project, index) => {
            const config = baseConfigsDesktop[index];
            const geometry = new THREE.BoxGeometry(config.size, config.size, config.size);
            const mesh = new THREE.Mesh(geometry, createFaceMaterials(project));
            mesh.userData.project = project;
            scene.add(mesh);

            const wireframe = new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({
                    color: config.wireColor,
                    transparent: true,
                    opacity: config.wireOpacity,
                })
            );
            mesh.add(wireframe);

            return {
                mesh,
                state: {
                    targetX: 0,
                    targetY: 0,
                    targetZ: 0,
                    spinX: config.spinX,
                    spinY: config.spinY,
                    spinZ: config.spinZ,
                    idleSpinX: config.spinX,
                    idleSpinY: config.spinY,
                    idleSpinZ: config.spinZ,
                    focusProgress: 0,
                    focusTarget: 0,
                    home: { x: 0, y: 0, z: 0 },
                    focused: { x: 0.12, y: 0.08, z: 1.9 },
                    frontRotation: { x: 0, y: 0, z: 0 },
                    targetQuaternion: new THREE.Quaternion(),
                    homeScale: config.scale,
                    focusedScale: config.focusedScale,
                },
                desktop: config,
                mobile: baseConfigsMobile[index],
            };
        });

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.75);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xfff4e8, 2.4);
        keyLight.position.set(4, 3, 5);
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x8f7d68, 1.8);
        rimLight.position.set(-5, -2, 3);
        scene.add(rimLight);

        function placeCube(entry, config) {
            const { mesh, state } = entry;
            state.targetX = config.x;
            state.targetY = config.y;
            state.targetZ = config.z;
            state.home = { x: config.x, y: config.y, z: config.z };
            state.focused = { x: 0.12, y: 0.08, z: 1.9 };
            state.frontRotation = { x: 0, y: 0, z: 0 };
            state.targetQuaternion.setFromEuler(new THREE.Euler(0, 0, 0));
            state.homeScale = config.scale;
            state.focusedScale = config.focusedScale;
            state.idleSpinX = config.spinX;
            state.idleSpinY = config.spinY;
            state.idleSpinZ = config.spinZ;

            if (!activeEntry || activeEntry !== entry) {
                state.spinX = config.spinX;
                state.spinY = config.spinY;
                state.spinZ = config.spinZ;
            }

            mesh.position.set(config.x, config.y, config.z);
            mesh.scale.setScalar(config.scale);
        }

        function applyFaceFocus(entry, materialIndex) {
            activeFaceSequence = buildFaceSequence(materialIndex);
            activeFaceIndex = 0;
            entry.state.frontRotation = getFrontRotationForMaterial(activeFaceSequence[activeFaceIndex]);
            entry.state.targetQuaternion.setFromEuler(
                new THREE.Euler(
                    entry.state.frontRotation.x,
                    entry.state.frontRotation.y,
                    entry.state.frontRotation.z
                )
            );
        }

        function focusCube(entry, materialIndex = 4) {
            activeEntry = entry;

            cubeEntries.forEach((cubeEntry) => {
                cubeEntry.state.focusTarget = cubeEntry === entry ? 1 : 0;
                cubeEntry.state.spinX = cubeEntry === entry ? 0 : cubeEntry.state.idleSpinX;
                cubeEntry.state.spinY = cubeEntry === entry ? 0 : cubeEntry.state.idleSpinY;
                cubeEntry.state.spinZ = cubeEntry === entry ? 0 : cubeEntry.state.idleSpinZ;
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
            });
            setFocusControlsVisible(false);
        }

        function cycleFocusedCube(direction) {
            if (!activeEntry) {
                return;
            }

            activeFaceIndex = (activeFaceIndex + direction + activeFaceSequence.length) % activeFaceSequence.length;
            activeEntry.state.frontRotation = getFrontRotationForMaterial(activeFaceSequence[activeFaceIndex]);
            activeEntry.state.targetQuaternion.setFromEuler(
                new THREE.Euler(
                    activeEntry.state.frontRotation.x,
                    activeEntry.state.frontRotation.y,
                    activeEntry.state.frontRotation.z
                )
            );
        }

        function updateCube(entry, delta, elapsed, driftOffset) {
            const { mesh, state } = entry;
            state.focusProgress = lerp(state.focusProgress, state.focusTarget, delta * 1.7);
            const focusMix = easeInOutCubic(Math.min(Math.max(state.focusProgress, 0), 1));

            const baseY = state.targetY + Math.sin(elapsed * 0.45 + driftOffset) * 0.08;
            const baseX = state.targetX + Math.sin(elapsed * 0.28 + driftOffset) * 0.06;
            const baseZ = state.targetZ + Math.cos(elapsed * 0.35 + driftOffset) * 0.08;

            mesh.position.x = lerp(baseX, state.focused.x, focusMix);
            mesh.position.y = lerp(baseY, state.focused.y, focusMix);
            mesh.position.z = lerp(baseZ, state.focused.z, focusMix);
            mesh.scale.setScalar(lerp(state.homeScale, state.focusedScale, focusMix));
            mesh.rotation.x += state.spinX * delta;
            mesh.rotation.y += state.spinY * delta;
            mesh.rotation.z += state.spinZ * delta;

            if (state.focusTarget > 0.5) {
                mesh.quaternion.slerp(state.targetQuaternion, Math.min(delta * 4.2, 1));
            }
        }

        function handlePointerDown(event) {
            const rect = canvas.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(pointer, camera);
            const selectableMeshes = cubeEntries.map((entry) => entry.mesh);
            const intersects = raycaster.intersectObjects(selectableMeshes, true);
            const meshHit = intersects.find((entry) => selectableMeshes.includes(entry.object));

            if (meshHit) {
                const targetEntry = cubeEntries.find((entry) => entry.mesh === meshHit.object);
                if (targetEntry) {
                    focusCube(targetEntry, meshHit.face?.materialIndex ?? 4);
                    return;
                }
            }

            if (raycaster.ray.intersectPlane(selectionPlane, clickPoint)) {
                const selectionThreshold = window.innerWidth < 768 ? 2.6 : 2.9;
                const nearestEntry = cubeEntries
                    .map((entry) => ({
                        entry,
                        distance: entry.mesh.position.distanceTo(clickPoint),
                    }))
                    .sort((a, b) => a.distance - b.distance)[0];

                if (nearestEntry && nearestEntry.distance < selectionThreshold) {
                    focusCube(nearestEntry.entry, 4);
                    return;
                }
            }

            if (activeEntry) {
                resetFocus();
            }
        }

        function resize() {
            const width = window.innerWidth;
            const height = window.innerHeight;

            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();

            const configs = width < 768 ? baseConfigsMobile : baseConfigsDesktop;

            if (cubeEntries.length === 1) {
                const singleConfig = width < 768
                    ? { ...configs[0], x: 0, y: 0.2, z: 0, scale: 1.08, focusedScale: 1.08 }
                    : { ...configs[0], x: 0.7, y: 0.05, z: 0, scale: 1.28, focusedScale: 1.28 };
                placeCube(cubeEntries[0], singleConfig);
                return;
            }

            if (cubeEntries.length === 2) {
                placeCube(cubeEntries[0], configs[0]);
                placeCube(cubeEntries[1], configs[1]);
                return;
            }

            cubeEntries.forEach((entry, index) => {
                placeCube(entry, configs[index]);
            });
        }

        function animate() {
            const delta = Math.min(clock.getDelta(), 0.033);
            const elapsed = clock.elapsedTime;
            cubeEntries.forEach((entry, index) => {
                updateCube(entry, delta, elapsed, 0.2 + index * 0.9);
            });
            renderer.render(scene, camera);
            window.requestAnimationFrame(animate);
        }

        resize();
        canvas.addEventListener("pointerdown", handlePointerDown);
        focusPrevButton?.addEventListener("click", (event) => {
            event.stopPropagation();
            cycleFocusedCube(1);
        });
        focusNextButton?.addEventListener("click", (event) => {
            event.stopPropagation();
            cycleFocusedCube(-1);
        });
        window.addEventListener("resize", resize);
        animate();
    }
}
