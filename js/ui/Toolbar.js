import { state } from '../core/State.js';
import { eventBus } from '../core/EventBus.js';

export function initToolbar(renderer) {
    document.getElementById('btn-add-cell').onclick = () => {
        const stage = renderer.stage;
        const x = (stage.width() / 2 - stage.x()) / stage.scaleX();
        const y = (stage.height() / 2 - stage.y()) / stage.scaleY();
        state.addCell(x, y);
    };

    document.getElementById('btn-gen-matrix').onclick = () => state.generateGrid(4, 5, renderer.stage.width(), renderer.stage.height());
    // ================= 蜂窝布局生成绑定 =================
    document.getElementById('btn-gen-honeycomb').onclick = () => {
        // 读取输入框的值，如果用户清空了输入框，则给默认值 10S 4P
        const s = parseInt(document.getElementById('input-s').value) || 10;
        const p = parseInt(document.getElementById('input-p').value) || 4;

        // 调用底层的蜂窝算法
        state.generateHoneycomb(s, p, renderer.stage.width(), renderer.stage.height());
    };
    document.getElementById('btn-clear').onclick = () => state.clearAll();
    // ================= 文件导入与导出 =================
    document.getElementById('btn-export').onclick = () => state.exportProject();

    const fileInput = document.getElementById('file-import');
    document.getElementById('btn-import').onclick = () => fileInput.click(); // 点击按钮触发隐藏的 input

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            if (state.importProject(event.target.result)) {
                console.log('导入成功！');
            } else {
                alert('导入失败，文件格式不匹配。');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // 清空 value，使得重复导入同一个文件也能触发 change 事件
    });
    document.getElementById('btn-snap').onclick = () => state.toggleSnap();
    document.getElementById('btn-view').onclick = () => state.toggleViewMode();

    // ================= 工具切换 =================
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    // 新增极性工具绑定
    document.getElementById('tool-polarity').onclick = () => state.setTool('polarity');
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');
    document.getElementById('tool-pointer').onclick = () => state.setTool('pointer');
    document.getElementById('tool-select-box').onclick = () => state.setTool('select-box');
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');

    document.getElementById('btn-undo').onclick = () => state.undo();
    document.getElementById('btn-redo').onclick = () => state.redo();

    // ================= 修复快捷键 (改用 keyup 避免输入法拦截) =================
    window.addEventListener('keyup', (e) => {
        // 如果用户正在输入框里打字，不触发快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();
        if (key === 'v') state.setTool('pointer');
        if (key === 'b') state.setTool('select-box');
        if (key === 'l') state.setTool('select-lasso');
        if (key === 'p') state.setTool('polarity'); // 新增极性快捷键
        if (key === 'w') state.setTool('wire');
    });

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // 撤销 (Ctrl+Z)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault(); state.undo();
        }
        // 重做 (Ctrl+Y 或 Ctrl+Shift+Z)
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey)) {
            e.preventDefault(); state.redo();
        }
        // ================= 新增：复制 / 粘贴 / 删除快捷键 =================
        // 复制 (Ctrl+C)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault(); state.copySelected();
        }
        // 粘贴 (Ctrl+V)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault(); state.pasteSelected();
        }
        // 删除 (Delete 或 Backspace)
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault(); state.deleteSelected();
        }
    });

    // ================= UI 更新绑定 =================
    eventBus.on('state:changed', ({ ui, history, historyIndex }) => {
        document.getElementById('btn-snap').innerText = ui.isSnapping ? "网格吸附: 开" : "网格吸附: 关";
        document.getElementById('btn-snap').classList.toggle('active', ui.isSnapping);
        document.getElementById('btn-view').innerText = ui.viewMode === 'front' ? "当前视角: 正面" : "当前视角: 反面";

        // 按钮高亮逻辑
        const isPointerFamily = ['pointer', 'select-box', 'select-lasso', 'polarity'].includes(ui.currentTool);
        document.getElementById('tool-pointer').classList.toggle('active', isPointerFamily);
        document.getElementById('tool-select-box').classList.toggle('active', ui.currentTool === 'select-box');
        document.getElementById('tool-select-lasso').classList.toggle('active', ui.currentTool === 'select-lasso');
        document.getElementById('tool-polarity').classList.toggle('active', ui.currentTool === 'polarity'); // 新增
        document.getElementById('tool-wire').classList.toggle('active', ui.currentTool === 'wire');

        // 根据具体选择改变主按钮的图标
        const pointerBtn = document.getElementById('tool-pointer');
        if (ui.currentTool === 'select-box') pointerBtn.innerText = '🔲';
        else if (ui.currentTool === 'select-lasso') pointerBtn.innerText = '〽️';
        else if (ui.currentTool === 'polarity') pointerBtn.innerText = '🔄'; // 新增
        else pointerBtn.innerText = '👆';

        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        const canUndo = historyIndex > 0;
        const canRedo = historyIndex < history.length - 1;

        btnUndo.style.opacity = canUndo ? '1' : '0.4'; btnUndo.style.cursor = canUndo ? 'pointer' : 'not-allowed';
        btnRedo.style.opacity = canRedo ? '1' : '0.4'; btnRedo.style.cursor = canRedo ? 'pointer' : 'not-allowed';
    });
}