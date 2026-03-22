const DEFAULT_DISPLAY_NAME = "참여자"
const ROOM_ID_REGEX = /^[a-z0-9-]{6,32}$/
const PIN_REGEX = /^\d{4}$/
const DEFAULT_ROOM_CAPACITY = 8

const DEFAULT_ICE_SERVERS = [
  {
    urls: "stun:stun.cloudflare.com:3478"
  }
]

const SOCKET_PING_INTERVAL_MS = 12000
const SOCKET_PONG_TIMEOUT_MS = 30000
const SIGNALING_RECONNECT_BASE_DELAY_MS = 1200
const MAX_SIGNALING_RECONNECT_ATTEMPTS = 4

const clientId = sessionStorage.getItem("walkietalkie.clientId") ?? `wt-${crypto.randomUUID()}`
sessionStorage.setItem("walkietalkie.clientId", clientId)

const elements = {
  setupView: document.querySelector("#setupView"),
  callView: document.querySelector("#callView"),
  callStage: document.querySelector("#callStage"),
  introPanel: document.querySelector("#introPanel"),
  lobbyPanel: document.querySelector("#lobbyPanel"),
  openLobbyBtn: document.querySelector("#openLobbyBtn"),
  createForm: document.querySelector("#createForm"),
  isPrivateCheck: document.querySelector("#isPrivateCheck"),
  createPinWrap: document.querySelector("#createPinWrap"),
  createPinInput: document.querySelector("#createPinInput"),
  createRoomBtn: document.querySelector("#createRoomBtn"),
  refreshLobbyBtn: document.querySelector("#refreshLobbyBtn"),
  waitingRoomList: document.querySelector("#waitingRoomList"),
  setupStatusText: document.querySelector("#setupStatusText"),
  waitingModal: document.querySelector("#waitingModal"),
  connectionHelpModal: document.querySelector("#connectionHelpModal"),
  privateJoinModal: document.querySelector("#privateJoinModal"),
  chatModal: document.querySelector("#chatModal"),
  closeWaitingModalBtn: document.querySelector("#closeWaitingModalBtn"),
  closeConnectionHelpBtn: document.querySelector("#closeConnectionHelpBtn"),
  dismissConnectionHelpBtn: document.querySelector("#dismissConnectionHelpBtn"),
  retryConnectionBtn: document.querySelector("#retryConnectionBtn"),
  privateJoinForm: document.querySelector("#privateJoinForm"),
  privateJoinPinInput: document.querySelector("#privateJoinPinInput"),
  privateJoinMetaText: document.querySelector("#privateJoinMetaText"),
  closePrivateJoinModalBtn: document.querySelector("#closePrivateJoinModalBtn"),
  privateJoinCancelBtn: document.querySelector("#privateJoinCancelBtn"),
  privateJoinSubmitBtn: document.querySelector("#privateJoinSubmitBtn"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  closeChatModalBtn: document.querySelector("#closeChatModalBtn"),
  cancelChatBtn: document.querySelector("#cancelChatBtn"),
  sendChatBtn: document.querySelector("#sendChatBtn"),
  roomNameDisplay: document.querySelector("#roomNameDisplay"),
  roomCapacityDisplay: document.querySelector("#roomCapacityDisplay"),
  inviteBtn: document.querySelector("#inviteBtn"),
  chatBtn: document.querySelector("#chatBtn"),
  doodleBtn: document.querySelector("#doodleBtn"),
  shareRoomBtn: document.querySelector("#shareRoomBtn"),
  toggleMicBtn: document.querySelector("#toggleMicBtn"),
  toggleMicOff: document.querySelector("#toggleMicOff"),
  toggleMicText: document.querySelector("#toggleMicText"),
  toggleCameraBtn: document.querySelector("#toggleCameraBtn"),
  toggleCameraOff: document.querySelector("#toggleCameraOff"),
  toggleCameraText: document.querySelector("#toggleCameraText"),
  mirrorBtn: document.querySelector("#mirrorBtn"),
  leaveBtn: document.querySelector("#leaveBtn"),
  statusText: document.querySelector("#statusText"),
  localStack: document.querySelector(".local-stack"),
  localVideo: document.querySelector("#localVideo"),
  localPlaceholder: document.querySelector("#localPlaceholder"),
  localChatBubble: document.querySelector("#localChatBubble"),
  localStageTile: document.querySelector("#localStageTile"),
  localStageVideo: document.querySelector("#localStageVideo"),
  localStagePlaceholder: document.querySelector("#localStagePlaceholder"),
  localStageChatBubble: document.querySelector("#localStageChatBubble"),
  remoteGrid: document.querySelector("#remoteGrid"),
  emptyStage: document.querySelector("#emptyStage"),
  doodleCanvas: document.querySelector("#doodleCanvas"),
  doodleNotice: document.querySelector("#doodleNotice")
}

const DEFAULT_MEDIA_STATE = {
  audioEnabled: false,
  videoEnabled: false,
  hasVideo: false
}

const state = {
  clientId,
  setupStage: "intro",
  room: null,
  lobbyRooms: [],
  pendingPrivateJoin: null,
  socket: null,
  localStream: null,
  microphoneTrack: null,
  cameraTrack: null,
  peers: new Map(),
  isJoining: false,
  isLeaving: false,
  isResetting: false,
  isMirrored: true,
  isDoodleMode: false,
  isDrawingDoodle: false,
  lastDoodlePoint: null,
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
  quickStartTimer: null,
  lobbyFetchToken: 0,
  chatTimers: new Map(),
  doodleLayers: new Map(),
  doodleContext: null,
  networkOnline: navigator.onLine,
  wakeLock: null
}

bindEvents()
bootstrap()

function bindEvents() {
  elements.openLobbyBtn.addEventListener("click", () => {
    showLobby("대기실에서 현재 기다리는 방을 볼 수 있습니다.")
  })
  elements.isPrivateCheck.addEventListener("change", toggleCreatePinVisibility)
  elements.createForm.addEventListener("submit", (event) => {
    void handleCreateSubmit(event)
  })
  elements.refreshLobbyBtn.addEventListener("click", () => {
    void refreshLobbyRooms()
  })
  elements.waitingRoomList.addEventListener("click", (event) => {
    handleLobbyListClick(event)
  })
  elements.privateJoinForm.addEventListener("submit", (event) => {
    void handlePrivateJoinSubmit(event)
  })
  elements.privateJoinCancelBtn.addEventListener("click", closePrivateJoinModal)
  elements.closePrivateJoinModalBtn.addEventListener("click", closePrivateJoinModal)
  elements.chatForm.addEventListener("submit", (event) => {
    void handleChatSubmit(event)
  })
  elements.closeChatModalBtn.addEventListener("click", closeChatModal)
  elements.cancelChatBtn.addEventListener("click", closeChatModal)

  elements.inviteBtn.addEventListener("click", openWaitingModal)
  elements.chatBtn.addEventListener("click", openChatModal)
  elements.doodleBtn.addEventListener("click", toggleDoodleMode)
  elements.shareRoomBtn.addEventListener("click", () => {
    void shareRoomInvite()
  })
  elements.closeWaitingModalBtn.addEventListener("click", closeWaitingModal)
  elements.closeConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.dismissConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.retryConnectionBtn.addEventListener("click", () => {
    void retryCurrentCall()
  })
  elements.toggleMicBtn.addEventListener("click", toggleMicrophone)
  elements.toggleCameraBtn.addEventListener("click", toggleCamera)
  elements.mirrorBtn.addEventListener("click", toggleMirror)
  elements.leaveBtn.addEventListener("click", () => {
    void leaveCall()
  })

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
  elements.privateJoinModal.addEventListener("click", (event) => {
    if (event.target === elements.privateJoinModal) {
      closePrivateJoinModal()
    }
  })
  elements.chatModal.addEventListener("click", (event) => {
    if (event.target === elements.chatModal) {
      closeChatModal()
    }
  })

  window.addEventListener("online", handleNetworkOnline)
  window.addEventListener("offline", handleNetworkOffline)
  document.addEventListener("visibilitychange", handleVisibilityChange)
  window.addEventListener("resize", resizeDoodleCanvas)
  window.addEventListener("beforeunload", () => {
    clearQuickStartTimer()
    stopSocketHeartbeat()
    clearSignalingReconnectTimer()
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.close(1000, "Page unload")
    }
  })
}

