# MC Survival Bot 介绍网页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建并部署一个沉浸式的 Minecraft 风格介绍网页到服务器 47.95.195.227，绑定域名 beforelike.com

**Architecture:** 静态网页使用 Three.js 实现 3D 像素世界背景，纯 CSS 实现像素风格 UI，双语支持通过 JavaScript 切换。使用 Nginx 作为 Web 服务器。

**Tech Stack:** HTML5, CSS3, Three.js, JavaScript, Nginx, SSH/SCP

---

## 文件结构

```
website/
├── index.html              # 主页面
├── css/
│   ├── style.css           # 主样式
│   ├── animations.css      # 动画定义
│   └── pixel-art.css       # 像素风格组件
├── js/
│   ├── main.js             # 主逻辑
│   ├── three-scene.js      # Three.js 场景
│   ├── translations.js     # 双语数据
│   └── animations.js       # 交互动画
├── assets/
│   └── (pixel icons as CSS or SVG)
└── nginx.conf              # Nginx 配置模板
```

---

## Task 1: 创建项目目录结构

**Files:**
- Create: `website/index.html`
- Create: `website/css/style.css`
- Create: `website/js/main.js`

**Steps:**

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p website/css website/js website/assets
```

- [ ] **Step 2: 创建基础 HTML 文件**

`website/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MC Survival Bot - Minecraft AI 生存机器人</title>
    <link rel="stylesheet" href="css/style.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
</head>
<body>
    <div id="canvas-container"></div>
    <div id="app">
        <!-- Content will be added in next tasks -->
    </div>
    <script src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: 提交**

```bash
git add website/
git commit -m "feat(website): create project structure"
```

---

## Task 2: 实现 Three.js 3D 背景场景

**Files:**
- Create: `website/js/three-scene.js`
- Modify: `website/index.html` (add script tag)

**Steps:**

- [ ] **Step 1: 创建 Three.js 场景文件**

`website/js/three-scene.js`:
```javascript
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
        this.renderer.setPixelRatio(window.devicePixelRatio);
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
```

- [ ] **Step 2: 更新 index.html 添加脚本引用**

在 `</body>` 前添加：
```html
<script src="js/three-scene.js"></script>
```

- [ ] **Step 3: 提交**

```bash
git add website/js/three-scene.js website/index.html
git commit -m "feat(website): add Three.js 3D floating blocks background"
```

---

## Task 3: 创建双语翻译系统

**Files:**
- Create: `website/js/translations.js`

**Steps:**

- [ ] **Step 1: 创建翻译数据文件**

