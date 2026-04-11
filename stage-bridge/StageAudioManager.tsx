// StageAudioManager.tsx
// Renders hidden audio elements for the stage feed room when a stage bridge
// is active. Drop this file in:
// packages/client/components/rtc/components/StageAudioManager.tsx
//
// It works alongside RoomAudioManager — that handles the user's own voice
// channel, this handles the read-only stage feed connection.

import { createMemo, Show } from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";
import { RoomContext } from "solid-livekit-components";
import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { Track } from "livekit-client";
import { useState } from "@revolt/state";
import { useVoice } from "../state";

/**
 * Mount this alongside <RoomAudioManager /> in state.tsx.
 * It renders nothing visible — just hidden <audio> elements for the stage feed.
 *
 * Requires voice.stageRoom to be an Accessor<Room | undefined> signal.
 */
export function StageAudioManager() {
  const voice = useVoice();

  return (
    <Show when={voice.stageRoom()}>
      {(stageRoom) => (
        <RoomContext.Provider value={stageRoom()}>
          <StageAudioTracks />
        </RoomContext.Provider>
      )}
    </Show>
  );
}

/**
 * Inner component that runs inside the stage RoomContext.
 * useTracks() will pick up the stage room's tracks automatically.
 */
function StageAudioTracks() {
  const state = useState();

  const tracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown],
    {
      updateOnlyOn: [],
      onlySubscribed: false,
    }
  );

  const filteredTracks = createMemo(() =>
    tracks().filter(
      (track) =>
        !isLocal(track.participant) &&
        track.publication.kind === Track.Kind.Audio
    )
  );

  return (
    <div style={{ display: "none" }}>
      <Key each={filteredTracks()} by={(item) => getTrackReferenceId(item)}>
        {(track) => (
          <AudioTrack
            trackRef={track()}
            volume={state.voice.outputVolume}
            muted={false}
            enableBoosting
          />
        )}
      </Key>
    </div>
  );
}
