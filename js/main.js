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
        state.generateGrid(3, 4, renderer.stage.width(), renderer.stage.height());
    }

    // ✅ 启动 WebRTC P2P 联机引擎
    state.initNetwork();

    console.log("Pack Architect 5.0 Engine Started.");
});