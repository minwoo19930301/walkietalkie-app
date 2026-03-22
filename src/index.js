import { DurableObject } from "cloudflare:workers"

const WS_PATH = /^\/api\/rooms\/([a-z0-9-]{6,32})\/ws$/
const JOIN_PATH = /^\/api\/rooms\/([a-z0-9-]{6,32})\/join$/
const ROOM_ID_REGEX = /^[a-z0-9-]{6,32}$/
const LOBBY_ROOM_ID_REGEX = /^\d{6}$/
const PIN_REGEX = /^[0-9]{4}$/
const ALLOWED_CAPACITIES = new Set([4, 6, 8])
const ROOM_META_KEY = "room_meta"
const LOBBY_ROOMS_KEY = "rooms"
const ROOM_IDLE_TTL_MS = 1000 * 60 * 20
const LOBBY_ACTIVE_TTL_MS = 1000 * 45

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === "/api/ice") {
      return json({
        iceServers: [
          {
            urls: "stun:stun.cloudflare.com:3478"
          }
        ]
      })
    }

    if (url.pathname === "/api/lobby") {
      if (request.method !== "GET") {
        return json(
          {
            message: "Method not allowed."
          },
          { status: 405 }
        )
      }

      const response = await dispatchToLobby(env, "/list", {
        method: "GET"
      })
      return withDefaultHeaders(response)
    }

    if (url.pathname === "/api/rooms") {
      if (request.method !== "POST") {
        return json(
          {
            message: "Method not allowed."
          },
          { status: 405 }
        )
      }

      return createRoom(request, env)
    }

    const joinMatch = url.pathname.match(JOIN_PATH)
    if (joinMatch) {
      if (request.method !== "POST") {
        return json(
          {
            message: "Method not allowed."
          },
          { status: 405 }
        )
      }

      return joinRoom(request, env, joinMatch[1])
    }

    const roomWsMatch = url.pathname.match(WS_PATH)
    if (roomWsMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required.", { status: 426 })
      }

      const roomId = roomWsMatch[1]
      const stub = roomStub(env, roomId)
      const internalUrl = new URL("https://walkietalkie.internal/ws")
      internalUrl.search = url.search

      return stub.fetch(new Request(internalUrl, request))
    }

    const assetResponse = await env.ASSETS.fetch(request)
    return withDefaultHeaders(assetResponse)
  }
}

async function createRoom(request, env) {
  const payload = await parseRequestJson(request)
  const roomInput = validateCreatePayload(payload)
  if (!roomInput.ok) {
    return json(
      {
        message: roomInput.message
      },
      { status: 400 }
    )
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const identity = generateRoomIdentity()
    const response = await dispatchToRoom(env, identity.roomId, "/create", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: identity.roomId,
        roomTitle: identity.roomTitle,
        capacity: roomInput.room.capacity,
        isPrivate: roomInput.room.isPrivate,
        pin: roomInput.room.pin
      })
    })

    if (response.status === 409) {
      continue
    }

    if (!response.ok) {
      const errorPayload = await parseResponseJson(response)
      return json(
        {
          message: errorPayload.message ?? "방 생성에 실패했습니다."
        },
        { status: response.status }
      )
    }

    const roomMeta = await parseResponseJson(response)
    return json(roomMeta, { status: 201 })
  }

  return json(
    {
      message: "사용 가능한 방 번호를 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
    },
    { status: 503 }
  )
}

async function joinRoom(request, env, roomId) {
  if (!ROOM_ID_REGEX.test(roomId)) {
    return json(
      {
        message: "잘못된 방 링크입니다."
      },
      { status: 400 }
    )
  }

  const bodyText = await request.text()
  const response = await dispatchToRoom(env, roomId, "/join", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: bodyText || "{}"
  })

  if (!response.ok) {
    if (response.status === 404) {
      await dispatchToLobby(env, "/remove", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          roomId
        })
      })
    }

    const errorPayload = await parseResponseJson(response)
    return json(
      {
        message: errorPayload.message ?? "방 입장 검증에 실패했습니다."
      },
      { status: response.status }
    )
  }

  return withDefaultHeaders(response)
}

function roomStub(env, roomId) {
  return env.ROOMS.get(env.ROOMS.idFromName(`room:${roomId}`))
}

function lobbyStub(env) {
  return env.LOBBY.get(env.LOBBY.idFromName("active-lobby"))
}

