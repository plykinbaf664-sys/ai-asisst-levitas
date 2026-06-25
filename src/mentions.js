function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function normalizeUsername(value) {
  const username = String(value ?? "").trim().replace(/^@/, "");
  return /^[a-z0-9_]{5,32}$/i.test(username) ? username : null;
}

function normalizeTelegramId(value) {
  const telegramId = Number(value);
  return Number.isSafeInteger(telegramId) && telegramId > 0
    ? telegramId
    : null;
}

export function parseTeamMembers(rawValue) {
  if (!rawValue?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((member) => member && typeof member === "object")
      .map((member) => ({
        name: String(member.name ?? "").trim(),
        username: normalizeUsername(member.username),
        telegramId: normalizeTelegramId(member.telegramId),
      }))
      .filter((member) => member.name);
  } catch {
    return [];
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function resolveResponsibleMention(responsibleName, teamMembers) {
  const name = String(responsibleName ?? "").trim();
  const member = teamMembers.find(
    (candidate) => normalizeName(candidate.name) === normalizeName(name),
  );

  if (!member) {
    return {
      mention: escapeHtml(name),
      username: null,
      telegramId: null,
    };
  }

  if (member.username) {
    return {
      mention: `@${member.username}`,
      username: member.username,
      telegramId: member.telegramId,
    };
  }

  if (member.telegramId) {
    return {
      mention: `<a href="tg://user?id=${member.telegramId}">${escapeHtml(name)}</a>`,
      username: null,
      telegramId: member.telegramId,
    };
  }

  return {
    mention: escapeHtml(name),
    username: null,
    telegramId: null,
  };
}
