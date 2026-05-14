import { Renderer } from './core/Renderer.js';
import { initToolbar } from './ui/Toolbar.js';
import { state } from './core/State.js';

document.addEventListener('DOMContentLoaded', () => {
    const renderer = new Renderer('canvas-container');
    initToolbar(renderer);

    // 1. 先尝试从本地 LocalStorage 恢复草稿
    const hasLocalDraft = state.loadFromLocal();

    if (hasLocalDraft) {
        // 如果有草稿，以草稿作为时间线的起点
        state.commitAction('恢复本地草稿');
        console.log("已恢复本地草稿");
    } else {
        // 2. 如果是纯新用户（无草稿），才初始化空状态和默认矩阵
        state.initEmptyState();
        state.generateGrid(3, 4, renderer.stage.width(), renderer.stage.height());
    }

    console.log("Pack Architect 3.0 Engine Started.");
});