async function dispatchToRoom(env, roomId, pathname, init) {
  const stub = roomStub(env, roomId)
  const url = new URL(`https://walkietalkie.internal${pathname}`)
  return stub.fetch(new Request(url, init))
}

async function dispatchToLobby(env, pathname, init) {
  const stub = lobbyStub(env)
  const url = new URL(`https://walkietalkie.internal${pathname}`)
  return stub.fetch(new Request(url, init))
}

export class SignalingRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx = ctx
    this.env = env
    this.room = null
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/create") {
      return this.handleCreate(request)
    }

    if (url.pathname === "/join") {
      return this.handleJoin(request)
    }

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request, url)
    }

    return new Response("Not found.", { status: 404 })
  }

  async handleCreate(request) {
    const payload = await parseRequestJson(request)
    const normalized = validateStoredRoomPayload(payload)
    if (!normalized.ok) {
      return json(
        {
          message: normalized.message
        },
        { status: 400 }
      )
    }

    const currentRoom = await this.readRoomMeta()
    if (currentRoom) {
      return json(
        {
          message: "이미 사용 중인 방입니다. 다시 시도해 주세요."
        },
        { status: 409 }
      )
    }

    this.room = {
      roomId: normalized.room.roomId,
      roomTitle: normalized.room.roomTitle,
      capacity: normalized.room.capacity,
      isPrivate: normalized.room.isPrivate,
      pin: normalized.room.pin,
      createdAt: Date.now()
    }

    await this.ctx.storage.put(ROOM_META_KEY, this.room)
    await this.syncLobbySummary()

    return json(publicRoomMeta(this.room), { status: 201 })
  }

  async handleJoin(request) {
    const room = await this.readRoomMeta()
    if (!room) {
      return json(
        {
          message: "해당 방을 찾지 못했습니다."
        },
        { status: 404 }
      )
    }

    const payload = await parseRequestJson(request)
    const pin = sanitizePin(payload.pin)

    if (room.isPrivate && pin !== room.pin) {
      return json(
        {
          message: "비밀번호 4자리가 맞지 않습니다."
        },
        { status: 403 }
      )
    }

    const participants = this.listSessions().length
    if (participants >= room.capacity) {
      return json(
        {
          message: "방 인원이 가득 찼습니다."
        },
        { status: 409 }
      )
    }

    return json({
      ...publicRoomMeta(room),
      currentParticipants: participants
    })
  }

  async handleWebSocket(request, url) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 })
    }

    const room = await this.readRoomMeta()
    if (!room) {
      return this.wsErrorResponse(4404, "해당 방이 없습니다.", "error")
    }

    const clientId = sanitizeClientId(url.searchParams.get("clientId"))
    const name = sanitizeName(url.searchParams.get("name"))
    const pin = sanitizePin(url.searchParams.get("pin"))

    if (!clientId) {
      return this.wsErrorResponse(4410, "clientId가 없습니다.", "error")
    }

    if (room.isPrivate && pin !== room.pin) {
      return this.wsErrorResponse(4403, "비밀번호가 맞지 않습니다.", "error")
    }

    const duplicate = this.listSessions().find(({ meta }) => meta.clientId === clientId)
    if (duplicate) {
      try {
        duplicate.socket.close(1012, "Replaced by a new session")
      } catch {
        // Ignore duplicate close errors.
      }
    }

    if (this.listSessions().length >= room.capacity) {
      return this.wsErrorResponse(4409, "방 인원이 가득 찼습니다.", "room-full")
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      clientId,
      name,
      joinedAt: Date.now(),
      media: {
        audioEnabled: true,
        videoEnabled: true,
        hasVideo: true
      },
      roomId: room.roomId,
      roomTitle: room.roomTitle,
      capacity: room.capacity,
      isPrivate: room.isPrivate
    })

    this.send(server, {
      type: "joined",
      selfId: clientId,
      room: publicRoomMeta(room)
    })
    this.broadcastRoomState()
    this.ctx.waitUntil(this.syncLobbySummary())

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") {
      return
    }

    let data = null
    try {
      data = JSON.parse(message)
    } catch {
      this.send(ws, {
        type: "error",
        message: "잘못된 메시지 형식입니다."
      })
      return
    }

    const meta = ws.deserializeAttachment() ?? {}
    if (!meta.clientId) {
      return
    }

    switch (data.type) {
      case "signal": {
        const to = sanitizeClientId(data.to)
        if (!to) {
          this.send(ws, {
            type: "error",
            message: "신호 대상이 없습니다."
          })
          return
        }

        this.forwardToClient(to, {
          type: "signal",
          from: meta.clientId,
          description: data.description ?? null,
          candidate: data.candidate ?? null
        })
        break
      }
      case "presence": {
        const nextMedia = sanitizeMedia(data.media)
        ws.serializeAttachment({
          ...meta,
          media: nextMedia
        })
        this.broadcastToPeers(meta.clientId, {
          type: "presence",
          from: meta.clientId,
          media: nextMedia
        })
        this.broadcastRoomState()
        break
      }
      case "chat": {
        const text = sanitizeChatText(data.text)
        if (!text) {
          this.send(ws, {
            type: "error",
            message: "채팅 내용이 비어 있습니다."
          })
          return
        }

        this.broadcastToPeers(meta.clientId, {
          type: "chat",
          from: meta.clientId,
          text
        })
        break
      }
      case "doodle": {
        const segment = sanitizeDoodleSegment(data.segment)
        if (!segment) {
          return
        }

        this.broadcastToPeers(meta.clientId, {
          type: "doodle",
          from: meta.clientId,
          segment
        })
        break
      }
      case "doodle-clear":
        this.broadcastToPeers(meta.clientId, {
          type: "doodle-clear",
          from: meta.clientId
        })
        break
      case "ping":
        this.ctx.waitUntil(this.syncLobbySummary())
        this.send(ws, { type: "pong" })
        break
      default:
        this.send(ws, {
          type: "error",
          message: "지원하지 않는 메시지입니다."
        })
    }
  }

  webSocketClose(ws, code, reason) {
    const meta = ws.deserializeAttachment() ?? {}

    try {
      ws.close(code, reason)
    } catch {
      // Close can throw when already closed.
    }

    if (meta.clientId) {
      this.broadcastToPeers(meta.clientId, {
        type: "peer-left",
        from: meta.clientId
      })
    }

    this.broadcastRoomState()
    this.ctx.waitUntil(this.syncLobbySummary())
    this.ctx.waitUntil(this.clearRoomMetaWhenEmpty())
  }

  webSocketError(ws) {
    const meta = ws.deserializeAttachment() ?? {}
    console.error("WebSocket error in room", meta.clientId ?? "unknown")
  }

  async readRoomMeta() {
    if (this.room) {
      return this.maybeExpireRoomMeta(this.room)
    }

    const saved = await this.ctx.storage.get(ROOM_META_KEY)
    this.room = saved ?? null
    return this.maybeExpireRoomMeta(this.room)
  }

  async maybeExpireRoomMeta(roomMeta) {
    if (!roomMeta) {
      return null
    }

    const createdAt = Number(roomMeta.createdAt ?? 0)
    const isExpired = createdAt > 0 && Date.now() - createdAt > ROOM_IDLE_TTL_MS
    if (!isExpired) {
      return roomMeta
    }

    if (this.listSessions().length > 0) {
      return roomMeta
    }

    await this.removeRoom()
    return null
  }

  async clearRoomMetaWhenEmpty() {
    if (this.listSessions().length > 0) {
      return
    }

    await this.removeRoom()
  }

  async removeRoom() {
    const roomId = sanitizeRoomId(this.room?.roomId)
    this.room = null
    await this.ctx.storage.delete(ROOM_META_KEY)

    if (!roomId) {
      return
    }

    await dispatchToLobby(this.env, "/remove", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId
      })
    })
  }

  async syncLobbySummary() {
    const room = await this.readRoomMeta()
    const participants = this.listSessions().length

    if (!room || participants <= 0) {
      const roomId = sanitizeRoomId(room?.roomId ?? this.room?.roomId)
      if (!roomId) {
        return
      }

      await dispatchToLobby(this.env, "/remove", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          roomId
        })
      })
      return
    }

    await dispatchToLobby(this.env, "/upsert", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: room.roomId,
        roomTitle: room.roomTitle,
        capacity: room.capacity,
        isPrivate: room.isPrivate,
        participants,
        updatedAt: Date.now()
      })
    })
  }

  listSessions() {
    return this.ctx
      .getWebSockets()
      .map((socket) => ({
        socket,
        meta: socket.deserializeAttachment() ?? {}
      }))
      .filter(
        ({ socket, meta }) => socket.readyState === WebSocket.OPEN && Boolean(meta.clientId)
      )
      .sort((left, right) => Number(left.meta.joinedAt ?? 0) - Number(right.meta.joinedAt ?? 0))
  }

  broadcastRoomState() {
    const sessions = this.listSessions()
    const roomFromSocket = sessions[0]?.meta
    const room = this.room ?? {
      roomId: roomFromSocket?.roomId ?? "",
      roomTitle: roomFromSocket?.roomTitle ?? "000000",
      capacity: sanitizeCapacity(roomFromSocket?.capacity),
      isPrivate: Boolean(roomFromSocket?.isPrivate)
    }

    const members = sessions.map(({ meta }) => ({
      clientId: meta.clientId,
      name: sanitizeName(meta.name),
      joinedAt: Number(meta.joinedAt ?? Date.now()),
      media: sanitizeMedia(meta.media)
    }))

    for (const { socket } of sessions) {
      this.send(socket, {
        type: "room-state",
        room: publicRoomMeta(room),
        members
      })
    }
  }

  broadcastToPeers(senderId, payload) {
    for (const { socket, meta } of this.listSessions()) {
      if (!meta.clientId || meta.clientId === senderId) {
        continue
      }

      this.send(socket, payload)
    }
  }

  forwardToClient(targetClientId, payload) {
    for (const { socket, meta } of this.listSessions()) {
      if (meta.clientId !== targetClientId) {
        continue
      }

      this.send(socket, payload)
      return
    }
  }

  wsErrorResponse(closeCode, message, type = "error") {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server)
    this.send(server, {
      type,
      message
    })
    server.close(closeCode, message)

    return new Response(null, { status: 101, webSocket: client })
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload))
    } catch (error) {
      console.error("Failed to send websocket payload", error)
    }
  }
}

