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

    const inputV = document.getElementById('prop-voltage');
    const inputR = document.getElementById('prop-resistance');
    inputV.addEventListener('change', (e) => state.updateSelectedProperties(e.target.value, null));
    inputR.addEventListener('change', (e) => state.updateSelectedProperties(null, e.target.value));

    document.querySelectorAll('.layer-item[data-layer]').forEach(item => {
        item.onclick = () => state.toggleLayerVisibility(item.getAttribute('data-layer'));
    });

    // ================= 真实的 WebRTC 联机交互 UI =================
    const fabContainer = document.getElementById('fab-container');
    const networkPanel = document.getElementById('network-panel');
    const modalOverlay = document.getElementById('modal-overlay');
    const connectedList = document.getElementById('connected-list');
    let pendingConnection = null;

    // 唤醒联机模块 (在 main.js 中调用 state.initNetwork())
    eventBus.on('network:ready', (id) => {
        const idDisplay = document.getElementById('my-peer-id');
        idDisplay.innerText = id;
        idDisplay.onclick = () => {
            navigator.clipboard.writeText(id);
            idDisplay.innerText = "已复制！";
            setTimeout(() => idDisplay.innerText = id, 1000);
        };
    });

    // 点击展开圆球菜单
    document.getElementById('fab-main').onclick = () => fabContainer.classList.toggle('open');

    // 打开控制台
    document.getElementById('btn-lan-scan').onclick = () => {
        networkPanel.style.display = networkPanel.style.display === 'none' ? 'block' : 'none';
        fabContainer.classList.remove('open');
    };
    document.getElementById('btn-close-network').onclick = () => networkPanel.style.display = 'none';

    // 主动连接别人
    document.getElementById('btn-connect-peer').onclick = () => {
        const targetId = document.getElementById('target-peer-id').value.trim().toUpperCase();
        if (targetId && targetId !== state.myPeerId) {
            document.getElementById('btn-connect-peer').innerText = "请求中...";
            state.connectToPeer(targetId);
        }
    };

    // 收到别人的连接请求
    eventBus.on('network:incoming', (conn) => {
        pendingConnection = conn;
        document.getElementById('req-device-name').innerText = conn.peer;
        modalOverlay.style.display = 'flex';
    });

    // 同意 / 拒绝
    document.getElementById('btn-accept-conn').onclick = () => {
        modalOverlay.style.display = 'none';
        if (pendingConnection) {
            state.acceptConnection(pendingConnection);
            networkPanel.style.display = 'block';
            pendingConnection = null;
        }
    };
    document.getElementById('btn-reject-conn').onclick = () => {
        modalOverlay.style.display = 'none';
        if (pendingConnection) {
            pendingConnection.close();
            pendingConnection = null;
        }
    };

    // UI更新：连接成功
    eventBus.on('network:connected', (peerId) => {
        document.getElementById('btn-connect-peer').innerText = "连接";
        document.getElementById('no-connection-tip').style.display = 'none';

        // 防止重复添加
        if (document.getElementById(`conn-${peerId}`)) return;

        const div = document.createElement('div');
        div.className = 'layer-item';
        div.id = `conn-${peerId}`;
        div.style.justifyContent = 'space-between';
        div.style.borderLeft = '3px solid #10b981';
        div.innerHTML = `
            <span style="color:#10b981; font-size:12px; user-select:all;">⚡ ${peerId}</span>
            <button class="btn-disconnect" style="width:auto; padding: 2px 5px; margin:0; background:#475569; border:none; font-size:10px;">断开</button>
        `;
        div.querySelector('.btn-disconnect').onclick = () => {
            state.disconnectPeer(peerId);
        };
        connectedList.appendChild(div);
    });

    // UI更新：连接断开
    eventBus.on('network:disconnected', (peerId) => {
        const el = document.getElementById(`conn-${peerId}`);
        if (el) el.remove();
        if (connectedList.children.length === 1) { // 只剩提示语
            document.getElementById('no-connection-tip').style.display = 'block';
        }
    });

    // ==========================================

    document.getElementById('tool-pointer').onclick = () => state.setTool('pointer');
    document.getElementById('tool-select-box').onclick = () => state.setTool('select-box');
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    document.getElementById('tool-polarity').onclick = () => state.setTool('polarity');
    document.getElementById('tool-pan').onclick = () => state.setTool('pan');
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');
    document.getElementById('btn-undo').onclick = () => state.undo();
    document.getElementById('btn-redo').onclick = () => state.redo();

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
        if (key === 'h') state.setTool('pan');
        if (key === 'w') state.setTool('wire');
        if (key === 'k') state.toggleLockSelected();
    });

    eventBus.on('state:changed', ({ doc, ui, history, historyIndex }) => {
        document.getElementById('btn-snap').innerText = ui.isSnapping ? "网格吸附: 开" : "网格吸附: 关";
        document.getElementById('btn-snap').classList.toggle('active', ui.isSnapping);
        document.getElementById('btn-view').innerText = ui.viewMode === 'front' ? "当前视角: 正面" : "当前视角: 反面";

        const isPointerFamily = ['pointer', 'select-box', 'select-lasso', 'polarity', 'pan'].includes(ui.currentTool);
        document.getElementById('tool-pointer').classList.toggle('active', isPointerFamily);
        document.getElementById('tool-select-box').classList.toggle('active', ui.currentTool === 'select-box');
        document.getElementById('tool-select-lasso').classList.toggle('active', ui.currentTool === 'select-lasso');
        document.getElementById('tool-polarity').classList.toggle('active', ui.currentTool === 'polarity');
        document.getElementById('tool-pan').classList.toggle('active', ui.currentTool === 'pan');
        document.getElementById('tool-wire').classList.toggle('active', ui.currentTool === 'wire');

        const pointerBtn = document.getElementById('tool-pointer');
        if (ui.currentTool === 'select-box') pointerBtn.innerText = '🔲';
        else if (ui.currentTool === 'select-lasso') pointerBtn.innerText = '〽️';
        else if (ui.currentTool === 'polarity') pointerBtn.innerText = '🔄';
        else if (ui.currentTool === 'pan') pointerBtn.innerText = '✋';
        else pointerBtn.innerText = '👆';

        document.getElementById('btn-undo').style.opacity = historyIndex > 0 ? '1' : '0.4';
        document.getElementById('btn-redo').style.opacity = historyIndex < history.length - 1 ? '1' : '0.4';

        const propPanel = document.getElementById('panel-properties');
        const propInfo = document.getElementById('prop-selection-info');

        if (ui.selectedCells.length === 0) {
            propPanel.style.display = 'none';
        } else {
            propPanel.style.display = 'block';
            if (ui.selectedCells.length === 1) {
                const cell = doc.cells.find(c => c.id === ui.selectedCells[0]);
                propInfo.innerText = `当前选中: ${cell.id}`;
                if (document.activeElement !== inputV) inputV.value = cell.voltage || '';
                if (document.activeElement !== inputR) inputR.value = cell.resistance || '';
            } else {
                propInfo.innerText = `已选中 ${ui.selectedCells.length} 个图元 (批量修改)`;
                if (document.activeElement !== inputV) inputV.value = '';
                if (document.activeElement !== inputR) inputR.value = '';
            }
        }

        document.querySelectorAll('.layer-item[data-layer]').forEach(item => {
            const layerName = item.getAttribute('data-layer');
            const isVisible = ui.layerVisibility[layerName];
            item.classList.toggle('hidden-layer', !isVisible);
            item.querySelector('.layer-toggle').innerText = isVisible ? '👁️' : '🙈';
        });
    });
}