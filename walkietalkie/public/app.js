const STORAGE_PREFIX = "walkietalkie"
const DEFAULT_DISPLAY_NAME = "참여자"
const ROOM_CODE_REGEX = /^\d{4}$/
const PIN_REGEX = /^\d{4}$/
const ALLOWED_CAPACITIES = new Set([4, 6, 8])

const DEFAULT_ICE_SERVERS = [
  {
    urls: "stun:stun.cloudflare.com:3478"
  }
]

const SOCKET_PING_INTERVAL_MS = 12000
const SOCKET_PONG_TIMEOUT_MS = 30000
const SIGNALING_RECONNECT_BASE_DELAY_MS = 1200
const MAX_SIGNALING_RECONNECT_ATTEMPTS = 4

const clientId =
  sessionStorage.getItem(`${STORAGE_PREFIX}.clientId`) ?? `wt-${crypto.randomUUID()}`

sessionStorage.setItem(`${STORAGE_PREFIX}.clientId`, clientId)

const elements = {
  setupView: document.querySelector("#setupView"),
  callView: document.querySelector("#callView"),
  waitingModal: document.querySelector("#waitingModal"),
  connectionHelpModal: document.querySelector("#connectionHelpModal"),
  displayNameInput: document.querySelector("#displayNameInput"),
  createModeBtn: document.querySelector("#createModeBtn"),
  joinModeBtn: document.querySelector("#joinModeBtn"),
  createForm: document.querySelector("#createForm"),
  joinForm: document.querySelector("#joinForm"),
  roomTitleInput: document.querySelector("#roomTitleInput"),
  capacitySelect: document.querySelector("#capacitySelect"),
  isPrivateCheck: document.querySelector("#isPrivateCheck"),
  createPinWrap: document.querySelector("#createPinWrap"),
  createPinInput: document.querySelector("#createPinInput"),
  joinRoomCodeInput: document.querySelector("#joinRoomCodeInput"),
  joinPinInput: document.querySelector("#joinPinInput"),
  setupStatusText: document.querySelector("#setupStatusText"),
  createRoomBtn: document.querySelector("#createRoomBtn"),
  joinRoomBtn: document.querySelector("#joinRoomBtn"),
  inviteBtn: document.querySelector("#inviteBtn"),
  shareRoomBtn: document.querySelector("#shareRoomBtn"),
  closeWaitingModalBtn: document.querySelector("#closeWaitingModalBtn"),
  closeConnectionHelpBtn: document.querySelector("#closeConnectionHelpBtn"),
  dismissConnectionHelpBtn: document.querySelector("#dismissConnectionHelpBtn"),
  retryConnectionBtn: document.querySelector("#retryConnectionBtn"),
  toggleMicBtn: document.querySelector("#toggleMicBtn"),
  toggleMicOff: document.querySelector("#toggleMicOff"),
  toggleMicText: document.querySelector("#toggleMicText"),
  toggleCameraBtn: document.querySelector("#toggleCameraBtn"),
  toggleCameraOff: document.querySelector("#toggleCameraOff"),
  toggleCameraText: document.querySelector("#toggleCameraText"),
  leaveBtn: document.querySelector("#leaveBtn"),
  statusText: document.querySelector("#statusText"),
  callTitle: document.querySelector("#callTitle"),
  localVideo: document.querySelector("#localVideo"),
  localPlaceholder: document.querySelector("#localPlaceholder"),
  remoteGrid: document.querySelector("#remoteGrid"),
  emptyStage: document.querySelector("#emptyStage"),
  roomCodeDisplay: document.querySelector("#roomCodeDisplay"),
  roomPinWrap: document.querySelector("#roomPinWrap"),
  roomPinDisplay: document.querySelector("#roomPinDisplay"),
  roomCapacityDisplay: document.querySelector("#roomCapacityDisplay")
}

const DEFAULT_MEDIA_STATE = {
  audioEnabled: false,
  videoEnabled: false,
  hasVideo: false
}

const state = {
  clientId,
  mode: "create",
  room: null,
  socket: null,
  localStream: null,
  peers: new Map(),
  isJoining: false,
  isLeaving: false,
  isResetting: false,
  selfMedia: {
    audioEnabled: true,
    videoEnabled: true,
    hasVideo: true
  },
  iceServersPromise: null,
  socketPingTimer: null,
  signalingReconnectTimer: null,
  reconnectAttempts: 0,
  lastPongAt: 0,
  waitingModalDismissed: false,
  networkOnline: navigator.onLine,
  wakeLock: null
}

bindEvents()
bootstrap()