export class LobbyRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx = ctx
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/list") {
      return this.handleList()
    }

    if (url.pathname === "/upsert") {
      return this.handleUpsert(request)
    }

    if (url.pathname === "/remove") {
      return this.handleRemove(request)
    }

    return new Response("Not found.", { status: 404 })
  }

  async handleList() {
    const roomsMap = await this.readRoomsMap()
    const rooms = Object.values(roomsMap)
      .map((room) => sanitizeLobbySummary(room))
      .filter((room) => room != null)
      .filter((room) => Date.now() - room.updatedAt < LOBBY_ACTIVE_TTL_MS)
      .filter((room) => room.participants > 0 && room.participants < room.capacity)
      .sort((left, right) => right.updatedAt - left.updatedAt)

    const cleanedMap = Object.fromEntries(rooms.map((room) => [room.roomId, room]))
    await this.ctx.storage.put(LOBBY_ROOMS_KEY, cleanedMap)

    return json({ rooms })
  }

  async handleUpsert(request) {
    const payload = await parseRequestJson(request)
    const summary = sanitizeLobbySummary(payload)
    if (!summary) {
      return json(
        {
          message: "잘못된 대기실 데이터입니다."
        },
        { status: 400 }
      )
    }

    const roomsMap = await this.readRoomsMap()
    roomsMap[summary.roomId] = summary
    await this.ctx.storage.put(LOBBY_ROOMS_KEY, roomsMap)

    return json({ ok: true })
  }

  async handleRemove(request) {
    const payload = await parseRequestJson(request)
    const roomId = sanitizeRoomId(payload.roomId)
    if (!roomId) {
      return json({ ok: true })
    }

    const roomsMap = await this.readRoomsMap()
    delete roomsMap[roomId]
    await this.ctx.storage.put(LOBBY_ROOMS_KEY, roomsMap)

    return json({ ok: true })
  }

  async readRoomsMap() {
    const roomsMap = await this.ctx.storage.get(LOBBY_ROOMS_KEY)
    if (!roomsMap || typeof roomsMap !== "object") {
      return {}
    }
    return roomsMap
  }
}

