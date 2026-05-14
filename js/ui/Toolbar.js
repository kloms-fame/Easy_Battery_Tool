import { state } from '../core/State.js';
import { eventBus } from '../core/EventBus.js';

export function initToolbar(renderer) {
    document.getElementById('btn-add-cell').onclick = () => state.addCell((renderer.stage.width() / 2 - renderer.stage.x()) / renderer.stage.scaleX(), (renderer.stage.height() / 2 - renderer.stage.y()) / renderer.stage.scaleY());
    document.getElementById('btn-clear').onclick = () => state.clearAll();
    document.getElementById('btn-snap').onclick = () => state.toggleSnap();
    document.getElementById('btn-view').onclick = () => state.toggleViewMode();

    // ================= 高级追加生成 =================
    document.getElementById('btn-generate').onclick = () => {
        const type = document.getElementById('select-layout').value;
        const s = parseInt(document.getElementById('input-s').value) || 10;
        const p = parseInt(document.getElementById('input-p').value) || 4;

        // 获取当前视野真正的中心点
        const centerX = (renderer.stage.width() / 2 - renderer.stage.x()) / renderer.stage.scaleX();
        const centerY = (renderer.stage.height() / 2 - renderer.stage.y()) / renderer.stage.scaleY();

        state.generateLayout(type, s, p, centerX, centerY);
    };

    document.getElementById('btn-lock').onclick = () => state.toggleLockSelected();

    document.getElementById('btn-export').onclick = () => state.exportProject();
    const fileInput = document.getElementById('file-import');
    document.getElementById('btn-import').onclick = () => fileInput.click();
    fileInput.addEventListener('change', (e) => {
        if (!e.target.files[0]) return;
        const reader = new FileReader();
        reader.onload = (event) => state.importProject(event.target.result);
        reader.readAsText(e.target.files[0]); e.target.value = '';
    });

    document.getElementById('tool-pointer').onclick = () => state.setTool('pointer');
    document.getElementById('tool-select-box').onclick = () => state.setTool('select-box');
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    document.getElementById('tool-polarity').onclick = () => state.setTool('polarity');
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');
    document.getElementById('btn-undo').onclick = () => state.undo();
    document.getElementById('btn-redo').onclick = () => state.redo();

    // ================= 键盘交互拦截 =================
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') { e.preventDefault(); renderer.stage.draggable(true); document.body.classList.add('grabbing-mode'); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); }
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); state.redo(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); state.copySelected(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); state.pasteSelected(); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); state.deleteSelected(); }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { renderer.stage.draggable(false); document.body.classList.remove('grabbing-mode'); }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const key = e.key.toLowerCase();
        if (key === 'v') state.setTool('pointer');
        if (key === 'b') state.setTool('select-box');
        if (key === 'l') state.setTool('select-lasso');
        if (key === 'p') state.setTool('polarity');
        if (key === 'w') state.setTool('wire');
        if (key === 'k') state.toggleLockSelected();
    });

    eventBus.on('state:changed', ({ ui, history, historyIndex }) => {
        document.getElementById('btn-snap').innerText = ui.isSnapping ? "网格吸附: 开" : "网格吸附: 关";
        document.getElementById('btn-snap').classList.toggle('active', ui.isSnapping);
        document.getElementById('btn-view').innerText = ui.viewMode === 'front' ? "当前视角: 正面" : "当前视角: 反面";

        const isPointerFamily = ['pointer', 'select-box', 'select-lasso', 'polarity'].includes(ui.currentTool);
        document.getElementById('tool-pointer').classList.toggle('active', isPointerFamily);
        document.getElementById('tool-select-box').classList.toggle('active', ui.currentTool === 'select-box');
        document.getElementById('tool-select-lasso').classList.toggle('active', ui.currentTool === 'select-lasso');
        document.getElementById('tool-polarity').classList.toggle('active', ui.currentTool === 'polarity');
        document.getElementById('tool-wire').classList.toggle('active', ui.currentTool === 'wire');

        const pointerBtn = document.getElementById('tool-pointer');
        if (ui.currentTool === 'select-box') pointerBtn.innerText = '🔲';
        else if (ui.currentTool === 'select-lasso') pointerBtn.innerText = '〽️';
        else if (ui.currentTool === 'polarity') pointerBtn.innerText = '🔄';
        else pointerBtn.innerText = '👆';

        document.getElementById('btn-undo').style.opacity = historyIndex > 0 ? '1' : '0.4';
        document.getElementById('btn-redo').style.opacity = historyIndex < history.length - 1 ? '1' : '0.4';
    });
}