const STORAGE_PREFIX = "walkietalkie"
const DEFAULT_DISPLAY_NAME = "참여자"

const elements = {
  setupView: document.querySelector("#setupView"),
  callView: document.querySelector("#callView"),
  waitingModal: document.querySelector("#waitingModal"),
  connectionHelpModal: document.querySelector("#connectionHelpModal"),
  inviteLink: document.querySelector("#inviteLink"),
  setupStatusText: document.querySelector("#setupStatusText"),
  inviteBtn: document.querySelector("#inviteBtn"),
  shareInviteBtn: document.querySelector("#shareInviteBtn"),
  copyInviteBtn: document.querySelector("#copyInviteBtn"),
  regenerateLinkBtn: document.querySelector("#regenerateLinkBtn"),
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
  remoteVideo: document.querySelector("#remoteVideo"),
  localPlaceholder: document.querySelector("#localPlaceholder"),
  remotePlaceholder: document.querySelector("#remotePlaceholder"),
  localBadge: document.querySelector("#localBadge"),
  peerBadge: document.querySelector("#peerBadge")
}

const DEFAULT_PEER_MEDIA = {
  audioEnabled: false,
  videoEnabled: false,
  hasVideo: false
}

const DEFAULT_ICE_SERVERS = [
  {
    urls: "stun:stun.cloudflare.com:3478"
  }
]

const SOCKET_PING_INTERVAL_MS = 12000
const SOCKET_PONG_TIMEOUT_MS = 30000
const SIGNALING_RECONNECT_BASE_DELAY_MS = 1200
const MAX_SIGNALING_RECONNECT_ATTEMPTS = 4
const MAX_ICE_RESTART_ATTEMPTS = 2

const clientId =
  sessionStorage.getItem(`${STORAGE_PREFIX}.clientId`) ?? `wt-${crypto.randomUUID()}`

sessionStorage.setItem(`${STORAGE_PREFIX}.clientId`, clientId)

const state = {
  clientId,
  invite: null,
  roomId: null,
  socket: null,
  localStream: null,
  remoteStream: null,
  peerConnection: null,
  pendingCandidates: [],
  shouldOffer: false,
  offerInFlight: false,
  iceRestartAttempts: 0,
  iceRestartInFlight: false,
  peerName: "",
  peerMedia: { ...DEFAULT_PEER_MEDIA },
  selfMedia: {
    audioEnabled: true,
    videoEnabled: true,
    hasVideo: true
  },
  iceServersPromise: null,
  isLeaving: false,
  isResetting: false,
  isJoining: false,
  socketPingTimer: null,
  signalingReconnectTimer: null,
  reconnectAttempts: 0,
  lastPongAt: 0,
  inviteBootstrapTimer: null,
  autoEnterTimer: null,
  shouldShowShareModal: false,
  waitingModalDismissed: false,
  networkOnline: navigator.onLine,
  wakeLock: null
}

bindEvents()
bootstrap()

function bindEvents() {
  elements.inviteBtn.addEventListener("click", openWaitingModal)
  elements.shareInviteBtn.addEventListener("click", shareInviteLink)
  elements.copyInviteBtn.addEventListener("click", copyInviteLink)
  elements.regenerateLinkBtn.addEventListener("click", regenerateInviteLink)
  elements.closeWaitingModalBtn.addEventListener("click", closeWaitingModal)
  elements.closeConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.dismissConnectionHelpBtn.addEventListener("click", closeConnectionHelpModal)
  elements.retryConnectionBtn.addEventListener("click", retryCurrentCall)
  elements.leaveBtn.addEventListener("click", leaveCall)
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
  window.addEventListener("hashchange", handleHashChange)
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
  const { invite, fromSharedLink } = ensureInvite()
  state.invite = invite
  state.shouldShowShareModal = !fromSharedLink
  state.waitingModalDismissed = false
  renderInvite()
  renderLocalPreviewState()
  renderRemoteState()
  hideWaitingModal({ manual: false })
  hideConnectionHelpModal()
  setView("setup")
  setStatus("처음 들어오면 2초 뒤 링크를 만들고, 3초 뒤 통화 화면으로 전환됩니다.")
  updateControls()

  if (fromSharedLink) {
    setStatus("공유 링크를 확인했습니다. 바로 통화 화면으로 들어갑니다.")
    void joinCall()
    return
  }

  beginIntroRedirect()
}

