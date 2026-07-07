const net = require("net");

const { JsonObjectStream } = require("./json-stream");

class StatsClient {
  constructor({ getUrl, onMessage, log, emitState, onConnected }) {
    this.getUrl = getUrl;
    this.onMessage = onMessage;
    this.log = log;
    this.emitState = emitState;
    this.onConnected = onConnected;

    this.socket = null;
    this.reconnectTimer = null;
    this.noMessageTimer = null;
    this.reconnectDelayMs = 1000;
    this.connection = "starting";
    this.connectionMode = "";
    this.packetCount = 0;
    this.rawStream = new JsonObjectStream();
    // Set when a live connection drops; survives the retry loop so the next
    // successful connect can report how long the game stayed offline.
    this.disconnectedAt = null;
    this.hadConnection = false;
  }

  status() {
    return {
      connection: this.connection,
      connectionMode: this.connectionMode
    };
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.close();
    this.connectTcp();
  }

  close() {
    clearTimeout(this.noMessageTimer);

    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;

    try {
      socket.destroy();
    } catch {
      // Socket may already be closed.
    }
  }

  connectTcp() {
    let endpoint;
    try {
      endpoint = this.getEndpoint();
    } catch (error) {
      this.connection = "error";
      this.log("error", "Invalid Stats API endpoint", { url: this.getUrl(), error: error.message });
      this.emitState();
      this.scheduleReconnect();
      return;
    }

    this.connection = "connecting";
    this.connectionMode = "tcp";
    this.packetCount = 0;
    this.rawStream.reset();
    this.log("info", "Connecting to Stats API over TCP", endpoint);
    this.emitState();

    const socket = net.createConnection(endpoint);
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);

    socket.on("connect", () => {
      if (socket !== this.socket) return;
      this.reconnectDelayMs = 1000;
      this.connection = "connected";
      this.connectionMode = "tcp";
      this.hadConnection = true;
      this.log("info", "Stats API connected over TCP", endpoint);
      this.emitState();
      this.scheduleNoMessageWarning();

      if (this.disconnectedAt !== null) {
        const offlineMs = Date.now() - this.disconnectedAt;
        this.disconnectedAt = null;
        if (this.onConnected) this.onConnected(offlineMs);
      }
    });

    socket.on("data", (chunk) => {
      if (socket !== this.socket) return;
      const { messages, overflow } = this.rawStream.push(chunk);
      for (const message of messages) this.handleMessage(message);
      if (overflow) {
        this.log("warn", "TCP buffer flushed: no complete JSON found", overflow);
      }
    });

    socket.on("close", () => {
      if (socket !== this.socket) return;
      clearTimeout(this.noMessageTimer);
      // Only stamp the drop of a live connection: the retry loop while the
      // game is closed also fires "close" and must not push the time forward.
      if (this.hadConnection) {
        this.disconnectedAt = Date.now();
        this.hadConnection = false;
      }
      this.connection = "disconnected";
      this.log("warn", "Stats API TCP disconnected", { nextRetryMs: this.reconnectDelayMs });
      this.emitState();
      this.scheduleReconnect();
    });

    socket.on("error", (error) => {
      if (socket !== this.socket) return;
      this.connection = "error";
      this.log("error", "Stats API TCP error", {
        endpoint,
        error: error && error.message ? error.message : String(error)
      });
      if (error && String(error.message || error).includes("ECONNREFUSED")) {
        this.log("warn", "Stats API port closed: Rocket League is not listening yet. Check DefaultStatsAPI.ini then fully restart the game.", endpoint);
      }
      this.emitState();
    });
  }

  handleMessage(raw) {
    this.packetCount += 1;
    clearTimeout(this.noMessageTimer);
    this.onMessage(raw);
  }

  getEndpoint() {
    const raw = String(this.getUrl() || "").trim();
    const value = raw || "127.0.0.1:49123";

    if (/^\d+$/.test(value)) {
      return { host: "127.0.0.1", port: Number(value) };
    }

    const parsed = new URL(value.includes("://") ? value : `tcp://${value}`);
    return {
      host: parsed.hostname || "127.0.0.1",
      port: Number(parsed.port || 49123)
    };
  }

  scheduleNoMessageWarning() {
    clearTimeout(this.noMessageTimer);
    this.noMessageTimer = setTimeout(() => {
      if (this.connection !== "connected" || this.packetCount > 0) return;
      this.log("warn", "Connected to the Stats API but no packets received. Join a match or wait for kickoff; data is only emitted during a match.");
    }, 12000);
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const waitMs = this.reconnectDelayMs;
    this.log("info", "Reconnect scheduled", { waitMs });
    this.reconnectTimer = setTimeout(() => this.connect(), waitMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.6, 10000);
  }

  async runDiagnostics() {
    let endpoint;
    try {
      endpoint = this.getEndpoint();
    } catch (error) {
      this.log("error", "Connection test impossible: invalid Stats API URL", {
        url: this.getUrl(),
        error: error.message
      });
      return;
    }

    this.log("info", "Connection test started", {
      url: this.getUrl(),
      endpoint,
      currentState: this.connection,
      currentMode: this.connectionMode || null,
      protocol: "tcp"
    });

    const tcpResult = await testTcpPort(endpoint);
    this.log(tcpResult.ok ? "info" : "error", tcpResult.ok ? "TCP test OK: port open" : "TCP test FAILED", tcpResult);

    const readResult = await testTcpRead(endpoint);
    this.log(readResult.ok ? "info" : "warn", readResult.ok ? "TCP test: data received" : "TCP test: no data received", readResult);

    if (tcpResult.ok && !readResult.ok) {
      this.log("info", "Diagnostics: connection OK. If no UpdateState appears, start a match and wait for kickoff.");
    }
  }
}

function testTcpPort(endpoint) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection(endpoint);
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // Socket may already be closed.
      }
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    }

    const timer = setTimeout(() => finish({ ok: false, endpoint, error: "timeout" }), 1800);
    socket.on("connect", () => finish({ ok: true, endpoint }));
    socket.on("error", (error) => finish({ ok: false, endpoint, error: error && error.message ? error.message : String(error) }));
  });
}

function testTcpRead(endpoint) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let socket;
    let bytes = 0;
    let preview = "";
    let connected = false;
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket) socket.destroy();
      } catch {
        // Socket may already be closed.
      }
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    }

    const timer = setTimeout(() => {
      finish({
        ok: bytes > 0,
        endpoint,
        connected,
        bytes,
        preview: preview || null,
        note: bytes > 0 ? "data received" : "no data during sample window"
      });
    }, 5000);

    socket = net.createConnection(endpoint);
    socket.setNoDelay(true);
    socket.on("connect", () => {
      connected = true;
    });
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      preview += chunk.toString("utf8").slice(0, 240 - preview.length);
      if (preview.length >= 240) finish({ ok: true, endpoint, connected, bytes, preview });
    });
    socket.on("error", (error) => finish({ ok: false, endpoint, connected, bytes, error: error && error.message ? error.message : String(error) }));
  });
}

module.exports = { StatsClient };
