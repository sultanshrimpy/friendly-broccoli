// ─────────────────────────────────────────────────────────────────────────────
// FILE 1: packages/client/components/modal/modals/StageBridgeLinks.tsx
// NEW FILE — drop this alongside CreateChannel.tsx
//
// A multi-select picker that lets you choose which voice channels
// should receive this channel's stage feed.
// ─────────────────────────────────────────────────────────────────────────────

import { createSignal, createResource, For, Show } from "solid-js";
import { styled } from "@revolt/ui";
import { Trans } from "@lingui/solid/macro";
import type { Channel, Server } from "revolt.js";

// Read the stage-bridge URL from env — falls back to relative path
// so it works behind your Caddy reverse proxy at /stage-bridge
const BRIDGE_URL =
  (import.meta.env.VITE_STAGE_BRIDGE_URL as string | undefined) ??
  "/stage-bridge";

// ── Styled components ─────────────────────────────────────────────────────────

const Section = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    marginTop: "var(--gap-md)",
  },
});

const Label = styled("span", {
  base: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--md-sys-color-on-surface-variant)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
});

const ChannelList = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",
    maxHeight: "160px",
    overflowY: "auto",
    background: "var(--md-sys-color-surface-container)",
    borderRadius: "var(--borderRadius-md)",
    padding: "var(--gap-sm)",
  },
});

const ChannelRow = styled("label", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    cursor: "pointer",
    padding: "var(--gap-xs) var(--gap-sm)",
    borderRadius: "var(--borderRadius-sm)",
    userSelect: "none",
    "&:hover": {
      background: "var(--md-sys-color-surface-container-high)",
    },
  },
});

const ChannelName = styled("span", {
  base: {
    fontSize: "14px",
    color: "var(--md-sys-color-on-surface)",
  },
});

const EmptyHint = styled("span", {
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
    fontStyle: "italic",
    padding: "var(--gap-xs)",
  },
});

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  // The server whose channels we're listing as options
  server: Server;
  // The channel ID being configured (excluded from the list)
  excludeChannelId?: string;
  // Controlled value — array of selected audience channel IDs
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function StageBridgeLinks(props: Props) {
  // Get all voice channels on the server except the current one
  const voiceChannels = () =>
    [...props.server.channels.values()].filter(
      (ch): ch is Channel =>
        ch !== undefined &&
        ch.type === "VoiceChannel" &&
        ch.id !== props.excludeChannelId
    );

  function toggle(channelId: string) {
    const current = props.selected;
    if (current.includes(channelId)) {
      props.onChange(current.filter((id) => id !== channelId));
    } else {
      props.onChange([...current, channelId]);
    }
  }

  return (
    <Section>
      <Label>
        <Trans>Audience Channels</Trans>
      </Label>
      <ChannelList>
        <Show
          when={voiceChannels().length > 0}
          fallback={
            <EmptyHint>
              <Trans>No other voice channels to link</Trans>
            </EmptyHint>
          }
        >
          <For each={voiceChannels()}>
            {(channel) => (
              <ChannelRow>
                <input
                  type="checkbox"
                  checked={props.selected.includes(channel.id)}
                  onChange={() => toggle(channel.id)}
                />
                <ChannelName># {channel.name}</ChannelName>
              </ChannelRow>
            )}
          </For>
        </Show>
      </ChannelList>
    </Section>
  );
}

// ── Helper: save links to stage-bridge after channel creation ─────────────────

export async function saveStageBridgeLinks(
  stageChannelId: string,
  audienceChannelIds: string[]
): Promise<void> {
  if (audienceChannelIds.length === 0) return;

  const response = await fetch(`${BRIDGE_URL}/links/${stageChannelId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linked_audience: audienceChannelIds }),
  });

  if (!response.ok) {
    console.error(
      `[stage-bridge] Failed to save links for ${stageChannelId}:`,
      await response.text()
    );
  }
}
