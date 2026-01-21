export class NetworkCoordinator {
    constructor() {
        this.socket = null;
    }

    init() {
        // SocketLib Initialization
        // Must be called during 'socketlib.ready' or 'setup' usually, but 'ready' is also fine if socketlib is ready.
        if (typeof socketlib === "undefined") {
            console.error("Jump'n'Run | FATAL: socketlib module is NOT active!");
            ui.notifications.error("Jump'n'Run requires 'socketlib' module!");
            return;
        }

        this.socket = socketlib.registerModule("foundry-jump-n-run");

        // Register Functions
        this.socket.register("posUpdate", this._handlePosUpdate.bind(this));
        this.socket.register("ping", this._handlePing.bind(this));
        this.socket.register("crumble", this._handleCrumble.bind(this));
        this.socket.register("gateTrigger", this._handleGateTrigger.bind(this));
        this.socket.register("consumePotion", this._handleConsumePotion.bind(this));

        console.log("Jump'n'Run | Network Initialized via SocketLib");

        // Connection Test (Debug)
        // setTimeout(() => {
        //     if (this.socket) {
        //         console.log("Jump'n'Run | Sending SocketLib PING...");
        //         this.socket.executeForEveryone("ping", { from: game.user.name });
        //     }
        // }, 5000);
    }

    /**
     * Broadcasts a position update to all other clients.
     * @param {Object} data - The data to broadcast.
     */
    broadcastUpdate(data) {
        if (!this.socket) return;

        const packet = {
            t: game.time.serverTime,
            ...data,
            sceneId: data.sceneId || canvas.scene?.id
        };

        // executeForEveryone sends to GM + All Players (including self, usually)
        // socketlib doesn't have a "everyone else" easily, so we filter on receipt
        this.socket.executeForEveryone("posUpdate", packet);
    }

    registerController(tokenId, callback) {
        // We use a global listener map or just dispatch events
        // Since socketlib is static functions, we need to bridge to instances
        if (!this.listeners) this.listeners = new Map();
        this.listeners.set(tokenId, callback);
    }

    unregisterController(tokenId) {
        if (this.listeners) this.listeners.delete(tokenId);
    }

    // --- HANDLERS ---

    _handlePosUpdate(packet) {
        // Re-connect to the class instance (since socketlib might call this with weird context, but binding fixes it)

        // 1. Ignore Self (since executeForEveryone sends to self)
        if (packet.id) {
            // If we are looking for OUR OWN token, and we are the MASTER controller, we should ignore it.
            // But simpler: "posUpdate" usually implies "I am at X". 
            // If I am the one who SENT it, I should ignore it? 
            // SocketLib doesn't give sender ID easily.
            // We can check if we are the 'owner' locally and currently controlling it?
            // Actually, simplest: Add 'from' to packet?
        }

        // Culling
        if (packet.sceneId && canvas.scene && packet.sceneId !== canvas.scene.id) return;

        // Dispatch
        if (this.listeners && packet.id) {
            const callback = this.listeners.get(packet.id);
            // We need to make sure we don't apply updates to the controller sending them!
            // The PlatformerPlayer logic handles interpolation. 
            // If I am Master, I ignore onNetworkUpdate. 
            // If I am Slave, I accept it.
            // So simply dispatching is safe.

            if (callback) callback(packet);
        }
    }

    _handlePing(data) {
        // const msg = `Jump'n'Run | Received SocketLib PING from ${data.from}`;
        // console.log(msg);
        // ui.notifications.info(msg);
    }

    _handleCrumble(data) {
        if (!game.user.isGM) return;
        if (!data.id) return;
        // console.log("Jump'n'Run | Server received Crumble Trigger:", data.id);

        // Check if already active
        const active = canvas.scene.getFlag("foundry-jump-n-run", "activeCrumbles") || {};
        if (active[data.id]) return;

        canvas.scene.setFlag("foundry-jump-n-run", `activeCrumbles.${data.id}`, game.time.serverTime);
    }

    _handleGateTrigger(data) {
        if (!game.user.isGM) return;
        if (!data.id || !data.duration) return;

        const now = game.time.serverTime;
        const expiry = now + data.duration;
        canvas.scene.setFlag("foundry-jump-n-run", `activeGates.${data.id}`, expiry);
    }

    _handleConsumePotion(data) {
        if (!game.user.isGM) return;

        // Data can be just an ID (legacy/direct) or an object { sceneId, potionId }
        // We expect object now.
        const sceneId = data.sceneId;
        const potionId = data.potionId;

        const scene = game.scenes.get(sceneId);
        if (!scene) return;

        const currentData = scene.getFlag("foundry-jump-n-run", "levelData") || [];
        const newData = currentData.filter(i => i.id !== potionId);

        // Only update/save if we actually found/removed something
        if (newData.length !== currentData.length) {
            scene.setFlag("foundry-jump-n-run", "levelData", newData).then(() => {
                // Trigger redraw if on the same scene (usually handled by updateScene hook anyway)
                if (canvas.jumpnrun && canvas.scene.id === scene.id) {
                    canvas.jumpnrun.drawLevel();
                }
            });
        }
    }
}
