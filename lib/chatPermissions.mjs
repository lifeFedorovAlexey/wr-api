export function normalizeChatActor(actor) {
  if (typeof actor === "number" || typeof actor === "string") {
    return { id: Number(actor || 0), roles: [] };
  }

  return {
    id: Number(actor?.id || 0),
    roles: Array.isArray(actor?.roles)
      ? Array.from(
          new Set(
            actor.roles
              .map((role) => String(role || "").trim().toLowerCase())
              .filter(Boolean),
          ),
        )
      : [],
  };
}

export function isGlobalChatAdmin(actor) {
  return normalizeChatActor(actor).roles.includes("admin");
}

export function requireGlobalChatAdmin(actor) {
  const normalized = normalizeChatActor(actor);
  if (!normalized.id || !normalized.roles.includes("admin")) {
    throw new Error("chat_admin_required");
  }
  return normalized;
}