function bootstrap() {
  elements.isPrivateCheck.checked = false
  elements.createPinInput.value = ""
  elements.privateJoinPinInput.value = ""
  elements.chatInput.value = ""

  toggleCreatePinVisibility()
  hideWaitingModal({ manual: false })
  hideConnectionHelpModal()
  hidePrivateJoinModal()
  hideChatModal()
  initializeDoodleCanvas()
  updateRoomMetaUI()
  renderRemoteStageState()
  renderLocalPreviewState()
  setView("setup")
  updateControls()

  const sharedRoom = parseSharedRoomFromUrl()
  if (sharedRoom) {
    beginSharedRoomEntry(sharedRoom)
    return
  }

  beginQuickStartFlow()
}

function beginQuickStartFlow() {
  clearQuickStartTimer()
  setSetupStage("intro")
  setView("setup")
  setStatus("랜덤 방을 자동으로 준비하는 중입니다.")

  state.quickStartTimer = window.setTimeout(() => {
    state.quickStartTimer = null
    void createRoom({
      capacity: DEFAULT_ROOM_CAPACITY,
      isPrivate: false,
      pin: ""
    })
  }, 1000)
}

function beginSharedRoomEntry(sharedRoom) {
  clearQuickStartTimer()
  setSetupStage("intro")
  setView("setup")
  setStatus("공유받은 방으로 바로 들어가는 중입니다.")

  state.quickStartTimer = window.setTimeout(() => {
    state.quickStartTimer = null
    void joinRoomById(sharedRoom.roomId, sharedRoom.pin, { fromShared: true })
  }, 500)
}

function showLobby(message = "대기실을 불러왔습니다.") {
  clearQuickStartTimer()
  setSetupStage("lobby")
  setView("setup")
  setStatus(message)
  void refreshLobbyRooms()
}

function setSetupStage(stage) {
  state.setupStage = stage === "lobby" ? "lobby" : "intro"
  elements.introPanel.classList.toggle("hidden", state.setupStage !== "intro")
  elements.lobbyPanel.classList.toggle("hidden", state.setupStage !== "lobby")
}

function clearQuickStartTimer() {
  if (!state.quickStartTimer) {
    return
  }

  window.clearTimeout(state.quickStartTimer)
  state.quickStartTimer = null
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

  const isPrivate = elements.isPrivateCheck.checked
  const pin = onlyDigits(elements.createPinInput.value).slice(0, 4)

  if (isPrivate && !PIN_REGEX.test(pin)) {
    setStatus("비공개방은 비밀번호 4자리를 입력해 주세요.")
    return
  }

  await createRoom({
    capacity: DEFAULT_ROOM_CAPACITY,
    isPrivate,
    pin
  })
}