`website/js/translations.js`:
```javascript
const translations = {
    zh: {
        title: 'MC Survival Bot',
        subtitle: '用 AI 在 Minecraft 中自主生存',
        exploreFeatures: '探索功能',
        viewDemo: '查看 Demo',
        github: 'GitHub',
        features: {
            title: '核心功能',
            smartBrain: {
                title: '🤖 Smart Brain',
                desc: 'AI 智能大脑，理解环境并做出决策'
            },
            safety: {
                title: '🛡️ 安全优先',
                desc: '本地安全规则层，保障 BOT 生存安全'
            },
            behaviorTree: {
                title: '🌳 行为树',
                desc: '可执行任务流，精确控制每一个动作'
            },
            dashboard: {
                title: '📊 Dashboard',
                desc: '实时监控面板，掌握 BOT 状态'
            },
            memory: {
                title: '🧠 记忆系统',
                desc: '环境学习与适应，持续优化策略'
            },
            research: {
                title: '🔬 研究任务',
                desc: '可评测任务目录，量化 BOT 能力'
            }
        },
        architecture: {
            title: '系统架构',
            subtitle: '从感知到执行的完整链路'
        },
        quickStart: {
            title: '快速开始',
            step1: '克隆仓库',
            step2: '安装依赖',
            step3: '配置环境',
            step4: '启动 BOT'
        },
        footer: {
            copyright: 'MC Survival Bot - 开源项目',
            license: 'MIT License'
        }
    },
    en: {
        title: 'MC Survival Bot',
        subtitle: 'AI-powered autonomous survival in Minecraft',
        exploreFeatures: 'Explore Features',
        viewDemo: 'View Demo',
        github: 'GitHub',
        features: {
            title: 'Core Features',
            smartBrain: {
                title: '🤖 Smart Brain',
                desc: 'AI brain that understands environment and makes decisions'
            },
            safety: {
                title: '🛡️ Safety First',
                desc: 'Local safety rule layer ensures BOT survival'
            },
            behaviorTree: {
                title: '🌳 Behavior Trees',
                desc: 'Executable task flows with precise action control'
            },
            dashboard: {
                title: '📊 Dashboard',
                desc: 'Real-time monitoring panel for BOT status'
            },
            memory: {
                title: '🧠 Memory System',
                desc: 'Environment learning and adaptation for strategy optimization'
            },
            research: {
                title: '🔬 Research Missions',
                desc: 'Evaluable task catalog to quantify BOT capabilities'
            }
        },
        architecture: {
            title: 'System Architecture',
            subtitle: 'Complete pipeline from perception to execution'
        },
        quickStart: {
            title: 'Quick Start',
            step1: 'Clone repository',
            step2: 'Install dependencies',
            step3: 'Configure environment',
            step4: 'Launch BOT'
        },
        footer: {
            copyright: 'MC Survival Bot - Open Source Project',
            license: 'MIT License'
        }
    }
};

let currentLang = 'zh';

function setLanguage(lang) {
    currentLang = lang;
    updatePageContent();
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

function t(key) {
    const keys = key.split('.');
    let value = translations[currentLang];
    for (const k of keys) {
        value = value?.[k];
    }
    return value || key;
}

function updatePageContent() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updatePageContent();
});
```

- [ ] **Step 2: 提交**

```bash
git add website/js/translations.js
git commit -m "feat(website): add bilingual translation system"
```

---

## Task 4: 创建主样式文件

**Files:**
- Create: `website/css/style.css`

**Steps:**

- [ ] **Step 1: 创建主 CSS 文件**

