/**
 * Translation System - MC Survival Bot Website
 * Bilingual support: Chinese (zh) / English (en)
 */

const translations = {
    zh: {
        title: 'MC Survival Bot',
        subtitle: '用 AI 在 Minecraft 中自主生存',
        exploreFeatures: '探索功能',
        viewDemo: '查看架构',
        github: 'GitHub',
        features: {
            title: '核心功能',
            smartBrain: {
                title: 'Smart Brain',
                desc: 'AI 智能大脑，理解环境并做出决策，支持 Python Brain 多 Agent 并发规划'
            },
            safety: {
                title: '安全优先',
                desc: '本地安全规则层优先接管，LLM 无法覆盖硬安全决策，保障 BOT 生存安全'
            },
            behaviorTree: {
                title: '行为树',
                desc: '可执行任务流，精确控制每一个动作，带完整的准备-感知-移动-执行-验证流程'
            },
            dashboard: {
                title: 'Dashboard',
                desc: '实时监控面板，展示状态、决策链路、行为树队列和 LLM 调用审计'
            },
            memory: {
                title: '记忆系统',
                desc: '环境学习与适应，探索记忆、庇护所位置、地形扫描，持续优化策略'
            },
            research: {
                title: '研究任务',
                desc: '可评测任务目录，支持 observation/reward/quit 条件量化 BOT 能力'
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
            copyright: 'MC Survival Bot — 开源项目',
            license: 'MIT License'
        }
    },
    en: {
        title: 'MC Survival Bot',
        subtitle: 'AI-powered autonomous survival in Minecraft',
        exploreFeatures: 'Explore Features',
        viewDemo: 'View Architecture',
        github: 'GitHub',
        features: {
            title: 'Core Features',
            smartBrain: {
                title: 'Smart Brain',
                desc: 'AI brain that understands environment and makes decisions with Python Brain multi-agent concurrent planning'
            },
            safety: {
                title: 'Safety First',
                desc: 'Local safety rule layer takes priority, LLM cannot override hard safety decisions'
            },
            behaviorTree: {
                title: 'Behavior Trees',
                desc: 'Executable task flows with precise action control, complete prepare-sense-move-execute-verify pipeline'
            },
            dashboard: {
                title: 'Dashboard',
                desc: 'Real-time monitoring panel showing status, decision chains, behavior queue and LLM audit logs'
            },
            memory: {
                title: 'Memory System',
                desc: 'Environment learning and adaptation with exploration memory, shelter locations, terrain scanning'
            },
            research: {
                title: 'Research Missions',
                desc: 'Evaluable task catalog with observation/reward/quit conditions to quantify BOT capabilities'
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
            copyright: 'MC Survival Bot — Open Source Project',
            license: 'MIT License'
        }
    }
};

let currentLang = 'zh';

function setLanguage(lang) {
    if (!translations[lang]) return;

    currentLang = lang;
    updatePageContent();
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // Update active button state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Store preference
    localStorage.setItem('mc-bot-lang', lang);
}

function t(key) {
    const keys = key.split('.');
    let value = translations[currentLang];

    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return key;
        }
    }

    return value || key;
}

function updatePageContent() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = t(key);

        if (translated !== key) {
            // Check if element has child elements that shouldn't be replaced
            if (el.children.length === 0 || el.childNodes.length === 1) {
                el.textContent = translated;
            } else {
                // Find text nodes and update them
                const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                const textNodes = [];
                let node;
                while (node = walker.nextNode()) {
                    textNodes.push(node);
                }
                // Update first text node
                if (textNodes.length > 0) {
                    textNodes[0].textContent = translated;
                }
            }
        }
    });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Check for stored preference
    const storedLang = localStorage.getItem('mc-bot-lang');
    if (storedLang && translations[storedLang]) {
        setLanguage(storedLang);
    } else {
        updatePageContent();
    }
});
