import { eventBus } from './EventBus.js';
import { TopologyEngine } from './TopologyEngine.js'; // 🌟 新增导入
class State {
    constructor() {
        this.doc = { cells: [], busbars: [] };
        this.ui = { viewMode: 'front', currentTool: 'pointer', isSnapping: false, gridSize: 40, cellRadius: 18, wireStartCell: null, selectedCells: [], layerVisibility: { cell: true, busbar: true, labels: true, ui: true } };
        this.idCounters = { cell: 1, busbar: 1 };
        this.history = []; this.historyIndex = -1; this.clipboard = { cells: [], busbars: [] };

        this.peer = null;
        this.myPeerId = null;
        this.connections = [];
        this.connectedPeers = [];
    }

    initEmptyState() { this.commitAction('初始空画布'); }

    commitAction(actionName) {
        if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ action: actionName, data: JSON.parse(JSON.stringify({ doc: this.doc, idCounters: this.idCounters })) });
        this.historyIndex++;
        this.notify();
        this.broadcastState();
    }

    undo() { if (this.historyIndex > 0) { this.historyIndex--; this.restoreSnapshot(); this.broadcastState(); } }
    redo() { if (this.historyIndex < this.history.length - 1) { this.historyIndex++; this.restoreSnapshot(); this.broadcastState(); } }
    restoreSnapshot() { const snapshot = JSON.parse(JSON.stringify(this.history[this.historyIndex].data)); this.doc = snapshot.doc; this.idCounters = snapshot.idCounters; this.ui.wireStartCell = null; this.notify(); }
    exportProject() { const dataStr = JSON.stringify({ doc: this.doc, idCounters: this.idCounters }, null, 2); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([dataStr], { type: "application/json" })); a.download = `Pack_Architect_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`; a.click(); }
    importProject(jsonData) { try { const data = JSON.parse(jsonData); if (data.doc && data.idCounters) { this.doc = data.doc; this.idCounters = data.idCounters; this.clearSelection(); this.commitAction('导入项目'); return true; } } catch (e) { console.error(e); } return false; }
    saveToLocal() { localStorage.setItem('packArchitectProject_V6', JSON.stringify({ doc: this.doc, idCounters: this.idCounters })); }
    loadFromLocal() { const dataStr = localStorage.getItem('packArchitectProject_V6'); if (dataStr) { try { const data = JSON.parse(dataStr); this.doc = data.doc; this.idCounters = data.idCounters; return true; } catch (e) { return false; } } return false; }

    initNetwork() {
        const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.myPeerId = `PACK-${shortId}`;

        // ✅ 核心修复 1：配置多重免费 STUN 服务器矩阵，极大增强手机热点穿透力
        this.peer = new Peer(this.myPeerId, {
            config: {
                'iceServers': [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                    { urls: 'stun:stun.ekiga.net' },
                    { urls: 'stun:stun.ideasip.com' },
                    { urls: 'stun:stun.schlund.de' }
                ]
            },
            debug: 1 // 设置为 1 可以在控制台看到连接状态，不影响用户
        });

        this.peer.on('open', (id) => eventBus.emit('network:ready', id));
        this.peer.on('error', (err) => eventBus.emit('network:error', err));
        this.peer.on('connection', (conn) => eventBus.emit('network:incoming', conn));

        // ✅ 核心修复 2：解决 "network" 报错。信令断开时，静默自动重连
        this.peer.on('disconnected', () => {
            console.warn("[网络引擎] 与信令服务器断开，正在尝试静默重连...");
            if (!this.peer.destroyed) {
                this.peer.reconnect();
            }
        });
    }

    connectToPeer(targetId) {
        if (!this.peer) return;
        const conn = this.peer.connect(targetId, { reliable: true });
        this.setupConnection(conn);
        const handleOpen = () => this.addConnection(conn);
        if (conn.open) handleOpen(); else conn.on('open', handleOpen);
    }

    acceptConnection(conn) {
        this.setupConnection(conn);
        const handleOpen = () => {
            this.addConnection(conn);
            // ✅ 发送全量同步包时，不再包含 viewMode 属性
            conn.send({ type: 'sync_full', doc: this.doc, idCounters: this.idCounters });
        };
        if (conn.open) handleOpen(); else conn.on('open', handleOpen);
    }

    addConnection(conn) {
        if (!this.connections.find(c => c.peer === conn.peer)) {
            this.connections.push(conn);
            this.connectedPeers.push(conn.peer);
            eventBus.emit('network:list_changed', this.connectedPeers);
        }
    }

    removeConnection(peerId) {
        this.connections = this.connections.filter(c => c.peer !== peerId);
        this.connectedPeers = this.connectedPeers.filter(p => p !== peerId);
        eventBus.emit('network:list_changed', this.connectedPeers);
    }

    setupConnection(conn) {
        conn.on('data', (msg) => {
            if (msg.type === 'sync_full') {
                this.doc = msg.doc; this.idCounters = msg.idCounters;
                // ✅ 绝对不再同步对方的 viewMode
                this.clearSelection(); this.notify(); eventBus.emit('network:syncing');
            } else if (msg.type === 'cursor') {
                eventBus.emit('network:cursor', msg);
            } else if (msg.type === 'ghost_move') {
                eventBus.emit('network:ghost_move', msg);
            } else if (msg.type === 'ghost_end') {
                eventBus.emit('network:ghost_end', msg);
            }
        });
        conn.on('close', () => this.removeConnection(conn.peer));
        conn.on('error', () => this.removeConnection(conn.peer));
    }

    broadcastState() {
        if (this.connections.length === 0) return;
        const payload = { type: 'sync_full', doc: this.doc, idCounters: this.idCounters };
        this.connections.forEach(conn => { if (conn.open) conn.send(payload); });
    }

    broadcastCursor(pos) {
        if (this.connections.length === 0) return;
        const payload = { type: 'cursor', peer: this.myPeerId, pos: pos };
        this.connections.forEach(conn => { if (conn.open) conn.send(payload); });
    }

    broadcastGhostMove(cellsData) {
        if (this.connections.length === 0) return;
        const payload = { type: 'ghost_move', peer: this.myPeerId, cells: cellsData };
        this.connections.forEach(conn => { if (conn.open) conn.send(payload); });
    }

    broadcastGhostEnd() {
        if (this.connections.length === 0) return;
        const payload = { type: 'ghost_end', peer: this.myPeerId };
        this.connections.forEach(conn => { if (conn.open) conn.send(payload); });
    }

    disconnectPeer(peerId) {
        const conn = this.connections.find(c => c.peer === peerId);
        if (conn) { conn.close(); }
        this.removeConnection(peerId);
    }

    // ✅ 切换视角时，仅影响本地自己，不再广播给其他连接者
    toggleViewMode() {
        this.ui.viewMode = this.ui.viewMode === 'front' ? 'back' : 'front';
        this.ui.wireStartCell = null;
        this.notify();
    }

    toggleLockSelected() { if (this.ui.selectedCells.length === 0) return; const allLocked = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).every(c => c.isLocked); this.doc.cells.forEach(c => { if (this.ui.selectedCells.includes(c.id)) c.isLocked = !allLocked; }); this.commitAction(allLocked ? '解锁' : '锁定'); }
    deleteSelected() { if (this.ui.selectedCells.length === 0) return; const cellsToDelete = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id) && !c.isLocked).map(c => c.id); if (cellsToDelete.length === 0) return; this.doc.cells = this.doc.cells.filter(c => !cellsToDelete.includes(c.id)); this.doc.busbars = this.doc.busbars.filter(b => !cellsToDelete.includes(b.from) && !cellsToDelete.includes(b.to)); this.ui.selectedCells = this.ui.selectedCells.filter(id => !cellsToDelete.includes(id)); this.commitAction('删除'); }
    copySelected() { this.clipboard.cells = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).map(c => ({ ...c })); this.clipboard.busbars = this.doc.busbars.filter(b => this.ui.selectedCells.includes(b.from) && this.ui.selectedCells.includes(b.to)).map(b => ({ ...b })); }
    pasteSelected() { if (this.clipboard.cells.length === 0) return; let idMapping = {}; let newSelectedIds = []; const offset = this.ui.gridSize; this.clipboard.cells.forEach(c => { let newId = `C${this.idCounters.cell++}`; idMapping[c.id] = newId; newSelectedIds.push(newId); this.doc.cells.push({ id: newId, cx: c.cx + offset, cy: c.cy + offset, polarity: c.polarity, isLocked: false, voltage: c.voltage, resistance: c.resistance }); c.cx += offset; c.cy += offset; }); this.clipboard.busbars.forEach(b => { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: idMapping[b.from], to: idMapping[b.to] }); }); this.ui.selectedCells = newSelectedIds; this.commitAction('粘贴'); }
    updateSelectedProperties(voltage, resistance) { if (this.ui.selectedCells.length === 0) return; this.doc.cells.forEach(c => { if (this.ui.selectedCells.includes(c.id)) { if (voltage !== null) c.voltage = voltage; if (resistance !== null) c.resistance = resistance; } }); this.commitAction('修改属性'); }
    addCell(x, y) { this.doc.cells.push({ id: `C${this.idCounters.cell++}`, cx: x, cy: y, polarity: 'positive', isLocked: false, voltage: '', resistance: '' }); this.commitAction('添加电芯'); }
    clearAll() { this.doc.cells = []; this.doc.busbars = []; this.idCounters = { cell: 1, busbar: 1 }; this.ui.wireStartCell = null; this.commitAction('清空画布'); }
    removeBusbar(index) { if (this.ui.currentTool === 'pointer') { this.doc.busbars.splice(index, 1); this.commitAction('删除连线'); } }
    generateLayout(type, s, p, centerX, centerY) { let newIds = []; const hexStep = this.ui.gridSize * (Math.sqrt(3) / 2); const rowHeight = type === 'matrix' ? this.ui.gridSize : hexStep; const colWidth = type === 'fishscale' ? hexStep : this.ui.gridSize; const startX = centerX - (p * colWidth) / 2; const startY = centerY - (s * rowHeight) / 2; for (let r = 0; r < s; r++) { const polarity = (r % 2 === 0) ? 'positive' : 'negative'; for (let c = 0; c < p; c++) { let offsetX = 0; let offsetY = 0; if (type === 'honeycomb') offsetX = (r % 2 === 1) ? (this.ui.gridSize / 2) : 0; if (type === 'fishscale') offsetY = (c % 2 === 1) ? (this.ui.gridSize / 2) : 0; const id = `C${this.idCounters.cell++}`; this.doc.cells.push({ id, cx: startX + c * colWidth + offsetX, cy: startY + r * rowHeight + offsetY, polarity: polarity, isLocked: false, voltage: '', resistance: '' }); newIds.push(id); } } this.ui.selectedCells = newIds; this.ui.currentTool = 'pointer'; this.commitAction(`生成 ${s}S${p}P`); }
    // 🌟 新增：极速滑动连焊逻辑
    quickConnect(targetId) {
        if (!this.ui.wireStartCell || this.ui.wireStartCell === targetId) return false;

        // 检查当前视角（正面或反面）是否已经存在这条线
        const exists = this.doc.busbars.some(b =>
            ((b.from === this.ui.wireStartCell && b.to === targetId) ||
                (b.from === targetId && b.to === this.ui.wireStartCell)) &&
            b.side === this.ui.viewMode
        );

        if (!exists) {
            this.doc.busbars.push({
                id: `B${this.idCounters.busbar++}`,
                from: this.ui.wireStartCell,
                to: targetId,
                side: this.ui.viewMode // 严格记录属于哪一面
            });
            this.ui.wireStartCell = targetId; // 核心：将终点变成新的起点，准备迎接下一次滑动
            this.commitAction('滑动连线');
            return true;
        }
        return false;
    }
    handleCellClick(id, isMultiSelect = false) { const cell = this.doc.cells.find(c => c.id === id); if (!cell) return; if (this.ui.currentTool === 'pointer') { if (isMultiSelect) { if (this.ui.selectedCells.includes(id)) this.ui.selectedCells = this.ui.selectedCells.filter(c => c !== id); else this.ui.selectedCells.push(id); } else { this.ui.selectedCells = [id]; } this.notify(); } else if (this.ui.currentTool === 'polarity' && !cell.isLocked) { cell.polarity = cell.polarity === 'positive' ? 'negative' : 'positive'; this.commitAction('翻转极性'); } else if (this.ui.currentTool === 'wire') { if (!this.ui.wireStartCell) { this.ui.wireStartCell = id; this.notify(); } else { if (this.ui.wireStartCell !== id) { const exists = this.doc.busbars.some(b => (b.from === this.ui.wireStartCell && b.to === id) || (b.from === id && b.to === this.ui.wireStartCell)); if (!exists) { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: this.ui.wireStartCell, to: id, side: this.ui.viewMode }); this.ui.wireStartCell = null; this.commitAction('添加连线'); return; } } this.ui.wireStartCell = null; this.notify(); } } }
    toggleLayerVisibility(layerName) { this.ui.layerVisibility[layerName] = !this.ui.layerVisibility[layerName]; this.notify(); }
    selectCells(cellIds) { this.ui.selectedCells = cellIds; this.notify(); }
    clearSelection() { this.ui.selectedCells = []; this.notify(); }
    setTool(tool) { this.ui.currentTool = tool; this.ui.wireStartCell = null; this.notify(); }
    toggleSnap() { this.ui.isSnapping = !this.ui.isSnapping; this.notify(); }
    notify() {
        this.saveToLocal();
        this.analysis = TopologyEngine.analyze(this.doc);
        eventBus.emit('state:changed', { doc: this.doc, ui: this.ui, history: this.history, historyIndex: this.historyIndex, analysis: this.analysis });
    }
}
export const state = new State();