`website/css/style.css`:
```css
/* CSS Variables */
:root {
    --bg-primary: #1a1a2e;
    --bg-secondary: #16213e;
    --mc-green: #5D8C4B;
    --mc-brown: #8B7355;
    --mc-stone: #808080;
    --mc-dirt: #654321;
    --mc-sky: #87CEEB;
    --accent: #00ff88;
    --text-primary: #ffffff;
    --text-secondary: #b4b4b4;
    --pixel-border: 4px;
}

/* Reset */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    overflow-x: hidden;
}

/* Canvas Container */
#canvas-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
}

/* Main App Container */
#app {
    position: relative;
    z-index: 1;
}

/* Language Switcher */
.lang-switcher {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    display: flex;
    gap: 10px;
}

.lang-btn {
    background: rgba(93, 140, 75, 0.3);
    border: 2px solid var(--mc-green);
    color: var(--text-primary);
    padding: 8px 16px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s;
    backdrop-filter: blur(10px);
}

.lang-btn:hover,
.lang-btn.active {
    background: var(--mc-green);
    transform: scale(1.05);
}

/* Hero Section */
.hero {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 2rem;
    position: relative;
}

.hero-content {
    background: rgba(22, 33, 62, 0.8);
    backdrop-filter: blur(20px);
    border: 4px solid var(--mc-green);
    padding: 4rem 3rem;
    border-radius: 8px;
    box-shadow: 
        0 0 60px rgba(93, 140, 75, 0.3),
        inset 0 0 60px rgba(93, 140, 75, 0.1);
    max-width: 800px;
    position: relative;
}

.hero-content::before {
    content: '';
    position: absolute;
    top: -4px;
    left: -4px;
    right: -4px;
    bottom: -4px;
    background: linear-gradient(45deg, var(--mc-green), transparent, var(--accent));
    border-radius: 12px;
    z-index: -1;
    opacity: 0.5;
    animation: borderGlow 3s ease-in-out infinite;
}

@keyframes borderGlow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
}

.hero h1 {
    font-size: 4rem;
    margin-bottom: 1rem;
    text-shadow: 4px 4px 0 var(--mc-green);
    letter-spacing: 2px;
}

.hero .subtitle {
    font-size: 1.5rem;
    color: var(--text-secondary);
    margin-bottom: 2rem;
}

/* Buttons */
.hero-buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
}

.btn {
    display: inline-block;
    padding: 1rem 2rem;
    text-decoration: none;
    font-weight: bold;
    font-size: 1.1rem;
    transition: all 0.3s;
    border: 4px solid;
    position: relative;
    overflow: hidden;
}

.btn-primary {
    background: var(--mc-green);
    border-color: var(--mc-green);
    color: var(--text-primary);
}

.btn-primary:hover {
    background: transparent;
    box-shadow: 0 0 30px var(--mc-green);
    transform: translateY(-3px);
}

.btn-secondary {
    background: transparent;
    border-color: var(--text-primary);
    color: var(--text-primary);
}

.btn-secondary:hover {
    background: var(--text-primary);
    color: var(--bg-primary);
    transform: translateY(-3px);
}

/* Sections */
.section {
    padding: 6rem 2rem;
    max-width: 1200px;
    margin: 0 auto;
}

.section-title {
    font-size: 3rem;
    text-align: center;
    margin-bottom: 1rem;
    text-shadow: 3px 3px 0 var(--mc-brown);
}

.section-subtitle {
    text-align: center;
    color: var(--text-secondary);
    font-size: 1.2rem;
    margin-bottom: 3rem;
}

/* Features Grid */
.features-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 2rem;
}

.feature-card {
    background: rgba(22, 33, 62, 0.9);
    border: 4px solid var(--mc-brown);
    padding: 2rem;
    border-radius: 4px;
    transition: all 0.3s;
    position: relative;
    overflow: hidden;
}

.feature-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(93, 140, 75, 0.2), transparent);
    transition: left 0.5s;
}

.feature-card:hover::before {
    left: 100%;
}

.feature-card:hover {
    transform: translateY(-10px) scale(1.02);
    border-color: var(--mc-green);
    box-shadow: 0 20px 40px rgba(93, 140, 75, 0.3);
}

.feature-card h3 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: var(--accent);
}

.feature-card p {
    color: var(--text-secondary);
    line-height: 1.8;
}

/* Architecture Section */
.architecture-section {
    background: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
}

.architecture-flow {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    padding: 3rem 0;
}

.arch-node {
    background: rgba(93, 140, 75, 0.2);
    border: 3px solid var(--mc-green);
    padding: 1.5rem 2rem;
    border-radius: 8px;
    text-align: center;
    min-width: 150px;
    transition: all 0.3s;
}

.arch-node:hover {
    background: rgba(93, 140, 75, 0.4);
    transform: scale(1.1);
    box-shadow: 0 0 30px var(--mc-green);
}

.arch-arrow {
    font-size: 2rem;
    color: var(--mc-green);
    animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 0.5; transform: translateX(0); }
    50% { opacity: 1; transform: translateX(5px); }
}

/* Quick Start Section */
.quickstart-section {
    background: var(--bg-secondary);
}

.steps-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 2rem;
}

.step {
    background: rgba(101, 67, 33, 0.3);
    border: 3px solid var(--mc-dirt);
    padding: 2rem;
    border-radius: 8px;
    position: relative;
    counter-increment: step-counter;
}

.step::before {
    content: counter(step-counter);
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 40px;
    background: var(--mc-green);
    border: 3px solid var(--text-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.2rem;
}

.step h3 {
    margin-top: 1rem;
    margin-bottom: 1rem;
    color: var(--accent);
}

.code-block {
    background: #0d1117;
    border: 2px solid var(--mc-stone);
    border-radius: 6px;
    padding: 1rem;
    font-family: 'Consolas', monospace;
    font-size: 0.9rem;
    color: var(--text-primary);
    overflow-x: auto;
    position: relative;
}

.code-block .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: var(--mc-green);
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 4px;
}

/* Footer */
.footer {
    background: var(--bg-primary);
    border-top: 4px solid var(--mc-brown);
    padding: 3rem 2rem;
    text-align: center;
}

.footer-content {
    max-width: 800px;
    margin: 0 auto;
}

.footer-links {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-bottom: 1.5rem;
}

.footer-links a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.3s;
}

.footer-links a:hover {
    color: var(--accent);
}

/* Responsive */
@media (max-width: 768px) {
    .hero h1 {
        font-size: 2.5rem;
    }
    
    .hero .subtitle {
        font-size: 1.2rem;
    }
    
    .section-title {
        font-size: 2rem;
    }
    
    .features-grid {
        grid-template-columns: 1fr;
    }
    
    .hero-content {
        padding: 2rem 1.5rem;
    }
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 12px;
}

::-webkit-scrollbar-track {
    background: var(--bg-primary);
}

::-webkit-scrollbar-thumb {
    background: var(--mc-green);
    border-radius: 6px;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
}
```

