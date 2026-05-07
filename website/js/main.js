// Copy code functionality
function copyCode(button) {
    const codeBlock = button.nextElementSibling;
    const code = codeBlock.innerText;

    navigator.clipboard.writeText(code).then(() => {
        const originalText = button.textContent;
        button.textContent = currentLang === 'zh' ? '已复制!' : 'Copied!';
        button.style.background = '#00ff88';

        setTimeout(() => {
            button.textContent = currentLang === 'zh' ? '复制' : 'Copy';
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

// Console easter egg
console.log(`
╔══════════════════════════════════════╗
║     MC Survival Bot                  ║
║     AI-powered Minecraft Survival    ║
╚══════════════════════════════════════╝
`);
