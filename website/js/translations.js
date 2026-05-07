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
        viewDemo: 'View Architecture',
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

    // Update active button
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((lang === 'zh' && btn.textContent === '中文') ||
            (lang === 'en' && btn.textContent === 'English')) {
            btn.classList.add('active');
        }
    });
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