async function createRoom({ capacity, isPrivate, pin }) {
  if (state.isJoining) {
    return
  }

  clearQuickStartTimer()
  setSetupBusy(true)
  setStatus("새 랜덤 방을 만들고 있습니다...")

  try {
    const payload = await fetchJsonOrThrow("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capacity,
        isPrivate,
        pin
      })
    })

    state.room = {
      id: payload.roomId,
      title: payload.roomTitle,
      capacity: payload.capacity,
      isPrivate: payload.isPrivate,
      pin: payload.isPrivate ? pin : ""
    }
    state.waitingModalDismissed = false
    applyRoomQueryToUrl(state.room)
    updateRoomMetaUI()
    await joinCurrentRoom()
  } catch (error) {
    state.room = null
    clearRoomQueryFromUrl()
    showLobby(readErrorMessage(error, "방 생성에 실패했습니다. 대기실에서 다시 시도해 주세요."))
  } finally {
    setSetupBusy(false)
  }
}

async function refreshLobbyRooms() {
  const token = ++state.lobbyFetchToken
  renderLobbyLoading()

  try {
    const payload = await fetchJsonOrThrow("/api/lobby")
    if (token !== state.lobbyFetchToken) {
      return
    }

    state.lobbyRooms = Array.isArray(payload.rooms) ? payload.rooms : []
    renderLobbyRooms()
  } catch (error) {
    if (token !== state.lobbyFetchToken) {
      return
    }

    state.lobbyRooms = []
    elements.waitingRoomList.innerHTML =
      '<div class="waiting-room-empty"><strong>대기실을 불러오지 못했습니다.</strong><span>잠시 후 다시 새로고침해 주세요.</span></div>'
    setStatus(readErrorMessage(error, "대기 중인 방 목록을 불러오지 못했습니다."))
  }
}

function renderLobbyLoading() {
  elements.waitingRoomList.innerHTML =
    '<div class="waiting-room-empty"><strong>대기 중인 방을 불러오는 중</strong><span>잠시만 기다려 주세요.</span></div>'
}

function renderLobbyRooms() {
  if (state.lobbyRooms.length === 0) {
    elements.waitingRoomList.innerHTML =
      '<div class="waiting-room-empty"><strong>지금 대기 중인 방이 없습니다.</strong><span>새 랜덤 방을 만들면 여기 목록에도 바로 표시됩니다.</span></div>'
    return
  }

  const fragment = document.createDocumentFragment()

  for (const room of state.lobbyRooms) {
    const card = document.createElement("article")
    card.className = "waiting-room-card"

    const copy = document.createElement("div")
    copy.className = "waiting-room-copy"

    const title = document.createElement("strong")
    title.className = "waiting-room-title"
    title.textContent = room.roomTitle

    const meta = document.createElement("p")
    meta.className = "waiting-room-meta"
    meta.textContent = `${room.participants}명 입장 중`

    copy.append(title, meta)

    if (room.isPrivate) {
      const badge = document.createElement("span")
      badge.className = "waiting-room-badge"
      badge.textContent = "비공개"
      copy.append(badge)
    }

    const joinButton = document.createElement("button")
    joinButton.className = room.isPrivate ? "secondary-btn waiting-room-btn" : "primary-btn waiting-room-btn"
    joinButton.type = "button"
    joinButton.dataset.joinRoomId = room.roomId
    joinButton.textContent = room.isPrivate ? "비밀번호로 입장" : "바로 입장"

    card.append(copy, joinButton)
    fragment.append(card)
  }

  elements.waitingRoomList.replaceChildren(fragment)
}

function handleLobbyListClick(event) {
  const joinButton = event.target.closest("[data-join-room-id]")
  if (!joinButton) {
    return
  }

  const room = state.lobbyRooms.find((item) => item.roomId === joinButton.dataset.joinRoomId)
  if (!room) {
    return
  }

  if (room.isPrivate) {
    openPrivateJoinModal(room)
    return
  }

  void joinRoomById(room.roomId, "")
}

function openPrivateJoinModal(room) {
  state.pendingPrivateJoin = room
  elements.privateJoinPinInput.value = ""
  elements.privateJoinMetaText.textContent = `${room.roomTitle} · ${room.participants}명 입장 중`
  elements.privateJoinModal.classList.remove("hidden")
}

function closePrivateJoinModal() {
  hidePrivateJoinModal()
}

function hidePrivateJoinModal() {
  state.pendingPrivateJoin = null
  elements.privateJoinPinInput.value = ""
  elements.privateJoinModal.classList.add("hidden")
}

async function handlePrivateJoinSubmit(event) {
  event.preventDefault()
  if (!state.pendingPrivateJoin || state.isJoining) {
    return
  }

  const pin = onlyDigits(elements.privateJoinPinInput.value).slice(0, 4)
  if (!PIN_REGEX.test(pin)) {
    setStatus("비밀번호 4자리를 입력해 주세요.")
    return
  }

  await joinRoomById(state.pendingPrivateJoin.roomId, pin)
}

