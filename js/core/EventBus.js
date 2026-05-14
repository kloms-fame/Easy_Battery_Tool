class EventBus {
    constructor() {
        this.listeners = {};
    }
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                // ✅ 核心修复：加入 try-catch 防崩溃护盾。
                // UI 层的任何报错都不会再中断底层的 WebRTC P2P 数据传输！
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[EventBus] 拦截到事件 ${event} 触发时的 UI 错误:`, error);
                }
            });
        }
    }
}
export const eventBus = new EventBus();