function ensureInvite() {
  const fromHash = parseInviteHash(location.hash)
  if (fromHash) {
    return {
      invite: fromHash,
      fromSharedLink: true
    }
  }

  return {
    invite: null,
    fromSharedLink: false
  }
}

function handleHashChange() {
  const nextInvite = parseInviteHash(location.hash)
  if (!nextInvite) {
    return
  }

  if (state.localStream || state.socket) {
    if (state.invite) {
      replaceInviteHash(state.invite)
    }
    setStatus("통화 중에는 링크를 바꿀 수 없습니다.")
    return
  }

  clearIntroTimers()
  state.invite = nextInvite
  state.shouldShowShareModal = false
  state.waitingModalDismissed = false
  renderInvite()
  setStatus("공유 링크를 불러왔습니다. 바로 통화 화면으로 들어갑니다.")
  void joinCall()
}

function createInvite() {
  return {
    room: randomToken(10),
    key: randomToken(16)
  }
}

function parseInviteHash(hashValue) {
  const raw = hashValue.replace(/^#/, "")
  const params = new URLSearchParams(raw)
  const room = (params.get("room") ?? "").trim()
  const key = (params.get("key") ?? "").trim()

  if (!room || !key) {
    return null
  }

  return { room, key }
}

function replaceInviteHash(invite) {
  const params = new URLSearchParams({
    room: invite.room,
    key: invite.key
  })
  history.replaceState(null, "", `#${params.toString()}`)
}

function buildInviteUrl(invite) {
  return `${location.origin}${location.pathname}#room=${invite.room}&key=${invite.key}`
}

function renderInvite() {
  elements.inviteLink.textContent = state.invite ? buildInviteUrl(state.invite) : ""
}

async function copyInviteLink() {
  const inviteText = elements.inviteLink.textContent ?? ""
  if (!inviteText) {
    return
  }

  try {
    await navigator.clipboard.writeText(inviteText)
  } catch {
    const helper = document.createElement("textarea")
    helper.value = inviteText
    document.body.append(helper)
    helper.select()
    document.execCommand("copy")
    helper.remove()
  }

  setStatus("개인 링크를 복사했습니다.")
}

async function shareInviteLink() {
  const inviteText = elements.inviteLink.textContent ?? ""
  if (!inviteText) {
    return
  }

  const shareData = {
    title: "워키토키 링크",
    text: "이 링크로 들어오면 바로 통화할 수 있어요.",
    url: inviteText
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share(shareData)
      setStatus("링크 전달 창을 열었습니다.")
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
    }
  }

  await copyInviteLink()
  setStatus("공유 시트를 열 수 없어 링크를 복사했습니다.")
}

async function regenerateInviteLink() {
  const shouldRejoin = Boolean(state.socket || state.localStream)

  if (shouldRejoin) {
    await hardReset({ returnToSetup: false })
  }

  state.invite = createInvite()
  state.shouldShowShareModal = true
  state.waitingModalDismissed = false
  replaceInviteHash(state.invite)
  renderInvite()

  if (shouldRejoin) {
    setView("call")
    setStatus("새 링크를 만들었습니다. 이 링크를 다시 전달해 주세요.")
    await joinCall({ reuseCurrentView: true })
    return
  }

  setStatus("새 개인 링크를 만들었습니다.")
}

