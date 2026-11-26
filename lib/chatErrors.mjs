export class ChatDomainError extends Error {
  constructor(code, { status = 400, details = null } = {}) {
    super(String(code || "chat_error"));
    this.name = "ChatDomainError";
    this.code = String(code || "chat_error");
    this.status = Number(status) || 400;
    this.details = details && typeof details === "object" ? details : null;
  }
}

export function getChatErrorResponse(error, fallbackCode = "chat_error") {
  const code =
    error instanceof ChatDomainError
      ? error.code
      : error instanceof Error
        ? error.message
        : fallbackCode;

  const status =
    error instanceof ChatDomainError
      ? error.status
      : code === "chat_channel_forbidden" ||
          code === "chat_group_forbidden" ||
          code === "chat_admin_required" ||
          code === "chat_message_delete_forbidden"
        ? 403
        : 400;

  return {
    status,
    payload: {
      error: code || fallbackCode,
      ...(error instanceof ChatDomainError && error.details ? error.details : {}),
    },
  };
}
