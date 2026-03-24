const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;

ensureDependencyPatches();

const bedrock = require('bedrock-protocol');
const { Vec3 } = require('vec3');

function patchDependencyFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const { from, to } of replacements) {
    if (content.includes(to)) continue;
    if (!content.includes(from)) {
      throw new Error(`Patch anchor not found in ${filePath}: ${from.split('\n')[0]}`);
    }

    content = content.replace(from, to);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function ensureDependencyPatches() {
  const rootDir = __dirname;

  try {
    patchDependencyFile(path.join(rootDir, 'node_modules', 'jsp-raknet', 'js', 'Client.js'), [
      {
        from: "const RAKNET_PROTOCOL = 10;",
        to: "const DEFAULT_RAKNET_PROTOCOL = 10;"
      },
      {
        from: "    constructor(hostname, port) {",
        to: "    constructor(hostname, port, options = {}) {"
      },
      {
        from: "        this.port = port;\n        this.address = new InetAddress_1.default(this.hostname, this.port);",
        to: "        this.port = port;\n        this.protocolVersion = Number(options.protocolVersion) || DEFAULT_RAKNET_PROTOCOL;\n        this.address = new InetAddress_1.default(this.hostname, this.port);"
      },
      {
        from: "        packet.protocol = RAKNET_PROTOCOL;",
        to: "        packet.protocol = this.protocolVersion;"
      },
      {
        from: "        this.emit('connecting', { mtuSize: packet.mtuSize, protocol: RAKNET_PROTOCOL });",
        to: "        this.emit('connecting', { mtuSize: packet.mtuSize, protocol: this.protocolVersion });"
      }
    ]);

    patchDependencyFile(path.join(rootDir, 'node_modules', 'bedrock-protocol', 'src', 'rak.js'), [
      {
        from: "  constructor (options = {}) {",
        to: "  constructor (options = {}, client) {"
      },
      {
        from: "    this.onEncapsulated = () => { }\n    if (options.useWorkers) {",
        to: "    this.onEncapsulated = () => { }\n    this.protocolVersion = client?.versionGreaterThanOrEqualTo('1.19.30') ? 11 : 10\n    if (options.useWorkers) {"
      },
      {
        from: "    this.worker = ConnWorker.connect(host, port)",
        to: "    this.worker = ConnWorker.connect(host, port, this.protocolVersion)"
      },
      {
        from: "    this.raknet = new Client(host, port)",
        to: "    this.raknet = new Client(host, port, { protocolVersion: this.protocolVersion })"
      },
      {
        from: "      if (!this.raknet) this.raknet = new Client(this.options.host, this.options.port)",
        to: "      if (!this.raknet) this.raknet = new Client(this.options.host, this.options.port, { protocolVersion: this.protocolVersion })"
      }
    ]);

    patchDependencyFile(path.join(rootDir, 'node_modules', 'bedrock-protocol', 'src', 'rakWorker.js'), [
      {
        from: "function connect (host, port) {\n  if (isMainThread) {\n    const worker = new Worker(__filename)\n    worker.postMessage({ type: 'connect', host, port })\n    return worker\n  }\n}",
        to: "function connect (host, port, protocolVersion = 10) {\n  if (isMainThread) {\n    const worker = new Worker(__filename)\n    worker.postMessage({ type: 'connect', host, port, protocolVersion })\n    return worker\n  }\n}"
      },
      {
        from: "      const { host, port } = evt\n      raknet = new Client(host, port)\n",
        to: "      const { host, port, protocolVersion } = evt\n      raknet = new Client(host, port, { protocolVersion })\n"
      }
    ]);
  } catch (err) {
    console.warn(`[startup] Dependency patch warning: ${err.message}`);
  }
}

const BOT_CONFIG = Object.freeze({
  MC_HOST: 'seungheun.aternos.me',
  MC_PORT: 50261,
  MC_USERNAME: 'Jeyms0108',
  MC_VERSION: '1.26.3.1',
  MC_CONNECT_TIMEOUT_MS: 120000,
  MC_RECONNECT_DELAY_MS: 5000,
  MC_OFFLINE: false,
  MC_FOLLOW_RANGE: 100,
  MC_AUTH_INPUT_PROFILE: 'touch_minimal',
  MC_FORCE_MOVE_PLAYER: false,
  MC_ENABLE_CHAT_RESPONSES: false,
  MC_USE_RAKNET_WORKERS: true,
  MC_AUTH_CACHE_DIR: ''
});

const MC_HOST = String(BOT_CONFIG.MC_HOST || '').trim();
const MC_PORT = Number(BOT_CONFIG.MC_PORT);
const MC_USERNAME = String(BOT_CONFIG.MC_USERNAME || '').trim();
const MC_CONNECT_TIMEOUT_MS = Number(BOT_CONFIG.MC_CONNECT_TIMEOUT_MS ?? 30000);
const MC_RECONNECT_DELAY_MS = Number(BOT_CONFIG.MC_RECONNECT_DELAY_MS ?? 5000);
const MC_OFFLINE = Boolean(BOT_CONFIG.MC_OFFLINE);
const MC_VERSION_RAW = String(BOT_CONFIG.MC_VERSION || '1.26.3.1').trim();
const MC_FORCE_MOVE_PLAYER = Boolean(BOT_CONFIG.MC_FORCE_MOVE_PLAYER);
const MC_AUTH_INPUT_PROFILE = String(BOT_CONFIG.MC_AUTH_INPUT_PROFILE || 'touch_minimal').trim();
const MC_FOLLOW_RANGE = Number(BOT_CONFIG.MC_FOLLOW_RANGE ?? 48);
const MC_ENABLE_CHAT_RESPONSES = Boolean(BOT_CONFIG.MC_ENABLE_CHAT_RESPONSES);
const MC_USE_RAKNET_WORKERS = Boolean(BOT_CONFIG.MC_USE_RAKNET_WORKERS);
const IS_TERMUX = /com\.termux[\\/]files[\\/]usr$/.test(process.env.PREFIX || '') || !!process.env.TERMUX_VERSION;
const AUTH_CACHE_DIR = resolveAuthCacheDir();

if (!MC_HOST) {
  console.error('[startup] Missing MC_HOST in BOT_CONFIG');
  process.exit(1);
}

if (!MC_USERNAME) {
  console.error('[startup] Missing MC_USERNAME in BOT_CONFIG');
  process.exit(1);
}

if (!Number.isInteger(MC_PORT) || MC_PORT < 1 || MC_PORT > 65535) {
  console.error(`[startup] Invalid MC_PORT in BOT_CONFIG: ${BOT_CONFIG.MC_PORT}`);
  process.exit(1);
}

if (!Number.isInteger(MC_RECONNECT_DELAY_MS) || MC_RECONNECT_DELAY_MS < 1000) {
  console.error(`[startup] Invalid MC_RECONNECT_DELAY_MS in BOT_CONFIG: ${BOT_CONFIG.MC_RECONNECT_DELAY_MS}`);
  process.exit(1);
}

if (!Number.isInteger(MC_CONNECT_TIMEOUT_MS) || MC_CONNECT_TIMEOUT_MS < 5000) {
  console.error(`[startup] Invalid MC_CONNECT_TIMEOUT_MS in BOT_CONFIG: ${BOT_CONFIG.MC_CONNECT_TIMEOUT_MS}`);
  process.exit(1);
}

if (!Number.isInteger(MC_FOLLOW_RANGE) || MC_FOLLOW_RANGE < 4) {
  console.error(`[startup] Invalid MC_FOLLOW_RANGE in BOT_CONFIG: ${BOT_CONFIG.MC_FOLLOW_RANGE}`);
  process.exit(1);
}

function normalizeBedrockVersion(rawVersion) {
  const v = (rawVersion || '').trim();
  if (!v) return '1.26.0';

  // bedrock-protocol currently targets 1.26.0 for the 1.26.x line.
  if (v === '1.26.3.1' || v === '1.26.3' || v === '1.26.2' || v === '1.26.1') {
    return '1.26.0';
  }

  return v;
}

const MC_VERSION = normalizeBedrockVersion(MC_VERSION_RAW);

function isIpv4Literal(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

async function resolveServerHost(host) {
  if (isIpv4Literal(host)) return host;

  const result = await dns.lookup(host, { family: 4 });
  if (!result?.address) {
    throw new Error(`DNS lookup returned no IPv4 address for ${host}`);
  }

  return result.address;
}

function resolveAuthCacheDir() {
  const customDir = String(BOT_CONFIG.MC_AUTH_CACHE_DIR || '').trim();
  if (customDir) return customDir;

  const homeDir = os.homedir();
  if (IS_TERMUX && homeDir) {
    return path.join(homeDir, '.mcbot-bedrock-auth-cache');
  }

  return path.join(__dirname, '.bedrock-auth-cache');
}

const AI_MODES = Object.freeze({
  AUTONOMOUS: 'AUTONOMOUS',
  FOLLOW: 'FOLLOW'
});

const state = {
  client: null,
  sessionId: 0,
  reconnectTimer: null,
  authBlocked: false,
  authInProgress: false,
  connected: false,
  joined: false,
  spawned: false,
  runtimeEntityId: 0n,
  runtimeIdForMove: 0,
  tick: 0n,
  position: new Vec3(0, 0, 0),
  serverPosition: new Vec3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  headYaw: 0,
  onGround: true,
  entities: new Map(),
  timers: {
    decision: null,
    look: null,
    movementLoop: null,
    jumpReset: null,
    activity: null,
    obstacleReset: null
  },
  control: {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  },
  movementDebug: {
    tick: 0,
    lastLogAt: 0,
    lastYawDelta: 0,
    lastPacketMode: '',
    lastControlSnapshot: 'idle',
    lastServerMotionAt: 0,
    lastNoServerMotionLogAt: 0,
    lastServerProgressAt: 0,
    lastObstacleAt: 0,
    obstacleActiveUntil: 0,
    obstacleStage: 0,
    obstacleTurnBias: 0
  },
  movementMode: {
    authority: 'unknown', // unknown | client | server | server_with_rewind
    playerReady: false,
    playerReadyReason: 'waiting-for-spawn',
    activationAt: 0,
    spawnAt: 0,
    authProbeUntil: 0,
    lastAuthProbeAt: 0,
    authProbeBlocked: false,
    outboundSuppressedUntil: 0,
    lastSuppressedLogAt: 0,
    teleportAckPending: false,
    phase1BootstrapSent: false,
    phase2BootstrapSent: false
  },
  navigation: {
    serverTrail: []
  },
  world: {
    blockPalette: [],
    knownBlocks: new Map(),
    maxKnownBlocks: 6000
  },
  ai: {
    mode: AI_MODES.AUTONOMOUS,
    state: 'IDLE',
    nextStateSwitchAt: 0,
    busy: false,
    lastActionAt: 0,
    recentStates: [],
    turnHistory: [],
    followTargetId: null,
    followTargetName: null,
    followCommand: null,
    followOnce: false,
    actionVersion: 0,
    lastPauseAt: 0
  }
};

function log(scope, message, extra) {
  const ts = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${ts}] [${scope}] ${message}`, extra);
    return;
  }
  console.log(`[${ts}] [${scope}] ${message}`);
}

function formatReason(reason) {
  if (reason === undefined || reason === null) return 'unknown';
  if (typeof reason === 'string') return reason;

  try {
    return JSON.stringify(reason);
  } catch (_) {
    return String(reason);
  }
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(randFloat(min, max + 1));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toVec3(v) {
  if (!v) return new Vec3(0, 0, 0);
  return new Vec3(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
}

function entityKey(id) {
  if (id === undefined || id === null) return null;
  return String(id);
}

function nextTick() {
  state.tick += 1n;
  return state.tick;
}

function isReady() {
  return !!(state.client && state.connected && state.spawned);
}

function clearRuntimeTimers() {
  if (state.timers.decision) clearTimeout(state.timers.decision);
  if (state.timers.look) clearTimeout(state.timers.look);
  if (state.timers.movementLoop) clearInterval(state.timers.movementLoop);
  if (state.timers.jumpReset) clearTimeout(state.timers.jumpReset);
  if (state.timers.activity) clearTimeout(state.timers.activity);
  if (state.timers.obstacleReset) clearTimeout(state.timers.obstacleReset);

  state.timers.decision = null;
  state.timers.look = null;
  state.timers.movementLoop = null;
  state.timers.jumpReset = null;
  state.timers.activity = null;
  state.timers.obstacleReset = null;
  state.ai.busy = false;
}

function formatVec3(vec) {
  return `(${vec.x.toFixed(2)},${vec.y.toFixed(2)},${vec.z.toFixed(2)})`;
}

function formatTargetLabel() {
  return state.ai.followTargetName || state.ai.followTargetId || 'none';
}

function formatAiSummary() {
  return `mode=${state.ai.mode} state=${state.ai.state} target=${formatTargetLabel()}`;
}

function getOwnRuntimeIdNumber() {
  if (state.runtimeIdForMove > 0) return state.runtimeIdForMove;
  const fromBigInt = Number(state.runtimeEntityId);
  if (Number.isSafeInteger(fromBigInt) && fromBigInt > 0) return fromBigInt;
  return 0;
}

function isSelfRuntimeId(runtimeId) {
  if (runtimeId === undefined || runtimeId === null) return false;
  const incoming = String(runtimeId);
  return incoming === String(state.runtimeIdForMove) || incoming === state.runtimeEntityId.toString();
}

function cleanupForReconnect() {
  if (state.movementMode.playerReady) {
    log('movement', `Movement authority lost: ${state.movementMode.playerReadyReason}`);
  }

  clearRuntimeTimers();
  state.connected = false;
  state.joined = false;
  state.spawned = false;
  state.runtimeEntityId = 0n;
  state.runtimeIdForMove = 0;
  state.movementMode.authority = 'unknown';
  state.movementMode.playerReady = false;
  state.movementMode.playerReadyReason = 'waiting-for-spawn';
  state.movementMode.activationAt = 0;
  state.movementMode.spawnAt = 0;
  state.movementMode.authProbeUntil = 0;
  state.movementMode.lastAuthProbeAt = 0;
  state.movementMode.authProbeBlocked = false;
  state.movementMode.activationAt = 0;
  state.movementMode.outboundSuppressedUntil = 0;
  state.movementMode.lastSuppressedLogAt = 0;
  state.movementMode.teleportAckPending = true;
  state.movementMode.phase1BootstrapSent = false;
  state.movementMode.phase2BootstrapSent = false;
  state.position = new Vec3(0, 0, 0);
  state.serverPosition = new Vec3(0, 0, 0);
  state.navigation.serverTrail = [];
  state.world.blockPalette = [];
  state.world.knownBlocks.clear();
  state.entities.clear();
  state.ai.mode = AI_MODES.AUTONOMOUS;
  state.ai.state = BEHAVIOR_STATES.IDLE;
  state.ai.nextStateSwitchAt = 0;
  state.ai.lastActionAt = 0;
  state.ai.recentStates = [];
  state.ai.turnHistory = [];
  state.ai.followTargetId = null;
  state.ai.followTargetName = null;
  state.ai.followCommand = null;
  state.ai.followOnce = false;
  state.ai.actionVersion = 0;
  state.ai.lastPauseAt = 0;
  resetControlState();
}

function scheduleReconnect(reason) {
  if (state.reconnectTimer) return;
  if (state.authBlocked) {
    log('reconnect', 'Reconnect paused due authentication failure. Set MC_OFFLINE=false and restart the bot.');
    return;
  }

  cleanupForReconnect();

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    log('reconnect', `Reconnecting after ${reason}...`);
    createAndStartClient();
  }, MC_RECONNECT_DELAY_MS);

  log('reconnect', `Connection ended (${reason}). Reconnect in ${MC_RECONNECT_DELAY_MS}ms.`);
}

function queueChat(message) {
  if (!state.client || !state.connected) return;
  if (!MC_ENABLE_CHAT_RESPONSES) {
    log('chat', `[reply-suppressed] ${message}`);
    return;
  }

  try {
    // Some servers are strict about client-originated text packets, so replies are opt-in.
    state.client.queue('text', {
      needs_translation: false,
      category: 'message_only',
      type: 'chat',
      source_name: MC_USERNAME,
      message,
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false
    });
  } catch (err) {
    log('chat', `Failed to send chat: ${err.message}`);
  }
}

function queuePlayerAuthInput(position, moveVec, delta, jumping, extraFlags = {}) {
  if (!isReady()) return;

  const flags = { ...extraFlags };
  const useTouchProfile = MC_AUTH_INPUT_PROFILE.startsWith('touch');
  const enableReceivedServerData = MC_AUTH_INPUT_PROFILE.includes('received');

  if (state.movementMode.teleportAckPending) {
    flags.handled_teleport = true;
  }
  if (moveVec.z > 0) {
    flags.up = true;
  }
  if (moveVec.z < 0) {
    flags.down = true;
  }
  if (moveVec.x > 0) flags.right = true;
  if (moveVec.x < 0) flags.left = true;
  if (jumping) {
    flags.jumping = true;
    flags.start_jumping = true;
  }
  if (enableReceivedServerData) {
    flags.received_server_data = true;
  }

  const yawRad = (state.yaw * Math.PI) / 180;
  const pitchRad = (state.pitch * Math.PI) / 180;
  const cameraOrientation = {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad)
  };

  state.client.write('player_auth_input', {
    pitch: state.pitch,
    yaw: state.yaw,
    position: {
      x: position.x,
      y: position.y,
      z: position.z
    },
    move_vector: {
      x: moveVec.x,
      z: moveVec.z
    },
    head_yaw: state.headYaw,
    input_data: flags,
    input_mode: useTouchProfile ? 'touch' : 'mouse',
    play_mode: 'normal',
    interaction_model: useTouchProfile ? 'touch' : 'crosshair',
    interact_rotation: { x: state.yaw, z: state.pitch },
    tick: nextTick(),
    delta: {
      x: delta.x,
      y: delta.y,
      z: delta.z
    },
    analogue_move_vector: {
      x: moveVec.x,
      z: moveVec.z
    },
    camera_orientation: cameraOrientation,
    raw_move_vector: {
      x: moveVec.x,
      z: moveVec.z
    }
  });

  state.movementMode.teleportAckPending = false;
}

function queueMovePlayer(position, onGround) {
  if (!isReady()) return;
  const runtimeId = getOwnRuntimeIdNumber();
  if (!runtimeId) return;

  state.client.write('move_player', {
    runtime_id: runtimeId,
    position: {
      x: position.x,
      y: position.y,
      z: position.z
    },
    pitch: state.pitch,
    yaw: state.yaw,
    head_yaw: state.headYaw,
    mode: 'normal',
    on_ground: !!onGround,
    ridden_runtime_id: 0,
    tick: nextTick()
  });
}

function setPlayerMovementReady(ready, reason) {
  if (state.movementMode.playerReady === ready && state.movementMode.playerReadyReason === reason) return;

  if (!ready && !state.movementMode.playerReady) {
    state.movementMode.playerReadyReason = reason;
    return;
  }

  state.movementMode.playerReady = ready;
  state.movementMode.playerReadyReason = reason;

  if (ready) {
    log('movement', `Movement authority granted: player (${reason})`);
    return;
  }

  log('movement', `Movement authority lost: ${reason}`);
}

function queueSwingArm() {
  if (!isReady()) return;

  // Swing animation is a simple way to simulate mining attempts.
  state.client.queue('animate', {
    action_id: 'swing_arm',
    runtime_entity_id: state.runtimeEntityId,
    data: 0,
    has_swing_source: false
  });
}

function setControlState(partial) {
  state.control = { ...state.control, ...partial };
  logControlStateChange('set-control');
}

function resetControlState() {
  state.control.forward = false;
  state.control.back = false;
  state.control.left = false;
  state.control.right = false;
  state.control.jump = false;
  state.control.sprint = false;
  state.control.sneak = false;
  logControlStateChange('reset-control');
}

function formatControlSnapshot() {
  const active = [];
  if (state.control.forward) active.push('forward');
  if (state.control.back) active.push('back');
  if (state.control.left) active.push('left');
  if (state.control.right) active.push('right');
  if (state.control.jump) active.push('jump');
  if (state.control.sprint) active.push('sprint');
  if (state.control.sneak) active.push('sneak');
  return active.length > 0 ? active.join('+') : 'idle';
}

function logControlStateChange(reason) {
  const snapshot = formatControlSnapshot();
  if (snapshot === state.movementDebug.lastControlSnapshot) return;
  state.movementDebug.lastControlSnapshot = snapshot;
  log('control', `${reason}: ${snapshot}`);
}

function triggerJump(durationMs = randInt(100, 300)) {
  state.control.jump = true;
  logControlStateChange('jump-start');
  if (state.timers.jumpReset) clearTimeout(state.timers.jumpReset);
  state.timers.jumpReset = setTimeout(() => {
    state.control.jump = false;
    logControlStateChange('jump-end');
  }, durationMs);
}

function getMoveVectorFromControl() {
  let x = 0;
  let z = 0;

  if (state.control.right) x += 1;
  if (state.control.left) x -= 1;
  if (state.control.forward) z += 1;
  if (state.control.back) z -= 1;

  if (x !== 0 && z !== 0) {
    const inv = 1 / Math.sqrt(2);
    x *= inv;
    z *= inv;
  }

  return { x, z };
}

function computeMotionDelta(moveVec, jumping) {
  const yawRad = (state.yaw * Math.PI) / 180;
  const baseSpeed = state.control.sneak ? 0.03 : state.control.sprint ? 0.095 : 0.065;
  const speed = baseSpeed * randFloat(0.9, 1.08);

  const localX = moveVec.x * speed;
  const localZ = moveVec.z * speed;

  const worldX = -Math.sin(yawRad) * localZ + Math.cos(yawRad) * localX;
  const worldZ = Math.cos(yawRad) * localZ + Math.sin(yawRad) * localX;

  let worldY = 0;
  if (jumping && state.onGround) {
    worldY = 0.25;
    state.onGround = false;
  } else if (!state.onGround) {
    worldY = -0.25;
    state.onGround = true;
  }

  return { x: worldX, y: worldY, z: worldZ };
}

function getPacketModeLabel(useMovePlayer, useAuthInput) {
  if (useMovePlayer && useAuthInput) return 'move_player+player_auth_input';
  if (useMovePlayer) return 'move_player';
  if (useAuthInput) return 'player_auth_input';
  return 'none';
}

function formatMovementAuthorityLabel() {
  const playerAuthority = !state.movementMode.playerReady
    ? 'pending'
    : Date.now() < state.movementMode.activationAt
      ? 'warmup'
      : 'player';
  return `${playerAuthority}/server:${state.movementMode.authority}`;
}

function noteServerMotion(source) {
  const now = Date.now();
  const previous = state.movementDebug.lastServerMotionAt;
  state.movementDebug.lastServerMotionAt = now;
  state.movementDebug.lastNoServerMotionLogAt = 0;
  state.movementMode.authProbeUntil = 0;
  if (!previous || now - previous >= 1500) {
    log('movement-debug', `Server motion update from ${source}`);
  }
}

function noteServerProgress(previousPosition, nextPosition, source) {
  const prev = previousPosition || new Vec3(0, 0, 0);
  const next = nextPosition || new Vec3(0, 0, 0);
  const horizontalDistance = Math.hypot(next.x - prev.x, next.z - prev.z);
  const verticalDistance = Math.abs(next.y - prev.y);

  if (horizontalDistance >= 0.08 || verticalDistance >= 0.2) {
    state.movementDebug.lastServerProgressAt = Date.now();
    if (horizontalDistance >= 0.35 || verticalDistance >= 0.45) {
      state.movementDebug.lastObstacleAt = 0;
      state.movementDebug.obstacleActiveUntil = 0;
      state.movementDebug.obstacleStage = 0;
    } else if (state.movementDebug.obstacleStage > 0) {
      state.movementDebug.obstacleStage = Math.max(0, state.movementDebug.obstacleStage - 1);
    }
    if (state.timers.obstacleReset) {
      clearTimeout(state.timers.obstacleReset);
      state.timers.obstacleReset = null;
    }
    if (source) {
      log('movement-debug', `Server progress confirmed from ${source}: dXZ=${horizontalDistance.toFixed(2)} dY=${verticalDistance.toFixed(2)}`);
    }
  }

  const trail = state.navigation.serverTrail;
  const lastPoint = trail.length > 0 ? trail[trail.length - 1] : null;
  const trailDistance = lastPoint ? Math.hypot(next.x - lastPoint.x, next.z - lastPoint.z) : Number.POSITIVE_INFINITY;
  if (!lastPoint || trailDistance >= 1.0 || verticalDistance >= 0.9) {
    trail.push(new Vec3(next.x, next.y, next.z));
    if (trail.length > 18) trail.shift();
  }
}

function getBacktrackWaypoint() {
  const trail = state.navigation.serverTrail;
  if (trail.length < 4) return null;

  const current = state.serverPosition;
  for (let i = trail.length - 4; i >= 0; i -= 1) {
    const candidate = trail[i];
    const distance = Math.hypot(candidate.x - current.x, candidate.z - current.z);
    if (distance >= 1.4) return candidate;
  }

  return trail[0] || null;
}

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function rememberBlock(position, runtimeId) {
  if (!position) return;
  const x = Math.floor(Number(position.x) || 0);
  const y = Math.floor(Number(position.y) || 0);
  const z = Math.floor(Number(position.z) || 0);
  const key = blockKey(x, y, z);

  state.world.knownBlocks.delete(key);
  state.world.knownBlocks.set(key, {
    position: { x, y, z },
    runtimeId: Number(runtimeId) || 0,
    name: getBlockNameByRuntimeId(runtimeId),
    updatedAt: Date.now()
  });

  while (state.world.knownBlocks.size > state.world.maxKnownBlocks) {
    const oldestKey = state.world.knownBlocks.keys().next().value;
    if (!oldestKey) break;
    state.world.knownBlocks.delete(oldestKey);
  }
}

function getKnownBlock(x, y, z) {
  return state.world.knownBlocks.get(blockKey(Math.floor(x), Math.floor(y), Math.floor(z))) || null;
}

function getBlockNameByRuntimeId(runtimeId) {
  const entry = state.world.blockPalette[Number(runtimeId)];
  return entry?.name || 'unknown';
}

function isPassableBlockName(name) {
  if (!name || name === 'unknown') return null;
  if (
    name.includes('air') ||
    name.includes('cave_vines') ||
    name.includes('grass') ||
    name.includes('flower') ||
    name.includes('torch') ||
    name.includes('rail') ||
    name.includes('button') ||
    name.includes('tripwire') ||
    name.includes('carpet') ||
    name.includes('snow_layer') ||
    name.includes('sapling')
  ) {
    return true;
  }

  if (
    name.includes('water') ||
    name.includes('lava') ||
    name.includes('fire') ||
    name.includes('campfire') ||
    name.includes('magma')
  ) {
    return false;
  }

  return false;
}

function isDangerousBlockName(name) {
  if (!name || name === 'unknown') return false;
  return (
    name.includes('lava') ||
    name.includes('fire') ||
    name.includes('campfire') ||
    name.includes('magma') ||
    name.includes('cactus') ||
    name.includes('sweet_berry')
  );
}

function getFacingCardinal() {
  const yawRad = (state.yaw * Math.PI) / 180;
  const forward = {
    x: Math.round(-Math.sin(yawRad)),
    z: Math.round(Math.cos(yawRad))
  };

  if (forward.x === 0 && forward.z === 0) {
    return {
      forward: { x: 0, z: 1 },
      left: { x: -1, z: 0 },
      right: { x: 1, z: 0 }
    };
  }

  return {
    forward,
    left: { x: -forward.z, z: forward.x },
    right: { x: forward.z, z: -forward.x }
  };
}

function inspectFrontHazard() {
  const facing = getFacingCardinal();
  const origin = state.serverPosition || state.position;
  const baseX = Math.floor(origin.x);
  const baseY = Math.floor(origin.y);
  const baseZ = Math.floor(origin.z);

  const frontFoot = getKnownBlock(baseX + facing.forward.x, baseY, baseZ + facing.forward.z);
  const frontHead = getKnownBlock(baseX + facing.forward.x, baseY + 1, baseZ + facing.forward.z);
  const belowFront = getKnownBlock(baseX + facing.forward.x, baseY - 1, baseZ + facing.forward.z);

  if (frontFoot && isDangerousBlockName(frontFoot.name)) {
    return { reason: `dangerous-front-${frontFoot.name}`, turnDirection: chooseTurnDirection(), source: 'block-probe' };
  }

  if (frontHead && isDangerousBlockName(frontHead.name)) {
    return { reason: `dangerous-head-${frontHead.name}`, turnDirection: chooseTurnDirection(), source: 'block-probe' };
  }

  const footPassable = frontFoot ? isPassableBlockName(frontFoot.name) : null;
  const headPassable = frontHead ? isPassableBlockName(frontHead.name) : null;
  if (footPassable === false || headPassable === false) {
    const leftBlock = getKnownBlock(baseX + facing.left.x, baseY, baseZ + facing.left.z);
    const rightBlock = getKnownBlock(baseX + facing.right.x, baseY, baseZ + facing.right.z);
    const leftPassable = leftBlock ? isPassableBlockName(leftBlock.name) !== false : true;
    const rightPassable = rightBlock ? isPassableBlockName(rightBlock.name) !== false : true;
    const turnDirection = leftPassable && !rightPassable ? -1 : rightPassable && !leftPassable ? 1 : chooseTurnDirection();
    return { reason: 'blocked-front', turnDirection, jumpSuggested: state.onGround && !!frontFoot && !frontHead, source: 'block-probe' };
  }

  if (belowFront) {
    if (isDangerousBlockName(belowFront.name)) {
      return { reason: `dangerous-below-${belowFront.name}`, turnDirection: chooseTurnDirection(), source: 'block-probe' };
    }

    const belowPassable = isPassableBlockName(belowFront.name);
    if (belowPassable === true) {
      return { reason: 'unsafe-drop', turnDirection: chooseTurnDirection(), source: 'block-probe' };
    }
  }

  return null;
}

function avoidObstacle(reason = 'stuck', options = {}) {
  if (!isReady()) return;

  const now = Date.now();
  if (state.movementDebug.obstacleActiveUntil > now) return;
  if (now - state.movementDebug.lastObstacleAt < 1200) return;

  if (now - state.movementDebug.lastObstacleAt > 4500) {
    state.movementDebug.obstacleStage = 0;
  }

  state.movementDebug.lastObstacleAt = now;
  let stage = Math.min(state.movementDebug.obstacleStage + 1, 4);
  let turnDirection = options.turnDirection || state.movementDebug.obstacleTurnBias || chooseTurnDirection();
  if (stage >= 4 && now - state.movementDebug.lastServerProgressAt > 3500) {
    turnDirection *= -1;
    stage = 3;
  }

  state.movementDebug.obstacleStage = stage;
  state.movementDebug.obstacleTurnBias = turnDirection;

  let maneuverMs = randInt(500, 900);
  let turnAmount = randFloat(28, 65) * turnDirection;
  let jumpChance = 0.72;
  let useBacktrack = false;

  if (stage === 2) {
    maneuverMs = randInt(900, 1400);
    turnAmount = randFloat(55, 95) * turnDirection;
    jumpChance = 0.6;
  } else if (stage === 3) {
    maneuverMs = randInt(1400, 2100);
    turnAmount = randFloat(95, 140) * turnDirection;
    jumpChance = 0.45;
  } else if (stage === 4) {
    maneuverMs = randInt(2200, 3200);
    turnAmount = randFloat(18, 38) * turnDirection;
    jumpChance = 0.18;
    useBacktrack = true;
  }

  state.movementDebug.obstacleActiveUntil = now + maneuverMs;

  const strafeLeft = turnDirection < 0;
  const backtrackWaypoint = useBacktrack ? getBacktrackWaypoint() : null;
  if (backtrackWaypoint) {
    const backtrackAngles = getLookAngles(backtrackWaypoint);
    rotateBy(normalizeAngle(backtrackAngles.yaw - state.yaw), randFloat(-2, 2));
  } else {
    rotateBy(turnAmount, randFloat(-2, 2));
  }
  if (options.jumpSuggested && state.onGround) {
    triggerJump(randInt(110, 210));
  } else if (state.onGround && Math.random() < jumpChance) {
    triggerJump(randInt(120, 240));
  }

  setControlState({
    forward: true,
    back: false,
    left: !backtrackWaypoint && strafeLeft,
    right: !backtrackWaypoint && !strafeLeft
  });

  log(
    'movement',
    `Obstacle avoidance stage=${stage}: ${reason}, ${backtrackWaypoint ? `backtrack=${formatVec3(backtrackWaypoint)}` : `turn=${turnAmount.toFixed(1)} strafe=${strafeLeft ? 'left' : 'right'}`} window=${maneuverMs}ms mode=${state.ai.mode} state=${state.ai.state}`
  );

  if (state.timers.obstacleReset) clearTimeout(state.timers.obstacleReset);
  state.timers.obstacleReset = setTimeout(() => {
    state.timers.obstacleReset = null;
    state.movementDebug.obstacleActiveUntil = 0;
    setControlState({
      forward: true,
      back: false,
      left: false,
      right: false
    });
  }, randInt(420, 760));
}

function updateMovement(context = {}) {
  if (!isReady()) {
    return {
      moveVec: getMoveVectorFromControl(),
      hazard: null
    };
  }

  const initialMoveVec = getMoveVectorFromControl();
  const tryingMove = initialMoveVec.x !== 0 || initialMoveVec.z !== 0 || state.control.jump;
  if (!tryingMove) {
    return {
      moveVec: initialMoveVec,
      hazard: null
    };
  }

  const hazard = inspectFrontHazard();
  if (hazard) {
    avoidObstacle(hazard.reason, hazard);
  } else if (
    context.playerReady &&
    context.isTryingWalk &&
    context.msSinceSpawn >= 3000 &&
    context.msWithoutServerProgress >= 1400
  ) {
    avoidObstacle(`no-progress-${context.msWithoutServerProgress}ms`, {
      turnDirection: chooseTurnDirection()
    });
  }

  return {
    moveVec: getMoveVectorFromControl(),
    hazard
  };
}

function queueSpawnBootstrapPackets(stage = 'all') {
  if (!state.client || !state.connected || !state.runtimeEntityId) return;

  const zeroPos = { x: 0, y: 0, z: 0 };

  try {
    if ((stage === 'phase1' || stage === 'all') && !state.movementMode.phase1BootstrapSent) {
      state.client.queue('serverbound_loading_screen', {
        type: 1
      });
      state.movementMode.phase1BootstrapSent = true;
      log('movement-debug', 'Sent spawn bootstrap phase1 (loading screen start).');
    }

    if ((stage === 'phase2' || stage === 'all') && !state.movementMode.phase2BootstrapSent) {
      state.client.queue('serverbound_loading_screen', {
        type: 2
      });
      state.client.queue('interact', {
        action_id: 'mouse_over_entity',
        target_entity_id: 0n,
        has_position: true,
        position: zeroPos
      });
      state.movementMode.phase2BootstrapSent = true;
      log('movement-debug', 'Sent spawn bootstrap phase2 (loading screen end, interact).');
    }
  } catch (err) {
    log('movement-debug', `Spawn bootstrap packet error: ${err.message}`);
  }
}

function startMovementLoop(sessionId) {
  if (state.timers.movementLoop) clearInterval(state.timers.movementLoop);

  log('movement-loop', 'Starting continuous player_auth_input loop (20 TPS)');
  state.movementDebug.tick = 0;
  state.movementDebug.lastLogAt = 0;
  state.movementDebug.lastPacketMode = '';
  state.movementDebug.lastNoServerMotionLogAt = 0;
  state.movementDebug.lastControlSnapshot = formatControlSnapshot();
  state.movementDebug.lastServerProgressAt = Date.now();
  state.movementDebug.lastObstacleAt = 0;
  state.movementDebug.obstacleActiveUntil = 0;
  state.movementDebug.obstacleStage = 0;
  state.movementDebug.obstacleTurnBias = 0;
  state.navigation.serverTrail = [];

  state.timers.movementLoop = setInterval(() => {
    if (sessionId !== state.sessionId) return;
    if (!isReady()) return;

    const now = Date.now();
    const authority = state.movementMode.authority;
    const playerReady = state.movementMode.playerReady && now >= state.movementMode.activationAt;
    const msSinceSpawn = state.movementMode.spawnAt ? now - state.movementMode.spawnAt : Number.POSITIVE_INFINITY;
    const msWithoutServerMotion = state.movementDebug.lastServerMotionAt
      ? now - state.movementDebug.lastServerMotionAt
      : Number.POSITIVE_INFINITY;
    const msWithoutServerProgress = state.movementDebug.lastServerProgressAt
      ? now - state.movementDebug.lastServerProgressAt
      : Number.POSITIVE_INFINITY;
    const previewMoveVec = getMoveVectorFromControl();
    const jumping = state.control.jump;
    const isTryingWalk = previewMoveVec.z !== 0;
    const movementPlan = updateMovement({
      now,
      playerReady,
      msSinceSpawn,
      msWithoutServerProgress,
      isTryingWalk
    });
    const moveVec = movementPlan.moveVec;
    const isTryingMove = moveVec.x !== 0 || moveVec.z !== 0 || state.control.jump;

    if (!playerReady && now - state.movementDebug.lastNoServerMotionLogAt >= 1500) {
      state.movementDebug.lastNoServerMotionLogAt = now;
      const waitReason = state.movementMode.playerReady
        ? `warmup-until-${new Date(state.movementMode.activationAt).toISOString()}`
        : state.movementMode.playerReadyReason;
      log('movement-debug', `Holding movement packets until player authority is granted (${waitReason}).`);
    }

    if (!isTryingMove) {
      state.movementMode.lastSuppressedLogAt = 0;
    }

    const useMovePlayer = false;
    const useAuthInput = playerReady;
    const packetMode = getPacketModeLabel(useMovePlayer, useAuthInput);

    const inputFlags = {};
    if (state.control.sprint) {
      inputFlags.sprinting = true;
      inputFlags.start_sprinting = true;
    }
    if (state.control.sneak) {
      inputFlags.sneaking = true;
      inputFlags.start_sneaking = true;
    }
    if (MC_AUTH_INPUT_PROFILE.includes('camera')) {
      inputFlags.camera_relative_movement_enabled = true;
    }

    try {
      if (packetMode !== state.movementDebug.lastPacketMode) {
        state.movementDebug.lastPacketMode = packetMode;
        log('movement-debug', `Packet path -> ${packetMode} (authority=${formatMovementAuthorityLabel()})`);
      }

      const moveDelta = computeMotionDelta(moveVec, jumping);
      const authInputPosition = state.serverPosition;

      if (useAuthInput) {
        state.position = state.position.plus(new Vec3(moveDelta.x, moveDelta.y, moveDelta.z));
        queuePlayerAuthInput(authInputPosition, moveVec, moveDelta, jumping, inputFlags);
      } else if (!playerReady) {
        state.position = new Vec3(state.serverPosition.x, state.serverPosition.y, state.serverPosition.z);
      }

      if (playerReady && isTryingMove && useAuthInput) {
        if (msWithoutServerMotion >= 1500 && now - state.movementDebug.lastNoServerMotionLogAt >= 1500) {
          state.movementDebug.lastNoServerMotionLogAt = now;
          log(
            'movement-debug',
            `No server motion feedback for ${msWithoutServerMotion}ms while continuing ${packetMode} vec=(${moveVec.x.toFixed(2)},${moveVec.z.toFixed(2)}) predicted=${formatVec3(state.position)} server=${formatVec3(state.serverPosition)}`
          );
        }
      }

    } catch (err) {
      log('movement-loop', `Packet write error: ${err.message}`);
    }

    state.movementDebug.tick += 1;

    if (now - state.movementDebug.lastLogAt >= 1000) {
      log(
        'movement-loop',
        `tick=${state.movementDebug.tick} authority=${formatMovementAuthorityLabel()} packets=${packetMode} controls=${formatControlSnapshot()} vec=(${moveVec.x.toFixed(2)},${moveVec.z.toFixed(2)}) predicted=${formatVec3(state.position)} server=${formatVec3(state.serverPosition)} yaw=${state.yaw.toFixed(1)} yawDelta=${state.movementDebug.lastYawDelta.toFixed(2)} pitch=${state.pitch.toFixed(1)} mode=${state.ai.mode} state=${state.ai.state} target=${formatTargetLabel()}`
      );
      state.movementDebug.lastLogAt = now;
    }
  }, 50);
}

const BEHAVIOR_STATES = Object.freeze({
  IDLE: 'IDLE',
  WANDERING: 'WANDERING',
  EXPLORING: 'EXPLORING',
  LOOKING_AROUND: 'LOOKING_AROUND',
  INTERACTING: 'INTERACTING',
  FOLLOWING: 'FOLLOWING'
});

function normalizeAngle(delta) {
  let result = delta;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function rotateBy(deltaYaw, deltaPitch = 0) {
  state.movementDebug.lastYawDelta = deltaYaw;
  state.yaw = (state.yaw + deltaYaw + 360) % 360;
  state.headYaw = state.yaw;
  state.pitch = Math.max(-89, Math.min(89, state.pitch + deltaPitch));
}

function getLookAngles(targetPos) {
  const dx = targetPos.x - state.position.x;
  const dy = targetPos.y - state.position.y;
  const dz = targetPos.z - state.position.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);

  const yaw = ((Math.atan2(-dx, dz) * 180) / Math.PI + 360) % 360;
  const pitch = Math.max(-89, Math.min(89, (-Math.atan2(dy, horizontal || 0.0001) * 180) / Math.PI));
  return { yaw, pitch };
}

function getViewDirection(yaw = state.yaw, pitch = state.pitch) {
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;

  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad)
  };
}

function getEyePosition(position = state.position) {
  return new Vec3(position.x, position.y + 1.62, position.z);
}

function getEntityFocusPosition(entity) {
  if (!entity?.position) return null;
  const eyeHeight = entity.type === 'player' ? 1.62 : 0.9;
  return new Vec3(entity.position.x, entity.position.y + eyeHeight, entity.position.z);
}

function getLookTarget(maxDistance = 18, maxAngleDeg = 18) {
  if (!isReady()) return null;

  const eyePos = getEyePosition();
  const viewDir = getViewDirection();
  let best = null;

  for (const entity of state.entities.values()) {
    if (!entity?.position) continue;
    if (entity.username && entity.username.toLowerCase() === MC_USERNAME.toLowerCase()) continue;

    const focusPos = getEntityFocusPosition(entity);
    if (!focusPos) continue;

    const dx = focusPos.x - eyePos.x;
    const dy = focusPos.y - eyePos.y;
    const dz = focusPos.z - eyePos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!distance || distance > maxDistance) continue;

    const alignment = (dx * viewDir.x + dy * viewDir.y + dz * viewDir.z) / distance;
    const clampedAlignment = Math.max(-1, Math.min(1, alignment));
    const angleDeg = (Math.acos(clampedAlignment) * 180) / Math.PI;
    if (angleDeg > maxAngleDeg) continue;

    if (
      !best ||
      clampedAlignment > best.alignment + 0.01 ||
      (Math.abs(clampedAlignment - best.alignment) <= 0.01 && distance < best.distance)
    ) {
      best = {
        entity,
        distance,
        angleDeg,
        alignment: clampedAlignment,
        focusPos
      };
    }
  }

  return best;
}

function describeLookSample() {
  if (!isReady()) return 'not spawned yet';

  const target = getLookTarget();
  if (target) {
    const name = target.entity.username || target.entity.type || 'entity';
    return `seeing ${name} ${target.distance.toFixed(1)} blocks ahead`;
  }

  const eyePos = getEyePosition();
  const viewDir = getViewDirection();
  const sampleDistance = 6;
  const samplePoint = new Vec3(
    eyePos.x + viewDir.x * sampleDistance,
    eyePos.y + viewDir.y * sampleDistance,
    eyePos.z + viewDir.z * sampleDistance
  );

  return `no tracked target, looking toward ${samplePoint.x.toFixed(1)} ${samplePoint.y.toFixed(1)} ${samplePoint.z.toFixed(1)}`;
}

function shouldAbortAction(actionVersion, abortIf = null) {
  if (!isReady()) return true;
  if (actionVersion !== undefined && actionVersion !== state.ai.actionVersion) return true;
  return typeof abortIf === 'function' && abortIf();
}

function bumpActionVersion(reason = 'interrupt') {
  state.ai.actionVersion += 1;
  resetControlState();
  log('behavior', `Action version -> ${state.ai.actionVersion} (${reason})`);
  return state.ai.actionVersion;
}

async function smoothRotateTo(targetYaw, targetPitch, durationMs = randInt(500, 1800), options = {}) {
  if (!isReady()) return false;

  const steps = Math.max(3, Math.floor(durationMs / randInt(120, 240)));
  for (let i = 0; i < steps; i += 1) {
    if (shouldAbortAction(options.actionVersion, options.abortIf)) return false;

    const remaining = Math.max(1, steps - i);
    const yawDelta = normalizeAngle(targetYaw - state.yaw) / remaining + randFloat(-0.7, 0.7);
    const pitchDelta = (targetPitch - state.pitch) / remaining + randFloat(-0.45, 0.45);
    rotateBy(yawDelta, pitchDelta);

    await delay(randInt(90, 220));
  }

  return true;
}

function rememberTurnDirection(direction) {
  state.ai.turnHistory.push(direction);
  if (state.ai.turnHistory.length > 6) state.ai.turnHistory.shift();
}

function chooseTurnDirection() {
  const recent = state.ai.turnHistory.slice(-3);
  const allSame = recent.length === 3 && recent.every((d) => d === recent[0]);
  if (allSame) return recent[0] * -1;
  return Math.random() < 0.5 ? -1 : 1;
}

function setFollowTarget(player, command = 'follow') {
  if (!player) return;
  state.ai.followTargetId = String(player.id || player.runtimeId || player.runtime_id || '');
  state.ai.followTargetName = player.username || state.ai.followTargetName || state.ai.followTargetId;
  state.ai.followCommand = command;
  state.ai.followOnce = command === 'come';
}

function clearFollowTarget() {
  state.ai.followTargetId = null;
  state.ai.followTargetName = null;
  state.ai.followCommand = null;
  state.ai.followOnce = false;
}

function setAiMode(mode, reason, options = {}) {
  const previousMode = state.ai.mode;
  if (mode === AI_MODES.FOLLOW && options.target) {
    setFollowTarget(options.target, options.command || 'follow');
  } else if (mode === AI_MODES.AUTONOMOUS) {
    clearFollowTarget();
  }

  state.ai.mode = mode;
  state.ai.lastActionAt = Date.now();
  state.ai.nextStateSwitchAt = 0;
  bumpActionVersion(`mode-${mode.toLowerCase()}-${reason}`);

  if (mode === AI_MODES.FOLLOW) {
    state.ai.state = BEHAVIOR_STATES.FOLLOWING;
  } else {
    state.ai.state = BEHAVIOR_STATES.WANDERING;
    rememberStateTransition(BEHAVIOR_STATES.WANDERING);
  }

  log(
    'behavior',
    `Mode ${previousMode} -> ${state.ai.mode} (${reason}) target=${formatTargetLabel()} command=${state.ai.followCommand || 'none'}`
  );
}

function findPlayerByUsername(username) {
  if (!username) return null;

  const normalized = username.trim().toLowerCase();
  let partialMatch = null;

  for (const entity of state.entities.values()) {
    if (entity.type !== 'player' || !entity.position || !entity.username) continue;
    if (entity.username.toLowerCase() === MC_USERNAME.toLowerCase()) continue;
    if (entity.username.toLowerCase() === normalized) return entity;
    if (!partialMatch && entity.username.toLowerCase().includes(normalized)) {
      partialMatch = entity;
    }
  }

  return partialMatch;
}

async function moveForward(durationMs = randInt(2000, 6000), options = {}) {
  if (!isReady()) return false;

  const {
    slow = false,
    hesitant = true,
    continuous = false,
    allowJump = true,
    targetPos = null,
    drift = 4.6,
    hesitationChance = hesitant ? 0.12 : 0,
    strafeChance = 0.12,
    jumpChance = slow ? 0.03 : 0.08,
    longPauseChance = 0.1,
    abortIf = null,
    actionVersion = state.ai.actionVersion
  } = options;
  const start = Date.now();

  setControlState({
    forward: true,
    back: false,
    left: false,
    right: false,
    sprint: !slow && Math.random() < 0.22,
    sneak: false
  });

  log('movement', `moveForward start (${durationMs}ms) ${formatAiSummary()}`);

  try {
    while (Date.now() - start < durationMs) {
      if (shouldAbortAction(actionVersion, abortIf)) {
        log('movement', 'moveForward interrupted');
        return false;
      }

      if (targetPos) {
        const angles = getLookAngles(targetPos);
        const deltaToTarget = normalizeAngle(angles.yaw - state.yaw);
        rotateBy(Math.max(-4.5, Math.min(4.5, deltaToTarget)) + randFloat(-0.8, 0.8), randFloat(-0.35, 0.35));
      } else {
        rotateBy(randFloat(-drift, drift), randFloat(-0.3, 0.3));
      }

      if (!continuous && hesitationChance > 0 && Math.random() < hesitationChance) {
        setControlState({ forward: false, left: false, right: false, sprint: false });
        state.ai.lastPauseAt = Date.now();
        await delay(randInt(220, 680));
        setControlState({ forward: true, sprint: !slow && Math.random() < 0.2 });
      }

      if (strafeChance > 0 && Math.random() < strafeChance) {
        const strafeLeft = Math.random() < 0.5;
        setControlState({ left: strafeLeft, right: !strafeLeft });
        await delay(randInt(140, 360));
        setControlState({ left: false, right: false });
      }

      if (allowJump && state.onGround && Math.random() < jumpChance) {
        triggerJump(randInt(110, 240));
      }

      if (!continuous && longPauseChance > 0 && Math.random() < longPauseChance) {
        setControlState({ forward: false, left: false, right: false, sprint: false });
        state.ai.lastPauseAt = Date.now();
        await delay(randInt(500, 1600));
        setControlState({ forward: true, sprint: !slow && Math.random() < 0.18 });
      }

      await delay(randInt(120, 280));
    }

    return true;
  } finally {
    setControlState({
      forward: false,
      back: false,
      left: false,
      right: false,
      sprint: false,
      sneak: false
    });
    log('movement', `moveForward end ${formatAiSummary()}`);
  }
}

async function randomTurn(minDeg = 20, maxDeg = 120, options = {}) {
  if (!isReady()) return false;

  const direction = options.direction || chooseTurnDirection();
  const doWideTurn = !!options.wide;
  const turnAmount = doWideTurn ? randFloat(Math.max(90, minDeg), Math.max(130, maxDeg)) : randFloat(minDeg, maxDeg);
  const targetYaw = (state.yaw + direction * turnAmount + 360) % 360;
  const targetPitch = Math.max(-45, Math.min(45, state.pitch + randFloat(-5, 5)));

  rememberTurnDirection(direction);
  return smoothRotateTo(targetYaw, targetPitch, randInt(500, 1600), options);
}

function getNearestEntity(maxDistance = 16) {
  if (!isReady()) return null;

  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const origin = state.serverPosition || state.position;

  for (const entity of state.entities.values()) {
    if (!entity.position) continue;
    const dist = origin.distanceTo(entity.position);
    if (dist < bestDist && dist <= maxDistance) {
      best = entity;
      bestDist = dist;
    }
  }

  return best ? { ...best, distance: bestDist } : null;
}

function getNearestPlayer(maxDistance = 16) {
  if (!isReady()) return null;

  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const origin = state.serverPosition || state.position;

  for (const entity of state.entities.values()) {
    if (entity.type !== 'player' || !entity.position) continue;
    if (entity.username && entity.username.toLowerCase() === MC_USERNAME.toLowerCase()) continue;

    const dist = origin.distanceTo(entity.position);
    if (dist < bestDist && dist <= maxDistance) {
      best = entity;
      bestDist = dist;
    }
  }

  return best ? { ...best, distance: bestDist } : null;
}

function getFollowTarget(maxDistance = MC_FOLLOW_RANGE) {
  if (!isReady()) return null;

  let target = null;
  if (state.ai.followTargetId) {
    target = state.entities.get(String(state.ai.followTargetId)) || null;
  }

  if (!target && state.ai.followTargetName) {
    target = findPlayerByUsername(state.ai.followTargetName);
    if (target) {
      state.ai.followTargetId = String(target.id);
      state.ai.followTargetName = target.username || state.ai.followTargetName;
    }
  }

  if (!target?.position || target.type !== 'player') return null;

  const distance = (state.serverPosition || state.position).distanceTo(target.position);
  if (distance > maxDistance) return null;
  return { ...target, distance };
}

async function lookAtPosition(targetPos, durationMs = randInt(500, 1400), options = {}) {
  if (!isReady() || !targetPos) return false;
  const angles = getLookAngles(targetPos);
  return smoothRotateTo(angles.yaw, angles.pitch, durationMs, options);
}

async function lookAround(durationMs = randInt(1000, 4500), focusEntity = null, options = {}) {
  if (!isReady()) return false;

  const start = Date.now();
  while (Date.now() - start < durationMs) {
    if (shouldAbortAction(options.actionVersion, options.abortIf)) return false;

    let focus = focusEntity;
    if (focusEntity?.id) {
      focus = state.entities.get(String(focusEntity.id)) || focusEntity;
    }

    if (focus?.position && Math.random() < 0.72) {
      const focusPos = getEntityFocusPosition(focus) || focus.position;
      const rotated = await lookAtPosition(focusPos, randInt(380, 1100), options);
      if (!rotated) return false;
      await delay(randInt(160, 520));
    } else {
      const turned = await randomTurn(8, 40, { ...options, wide: false });
      if (!turned) return false;
      rotateBy(randFloat(-4, 4), randFloat(-9, 9));
      await delay(randInt(150, 500));
    }
  }

  return true;
}

async function followPlayer(player, options = {}) {
  if (!isReady() || !player) return 'lost';

  const {
    durationMs = randInt(2600, 5200),
    actionVersion = state.ai.actionVersion,
    once = state.ai.followOnce
  } = options;
  const start = Date.now();
  const holdDistance = once ? 2.6 : 3.2;

  while (Date.now() - start < durationMs) {
    if (shouldAbortAction(actionVersion)) return 'aborted';

    const target = getFollowTarget();
    if (!target?.position) return 'lost';

    const targetFocus = getEntityFocusPosition(target) || target.position;
    await lookAtPosition(targetFocus, randInt(260, 620), {
      actionVersion,
      abortIf: () => !getFollowTarget()
    });

    if (target.distance > MC_FOLLOW_RANGE) return 'lost';

    if (target.distance <= holdDistance) {
      resetControlState();
      if (once) return 'arrived';
      await delay(randInt(200, 600));
      return 'holding';
    }

    if (target.distance < 2.2) {
      setControlState({ back: true, forward: false, left: false, right: false });
      await delay(randInt(220, 480));
      resetControlState();
      return 'holding';
    }

    if (Math.random() < 0.14) {
      resetControlState();
      state.ai.lastPauseAt = Date.now();
      await delay(randInt(180, 520));
    }

    await moveForward(randInt(900, 1800), {
      slow: target.distance < 5,
      hesitant: false,
      continuous: true,
      allowJump: true,
      targetPos: target.position,
      drift: target.distance > 7 ? 2.8 : 1.7,
      hesitationChance: 0,
      strafeChance: 0.05,
      jumpChance: target.distance > 6 ? 0.07 : 0.03,
      longPauseChance: 0,
      actionVersion,
      abortIf: () => {
        const liveTarget = getFollowTarget();
        return !liveTarget || liveTarget.distance <= holdDistance;
      }
    });
  }

  return once ? 'timeout' : 'tracking';
}

async function interactRandomly(actionVersion = state.ai.actionVersion) {
  if (!isReady()) return false;

  const target = getNearestEntity(8);
  if (target?.position) {
    await lookAtPosition(getEntityFocusPosition(target) || target.position, randInt(350, 900), { actionVersion });
  } else {
    await lookAround(randInt(800, 1800), null, { actionVersion });
  }

  if (shouldAbortAction(actionVersion)) return false;

  const swings = randInt(1, 3);
  for (let i = 0; i < swings; i += 1) {
    queueSwingArm();
    await delay(randInt(140, 420));
  }

  if (Math.random() < 0.1) {
    triggerJump(randInt(100, 220));
  }

  return true;
}

function rememberStateTransition(nextState) {
  if (nextState === BEHAVIOR_STATES.FOLLOWING) return;
  state.ai.recentStates.push(nextState);
  if (state.ai.recentStates.length > 8) state.ai.recentStates.shift();
}

function weightedChoice(weightMap) {
  const entries = Object.entries(weightMap).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return BEHAVIOR_STATES.WANDERING;

  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }

  return entries[entries.length - 1][0];
}

function chooseAutonomousState() {
  const weights = {
    [BEHAVIOR_STATES.IDLE]: 1.1,
    [BEHAVIOR_STATES.WANDERING]: 3.6,
    [BEHAVIOR_STATES.EXPLORING]: 2.7,
    [BEHAVIOR_STATES.LOOKING_AROUND]: 1.6,
    [BEHAVIOR_STATES.INTERACTING]: 1.2
  };

  if (weights[state.ai.state]) {
    weights[state.ai.state] *= 0.28;
  }

  for (const previous of state.ai.recentStates.slice(-3)) {
    if (weights[previous]) {
      weights[previous] *= 0.55;
    }
  }

  if (Date.now() - state.ai.lastPauseAt > 12000) {
    weights[BEHAVIOR_STATES.IDLE] *= 1.2;
    weights[BEHAVIOR_STATES.LOOKING_AROUND] *= 1.15;
  }

  return weightedChoice(weights);
}

function setBehaviorState(nextState, reason = 'timer', options = {}) {
  if (state.ai.state !== nextState || options.force) {
    log('behavior', `State ${state.ai.state} -> ${nextState} (${reason}) mode=${state.ai.mode} target=${formatTargetLabel()}`);
  }

  state.ai.state = nextState;
  const durations = {
    [BEHAVIOR_STATES.IDLE]: [2000, 4500],
    [BEHAVIOR_STATES.WANDERING]: [3500, 8000],
    [BEHAVIOR_STATES.EXPLORING]: [4500, 10000],
    [BEHAVIOR_STATES.LOOKING_AROUND]: [2200, 5000],
    [BEHAVIOR_STATES.INTERACTING]: [2500, 6000],
    [BEHAVIOR_STATES.FOLLOWING]: [2500, 5500]
  };
  const [minMs, maxMs] = durations[nextState] || [2500, 6000];
  state.ai.nextStateSwitchAt = Date.now() + randInt(minMs, maxMs);
  state.ai.lastActionAt = Date.now();
  rememberStateTransition(nextState);
}

async function decideNextAction(actionVersion = state.ai.actionVersion) {
  state.ai.lastActionAt = Date.now();

  if (state.ai.mode === AI_MODES.FOLLOW) {
    if (state.ai.state !== BEHAVIOR_STATES.FOLLOWING) {
      setBehaviorState(BEHAVIOR_STATES.FOLLOWING, 'follow-mode', { force: true });
    }

    const target = getFollowTarget();
    if (!target) {
      log('behavior', `Follow target unavailable, returning to autonomous mode target=${formatTargetLabel()}`);
      setAiMode(AI_MODES.AUTONOMOUS, 'follow-target-missing');
      return;
    }

    const result = await followPlayer(target, {
      durationMs: randInt(2200, 5200),
      actionVersion,
      once: state.ai.followOnce
    });

    log('behavior', `followPlayer result=${result} ${formatAiSummary()}`);
    if (state.ai.followOnce && result === 'arrived') {
      setAiMode(AI_MODES.AUTONOMOUS, 'come-arrived');
      return;
    }

    if (state.ai.followOnce && (result === 'lost' || result === 'timeout')) {
      setAiMode(AI_MODES.AUTONOMOUS, `come-${result}`);
    }

    return;
  }

  if (!state.ai.nextStateSwitchAt || Date.now() >= state.ai.nextStateSwitchAt || state.ai.state === BEHAVIOR_STATES.FOLLOWING) {
    setBehaviorState(chooseAutonomousState(), state.ai.nextStateSwitchAt ? 'timer' : 'init');
  }

  const nearbyPlayer = getNearestPlayer(10);
  switch (state.ai.state) {
    case BEHAVIOR_STATES.IDLE:
      if (Math.random() < 0.78) {
        await lookAround(randInt(1200, 3200), nearbyPlayer, { actionVersion });
      } else {
        await delay(randInt(700, 1800));
      }
      if (Math.random() < 0.18) queueSwingArm();
      return;

    case BEHAVIOR_STATES.WANDERING:
      rotateBy(randFloat(-8, 8), randFloat(-1.1, 1.1));
      await moveForward(randInt(2600, 6000), {
        slow: false,
        hesitant: true,
        continuous: false,
        drift: 3.1,
        strafeChance: 0.05,
        jumpChance: 0.04,
        longPauseChance: 0.1,
        actionVersion
      });
      return;

    case BEHAVIOR_STATES.EXPLORING:
      await randomTurn(20, 95, {
        actionVersion,
        wide: Math.random() < 0.24
      });
      await moveForward(randInt(3200, 7600), {
        slow: false,
        hesitant: false,
        continuous: true,
        drift: 4.4,
        strafeChance: 0.06,
        jumpChance: 0.05,
        longPauseChance: 0,
        actionVersion
      });
      if (Math.random() < 0.35) {
        await lookAround(randInt(1000, 2200), nearbyPlayer, { actionVersion });
      }
      return;

    case BEHAVIOR_STATES.LOOKING_AROUND:
      await lookAround(randInt(1600, 4200), nearbyPlayer, { actionVersion });
      return;

    case BEHAVIOR_STATES.INTERACTING:
      await interactRandomly(actionVersion);
      return;

    default:
      setBehaviorState(BEHAVIOR_STATES.WANDERING, 'fallback');
  }
}

function scheduleDecisionLoop(sessionId) {
  if (state.timers.decision) clearTimeout(state.timers.decision);

  state.timers.decision = setTimeout(async () => {
    if (sessionId !== state.sessionId) return;

    let acquiredLock = false;
    try {
      if (!isReady() || state.ai.busy) return;
      state.ai.busy = true;
      acquiredLock = true;
      const actionVersion = state.ai.actionVersion;
      await decideNextAction(actionVersion);
    } catch (err) {
      log('behavior', `Decision error: ${err.message}`);
    } finally {
      if (acquiredLock) state.ai.busy = false;
      scheduleDecisionLoop(sessionId);
    }
  }, randInt(450, 900));
}

function scheduleLookLoop(sessionId) {
  if (state.timers.look) clearTimeout(state.timers.look);

  state.timers.look = setTimeout(async () => {
    if (sessionId !== state.sessionId) return;
    try {
      if (!isReady() || state.ai.busy) return;

      if (state.ai.mode === AI_MODES.FOLLOW) {
        const target = getFollowTarget();
        if (target?.position && Math.random() < 0.6) {
          await lookAtPosition(getEntityFocusPosition(target) || target.position, randInt(220, 700), {
            actionVersion: state.ai.actionVersion
          });
        }
        return;
      }

      if (state.ai.state !== BEHAVIOR_STATES.IDLE && state.ai.state !== BEHAVIOR_STATES.LOOKING_AROUND) return;
      if (Math.random() < 0.45) return;

      const nearbyPlayer = getNearestPlayer(8);
      if (nearbyPlayer?.position && Math.random() < 0.5) {
        await lookAtPosition(getEntityFocusPosition(nearbyPlayer) || nearbyPlayer.position, randInt(250, 700), {
          actionVersion: state.ai.actionVersion
        });
      } else {
        rotateBy(randFloat(-6, 6), randFloat(-4, 4));
      }
    } catch (err) {
      log('behavior', `Look loop error: ${err.message}`);
    } finally {
      scheduleLookLoop(sessionId);
    }
  }, randInt(900, 2200));
}

function scheduleActivityLoop(sessionId) {
  if (state.timers.activity) clearTimeout(state.timers.activity);

  state.timers.activity = setTimeout(async () => {
    if (sessionId !== state.sessionId) return;

    try {
      if (!isReady() || state.ai.busy) return;

      const idleForMs = Date.now() - (state.ai.lastActionAt || 0);
      const isStandingStill =
        !state.control.forward &&
        !state.control.back &&
        !state.control.left &&
        !state.control.right;

      if (Math.random() < 0.22) {
        rotateBy(randFloat(-7, 7), randFloat(-4, 4));
      }
      if (Math.random() < 0.12 && state.ai.mode === AI_MODES.AUTONOMOUS) {
        queueSwingArm();
      }

      if (state.ai.mode === AI_MODES.AUTONOMOUS && isStandingStill && idleForMs > 4200) {
        setBehaviorState(Math.random() < 0.65 ? BEHAVIOR_STATES.WANDERING : BEHAVIOR_STATES.EXPLORING, 'anti-idle', {
          force: true
        });
      }
    } catch (err) {
      log('behavior', `Activity loop error: ${err.message}`);
    } finally {
      scheduleActivityLoop(sessionId);
    }
  }, randInt(2200, 4800));
}

function startBehaviorSystem(sessionId) {
  state.ai.mode = AI_MODES.AUTONOMOUS;
  state.ai.busy = false;
  state.ai.lastActionAt = Date.now();
  state.ai.recentStates = [BEHAVIOR_STATES.WANDERING];
  state.ai.turnHistory = [];
  state.ai.lastPauseAt = 0;
  clearFollowTarget();
  bumpActionVersion('spawn-start');
  setBehaviorState(BEHAVIOR_STATES.WANDERING, 'spawn-bootstrap', { force: true });

  log('behavior', `Behavior system online ${formatAiSummary()}`);

  startMovementLoop(sessionId);
  scheduleDecisionLoop(sessionId);
  scheduleLookLoop(sessionId);
  scheduleActivityLoop(sessionId);
}

function extractMessage(packet) {
  if (!packet) return { source: '', message: '' };

  const source = typeof packet.source_name === 'string' ? packet.source_name : '';
  let message = '';

  if (typeof packet.message === 'string') {
    message = packet.message;
  } else if (Array.isArray(packet.parameters) && packet.parameters.length > 0) {
    message = packet.parameters.join(' ');
  }

  return { source, message };
}

function isNotAuthenticatedKick(reason) {
  if (!reason) return false;

  if (typeof reason === 'object' && reason.reason === 'not_authenticated') return true;

  if (typeof reason === 'string') {
    return reason.toLowerCase().includes('not_authenticated');
  }

  return false;
}

function isBadPacketKick(reason) {
  if (!reason) return false;

  if (typeof reason === 'object' && reason.reason === 'bad_packet') return true;

  if (typeof reason === 'string') {
    return reason.toLowerCase().includes('bad_packet');
  }

  return false;
}

async function handleChatCommand(packet) {
  const { source, message } = extractMessage(packet);
  if (!message) return;

  log('chat', `${source || 'server'}: ${message}`);

  const normalized = message.trim().toLowerCase();

  if (source && source.toLowerCase() === MC_USERNAME.toLowerCase()) return;

  if (normalized === 'ping') {
    queueChat('pong');
    return;
  }

  if (normalized === 'hello') {
    queueChat('hi');
    return;
  }

  if (normalized === 'look' || normalized === 'see' || normalized === 'vision') {
    queueChat(describeLookSample());
    return;
  }

  if (normalized === 'status') {
    queueChat(`mode=${state.ai.mode} state=${state.ai.state} target=${formatTargetLabel()} command=${state.ai.followCommand || 'none'}`);
    return;
  }

  if (normalized === 'follow') {
    const player = findPlayerByUsername(source);
    if (!player) {
      queueChat(`I can't find ${source || 'that player'} right now.`);
      return;
    }

    setAiMode(AI_MODES.FOLLOW, 'chat-follow', {
      target: player,
      command: 'follow'
    });
    queueChat(`Following ${player.username || source}.`);
    return;
  }

  if (normalized === 'come') {
    const player = findPlayerByUsername(source);
    if (!player) {
      queueChat(`I can't find ${source || 'that player'} right now.`);
      return;
    }

    setAiMode(AI_MODES.FOLLOW, 'chat-come', {
      target: player,
      command: 'come'
    });
    queueChat(`Coming to ${player.username || source}.`);
    return;
  }

  if (normalized === 'stop') {
    setAiMode(AI_MODES.AUTONOMOUS, 'chat-stop');
    queueChat('Returning to autonomous mode.');
    return;
  }

  if (normalized === 'move') {
    setAiMode(AI_MODES.AUTONOMOUS, 'chat-move');
    setBehaviorState(BEHAVIOR_STATES.WANDERING, 'chat-move', { force: true });
    await moveForward(randInt(2000, 4000), {
      hesitant: true,
      drift: 4.2,
      actionVersion: state.ai.actionVersion
    });
  }
}