async function joinRoomById(roomId, pin = "", options = {}) {
  if (state.isJoining) {
    return
  }

  const { fromShared = false } = options
  clearQuickStartTimer()
  setSetupBusy(true)
  setStatus("방 입장 가능 여부를 확인하는 중입니다...")

  try {
    const payload = await fetchJsonOrThrow(`/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        pin
      })
    })

    state.room = {
      id: payload.roomId,
      title: payload.roomTitle,
      capacity: payload.capacity,
      isPrivate: payload.isPrivate,
      pin: payload.isPrivate ? pin : ""
    }
    state.waitingModalDismissed = false
    hidePrivateJoinModal()
    applyRoomQueryToUrl(state.room)
    updateRoomMetaUI()
    await joinCurrentRoom()
  } catch (error) {
    const message = readErrorMessage(error, "방 입장에 실패했습니다.")
    state.room = null
    clearRoomQueryFromUrl()
    if (fromShared) {
      showLobby(message)
    } else {
      setStatus(message)
      void refreshLobbyRooms()
    }
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
    await openSignalingSocket()
    setStatus("방에 들어왔습니다. 다른 참여자를 기다리는 중입니다.")
    syncWaitingModal()
  } catch (error) {
    console.error(error)
    const failureMessage = readErrorMessage(
      error,
      "통화 화면으로 전환하지 못했습니다. 다시 시도해 주세요."
    )
    await hardReset({
      returnToSetup: !reuseCurrentView,
      preserveRoom: reuseCurrentView
    })

    if (reuseCurrentView) {
      setStatus(failureMessage)
      openConnectionHelpModal()
    } else {
      showLobby(failureMessage)
    }
  } finally {
    state.isJoining = false
    updateControls()
  }
}

async function prepareLocalMedia() {
  stopLocalCaptureTracks()
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

  state.microphoneTrack = stream.getAudioTracks()[0] ?? null
  state.cameraTrack = stream.getVideoTracks()[0] ?? null
  applyActiveLocalStream()
}

function applyActiveLocalStream() {
  const tracks = []
  if (state.microphoneTrack) {
    tracks.push(state.microphoneTrack)
  }

  const activeVideoTrack = getActiveVideoTrack()
  if (activeVideoTrack) {
    tracks.push(activeVideoTrack)
  }

  state.localStream = new MediaStream(tracks)
  elements.localVideo.srcObject = state.localStream
  elements.localStageVideo.srcObject = state.localStream
  state.selfMedia = readLocalMediaState()
  renderLocalPreviewState()
  updateControls()
}

function getActiveVideoTrack() {
  return state.cameraTrack
}

function stopLocalCaptureTracks() {
  const tracks = new Set()
  for (const track of state.localStream?.getTracks() ?? []) {
    tracks.add(track)
  }
  if (state.microphoneTrack) {
    tracks.add(state.microphoneTrack)
  }
  if (state.cameraTrack) {
    tracks.add(state.cameraTrack)
  }
  for (const track of tracks) {
    track.stop()
  }

  state.localStream = null
  state.microphoneTrack = null
  state.cameraTrack = null
}

function openSignalingSocket() {
  return new Promise((resolve, reject) => {
    if (!state.room) {
      reject(new Error("입장할 방 정보가 없습니다."))
      return
    }

    const url = new URL(`/api/rooms/${state.room.id}/ws`, location.origin)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("clientId", state.clientId)
    url.searchParams.set("name", DEFAULT_DISPLAY_NAME)
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
        void resetToLobby(event.reason || "방 연결이 종료되었습니다.")
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
      setStatus("방에 입장했습니다. 참여자를 기다리는 중입니다.")
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
    case "chat":
      showEphemeralChat(message.from, message.text)
      break
    case "doodle":
      applyRemoteDoodle(message.from, message.segment)
      break
    case "doodle-clear":
      clearDoodleLayer(message.from)
      break
    case "peer-left":
      removePeer(message.from)
      setStatus("참여자 한 명이 방에서 나갔습니다.")
      syncWaitingModal()
      break
    case "room-full":
      await resetToLobby(message.message ?? "방 인원이 가득 찼습니다.")
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

  for (const peerId of Array.from(state.peers.keys())) {
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
    setStatus("상대방을 기다리는 중입니다.")
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
    id: sanitizeRoomId(roomMeta.roomId) || state.room.id,
    title:
      typeof roomMeta.roomTitle === "string" && roomMeta.roomTitle.trim()
        ? roomMeta.roomTitle.trim()
        : state.room.title,
    capacity: sanitizeCapacityValue(roomMeta.capacity),
    isPrivate: Boolean(roomMeta.isPrivate)
  }
}

function shouldInitiateOffer(peerId) {
  return state.clientId.localeCompare(peerId) > 0
}

function addLocalTracksToConnection(connection) {
  if (!connection || !state.localStream) {
    return
  }

  const existingKinds = new Set(
    connection
      .getSenders()
      .map((sender) => sender.track?.kind)
      .filter(Boolean)
  )

  for (const track of state.localStream.getTracks()) {
    if (existingKinds.has(track.kind)) {
      continue
    }
    connection.addTrack(track, state.localStream)
  }
}

async function syncPeerSenders() {
  const audioTrack = state.microphoneTrack
  const videoTrack = getActiveVideoTrack()

  for (const [peerId, peer] of state.peers.entries()) {
    const connection = peer.connection
    if (!connection) {
      continue
    }

    let needsRenegotiation = false
    needsRenegotiation =
      (await syncConnectionSender(connection, "audio", audioTrack)) || needsRenegotiation
    needsRenegotiation =
      (await syncConnectionSender(connection, "video", videoTrack)) || needsRenegotiation

    if (needsRenegotiation) {
      void maybeCreateOffer(peerId)
    }
  }
}

async function syncConnectionSender(connection, kind, track) {
  const sender = connection.getSenders().find((item) => item.track?.kind === kind)
  if (sender) {
    try {
      await sender.replaceTrack(track ?? null)
    } catch (error) {
      console.warn(`Failed to replace ${kind} track`, error)
    }
    return false
  }

  if (!track) {
    return false
  }

  connection.addTrack(track, state.localStream)
  return true
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

  addLocalTracksToConnection(connection)

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
  placeholderEl.innerHTML = "<strong>연결 중</strong><span>상대 화면 준비 중</span>"

  const chatBubbleEl = document.createElement("div")
  chatBubbleEl.className = "chat-bubble hidden"

  tile.append(videoEl, placeholderEl, chatBubbleEl)
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
    chatBubbleEl
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

  clearEphemeralChat(safePeerId)
  clearDoodleLayer(safePeerId)
  state.peers.delete(safePeerId)
  renderRemoteStageState()
}

function renderRemoteStageState() {
  const hasPeers = state.peers.size > 0
  syncParticipantGrid()
  elements.emptyStage.classList.toggle("hidden", hasPeers)
  elements.remoteGrid.classList.toggle("hidden", getVisibleGridTileCount() === 0)
  renderLocalPreviewState()
  updateCallTitle()
}

function updatePeerTile(peer) {
  const hasVideoTrack = peer.stream.getVideoTracks().length > 0
  const showVideo = hasVideoTrack && peer.media.hasVideo && peer.media.videoEnabled

  peer.videoEl.classList.toggle("hidden", !showVideo)
  peer.placeholderEl.classList.toggle("hidden", showVideo)
  if (!showVideo) {
    if (peer.connectionState === "connected") {
      peer.placeholderEl.innerHTML = "<strong>영상 꺼짐</strong><span>카메라를 다시 켜면 화면이 보입니다.</span>"
    } else {
      peer.placeholderEl.innerHTML = "<strong>연결 중</strong><span>상대 화면 준비 중</span>"
    }
  }
}

function shouldUseStageLocalTile() {
  return state.peers.size + 1 >= 4
}

function getVisibleGridTileCount() {
  return state.peers.size + (shouldUseStageLocalTile() ? 1 : 0)
}

function getGridColumns(tileCount) {
  if (tileCount >= 5) {
    return 3
  }

  if (tileCount >= 2) {
    return 2
  }

  return 1
}

function syncParticipantGrid() {
  const peerTiles = Array.from(state.peers.values()).map((peer) => peer.tile)

  if (!shouldUseStageLocalTile()) {
    elements.remoteGrid.replaceChildren(...peerTiles)
    elements.remoteGrid.dataset.count = String(peerTiles.length)
    return
  }

  const columns = getGridColumns(peerTiles.length + 1)
  const localIndex = Math.max(0, columns - 1)
  const orderedTiles = [
    ...peerTiles.slice(0, localIndex),
    elements.localStageTile,
    ...peerTiles.slice(localIndex)
  ]

  elements.remoteGrid.replaceChildren(...orderedTiles)
  elements.remoteGrid.dataset.count = String(orderedTiles.length)
}

function renderLocalStageState() {
  const showStageTile = shouldUseStageLocalTile()
  elements.localStageTile.classList.toggle("hidden", !showStageTile)
  elements.localStageTile.setAttribute("aria-hidden", String(!showStageTile))
  elements.localVideo.srcObject = state.localStream
  elements.localStageVideo.srcObject = state.localStream

  if (!showStageTile) {
    return
  }

  const { showVideo, placeholderMarkup } = getLocalPreviewPresentation()
  elements.localStageVideo.classList.toggle("hidden", !showVideo)
  elements.localStagePlaceholder.classList.toggle("hidden", showVideo)
  if (!showVideo) {
    elements.localStagePlaceholder.innerHTML = placeholderMarkup
  }
  elements.localStageVideo.classList.toggle("mirrored", state.isMirrored)
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
  const { hasStream, showVideo, placeholderMarkup } = getLocalPreviewPresentation()

  elements.localVideo.classList.toggle("hidden", !showVideo)
  elements.localPlaceholder.classList.toggle("hidden", showVideo)
  elements.localVideo.classList.toggle("mirrored", state.isMirrored)
  elements.localStack.classList.toggle("stage-local-hidden", shouldUseStageLocalTile())

  if (!showVideo) {
    elements.localPlaceholder.innerHTML = placeholderMarkup
  }

  renderLocalStageState()
}

function updateCallTitle() {
  document.title = state.room?.title
    ? `${state.room.title} | 워키토키`
    : "워키토키"
}

function getLocalPreviewPresentation() {
  const hasStream = Boolean(state.localStream)
  const media = hasStream ? readLocalMediaState() : state.selfMedia
  const showVideo = hasStream && media.hasVideo && media.videoEnabled

  if (!hasStream) {
    return {
      hasStream,
      showVideo,
      placeholderMarkup:
        "<strong>내 화면 미리보기</strong><span>통화를 시작하면 여기에 표시됩니다.</span>"
    }
  }

  if (showVideo) {
    return {
      hasStream,
      showVideo,
      placeholderMarkup: ""
    }
  }

  if (media.hasVideo) {
    return {
      hasStream,
      showVideo,
      placeholderMarkup:
        "<strong>카메라 꺼짐</strong><span>버튼으로 다시 켤 수 있습니다.</span>"
    }
  }

  return {
    hasStream,
    showVideo,
    placeholderMarkup:
      "<strong>음성 전용</strong><span>카메라 권한이 없거나 꺼져 있습니다.</span>"
  }
}

function toggleMicrophone() {
  const track = state.microphoneTrack
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  sendPresence()
  updateControls()
}

function toggleCamera() {
  const track = getActiveVideoTrack()
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  sendPresence()
  updateControls()
}

function toggleMirror() {
  state.isMirrored = !state.isMirrored
  renderLocalPreviewState()
  updateControls()
}

async function leaveCall() {
  state.isLeaving = true
  clearSignalingReconnectTimer()
  stopSocketHeartbeat()
  hideConnectionHelpModal()
  hideWaitingModal({ manual: false })
  await resetToLobby("통화를 종료했습니다. 대기실에서 다시 시작할 수 있습니다.")
}

async function resetToLobby(message, options = {}) {
  const { preserveRoom = false } = options
  await hardReset({
    returnToSetup: true,
    preserveRoom
  })
  showLobby(message)
}

async function hardReset({ returnToSetup = true, preserveRoom = false } = {}) {
  if (state.isResetting) {
    return
  }

  state.isResetting = true
  clearQuickStartTimer()
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
  state.isDrawingDoodle = false
  state.lastDoodlePoint = null
  state.isDoodleMode = false

  for (const peerId of Array.from(state.peers.keys())) {
    removePeer(peerId)
  }

  clearAllEphemeralChats()
  clearAllDoodles()
  hideChatModal()
  stopLocalCaptureTracks()
  elements.localVideo.srcObject = null
  elements.localStageVideo.srcObject = null
  await releaseWakeLock()
  state.selfMedia = {
    audioEnabled: true,
    videoEnabled: true,
    hasVideo: true
  }

  if (!preserveRoom) {
    state.room = null
    clearRoomQueryFromUrl()
  }

  hidePrivateJoinModal()
  updateDoodleModeUI()
  updateRoomMetaUI()
  hideConnectionHelpModal()
  hideWaitingModal({ manual: false })
  setSetupBusy(false)

  if (returnToSetup) {
    setView("setup")
  }

  renderLocalPreviewState()
  renderRemoteStageState()
  updateControls()
  state.isResetting = false
}

function updateControls(isBusy = false) {
  const localAudioTrack = state.microphoneTrack
  const localVideoTrack = getActiveVideoTrack()
  const hasCallSession = Boolean(state.socket || state.localStream)
  const hasSocket = state.socket?.readyState === WebSocket.OPEN
  const audioEnabled = Boolean(localAudioTrack?.enabled)
  const videoEnabled = Boolean(localVideoTrack?.enabled)
  const onCallView = document.body.dataset.view === "call"

  elements.inviteBtn.disabled = !onCallView || !state.room
  elements.chatBtn.disabled = !onCallView || !hasSocket
  elements.doodleBtn.disabled = !onCallView || !hasSocket
  elements.leaveBtn.disabled = !hasCallSession || isBusy
  elements.toggleMicBtn.disabled = !localAudioTrack
  elements.toggleCameraBtn.disabled = !localVideoTrack
  elements.mirrorBtn.disabled = !onCallView || !localVideoTrack || isBusy

  elements.toggleMicBtn.dataset.active = String(audioEnabled)
  elements.toggleCameraBtn.dataset.active = String(videoEnabled)
  elements.mirrorBtn.dataset.active = String(state.isMirrored)
  elements.chatBtn.dataset.active = "true"
  elements.doodleBtn.dataset.active = String(state.isDoodleMode)
  elements.inviteBtn.dataset.active = "true"
  elements.leaveBtn.dataset.active = "true"

  elements.toggleMicText.textContent = audioEnabled ? "마이크" : "음소거"
  elements.toggleCameraText.textContent = videoEnabled ? "카메라" : "영상 끔"
  elements.toggleMicOff.classList.toggle("hidden", audioEnabled)
  elements.toggleCameraOff.classList.toggle("hidden", videoEnabled)
}

function setSetupBusy(busy) {
  elements.openLobbyBtn.disabled = busy
  elements.refreshLobbyBtn.disabled = busy
  elements.isPrivateCheck.disabled = busy
  elements.createPinInput.disabled = busy
  elements.createRoomBtn.disabled = busy
  elements.privateJoinSubmitBtn.disabled = busy
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
  if (view !== "call") {
    state.isDoodleMode = false
    hideChatModal()
    updateDoodleModeUI()
  } else {
    resizeDoodleCanvas()
  }
  updateControls()
  syncWaitingModal()
}

function updateRoomMetaUI() {
  const roomLabel =
    state.room?.isPrivate && state.room?.pin
      ? `${state.room.title} - ${state.room.pin}`
      : state.room?.title ?? "----"

  elements.roomNameDisplay.textContent = roomLabel
  elements.roomCapacityDisplay.textContent = "같은 번호로 들어오면 바로 연결됩니다."
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

  const shareUrl = buildRoomShareUrl(state.room)
  const inviteRoomLabel =
    state.room.isPrivate && state.room.pin
      ? `${state.room.title} - ${state.room.pin}`
      : state.room.title
  const inviteLines = ["워키토키 방 초대", `방: ${inviteRoomLabel}`, `바로 입장: ${shareUrl}`]

  const inviteText = inviteLines.join("\n")

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "워키토키 방 초대",
        text: inviteText,
        url: shareUrl
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

function openChatModal() {
  if (!state.room || document.body.dataset.view !== "call") {
    return
  }

  elements.chatInput.value = ""
  elements.chatModal.classList.remove("hidden")
  window.setTimeout(() => {
    elements.chatInput.focus()
  }, 0)
}

function closeChatModal() {
  hideChatModal()
}

function hideChatModal() {
  elements.chatInput.value = ""
  elements.chatModal.classList.add("hidden")
}

async function handleChatSubmit(event) {
  event.preventDefault()
  const text = sanitizeChatText(elements.chatInput.value)
  if (!text) {
    return
  }

  showEphemeralChat(state.clientId, text)
  sendSocketMessage({
    type: "chat",
    text
  })
  hideChatModal()
}

function showEphemeralChat(clientId, text) {
  const safeClientId = sanitizeClientId(clientId)
  const bubble = getChatBubbleElement(safeClientId)
  if (!bubble) {
    return
  }

  bubble.textContent = text
  bubble.classList.remove("hidden")

  const existingTimer = state.chatTimers.get(safeClientId)
  if (existingTimer) {
    window.clearTimeout(existingTimer)
  }

  const timerId = window.setTimeout(() => {
    clearEphemeralChat(safeClientId)
  }, 3000)
  state.chatTimers.set(safeClientId, timerId)
}

function getChatBubbleElement(clientId) {
  if (clientId === state.clientId) {
    return shouldUseStageLocalTile() ? elements.localStageChatBubble : elements.localChatBubble
  }

  return state.peers.get(clientId)?.chatBubbleEl ?? null
}

function clearEphemeralChat(clientId) {
  const safeClientId = sanitizeClientId(clientId)
  const timerId = state.chatTimers.get(safeClientId)
  if (timerId) {
    window.clearTimeout(timerId)
  }
  state.chatTimers.delete(safeClientId)

  if (safeClientId === state.clientId) {
    elements.localChatBubble.classList.add("hidden")
    elements.localStageChatBubble.classList.add("hidden")
    return
  }

  state.peers.get(safeClientId)?.chatBubbleEl.classList.add("hidden")
}

function clearAllEphemeralChats() {
  for (const timerId of state.chatTimers.values()) {
    window.clearTimeout(timerId)
  }
  state.chatTimers.clear()
  elements.localChatBubble.classList.add("hidden")
  elements.localStageChatBubble.classList.add("hidden")
  for (const peer of state.peers.values()) {
    peer.chatBubbleEl.classList.add("hidden")
  }
}

function toggleDoodleMode() {
  if (!state.room || document.body.dataset.view !== "call") {
    return
  }

  state.isDoodleMode = !state.isDoodleMode
  updateDoodleModeUI()
}

function updateDoodleModeUI() {
  elements.doodleCanvas.classList.toggle("doodle-active", state.isDoodleMode)
  elements.doodleNotice.classList.toggle("hidden", !state.isDoodleMode)
  elements.doodleBtn.dataset.active = String(state.isDoodleMode)
  syncDoodleCanvasVisibility()
}

function initializeDoodleCanvas() {
  const context = elements.doodleCanvas.getContext("2d")
  state.doodleContext = context
  elements.doodleCanvas.addEventListener("pointerdown", handleDoodlePointerDown)
  elements.doodleCanvas.addEventListener("pointermove", handleDoodlePointerMove)
  elements.doodleCanvas.addEventListener("pointerup", handleDoodlePointerUp)
  elements.doodleCanvas.addEventListener("pointercancel", handleDoodlePointerUp)
  resizeDoodleCanvas()
  updateDoodleModeUI()
}

function handleDoodlePointerDown(event) {
  if (!state.isDoodleMode || document.body.dataset.view !== "call") {
    return
  }

  state.isDrawingDoodle = true
  state.lastDoodlePoint = getCanvasPoint(event)
  elements.doodleCanvas.setPointerCapture(event.pointerId)
}

function handleDoodlePointerMove(event) {
  if (!state.isDrawingDoodle || !state.lastDoodlePoint) {
    return
  }

  const nextPoint = getCanvasPoint(event)
  const segment = normalizeDoodleSegment({
    from: state.lastDoodlePoint,
    to: nextPoint
  })
  if (!segment) {
    return
  }

  appendDoodleSegment(state.clientId, segment, { broadcast: true })
  sendSocketMessage({
    type: "doodle",
    segment
  })
  state.lastDoodlePoint = nextPoint
}

function handleDoodlePointerUp(event) {
  if (state.isDrawingDoodle) {
    state.isDrawingDoodle = false
    state.lastDoodlePoint = null
  }

  if (elements.doodleCanvas.hasPointerCapture?.(event.pointerId)) {
    elements.doodleCanvas.releasePointerCapture(event.pointerId)
  }
}

function getCanvasPoint(event) {
  const rect = elements.doodleCanvas.getBoundingClientRect()
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1),
    y: Math.min(Math.max((event.clientY - rect.top) / Math.max(rect.height, 1), 0), 1)
  }
}

function normalizeDoodleSegment(segment) {
  const from = normalizeDoodlePoint(segment?.from)
  const to = normalizeDoodlePoint(segment?.to)
  if (!from || !to) {
    return null
  }

  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 0.0025) {
    return null
  }

  return { from, to }
}

function normalizeDoodlePoint(point) {
  const x = Number(point?.x)
  const y = Number(point?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return {
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1)
  }
}

function appendDoodleSegment(clientId, segment, options = {}) {
  const safeClientId = sanitizeClientId(clientId)
  const normalizedSegment = normalizeDoodleSegment(segment)
  if (!safeClientId || !normalizedSegment) {
    return
  }

  const layer = getDoodleLayer(safeClientId)
  layer.segments.push(normalizedSegment)
  if (layer.segments.length > 240) {
    layer.segments.shift()
  }

  drawDoodleSegment(normalizedSegment, layer.color)
  scheduleDoodleClear(safeClientId, options.broadcast === true)
  syncDoodleCanvasVisibility()
}

function applyRemoteDoodle(clientId, segment) {
  appendDoodleSegment(clientId, segment, { broadcast: false })
}

function getDoodleLayer(clientId) {
  let layer = state.doodleLayers.get(clientId)
  if (!layer) {
    layer = {
      color: getParticipantColor(clientId),
      segments: [],
      timerId: null
    }
    state.doodleLayers.set(clientId, layer)
  }

  return layer
}

function scheduleDoodleClear(clientId, broadcast) {
  const layer = getDoodleLayer(clientId)
  if (layer.timerId) {
    window.clearTimeout(layer.timerId)
  }

  layer.timerId = window.setTimeout(() => {
    clearDoodleLayer(clientId)
    if (broadcast) {
      sendSocketMessage({
        type: "doodle-clear"
      })
    }
  }, 3000)
}

function clearDoodleLayer(clientId) {
  const safeClientId = sanitizeClientId(clientId)
  const layer = state.doodleLayers.get(safeClientId)
  if (!layer) {
    return
  }

  if (layer.timerId) {
    window.clearTimeout(layer.timerId)
  }

  state.doodleLayers.delete(safeClientId)
  redrawAllDoodles()
  syncDoodleCanvasVisibility()
}

function clearAllDoodles() {
  for (const layer of state.doodleLayers.values()) {
    if (layer.timerId) {
      window.clearTimeout(layer.timerId)
    }
  }

  state.doodleLayers.clear()
  if (state.doodleContext) {
    const rect = elements.doodleCanvas.getBoundingClientRect()
    state.doodleContext.clearRect(0, 0, rect.width, rect.height)
  }
  syncDoodleCanvasVisibility()
}

function redrawAllDoodles() {
  if (!state.doodleContext) {
    return
  }

  const rect = elements.doodleCanvas.getBoundingClientRect()
  state.doodleContext.clearRect(0, 0, rect.width, rect.height)

  for (const layer of state.doodleLayers.values()) {
    for (const segment of layer.segments) {
      drawDoodleSegment(segment, layer.color)
    }
  }
}

function drawDoodleSegment(segment, color) {
  if (!state.doodleContext) {
    return
  }

  const rect = elements.doodleCanvas.getBoundingClientRect()
  const fromX = segment.from.x * rect.width
  const fromY = segment.from.y * rect.height
  const toX = segment.to.x * rect.width
  const toY = segment.to.y * rect.height

  state.doodleContext.strokeStyle = color
  state.doodleContext.lineWidth = 4.5
  state.doodleContext.lineCap = "round"
  state.doodleContext.lineJoin = "round"
  state.doodleContext.beginPath()
  state.doodleContext.moveTo(fromX, fromY)
  state.doodleContext.lineTo(toX, toY)
  state.doodleContext.stroke()
}

function resizeDoodleCanvas() {
  if (!state.doodleContext) {
    return
  }

  const rect = elements.callStage.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return
  }

  const ratio = window.devicePixelRatio || 1
  elements.doodleCanvas.width = Math.round(rect.width * ratio)
  elements.doodleCanvas.height = Math.round(rect.height * ratio)
  elements.doodleCanvas.style.width = `${rect.width}px`
  elements.doodleCanvas.style.height = `${rect.height}px`
  state.doodleContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  redrawAllDoodles()
}

function getParticipantColor(clientId) {
  const palette = ["#ff8e72", "#7ce4ff", "#ffd56f", "#c2ff7b", "#ffa7d1", "#b1a0ff"]
  let hash = 0
  for (const char of clientId) {
    hash = (hash + char.charCodeAt(0)) % palette.length
  }
  return palette[hash]
}

function syncDoodleCanvasVisibility() {
  const shouldShow =
    document.body.dataset.view === "call" && (state.isDoodleMode || state.doodleLayers.size > 0)
  elements.doodleCanvas.classList.toggle("hidden", !shouldShow)
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
      await openSignalingSocket()
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

function parseSharedRoomFromUrl() {
  const params = new URLSearchParams(location.search)
  const roomId = sanitizeRoomId(params.get("room"))
  const pin = onlyDigits(params.get("pin")).slice(0, 4)

  if (!ROOM_ID_REGEX.test(roomId)) {
    return null
  }

  return {
    roomId,
    pin: PIN_REGEX.test(pin) ? pin : ""
  }
}

function buildRoomShareUrl(room) {
  const url = new URL(location.origin + location.pathname)
  url.searchParams.set("room", room.id)
  if (room.isPrivate && room.pin) {
    url.searchParams.set("pin", room.pin)
  }
  return url.toString()
}

function applyRoomQueryToUrl(room) {
  history.replaceState(null, "", buildRoomShareUrl(room))
}

function clearRoomQueryFromUrl() {
  history.replaceState(null, "", location.pathname)
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

function sanitizeRoomId(value) {
  return `${value ?? ""}`.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32)
}

function onlyDigits(value) {
  return `${value ?? ""}`.replace(/\D/g, "")
}

function sanitizeChatText(value) {
  const trimmed = `${value ?? ""}`.trim()
  if (!trimmed) {
    return ""
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 60)
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
