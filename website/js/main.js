/**
 * Main JavaScript - MC Survival Bot Website
 * Minimal, clean interactions
 */

// Language switching
let currentLang = 'zh';

const translations = {
    zh: {
        'nav.features': '功能',
        'nav.architecture': '架构',
        'nav.start': '开始',
        'nav.github': 'GitHub',
        'hero.title': '让 AI 在 Minecraft 中\n自主生存',
        'hero.subtitle': '基于 Mineflayer 的智能生存 BOT，整合 Smart Brain、行为树、安全规则与实时监控，无需作弊指令。',
        'hero.cta.primary': '开始使用',
        'hero.cta.secondary': '了解更多',
        'features.label': 'Features',
        'features.title': '六大核心能力',
        'features.subtitle': '从感知到执行的完整智能生存系统',
        'architecture.label': 'Architecture',
        'architecture.title': '系统架构',
        'architecture.subtitle': '从 Minecraft Server 到 Dashboard 的完整数据流',
        'quickstart.label': 'Installation',
        'quickstart.title': '快速开始',
        'quickstart.subtitle': '5 分钟内启动你的 AI Bot',
        'footer.copyright': 'MIT License · 开源项目'
    },
    en: {
        'nav.features': 'Features',
        'nav.architecture': 'Architecture',
        'nav.start': 'Get Started',
        'nav.github': 'GitHub',
        'hero.title': 'Let AI Survive\nin Minecraft',
        'hero.subtitle': 'Intelligent survival BOT based on Mineflayer, integrating Smart Brain, behavior trees, safety rules and real-time monitoring. No cheats.',
        'hero.cta.primary': 'Get Started',
        'hero.cta.secondary': 'Learn More',
        'features.label': 'Features',
        'features.title': 'Six Core Capabilities',
        'features.subtitle': 'Complete intelligent survival system from perception to execution',
        'architecture.label': 'Architecture',
        'architecture.title': 'System Architecture',
        'architecture.subtitle': 'Complete data flow from Minecraft Server to Dashboard',
        'quickstart.label': 'Installation',
        'quickstart.title': 'Quick Start',
        'quickstart.subtitle': 'Launch your AI Bot in 5 minutes',
        'footer.copyright': 'MIT License · Open Source'
    }
};

function setLanguage(lang) {
    if (!translations[lang]) return;
    currentLang = lang;

    // Update buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Update text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.textContent = translations[lang][key];
        }
    });

    // Update hero title (preserve gradient span)
    const heroTitle = document.querySelector('.hero h1');
    if (heroTitle) {
        const text = translations[lang]['hero.title'];
        const lines = text.split('\n');
        heroTitle.innerHTML = `${lines[0]}<span class="gradient">${lines[1]}</span>`;
    }

    // Update hero subtitle
    const heroSubtitle = document.querySelector('.hero-subtitle');
    if (heroSubtitle) {
        heroSubtitle.textContent = translations[lang]['hero.subtitle'];
    }

    // Update CTA buttons
    const primaryBtn = document.querySelector('.hero .btn-primary');
    const secondaryBtn = document.querySelector('.hero .btn-secondary');
    if (primaryBtn) primaryBtn.textContent = translations[lang]['hero.cta.primary'];
    if (secondaryBtn) secondaryBtn.textContent = translations[lang]['hero.cta.secondary'];

    // Store preference
    localStorage.setItem('mc-bot-lang', lang);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Check for stored preference
    const storedLang = localStorage.getItem('mc-bot-lang');
    if (storedLang && translations[storedLang]) {
        setLanguage(storedLang);
    }

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // Navbar scroll effect
    const nav = document.querySelector('.nav');
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            nav.style.background = 'rgba(15, 15, 26, 0.95)';
        } else {
            nav.style.background = 'rgba(15, 15, 26, 0.8)';
        }

        lastScroll = currentScroll;
    }, { passive: true });

    // Reveal animations with Intersection Observer
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe feature cards
    document.querySelectorAll('.feature-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });

    // Observe arch nodes
    document.querySelectorAll('.arch-node').forEach((node, index) => {
        node.style.opacity = '0';
        node.style.transform = 'scale(0.9)';
        node.style.transition = `opacity 0.5s ease ${index * 0.1}s, transform 0.5s ease ${index * 0.1}s`;
        observer.observe(node);
    });
});

// Console log
console.log('🤖 MC Survival Bot - Website Loaded');
