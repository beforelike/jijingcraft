class MinecraftScene {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.blocks = [];
        this.init();
    }

    init() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x1a1a2e, 10, 50);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 30;
        this.camera.position.y = 5;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Lights
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        this.scene.add(directionalLight);

        // Create floating blocks
        this.createFloatingBlocks();

        // Animation loop
        this.animate();

        // Resize handler
        window.addEventListener('resize', () => this.onResize());

        // Mouse interaction
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    }

    createFloatingBlocks() {
        const colors = [0x5D8C4B, 0x8B7355, 0x808080, 0x654321, 0x87CEEB];
        const geometry = new THREE.BoxGeometry(1, 1, 1);

        for (let i = 0; i < 30; i++) {
            const material = new THREE.MeshLambertMaterial({
                color: colors[Math.floor(Math.random() * colors.length)]
            });
            const block = new THREE.Mesh(geometry, material);

            block.position.x = (Math.random() - 0.5) * 40;
            block.position.y = (Math.random() - 0.5) * 30;
            block.position.z = (Math.random() - 0.5) * 20 - 10;

            block.rotation.x = Math.random() * Math.PI;
            block.rotation.y = Math.random() * Math.PI;

            block.userData = {
                rotationSpeed: {
                    x: (Math.random() - 0.5) * 0.02,
                    y: (Math.random() - 0.5) * 0.02
                },
                floatSpeed: 0.005 + Math.random() * 0.01,
                floatOffset: Math.random() * Math.PI * 2
            };

            this.scene.add(block);
            this.blocks.push(block);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = Date.now() * 0.001;

        this.blocks.forEach(block => {
            block.rotation.x += block.userData.rotationSpeed.x;
            block.rotation.y += block.userData.rotationSpeed.y;
            block.position.y += Math.sin(time + block.userData.floatOffset) * block.userData.floatSpeed * 0.1;
        });

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onMouseMove(event) {
        const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;

        this.camera.position.x = mouseX * 2;
        this.camera.position.y = 5 + mouseY * 2;
        this.camera.lookAt(0, 0, 0);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new MinecraftScene();
});
