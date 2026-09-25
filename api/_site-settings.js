/**
 * 站点设置：目前只存邀请码，落盘在 DATA_DIR/settings.json。
 *
 * 环境变量 REGISTRATION_CODE 仍然可用（作为没有设置文件时的默认值），
 * 但站长可以在管理面板里直接改邀请码，不需要登服务器改配置文件再重启。
 */

const fsp = require("fs/promises");
const path = require("path");
const { StoreError, dataDir } = require("./_user-store.js");

const SETTINGS_FILE = "settings.json";
const MAX_INVITE_LENGTH = 64;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

function settingsPath() {
  return path.join(dataDir(), SETTINGS_FILE);
}

async function readSettings() {
  try {
    const raw = await fsp.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      inviteCode: String(parsed?.inviteCode || ""),
      updatedAt: parsed?.updatedAt || "",
    };
  } catch {
    return { inviteCode: "", updatedAt: "" };
  }
}

async function writeSettings(next) {
  const dir = dataDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(
    {
      inviteCode: String(next.inviteCode || ""),
      updatedAt: next.updatedAt || new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
  const tempPath = `${settingsPath()}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, payload, { mode: 0o600 });
  await fsp.rename(tempPath, settingsPath());
  return readSettings();
}

function normalizeInviteCode(value) {
  const code = String(value || "").trim();
  if (!code) {
    return "";
  }
  if (code.length > MAX_INVITE_LENGTH || !INVITE_PATTERN.test(code)) {
    throw new StoreError(
      `邀请码需 4-${MAX_INVITE_LENGTH} 位，只能包含字母、数字、下划线或短横线`,
    );
  }
  return code;
}

/** 生效的邀请码：设置文件优先，其次环境变量；空字符串表示不要求邀请码。 */
async function effectiveInviteCode() {
  const settings = await readSettings().catch(() => ({ inviteCode: "" }));
  if (settings.inviteCode) {
    return settings.inviteCode;
  }
  return String(process.env.REGISTRATION_CODE || "").trim();
}

async function inviteCodeStatus() {
  const settings = await readSettings().catch(() => ({ inviteCode: "" }));
  const fromEnv = String(process.env.REGISTRATION_CODE || "").trim();
  const effective = settings.inviteCode || fromEnv;
  return {
    inviteCode: settings.inviteCode,
    // 只在管理端使用：站长得知道当前生效的码才能转达给学生。
    effectiveCode: effective,
    envFallback: fromEnv ? true : false,
    required: Boolean(effective),
    updatedAt: settings.updatedAt,
  };
}

async function setInviteCode(value) {
  const code = normalizeInviteCode(value);
  return writeSettings({ inviteCode: code, updatedAt: new Date().toISOString() });
}

/** 生成一个便于口头转达的随机邀请码，例如 NODE-7F3K9Q。 */
function generateInviteCode(prefix = "CABIN") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = require("crypto").randomBytes(6);
  let body = "";
  for (const byte of bytes) {
    body += alphabet[byte % alphabet.length];
  }
  const clean = String(prefix || "CABIN")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return `${clean || "CABIN"}-${body}`;
}

module.exports = {
  SETTINGS_FILE,
  effectiveInviteCode,
  generateInviteCode,
  inviteCodeStatus,
  normalizeInviteCode,
  readSettings,
  setInviteCode,
  settingsPath,
};
