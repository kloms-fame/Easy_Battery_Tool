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

        // 测量卡尺工具图元
        this.measureLine = new Konva.Line({ stroke: '#10b981', strokeWidth: 2, dash: [4, 4], visible: false });
        this.measureText = new Konva.Text({ text: '', fontSize: 14, fill: '#10b981', backgroundColor: '#0f172a', padding: 4, cornerRadius: 4, visible: false, fontStyle: 'bold' });

        this.dragTrailGroup = new Konva.Group();
        this.remoteGhostsGroup = new Konva.Group();
        this.layers.ui.add(this.selectionRect, this.lassoLine, this.measureLine, this.measureText, this.dragTrailGroup, this.remoteGhostsGroup);

        this.isSelecting = false; this.selectionStartPos = { x: 0, y: 0 }; this.lassoPoints = [];
        this.isMeasuring = false;
        this.remoteCursors = {};

        this.bindSystemEvents();
        eventBus.on('state:changed', ({ doc, ui }) => this.renderAll(doc, ui));
        eventBus.on('network:cursor', ({ peer, pos }) => this.renderRemoteCursor(peer, pos));
        eventBus.on('network:ghost_move', ({ peer, cells }) => this.renderRemoteGhost(peer, cells));
        eventBus.on('network:ghost_end', ({ peer }) => this.clearRemoteGhost(peer));
    }

    // 替换原本的 bindSystemEvents 方法
    bindSystemEvents() {
        // 1. PC 端滚轮缩放
        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();
            const oldScale = this.stage.scaleX(); const pointer = this.stage.getPointerPosition();
            const mousePointTo = { x: (pointer.x - this.stage.x()) / oldScale, y: (pointer.y - this.stage.y()) / oldScale };
            let newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            this.stage.scale({ x: newScale, y: newScale });
            this.stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
        });

        // ✅ 2. 移动端双指触控算法 (缩放 + 平移)
        let lastCenter = null;
        let lastDist = 0;
        this.stage.on('touchmove', (e) => {
            e.evt.preventDefault(); // 阻止手机浏览器原生滚动
            const touch1 = e.evt.touches[0];
            const touch2 = e.evt.touches[1];

            // 只有检测到两根手指时，才激活缩放与平移
            if (touch1 && touch2) {
                if (this.stage.isDragging()) this.stage.stopDrag(); // 中断可能冲突的单指拖拽

                const p1 = { x: touch1.clientX, y: touch1.clientY };
                const p2 = { x: touch2.clientX, y: touch2.clientY };

                // 计算两指之间的距离
                const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                // 计算两指的中心点
                const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                if (!lastCenter) { lastCenter = center; return; }
                if (!lastDist) { lastDist = dist; return; }

                // ================= 双指平移逻辑 =================
                const dx = center.x - lastCenter.x;
                const dy = center.y - lastCenter.y;
                this.stage.position({ x: this.stage.x() + dx, y: this.stage.y() + dy });

                // ================= 双指缩放逻辑 =================
                const scaleBy = dist / lastDist;
                const oldScale = this.stage.scaleX();
                let newScale = oldScale * scaleBy;

                // 限制缩放极值
                if (newScale < 0.1) newScale = 0.1;
                if (newScale > 10) newScale = 10;

                // 以两指中心点为缩放锚点
                const pointTo = {
                    x: (center.x - this.stage.x()) / oldScale,
                    y: (center.y - this.stage.y()) / oldScale,
                };

                this.stage.scale({ x: newScale, y: newScale });
                this.stage.position({
                    x: center.x - pointTo.x * newScale,
                    y: center.y - pointTo.y * newScale,
                });

                lastDist = dist;
                lastCenter = center;
                this.layers.ui.batchDraw();
            }
        });

        this.stage.on('touchend', () => {
            lastDist = 0;
            lastCenter = null;
        });

        // 3. 鼠标按下/单指触屏 操作逻辑
        this.stage.on('mousedown touchstart', (e) => {
            const tool = state.ui.currentTool;
            // 右键/中键/抓手工具 -> 开启全局平移
            if (e.evt.button === 1 || e.evt.button === 2 || tool === 'pan' || (tool === 'pointer' && e.target === this.stage)) { this.stage.draggable(true); return; }

            this.selectionStartPos = this.stage.getRelativePointerPosition();

            if (tool === 'measure') {
                this.isMeasuring = true;
                this.measureLine.points([this.selectionStartPos.x, this.selectionStartPos.y, this.selectionStartPos.x, this.selectionStartPos.y]);
                this.measureLine.visible(true); this.measureText.visible(true); return;
            }

            if ((tool !== 'select-box' && tool !== 'select-lasso') || e.target !== this.stage) return;
            this.isSelecting = true;
            if (tool === 'select-box') { this.selectionRect.position(this.selectionStartPos); this.selectionRect.width(0); this.selectionRect.height(0); this.selectionRect.visible(true); }
            else if (tool === 'select-lasso') { this.lassoPoints = [this.selectionStartPos.x, this.selectionStartPos.y]; this.lassoLine.points(this.lassoPoints); this.lassoLine.visible(true); }
            if (!e.evt.ctrlKey && !e.evt.metaKey && !e.evt.shiftKey) state.clearSelection();
        });

        // 4. 单击空白处清空选择
        this.stage.on('click tap', (e) => { if (state.ui.currentTool === 'pointer' && e.target === this.stage) state.clearSelection(); });

        // 5. 鼠标/单指滑动逻辑
        let lastCursorTime = 0;
        this.stage.on('pointermove', () => {
            // 如果是双指操作，中止内部工具逻辑
            if (this.stage.getPointerPosition() && this.stage.getPointerPosition().touches && this.stage.getPointerPosition().touches.length > 1) return;

            const pos = this.stage.getRelativePointerPosition();
            if (!pos) return;

            let absoluteX = state.ui.viewMode === 'back' ? this.stage.width() - pos.x : pos.x;
            if (Date.now() - lastCursorTime > 30) {
                state.broadcastCursor({ x: absoluteX, y: pos.y });
                lastCursorTime = Date.now();
            }

            if (this.isMeasuring) {
                this.measureLine.points([this.selectionStartPos.x, this.selectionStartPos.y, pos.x, pos.y]);
                const dx = pos.x - this.selectionStartPos.x; const dy = pos.y - this.selectionStartPos.y;
                const distanceMM = (Math.sqrt(dx * dx + dy * dy) * 0.5).toFixed(1);
                this.measureText.text(`${distanceMM} mm`);
                this.measureText.position({ x: this.selectionStartPos.x + dx / 2 + 10, y: this.selectionStartPos.y + dy / 2 + 10 });
                return;
            }

            if (!this.isSelecting) return;
            if (state.ui.currentTool === 'select-box') { this.selectionRect.width(pos.x - this.selectionStartPos.x); this.selectionRect.height(pos.y - this.selectionStartPos.y); }
            else if (state.ui.currentTool === 'select-lasso') { this.lassoPoints.push(pos.x, pos.y); this.lassoLine.points(this.lassoPoints); }
        });

        // 6. 抬起逻辑
        this.stage.on('mouseup touchend', (e) => {
            this.stage.draggable(false);
            if (this.isMeasuring) { this.isMeasuring = false; this.measureLine.visible(false); this.measureText.visible(false); return; }

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
            if (e.evt && (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey)) state.selectCells(Array.from(new Set([...state.ui.selectedCells, ...newlySelectedIds])));
            else state.selectCells(newlySelectedIds);
        });

        this.container.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => { this.stage.width(this.container.clientWidth); this.stage.height(this.container.clientHeight); state.notify(); });
    }

    getPeerColor(peerId) {
        let hash = 0; for (let i = 0; i < peerId.length; i++) hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash % 360)}, 85%, 60%)`;
    }

    renderRemoteCursor(peerId, pos) {
        if (!state.ui.layerVisibility || !state.ui.layerVisibility.ui) return;

        let renderX = state.ui.viewMode === 'back' ? this.stage.width() - pos.x : pos.x;

        if (!this.remoteCursors[peerId]) {
            const group = new Konva.Group();
            const color = this.getPeerColor(peerId);
            const arrow = new Konva.Path({ data: 'M0,0 L12,12 L5,14 L0,22 Z', fill: color, shadowColor: '#000', shadowBlur: 4, shadowOffset: { x: 2, y: 2 }, shadowOpacity: 0.5 });
            const tag = new Konva.Text({ text: peerId, x: 14, y: 14, fill: '#0f172a', backgroundColor: color, padding: 3, fontSize: 10, cornerRadius: 4, fontStyle: 'bold' });
            group.add(arrow, tag);
            this.layers.ui.add(group);
            this.remoteCursors[peerId] = group;
        }
        this.remoteCursors[peerId].position({ x: renderX, y: pos.y });
        this.layers.ui.batchDraw();
    }

    // ✅ 高级残影渲染系统：带有对方的署名标签，视觉防冲突
    renderRemoteGhost(peerId, cellsData) {
        let peerGroup = this.remoteGhostsGroup.findOne(`#ghost-${peerId}`);
        if (!peerGroup) {
            peerGroup = new Konva.Group({ id: `ghost-${peerId}` });
            this.remoteGhostsGroup.add(peerGroup);
        }
        peerGroup.destroyChildren();

        const color = this.getPeerColor(peerId);
        cellsData.forEach((ghost, index) => {
            let renderX = state.ui.viewMode === 'back' ? this.stage.width() - ghost.cx : ghost.cx;
            // 虚线电芯轮廓
            peerGroup.add(new Konva.Circle({ x: renderX, y: ghost.cy, radius: state.ui.cellRadius, stroke: color, strokeWidth: 2, dash: [4, 4], opacity: 0.8 }));

            // 在这一坨残影的第一个元素上方打上对方名字标签
            if (index === 0) {
                peerGroup.add(new Konva.Text({ text: `${peerId} 拖拽中...`, x: renderX - 20, y: ghost.cy - 35, fill: color, fontSize: 11, fontStyle: 'bold' }));
            }
        });
        this.layers.ui.batchDraw();
    }

    clearRemoteGhost(peerId) {
        const peerGroup = this.remoteGhostsGroup.findOne(`#ghost-${peerId}`);
        if (peerGroup) { peerGroup.destroy(); this.layers.ui.batchDraw(); }
    }

    isPointInPolygon(x, y, points) { let inside = false; for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) { let intersect = ((points[i + 1] > y) !== (points[j + 1] > y)) && (x < (points[j] - points[i]) * (y - points[i + 1]) / (points[j + 1] - points[i + 1]) + points[i]); if (intersect) inside = !inside; } return inside; }

    renderAll(doc, ui) {
        this.layers.busbar.visible(ui.layerVisibility.busbar);
        this.layers.cell.visible(ui.layerVisibility.cell);
        this.layers.ui.visible(ui.layerVisibility.ui);
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

            const cellGroup = new Konva.Group({ x: renderX, y: cell.cy, id: cell.id, draggable: ui.currentTool === 'pointer' && !cell.isLocked });

            cellGroup.on('dragstart', (e) => {
                if (!ui.selectedCells.includes(cell.id)) { if (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) state.selectCells([...ui.selectedCells, cell.id]); else state.selectCells([cell.id]); }
                this.dragStartPositions = {};
                this.dragTrailGroup.destroyChildren();

                doc.cells.forEach(c => {
                    if (ui.selectedCells.includes(c.id)) {
                        this.dragStartPositions[c.id] = { cx: c.cx, cy: c.cy };
                        const trailLine = new Konva.Line({ id: `trail-${c.id}`, points: [], stroke: '#38bdf8', strokeWidth: 1.5, dash: [4, 4], opacity: 0.8 });
                        this.dragTrailGroup.add(trailLine);
                    }
                });
            });

            cellGroup.on('dragmove', (e) => {
                if (ui.isSnapping) { const snap = ui.gridSize / 2; e.target.x(Math.round(e.target.x() / snap) * snap); e.target.y(Math.round(e.target.y() / snap) * snap); }
                let newX = e.target.x(); let dx = (ui.viewMode === 'back' ? this.stage.width() - newX : newX) - this.dragStartPositions[cell.id].cx;
                let dy = e.target.y() - this.dragStartPositions[cell.id].cy;

                let ghostPayload = [];

                doc.cells.forEach(c => {
                    if (ui.selectedCells.includes(c.id) && !c.isLocked) {
                        c.cx = this.dragStartPositions[c.id].cx + dx; c.cy = this.dragStartPositions[c.id].cy + dy;
                        if (c.id !== cell.id) { let node = this.layers.cell.findOne(`#${c.id}`); if (node) { node.x(ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx); node.y(c.cy); } }

                        const trail = this.dragTrailGroup.findOne(`#trail-${c.id}`);
                        if (trail) {
                            let sX = ui.viewMode === 'back' ? this.stage.width() - this.dragStartPositions[c.id].cx : this.dragStartPositions[c.id].cx;
                            let cX = ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx;
                            trail.points([sX, this.dragStartPositions[c.id].cy, cX, c.cy]);
                        }
                        ghostPayload.push({ id: c.id, cx: c.cx, cy: c.cy });
                    }
                });
                this.renderBusbars(doc, ui);

                // ✅ 彻底修复拖动时坐标错位问题：使用纯内建 API 获取当前内部指针绝对位置进行广播！
                const pointerPos = this.stage.getRelativePointerPosition();
                if (pointerPos) {
                    let absoluteX = state.ui.viewMode === 'back' ? this.stage.width() - pointerPos.x : pointerPos.x;
                    state.broadcastCursor({ x: absoluteX, y: pointerPos.y });
                }

                state.broadcastGhostMove(ghostPayload);
            });

            cellGroup.on('dragend', () => {
                this.dragTrailGroup.destroyChildren();
                state.broadcastGhostEnd();
                state.commitAction(ui.selectedCells.length > 1 ? '批量移动' : '移动电芯');
            });

            cellGroup.on('click', (e) => { if (e.evt.detail === 1 && ui.currentTool !== 'pan') state.handleCellClick(cell.id, e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey); });

            if (isSelected) cellGroup.add(new Konva.Circle({ radius: ui.cellRadius + 6, fill: 'rgba(56, 189, 248, 0.3)', stroke: '#38bdf8', strokeWidth: 2 }));
            const strokeColor = cell.isLocked ? '#475569' : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? '#fbbf24' : (displayPolarity === 'positive' ? '#ef4444' : '#3b82f6'));
            cellGroup.add(new Konva.Circle({ radius: ui.cellRadius, fill: displayPolarity === 'positive' ? '#1e293b' : '#334155', stroke: strokeColor, strokeWidth: cell.isLocked ? 2 : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? 4 : 2), opacity: cell.isLocked ? 0.7 : 1 }));
            cellGroup.add(new Konva.Text({ text: displayPolarity === 'positive' ? '+' : '-', fontSize: 18, fontStyle: 'bold', fill: strokeColor, align: 'center', verticalAlign: 'middle', x: -ui.cellRadius, y: -ui.cellRadius - 2, width: ui.cellRadius * 2, height: ui.cellRadius * 2, opacity: cell.isLocked ? 0.5 : 1 }));

            const labelGroup = new Konva.Group({ visible: ui.layerVisibility.labels });
            let labelText = cell.id; if (cell.voltage || cell.resistance) { if (cell.voltage) labelText += `\n${cell.voltage}V`; if (cell.resistance) labelText += `\n${cell.resistance}mΩ`; }
            labelGroup.add(new Konva.Text({ text: labelText, fontSize: 9, fill: '#94a3b8', align: 'center', x: -ui.cellRadius * 2, y: ui.cellRadius + 2, width: ui.cellRadius * 4, lineHeight: 1.1 }));
            cellGroup.add(labelGroup);
            if (cell.isLocked) cellGroup.add(new Konva.Text({ text: '🔒', fontSize: 12, x: ui.cellRadius - 10, y: -ui.cellRadius }));
            this.layers.cell.add(cellGroup);
        });

        if (ui.currentTool === 'pan') this.container.style.cursor = 'grab'; else if (ui.currentTool === 'measure') this.container.style.cursor = 'crosshair'; else if (ui.currentTool === 'wire' || ui.currentTool.includes('select')) this.container.style.cursor = 'crosshair'; else this.container.style.cursor = 'default';
        this.layers.cell.draw();
    }
}