async function joinCall(options = {}) {
  if (!state.invite || state.socket || state.peerConnection || state.isJoining) {
    return
  }

  const { reuseCurrentView = false } = options

  clearIntroTimers()
  clearSignalingReconnectTimer()
  state.isJoining = true
  state.reconnectAttempts = 0
  setView("call")
  hideConnectionHelpModal()
  setStatus("카메라와 마이크를 준비하고 있습니다...")
  updateControls(true)

  try {
    await prepareLocalMedia()
    await requestWakeLockIfSupported()
    state.roomId = await deriveRoomId(state.invite)
    await openSignalingSocket(DEFAULT_DISPLAY_NAME)
    if (state.shouldShowShareModal) {
      setStatus("상대가 아직 없다면 링크 전달 모달에서 바로 보낼 수 있습니다.")
    } else {
      setStatus("상대방이 같은 링크로 들어오기를 기다리는 중입니다.")
    }
  } catch (error) {
    console.error(error)
    setStatus(
      error instanceof Error
        ? error.message
        : "통화를 시작하지 못했습니다. 브라우저 권한과 네트워크를 확인해 주세요."
    )
    await hardReset({ returnToSetup: !reuseCurrentView })
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
    setStatus("카메라를 열 수 없어 이번 통화는 음성 전용으로 전환했습니다.")
  }

  state.localStream = stream
  state.selfMedia = readLocalMediaState()
  elements.localVideo.srcObject = stream
  renderLocalPreviewState()
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

async function deriveRoomId(invite) {
  const payload = new TextEncoder().encode(`${invite.room}:${invite.key}`)
  const digest = await crypto.subtle.digest("SHA-256", payload)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 64)
}