function bindEvents() {
  elements.createModeBtn.addEventListener("click", () => setMode("create"))
  elements.joinModeBtn.addEventListener("click", () => setMode("join"))
  elements.isPrivateCheck.addEventListener("change", toggleCreatePinVisibility)
  elements.createForm.addEventListener("submit", (event) => {
    void handleCreateSubmit(event)
  })
  elements.joinForm.addEventListener("submit", (event) => {
    void handleJoinSubmit(event)
  })
  elements.inviteBtn.addEventListener("click", openWaitingModal)
  elements.shareRoomBtn.addEventListener("click", () => {
    void shareRoomInvite()
  })
  elements.closeWaitingModalBtn.addEventListener("click", closeWaitingModal)
  elements.closeConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.dismissConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.retryConnectionBtn.addEventListener("click", () => {
    void retryCurrentCall()
  })
  elements.leaveBtn.addEventListener("click", () => {
    void leaveCall()
  })
  elements.toggleMicBtn.addEventListener("click", toggleMicrophone)
  elements.toggleCameraBtn.addEventListener("click", toggleCamera)

  elements.waitingModal.addEventListener("click", (event) => {
    if (event.target === elements.waitingModal) {
      closeWaitingModal()
    }
  })
  elements.connectionHelpModal.addEventListener("click", (event) => {
    if (event.target === elements.connectionHelpModal) {
      closeConnectionHelpModal()
    }
  })

  window.addEventListener("online", handleNetworkOnline)
  window.addEventListener("offline", handleNetworkOffline)
  document.addEventListener("visibilitychange", handleVisibilityChange)
  window.addEventListener("beforeunload", () => {
    stopSocketHeartbeat()
    clearSignalingReconnectTimer()
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.close(1000, "Page unload")
    }
  })
}

function bootstrap() {
  const savedDisplayName = localStorage.getItem(`${STORAGE_PREFIX}.displayName`)
  state.displayName = sanitizeName(savedDisplayName || DEFAULT_DISPLAY_NAME)
  elements.displayNameInput.value = state.displayName
  elements.roomTitleInput.value = `${state.displayName}의 방`
  elements.capacitySelect.value = "4"
  elements.isPrivateCheck.checked = false
  elements.createPinInput.value = ""
  elements.joinRoomCodeInput.value = ""
  elements.joinPinInput.value = ""

  setMode("create")
  toggleCreatePinVisibility()
  hideWaitingModal({ manual: false })
  hideConnectionHelpModal()
  updateRoomMetaUI()
  renderRemoteStageState()
  renderLocalPreviewState()
  setView("setup")
  setStatus("방을 만들거나 방 키(4자리)로 입장해 주세요.")
  updateControls()
}

function setMode(mode) {
  if (state.isJoining) {
    return
  }

  state.mode = mode === "join" ? "join" : "create"
  const isCreate = state.mode === "create"
  elements.createModeBtn.classList.toggle("active", isCreate)
  elements.joinModeBtn.classList.toggle("active", !isCreate)
  elements.createForm.classList.toggle("hidden", !isCreate)
  elements.joinForm.classList.toggle("hidden", isCreate)
}

function toggleCreatePinVisibility() {
  const visible = elements.isPrivateCheck.checked
  elements.createPinWrap.classList.toggle("hidden", !visible)
  if (!visible) {
    elements.createPinInput.value = ""
  }
}

async function handleCreateSubmit(event) {
  event.preventDefault()
  if (state.isJoining) {
    return
  }

  const displayName = readAndPersistDisplayName()
  const roomTitleRaw = elements.roomTitleInput.value.trim()
  const roomTitle = roomTitleRaw || `${displayName}의 방`
  const capacity = Number(elements.capacitySelect.value)
  const isPrivate = elements.isPrivateCheck.checked
  const pin = onlyDigits(elements.createPinInput.value).slice(0, 4)

  if (!ALLOWED_CAPACITIES.has(capacity)) {
    setStatus("최대 인원은 4명, 6명, 8명 중에서 선택해 주세요.")
    return
  }

  if (isPrivate && !PIN_REGEX.test(pin)) {
    setStatus("비공개방은 비밀번호 4자리를 입력해 주세요.")
    return
  }

  setSetupBusy(true)
  setStatus("방을 생성하는 중입니다...")

  try {
    const payload = await fetchJsonOrThrow("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: roomTitle,
        capacity,
        isPrivate,
        pin
      })
    })

    state.room = {
      code: payload.roomCode,
      roomTitle: payload.roomTitle,
      capacity: payload.capacity,
      isPrivate: payload.isPrivate,
      pin: payload.isPrivate ? pin : ""
    }
    state.waitingModalDismissed = false
    updateRoomMetaUI()
    setStatus(`방 키 ${state.room.code} 생성 완료. 통화 화면으로 전환합니다.`)
    await joinCurrentRoom()
  } catch (error) {
    setStatus(readErrorMessage(error, "방 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."))
  } finally {
    setSetupBusy(false)
  }
}

