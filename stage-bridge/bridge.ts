// bridge.ts
// The core of stage-bridge. For each active Stage→Audience link, this module
// runs a bot participant that:
//   1. Joins the Stage room and subscribes to all tracks (audio, video, screenshare)
//   2. Joins each linked Audience room and re-publishes those tracks
//   3. Cleans up when the Stage room empties
//
// One BridgeSession is created per Stage channel when it becomes active.
// It manages N audience connections (one per linked audience channel).

import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalTrack,
  Track,
  VideoPresets,
  RoomConnectOptions,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { config } from "./config";

// Tracks an active bridge between one stage and one audience room
interface AudiencePipe {
  channelId: string;
  room: Room;
  // Maps source track sid → the local track we're publishing into audience room
  published_tracks: Map<string, LocalTrack>;
}

// One BridgeSession per active Stage channel
export class BridgeSession {
  private stage_room: Room;
  private audience_pipes: Map<string, AudiencePipe> = new Map();
  private is_torn_down = false;

  constructor(
    private stage_channel_id: string,
    private audience_channel_ids: string[]
  ) {
    this.stage_room = new Room();
  }

  async start(): Promise<void> {
    console.log(
      `[bridge] Starting session for stage=${this.stage_channel_id} ` +
      `→ audiences=[${this.audience_channel_ids.join(", ")}]`
    );

    // Connect to all audience rooms first so we're ready to receive tracks
    for (const audience_id of this.audience_channel_ids) {
      await this.connect_audience(audience_id);
    }

    // Set up stage room event handlers before connecting
    this.stage_room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.on_track_subscribed(track, pub, participant);
      }
    );

    this.stage_room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.on_track_unsubscribed(track, pub, participant);
      }
    );

    this.stage_room.on(RoomEvent.Disconnected, () => {
      console.log(`[bridge] Stage room ${this.stage_channel_id} disconnected`);
      this.teardown();
    });

    // Connect the bot to the stage room
    const stage_token = this.make_token(this.stage_channel_id, {
      canPublish: false,   // bot only listens in stage
      canSubscribe: true,
    });

    await this.stage_room.connect(config.livekit.url, stage_token, {
      autoSubscribe: true, // subscribe to every track automatically
    } as RoomConnectOptions);

    console.log(`[bridge] Bot connected to stage room ${this.stage_channel_id}`);
  }

  // Called when a new track appears in the Stage room
  private async on_track_subscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant
  ): Promise<void> {
    console.log(
      `[bridge] Track subscribed: kind=${track.kind} ` +
      `participant=${participant.identity} sid=${pub.trackSid}`
    );

    // Forward this track into every linked audience room
    for (const pipe of this.audience_pipes.values()) {
      await this.publish_track_to_audience(pipe, track, pub.trackSid);
    }
  }

  // Called when a track disappears from the Stage room
  private async on_track_unsubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    _participant: RemoteParticipant
  ): Promise<void> {
    console.log(`[bridge] Track unsubscribed: sid=${pub.trackSid}`);

    for (const pipe of this.audience_pipes.values()) {
      const local_track = pipe.published_tracks.get(pub.trackSid);
      if (local_track) {
        try {
          await pipe.room.localParticipant?.unpublishTrack(local_track);
        } catch (e) {
          console.warn(`[bridge] Error unpublishing track from audience:`, e);
        }
        pipe.published_tracks.delete(pub.trackSid);
      }
    }
  }

  // Connects the bot to a single audience room
  private async connect_audience(audience_channel_id: string): Promise<void> {
    const room = new Room();
    const pipe: AudiencePipe = {
      channelId: audience_channel_id,
      room,
      published_tracks: new Map(),
    };

    const token = this.make_token(audience_channel_id, {
      canPublish: true,    // bot publishes the stage feed here
      canSubscribe: false, // bot doesn't need to hear audience members
    });

    await room.connect(config.livekit.url, token);
    this.audience_pipes.set(audience_channel_id, pipe);

    console.log(`[bridge] Bot connected to audience room ${audience_channel_id}`);
  }

  // Publishes a single stage track into a single audience room
  private async publish_track_to_audience(
    pipe: AudiencePipe,
    remote_track: RemoteTrack,
    track_sid: string
  ): Promise<void> {
    try {
      // Use the remote track's media stream track directly as a local source
      const local_track = remote_track as unknown as LocalTrack;
      await pipe.room.localParticipant?.publishTrack(local_track);
      pipe.published_tracks.set(track_sid, local_track);

      console.log(
        `[bridge] Published track ${track_sid} (${remote_track.kind}) ` +
        `to audience ${pipe.channelId}`
      );
    } catch (e) {
      console.error(
        `[bridge] Failed to publish track ${track_sid} to audience ${pipe.channelId}:`,
        e
      );
    }
  }

  // Mints a LiveKit access token for the bot participant
  private make_token(
    room_name: string,
    grants: { canPublish: boolean; canSubscribe: boolean }
  ): string {
    const token = new AccessToken(
      config.livekit.api_key,
      config.livekit.api_secret,
      {
        identity: `${config.bot_identity}-${room_name}`,
        name: config.bot_name,
        metadata: JSON.stringify({ is_stage_bridge: true }),
      }
    );

    token.addGrant({
      roomJoin: true,
      room: room_name,
      canPublish: grants.canPublish,
      canSubscribe: grants.canSubscribe,
      canPublishData: false,
      hidden: true, // bot won't show up in participant lists
    });

    return token.toJwt();
  }

  // Tears down the entire session — disconnects from all rooms
  async teardown(): Promise<void> {
    if (this.is_torn_down) return;
    this.is_torn_down = true;

    console.log(`[bridge] Tearing down session for stage=${this.stage_channel_id}`);

    // Disconnect from all audience rooms
    for (const pipe of this.audience_pipes.values()) {
      try {
        await pipe.room.disconnect();
      } catch (e) {
        console.warn(`[bridge] Error disconnecting from audience ${pipe.channelId}:`, e);
      }
    }
    this.audience_pipes.clear();

    // Disconnect from stage room
    try {
      await this.stage_room.disconnect();
    } catch (e) {
      console.warn(`[bridge] Error disconnecting from stage:`, e);
    }
  }
}

// ─── Session Registry ─────────────────────────────────────────────────────────
// Keeps track of all active BridgeSessions so we can look them up by stage
// channel ID when a room_finished event comes in.

const active_sessions: Map<string, BridgeSession> = new Map();

export async function start_bridge(
  stage_channel_id: string,
  audience_channel_ids: string[]
): Promise<void> {
  if (active_sessions.has(stage_channel_id)) {
    console.log(`[bridge] Session already active for ${stage_channel_id}, skipping`);
    return;
  }

  const session = new BridgeSession(stage_channel_id, audience_channel_ids);
  active_sessions.set(stage_channel_id, session);

  try {
    await session.start();
  } catch (e) {
    console.error(`[bridge] Failed to start session for ${stage_channel_id}:`, e);
    active_sessions.delete(stage_channel_id);
    await session.teardown();
  }
}

export async function stop_bridge(stage_channel_id: string): Promise<void> {
  const session = active_sessions.get(stage_channel_id);
  if (!session) {
    console.log(`[bridge] No active session for ${stage_channel_id}, nothing to stop`);
    return;
  }

  active_sessions.delete(stage_channel_id);
  await session.teardown();
}

export function get_active_sessions(): string[] {
  return Array.from(active_sessions.keys());
}
