import { state } from '../core/State.js';
import { eventBus } from '../core/EventBus.js';

const safelySetText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
const safelyToggleClass = (id, className, condition) => { const el = document.getElementById(id); if (el) el.classList.toggle(className, condition); };

export function initToolbar(renderer) {
    // ✅ 完美的移动端悬浮子菜单切换逻辑
    const dropdownBtn = document.getElementById('tool-pointer');
    const dropdownContainer = dropdownBtn.parentElement;

    dropdownBtn.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            e.stopPropagation(); // 关键！阻止事件穿透到画布，避免刚打开就被收起
            dropdownContainer.classList.toggle('mobile-open');
        }
    });

    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                e.stopPropagation();
                dropdownContainer.classList.remove('mobile-open');
            }
        });
    });

    // 点击其他区域自动收起气泡菜单
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && !dropdownContainer.contains(e.target)) {
            dropdownContainer.classList.remove('mobile-open');
        }
    });
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

    const fileInput = document.getElementById('file-import'); document.getElementById('btn-import').onclick = () => fileInput.click();
    fileInput.addEventListener('change', (e) => {
        if (!e.target.files[0]) return;
        const reader = new FileReader();
        reader.onload = (event) => state.importProject(event.target.result);
        reader.readAsText(e.target.files[0]); e.target.value = '';
    });

    const inputV = document.getElementById('prop-voltage'); const inputR = document.getElementById('prop-resistance');
    if (inputV) inputV.addEventListener('change', (e) => state.updateSelectedProperties(e.target.value, null));
    if (inputR) inputR.addEventListener('change', (e) => state.updateSelectedProperties(null, e.target.value));

    document.querySelectorAll('.layer-item[data-layer]').forEach(item => { item.onclick = () => state.toggleLayerVisibility(item.getAttribute('data-layer')); });

    const fabContainer = document.getElementById('fab-container');
    const networkPanel = document.getElementById('network-panel');
    const modalOverlay = document.getElementById('modal-overlay');
    const statusIndicator = document.getElementById('p2p-status-indicator');
    let pendingConnection = null;

    eventBus.on('network:ready', (id) => {
        const idDisplay = document.getElementById('my-peer-id');
        if (idDisplay) { idDisplay.innerText = id; idDisplay.onclick = () => { navigator.clipboard.writeText(id); idDisplay.innerText = "已复制！"; setTimeout(() => idDisplay.innerText = id, 1000); }; }
    });

    eventBus.on('network:error', (err) => { alert("联机信号中继失败：" + err.type); safelySetText('btn-connect-peer', '连接'); });

    document.getElementById('fab-main').onclick = () => fabContainer.classList.toggle('open');
    document.getElementById('btn-lan-scan').onclick = () => { if (networkPanel) networkPanel.style.display = networkPanel.style.display === 'none' ? 'block' : 'none'; if (fabContainer) fabContainer.classList.remove('open'); };
    document.getElementById('btn-close-network').onclick = () => { if (networkPanel) networkPanel.style.display = 'none'; };

    document.getElementById('btn-connect-peer').onclick = () => {
        const targetId = document.getElementById('target-peer-id').value.trim().toUpperCase();
        if (targetId && targetId !== state.myPeerId) { safelySetText('btn-connect-peer', '握手中...'); state.connectToPeer(targetId); }
    };

    eventBus.on('network:incoming', (conn) => { pendingConnection = conn; safelySetText('req-device-name', conn.peer); if (modalOverlay) modalOverlay.style.display = 'flex'; });

    document.getElementById('btn-accept-conn').onclick = () => { if (modalOverlay) modalOverlay.style.display = 'none'; if (pendingConnection) { state.acceptConnection(pendingConnection); if (networkPanel) networkPanel.style.display = 'block'; pendingConnection = null; } };
    document.getElementById('btn-reject-conn').onclick = () => { if (modalOverlay) modalOverlay.style.display = 'none'; if (pendingConnection) { pendingConnection.close(); pendingConnection = null; } };

    eventBus.on('network:list_changed', (peers) => {
        const listEl = document.getElementById('connected-list');
        if (!listEl) return;
        listEl.innerHTML = ''; safelySetText('btn-connect-peer', '连接');

        if (peers.length === 0) {
            listEl.innerHTML = '<div id="no-connection-tip" style="font-size: 11px; color: #475569; text-align: center; padding: 10px;">暂无连接</div>';
            safelySetText('p2p-status-indicator', `📡 局域网: 离线`);
            if (statusIndicator) statusIndicator.classList.remove('network-online');
        } else {
            safelySetText('p2p-status-indicator', `📡 局域网: ${peers.length}人在线`);
            if (statusIndicator) statusIndicator.classList.add('network-online');
            peers.forEach(peerId => {
                const div = document.createElement('div'); div.className = 'layer-item'; div.style.justifyContent = 'space-between'; div.style.borderLeft = '3px solid #10b981';
                div.innerHTML = `<span style="color:#10b981; font-size:12px; font-weight:bold;">⚡ ${peerId}</span><button class="btn-disconnect" style="width:auto; padding: 2px 5px; margin:0; background:#7f1d1d; color:white; border:none; border-radius:4px; font-size:10px;">断开</button>`;
                div.querySelector('.btn-disconnect').onclick = () => state.disconnectPeer(peerId);
                listEl.appendChild(div);
            });
        }
    });

    let syncTimeout;
    eventBus.on('network:syncing', () => {
        safelySetText('p2p-status-indicator', '📡 接收同步数据...'); if (statusIndicator) statusIndicator.classList.add('network-syncing');
        clearTimeout(syncTimeout); syncTimeout = setTimeout(() => { if (statusIndicator) statusIndicator.classList.remove('network-syncing'); safelySetText('p2p-status-indicator', `📡 局域网: ${state.connectedPeers.length}人在线`); }, 500);
    });

    // ==========================================
    document.getElementById('tool-pointer').onclick = () => state.setTool('pointer');
    document.getElementById('tool-select-box').onclick = () => state.setTool('select-box');
    document.getElementById('tool-select-lasso').onclick = () => state.setTool('select-lasso');
    document.getElementById('tool-polarity').onclick = () => state.setTool('polarity');
    document.getElementById('tool-pan').onclick = () => state.setTool('pan');
    document.getElementById('tool-wire').onclick = () => state.setTool('wire');
    document.getElementById('tool-measure').onclick = () => state.setTool('measure'); // ✅ 绑定卡尺
    document.getElementById('btn-undo').onclick = () => state.undo(); document.getElementById('btn-redo').onclick = () => state.redo();

    window.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.code === 'Space') { e.preventDefault(); renderer.stage.draggable(true); document.body.classList.add('grabbing-mode'); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); } if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); state.redo(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); state.copySelected(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); state.pasteSelected(); } if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); state.deleteSelected(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { renderer.stage.draggable(false); document.body.classList.remove('grabbing-mode'); } if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; const key = e.key.toLowerCase(); if (key === 'v') state.setTool('pointer'); if (key === 'b') state.setTool('select-box'); if (key === 'l') state.setTool('select-lasso'); if (key === 'p') state.setTool('polarity'); if (key === 'h') state.setTool('pan'); if (key === 'm') state.setTool('measure'); if (key === 'w') state.setTool('wire'); if (key === 'k') state.toggleLockSelected(); });

    eventBus.on('state:changed', ({ doc, ui, history, historyIndex }) => {
        safelySetText('btn-snap', ui.isSnapping ? "网格吸附: 开" : "网格吸附: 关"); safelyToggleClass('btn-snap', 'active', ui.isSnapping);
        safelySetText('btn-view', ui.viewMode === 'front' ? "当前视角: 正面" : "当前视角: 反面");

        const isPointerFamily = ['pointer', 'select-box', 'select-lasso', 'polarity', 'pan'].includes(ui.currentTool);
        safelyToggleClass('tool-pointer', 'active', isPointerFamily);
        safelyToggleClass('tool-select-box', 'active', ui.currentTool === 'select-box');
        safelyToggleClass('tool-select-lasso', 'active', ui.currentTool === 'select-lasso');
        safelyToggleClass('tool-polarity', 'active', ui.currentTool === 'polarity');
        safelyToggleClass('tool-pan', 'active', ui.currentTool === 'pan');
        safelyToggleClass('tool-wire', 'active', ui.currentTool === 'wire');
        safelyToggleClass('tool-measure', 'active', ui.currentTool === 'measure'); // ✅ 卡尺高亮

        let pointerIcon = '👆';
        if (ui.currentTool === 'select-box') pointerIcon = '🔲'; else if (ui.currentTool === 'select-lasso') pointerIcon = '〽️'; else if (ui.currentTool === 'polarity') pointerIcon = '🔄'; else if (ui.currentTool === 'pan') pointerIcon = '✋';
        safelySetText('tool-pointer', pointerIcon);

        const btnUndo = document.getElementById('btn-undo'); const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) btnUndo.style.opacity = historyIndex > 0 ? '1' : '0.4';
        if (btnRedo) btnRedo.style.opacity = historyIndex < history.length - 1 ? '1' : '0.4';

        const propPanel = document.getElementById('panel-properties'); const propInfo = document.getElementById('prop-selection-info');
        if (propPanel) {
            if (ui.selectedCells.length === 0) { propPanel.style.display = 'none'; }
            else {
                propPanel.style.display = 'block';
                if (ui.selectedCells.length === 1) {
                    const cell = doc.cells.find(c => c.id === ui.selectedCells[0]);
                    if (propInfo) propInfo.innerText = `当前选中: ${cell.id}`;
                    if (inputV && document.activeElement !== inputV) inputV.value = cell.voltage || '';
                    if (inputR && document.activeElement !== inputR) inputR.value = cell.resistance || '';
                } else {
                    if (propInfo) propInfo.innerText = `已选中 ${ui.selectedCells.length} 个图元`;
                    if (inputV && document.activeElement !== inputV) inputV.value = '';
                    if (inputR && document.activeElement !== inputR) inputR.value = '';
                }
            }
        }
        document.querySelectorAll('.layer-item[data-layer]').forEach(item => { const layerName = item.getAttribute('data-layer'); const isVisible = ui.layerVisibility[layerName]; item.classList.toggle('hidden-layer', !isVisible); const toggle = item.querySelector('.layer-toggle'); if (toggle) toggle.innerText = isVisible ? '👁️' : '🙈'; });
    });
}