const STORAGE_PREFIX = "walkietalkie"

const elements = {
  setupView: document.querySelector("#setupView"),
  callView: document.querySelector("#callView"),
  displayName: document.querySelector("#displayName"),
  audioOnly: document.querySelector("#audioOnly"),
  inviteLink: document.querySelector("#inviteLink"),
  inviteHint: document.querySelector("#inviteHint"),
  setupStatusText: document.querySelector("#setupStatusText"),
  joinBtn: document.querySelector("#joinBtn"),
  copyInviteBtn: document.querySelector("#copyInviteBtn"),
  regenerateLinkBtn: document.querySelector("#regenerateLinkBtn"),
  toggleMicBtn: document.querySelector("#toggleMicBtn"),
  toggleMicEmoji: document.querySelector("#toggleMicEmoji"),
  toggleMicText: document.querySelector("#toggleMicText"),
  toggleCameraBtn: document.querySelector("#toggleCameraBtn"),
  toggleCameraEmoji: document.querySelector("#toggleCameraEmoji"),
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

const savedName = localStorage.getItem(`${STORAGE_PREFIX}.displayName`) ?? ""
const savedAudioOnly = localStorage.getItem(`${STORAGE_PREFIX}.audioOnly`) === "true"
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
  peerName: "",
  peerMedia: { ...DEFAULT_PEER_MEDIA },
  selfMedia: {
    audioEnabled: true,
    videoEnabled: !savedAudioOnly,
    hasVideo: !savedAudioOnly
  },
  iceServersPromise: null,
  isLeaving: false
}

elements.displayName.value = savedName
elements.audioOnly.checked = savedAudioOnly

bindEvents()
bootstrap()

function bindEvents() {
  elements.copyInviteBtn.addEventListener("click", copyInviteLink)
  elements.regenerateLinkBtn.addEventListener("click", regenerateInviteLink)
  elements.joinBtn.addEventListener("click", joinCall)
  elements.leaveBtn.addEventListener("click", leaveCall)
  elements.toggleMicBtn.addEventListener("click", toggleMicrophone)
  elements.toggleCameraBtn.addEventListener("click", toggleCamera)
  elements.displayName.addEventListener("change", persistPreferences)
  elements.audioOnly.addEventListener("change", handleAudioModeChange)
  window.addEventListener("hashchange", handleHashChange)
  window.addEventListener("beforeunload", () => {
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.close(1000, "Page unload")
    }
  })
}

function bootstrap() {
  state.invite = ensureInvite()
  renderInvite()
  renderLocalPreviewState()
  renderRemoteState()
  setView("setup")
  setStatus("서버는 연결만 붙여주고 영상·음성은 브라우저끼리 직접 주고받습니다.")
  updateControls()
}

function persistPreferences() {
  localStorage.setItem(`${STORAGE_PREFIX}.displayName`, elements.displayName.value.trim())
  localStorage.setItem(`${STORAGE_PREFIX}.audioOnly`, String(elements.audioOnly.checked))
}

function handleAudioModeChange() {
  persistPreferences()
  if (!state.localStream) {
    state.selfMedia.hasVideo = !elements.audioOnly.checked
    state.selfMedia.videoEnabled = !elements.audioOnly.checked
    renderLocalPreviewState()
    updateControls()
  }
}

function ensureInvite() {
  const fromHash = parseInviteHash(location.hash)
  if (fromHash) {
    return fromHash
  }

  const invite = createInvite()
  replaceInviteHash(invite)
  return invite
}

function handleHashChange() {
  const nextInvite = parseInviteHash(location.hash)
  if (!nextInvite) {
    return
  }

  if (state.localStream || state.socket) {
    replaceInviteHash(state.invite)
    setStatus("통화 중에는 링크를 바꿀 수 없습니다.")
    return
  }

  state.invite = nextInvite
  renderInvite()
  setStatus("새 개인 링크를 불러왔습니다.")
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
  const inviteUrl = buildInviteUrl(state.invite)
  elements.inviteLink.value = inviteUrl
  elements.inviteHint.textContent =
    "둘 다 같은 링크를 저장해두면 다음부터 회원가입 없이 바로 통화할 수 있습니다."
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(elements.inviteLink.value)
    setStatus("개인 링크를 복사했습니다. 그대로 보내면 됩니다.")
  } catch {
    elements.inviteLink.select()
    document.execCommand("copy")
    setStatus("개인 링크를 복사했습니다.")
  }
}

