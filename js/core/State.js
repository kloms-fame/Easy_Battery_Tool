import { eventBus } from './EventBus.js';

class State {
    constructor() {
        this.doc = { cells: [], busbars: [] };
        this.ui = {
            viewMode: 'front',
            currentTool: 'pointer',
            isSnapping: false,
            gridSize: 40,
            cellRadius: 18,
            wireStartCell: null,
            selectedCells: []  // 记录当前选中的电芯ID
        };

        this.idCounters = { cell: 1, busbar: 1 };
        this.history = [];
        this.historyIndex = -1;
        this.clipboard = { cells: [], busbars: [] };
    }

    initEmptyState() { this.commitAction('初始空画布'); }

    commitAction(actionName) {
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        const snapshot = JSON.parse(JSON.stringify({ doc: this.doc, idCounters: this.idCounters }));
        this.history.push({ action: actionName, data: snapshot });
        this.historyIndex++;
        this.notify();
    }

    undo() { if (this.historyIndex > 0) { this.historyIndex--; this.restoreSnapshot(); } }
    redo() { if (this.historyIndex < this.history.length - 1) { this.historyIndex++; this.restoreSnapshot(); } }
    jumpToHistory(index) { if (index >= 0 && index < this.history.length) { this.historyIndex = index; this.restoreSnapshot(); } }

    restoreSnapshot() {
        const snapshot = JSON.parse(JSON.stringify(this.history[this.historyIndex].data));
        this.doc = snapshot.doc; this.idCounters = snapshot.idCounters;
        this.ui.wireStartCell = null; this.notify();
    }

    deleteSelected() {
        if (this.ui.selectedCells.length === 0) return;
        this.doc.cells = this.doc.cells.filter(c => !this.ui.selectedCells.includes(c.id));
        this.doc.busbars = this.doc.busbars.filter(b => !this.ui.selectedCells.includes(b.from) && !this.ui.selectedCells.includes(b.to));
        this.ui.selectedCells = [];
        this.commitAction('删除选中项');
    }

    copySelected() {
        if (this.ui.selectedCells.length === 0) return;
        this.clipboard.cells = this.doc.cells.filter(c => this.ui.selectedCells.includes(c.id)).map(c => ({ ...c }));
        this.clipboard.busbars = this.doc.busbars.filter(b => this.ui.selectedCells.includes(b.from) && this.ui.selectedCells.includes(b.to)).map(b => ({ ...b }));
    }

