export class TopologyEngine {
    static analyze(doc) {
        // 1. 初始化图论节点：每个电芯拆分为独立的 正极(+) 和 负极(-)
        let poles = {};
        doc.cells.forEach(c => {
            poles[`${c.id}_+`] = [];
            poles[`${c.id}_-`] = [];
        });

        let shortedBusbars = [];
        let isShorted = false;

        // 构建邻接表 (只考虑通过连线产生的等电位连接)
        let adj = {};
        Object.keys(poles).forEach(k => adj[k] = []);

        // 获取连线接触的物理极性
        const getPole = (cell, side) => {
            if (side === 'front') return cell.polarity === 'positive' ? '+' : '-';
            return cell.polarity === 'positive' ? '-' : '+'; // 背面极性反转
        };

        doc.busbars.forEach(b => {
            let c1 = doc.cells.find(c => c.id === b.from);
            let c2 = doc.cells.find(c => c.id === b.to);
            if (!c1 || !c2) return;

            // 兼容老数据，如果没有记录面，默认算正面
            let side1 = b.side || 'front';
            let p1 = `${c1.id}_${getPole(c1, side1)}`;
            let p2 = `${c2.id}_${getPole(c2, side1)}`;

            adj[p1].push({ to: p2, id: b.id });
            adj[p2].push({ to: p1, id: b.id });
        });

        // 2. 寻找连通分量 (等电位面 / SuperNodes)
        let visited = new Set();
        let superNodes = [];

        Object.keys(adj).forEach(startNode => {
            if (!visited.has(startNode)) {
                let comp = new Set();
                let q = [startNode];
                visited.add(startNode);
                let busbarsInComp = new Set();

                while (q.length > 0) {
                    let curr = q.shift();
                    comp.add(curr);
                    adj[curr].forEach(edge => {
                        busbarsInComp.add(edge.id);
                        if (!visited.has(edge.to)) {
                            visited.add(edge.to);
                            q.push(edge.to);
                        }
                    });
                }
                superNodes.push({ nodes: comp, busbars: Array.from(busbarsInComp) });
            }
        });

        // 3. 致命短路检测：如果同一个电芯的 + 和 - 出现在了同一个等电位面中，说明短路！
        doc.cells.forEach(c => {
            let pPos = `${c.id}_+`;
            let pNeg = `${c.id}_-`;
            superNodes.forEach(sn => {
                if (sn.nodes.has(pPos) && sn.nodes.has(pNeg)) {
                    isShorted = true;
                    shortedBusbars.push(...sn.busbars); // 记录导致短路的罪魁祸首
                }
            });
        });
        shortedBusbars = [...new Set(shortedBusbars)]; // 去重

        // 4. 智能推断 S/P 架构与电学参数计算
        let s = 0, p = 0, v = 0, r = 0;
        let connectedCells = new Set();
        doc.busbars.forEach(b => { connectedCells.add(b.from); connectedCells.add(b.to); });

        if (!isShorted && connectedCells.size > 0) {
            // 启发式算法：在一个并联组中，所有的正极会连在一个 SuperNode 中，所以最大的 SuperNode 节点数就是并联数 P
            p = Math.max(...superNodes.map(sn => sn.nodes.size));
            s = Math.ceil(connectedCells.size / p) || 1; // 串联数 = 总连接电芯 / 并联数

            // 提取参数进行物理估算
            let avgV = doc.cells.reduce((sum, c) => sum + (parseFloat(c.voltage) || 3.7), 0) / doc.cells.length;
            let avgR = doc.cells.reduce((sum, c) => sum + (parseFloat(c.resistance) || 20), 0) / doc.cells.length;

            v = (s * avgV).toFixed(2);
            r = ((s / p) * avgR).toFixed(2);
        }

        return { isShorted, shortedBusbars, s, p, v, r, connectedCount: connectedCells.size };
    }
}