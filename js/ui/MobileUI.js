export function initMobileUI() {
    const btnMenu = document.getElementById('btn-mobile-menu');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');

    if (!btnMenu || !sidebar || !overlay) return;

    // 展开/收起侧边栏
    const toggleMenu = () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('open');
    };

    btnMenu.addEventListener('click', toggleMenu);

    // 点击暗色遮罩自动收起侧边栏
    overlay.addEventListener('click', toggleMenu);

    // 监听侧边栏内部的按钮点击（如生成、清空、导入），点完自动收起侧边栏，给用户让出视野
    const actionButtons = ['btn-generate', 'btn-clear', 'btn-import', 'btn-export'];
    actionButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                // 延迟 200ms 收起，让用户看到点击反馈
                setTimeout(() => {
                    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
                        toggleMenu();
                    }
                }, 200);
            });
        }
    });
}