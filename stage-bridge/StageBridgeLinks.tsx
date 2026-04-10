// StageBridgeLinks.tsx
// Multi-select picker for linking audience channels to a stage voice channel.
// Drop this file in: packages/client/components/modal/modals/StageBridgeLinks.tsx

import { createSignal, For, Show } from "solid-js";
import { styled } from "styled-system/jsx";
import { Trans } from "@lingui-solid/solid/macro";
import type { Channel, Server } from "revolt.js";

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
    fontWeight: "600",
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
  server: Server;
  excludeChannelId?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function StageBridgeLinks(props: Props) {
  const voiceChannels = () =>
    [...(props.server.channels ?? [])].filter(
      (ch): ch is Channel =>
        ch !== undefined &&
        (ch as any).channel_type === "VoiceChannel" &&
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

// ── Helper: save links to stage-bridge ───────────────────────────────────────

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
