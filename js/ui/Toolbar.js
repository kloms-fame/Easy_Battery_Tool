import { state } from '../core/State.js';
import { eventBus } from '../core/EventBus.js';

export function initToolbar(renderer) {
    document.getElementById('btn-add-cell').onclick = () => state.addCell((renderer.stage.width() / 2 - renderer.stage.x()) / renderer.stage.scaleX(), (renderer.stage.height() / 2 - renderer.stage.y()) / renderer.stage.scaleY());
    document.getElementById('btn-clear').onclick = () => state.clearAll();
    document.getElementById('btn-snap').onclick = () => state.toggleSnap();
    document.getElementById('btn-view').onclick = () => state.toggleViewMode();

    document.getElementById('btn-generate').onclick = () => {
        const type = document.getElementById('select-layout').value;
        const s = parseInt(document.getElementById('input-s').value) || 10;
        const p = parseInt(document.getElementById('input-p').value) || 4;
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

    // ================= 属性面板事件绑定 =================
    const inputV = document.getElementById('prop-voltage');
    const inputR = document.getElementById('prop-resistance');
    inputV.addEventListener('change', (e) => state.updateSelectedProperties(e.target.value, null));
    inputR.addEventListener('change', (e) => state.updateSelectedProperties(null, e.target.value));

    // ================= 工具切换 =================
    document.getElementById('tool-pointer').onclick = () => state.setTool('pointer');
    document.getElementById('tool-select-box').onclick = () => state.setTool('select-box');
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    document.getElementById('tool-polarity').onclick = () => state.setTool('polarity');
    document.getElementById('tool-pan').onclick = () => state.setTool('pan'); // 新增抓手工具
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');
    document.getElementById('btn-undo').onclick = () => state.undo();
    document.getElementById('btn-redo').onclick = () => state.redo();

    // ================= 快捷键增强 =================
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
        if (key === 'h') state.setTool('pan'); // H键切换抓手
        if (key === 'w') state.setTool('wire');
        if (key === 'k') state.toggleLockSelected();
    });

    // ================= UI 状态分发更新 =================
    eventBus.on('state:changed', ({ doc, ui, history, historyIndex }) => {
        document.getElementById('btn-snap').innerText = ui.isSnapping ? "网格吸附: 开" : "网格吸附: 关";
        document.getElementById('btn-snap').classList.toggle('active', ui.isSnapping);
        document.getElementById('btn-view').innerText = ui.viewMode === 'front' ? "当前视角: 正面" : "当前视角: 反面";

        // 工具栏高亮
        const isPointerFamily = ['pointer', 'select-box', 'select-lasso', 'polarity', 'pan'].includes(ui.currentTool);
        document.getElementById('tool-pointer').classList.toggle('active', isPointerFamily);
        document.getElementById('tool-select-box').classList.toggle('active', ui.currentTool === 'select-box');
        document.getElementById('tool-select-lasso').classList.toggle('active', ui.currentTool === 'select-lasso');
        document.getElementById('tool-polarity').classList.toggle('active', ui.currentTool === 'polarity');
        document.getElementById('tool-pan').classList.toggle('active', ui.currentTool === 'pan');
        document.getElementById('tool-wire').classList.toggle('active', ui.currentTool === 'wire');

        // 主按钮图标变化
        const pointerBtn = document.getElementById('tool-pointer');
        if (ui.currentTool === 'select-box') pointerBtn.innerText = '🔲';
        else if (ui.currentTool === 'select-lasso') pointerBtn.innerText = '〽️';
        else if (ui.currentTool === 'polarity') pointerBtn.innerText = '🔄';
        else if (ui.currentTool === 'pan') pointerBtn.innerText = '✋';
        else pointerBtn.innerText = '👆';

        document.getElementById('btn-undo').style.opacity = historyIndex > 0 ? '1' : '0.4';
        document.getElementById('btn-redo').style.opacity = historyIndex < history.length - 1 ? '1' : '0.4';

        // ================= 刷新属性面板 =================
        const propPanel = document.getElementById('panel-properties');
        const propInfo = document.getElementById('prop-selection-info');

        if (ui.selectedCells.length === 0) {
            propPanel.style.display = 'none'; // 没选中时不干扰界面
        } else {
            propPanel.style.display = 'block';
            if (ui.selectedCells.length === 1) {
                const cell = doc.cells.find(c => c.id === ui.selectedCells[0]);
                propInfo.innerText = `当前选中: ${cell.id}`;
                // 防抖设计：避免打字中途被重绘打断
                if (document.activeElement !== inputV) inputV.value = cell.voltage || '';
                if (document.activeElement !== inputR) inputR.value = cell.resistance || '';
            } else {
                propInfo.innerText = `已选中 ${ui.selectedCells.length} 个图元 (批量修改)`;
                if (document.activeElement !== inputV) inputV.value = '';
                if (document.activeElement !== inputR) inputR.value = '';
            }
        }
    });
}