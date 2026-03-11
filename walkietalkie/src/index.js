import { DurableObject } from "cloudflare:workers"

const ROOM_PATH = /^\/api\/room\/([a-f0-9]{64})\/ws$/

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

    const roomMatch = url.pathname.match(ROOM_PATH)
    if (roomMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket upgrade required.", { status: 426 })
      }

      const roomId = roomMatch[1]
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId))
      const internalUrl = new URL("https://walkietalkie.internal/ws")
      internalUrl.search = url.search

      return stub.fetch(new Request(internalUrl, request))
    }

    const assetResponse = await env.ASSETS.fetch(request)
    return withDefaultHeaders(assetResponse)
  }
}

export class SignalingRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname !== "/ws") {
      return new Response("Not found.", { status: 404 })
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 })
    }

    const clientId = sanitizeId(url.searchParams.get("clientId"))
    const name = sanitizeName(url.searchParams.get("name"))

    if (!clientId) {
      return new Response("Missing clientId.", { status: 400 })
    }

    const currentSessions = this.listSessions()
    if (currentSessions.length >= 2) {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      server.send(
        JSON.stringify({
          type: "room-full",
          message: "이 링크는 이미 두 명이 사용 중입니다."
        })
      )
      server.close(4001, "Room full")
      return new Response(null, { status: 101, webSocket: client })
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
      }
    })

    this.send(server, {
      type: "joined",
      selfId: clientId
    })
    this.broadcastRoomState()

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string") {
      return
    }

    let data
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
      case "signal":
        this.forwardToPeers(ws, {
          type: "signal",
          from: meta.clientId,
          description: data.description ?? null,
          candidate: data.candidate ?? null
        })
        break
      case "presence":
        ws.serializeAttachment({
          ...meta,
          media: sanitizeMedia(data.media)
        })
        this.forwardToPeers(ws, {
          type: "presence",
          from: meta.clientId,
          media: sanitizeMedia(data.media)
        })
        this.broadcastRoomState()
        break
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
      // Close can throw if the socket is already fully closed.
    }

    if (meta.clientId) {
      this.forwardToPeers(ws, {
        type: "peer-left",
        from: meta.clientId
      })
      this.broadcastRoomState()
    }
  }

  webSocketError(ws) {
    const meta = ws.deserializeAttachment() ?? {}
    console.error("WebSocket error in room", meta.clientId ?? "unknown")
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
      .sort((left, right) => {
        const leftTime = Number(left.meta.joinedAt ?? 0)
        const rightTime = Number(right.meta.joinedAt ?? 0)
        return leftTime - rightTime
      })
  }

  broadcastRoomState() {
    const sessions = this.listSessions()
    const members = sessions.map(({ meta }) => ({
      clientId: meta.clientId,
      name: meta.name,
      joinedAt: meta.joinedAt,
      media: sanitizeMedia(meta.media)
    }))
    const initiatorId = members[0]?.clientId ?? null

    for (const { socket, meta } of sessions) {
      this.send(socket, {
        type: "room-state",
        initiatorId,
        shouldOffer:
          members.length === 2 && meta.clientId != null && meta.clientId === initiatorId,
        members
      })
    }
  }

  forwardToPeers(sender, payload) {
    for (const { socket } of this.listSessions()) {
      if (socket === sender) {
        continue
      }

      this.send(socket, payload)
    }
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload))
    } catch (error) {
      console.error("Failed to send websocket payload", error)
    }
  }
}

function sanitizeId(value) {
  return (value ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
}

function sanitizeName(value) {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return "Guest"
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 24)
}

function sanitizeMedia(media) {
  return {
    audioEnabled: Boolean(media?.audioEnabled),
    videoEnabled: Boolean(media?.videoEnabled),
    hasVideo: Boolean(media?.hasVideo)
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