async function regenerateInviteLink() {
  if (state.socket || state.localStream) {
    await leaveCall()
  }

  state.invite = createInvite()
  replaceInviteHash(state.invite)
  renderInvite()
  setStatus("새 개인 링크를 만들었습니다. 이전 링크는 더 이상 쓰지 않는 편이 안전합니다.")
}

async function joinCall() {
  if (state.socket || state.peerConnection) {
    return
  }

  const displayName = normalizeName(elements.displayName.value)
  elements.displayName.value = displayName
  persistPreferences()

  setStatus("브라우저 권한을 확인하고 있습니다...")
  updateControls(true)

  try {
    await prepareLocalMedia(elements.audioOnly.checked)
    setView("call")
    state.roomId = await deriveRoomId(state.invite)
    await openSignalingSocket(displayName)
    setStatus("상대방이 같은 링크로 들어오면 바로 연결됩니다.")
  } catch (error) {
    console.error(error)
    setStatus(
      error instanceof Error
        ? error.message
        : "통화를 시작하지 못했습니다. 브라우저 권한과 네트워크를 확인해 주세요."
    )
    await hardReset({ returnToSetup: true })
  } finally {
    updateControls()
  }
}

async function prepareLocalMedia(audioOnly) {
  stopTracks(state.localStream)

  let stream = null

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: audioOnly
        ? false
        : {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
    })
  } catch (error) {
    if (!audioOnly) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        },
        video: false
      })
      elements.audioOnly.checked = true
      persistPreferences()
      setStatus("카메라를 열 수 없어 이번 통화는 음성 전용으로 전환했습니다.")
    } else {
      throw new Error("마이크 권한이 필요합니다.")
    }
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
      state.socket = socket
      state.isLeaving = false
      settled = true
      sendPresence()
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
      const userInitiated = state.isLeaving

      if (!settled) {
        reject(new Error("방에 연결하지 못했습니다. 링크가 이미 사용 중일 수 있습니다."))
        return
      }

      state.socket = null
      state.shouldOffer = false
      state.offerInFlight = false
      state.isLeaving = false

      if (state.peerConnection) {
        resetPeerConnection()
      }

      if (!userInitiated && state.localStream) {
        setStatus("세션 연결이 종료되었습니다. 다시 통화 시작을 눌러 재연결할 수 있습니다.")
      }

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
      setStatus("워키타키 방에 들어왔습니다. 상대방을 기다리는 중입니다.")
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
      resetPeerConnection()
      renderRemoteState()
      setStatus("상대방이 나갔습니다. 같은 화면에서 다시 기다릴 수 있습니다.")
      break
    case "pong":
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
    setStatus("상대방이 같은 링크로 들어오기를 기다리는 중입니다.")
    return
  }

  if (state.shouldOffer && !state.peerConnection && !state.offerInFlight) {
    await maybeCreateOffer()
  } else if (!state.shouldOffer) {
    setStatus(`${state.peerName}님과 연결 중입니다.`)
  }
}

async function maybeCreateOffer() {
  state.offerInFlight = true

  try {
    await ensurePeerConnection()
    if (!state.peerConnection || state.peerConnection.signalingState !== "stable") {
      return
    }

    const offer = await state.peerConnection.createOffer()
    await state.peerConnection.setLocalDescription(offer)
    sendSocketMessage({
      type: "signal",
      description: state.peerConnection.localDescription
    })
    setStatus("연결 요청을 보냈습니다. 상대방 응답을 기다리는 중입니다.")
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
      setStatus("통화 중입니다.")
    } else if (nextState === "connecting") {
      setStatus("통화 연결 중입니다.")
    } else if (nextState === "disconnected") {
      setStatus("연결이 잠시 불안정합니다.")
    } else if (nextState === "failed") {
      setStatus(
        "직접 연결에 실패했습니다. 서로 다른 네트워크에서 다시 시도하거나 TURN을 추가해야 할 수 있습니다."
      )
    }
  })

  updateControls()
  return connection
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

  await connection.addIceCandidate(candidate)
}