function validateCreatePayload(payload) {
  const capacity = sanitizeCapacity(payload?.capacity)
  const isPrivate = Boolean(payload?.isPrivate)
  const pin = sanitizePin(payload?.pin)

  if (!ALLOWED_CAPACITIES.has(capacity)) {
    return {
      ok: false,
      message: "최대 인원은 4명, 6명, 8명 중에서 선택해 주세요."
    }
  }

  if (isPrivate && !PIN_REGEX.test(pin)) {
    return {
      ok: false,
      message: "비공개방 비밀번호는 숫자 4자리여야 합니다."
    }
  }

  return {
    ok: true,
    room: {
      capacity,
      isPrivate,
      pin: isPrivate ? pin : ""
    }
  }
}

function validateStoredRoomPayload(payload) {
  const roomId = sanitizeRoomId(payload?.roomId)
  const roomTitle = sanitizeRoomTitle(payload?.roomTitle)
  const capacity = sanitizeCapacity(payload?.capacity)
  const isPrivate = Boolean(payload?.isPrivate)
  const pin = sanitizePin(payload?.pin)

  if (!roomId) {
    return {
      ok: false,
      message: "방 ID가 없습니다."
    }
  }

  if (!roomTitle) {
    return {
      ok: false,
      message: "방 이름이 없습니다."
    }
  }

  if (!ALLOWED_CAPACITIES.has(capacity)) {
    return {
      ok: false,
      message: "최대 인원이 올바르지 않습니다."
    }
  }

  if (isPrivate && !PIN_REGEX.test(pin)) {
    return {
      ok: false,
      message: "비밀번호 4자리가 필요합니다."
    }
  }

  return {
    ok: true,
    room: {
      roomId,
      roomTitle,
      capacity,
      isPrivate,
      pin: isPrivate ? pin : ""
    }
  }
}

