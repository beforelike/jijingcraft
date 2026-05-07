/**
 * Minecraft Scene with BOT Character
 * Creates an immersive 3D background with floating blocks and character
 */

class MinecraftScene {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.blocks = [];
        this.particles = [];
        this.botGroup = null;
        this.clock = new THREE.Clock();
        this.mouse = new THREE.Vector2();
        this.targetRotation = new THREE.Vector2();

        this.init();
    }

    init() {
        this.setupScene();
        this.setupLights();
        this.createEnvironment();
        this.createBotCharacter();
        this.createParticles();
        this.setupEvents();
        this.animate();
    }

    setupScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0a12, 0.02);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 5, 25);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x0a0a12, 0);
        this.container.appendChild(this.renderer.domElement);
    }

    setupLights() {
        // Ambient light (moonlight feel)
        const ambientLight = new THREE.AmbientLight(0x404060, 0.3);
        this.scene.add(ambientLight);

        // Main directional light (moon)
        const moonLight = new THREE.DirectionalLight(0xaaccff, 0.5);
        moonLight.position.set(10, 20, 10);
        this.scene.add(moonLight);

        // Redstone glow light
        const redstoneLight = new THREE.PointLight(0xff4444, 2, 30);
        redstoneLight.position.set(0, 5, 5);
        this.scene.add(redstoneLight);

        // Backlight for depth
        const backLight = new THREE.DirectionalLight(0xffaa00, 0.3);
        backLight.position.set(-10, 5, -10);
        this.scene.add(backLight);
    }

    createEnvironment() {
        const colors = [
            0x5D8C4B, // Grass
            0x8B7355, // Wood
            0x808080, // Stone
            0x654321, // Dirt
            0xff4444, // Redstone
            0x00ffff, // Diamond
            0xffaa00  // Gold
        ];

        // Create floating blocks
        const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

        // Add edges to blocks for Minecraft look
        const edgesGeometry = new THREE.EdgesGeometry(blockGeometry);

        for (let i = 0; i < 40; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];

            // Material with slight emission for glow effect
            const material = new THREE.MeshLambertMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.1
            });

            const block = new THREE.Mesh(blockGeometry, material);

            // Random position
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const radius = 15 + Math.random() * 20;

            block.position.x = radius * Math.sin(phi) * Math.cos(theta);
            block.position.y = (Math.random() - 0.5) * 20;
            block.position.z = radius * Math.sin(phi) * Math.sin(theta) - 10;

            // Random rotation
            block.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );

            // Store animation data
            block.userData = {
                rotationSpeed: {
                    x: (Math.random() - 0.5) * 0.01,
                    y: (Math.random() - 0.5) * 0.01,
                    z: (Math.random() - 0.5) * 0.01
                },
                floatSpeed: 0.3 + Math.random() * 0.5,
                floatOffset: Math.random() * Math.PI * 2,
                originalY: block.position.y
            };

            this.scene.add(block);
            this.blocks.push(block);

            // Add outline
            const edges = new THREE.LineSegments(
                edgesGeometry,
                new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.3, transparent: true })
            );
            block.add(edges);
        }
    }

    createBotCharacter() {
        this.botGroup = new THREE.Group();

        const pixelMaterial = new THREE.MeshLambertMaterial({
            vertexColors: false
        });

        // Bot colors
        const headColor = 0x00ff88; // Experience green
        const bodyColor = 0x2d2d3d; // Command block gray
        const accentColor = 0xff4444; // Redstone

        // Head (2x2x2 pixels scaled)
        const headGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        const headMat = new THREE.MeshLambertMaterial({
            color: headColor,
            emissive: headColor,
            emissiveIntensity: 0.2
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 3;
        this.botGroup.add(head);

        // Eyes (glowing)
        const eyeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.1);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.4, 3.1, 0.76);
        this.botGroup.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.4, 3.1, 0.76);
        this.botGroup.add(rightEye);

        // Body
        const bodyGeo = new THREE.BoxGeometry(2, 2.5, 1.2);
        const bodyMat = new THREE.MeshLambertMaterial({
            color: bodyColor,
            emissive: accentColor,
            emissiveIntensity: 0.1
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1;
        this.botGroup.add(body);

        // Chest detail (redstone core)
        const coreGeo = new THREE.BoxGeometry(0.8, 0.8, 0.2);
        const coreMat = new THREE.MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: 0.8
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.set(0, 1.2, 0.61);
        this.botGroup.add(core);

        // Arms
        const armGeo = new THREE.BoxGeometry(0.6, 2, 0.6);
        const armMat = new THREE.MeshLambertMaterial({ color: bodyColor });

        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-1.4, 1, 0);
        this.botGroup.add(leftArm);

        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(1.4, 1, 0);
        this.botGroup.add(rightArm);

        // Legs
        const legGeo = new THREE.BoxGeometry(0.7, 2, 0.7);
        const legMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });

        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.5, -1.5, 0);
        this.botGroup.add(leftLeg);

        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.5, -1.5, 0);
        this.botGroup.add(rightLeg);

        // Position entire bot
        this.botGroup.position.set(0, -2, 0);
        this.scene.add(this.botGroup);

        // Store references for animation
        this.botGroup.userData = {
            leftArm: leftArm,
            rightArm: rightArm,
            leftLeg: leftLeg,
            rightLeg: rightLeg,
            head: head,
            core: core
        };

        // Add glow light around bot
        const botLight = new THREE.PointLight(accentColor, 1, 10);
        botLight.position.set(0, 1, 2);
        this.botGroup.add(botLight);
    }

    createParticles() {
        const particleCount = 50;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        const colorPalette = [
            new THREE.Color(0xff4444), // Redstone
            new THREE.Color(0x00ff88), // Experience
            new THREE.Color(0xffaa00), // Gold
            new THREE.Color(0x00ffff)  // Diamond
        ];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 40;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 20 - 10;

            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.particleSystem = new THREE.Points(geometry, material);
        this.scene.add(this.particleSystem);

        // Store original positions
        this.particleSystem.userData = {
            originalPositions: positions.slice()
        };
    }

    setupEvents() {
        window.addEventListener('resize', () => this.onResize());
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.targetRotation.x = this.mouse.y * 0.3;
        this.targetRotation.y = this.mouse.x * 0.3;
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();
        const delta = this.clock.getDelta();

        // Animate blocks
        this.blocks.forEach((block, index) => {
            // Rotation
            block.rotation.x += block.userData.rotationSpeed.x;
            block.rotation.y += block.userData.rotationSpeed.y;
            block.rotation.z += block.userData.rotationSpeed.z;

            // Floating
            block.position.y = block.userData.originalY +
                Math.sin(time * block.userData.floatSpeed + block.userData.floatOffset) * 0.5;
        });

        // Animate bot
        if (this.botGroup) {
            // Idle animation
            this.botGroup.userData.leftArm.rotation.z = Math.sin(time * 2) * 0.1 + 0.2;
            this.botGroup.userData.rightArm.rotation.z = -Math.sin(time * 2) * 0.1 - 0.2;

            // Breathing
            this.botGroup.scale.y = 1 + Math.sin(time * 3) * 0.02;

            // Mouse follow (smooth)
            this.botGroup.rotation.y += (this.targetRotation.y - this.botGroup.rotation.y) * 0.05;
            this.botGroup.rotation.x += (this.targetRotation.x - this.botGroup.rotation.x) * 0.05;

            // Core pulse
            if (this.botGroup.userData.core) {
                this.botGroup.userData.core.material.opacity = 0.6 + Math.sin(time * 4) * 0.2;
            }
        }

        // Animate particles
        if (this.particleSystem) {
            const positions = this.particleSystem.geometry.attributes.position.array;
            const originalPositions = this.particleSystem.userData.originalPositions;

            for (let i = 0; i < positions.length / 3; i++) {
                positions[i * 3 + 1] = originalPositions[i * 3 + 1] +
                    Math.sin(time * 0.5 + i * 0.1) * 2;
            }
            this.particleSystem.geometry.attributes.position.needsUpdate = true;
            this.particleSystem.rotation.y = time * 0.05;
        }

        // Camera subtle movement
        this.camera.position.x += (this.mouse.x * 2 - this.camera.position.x) * 0.02;
        this.camera.position.y += (5 + this.mouse.y * 2 - this.camera.position.y) * 0.02;
        this.camera.lookAt(0, 0, 0);

        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MinecraftScene();
});
