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

        this.isSelecting = false;
        this.selectionStartPos = { x: 0, y: 0 };
        this.lassoPoints = [];

        this.bindSystemEvents();
        eventBus.on('state:changed', ({ doc, ui }) => this.renderAll(doc, ui));
    }

    bindSystemEvents() {
        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();
            const scaleBy = 1.1; const oldScale = this.stage.scaleX(); const pointer = this.stage.getPointerPosition();
            const mousePointTo = { x: (pointer.x - this.stage.x()) / oldScale, y: (pointer.y - this.stage.y()) / oldScale };
            let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            this.stage.scale({ x: newScale, y: newScale });
            this.stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
        });

        this.stage.on('mousedown', (e) => {
            if (e.evt.button === 1 || e.evt.button === 2 || (state.ui.currentTool === 'pointer' && e.target === this.stage)) {
                this.stage.draggable(true); return;
            }

            const tool = state.ui.currentTool;
            if ((tool !== 'select-box' && tool !== 'select-lasso') || e.target !== this.stage) return;

            this.isSelecting = true;
            const pos = this.stage.getRelativePointerPosition();
            this.selectionStartPos = pos;

            if (tool === 'select-box') {
                this.selectionRect.position(pos); this.selectionRect.width(0); this.selectionRect.height(0); this.selectionRect.visible(true);
            } else if (tool === 'select-lasso') {
                this.lassoPoints = [pos.x, pos.y]; this.lassoLine.points(this.lassoPoints); this.lassoLine.visible(true);
            }

            // ✅ 如果没有按住 Ctrl/Shift，则在画新框时清空旧选择
            if (!e.evt.ctrlKey && !e.evt.metaKey && !e.evt.shiftKey) {
                state.clearSelection();
            }
        });

        this.stage.on('click', (e) => {
            if (state.ui.currentTool === 'pointer' && e.target === this.stage) {
                state.clearSelection();
            }
        });

        this.stage.on('mousemove', () => {
            if (!this.isSelecting) return;
            const pos = this.stage.getRelativePointerPosition();
            if (state.ui.currentTool === 'select-box') {
                this.selectionRect.width(pos.x - this.selectionStartPos.x); this.selectionRect.height(pos.y - this.selectionStartPos.y);
            } else if (state.ui.currentTool === 'select-lasso') {
                this.lassoPoints.push(pos.x, pos.y); this.lassoLine.points(this.lassoPoints);
            }
        });

        this.stage.on('mouseup', (e) => {
            this.stage.draggable(false);
            if (!this.isSelecting) return;
            this.isSelecting = false;

            let newlySelectedIds = [];
            const tool = state.ui.currentTool;

            if (tool === 'select-box') {
                this.selectionRect.visible(false);
                const box = this.selectionRect.getClientRect();
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    const absoluteX = renderX * this.stage.scaleX() + this.stage.x();
                    const absoluteY = cell.cy * this.stage.scaleY() + this.stage.y();
                    if (Konva.Util.haveIntersection(box, { x: absoluteX, y: absoluteY, width: 1, height: 1 })) newlySelectedIds.push(cell.id);
                });
            } else if (tool === 'select-lasso') {
                this.lassoLine.visible(false);
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    if (this.isPointInPolygon(renderX, cell.cy, this.lassoPoints)) newlySelectedIds.push(cell.id);
                });
            }

            // ✅ 如果按住了 Ctrl/Shift，把新选中的和之前选中的合并去重
            const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey;
            if (isMultiSelect) {
                const combined = new Set([...state.ui.selectedCells, ...newlySelectedIds]);
                state.selectCells(Array.from(combined));
            } else {
                state.selectCells(newlySelectedIds);
            }
        });

        this.container.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => { this.stage.width(this.container.clientWidth); this.stage.height(this.container.clientHeight); state.notify(); });
    }

    isPointInPolygon(x, y, pointsArray) {
        let inside = false;
        for (let i = 0, j = pointsArray.length - 2; i < pointsArray.length; j = i, i += 2) {
            let xi = pointsArray[i], yi = pointsArray[i + 1], xj = pointsArray[j], yj = pointsArray[j + 1];
            let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
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
            let x1 = ui.viewMode === 'back' ? this.stage.width() - cell1.cx : cell1.cx;
            let x2 = ui.viewMode === 'back' ? this.stage.width() - cell2.cx : cell2.cx;
            const line = new Konva.Line({ points: [x1, cell1.cy, x2, cell2.cy], stroke: '#fbbf24', strokeWidth: 12, lineCap: 'round', lineJoin: 'round', shadowColor: '#000', shadowBlur: 4, shadowOffset: { x: 2, y: 2 }, shadowOpacity: 0.5 });
            line.on('dblclick', () => state.removeBusbar(index));
            this.layers.busbar.add(line);
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
                draggable: ui.currentTool === 'pointer'
            });

            // ✅ 核心交互升级：群组多选拖拽的数学逻辑
            cellGroup.on('dragstart', (e) => {
                // 如果拖拽的是一个没被选中的电芯，优先选中它（结合按键判断加选/单选）
                if (!ui.selectedCells.includes(cell.id)) {
                    const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey;
                    if (isMultiSelect) {
                        state.selectCells([...ui.selectedCells, cell.id]);
                    } else {
                        state.selectCells([cell.id]);
                    }
                }

                // 记录【所有被选中电芯】的起跑线位置
                this.dragStartPositions = {};
                state.doc.cells.forEach(c => {
                    if (state.ui.selectedCells.includes(c.id)) {
                        this.dragStartPositions[c.id] = { cx: c.cx, cy: c.cy };
                    }
                });
            });

            cellGroup.on('dragmove', (e) => {
                if (ui.isSnapping) {
                    const snap = ui.gridSize / 2; e.target.x(Math.round(e.target.x() / snap) * snap); e.target.y(Math.round(e.target.y() / snap) * snap);
                }

                // 算出当前鼠标抓着的这个电芯位移了多少 (Delta X/Y)
                let newX = e.target.x();
                let rawCx = ui.viewMode === 'back' ? this.stage.width() - newX : newX;
                let dx = rawCx - this.dragStartPositions[cell.id].cx;
                let dy = e.target.y() - this.dragStartPositions[cell.id].cy;

                // 把这个位移量(Delta)公平地发给每一个被选中的同伴
                state.doc.cells.forEach(c => {
                    if (state.ui.selectedCells.includes(c.id)) {
                        c.cx = this.dragStartPositions[c.id].cx + dx;
                        c.cy = this.dragStartPositions[c.id].cy + dy;

                        // 叫其他同伴在画布上也跟着移动（主控电芯自带移动，所以排除自己）
                        if (c.id !== cell.id) {
                            let node = this.layers.cell.findOne(`#${c.id}`);
                            if (node) {
                                let renderCx = ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx;
                                node.x(renderCx); node.y(c.cy);
                            }
                        }
                    }
                });
                this.renderBusbars(doc, ui); // 实时更新跟着它们的线
            });

            cellGroup.on('dragend', () => state.commitAction(ui.selectedCells.length > 1 ? '批量移动' : '移动电芯'));

            // 点击事件检测
            cellGroup.on('click', (e) => {
                if (e.evt.detail === 1) {
                    const isMultiSelect = e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey;
                    state.handleCellClick(cell.id, isMultiSelect);
                }
            });

            // 视觉高亮渲染
            const isWireTarget = (ui.currentTool === 'wire' && ui.wireStartCell === cell.id);
            if (isSelected) {
                cellGroup.add(new Konva.Circle({ radius: ui.cellRadius + 6, fill: 'rgba(56, 189, 248, 0.3)', stroke: '#38bdf8', strokeWidth: 2 }));
            }
            cellGroup.add(new Konva.Circle({ radius: ui.cellRadius, fill: displayPolarity === 'positive' ? '#1e293b' : '#334155', stroke: isWireTarget ? '#fbbf24' : (displayPolarity === 'positive' ? '#ef4444' : '#3b82f6'), strokeWidth: isWireTarget ? 4 : 2 }));
            cellGroup.add(new Konva.Text({ text: displayPolarity === 'positive' ? '+' : '-', fontSize: 22, fontStyle: 'bold', fill: displayPolarity === 'positive' ? '#ef4444' : '#3b82f6', align: 'center', verticalAlign: 'middle', x: -ui.cellRadius, y: -ui.cellRadius + 2, width: ui.cellRadius * 2, height: ui.cellRadius * 2 }));
            this.layers.cell.add(cellGroup);
        });

        if (ui.currentTool === 'wire') this.container.style.cursor = 'crosshair';
        else if (ui.currentTool.includes('select')) this.container.style.cursor = 'crosshair';
        else this.container.style.cursor = 'default';
        this.layers.cell.draw();
    }
}