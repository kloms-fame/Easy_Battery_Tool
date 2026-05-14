import { eventBus } from './EventBus.js';

class State {
    constructor() {
        this.doc = { cells: [], busbars: [] };
        this.ui = { viewMode: 'front', currentTool: 'pointer', isSnapping: false, gridSize: 40, cellRadius: 18, wireStartCell: null, selectedCells: [] };
        this.idCounters = { cell: 1, busbar: 1 };
        this.history = []; this.historyIndex = -1;
        this.clipboard = { cells: [], busbars: [] };
    }

    initEmptyState() { this.commitAction('初始空画布'); }
    commitAction(actionName) {
        if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ action: actionName, data: JSON.parse(JSON.stringify({ doc: this.doc, idCounters: this.idCounters })) });
        this.historyIndex++; this.notify();
    }
    undo() { if (this.historyIndex > 0) { this.historyIndex--; this.restoreSnapshot(); } }
    redo() { if (this.historyIndex < this.history.length - 1) { this.historyIndex++; this.restoreSnapshot(); } }
    restoreSnapshot() { const snapshot = JSON.parse(JSON.stringify(this.history[this.historyIndex].data)); this.doc = snapshot.doc; this.idCounters = snapshot.idCounters; this.ui.wireStartCell = null; this.notify(); }

    exportProject() {
        const dataStr = JSON.stringify({ doc: this.doc, idCounters: this.idCounters }, null, 2);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([dataStr], { type: "application/json" }));
        a.download = `Pack_Architect_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`; a.click();
    }
    importProject(jsonData) {
        try { const data = JSON.parse(jsonData); if (data.doc && data.idCounters) { this.doc = data.doc; this.idCounters = data.idCounters; this.clearSelection(); this.commitAction('导入项目'); return true; } } catch (e) { console.error(e); } return false;
    }
    saveToLocal() { localStorage.setItem('packArchitectProject_V3', JSON.stringify({ doc: this.doc, idCounters: this.idCounters })); }
    loadFromLocal() {
        const dataStr = localStorage.getItem('packArchitectProject_V3');
        if (dataStr) { try { const data = JSON.parse(dataStr); this.doc = data.doc; this.idCounters = data.idCounters; return true; } catch (e) { return false; } } return false;
    }

    // ================= 高级锁定与操作 =================
    toggleLockSelected() {
        if (this.ui.selectedCells.length === 0) return;
        const allLocked = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).every(c => c.isLocked);
        this.doc.cells.forEach(c => { if (this.ui.selectedCells.includes(c.id)) c.isLocked = !allLocked; });
        this.commitAction(allLocked ? '解锁电芯' : '锁定电芯');
    }

    deleteSelected() {
        if (this.ui.selectedCells.length === 0) return;
        const cellsToDelete = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id) && !c.isLocked).map(c => c.id);
        if (cellsToDelete.length === 0) return; // 全是锁定的，啥也删不掉
        this.doc.cells = this.doc.cells.filter(c => !cellsToDelete.includes(c.id));
        this.doc.busbars = this.doc.busbars.filter(b => !cellsToDelete.includes(b.from) && !cellsToDelete.includes(b.to));
        this.ui.selectedCells = this.ui.selectedCells.filter(id => !cellsToDelete.includes(id));
        this.commitAction('删除选中项');
    }

    copySelected() {
        this.clipboard.cells = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).map(c => ({ ...c }));
        this.clipboard.busbars = this.doc.busbars.filter(b => this.ui.selectedCells.includes(b.from) && this.ui.selectedCells.includes(b.to)).map(b => ({ ...b }));
    }
    pasteSelected() {
        if (this.clipboard.cells.length === 0) return;
        let idMapping = {}; let newSelectedIds = []; const offset = this.ui.gridSize;
        this.clipboard.cells.forEach(c => {
            let newId = `C${this.idCounters.cell++}`; idMapping[c.id] = newId; newSelectedIds.push(newId);
            this.doc.cells.push({ id: newId, cx: c.cx + offset, cy: c.cy + offset, polarity: c.polarity, isLocked: false });
            c.cx += offset; c.cy += offset;
        });
        this.clipboard.busbars.forEach(b => { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: idMapping[b.from], to: idMapping[b.to] }); });
        this.ui.selectedCells = newSelectedIds; this.commitAction('粘贴');
    }

    addCell(x, y) { this.doc.cells.push({ id: `C${this.idCounters.cell++}`, cx: x, cy: y, polarity: 'positive', isLocked: false }); this.commitAction('添加电芯'); }
    clearAll() { this.doc.cells = []; this.doc.busbars = []; this.idCounters = { cell: 1, busbar: 1 }; this.ui.wireStartCell = null; this.commitAction('清空画布'); }
    removeBusbar(index) { if (this.ui.currentTool === 'pointer') { this.doc.busbars.splice(index, 1); this.commitAction('删除连线'); } }

    // ================= 追加生成引擎 (多预设) =================
    generateLayout(type, s, p, centerX, centerY) {
        let newIds = [];
        const hexStep = this.ui.gridSize * (Math.sqrt(3) / 2);
        const rowHeight = type === 'matrix' ? this.ui.gridSize : hexStep;
        const colWidth = type === 'fishscale' ? hexStep : this.ui.gridSize;

        // 基于传入的视觉中心计算起点
        const startX = centerX - (p * colWidth) / 2;
        const startY = centerY - (s * rowHeight) / 2;

        for (let r = 0; r < s; r++) {
            const polarity = (r % 2 === 0) ? 'positive' : 'negative';
            for (let c = 0; c < p; c++) {
                let offsetX = 0; let offsetY = 0;
                if (type === 'honeycomb') offsetX = (r % 2 === 1) ? (this.ui.gridSize / 2) : 0;
                if (type === 'fishscale') offsetY = (c % 2 === 1) ? (this.ui.gridSize / 2) : 0;

                const id = `C${this.idCounters.cell++}`;
                this.doc.cells.push({ id, cx: startX + c * colWidth + offsetX, cy: startY + r * rowHeight + offsetY, polarity: polarity, isLocked: false });
                newIds.push(id);
            }
        }
        this.ui.selectedCells = newIds; // 追加生成后自动选中
        this.ui.currentTool = 'pointer'; // 切回指针，方便立刻拖走
        this.commitAction(`追加生成 ${s}S${p}P ${type}`);
    }

    handleCellClick(id, isMultiSelect = false) {
        const cell = this.doc.cells.find(c => c.id === id);
        if (!cell) return;

        if (this.ui.currentTool === 'pointer') {
            if (isMultiSelect) {
                if (this.ui.selectedCells.includes(id)) this.ui.selectedCells = this.ui.selectedCells.filter(c => c !== id);
                else this.ui.selectedCells.push(id);
            } else { this.ui.selectedCells = [id]; }
            this.notify();
        }
        else if (this.ui.currentTool === 'polarity' && !cell.isLocked) {
            cell.polarity = cell.polarity === 'positive' ? 'negative' : 'positive'; this.commitAction('翻转极性');
        }
        else if (this.ui.currentTool === 'wire') {
            if (!this.ui.wireStartCell) { this.ui.wireStartCell = id; this.notify(); }
            else {
                if (this.ui.wireStartCell !== id) {
                    const exists = this.doc.busbars.some(b => (b.from === this.ui.wireStartCell && b.to === id) || (b.from === id && b.to === this.ui.wireStartCell));
                    if (!exists) { this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: this.ui.wireStartCell, to: id }); this.ui.wireStartCell = null; this.commitAction('添加连线'); return; }
                }
                this.ui.wireStartCell = null; this.notify();
            }
        }
    }

    selectCells(cellIds) { this.ui.selectedCells = cellIds; this.notify(); }
    clearSelection() { this.ui.selectedCells = []; this.notify(); }
    setTool(tool) { this.ui.currentTool = tool; this.ui.wireStartCell = null; this.notify(); }
    toggleSnap() { this.ui.isSnapping = !this.ui.isSnapping; this.notify(); }
    toggleViewMode() { this.ui.viewMode = this.ui.viewMode === 'front' ? 'back' : 'front'; this.ui.wireStartCell = null; this.notify(); }
    notify() { this.saveToLocal(); eventBus.emit('state:changed', { doc: this.doc, ui: this.ui, history: this.history, historyIndex: this.historyIndex }); }
}
export const state = new State();