- [ ] **Step 2: 提交**

```bash
git add website/css/style.css
git commit -m "feat(website): add main stylesheet with Minecraft theme"
```

---

## Task 5: 填充完整 HTML 内容

**Files:**
- Modify: `website/index.html`

**Steps:**

- [ ] **Step 1: 更新 index.html 完整内容**

`website/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="MC Survival Bot - Minecraft AI 生存机器人，基于 Mineflayer 的自主生存 BOT">
    <title>MC Survival Bot - Minecraft AI 生存机器人</title>
    <link rel="stylesheet" href="css/style.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
</head>
<body>
    <!-- 3D Background Canvas -->
    <div id="canvas-container"></div>
    
    <!-- Language Switcher -->
    <div class="lang-switcher">
        <button class="lang-btn active" onclick="setLanguage('zh')">中文</button>
        <button class="lang-btn" onclick="setLanguage('en')">English</button>
    </div>
    
    <!-- Main App -->
    <div id="app">
        <!-- Hero Section -->
        <section class="hero">
            <div class="hero-content">
                <h1 data-i18n="title">MC Survival Bot</h1>
                <p class="subtitle" data-i18n="subtitle">用 AI 在 Minecraft 中自主生存</p>
                <div class="hero-buttons">
                    <a href="#features" class="btn btn-primary" data-i18n="exploreFeatures">探索功能</a>
                    <a href="#dashboard" class="btn btn-secondary" data-i18n="viewDemo">查看 Demo</a>
                    <a href="https://github.com/yourusername/mc-survival-bot" class="btn btn-secondary" data-i18n="github">GitHub</a>
                </div>
            </div>
        </section>
        
        <!-- Features Section -->
        <section id="features" class="section">
            <h2 class="section-title" data-i18n="features.title">核心功能</h2>
            <div class="features-grid">
                <div class="feature-card">
                    <h3 data-i18n="features.smartBrain.title">🤖 Smart Brain</h3>
                    <p data-i18n="features.smartBrain.desc">AI 智能大脑，理解环境并做出决策</p>
                </div>
                <div class="feature-card">
                    <h3 data-i18n="features.safety.title">🛡️ 安全优先</h3>
                    <p data-i18n="features.safety.desc">本地安全规则层，保障 BOT 生存安全</p>
                </div>
                <div class="feature-card">
                    <h3 data-i18n="features.behaviorTree.title">🌳 行为树</h3>
                    <p data-i18n="features.behaviorTree.desc">可执行任务流，精确控制每一个动作</p>
                </div>
                <div class="feature-card">
                    <h3 data-i18n="features.dashboard.title">📊 Dashboard</h3>
                    <p data-i18n="features.dashboard.desc">实时监控面板，掌握 BOT 状态</p>
                </div>
                <div class="feature-card">
                    <h3 data-i18n="features.memory.title">🧠 记忆系统</h3>
                    <p data-i18n="features.memory.desc">环境学习与适应，持续优化策略</p>
                </div>
                <div class="feature-card">
                    <h3 data-i18n="features.research.title">🔬 研究任务</h3>
                    <p data-i18n="features.research.desc">可评测任务目录，量化 BOT 能力</p>
                </div>
            </div>
        </section>
        
        <!-- Architecture Section -->
        <section id="architecture" class="section architecture-section">
            <h2 class="section-title" data-i18n="architecture.title">系统架构</h2>
            <p class="section-subtitle" data-i18n="architecture.subtitle">从感知到执行的完整链路</p>
            <div class="architecture-flow">
                <div class="arch-node">Minecraft Server</div>
                <div class="arch-arrow">→</div>
                <div class="arch-node">Mineflayer Bot</div>
                <div class="arch-arrow">→</div>
                <div class="arch-node">SurvivalController</div>
                <div class="arch-arrow">→</div>
                <div class="arch-node">Smart Brain</div>
                <div class="arch-arrow">→</div>
                <div class="arch-node">Dashboard</div>
            </div>
        </section>
        
        <!-- Quick Start Section -->
        <section id="quickstart" class="section quickstart-section">
            <h2 class="section-title" data-i18n="quickStart.title">快速开始</h2>
            <div class="steps-container">
                <div class="step">
                    <h3 data-i18n="quickStart.step1">克隆仓库</h3>
                    <div class="code-block">
                        <button class="copy-btn" onclick="copyCode(this)">复制</button>
                        <code>git clone https://github.com/yourusername/mc-survival-bot.git</code>
                    </div>
                </div>
                <div class="step">
                    <h3 data-i18n="quickStart.step2">安装依赖</h3>
                    <div class="code-block">
                        <button class="copy-btn" onclick="copyCode(this)">复制</button>
                        <code>npm install</code>
                    </div>
                </div>
                <div class="step">
                    <h3 data-i18n="quickStart.step3">配置环境</h3>
                    <div class="code-block">
                        <button class="copy-btn" onclick="copyCode(this)">复制</button>
                        <code>cp .env.example .env<br># 编辑 .env 设置 MC_HOST</code>
                    </div>
                </div>
                <div class="step">
                    <h3 data-i18n="quickStart.step4">启动 BOT</h3>
                    <div class="code-block">
                        <button class="copy-btn" onclick="copyCode(this)">复制</button>
                        <code>npm start</code>
                    </div>
                </div>
            </div>
        </section>
        
        <!-- Footer -->
        <footer class="footer">
            <div class="footer-content">
                <div class="footer-links">
                    <a href="https://github.com/yourusername/mc-survival-bot">GitHub</a>
                    <a href="#features">功能</a>
                    <a href="#quickstart">快速开始</a>
                </div>
                <p data-i18n="footer.copyright">MC Survival Bot - 开源项目</p>
                <p data-i18n="footer.license">MIT License</p>
            </div>
        </footer>
    </div>
    
    <!-- Scripts -->
    <script src="js/translations.js"></script>
    <script src="js/three-scene.js"></script>
    <script src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: 提交**

```bash
git add website/index.html
git commit -m "feat(website): complete HTML content with all sections"
```

---

## Task 6: 创建主 JavaScript 逻辑

**Files:**
- Create: `website/js/main.js`

**Steps:**

- [ ] **Step 1: 创建主 JS 文件**

`website/js/main.js`:
```javascript
// Copy code functionality
function copyCode(button) {
    const codeBlock = button.nextElementSibling;
    const code = codeBlock.innerText;
    
    navigator.clipboard.writeText(code).then(() => {
        const originalText = button.textContent;
        button.textContent = '已复制!';
        button.style.background = '#00ff88';
        
        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '';
        }, 2000);
    });
}