async function handleJoinSubmit(event) {
  event.preventDefault()
  if (state.isJoining) {
    return
  }

  const displayName = readAndPersistDisplayName()
  const roomCode = onlyDigits(elements.joinRoomCodeInput.value).slice(0, 4)
  const pin = onlyDigits(elements.joinPinInput.value).slice(0, 4)

  if (!ROOM_CODE_REGEX.test(roomCode)) {
    setStatus("방 키는 숫자 4자리입니다.")
    return
  }

  if (pin && !PIN_REGEX.test(pin)) {
    setStatus("비밀번호는 숫자 4자리로 입력해 주세요.")
    return
  }

  setSetupBusy(true)
  setStatus("방 입장 가능 여부를 확인하는 중입니다...")

  try {
    const payload = await fetchJsonOrThrow(`/api/rooms/${roomCode}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        pin
      })
    })

    state.room = {
      code: roomCode,
      roomTitle: payload.roomTitle,
      capacity: payload.capacity,
      isPrivate: payload.isPrivate,
      pin: payload.isPrivate ? pin : ""
    }

    if (state.room.isPrivate && !PIN_REGEX.test(state.room.pin)) {
      setStatus("비공개방입니다. 비밀번호 4자리를 입력해 주세요.")
      return
    }

    state.waitingModalDismissed = false
    updateRoomMetaUI()
    setStatus(`${displayName} 님으로 방 ${roomCode}에 입장합니다.`)
    await joinCurrentRoom()
  } catch (error) {
    setStatus(readErrorMessage(error, "방 입장에 실패했습니다. 방 키를 다시 확인해 주세요."))
  } finally {
    setSetupBusy(false)
  }
}

async function joinCurrentRoom(options = {}) {
  if (!state.room || state.socket || state.isJoining) {
    return
  }

  const { reuseCurrentView = false } = options
  clearSignalingReconnectTimer()
  state.isJoining = true
  state.reconnectAttempts = 0
  setView("call")
  hideConnectionHelpModal()
  setStatus("카메라와 마이크 권한을 확인하는 중입니다...")
  updateControls(true)

  try {
    await prepareLocalMedia()
    await requestWakeLockIfSupported()
    await openSignalingSocket(state.displayName)
    setStatus("대기실에 입장했습니다. 다른 참여자를 기다리는 중입니다.")
    syncWaitingModal()
  } catch (error) {
    console.error(error)
    setStatus(readErrorMessage(error, "통화 화면으로 전환하지 못했습니다. 다시 시도해 주세요."))
    await hardReset({
      returnToSetup: !reuseCurrentView,
      preserveRoom: true
    })
    if (reuseCurrentView) {
      openConnectionHelpModal()
    }
  } finally {
    state.isJoining = false
    updateControls()
  }
}

async function prepareLocalMedia() {
  stopTracks(state.localStream)
  let stream = null

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    })
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    })
    setStatus("카메라 권한이 없어 이번 통화는 음성 중심으로 시작합니다.")
  }

  state.localStream = stream
  state.selfMedia = readLocalMediaState()
  elements.localVideo.srcObject = stream
  renderLocalPreviewState()
}

function openSignalingSocket(displayName) {
  return new Promise((resolve, reject) => {
    if (!state.room) {
      reject(new Error("입장할 방 정보가 없습니다."))
      return
    }

    const url = new URL(`/api/rooms/${state.room.code}/ws`, location.origin)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("clientId", state.clientId)
    url.searchParams.set("name", displayName)
    if (state.room.pin) {
      url.searchParams.set("pin", state.room.pin)
    }

    const socket = new WebSocket(url)
    let settled = false

    socket.addEventListener("open", () => {
      clearSignalingReconnectTimer()
      state.socket = socket
      state.isLeaving = false
      state.reconnectAttempts = 0
      state.lastPongAt = Date.now()
      settled = true
      startSocketHeartbeat()
      sendPresence()
      updateControls()
      resolve()
    })

    socket.addEventListener("message", (event) => {
      void handleSocketMessage(event.data)
    })

    socket.addEventListener("error", () => {
      if (!settled) {
        reject(new Error("신호 서버 연결을 시작하지 못했습니다."))
      }
    })

    socket.addEventListener("close", (event) => {
      const userInitiated = state.isLeaving || state.isResetting

      if (!settled) {
        reject(new Error(event.reason || "방 서버와 연결하지 못했습니다."))
        return
      }

      stopSocketHeartbeat()
      state.socket = null

      if (!userInitiated && isFatalSocketClose(event.code)) {
        setStatus(event.reason || "방 연결이 종료되었습니다.")
        void hardReset({
          returnToSetup: true,
          preserveRoom: false
        })
        return
      }

      if (!userInitiated && state.localStream && state.room) {
        setStatus("방 연결이 잠시 끊겨 자동으로 다시 연결합니다.")
        scheduleSignalingReconnect()
      }

      updateControls()
    })
  })
}

function isFatalSocketClose(code) {
  return code === 4403 || code === 4404 || code === 4409 || code === 4410
}

async function handleSocketMessage(rawMessage) {
  let message = null
  try {
    message = JSON.parse(rawMessage)
  } catch {
    return
  }

  switch (message.type) {
    case "joined":
      if (message.room) {
        mergeRoomMeta(message.room)
      }
      state.waitingModalDismissed = false
      updateRoomMetaUI()
      setStatus("대기실에 입장했습니다. 참여자를 기다리는 중입니다.")
      syncWaitingModal()
      break
    case "room-state":
      await handleRoomState(message)
      break
    case "signal":
      await handleSignal(message)
      break
    case "presence":
      applyPeerPresence(message.from, message.media)
      break
    case "peer-left":
      removePeer(message.from)
      setStatus("참여자 한 명이 방에서 나갔습니다.")
      syncWaitingModal()
      break
    case "room-full":
      setStatus(message.message ?? "방 인원이 가득 찼습니다.")
      await hardReset({
        returnToSetup: true,
        preserveRoom: false
      })
      break
    case "pong":
      state.lastPongAt = Date.now()
      break
    case "error":
      setStatus(message.message ?? "방 처리 중 오류가 발생했습니다.")
      break
    default:
      break
  }
}

async function handleRoomState(message) {
  const members = Array.isArray(message.members) ? message.members : []
  mergeRoomMeta(message.room)
  updateRoomMetaUI()

  const peerMembers = members.filter((member) => member.clientId !== state.clientId)
  const activePeerIds = new Set(peerMembers.map((member) => member.clientId))

  for (const member of peerMembers) {
    const peer = await ensurePeerConnection(member.clientId, member.name)
    if (!peer) {
      continue
    }

    peer.name = sanitizeName(member.name)
    peer.media = normalizeMedia(member.media)
    updatePeerTile(peer)
  }

  for (const peerId of state.peers.keys()) {
    if (!activePeerIds.has(peerId)) {
      removePeer(peerId)
    }
  }

  for (const member of peerMembers) {
    if (shouldInitiateOffer(member.clientId)) {
      void maybeCreateOffer(member.clientId)
    }
  }

  if (peerMembers.length > 0) {
    state.waitingModalDismissed = false
    hideWaitingModal({ manual: false })
  }

  renderRemoteStageState()
  syncWaitingModal()

  const connectedCount = peerMembers.length + 1
  if (peerMembers.length === 0) {
    setStatus("대기실에서 다른 참여자를 기다리는 중입니다.")
  } else {
    setStatus(`현재 ${connectedCount}명 연결됨 (최대 ${state.room?.capacity ?? 4}명)`)
  }
}

function mergeRoomMeta(roomMeta) {
  if (!roomMeta || !state.room) {
    return
  }

  state.room = {
    ...state.room,
    roomTitle:
      typeof roomMeta.roomTitle === "string" && roomMeta.roomTitle.trim()
        ? roomMeta.roomTitle.trim()
        : state.room.roomTitle,
    capacity: ALLOWED_CAPACITIES.has(Number(roomMeta.capacity))
      ? Number(roomMeta.capacity)
      : state.room.capacity,
    isPrivate: Boolean(roomMeta.isPrivate)
  }
}

function shouldInitiateOffer(peerId) {
  return state.clientId.localeCompare(peerId) > 0
}

async function ensurePeerConnection(peerId, peerName = "") {
  if (!peerId) {
    return null
  }

  let peer = state.peers.get(peerId)
  if (!peer) {
    peer = createPeerState(peerId, peerName)
    state.peers.set(peerId, peer)
  }

  if (peer.connection) {
    return peer
  }

  const iceServers = await getIceServers()
  const currentPeer = state.peers.get(peerId)
  if (!currentPeer || currentPeer !== peer) {
    return null
  }

  const connection = new RTCPeerConnection({ iceServers })
  peer.connection = connection
  peer.connectionState = connection.connectionState
  peer.stream ??= new MediaStream()
  peer.videoEl.srcObject = peer.stream

  for (const track of state.localStream?.getTracks() ?? []) {
    connection.addTrack(track, state.localStream)
  }

  connection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      sendSocketMessage({
        type: "signal",
        to: peerId,
        candidate: event.candidate
      })
    }
  })

  connection.addEventListener("track", (event) => {
    const [remoteStream] = event.streams
    if (!remoteStream) {
      return
    }

    for (const track of remoteStream.getTracks()) {
      const knownTrack = peer.stream.getTracks().find((item) => item.id === track.id)
      if (!knownTrack) {
        peer.stream.addTrack(track)
      }
    }

    peer.videoEl.srcObject = peer.stream
    if (remoteStream.getVideoTracks().length > 0) {
      peer.media.hasVideo = true
      peer.media.videoEnabled = true
    }
    updatePeerTile(peer)
  })

  connection.addEventListener("connectionstatechange", () => {
    peer.connectionState = connection.connectionState

    if (peer.connectionState === "connected") {
      hideConnectionHelpModal()
    } else if (peer.connectionState === "failed") {
      openConnectionHelpModal()
      setStatus("직접 연결이 어려워 보입니다. 연결 가이드를 확인해 주세요.")
    }

    updatePeerTile(peer)
  })

  return peer
}

function createPeerState(peerId, peerName) {
  const tile = document.createElement("article")
  tile.className = "peer-tile"
  tile.dataset.peerId = peerId

  const videoEl = document.createElement("video")
  videoEl.className = "call-video hidden"
  videoEl.autoplay = true
  videoEl.playsInline = true

  const placeholderEl = document.createElement("div")
  placeholderEl.className = "peer-placeholder"
  placeholderEl.innerHTML = "<strong>연결 중</strong><span>상대 영상 준비 중</span>"

  const nameTagEl = document.createElement("span")
  nameTagEl.className = "peer-name"
  nameTagEl.textContent = sanitizeName(peerName)

  tile.append(videoEl, placeholderEl, nameTagEl)
  elements.remoteGrid.append(tile)

  return {
    id: peerId,
    name: sanitizeName(peerName),
    media: { ...DEFAULT_MEDIA_STATE },
    stream: new MediaStream(),
    connection: null,
    connectionState: "new",
    pendingCandidates: [],
    offerInFlight: false,
    tile,
    videoEl,
    placeholderEl,
    nameTagEl
  }
}

async function maybeCreateOffer(peerId, options = {}) {
  const { iceRestart = false } = options
  const peer = await ensurePeerConnection(peerId)
  if (!peer?.connection || peer.offerInFlight) {
    return
  }

  const connection = peer.connection
  if (connection.signalingState !== "stable") {
    return
  }

  const alreadyNegotiated = Boolean(
    connection.currentLocalDescription ||
      connection.currentRemoteDescription ||
      connection.localDescription ||
      connection.remoteDescription
  )

  if (!iceRestart && alreadyNegotiated) {
    return
  }

  peer.offerInFlight = true

  try {
    const offer = await connection.createOffer(iceRestart ? { iceRestart: true } : {})
    await connection.setLocalDescription(offer)
    sendSocketMessage({
      type: "signal",
      to: peerId,
      description: connection.localDescription
    })
  } finally {
    peer.offerInFlight = false
  }
}

async function handleSignal(message) {
  const from = sanitizeClientId(message.from)
  if (!from) {
    return
  }

  const peer = await ensurePeerConnection(from)
  if (!peer?.connection) {
    return
  }

  if (message.description) {
    await applyRemoteDescription(peer, message.description)
  }

  if (message.candidate) {
    await applyRemoteCandidate(peer, message.candidate)
  }
}

async function applyRemoteDescription(peer, description) {
  const connection = peer.connection
  if (!connection) {
    return
  }

  if (description.type === "offer" && connection.signalingState !== "stable") {
    try {
      await connection.setLocalDescription({ type: "rollback" })
    } catch {
      // Ignore rollback errors.
    }
  }

  await connection.setRemoteDescription(description)
  await flushPeerCandidates(peer)

  if (description.type === "offer") {
    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)
    sendSocketMessage({
      type: "signal",
      to: peer.id,
      description: connection.localDescription
    })
  }
}

async function applyRemoteCandidate(peer, candidate) {
  const connection = peer.connection
  if (!connection) {
    return
  }

  if (!connection.remoteDescription) {
    peer.pendingCandidates.push(candidate)
    return
  }

  try {
    await connection.addIceCandidate(candidate)
  } catch (error) {
    console.warn("Failed to apply remote candidate", error)
  }
}

async function flushPeerCandidates(peer) {
  const connection = peer.connection
  if (!connection || !connection.remoteDescription) {
    return
  }

  while (peer.pendingCandidates.length > 0) {
    const candidate = peer.pendingCandidates.shift()
    if (!candidate) {
      continue
    }

    try {
      await connection.addIceCandidate(candidate)
    } catch (error) {
      console.warn("Failed to flush queued ICE candidate", error)
    }
  }
}

function applyPeerPresence(peerId, media) {
  const peer = state.peers.get(sanitizeClientId(peerId))
  if (!peer) {
    return
  }

  peer.media = normalizeMedia(media)
  updatePeerTile(peer)
}

function sendPresence() {
  state.selfMedia = readLocalMediaState()
  sendSocketMessage({
    type: "presence",
    media: state.selfMedia
  })
  renderLocalPreviewState()
}

function sendSocketMessage(payload) {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    return
  }

  state.socket.send(JSON.stringify(payload))
}

function removePeer(peerId) {
  const safePeerId = sanitizeClientId(peerId)
  if (!safePeerId) {
    return
  }

  const peer = state.peers.get(safePeerId)
  if (!peer) {
    return
  }

  if (peer.connection) {
    try {
      peer.connection.close()
    } catch {
      // Ignore close errors.
    }
  }

  if (peer.tile?.parentNode) {
    peer.tile.parentNode.removeChild(peer.tile)
  }

  state.peers.delete(safePeerId)
  renderRemoteStageState()
}

function renderRemoteStageState() {
  const hasPeers = state.peers.size > 0
  elements.remoteGrid.dataset.count = String(state.peers.size)
  elements.emptyStage.classList.toggle("hidden", hasPeers)
  elements.remoteGrid.classList.toggle("hidden", !hasPeers)
  updateCallTitle()
}

function updatePeerTile(peer) {
  const hasVideoTrack = peer.stream.getVideoTracks().length > 0
  const showVideo = hasVideoTrack && peer.media.hasVideo && peer.media.videoEnabled

  peer.videoEl.classList.toggle("hidden", !showVideo)
  peer.placeholderEl.classList.toggle("hidden", showVideo)
  peer.nameTagEl.textContent = peerDisplayName(peer)

  if (!showVideo) {
    if (peer.connectionState === "connected") {
      peer.placeholderEl.innerHTML = `<strong>${peerDisplayName(peer)}</strong><span>카메라 꺼짐 또는 음성 전용</span>`
    } else {
      peer.placeholderEl.innerHTML = `<strong>${peerDisplayName(peer)}</strong><span>연결 중...</span>`
    }
  }
}

function peerDisplayName(peer) {
  const clean = sanitizeName(peer.name)
  if (!clean || clean === DEFAULT_DISPLAY_NAME) {
    return "참여자"
  }
  return clean
}

function readLocalMediaState() {
  const audioTrack = state.localStream?.getAudioTracks()[0] ?? null
  const videoTrack = state.localStream?.getVideoTracks()[0] ?? null

  return {
    audioEnabled: audioTrack ? audioTrack.enabled : false,
    videoEnabled: videoTrack ? videoTrack.enabled : false,
    hasVideo: Boolean(videoTrack)
  }
}

function renderLocalPreviewState() {
  const hasStream = Boolean(state.localStream)
  const media = hasStream ? readLocalMediaState() : state.selfMedia
  const showVideo = hasStream && media.hasVideo && media.videoEnabled

  elements.localVideo.classList.toggle("hidden", !showVideo)
  elements.localPlaceholder.classList.toggle("hidden", showVideo)

  if (!hasStream) {
    elements.localPlaceholder.innerHTML =
      "<strong>내 화면 미리보기</strong><span>통화를 시작하면 여기에 표시됩니다.</span>"
    return
  }

  if (showVideo) {
    return
  }

  if (media.hasVideo) {
    elements.localPlaceholder.innerHTML = "<strong>카메라 꺼짐</strong><span>버튼으로 다시 켤 수 있습니다.</span>"
  } else {
    elements.localPlaceholder.innerHTML = "<strong>음성 전용</strong><span>카메라 권한이 없거나 꺼져 있습니다.</span>"
  }
}

function updateCallTitle() {
  if (!state.room) {
    elements.callTitle.textContent = "방 연결 준비 중"
    return
  }

  const title = state.room.roomTitle?.trim()
  if (title) {
    elements.callTitle.textContent = title
    return
  }

  elements.callTitle.textContent = `방 키 ${state.room.code}`
}

function toggleMicrophone() {
  const track = state.localStream?.getAudioTracks()[0]
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  sendPresence()
  updateControls()
}

function toggleCamera() {
  const track = state.localStream?.getVideoTracks()[0]
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  sendPresence()
  updateControls()
}

async function leaveCall() {
  state.isLeaving = true
  clearSignalingReconnectTimer()
  stopSocketHeartbeat()
  hideConnectionHelpModal()
  hideWaitingModal({ manual: false })
  await hardReset({
    returnToSetup: true,
    preserveRoom: false
  })
  setStatus("통화를 종료했습니다. 새 방을 만들거나 방 키로 다시 입장할 수 있습니다.")
}

async function hardReset({ returnToSetup = true, preserveRoom = false } = {}) {
  if (state.isResetting) {
    return
  }

  state.isResetting = true
  clearSignalingReconnectTimer()
  stopSocketHeartbeat()

  if (state.socket) {
    try {
      state.socket.close(1000, "reset")
    } catch {
      // Ignore close errors.
    }
  }
  state.socket = null
  state.isJoining = false
  state.isLeaving = false
  state.reconnectAttempts = 0
  state.lastPongAt = 0
  state.waitingModalDismissed = false

  for (const peerId of Array.from(state.peers.keys())) {
    removePeer(peerId)
  }

  stopTracks(state.localStream)
  state.localStream = null
  elements.localVideo.srcObject = null
  await releaseWakeLock()
  state.selfMedia = {
    audioEnabled: true,
    videoEnabled: true,
    hasVideo: true
  }

  if (!preserveRoom) {
    state.room = null
    elements.joinRoomCodeInput.value = ""
    elements.joinPinInput.value = ""
  }

  updateRoomMetaUI()
  hideConnectionHelpModal()
  hideWaitingModal({ manual: false })

  if (returnToSetup) {
    setView("setup")
  }

  renderLocalPreviewState()
  renderRemoteStageState()
  updateControls()
  state.isResetting = false
}

function updateControls(isBusy = false) {
  const localAudioTrack = state.localStream?.getAudioTracks()[0] ?? null
  const localVideoTrack = state.localStream?.getVideoTracks()[0] ?? null
  const hasCallSession = Boolean(state.socket || state.localStream)
  const audioEnabled = Boolean(localAudioTrack?.enabled)
  const videoEnabled = Boolean(localVideoTrack?.enabled)
  const onCallView = document.body.dataset.view === "call"

  elements.inviteBtn.disabled = !onCallView || !state.room
  elements.leaveBtn.disabled = !hasCallSession || isBusy
  elements.toggleMicBtn.disabled = !localAudioTrack
  elements.toggleCameraBtn.disabled = !localVideoTrack

  elements.toggleMicBtn.dataset.active = String(audioEnabled)
  elements.toggleCameraBtn.dataset.active = String(videoEnabled)
  elements.inviteBtn.dataset.active = "true"
  elements.leaveBtn.dataset.active = "true"

  elements.toggleMicText.textContent = audioEnabled ? "마이크" : "음소거"
  elements.toggleCameraText.textContent = videoEnabled ? "카메라" : "영상 끔"
  elements.toggleMicOff.classList.toggle("hidden", audioEnabled)
  elements.toggleCameraOff.classList.toggle("hidden", videoEnabled)
}

function setSetupBusy(busy) {
  elements.createModeBtn.disabled = busy
  elements.joinModeBtn.disabled = busy
  elements.createRoomBtn.disabled = busy
  elements.joinRoomBtn.disabled = busy
}

function setStatus(message) {
  elements.setupStatusText.textContent = message
  elements.statusText.textContent = message
}

function setView(view) {
  document.body.dataset.view = view
  elements.setupView.classList.toggle("hidden", view !== "setup")
  elements.callView.classList.toggle("hidden", view !== "call")
  elements.callView.setAttribute("aria-hidden", String(view !== "call"))
  updateControls()
  syncWaitingModal()
}

function updateRoomMetaUI() {
  elements.roomCodeDisplay.textContent = state.room?.code ?? "----"
  elements.roomPinWrap.classList.toggle("hidden", !state.room?.isPrivate)
  elements.roomPinDisplay.textContent = state.room?.isPrivate ? state.room.pin || "----" : "----"
  elements.roomCapacityDisplay.textContent = `최대 인원 ${state.room?.capacity ?? 4}명`
  updateCallTitle()
}

function openWaitingModal() {
  if (!state.room) {
    return
  }

  state.waitingModalDismissed = false
  syncWaitingModal(true)
}

function closeWaitingModal() {
  hideWaitingModal({ manual: true })
}

function hideWaitingModal({ manual = false } = {}) {
  if (manual) {
    state.waitingModalDismissed = true
  }
  elements.waitingModal.classList.add("hidden")
}

function shouldShowWaitingModal() {
  return Boolean(state.room) && state.peers.size === 0
}

function syncWaitingModal(force = false) {
  const shouldShow =
    document.body.dataset.view === "call" &&
    Boolean(state.room) &&
    (force || (shouldShowWaitingModal() && !state.waitingModalDismissed))

  elements.waitingModal.classList.toggle("hidden", !shouldShow)
}

async function shareRoomInvite() {
  if (!state.room) {
    return
  }

  const inviteText = [
    "워키토키 방 초대",
    `방 키: ${state.room.code}`,
    `최대 인원: ${state.room.capacity}명`,
    state.room.isPrivate ? `비밀번호: ${state.room.pin}` : "비밀번호: 없음(공개방)"
  ].join("\n")

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "워키토키 방 초대",
        text: inviteText
      })
      setStatus("초대 전달 창을 열었습니다.")
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
    }
  }

  await copyText(inviteText)
  setStatus("공유 시트를 열 수 없어 초대 정보를 복사했습니다.")
}

async function copyText(text) {
  if (!text) {
    return
  }

  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const helper = document.createElement("textarea")
    helper.value = text
    document.body.append(helper)
    helper.select()
    document.execCommand("copy")
    helper.remove()
  }
}

function openConnectionHelpModal() {
  const shouldShow = document.body.dataset.view === "call"
  elements.connectionHelpModal.classList.toggle("hidden", !shouldShow)
}

function closeConnectionHelpModal() {
  hideConnectionHelpModal()
}

function hideConnectionHelpModal() {
  elements.connectionHelpModal.classList.add("hidden")
}

function startSocketHeartbeat() {
  stopSocketHeartbeat()
  state.lastPongAt = Date.now()
  sendSocketMessage({ type: "ping" })

  state.socketPingTimer = window.setInterval(() => {
    if (state.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    const now = Date.now()
    if (now - state.lastPongAt > SOCKET_PONG_TIMEOUT_MS) {
      setStatus("연결 확인이 지연되어 방 연결을 다시 시도합니다.")
      try {
        state.socket.close(4000, "Pong timeout")
      } catch {
        // Ignore close errors.
      }
      return
    }

    sendSocketMessage({ type: "ping" })
  }, SOCKET_PING_INTERVAL_MS)
}

function stopSocketHeartbeat() {
  if (!state.socketPingTimer) {
    return
  }

  window.clearInterval(state.socketPingTimer)
  state.socketPingTimer = null
}

function scheduleSignalingReconnect() {
  if (state.signalingReconnectTimer || state.isResetting || state.isLeaving) {
    return
  }

  if (!state.localStream || !state.room || state.socket) {
    return
  }

  if (!state.networkOnline) {
    setStatus("네트워크 복구를 기다리는 중입니다.")
    return
  }

  if (state.reconnectAttempts >= MAX_SIGNALING_RECONNECT_ATTEMPTS) {
    setStatus("방 연결 복구가 어려워졌습니다. 다시 시도 버튼을 눌러 주세요.")
    openConnectionHelpModal()
    return
  }

  state.reconnectAttempts += 1
  const attempt = state.reconnectAttempts
  const delay = Math.min(SIGNALING_RECONNECT_BASE_DELAY_MS * attempt, 6000)

  setStatus(`방 연결을 복구하는 중입니다. (${attempt}/${MAX_SIGNALING_RECONNECT_ATTEMPTS})`)

  state.signalingReconnectTimer = window.setTimeout(async () => {
    state.signalingReconnectTimer = null

    if (state.isResetting || state.isLeaving || !state.localStream || !state.room || state.socket) {
      return
    }

    try {
      await openSignalingSocket(state.displayName)
      setStatus("방 연결을 다시 열었습니다.")
      for (const peerId of state.peers.keys()) {
        if (shouldInitiateOffer(peerId)) {
          void maybeCreateOffer(peerId, { iceRestart: true })
        }
      }
    } catch {
      scheduleSignalingReconnect()
    }
  }, delay)
}

function clearSignalingReconnectTimer() {
  if (!state.signalingReconnectTimer) {
    return
  }

  window.clearTimeout(state.signalingReconnectTimer)
  state.signalingReconnectTimer = null
}

async function retryCurrentCall() {
  if (!state.room) {
    return
  }

  hideConnectionHelpModal()
  setStatus("같은 방으로 다시 연결을 시도합니다...")
  await hardReset({
    returnToSetup: false,
    preserveRoom: true
  })
  await joinCurrentRoom({ reuseCurrentView: true })
}

function handleNetworkOnline() {
  state.networkOnline = true
  if (state.localStream) {
    setStatus("인터넷이 복구되어 연결을 다시 확인하는 중입니다.")
  }

  if (state.localStream && !state.socket && state.room) {
    scheduleSignalingReconnect()
  }

  if (state.localStream) {
    void requestWakeLockIfSupported()
  }
}

function handleNetworkOffline() {
  state.networkOnline = false
  setStatus("인터넷 연결이 끊겼습니다. 다시 연결되면 자동으로 재시도합니다.")
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible" && state.localStream) {
    void requestWakeLockIfSupported()
  }
}

async function requestWakeLockIfSupported() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || !state.localStream) {
    return
  }

  if (state.wakeLock) {
    return
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen")
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null
    })
  } catch {
    // Ignore unsupported/denied wake lock.
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) {
    return
  }

  try {
    await state.wakeLock.release()
  } catch {
    // Ignore wake lock release errors.
  } finally {
    state.wakeLock = null
  }
}

async function getIceServers() {
  if (!state.iceServersPromise) {
    state.iceServersPromise = fetch("/api/ice")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("ICE 설정을 불러오지 못했습니다.")
        }

        const payload = await response.json()
        if (!Array.isArray(payload.iceServers) || payload.iceServers.length === 0) {
          return DEFAULT_ICE_SERVERS
        }
        return payload.iceServers
      })
      .catch(() => DEFAULT_ICE_SERVERS)
  }

  return state.iceServersPromise
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop()
  }
}

function normalizeMedia(media) {
  return {
    audioEnabled: Boolean(media?.audioEnabled),
    videoEnabled: Boolean(media?.videoEnabled),
    hasVideo: Boolean(media?.hasVideo)
  }
}

function sanitizeName(value) {
  const trimmed = `${value ?? ""}`.trim()
  if (!trimmed) {
    return DEFAULT_DISPLAY_NAME
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 24)
}

function sanitizeClientId(value) {
  return `${value ?? ""}`.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
}

function readAndPersistDisplayName() {
  state.displayName = sanitizeName(elements.displayNameInput.value)
  elements.displayNameInput.value = state.displayName
  localStorage.setItem(`${STORAGE_PREFIX}.displayName`, state.displayName)
  return state.displayName
}

function onlyDigits(value) {
  return `${value ?? ""}`.replace(/\D/g, "")
}

function readErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

async function fetchJsonOrThrow(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  let payload = {}

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = {}
    }
  }

  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : "요청 처리에 실패했습니다."
    throw new Error(message)
  }

  return payload
}
