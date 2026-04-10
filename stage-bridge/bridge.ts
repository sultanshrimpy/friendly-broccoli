// bridge.ts
// Uses LiveKit's server-side AgentDispatch / RoomService approach.
// Rather than trying to republish WebRTC tracks (which the Node SDK doesn't
// support), we use LiveKit's built-in "forward participant" capability via
// the RoomService API to move the stage feed into audience rooms.
//
// Strategy:
// - When a stage room becomes active, we call RoomService to create a
//   "forwarded participant" in each linked audience room using LiveKit's
//   participant dispatch / egress-to-ingress via WHIP/WHEP if available,
//   OR we fall back to a simpler approach: we notify audience rooms that
//   the stage is live via room metadata, and the frontend handles rendering
//   the stage feed directly by connecting to both rooms.
//
// Since @livekit/rtc-node cannot re-publish remote tracks (it requires
// local media sources), the cleanest self-hosted solution is to store
// the active stage room name in the audience room's metadata so the
// frontend can subscribe to it directly.

import { RoomServiceClient } from "livekit-server-sdk";
import { config } from "./config";

const room_service = new RoomServiceClient(
  // Convert ws:// URL to http:// for the REST API
  config.livekit.url.replace(/^ws(s)?:\/\//, "http$1://"),
  config.livekit.api_key,
  config.livekit.api_secret
);

// ── Active session tracking ───────────────────────────────────────────────────

interface ActiveBridge {
  stage_channel_id: string;
  audience_channel_ids: string[];
}

const active_sessions: Map<string, ActiveBridge> = new Map();

// ── Bridge start/stop ─────────────────────────────────────────────────────────

export async function start_bridge(
  stage_channel_id: string,
  audience_channel_ids: string[]
): Promise<void> {
  if (active_sessions.has(stage_channel_id)) {
    console.log(`[bridge] Session already active for ${stage_channel_id}, skipping`);
    return;
  }

  active_sessions.set(stage_channel_id, { stage_channel_id, audience_channel_ids });

  console.log(
    `[bridge] Starting bridge: stage=${stage_channel_id} ` +
    `→ audiences=[${audience_channel_ids.join(", ")}]`
  );

  // Write the stage room name into each audience room's metadata.
  // The frontend reads this to know which stage room to subscribe to
  // for the read-only feed. This is the reliable self-hosted approach
  // since it doesn't require egress workers or track-level forwarding.
  for (const audience_id of audience_channel_ids) {
    try {
      await room_service.updateRoomMetadata(
        audience_id,
        JSON.stringify({
          stage_feed: stage_channel_id,
          stage_active: true,
        })
      );
      console.log(
        `[bridge] Set stage feed metadata on audience room ${audience_id} ` +
        `→ stage=${stage_channel_id}`
      );
    } catch (e) {
      // Audience room may not exist yet if no one has joined —
      // that's fine, the frontend will poll /status to get the mapping
      console.warn(
        `[bridge] Could not update metadata for audience room ${audience_id} ` +
        `(room may not exist yet):`, e
      );
    }
  }
}

export async function stop_bridge(stage_channel_id: string): Promise<void> {
  const session = active_sessions.get(stage_channel_id);
  if (!session) {
    console.log(`[bridge] No active session for ${stage_channel_id}, nothing to stop`);
    return;
  }

  console.log(`[bridge] Stopping bridge for stage=${stage_channel_id}`);

  // Clear the stage feed metadata from all linked audience rooms
  for (const audience_id of session.audience_channel_ids) {
    try {
      await room_service.updateRoomMetadata(
        audience_id,
        JSON.stringify({
          stage_feed: null,
          stage_active: false,
        })
      );
      console.log(`[bridge] Cleared stage feed metadata on audience room ${audience_id}`);
    } catch (e) {
      console.warn(`[bridge] Could not clear metadata for ${audience_id}:`, e);
    }
  }

  active_sessions.delete(stage_channel_id);
}

export function get_active_sessions(): string[] {
  return Array.from(active_sessions.keys());
}

// ── Active link lookup (used by API status endpoint) ─────────────────────────

export function get_session(stage_channel_id: string): ActiveBridge | undefined {
  return active_sessions.get(stage_channel_id);
}