// Smooth scroll for navigation
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Intersection Observer for animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements for animation
document.addEventListener('DOMContentLoaded', () => {
    const animatedElements = document.querySelectorAll('.feature-card, .step, .arch-node');
    
    animatedElements.forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(el);
    });
});

// Parallax effect for hero section
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const hero = document.querySelector('.hero');
    if (hero) {
        hero.style.transform = `translateY(${scrolled * 0.5}px)`;
    }
});

// Language switcher update
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    });
});

// Console easter egg
console.log(`
╔══════════════════════════════════════╗
║     MC Survival Bot                  ║
║     AI-powered Minecraft Survival    ║
╚══════════════════════════════════════╝
`);
```

- [ ] **Step 2: 提交**

```bash
git add website/js/main.js
git commit -m "feat(website): add main JavaScript with copy, scroll, and animations"
```

---

## Task 7: 创建 Nginx 配置文件

**Files:**
- Create: `website/nginx.conf`

**Steps:**

- [ ] **Step 1: 创建 Nginx 配置**

`website/nginx.conf`:
```nginx
server {
    listen 80;
    server_name beforelike.com;
    root /var/www/beforelike.com;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Main location
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # Redirect HTTP to HTTPS (when SSL is configured)
    # listen 443 ssl http2;
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;
}
```

- [ ] **Step 2: 创建部署脚本**

`deploy.sh`:
```bash
#!/bin/bash
set -e