    pasteSelected() {
        if (this.clipboard.cells.length === 0) return;
        let idMapping = {};
        let newSelectedIds = [];
        const offset = this.ui.gridSize;

        this.clipboard.cells.forEach(c => {
            let newId = `C${this.idCounters.cell++}`;
            idMapping[c.id] = newId; newSelectedIds.push(newId);
            this.doc.cells.push({ id: newId, cx: c.cx + offset, cy: c.cy + offset, polarity: c.polarity });
            c.cx += offset; c.cy += offset;
        });

        this.clipboard.busbars.forEach(b => {
            this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: idMapping[b.from], to: idMapping[b.to] });
        });

        this.ui.selectedCells = newSelectedIds;
        this.commitAction('粘贴');
    }

    addCell(x, y) { this.doc.cells.push({ id: `C${this.idCounters.cell++}`, cx: x, cy: y, polarity: 'positive' }); this.commitAction('添加电芯'); }

    generateGrid(rows, cols, stageWidth, stageHeight) {
        this.doc.cells = []; this.doc.busbars = []; this.idCounters = { cell: 1, busbar: 1 }; this.ui.wireStartCell = null;
        const startX = stageWidth / 2 - (cols * this.ui.gridSize) / 2 + this.ui.cellRadius;
        const startY = stageHeight / 2 - (rows * this.ui.gridSize) / 2 + this.ui.cellRadius;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.doc.cells.push({ id: `C${this.idCounters.cell++}`, cx: startX + c * this.ui.gridSize, cy: startY + r * this.ui.gridSize, polarity: 'positive' });
            }
        }
        this.commitAction(`生成 ${rows}x${cols} 矩阵`);
    }


    // ==========================================
    // 新增：参数化蜂窝布局算法
    // ==========================================
    generateHoneycomb(s, p, stageWidth, stageHeight) {
        this.doc.cells = []; this.doc.busbars = [];
        this.idCounters = { cell: 1, busbar: 1 };
        this.ui.wireStartCell = null;
        this.clearSelection();

        // 蜂窝布局的核心数学参数：行高是网格大小的 √3 / 2 倍 (约 0.866)
        const rowHeight = this.ui.gridSize * (Math.sqrt(3) / 2);

        // 计算整体电池组的宽高，用于居中
        const totalWidth = (p - 1) * this.ui.gridSize + (this.ui.gridSize / 2); // 加上错位的半个网格
        const totalHeight = (s - 1) * rowHeight;

        const startX = stageWidth / 2 - totalWidth / 2;
        const startY = stageHeight / 2 - totalHeight / 2;

        for (let r = 0; r < s; r++) {
            // 专业细节：每一行是一个并联组(P)，所有电芯极性相同。
            // 为了串联(S)方便，相邻行的极性自动交替翻转！
            const polarity = (r % 2 === 0) ? 'positive' : 'negative';

            // 错位逻辑：奇数行向右偏移半个网格身位
            const offsetX = (r % 2 === 1) ? (this.ui.gridSize / 2) : 0;

            for (let c = 0; c < p; c++) {
                this.doc.cells.push({
                    id: `C${this.idCounters.cell++}`,
                    cx: startX + c * this.ui.gridSize + offsetX,
                    cy: startY + r * rowHeight,
                    polarity: polarity
                });
            }
        }
        this.commitAction(`生成 ${s}S${p}P 蜂窝组`);
    }

    clearAll() { this.doc.cells = []; this.doc.busbars = []; this.idCounters = { cell: 1, busbar: 1 }; this.ui.wireStartCell = null; this.commitAction('清空画布'); }

    removeBusbar(index) {
        if (this.ui.currentTool === 'pointer') { this.doc.busbars.splice(index, 1); this.commitAction('删除连线'); }
    }

    // ✅ 核心交互升级：加入 isMultiSelect 参数
    handleCellClick(id, isMultiSelect = false) {
        if (this.ui.currentTool === 'pointer') {
            if (isMultiSelect) {
                // 如果按住了 Ctrl，包含则移除，不包含则加入 (Toggle)
                if (this.ui.selectedCells.includes(id)) {
                    this.ui.selectedCells = this.ui.selectedCells.filter(c => c !== id);
                } else {
                    this.ui.selectedCells.push(id);
                }
            } else {
                // 没有按Ctrl，则单选当前电芯
                this.ui.selectedCells = [id];
            }
            this.notify();
        }
        else if (this.ui.currentTool === 'polarity') {
            const cell = this.doc.cells.find(c => c.id === id);
            if (cell) cell.polarity = cell.polarity === 'positive' ? 'negative' : 'positive';
            this.commitAction('翻转电芯极性');
        }
        else if (this.ui.currentTool === 'wire') {
            if (!this.ui.wireStartCell) {
                this.ui.wireStartCell = id; this.notify();
            } else {
                if (this.ui.wireStartCell !== id) {
                    const exists = this.doc.busbars.some(b => (b.from === this.ui.wireStartCell && b.to === id) || (b.from === id && b.to === this.ui.wireStartCell));
                    if (!exists) {
                        this.doc.busbars.push({ id: `B${this.idCounters.busbar++}`, from: this.ui.wireStartCell, to: id });
                        this.ui.wireStartCell = null; this.commitAction('添加连线'); return;
                    }
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

    // ==========================================
    // 新增：文件与本地存储系统
    // ==========================================

    // 1. 导出为 JSON 文件下载
    exportProject() {
        // 只导出核心文档数据和计数器，不需要导出 UI 视角等状态
        const dataStr = JSON.stringify({ doc: this.doc, idCounters: this.idCounters }, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // 生成带有时间戳的默认文件名
        const time = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `Pack_Architect_${time}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // 2. 从 JSON 字符串解析并导入
    importProject(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            if (data.doc && data.doc.cells && data.idCounters) {
                this.doc = data.doc;
                this.idCounters = data.idCounters;
                this.clearSelection(); // 导入后清空选择
                this.commitAction('导入 JSON 项目');
                return true;
            }
        } catch (e) {
            console.error("JSON 解析失败:", e);
        }
        return false;
    }

    // 3. 自动保存到浏览器本地 (LocalStorage)
    saveToLocal() {
        const dataStr = JSON.stringify({ doc: this.doc, idCounters: this.idCounters });
        localStorage.setItem('packArchitectProject_V3', dataStr);
    }

    // 4. 启动时从浏览器本地恢复
    loadFromLocal() {
        const dataStr = localStorage.getItem('packArchitectProject_V3');
        if (dataStr) {
            try {
                const data = JSON.parse(dataStr);
                this.doc = data.doc;
                this.idCounters = data.idCounters;
                return true;
            } catch (e) { return false; }
        }
        return false;
    }

    notify() {
        this.saveToLocal(); // 🔥 每次状态改变，自动将最新数据写入浏览器本地缓存！
        eventBus.emit('state:changed', { doc: this.doc, ui: this.ui, history: this.history, historyIndex: this.historyIndex });
    }
}

export const state = new State();