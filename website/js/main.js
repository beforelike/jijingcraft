/**
 * Main JavaScript - MC Survival Bot Website
 * Handles interactions, animations, and utilities
 */

// ─── Copy Code Functionality ───
function copyCode(button) {
    const codeBlock = button.parentElement.querySelector('code');
    const code = codeBlock.innerText;

    navigator.clipboard.writeText(code).then(() => {
        const originalText = button.textContent;
        button.textContent = currentLang === 'zh' ? '已复制!' : 'Copied!';
        button.style.background = 'var(--mc-experience)';
        button.style.color = 'var(--mc-obsidian)';

        setTimeout(() => {
            button.textContent = currentLang === 'zh' ? '复制' : 'Copy';
            button.style.background = '';
            button.style.color = '';
        }, 2000);
    });
}

// ─── Smooth Scroll Navigation ───
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
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

// ─── Scroll Reveal Animation with Intersection Observer ───
const revealElements = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            revealObserver.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

revealElements.forEach(el => revealObserver.observe(el));

// ─── GSAP ScrollTrigger Animations ───
if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    // Feature cards staggered animation
    gsap.utils.toArray('.feature-card').forEach((card, i) => {
        gsap.from(card, {
            scrollTrigger: {
                trigger: card,
                start: 'top 85%',
                toggleActions: 'play none none none'
            },
            y: 60,
            opacity: 0,
            duration: 0.8,
            delay: i * 0.1,
            ease: 'power3.out'
        });
    });

    // Circuit nodes animation
    gsap.utils.toArray('.circuit-node').forEach((node, i) => {
        gsap.from(node, {
            scrollTrigger: {
                trigger: node,
                start: 'top 85%',
                toggleActions: 'play none none none'
            },
            scale: 0.8,
            opacity: 0,
            duration: 0.6,
            delay: i * 0.15,
            ease: 'back.out(1.7)'
        });
    });

    // Circuit connections pulse
    gsap.utils.toArray('.circuit-connection').forEach((conn, i) => {
        gsap.to(conn, {
            scrollTrigger: {
                trigger: conn,
                start: 'top 80%',
                toggleActions: 'play play play play'
            },
            onStart: () => {
                setTimeout(() => {
                    conn.classList.add('active');
                }, i * 300);
            }
        });
    });

    // Section headers
    gsap.utils.toArray('.section-header').forEach(header => {
        gsap.from(header.children, {
            scrollTrigger: {
                trigger: header,
                start: 'top 85%',
                toggleActions: 'play none none none'
            },
            y: 40,
            opacity: 0,
            duration: 0.8,
            stagger: 0.15,
            ease: 'power3.out'
        });
    });

    // Terminal window
    const terminal = document.querySelector('.terminal-window');
    if (terminal) {
        gsap.from(terminal, {
            scrollTrigger: {
                trigger: terminal,
                start: 'top 85%',
                toggleActions: 'play none none none'
            },
            y: 60,
            opacity: 0,
            scale: 0.95,
            duration: 0.8,
            ease: 'power3.out'
        });
    }

    // Hero parallax
    gsap.to('.hero-content', {
        scrollTrigger: {
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 1
        },
        y: 100,
        opacity: 0.5
    });
}

// ─── Language Switcher Active State ───
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    });
});

// ─── Feature Card Hover Effects ───
document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        // Add subtle glow effect
        this.style.boxShadow = '0 20px 40px rgba(255, 68, 68, 0.2), 0 0 60px rgba(255, 68, 68, 0.1)';
    });

    card.addEventListener('mouseleave', function() {
        this.style.boxShadow = '';
    });
});

// ─── Circuit Node Interaction ───
document.querySelectorAll('.circuit-node').forEach(node => {
    node.addEventListener('mouseenter', function() {
        this.classList.add('active');
    });

    node.addEventListener('mouseleave', function() {
        this.classList.remove('active');
    });
});

// ─── Button Ripple Effect ───
document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.style.cssText = `
            position: absolute;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple 0.6s linear;
            pointer-events: none;
            left: ${x}px;
            top: ${y}px;
            width: 100px;
            height: 100px;
            margin-left: -50px;
            margin-top: -50px;
        `;

        this.appendChild(ripple);

        setTimeout(() => ripple.remove(), 600);
    });
});

// Add ripple animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// ─── Keyboard Navigation ───
document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        document.body.classList.add('keyboard-nav');
    }
});

document.addEventListener('mousedown', () => {
    document.body.classList.remove('keyboard-nav');
});

// ─── Performance: Pause animations when tab hidden ───
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.body.classList.add('paused');
    } else {
        document.body.classList.remove('paused');
    }
});

// ─── Console Easter Egg ───
console.log(`
%c
╔══════════════════════════════════════════════════════╗
║                                                      ║
║     ⚡ MC Survival Bot 系统已启动                  ║
║     🎮 AI-powered Minecraft Survival               ║
║     🔗 http://47.95.195.227                        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`, 'color: #ff4444; font-family: monospace; font-size: 14px;');

// ─── Initialize on DOM Ready ───
document.addEventListener('DOMContentLoaded', () => {
    // Add loaded class for initial animations
    document.body.classList.add('loaded');

    // Animate hero badge
    const badge = document.querySelector('.hero-badge');
    if (badge) {
        setTimeout(() => {
            badge.style.opacity = '1';
            badge.style.transform = 'translateY(0)';
        }, 500);
    }
});