echo "🚀 Deploying MC Survival Bot website..."

# Server details
SERVER="47.95.195.227"
DOMAIN="beforelike.com"
REMOTE_DIR="/var/www/${DOMAIN}"

# Build and deploy
echo "📦 Preparing files..."
rsync -avz --delete website/ root@${SERVER}:${REMOTE_DIR}/

echo "🔧 Setting permissions..."
ssh root@${SERVER} "chown -R www-data:www-data ${REMOTE_DIR} && chmod -R 755 ${REMOTE_DIR}"

echo "🔄 Reloading Nginx..."
ssh root@${SERVER} "nginx -t && systemctl reload nginx"

echo "✅ Deployment complete!"
echo "🌐 Website should be live at: http://${DOMAIN}"
```

- [ ] **Step 3: 提交**

```bash
git add website/nginx.conf deploy.sh
git commit -m "feat(website): add nginx config and deployment script"
```

---

## Task 8: 部署到服务器

**Files:**
- Deploy: `website/` to server

**Steps:**

- [ ] **Step 1: 确保服务器 SSH 连接可用**

```bash
ssh -o ConnectTimeout=10 root@47.95.195.227 "echo 'Server reachable'"
```

Expected: "Server reachable"

- [ ] **Step 2: 在服务器上创建目录并设置 Nginx**

```bash
ssh root@47.95.195.227 << 'EOF'
# Create web directory
mkdir -p /var/www/beforelike.com

# Ensure nginx is installed
if ! command -v nginx &> /dev/null; then
    apt-get update
    apt-get install -y nginx
fi

# Create nginx site config
cat > /etc/nginx/sites-available/beforelike.com << 'NGINX'
server {
    listen 80;
    server_name beforelike.com;
    root /var/www/beforelike.com;
    index index.html;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/beforelike.com /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload
nginx -t
systemctl reload nginx
EOF
```

- [ ] **Step 3: 上传网站文件**

```bash
rsync -avz --delete website/ root@47.95.195.227:/var/www/beforelike.com/
```

- [ ] **Step 4: 设置权限**

```bash
ssh root@47.95.195.227 "chown -R www-data:www-data /var/www/beforelike.com && chmod -R 755 /var/www/beforelike.com"
```

- [ ] **Step 5: 验证部署**

```bash
curl -I http://47.95.195.227
```

Expected: HTTP 200 OK

- [ ] **Step 6: 提交部署记录**

```bash
git add -A
git commit -m "feat(website): deploy to server 47.95.195.227"
```

---

## 验证清单

部署完成后，验证以下内容：

- [ ] 访问 http://47.95.195.227 显示网页
- [ ] 访问 http://beforelike.com 显示网页（DNS 配置完成后）
- [ ] Three.js 背景动画正常运行
- [ ] 语言切换功能正常工作（中文/英文）
- [ ] 所有按钮和链接可点击
- [ ] 代码复制功能正常工作
- [ ] 响应式布局在移动端正常显示
- [ ] 页面加载时间在可接受范围（< 3秒）

---

## DNS 配置说明

需要在 beforelike.com 的 DNS 管理中添加 A 记录：

```
Type: A
Name: @ (或 www)
Value: 47.95.195.227
TTL: 3600
```

DNS 生效时间：通常 5 分钟到 24 小时不等。