function upsertEntity(id, patch) {
  const key = entityKey(id);
  if (!key) return;

  const current = state.entities.get(key) || {};
  state.entities.set(key, {
    ...current,
    ...patch,
    id: key,
    updatedAt: Date.now()
  });
}

function removeEntity(id) {
  const key = entityKey(id);
  if (!key) return;
  state.entities.delete(key);
}

function handleStartGame(packet) {
  state.runtimeEntityId = BigInt(packet.runtime_entity_id);
  state.runtimeIdForMove = Number(packet.runtime_entity_id);
  state.movementMode.spawnAt = Date.now();
  state.movementMode.authProbeUntil = 0;
  state.movementMode.lastAuthProbeAt = 0;
  state.movementMode.authProbeBlocked = false;
  state.movementMode.outboundSuppressedUntil = 0;
  state.movementMode.lastSuppressedLogAt = 0;
  state.movementMode.teleportAckPending = false;
  state.movementMode.phase1BootstrapSent = false;
  state.movementMode.phase2BootstrapSent = false;
  state.movementDebug.lastServerMotionAt = Date.now();
  state.movementDebug.lastNoServerMotionLogAt = 0;
  state.movementDebug.lastServerProgressAt = Date.now();
  state.movementDebug.lastObstacleAt = 0;
  state.movementDebug.obstacleActiveUntil = 0;
  state.position = toVec3(packet.player_position);
  state.serverPosition = new Vec3(state.position.x, state.position.y, state.position.z);
  state.world.blockPalette = Array.isArray(packet.block_properties) ? packet.block_properties.slice() : [];
  state.world.knownBlocks.clear();
  setPlayerMovementReady(false, 'waiting-for-spawn-confirmation');

  if (packet.rotation) {
    state.yaw = Number(packet.rotation.x) || 0;
    state.pitch = Number(packet.rotation.z) || 0;
    state.headYaw = state.yaw;
  }

  state.tick = packet.current_tick ? BigInt(packet.current_tick) : 0n;

  log(
    'spawn',
    `RuntimeID=${state.runtimeEntityId.toString()} Pos=${formatVec3(state.position)} Version=${MC_VERSION}`
  );

  queueSpawnBootstrapPackets('phase1');
}

