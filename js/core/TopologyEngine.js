export class TopologyEngine {
    static analyze(doc) {
        let poles = {};
        doc.cells.forEach(c => { poles[`${c.id}_+`] = []; poles[`${c.id}_-`] = []; });
        let shortedBusbars = []; let isShorted = false;
        let adj = {}; Object.keys(poles).forEach(k => adj[k] = []);

        const getPole = (cell, side) => {
            if (side === 'front') return cell.polarity === 'positive' ? '+' : '-';
            return cell.polarity === 'positive' ? '-' : '+';
        };

        doc.busbars.forEach(b => {
            let c1 = doc.cells.find(c => c.id === b.from); let c2 = doc.cells.find(c => c.id === b.to);
            if (!c1 || !c2) return;
            let side1 = b.side || 'front';
            let p1 = `${c1.id}_${getPole(c1, side1)}`; let p2 = `${c2.id}_${getPole(c2, side1)}`;
            adj[p1].push({ to: p2, id: b.id }); adj[p2].push({ to: p1, id: b.id });
        });

        let visited = new Set(); let superNodes = [];
        Object.keys(adj).forEach(startNode => {
            if (!visited.has(startNode)) {
                let comp = new Set(); let q = [startNode]; visited.add(startNode); let busbarsInComp = new Set();
                while (q.length > 0) {
                    let curr = q.shift(); comp.add(curr);
                    adj[curr].forEach(edge => {
                        busbarsInComp.add(edge.id);
                        if (!visited.has(edge.to)) { visited.add(edge.to); q.push(edge.to); }
                    });
                }
                superNodes.push({ nodes: comp, busbars: Array.from(busbarsInComp) });
            }
        });

        doc.cells.forEach(c => {
            let pPos = `${c.id}_+`; let pNeg = `${c.id}_-`;
            superNodes.forEach(sn => {
                if (sn.nodes.has(pPos) && sn.nodes.has(pNeg)) {
                    isShorted = true; shortedBusbars.push(...sn.busbars);
                }
            });
        });
        shortedBusbars = [...new Set(shortedBusbars)];

        let s = 0, p = 0, v = 0, r = 0;
        let connectedCells = new Set();
        doc.busbars.forEach(b => { connectedCells.add(b.from); connectedCells.add(b.to); });

        // 🌟 新增：检测被遗忘的“孤立电芯”（完全没有被连线的电芯）
        let orphanCount = doc.cells.length - connectedCells.size;

        if (!isShorted && connectedCells.size > 0) {
            // ✅ 数学 Bug 修复：并联数 P 等于某个等电位面中“正极”的最高数量，而不是所有节点数量！
            p = Math.max(...superNodes.map(sn => {
                return Array.from(sn.nodes).filter(nodeName => nodeName.endsWith('_+')).length;
            }));

            s = Math.ceil(connectedCells.size / (p || 1));

            let avgV = doc.cells.reduce((sum, c) => sum + (parseFloat(c.voltage) || 3.7), 0) / doc.cells.length;
            let avgR = doc.cells.reduce((sum, c) => sum + (parseFloat(c.resistance) || 20), 0) / doc.cells.length;

            v = (s * avgV).toFixed(2); r = ((s / p) * avgR).toFixed(2);
        }

        return { isShorted, shortedBusbars, s, p, v, r, connectedCount: connectedCells.size, orphanCount };
    }
}