async function flushPendingCandidates() {
  const connection = state.peerConnection
  if (!connection || !connection.remoteDescription) {
    return
  }

  while (state.pendingCandidates.length > 0) {
    const candidate = state.pendingCandidates.shift()
    await connection.addIceCandidate(candidate)
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

  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.close(1000, "User left")
  }

  await hardReset({ returnToSetup: true })
  setStatus("통화를 종료했습니다. 같은 링크로 다시 시작할 수 있습니다.")
}

async function hardReset({ returnToSetup = true } = {}) {
  resetPeerConnection()

  if (state.socket) {
    try {
      state.socket.close()
    } catch {
      // Ignore close errors.
    }
  }

  state.socket = null
  state.shouldOffer = false
  state.offerInFlight = false
  state.peerName = ""
  state.peerMedia = { ...DEFAULT_PEER_MEDIA }
  state.isLeaving = false

  stopTracks(state.localStream)
  state.localStream = null
  state.selfMedia = {
    audioEnabled: true,
    videoEnabled: !elements.audioOnly.checked,
    hasVideo: !elements.audioOnly.checked
  }

  elements.localVideo.srcObject = null
  elements.remoteVideo.srcObject = null

  if (returnToSetup) {
    setView("setup")
  }

  renderLocalPreviewState()
  renderRemoteState()
  updateControls()
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
    : "<strong>통화 시작 전</strong><span>통화를 시작하면 내 화면이 여기에 표시됩니다.</span>"
}

function renderRemoteState() {
  const hasPeer = Boolean(state.peerName)
  const showVideo = hasPeer && state.peerMedia.hasVideo && state.peerMedia.videoEnabled
  const name = state.peerName || "상대방"
  const audioText = state.peerMedia.audioEnabled ? "마이크 켜짐" : "음소거"
  const cameraText = state.peerMedia.hasVideo
    ? state.peerMedia.videoEnabled
      ? "영상 켜짐"
      : "카메라 꺼짐"
    : "음성 전용"

  elements.callTitle.textContent = hasPeer ? `${name}님` : "상대방을 기다리는 중"
  elements.peerBadge.textContent = hasPeer ? `${name} · ${cameraText}` : "대기 중"
  elements.remoteVideo.classList.toggle("hidden", !showVideo)
  elements.remotePlaceholder.classList.toggle("hidden", showVideo)

  if (!hasPeer) {
    elements.remotePlaceholder.innerHTML =
      "<strong>상대방을 기다리는 중</strong><span>같은 링크로 들어오면 바로 영상·음성 연결을 시작합니다.</span>"
    return
  }

  if (!showVideo) {
    elements.remotePlaceholder.innerHTML = `<strong>${name}님</strong><span>${cameraText} · ${audioText}</span>`
  }
}

function updateControls(isBusy = false) {
  const localAudioTrack = state.localStream?.getAudioTracks()[0] ?? null
  const localVideoTrack = state.localStream?.getVideoTracks()[0] ?? null
  const joined = Boolean(state.socket)
  const audioEnabled = Boolean(localAudioTrack?.enabled)
  const videoEnabled = Boolean(localVideoTrack?.enabled)

  elements.joinBtn.disabled = isBusy || joined || Boolean(state.localStream)
  elements.leaveBtn.disabled = !joined && !state.localStream
  elements.toggleMicBtn.disabled = !localAudioTrack
  elements.toggleCameraBtn.disabled = !localVideoTrack
  elements.regenerateLinkBtn.disabled = joined || Boolean(state.localStream)
  elements.displayName.disabled = joined || Boolean(state.localStream)
  elements.audioOnly.disabled = joined || Boolean(state.localStream)

  elements.toggleMicBtn.dataset.active = String(audioEnabled)
  elements.toggleCameraBtn.dataset.active = String(videoEnabled)
  elements.leaveBtn.dataset.active = "true"

  elements.toggleMicEmoji.textContent = audioEnabled ? "🎙️" : "🔇"
  elements.toggleMicText.textContent = audioEnabled ? "마이크" : "음소거"
  elements.toggleCameraEmoji.textContent = videoEnabled ? "📹" : "🚫"
  elements.toggleCameraText.textContent = videoEnabled ? "카메라" : "영상끔"
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
}

function normalizeName(value) {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed) {
    return trimmed.slice(0, 24)
  }

  return "Guest"
}

function randomToken(size) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}