function attachPacketListeners(client) {
  client.on('start_game', (packet) => {
    try {
      handleStartGame(packet);
    } catch (err) {
      log('packet', `start_game parse error: ${err.message}`);
    }
  });

  client.on('text', (packet) => {
    handleChatCommand(packet).catch((err) => log('chat', `Chat handler error: ${err.message}`));
  });

  client.on('add_player', (packet) => {
    upsertEntity(packet.runtime_id, {
      type: 'player',
      username: packet.username,
      position: toVec3(packet.position)
    });
  });

  client.on('add_entity', (packet) => {
    upsertEntity(packet.runtime_id, {
      type: packet.entity_type || 'entity',
      position: toVec3(packet.position)
    });
  });

  client.on('move_entity', (packet) => {
    upsertEntity(packet.runtime_entity_id, {
      position: toVec3(packet.position)
    });
  });

  client.on('move_entity_delta', (packet) => {
    const key = entityKey(packet.runtime_entity_id);
    if (!key) return;

    const current = state.entities.get(key);
    if (!current || !current.position) return;

    // Delta packet may include partial position fields; update only available axes.
    const newPos = new Vec3(
      packet.x !== undefined ? Number(packet.x) : current.position.x,
      packet.y !== undefined ? Number(packet.y) : current.position.y,
      packet.z !== undefined ? Number(packet.z) : current.position.z
    );

    upsertEntity(packet.runtime_entity_id, { position: newPos });
  });

  client.on('update_block', (packet) => {
    rememberBlock(packet.position, packet.block_runtime_id);
  });

  client.on('update_subchunk_blocks', (packet) => {
    for (const update of packet.blocks || []) {
      rememberBlock(update.position, update.runtime_id);
    }
    for (const update of packet.extra || []) {
      rememberBlock(update.position, update.runtime_id);
    }
  });

  client.on('update_block_properties', (packet) => {
    if (!packet?.nbt?.value?.name) return;
    state.world.blockPalette.push({
      name: packet.nbt.value.name.value,
      state: packet.nbt.value.states || null
    });
  });

  client.on('move_player', (packet) => {
    if (isSelfRuntimeId(packet.runtime_id)) {
      const previousServerPosition = state.serverPosition;
      noteServerMotion('move_player');
      state.serverPosition = toVec3(packet.position);
      noteServerProgress(previousServerPosition, state.serverPosition, 'move_player');
      state.position = new Vec3(state.serverPosition.x, state.serverPosition.y, state.serverPosition.z);
      state.pitch = Number(packet.pitch) || state.pitch;
      state.yaw = Number(packet.yaw) || state.yaw;
      state.headYaw = Number(packet.head_yaw) || state.headYaw;
      state.onGround = !!packet.on_ground;
      return;
    }

    upsertEntity(packet.runtime_id, {
      type: 'player',
      position: toVec3(packet.position)
    });
  });

  client.on('correct_player_move_prediction', (packet) => {
    try {
      if (state.movementMode.authority === 'unknown') {
        state.movementMode.authority = 'server_with_rewind';
        log('movement', 'Inferred server-authoritative rewind movement from correction packet.');
      }

      const previousServerPosition = state.serverPosition;
      noteServerMotion('correct_player_move_prediction');
      const corrected = toVec3(packet.position);
      const drift = state.position.distanceTo(corrected);
      state.serverPosition = new Vec3(corrected.x, corrected.y, corrected.z);
      noteServerProgress(previousServerPosition, state.serverPosition, 'correct_player_move_prediction');
      state.position = corrected;
      state.yaw = Number(packet.rotation?.x) || state.yaw;
      state.pitch = Number(packet.rotation?.z) || state.pitch;
      state.headYaw = state.yaw;
      state.onGround = !!packet.on_ground;

      if (packet.tick !== undefined && packet.tick !== null) {
        state.tick = BigInt(packet.tick);
      }

      if (drift > 0.8) {
        log('movement', `Server corrected move prediction by ${drift.toFixed(2)} blocks`);
      }
    } catch (err) {
      log('movement', `Failed to process movement correction: ${err.message}`);
    }
  });

  client.on('set_movement_authority', (packet) => {
    const authority = packet?.movement_authority || 'unknown';
    state.movementMode.authority = authority;
    log('movement', `Server movement authority set to: ${authority}`);
  });

  client.on('client_movement_prediction_sync', (packet) => {
    try {
      if (state.movementMode.authority === 'unknown') {
        state.movementMode.authority = 'server';
        log('movement', 'Inferred server-authoritative movement from prediction sync packet.');
      }

      noteServerMotion('client_movement_prediction_sync');
      log(
        'movement',
        `Prediction sync: speed=${Number(packet.movement_speed || 0).toFixed(3)} jump=${Number(packet.jump_strength || 0).toFixed(3)}`
      );
    } catch (err) {
      log('movement', `Prediction sync parse error: ${err.message}`);
    }
  });

  client.on('remove_entity', (packet) => {
    removeEntity(packet.entity_id_self);
  });
}

