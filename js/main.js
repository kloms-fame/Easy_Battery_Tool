import { Renderer } from './core/Renderer.js';
import { initToolbar } from './ui/Toolbar.js';
import { state } from './core/State.js';

document.addEventListener('DOMContentLoaded', () => {
    const renderer = new Renderer('canvas-container');
    initToolbar(renderer);

    const hasLocalDraft = state.loadFromLocal();
    if (hasLocalDraft) {
        state.commitAction('恢复本地草稿');
        console.log("已恢复本地草稿");
    } else {
        state.initEmptyState();
        // ✅ 修复点：使用新的 generateLayout API，默认在屏幕中央生成一个 3x4 的标准矩阵
        const centerX = renderer.stage.width() / 2;
        const centerY = renderer.stage.height() / 2;
        state.generateLayout('matrix', 3, 4, centerX, centerY);
    }

    // ✅ 启动 WebRTC P2P 联机引擎
    state.initNetwork();

    console.log("Pack Architect 6.0 Engine Started.");
});