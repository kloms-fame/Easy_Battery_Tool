import { eventBus } from './EventBus.js';

class State {
    constructor() {
        this.doc = { cells: [], busbars: [] };
        this.ui = { viewMode: 'front', currentTool: 'pointer', isSnapping: false, gridSize: 40, cellRadius: 18, wireStartCell: null, selectedCells: [], layerVisibility: { cell: true, busbar: true, labels: true, ui: true } };
        this.idCounters = { cell: 1, busbar: 1 };
        this.history = []; this.historyIndex = -1; this.clipboard = { cells: [], busbars: [] };

        // ================= WebRTC 联机变量 =================
        this.peer = null;
        this.myPeerId = null;
        this.connections = []; // 存储所有已连接的局域网同伴
    }

    initEmptyState() { this.commitAction('初始空画布'); }

    // 核心拦截点：凡是你做出的修改，都会向局域网广播
    commitAction(actionName) {
        if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ action: actionName, data: JSON.parse(JSON.stringify({ doc: this.doc, idCounters: this.idCounters })) });
        this.historyIndex++;
        this.notify();
        this.broadcastState(); // 向局域网广播
    }

    undo() { if (this.historyIndex > 0) { this.historyIndex--; this.restoreSnapshot(); this.broadcastState(); } }
    redo() { if (this.historyIndex < this.history.length - 1) { this.historyIndex++; this.restoreSnapshot(); this.broadcastState(); } }
    restoreSnapshot() { const snapshot = JSON.parse(JSON.stringify(this.history[this.historyIndex].data)); this.doc = snapshot.doc; this.idCounters = snapshot.idCounters; this.ui.wireStartCell = null; this.notify(); }

    exportProject() {
        const dataStr = JSON.stringify({ doc: this.doc, idCounters: this.idCounters }, null, 2);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([dataStr], { type: "application/json" }));
        a.download = `Pack_Architect_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`; a.click();
    }
    importProject(jsonData) {
        try { const data = JSON.parse(jsonData); if (data.doc && data.idCounters) { this.doc = data.doc; this.idCounters = data.idCounters; this.clearSelection(); this.commitAction('导入项目'); return true; } } catch (e) { console.error(e); } return false;
    }
    saveToLocal() { localStorage.setItem('packArchitectProject_V4', JSON.stringify({ doc: this.doc, idCounters: this.idCounters })); }
    loadFromLocal() {
        const dataStr = localStorage.getItem('packArchitectProject_V4');
        if (dataStr) { try { const data = JSON.parse(dataStr); this.doc = data.doc; this.idCounters = data.idCounters; return true; } catch (e) { return false; } } return false;
    }

    // ================= P2P 局域网联机引擎 =================
    initNetwork() {
        // 生成一个简短的4位验证码作为联机ID (例如: PACK-XYZ9)
        const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.myPeerId = `PACK-${shortId}`;

        // 借助 PeerJS 官方云红娘服务器进行握手发现
        this.peer = new Peer(this.myPeerId);

        this.peer.on('open', (id) => eventBus.emit('network:ready', id));
        this.peer.on('error', (err) => console.error('网络错误:', err));

        // 监听来自局域网其他电脑的直连请求
        this.peer.on('connection', (conn) => eventBus.emit('network:incoming', conn));
    }

    // 同意并建立连接
    acceptConnection(conn) {
        this.setupConnection(conn);
        // 我同意后，把我的全盘数据发给新来的同事同步
        conn.on('open', () => {
            conn.send({ type: 'sync_full', doc: this.doc, idCounters: this.idCounters });
            this.connections.push(conn);
            eventBus.emit('network:connected', conn.peer);
        });
    }

    // 主动去连接别人
    connectToPeer(targetId) {
        if (!this.peer) return;
        const conn = this.peer.connect(targetId);
        this.setupConnection(conn);
        conn.on('open', () => {
            this.connections.push(conn);
            eventBus.emit('network:connected', conn.peer);
            // 主动连过去后，不需要发自己的数据，等对方广播
        });
    }

    // 配置数据通道 (只处理局域网内传来的数据，不走云端)
    setupConnection(conn) {
        conn.on('data', (msg) => {
            if (msg.type === 'sync_full') {
                this.doc = msg.doc;
                this.idCounters = msg.idCounters;
                this.clearSelection();
                this.notify(); // 收到远端数据，仅刷新 UI 和本地存储，不要再广播出去防止死循环
            }
        });
        conn.on('close', () => {
            this.connections = this.connections.filter(c => c.peer !== conn.peer);
            eventBus.emit('network:disconnected', conn.peer);
        });
    }

    // P2P 广播方法
    broadcastState() {
        if (this.connections.length === 0) return;
        const payload = { type: 'sync_full', doc: this.doc, idCounters: this.idCounters };
        this.connections.forEach(conn => {
            if (conn.open) conn.send(payload); // 毫秒级局域网直传
        });
    }

    disconnectPeer(peerId) {
        const conn = this.connections.find(c => c.peer === peerId);
        if (conn) { conn.close(); this.connections = this.connections.filter(c => c.peer !== peerId); }
    }

    // ================= 基础逻辑 (缩略) =================
    toggleLockSelected() { if (this.ui.selectedCells.length === 0) return; const allLocked = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).every(c => c.isLocked); this.doc.cells.forEach(c => { if (this.ui.selectedCells.includes(c.id)) c.isLocked = !allLocked; }); this.commitAction(allLocked ? '解锁电芯' : '锁定电芯'); }
    deleteSelected() { if (this.ui.selectedCells.length === 0) return; const cellsToDelete = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id) && !c.isLocked).map(c => c.id); if (cellsToDelete.length === 0) return; this.doc.cells = this.doc.cells.filter(c => !cellsToDelete.includes(c.id)); this.doc.busbars = this.doc.busbars.filter(b => !cellsToDelete.includes(b.from) && !cellsToDelete.includes(b.to)); this.ui.selectedCells = this.ui.selectedCells.filter(id => !cellsToDelete.includes(id)); this.commitAction('删除选中项'); }
    copySelected() { this.clipboard.cells = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).map(c => ({ ...c })); this.clipboard.busbars = this.doc.busbars.filter(b => this.ui.selectedCells.includes(b.from) && this.ui.selectedCells.includes(b.to)).map(b => ({ ...b })); }
    pasteSelected() { if (this.clipboard.cells.length === 0) return; let idMapping = {}; let newSelectedIds = []; const offset = this.ui.gridSize; this.clipboard.cells.forEach(c => { let newId = `C${this.idCounters.cell++}`; idMapping[c.id] = newId; newSelectedIds.push(newId); this.doc.cells.push({ id: newId, cx: c.cx + offset, cy: c.cy + offset, polarity: c.polarity, isLocked: false, voltage: c.voltage, resistance: c.resistance }); c.cx += offset; c.cy += offset; }); this.clipboard.busbars.forEach(b => { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: idMapping[b.from], to: idMapping[b.to] }); }); this.ui.selectedCells = newSelectedIds; this.commitAction('粘贴'); }
    updateSelectedProperties(voltage, resistance) { if (this.ui.selectedCells.length === 0) return; this.doc.cells.forEach(c => { if (this.ui.selectedCells.includes(c.id)) { if (voltage !== null) c.voltage = voltage; if (resistance !== null) c.resistance = resistance; } }); this.commitAction('修改图元属性'); }
    addCell(x, y) { this.doc.cells.push({ id: `C${this.idCounters.cell++}`, cx: x, cy: y, polarity: 'positive', isLocked: false, voltage: '', resistance: '' }); this.commitAction('添加电芯'); }
    clearAll() { this.doc.cells = []; this.doc.busbars = []; this.idCounters = { cell: 1, busbar: 1 }; this.ui.wireStartCell = null; this.commitAction('清空画布'); }
    removeBusbar(index) { if (this.ui.currentTool === 'pointer') { this.doc.busbars.splice(index, 1); this.commitAction('删除连线'); } }
    generateLayout(type, s, p, centerX, centerY) { let newIds = []; const hexStep = this.ui.gridSize * (Math.sqrt(3) / 2); const rowHeight = type === 'matrix' ? this.ui.gridSize : hexStep; const colWidth = type === 'fishscale' ? hexStep : this.ui.gridSize; const startX = centerX - (p * colWidth) / 2; const startY = centerY - (s * rowHeight) / 2; for (let r = 0; r < s; r++) { const polarity = (r % 2 === 0) ? 'positive' : 'negative'; for (let c = 0; c < p; c++) { let offsetX = 0; let offsetY = 0; if (type === 'honeycomb') offsetX = (r % 2 === 1) ? (this.ui.gridSize / 2) : 0; if (type === 'fishscale') offsetY = (c % 2 === 1) ? (this.ui.gridSize / 2) : 0; const id = `C${this.idCounters.cell++}`; this.doc.cells.push({ id, cx: startX + c * colWidth + offsetX, cy: startY + r * rowHeight + offsetY, polarity: polarity, isLocked: false, voltage: '', resistance: '' }); newIds.push(id); } } this.ui.selectedCells = newIds; this.ui.currentTool = 'pointer'; this.commitAction(`追加生成 ${s}S${p}P ${type}`); }
    handleCellClick(id, isMultiSelect = false) { const cell = this.doc.cells.find(c => c.id === id); if (!cell) return; if (this.ui.currentTool === 'pointer') { if (isMultiSelect) { if (this.ui.selectedCells.includes(id)) this.ui.selectedCells = this.ui.selectedCells.filter(c => c !== id); else this.ui.selectedCells.push(id); } else { this.ui.selectedCells = [id]; } this.notify(); } else if (this.ui.currentTool === 'polarity' && !cell.isLocked) { cell.polarity = cell.polarity === 'positive' ? 'negative' : 'positive'; this.commitAction('翻转极性'); } else if (this.ui.currentTool === 'wire') { if (!this.ui.wireStartCell) { this.ui.wireStartCell = id; this.notify(); } else { if (this.ui.wireStartCell !== id) { const exists = this.doc.busbars.some(b => (b.from === this.ui.wireStartCell && b.to === id) || (b.from === id && b.to === this.ui.wireStartCell)); if (!exists) { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: this.ui.wireStartCell, to: id }); this.ui.wireStartCell = null; this.commitAction('添加连线'); return; } } this.ui.wireStartCell = null; this.notify(); } } }
    toggleLayerVisibility(layerName) { this.ui.layerVisibility[layerName] = !this.ui.layerVisibility[layerName]; this.notify(); }
    selectCells(cellIds) { this.ui.selectedCells = cellIds; this.notify(); }
    clearSelection() { this.ui.selectedCells = []; this.notify(); }
    setTool(tool) { this.ui.currentTool = tool; this.ui.wireStartCell = null; this.notify(); }
    toggleSnap() { this.ui.isSnapping = !this.ui.isSnapping; this.notify(); }
    toggleViewMode() { this.ui.viewMode = this.ui.viewMode === 'front' ? 'back' : 'front'; this.ui.wireStartCell = null; this.notify(); }
    notify() { this.saveToLocal(); eventBus.emit('state:changed', { doc: this.doc, ui: this.ui, history: this.history, historyIndex: this.historyIndex }); }
}
export const state = new State();