function attachLifecycleHandlers(client, sessionId) {
  client.on('play_status', (packet) => {
    if (sessionId !== state.sessionId) return;
    log('movement-debug', `play_status=${packet.status}`);
    if (packet.status === 'player_spawn') {
      queueSpawnBootstrapPackets('phase2');
    }
  });

  client.on('status', (status) => {
    if (sessionId !== state.sessionId) return;
    log('status', `Client status: ${formatReason(status)}`);
  });

  client.on('session', () => {
    if (sessionId !== state.sessionId) return;
    state.authInProgress = false;
    log('auth', 'Microsoft session established.');
  });

  client.on('connect_allowed', () => {
    log('connect', `Connection allowed to ${MC_HOST}:${MC_PORT}`);
  });

  client.on('login', () => {
    if (sessionId !== state.sessionId) return;
    log('connect', 'Login packet flow completed.');
  });

  client.on('join', () => {
    if (sessionId !== state.sessionId) return;
    state.joined = true;
    log('connect', `Joined as ${MC_USERNAME}`);
  });

  client.on('spawn', () => {
    if (sessionId !== state.sessionId) return;

    state.spawned = true;
    queueSpawnBootstrapPackets('phase2');
    state.movementMode.activationAt = Date.now() + 500;
    setPlayerMovementReady(true, 'spawn-confirmed-bootstrap-complete');
    log('connect', 'Spawned into world. Starting human-like behavior state machine.');

    startBehaviorSystem(sessionId);
  });

  client.on('kick', (reason) => {
    if (sessionId !== state.sessionId) return;
    log('disconnect', `Kicked: ${formatReason(reason)}`);

    if (isBadPacketKick(reason) && state.movementDebug.lastPacketMode === 'player_auth_input') {
      log('movement-debug', 'Server rejected live player_auth_input movement with bad_packet.');
    }

    if (isNotAuthenticatedKick(reason) && MC_OFFLINE) {
      state.authBlocked = true;
      log('auth', 'Server requires authentication. Set MC_OFFLINE=false in BOT_CONFIG and restart the bot.');
    }
  });

  client.on('close', (reason) => {
    if (sessionId !== state.sessionId) return;
    log('disconnect', `Connection closed: ${formatReason(reason)}`);
    if (state.authInProgress) {
      log('auth', 'Connection closed during auth. Use the latest code shown in terminal after reconnect.');
    }
    scheduleReconnect('close');
  });

  client.on('error', (err) => {
    if (sessionId !== state.sessionId) return;
    log('error', `Client error: ${err.message}`);
    if (err.message === 'Connect timed out') {
      log(
        'error',
        `No Bedrock UDP response from ${MC_HOST}:${MC_PORT}. Verify the server is online, the Bedrock port is correct, and the device/network allows outbound UDP.`
      );
    }
  });
}