function openSignalingSocket(displayName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/room/${state.roomId}/ws`, location.origin)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("clientId", state.clientId)
    url.searchParams.set("name", displayName)

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
      syncWaitingModal()
      resolve()
    })

    socket.addEventListener("message", (event) => {
      void handleSocketMessage(event.data)
    })

    socket.addEventListener("error", () => {
      if (!settled) {
        reject(new Error("신호 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요."))
      }
    })

    socket.addEventListener("close", () => {
      const userInitiated = state.isLeaving || state.isResetting
      const connectionState = state.peerConnection?.connectionState ?? "closed"
      const keepPeerConnection =
        connectionState === "connected" || connectionState === "connecting"

      if (!settled) {
        reject(new Error("방에 연결하지 못했습니다. 링크가 이미 사용 중일 수 있습니다."))
        return
      }

      stopSocketHeartbeat()
      state.socket = null
      state.shouldOffer = false
      state.offerInFlight = false
      state.isLeaving = false

      if (state.peerConnection && !keepPeerConnection) {
        resetPeerConnection()
      }

      if (!userInitiated && state.localStream && state.roomId) {
        if (keepPeerConnection) {
          setStatus("연결 채널이 끊겨 자동으로 복구 중입니다.")
        } else {
          setStatus("세션 연결이 끊겼습니다. 자동으로 다시 연결합니다.")
        }
        scheduleSignalingReconnect()
      } else if (!userInitiated && state.localStream) {
        setStatus("세션 연결이 종료되었습니다. 잠시 뒤 다시 시도해 주세요.")
      }

      syncWaitingModal()
      updateControls()
    })
  })
}

async function handleSocketMessage(rawMessage) {
  let message

  try {
    message = JSON.parse(rawMessage)
  } catch {
    return
  }

  switch (message.type) {
    case "joined":
      setStatus("워키토키 방에 들어왔습니다. 상대방을 기다리는 중입니다.")
      break
    case "room-full":
      setStatus(message.message ?? "이 링크는 이미 사용 중입니다.")
      await hardReset({ returnToSetup: true })
      break
    case "room-state":
      await handleRoomState(message)
      break
    case "signal":
      await handleSignal(message)
      break
    case "presence":
      applyPeerPresence(message.media)
      break
    case "peer-left":
      state.peerName = ""
      state.peerMedia = { ...DEFAULT_PEER_MEDIA }
      state.iceRestartAttempts = 0
      state.iceRestartInFlight = false
      resetPeerConnection()
      renderRemoteState()
      syncWaitingModal()
      setStatus("상대방이 나갔습니다. 같은 화면에서 다시 기다릴 수 있습니다.")
      break
    case "pong":
      state.lastPongAt = Date.now()
      break
    case "error":
      setStatus(message.message ?? "세션 처리 중 오류가 발생했습니다.")
      break
    default:
      break
  }
}

async function handleRoomState(message) {
  const members = Array.isArray(message.members) ? message.members : []
  const peer = members.find((member) => member.clientId !== state.clientId) ?? null

  state.shouldOffer = Boolean(message.shouldOffer)
  state.peerName = peer?.name ?? ""
  state.peerMedia = peer?.media ?? { ...DEFAULT_PEER_MEDIA }
  renderRemoteState()

  if (!peer) {
    resetPeerConnection()
    syncWaitingModal()
    setStatus("상대방이 같은 링크로 들어오기를 기다리는 중입니다.")
    return
  }

  hideWaitingModal({ manual: false })

  if (state.shouldOffer && !state.peerConnection && !state.offerInFlight) {
    await maybeCreateOffer()
  } else if (!state.shouldOffer) {
    setStatus(`${peerLabel()} 연결 중입니다.`)
  }
}

async function maybeCreateOffer({ iceRestart = false } = {}) {
  state.offerInFlight = true

  try {
    await ensurePeerConnection()
    if (!state.peerConnection || state.peerConnection.signalingState !== "stable") {
      return
    }

    const offer = await state.peerConnection.createOffer(iceRestart ? { iceRestart: true } : {})
    await state.peerConnection.setLocalDescription(offer)
    sendSocketMessage({
      type: "signal",
      description: state.peerConnection.localDescription
    })
    if (iceRestart) {
      setStatus("연결을 다시 맞추는 중입니다.")
    } else {
      setStatus("연결 요청을 보냈습니다. 상대방 응답을 기다리는 중입니다.")
    }
  } finally {
    state.offerInFlight = false
  }
}

async function ensurePeerConnection() {
  if (state.peerConnection) {
    return state.peerConnection
  }

  const iceServers = await getIceServers()
  const connection = new RTCPeerConnection({ iceServers })
  const remoteStream = new MediaStream()

  state.peerConnection = connection
  state.remoteStream = remoteStream
  state.pendingCandidates = []

  elements.remoteVideo.srcObject = remoteStream

  for (const track of state.localStream?.getTracks() ?? []) {
    connection.addTrack(track, state.localStream)
  }

  connection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      sendSocketMessage({
        type: "signal",
        candidate: event.candidate
      })
    }
  })

  connection.addEventListener("track", (event) => {
    event.streams[0].getTracks().forEach((track) => {
      const knownTrack = remoteStream.getTracks().find((item) => item.id === track.id)
      if (!knownTrack) {
        remoteStream.addTrack(track)
      }
    })

    elements.remoteVideo.srcObject = remoteStream
    if (event.streams[0].getVideoTracks().length > 0) {
      state.peerMedia.hasVideo = true
      state.peerMedia.videoEnabled = true
    }
    renderRemoteState()
  })

  connection.addEventListener("connectionstatechange", () => {
    const nextState = connection.connectionState

    if (nextState === "connected") {
      state.iceRestartAttempts = 0
      state.iceRestartInFlight = false
      hideConnectionHelpModal()
      setStatus("통화 중입니다.")
    } else if (nextState === "connecting") {
      setStatus("통화 연결 중입니다.")
    } else if (nextState === "disconnected") {
      setStatus("연결이 잠시 불안정합니다.")
      maybeAutoRepairConnection("disconnected")
    } else if (nextState === "failed") {
      setStatus("연결이 잘 되지 않습니다. 네트워크를 바꾸거나 잠시 후 다시 시도해 주세요.")
      const startedRecovery = maybeAutoRepairConnection("failed")
      if (!startedRecovery) {
        openConnectionHelpModal()
      }
    }
  })

  updateControls()
  return connection
}

function maybeAutoRepairConnection(reason) {
  if (!state.peerConnection || state.iceRestartInFlight) {
    return false
  }

  if (state.socket?.readyState !== WebSocket.OPEN) {
    return false
  }

  if (!state.peerName) {
    return false
  }

  if (state.iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
    return false
  }

  state.iceRestartAttempts += 1
  state.iceRestartInFlight = true
  setStatus(`연결을 다시 맞추는 중입니다. (${state.iceRestartAttempts}/${MAX_ICE_RESTART_ATTEMPTS})`)

  void requestIceRestart(reason).finally(() => {
    state.iceRestartInFlight = false
  })

  return true
}

async function requestIceRestart(reason) {
  try {
    await maybeCreateOffer({ iceRestart: true })
  } catch (error) {
    console.error("Failed to restart ICE", reason, error)
  }
}

async function handleSignal(message) {
  if (!message.description && !message.candidate) {
    return
  }

  await ensurePeerConnection()

  if (message.description) {
    await applyRemoteDescription(message.description)
  }

  if (message.candidate) {
    await applyRemoteCandidate(message.candidate)
  }
}

async function applyRemoteDescription(description) {
  const connection = state.peerConnection
  if (!connection) {
    return
  }

  if (description.type === "offer" && connection.signalingState !== "stable") {
    await connection.setLocalDescription({ type: "rollback" })
  }

  await connection.setRemoteDescription(description)
  await flushPendingCandidates()

  if (description.type === "offer") {
    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)
    sendSocketMessage({
      type: "signal",
      description: connection.localDescription
    })
    setStatus("응답을 보냈습니다. 연결을 마무리하는 중입니다.")
  }
}

async function applyRemoteCandidate(candidate) {
  const connection = state.peerConnection
  if (!connection) {
    return
  }

  if (!connection.remoteDescription) {
    state.pendingCandidates.push(candidate)
    return
  }

  try {
    await connection.addIceCandidate(candidate)
  } catch (error) {
    console.warn("Failed to apply remote ICE candidate", error)
  }
}

async function flushPendingCandidates() {
  const connection = state.peerConnection
  if (!connection || !connection.remoteDescription) {
    return
  }

  while (state.pendingCandidates.length > 0) {
    const candidate = state.pendingCandidates.shift()
    if (!candidate) {
      continue
    }

    try {
      await connection.addIceCandidate(candidate)
    } catch (error) {
      console.warn("Failed to flush pending ICE candidate", error)
    }
  }
}

async function getIceServers() {
  if (!state.iceServersPromise) {
    state.iceServersPromise = fetch("/api/ice")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("ICE 서버 설정을 불러오지 못했습니다.")
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

function sendPresence() {
  state.selfMedia = readLocalMediaState()
  sendSocketMessage({
    type: "presence",
    media: state.selfMedia
  })
  renderLocalPreviewState()
}

function applyPeerPresence(media) {
  state.peerMedia = {
    audioEnabled: Boolean(media?.audioEnabled),
    videoEnabled: Boolean(media?.videoEnabled),
    hasVideo: Boolean(media?.hasVideo)
  }
  renderRemoteState()
}

function sendSocketMessage(payload) {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    return
  }

  state.socket.send(JSON.stringify(payload))
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
  clearIntroTimers()
  clearSignalingReconnectTimer()
  stopSocketHeartbeat()
  hideConnectionHelpModal()

  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.close(1000, "User left")
  }

  await hardReset({ returnToSetup: true })
  setStatus("통화를 종료했습니다. 다시 들어가려면 링크를 다시 열어 주세요.")
}

async function hardReset({ returnToSetup = true } = {}) {
  state.isResetting = true
  clearIntroTimers()
  clearSignalingReconnectTimer()
  stopSocketHeartbeat()
  resetPeerConnection()

  if (state.socket) {
    try {
      state.socket.close()
    } catch {
      // Ignore close errors.
    }
  }

  state.socket = null
  state.roomId = null
  state.shouldOffer = false
  state.offerInFlight = false
  state.iceRestartAttempts = 0
  state.iceRestartInFlight = false
  state.peerName = ""
  state.peerMedia = { ...DEFAULT_PEER_MEDIA }
  state.isLeaving = false
  state.isJoining = false
  state.waitingModalDismissed = false
  state.reconnectAttempts = 0
  state.lastPongAt = 0

  stopTracks(state.localStream)
  state.localStream = null
  await releaseWakeLock()
  state.selfMedia = {
    audioEnabled: true,
    videoEnabled: true,
    hasVideo: true
  }

  elements.localVideo.srcObject = null
  elements.remoteVideo.srcObject = null
  hideWaitingModal({ manual: false })
  hideConnectionHelpModal()

  if (returnToSetup) {
    setView("setup")
  }

  renderLocalPreviewState()
  renderRemoteState()
  updateControls()
  state.isResetting = false
}

function resetPeerConnection() {
  if (state.peerConnection) {
    try {
      state.peerConnection.close()
    } catch {
      // Ignore close errors.
    }
  }

  state.peerConnection = null
  state.remoteStream = null
  state.pendingCandidates = []
  state.iceRestartAttempts = 0
  state.iceRestartInFlight = false
  elements.remoteVideo.srcObject = null
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop()
  }
}

function renderLocalPreviewState() {
  const hasStream = Boolean(state.localStream)
  const media = state.localStream ? readLocalMediaState() : state.selfMedia
  const showVideo = hasStream && media.hasVideo && media.videoEnabled
  const micLabel = media.audioEnabled ? "마이크 켜짐" : "음소거"
  const cameraLabel = media.hasVideo ? (media.videoEnabled ? "영상 켜짐" : "카메라 꺼짐") : "음성 전용"

  elements.localBadge.textContent = hasStream ? `나 · ${cameraLabel}` : "나"
  elements.localVideo.classList.toggle("hidden", !showVideo)
  elements.localPlaceholder.classList.toggle("hidden", showVideo)
  elements.localPlaceholder.innerHTML = hasStream
    ? `<strong>${cameraLabel}</strong><span>${micLabel}</span>`
    : "<strong>연결 준비 전</strong><span>곧 내 화면이 여기에 표시됩니다.</span>"
}

function renderRemoteState() {
  const hasPeer = Boolean(state.peerName)
  const showVideo = hasPeer && state.peerMedia.hasVideo && state.peerMedia.videoEnabled
  const name = peerLabel()
  const audioText = state.peerMedia.audioEnabled ? "마이크 켜짐" : "음소거"
  const cameraText = state.peerMedia.hasVideo
    ? state.peerMedia.videoEnabled
      ? "영상 켜짐"
      : "카메라 꺼짐"
    : "음성 전용"

  elements.callTitle.textContent = hasPeer ? name : "상대방을 기다리는 중"
  elements.peerBadge.textContent = hasPeer ? `${name} · ${cameraText}` : "대기 중"
  elements.remoteVideo.classList.toggle("hidden", !showVideo)
  elements.remotePlaceholder.classList.toggle("hidden", showVideo)

  if (!hasPeer) {
    elements.remotePlaceholder.innerHTML =
      "<strong>상대방을 기다리는 중</strong><span>같은 링크로 들어오면 바로 영상·음성 연결을 시작합니다.</span>"
    return
  }

  if (!showVideo) {
    elements.remotePlaceholder.innerHTML = `<strong>${name}</strong><span>${cameraText} · ${audioText}</span>`
  }
}

function updateControls(isBusy = false) {
  const localAudioTrack = state.localStream?.getAudioTracks()[0] ?? null
  const localVideoTrack = state.localStream?.getVideoTracks()[0] ?? null
  const joined = Boolean(state.socket)
  const audioEnabled = Boolean(localAudioTrack?.enabled)
  const videoEnabled = Boolean(localVideoTrack?.enabled)

  elements.inviteBtn.disabled = !state.invite
  elements.leaveBtn.disabled = (!joined && !state.localStream) || isBusy
  elements.toggleMicBtn.disabled = !localAudioTrack
  elements.toggleCameraBtn.disabled = !localVideoTrack
  elements.regenerateLinkBtn.disabled = Boolean(state.peerName)
  elements.shareInviteBtn.disabled = false
  elements.copyInviteBtn.disabled = false

  elements.toggleMicBtn.dataset.active = String(audioEnabled)
  elements.toggleCameraBtn.dataset.active = String(videoEnabled)
  elements.inviteBtn.dataset.active = "true"
  elements.leaveBtn.dataset.active = "true"

  elements.toggleMicText.textContent = audioEnabled ? "마이크" : "음소거"
  elements.toggleCameraText.textContent = videoEnabled ? "카메라" : "영상끔"
  elements.toggleMicOff.classList.toggle("hidden", audioEnabled)
  elements.toggleCameraOff.classList.toggle("hidden", videoEnabled)
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
  syncWaitingModal()
}

function openWaitingModal() {
  if (!state.invite) {
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
      setStatus("연결 확인이 지연되어 자동으로 다시 연결합니다.")
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
  if (state.socketPingTimer) {
    window.clearInterval(state.socketPingTimer)
    state.socketPingTimer = null
  }
}

function scheduleSignalingReconnect() {
  if (state.signalingReconnectTimer || state.isResetting || state.isLeaving) {
    return
  }

  if (!state.localStream || !state.roomId || state.socket) {
    return
  }

  if (!state.networkOnline) {
    setStatus("네트워크 복구를 기다리는 중입니다.")
    return
  }

  if (state.reconnectAttempts >= MAX_SIGNALING_RECONNECT_ATTEMPTS) {
    setStatus("연결 복구가 어려워 다시 시도가 필요합니다.")
    openConnectionHelpModal()
    return
  }

  state.reconnectAttempts += 1
  const attempt = state.reconnectAttempts
  const delay = Math.min(SIGNALING_RECONNECT_BASE_DELAY_MS * attempt, 6000)

  setStatus(`세션을 다시 연결하는 중입니다. (${attempt}/${MAX_SIGNALING_RECONNECT_ATTEMPTS})`)

  state.signalingReconnectTimer = window.setTimeout(async () => {
    state.signalingReconnectTimer = null

    if (state.isResetting || state.isLeaving || !state.localStream || !state.roomId || state.socket) {
      return
    }

    try {
      await openSignalingSocket(DEFAULT_DISPLAY_NAME)
      setStatus("세션을 다시 연결했습니다.")

      if (state.peerConnection && state.peerConnection.connectionState !== "connected") {
        maybeAutoRepairConnection("reconnected")
      }
    } catch {
      scheduleSignalingReconnect()
    }
  }, delay)
}

function clearSignalingReconnectTimer() {
  if (state.signalingReconnectTimer) {
    window.clearTimeout(state.signalingReconnectTimer)
    state.signalingReconnectTimer = null
  }
}

function shouldShowWaitingModal() {
  return state.shouldShowShareModal && !state.peerName
}

function syncWaitingModal(force = false) {
  const shouldShow =
    document.body.dataset.view === "call" &&
    Boolean(state.invite) &&
    (force || (shouldShowWaitingModal() && !state.waitingModalDismissed))

  elements.waitingModal.classList.toggle("hidden", !shouldShow)
}

function beginIntroRedirect() {
  clearIntroTimers()
  state.inviteBootstrapTimer = window.setTimeout(() => {
    state.inviteBootstrapTimer = null
    state.invite = createInvite()
    state.shouldShowShareModal = true
    state.waitingModalDismissed = false
    replaceInviteHash(state.invite)
    renderInvite()
    setStatus("개인 링크가 준비됐습니다. 3초 뒤 통화 화면으로 전환됩니다.")
    scheduleAutoEnter(3000)
  }, 2000)
}

function scheduleAutoEnter(delay = 1000) {
  clearAutoEnterTimer()
  state.autoEnterTimer = window.setTimeout(() => {
    state.autoEnterTimer = null

    if (
      state.invite &&
      !state.socket &&
      !state.peerConnection &&
      !state.localStream &&
      !state.isJoining
    ) {
      void joinCall()
    }
  }, delay)
}

function clearAutoEnterTimer() {
  if (state.autoEnterTimer) {
    window.clearTimeout(state.autoEnterTimer)
    state.autoEnterTimer = null
  }
}

function clearIntroTimers() {
  if (state.inviteBootstrapTimer) {
    window.clearTimeout(state.inviteBootstrapTimer)
    state.inviteBootstrapTimer = null
  }

  clearAutoEnterTimer()
}

function handleNetworkOnline() {
  state.networkOnline = true
  if (state.localStream) {
    setStatus("인터넷이 복구되어 연결을 확인하는 중입니다.")
  }

  if (state.localStream && !state.socket && state.roomId) {
    scheduleSignalingReconnect()
  }

  if (state.localStream) {
    void requestWakeLockIfSupported()
  }
}

function handleNetworkOffline() {
  state.networkOnline = false
  setStatus("인터넷이 끊겼습니다. 다시 연결되면 자동으로 재시도합니다.")
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
    // Ignore release errors.
  } finally {
    state.wakeLock = null
  }
}

async function retryCurrentCall() {
  hideConnectionHelpModal()
  setStatus("같은 링크로 다시 시도합니다...")
  await hardReset({ returnToSetup: false })
  await joinCall({ reuseCurrentView: true })
}

function peerLabel() {
  if (!state.peerName || state.peerName === DEFAULT_DISPLAY_NAME) {
    return "상대방"
  }

  return state.peerName
}

function randomToken(size) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}
