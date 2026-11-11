import type { Bot } from "@swarm-studio/contracts";
import {
  ACTIVE_RUN_STATUSES,
  avatarIdentitySeed,
  botEyeTone,
  resolvePersonaColorDef,
} from "@swarm-studio/core";
import { BotAvatar } from "@swarm-studio/ui-web";

const bodies = [
  "M16 2a14 14 0 1 0 0 28 14 14 0 1 0 0-28Z",
  "M7 3h18a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z",
  "M14 4a2.3 2.3 0 0 1 4 0l12 22a2 2 0 0 1-1.8 3H3.8A2 2 0 0 1 2 26Z",
];

export function ChatMascot({ bot }: { bot: Bot }) {
  if (bot.avatarSet === "swarmstudio" || /^(data:image\/)|::shape_/.test(bot.color)) {
    return (
      <BotAvatar
        avatarSet={bot.avatarSet}
        color={bot.color}
        identity={bot.id}
        size={26}
        status={bot.status}
      />
    );
  }
  const seed = avatarIdentitySeed(bot.id);
  const shape = seed % bodies.length;
  const color = resolvePersonaColorDef(bot.id, bot.color).hex;
  const tone = botEyeTone(color);
  const ink =
    tone === "dark"
      ? "fill-foreground dark:fill-background"
      : tone === "light"
        ? "fill-background dark:fill-foreground"
        : "fill-background";
  const working = ACTIVE_RUN_STATUSES.some((status) => status === bot.status);
  return (
    <svg
      viewBox="0 0 32 32"
      style={{ width: 26, height: 26 }}
      className="swarmstudio-organic-avatar shrink-0 overflow-visible"
      data-working={working}
      data-eye-pattern={seed % 4}
      aria-hidden="true"
    >
      <path d={bodies[shape]} fill={color} />
      {(["idle", "working"] as const).map((mode) => (
        <g
          key={mode}
          className={`swarmstudio-organic-avatar-eyes swarmstudio-organic-avatar-eyes-${mode} ${ink}`}
        >
          <rect x="11" y={shape === 2 ? 15 : 11} width="3.3" height="8" rx="1.65" />
          <rect x="17.7" y={shape === 2 ? 15 : 11} width="3.3" height="8" rx="1.65" />
        </g>
      ))}
    </svg>
  );
}