async function createAndStartClient() {
  state.sessionId += 1;
  const sessionId = state.sessionId;
  state.authBlocked = false;
  state.authInProgress = false;

  cleanupForReconnect();

  if (MC_VERSION_RAW !== MC_VERSION) {
    log('startup', `Requested Bedrock ${MC_VERSION_RAW}; using compatible protocol ${MC_VERSION}.`);
  }

  let connectHost = MC_HOST;

  try {
    connectHost = await resolveServerHost(MC_HOST);
  } catch (err) {
    log('startup', `Failed to resolve ${MC_HOST} to IPv4: ${err.message}`);
    scheduleReconnect('dns-resolution-failed');
    return;
  }

  log(
    'startup',
    `Connecting to ${MC_HOST}:${MC_PORT} as ${MC_USERNAME} via ${connectHost} (offline=${MC_OFFLINE}, version=${MC_VERSION}, connectTimeout=${MC_CONNECT_TIMEOUT_MS}ms, authProfile=${MC_AUTH_INPUT_PROFILE}, chatReplies=${MC_ENABLE_CHAT_RESPONSES})`
  );
  log(
    'startup',
    `Runtime=${process.platform}${IS_TERMUX ? '/termux' : ''} authCache=${AUTH_CACHE_DIR} raknetWorkers=${MC_USE_RAKNET_WORKERS}`
  );

  try {
    fs.mkdirSync(AUTH_CACHE_DIR, { recursive: true });
  } catch (err) {
    log('auth', `Unable to create auth cache folder: ${err.message}`);
  }

  const client = bedrock.createClient({
    host: connectHost,
    port: MC_PORT,
    username: MC_USERNAME,
    offline: MC_OFFLINE,
    version: MC_VERSION,
    connectTimeout: MC_CONNECT_TIMEOUT_MS,
    skipPing: true,
    raknetBackend: 'jsp-raknet',
    useRaknetWorkers: MC_USE_RAKNET_WORKERS,
    profilesFolder: AUTH_CACHE_DIR,
    conLog: null,
    onMsaCode: (data) => {
      state.authInProgress = true;
      log('auth', `Microsoft login required. Open ${data.verification_uri} and enter code: ${data.user_code}`);
    }
  });

  state.client = client;
  state.connected = true;

  attachPacketListeners(client);
  attachLifecycleHandlers(client, sessionId);
}

process.on('uncaughtException', (err) => {
  log('process', `Uncaught exception: ${err.stack || err.message}`);
  if (String(err?.message || '').includes('Connect timed out')) {
    try {
      state.client?.close('connect-timeout');
    } catch (_) {}
    scheduleReconnect('connect-timeout');
  }
});

process.on('unhandledRejection', (reason) => {
  log('process', `Unhandled rejection: ${reason}`);
});

process.on('SIGINT', () => {
  log('process', 'SIGINT received, shutting down...');

  clearRuntimeTimers();

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  try {
    state.client?.close('bot shutdown');
  } catch (err) {
    log('process', `Close warning: ${err.message}`);
  }

  process.exit(0);
});

createAndStartClient();
