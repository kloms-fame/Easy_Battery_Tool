import { eventBus } from './EventBus.js';
import { state } from './State.js';

export class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.stage = new Konva.Stage({ container: containerId, width: this.container.clientWidth, height: this.container.clientHeight });
        this.layers = { busbar: new Konva.Layer(), cell: new Konva.Layer(), ui: new Konva.Layer() };
        this.stage.add(this.layers.busbar, this.layers.cell, this.layers.ui);

        this.selectionRect = new Konva.Rect({ fill: 'rgba(56, 189, 248, 0.2)', stroke: '#38bdf8', strokeWidth: 1, visible: false });
        this.lassoLine = new Konva.Line({ stroke: '#38bdf8', strokeWidth: 2, fill: 'rgba(56, 189, 248, 0.2)', closed: true, visible: false, tension: 0 });
        this.layers.ui.add(this.selectionRect, this.lassoLine);
        this.isSelecting = false; this.selectionStartPos = { x: 0, y: 0 }; this.lassoPoints = [];

        this.bindSystemEvents();
        eventBus.on('state:changed', ({ doc, ui }) => this.renderAll(doc, ui));
    }

    bindSystemEvents() {
        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();
            const oldScale = this.stage.scaleX(); const pointer = this.stage.getPointerPosition();
            const mousePointTo = { x: (pointer.x - this.stage.x()) / oldScale, y: (pointer.y - this.stage.y()) / oldScale };
            let newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            this.stage.scale({ x: newScale, y: newScale });
            this.stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
        });

        this.stage.on('mousedown', (e) => {
            const tool = state.ui.currentTool;
            // ✅ 终极平移逻辑：右键、中键、或者使用了专属的抓手(pan)工具、或者在指针模式点在了空白处 —— 全局平移画布！
            if (e.evt.button === 1 || e.evt.button === 2 || tool === 'pan' || (tool === 'pointer' && e.target === this.stage)) {
                this.stage.draggable(true); return;
            }

            if ((tool !== 'select-box' && tool !== 'select-lasso') || e.target !== this.stage) return;

            this.isSelecting = true;
            this.selectionStartPos = this.stage.getRelativePointerPosition();
            if (tool === 'select-box') {
                this.selectionRect.position(this.selectionStartPos); this.selectionRect.width(0); this.selectionRect.height(0); this.selectionRect.visible(true);
            } else if (tool === 'select-lasso') {
                this.lassoPoints = [this.selectionStartPos.x, this.selectionStartPos.y]; this.lassoLine.points(this.lassoPoints); this.lassoLine.visible(true);
            }
            if (!e.evt.ctrlKey && !e.evt.metaKey && !e.evt.shiftKey) state.clearSelection();
        });

        this.stage.on('click', (e) => {
            if (state.ui.currentTool === 'pointer' && e.target === this.stage) state.clearSelection();
        });

        this.stage.on('mousemove', () => {
            if (!this.isSelecting) return;
            const pos = this.stage.getRelativePointerPosition();
            if (state.ui.currentTool === 'select-box') { this.selectionRect.width(pos.x - this.selectionStartPos.x); this.selectionRect.height(pos.y - this.selectionStartPos.y); }
            else if (state.ui.currentTool === 'select-lasso') { this.lassoPoints.push(pos.x, pos.y); this.lassoLine.points(this.lassoPoints); }
        });

        this.stage.on('mouseup', (e) => {
            this.stage.draggable(false);
            if (!this.isSelecting) return;
            this.isSelecting = false;
            let newlySelectedIds = [];
            const tool = state.ui.currentTool;

            if (tool === 'select-box') {
                this.selectionRect.visible(false); const box = this.selectionRect.getClientRect();
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    const absX = renderX * this.stage.scaleX() + this.stage.x(); const absY = cell.cy * this.stage.scaleY() + this.stage.y();
                    if (!cell.isLocked && Konva.Util.haveIntersection(box, { x: absX, y: absY, width: 1, height: 1 })) newlySelectedIds.push(cell.id);
                });
            } else if (tool === 'select-lasso') {
                this.lassoLine.visible(false);
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    if (!cell.isLocked && this.isPointInPolygon(renderX, cell.cy, this.lassoPoints)) newlySelectedIds.push(cell.id);
                });
            }
            if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) state.selectCells(Array.from(new Set([...state.ui.selectedCells, ...newlySelectedIds])));
            else state.selectCells(newlySelectedIds);
        });

        this.container.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => { this.stage.width(this.container.clientWidth); this.stage.height(this.container.clientHeight); state.notify(); });
    }

    isPointInPolygon(x, y, points) {
        let inside = false;
        for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
            let intersect = ((points[i + 1] > y) !== (points[j + 1] > y)) && (x < (points[j] - points[i]) * (y - points[i + 1]) / (points[j + 1] - points[i + 1]) + points[i]);
            if (intersect) inside = !inside;
        } return inside;
    }

    renderAll(doc, ui) {
        this.renderBusbars(doc, ui); this.renderCells(doc, ui);
        const cellEl = document.getElementById('cell-count'); const wireEl = document.getElementById('wire-count');
        if (cellEl) cellEl.innerText = doc.cells.length; if (wireEl) wireEl.innerText = doc.busbars.length;
    }

    renderBusbars(doc, ui) {
        this.layers.busbar.destroyChildren();
        doc.busbars.forEach((bar, index) => {
            const cell1 = doc.cells.find(c => c.id === bar.from); const cell2 = doc.cells.find(c => c.id === bar.to);
            if (!cell1 || !cell2) return;
            let x1 = ui.viewMode === 'back' ? this.stage.width() - cell1.cx : cell1.cx; let x2 = ui.viewMode === 'back' ? this.stage.width() - cell2.cx : cell2.cx;
            const line = new Konva.Line({ points: [x1, cell1.cy, x2, cell2.cy], stroke: '#fbbf24', strokeWidth: 12, lineCap: 'round', lineJoin: 'round', shadowColor: '#000', shadowBlur: 4, shadowOffset: { x: 2, y: 2 }, shadowOpacity: 0.5 });
            line.on('dblclick', () => state.removeBusbar(index)); this.layers.busbar.add(line);
        });
        this.layers.busbar.draw();
    }

    renderCells(doc, ui) {
        this.layers.cell.destroyChildren();
        doc.cells.forEach(cell => {
            let renderX = ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
            let displayPolarity = ui.viewMode === 'back' ? (cell.polarity === 'positive' ? 'negative' : 'positive') : cell.polarity;
            const isSelected = ui.selectedCells.includes(cell.id);

            const cellGroup = new Konva.Group({
                x: renderX, y: cell.cy, id: cell.id,
                draggable: ui.currentTool === 'pointer' && !cell.isLocked
            });

            cellGroup.on('dragstart', (e) => {
                if (!ui.selectedCells.includes(cell.id)) {
                    if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) state.selectCells([...ui.selectedCells, cell.id]);
                    else state.selectCells([cell.id]);
                }
                this.dragStartPositions = {};
                doc.cells.forEach(c => { if (ui.selectedCells.includes(c.id)) this.dragStartPositions[c.id] = { cx: c.cx, cy: c.cy }; });
            });

            cellGroup.on('dragmove', (e) => {
                if (ui.isSnapping) { const snap = ui.gridSize / 2; e.target.x(Math.round(e.target.x() / snap) * snap); e.target.y(Math.round(e.target.y() / snap) * snap); }
                let newX = e.target.x(); let dx = (ui.viewMode === 'back' ? this.stage.width() - newX : newX) - this.dragStartPositions[cell.id].cx;
                let dy = e.target.y() - this.dragStartPositions[cell.id].cy;
                doc.cells.forEach(c => {
                    if (ui.selectedCells.includes(c.id) && !c.isLocked) {
                        c.cx = this.dragStartPositions[c.id].cx + dx; c.cy = this.dragStartPositions[c.id].cy + dy;
                        if (c.id !== cell.id) {
                            let node = this.layers.cell.findOne(`#${c.id}`);
                            if (node) { node.x(ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx); node.y(c.cy); }
                        }
                    }
                });
                this.renderBusbars(doc, ui);
            });
            cellGroup.on('dragend', () => state.commitAction(ui.selectedCells.length > 1 ? '批量移动' : '移动电芯'));
            cellGroup.on('click', (e) => { if (e.evt.detail === 1 && ui.currentTool !== 'pan') state.handleCellClick(cell.id, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey); });

            // 视觉发光与基础外壳
            if (isSelected) cellGroup.add(new Konva.Circle({ radius: ui.cellRadius + 6, fill: 'rgba(56, 189, 248, 0.3)', stroke: '#38bdf8', strokeWidth: 2 }));
            const strokeColor = cell.isLocked ? '#475569' : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? '#fbbf24' : (displayPolarity === 'positive' ? '#ef4444' : '#3b82f6'));
            cellGroup.add(new Konva.Circle({ radius: ui.cellRadius, fill: displayPolarity === 'positive' ? '#1e293b' : '#334155', stroke: strokeColor, strokeWidth: cell.isLocked ? 2 : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? 4 : 2), opacity: cell.isLocked ? 0.7 : 1 }));

            // 极性符号 (缩小稍微向上移动，给文字留空间)
            cellGroup.add(new Konva.Text({ text: displayPolarity === 'positive' ? '+' : '-', fontSize: 18, fontStyle: 'bold', fill: strokeColor, align: 'center', verticalAlign: 'middle', x: -ui.cellRadius, y: -ui.cellRadius - 2, width: ui.cellRadius * 2, height: ui.cellRadius * 2, opacity: cell.isLocked ? 0.5 : 1 }));

            // ================= 新增：图元编号与属性铭牌 =================
            let labelText = cell.id;
            if (cell.voltage || cell.resistance) {
                if (cell.voltage) labelText += `\n${cell.voltage}V`;
                if (cell.resistance) labelText += `\n${cell.resistance}mΩ`;
            }

            cellGroup.add(new Konva.Text({
                text: labelText,
                fontSize: 9,
                fill: '#94a3b8',
                align: 'center',
                x: -ui.cellRadius * 2,
                y: ui.cellRadius + 2,
                width: ui.cellRadius * 4,
                lineHeight: 1.1
            }));

            if (cell.isLocked) cellGroup.add(new Konva.Text({ text: '🔒', fontSize: 12, x: ui.cellRadius - 10, y: -ui.cellRadius }));
            this.layers.cell.add(cellGroup);
        });

        // 鼠标光标控制
        if (ui.currentTool === 'pan') this.container.style.cursor = 'grab';
        else if (ui.currentTool === 'wire' || ui.currentTool.includes('select')) this.container.style.cursor = 'crosshair';
        else this.container.style.cursor = 'default';

        this.layers.cell.draw();
    }
}