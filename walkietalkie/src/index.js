import { DurableObject } from "cloudflare:workers"

const WS_PATH = /^\/api\/rooms\/([0-9]{4})\/ws$/
const JOIN_PATH = /^\/api\/rooms\/([0-9]{4})\/join$/
const ROOM_CODE_REGEX = /^[0-9]{4}$/
const PIN_REGEX = /^[0-9]{4}$/
const ALLOWED_CAPACITIES = new Set([4, 6, 8])
const ROOM_META_KEY = "room_meta"
const ROOM_IDLE_TTL_MS = 1000 * 60 * 20

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

      const roomCode = roomWsMatch[1]
      const stub = roomStub(env, roomCode)
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
    const roomCode = randomDigits(4)
    if (!ROOM_CODE_REGEX.test(roomCode)) {
      continue
    }

    const response = await dispatchToRoom(env, roomCode, "/create", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: roomInput.room.roomTitle,
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
    return json({
      roomCode,
      roomTitle: roomMeta.roomTitle,
      capacity: roomMeta.capacity,
      isPrivate: roomMeta.isPrivate
    })
  }

  return json(
    {
      message: "사용 가능한 방 키를 찾지 못했습니다. 잠시 후 다시 시도해 주세요."
    },
    { status: 503 }
  )
}

async function joinRoom(request, env, roomCode) {
  if (!ROOM_CODE_REGEX.test(roomCode)) {
    return json(
      {
        message: "방 키는 숫자 4자리입니다."
      },
      { status: 400 }
    )
  }

  const bodyText = await request.text()
  const response = await dispatchToRoom(env, roomCode, "/join", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: bodyText || "{}"
  })

  if (!response.ok) {
    const errorPayload = await parseResponseJson(response)
    return json(
      {
        message: errorPayload.message ?? "방 입장 검증에 실패했습니다."
      },
      { status: response.status }
    )
  }

  const roomMeta = await parseResponseJson(response)
  return json({
    roomTitle: roomMeta.roomTitle,
    capacity: roomMeta.capacity,
    isPrivate: roomMeta.isPrivate,
    currentParticipants: roomMeta.currentParticipants
  })
}

function roomStub(env, roomCode) {
  return env.ROOMS.get(env.ROOMS.idFromName(`room:${roomCode}`))
}

async function dispatchToRoom(env, roomCode, pathname, init) {
  const stub = roomStub(env, roomCode)
  const url = new URL(`https://walkietalkie.internal${pathname}`)
  return stub.fetch(new Request(url, init))
}

export class SignalingRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
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
    if (request.method !== "POST") {
      return json(
        {
          message: "Method not allowed."
        },
        { status: 405 }
      )
    }

    const payload = await parseRequestJson(request)
    const normalized = validateCreatePayload(payload)
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
          message: "이미 사용 중인 방 키입니다. 다시 시도해 주세요."
        },
        { status: 409 }
      )
    }

    const nextRoom = {
      roomTitle: normalized.room.roomTitle,
      capacity: normalized.room.capacity,
      isPrivate: normalized.room.isPrivate,
      pin: normalized.room.pin,
      createdAt: Date.now()
    }

    this.room = nextRoom
    await this.ctx.storage.put(ROOM_META_KEY, nextRoom)

    return json(publicRoomMeta(nextRoom), { status: 201 })
  }

  async handleJoin(request) {
    if (request.method !== "POST") {
      return json(
        {
          message: "Method not allowed."
        },
        { status: 405 }
      )
    }

    const room = await this.readRoomMeta()
    if (!room) {
      return json(
        {
          message: "해당 방을 찾지 못했습니다. 방 키를 다시 확인해 주세요."
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

    const sessions = this.listSessions()
    if (sessions.length >= room.capacity) {
      return json(
        {
          message: "방 인원이 가득 찼습니다."
        },
        { status: 409 }
      )
    }

    return json({
      ...publicRoomMeta(room),
      currentParticipants: sessions.length
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
      return this.wsErrorResponse(4403, "비밀번호 4자리가 일치하지 않습니다.", "error")
    }

    const duplicate = this.listSessions().find(({ meta }) => meta.clientId === clientId)
    if (duplicate) {
      try {
        duplicate.socket.close(1012, "Replaced by a new session")
      } catch {
        // Ignore duplicate close errors.
      }
    }

    const sessions = this.listSessions()
    if (sessions.length >= room.capacity) {
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
            message: "신호 대상(to)이 없습니다."
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
      case "ping":
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

    this.room = null
    await this.ctx.storage.delete(ROOM_META_KEY)
    return null
  }

  async clearRoomMetaWhenEmpty() {
    const sessions = this.listSessions()
    if (sessions.length > 0) {
      return
    }

    this.room = null
    await this.ctx.storage.delete(ROOM_META_KEY)
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
      roomTitle: roomFromSocket?.roomTitle ?? "워키토키 방",
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

function validateCreatePayload(payload) {
  const roomTitle = sanitizeRoomTitle(payload?.title)
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
    return "워키토키 방"
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 32)
}

function sanitizeMedia(media) {
  return {
    audioEnabled: Boolean(media?.audioEnabled),
    videoEnabled: Boolean(media?.videoEnabled),
    hasVideo: Boolean(media?.hasVideo)
  }
}

function publicRoomMeta(room) {
  return {
    roomTitle: sanitizeRoomTitle(room?.roomTitle),
    capacity: sanitizeCapacity(room?.capacity),
    isPrivate: Boolean(room?.isPrivate)
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