function sanitizeCapacity(value) {
  const parsed = Number(value)
  return ALLOWED_CAPACITIES.has(parsed) ? parsed : 4
}

function sanitizePin(value) {
  return `${value ?? ""}`.replace(/\D/g, "").slice(0, 4)
}

function sanitizeRoomId(value) {
  const safe = `${value ?? ""}`.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
  return ROOM_ID_REGEX.test(safe) ? safe : ""
}

function sanitizeClientId(value) {
  return `${value ?? ""}`.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
}

function sanitizeName(value) {
  const trimmed = `${value ?? ""}`.trim()
  if (!trimmed) {
    return "참여자"
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 24)
}

function sanitizeRoomTitle(value) {
  const trimmed = `${value ?? ""}`.trim()
  if (!trimmed) {
    return ""
  }

  return trimmed.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32).toUpperCase()
}

function sanitizeMedia(media) {
  return {
    audioEnabled: Boolean(media?.audioEnabled),
    videoEnabled: Boolean(media?.videoEnabled),
    hasVideo: Boolean(media?.hasVideo)
  }
}

function sanitizeChatText(value) {
  const trimmed = `${value ?? ""}`.trim()
  if (!trimmed) {
    return ""
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 60)
}

function sanitizeDoodleSegment(segment) {
  const from = sanitizeDoodlePoint(segment?.from)
  const to = sanitizeDoodlePoint(segment?.to)
  if (!from || !to) {
    return null
  }

  return { from, to }
}

function sanitizeDoodlePoint(point) {
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

function sanitizeLobbySummary(value) {
  const roomId = sanitizeRoomId(value?.roomId)
  const roomTitle = sanitizeRoomTitle(value?.roomTitle)
  const capacity = sanitizeCapacity(value?.capacity)
  const participants = Math.max(0, Math.min(Number(value?.participants ?? 0), capacity))
  const updatedAt = Number(value?.updatedAt ?? Date.now())

  if (!roomId || !roomTitle || !LOBBY_ROOM_ID_REGEX.test(roomId)) {
    return null
  }

  return {
    roomId,
    roomTitle,
    capacity,
    isPrivate: Boolean(value?.isPrivate),
    participants,
    updatedAt
  }
}

function publicRoomMeta(room) {
  return {
    roomId: sanitizeRoomId(room?.roomId),
    roomTitle: sanitizeRoomTitle(room?.roomTitle),
    capacity: sanitizeCapacity(room?.capacity),
    isPrivate: Boolean(room?.isPrivate)
  }
}

function generateRoomIdentity() {
  const digits = randomDigits(6)

  return {
    roomId: digits,
    roomTitle: digits
  }
}

function randomDigits(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => String(value % 10)).join("")
}

async function parseRequestJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function parseResponseJson(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function json(payload, init = {}) {
  const response = new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {})
    }
  })

  return withDefaultHeaders(response)
}

function withDefaultHeaders(response) {
  const headers = new Headers(response.headers)
  headers.set("Referrer-Policy", "same-origin")
  headers.set("X-Content-Type-Options", "nosniff")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
