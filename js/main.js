import { Renderer } from './core/Renderer.js';
import { initToolbar } from './ui/Toolbar.js';
import { state } from './core/State.js';
import { initMobileUI } from './ui/MobileUI.js'; // ✅ 引入移动端模块

document.addEventListener('DOMContentLoaded', () => {
    const renderer = new Renderer('canvas-container');
    initToolbar(renderer);
    initMobileUI(); // ✅ 初始化移动端交互逻辑

    const hasLocalDraft = state.loadFromLocal();
    if (hasLocalDraft) {
        state.commitAction('恢复本地草稿');
        console.log("已恢复本地草稿");
    } else {
        state.initEmptyState();
        const centerX = renderer.stage.width() / 2;
        const centerY = renderer.stage.height() / 2;
        state.generateLayout('matrix', 3, 4, centerX, centerY);
    }

    state.initNetwork();
    console.log("Pack Architect 7.0 Engine Started (Mobile Optimized).");
});