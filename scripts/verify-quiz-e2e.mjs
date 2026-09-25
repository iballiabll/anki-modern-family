/**
 * 单词测试榜单端到端校验。
 *
 * 用法（先起服务，再用另一个终端跑）：
 *   node scripts/dev-server.mjs                        # 或生产 server.mjs
 *   node scripts/verify-quiz-e2e.mjs http://127.0.0.1:4175
 *
 * 干的事：注册两个账号 → 各自交卷 → 读四张榜，确认「考过就能上榜、
 * 完成度会标出来、成绩跨账号可见」。这个脚本会写账号数据，只对
 * 本地或测试用的 DATA_DIR 跑，别对着生产库执行。
 */

const base = (process.argv[2] || "http://127.0.0.1:4175").replace(/\/$/, "");
const password = "E2e-Passw0rd-2026";
const stamp = Date.now().toString(36);

let failures = 0;

function check(label, condition, detail = "") {
  const mark = condition ? "PASS" : "FAIL";
  if (!condition) {
    failures += 1;
  }
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function cookieOf(response) {
  const list =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const cookie = list.map((item) => item.split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("注册没有返回登录 Cookie");
  }
  return cookie;
}

async function post(path, body, cookie = "") {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function get(path, cookie = "") {
  const response = await fetch(`${base}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function register(name) {
  const { response, data } = await post("/api/auth", {
    action: "register",
    username: name,
    password,
    email: `${name}@example.com`,
  });
  if (!response.ok || !data.ok) {
    throw new Error(`注册 ${name} 失败：${data.message || response.status}`);
  }
  return cookieOf(response);
}

/** 开一套题并交卷；做题策略是按位置循环选项，正确率约四分之一。 */
async function play(cookie, scope, size = 10) {
  const started = await post(
    "/api/quiz",
    { action: "start", scope, size, direction: "en-zh" },
    cookie,
  );
  if (!started.response.ok || !started.data.ok) {
    throw new Error(`开题失败（${scope}）：${started.data.message}`);
  }
  const answers = started.data.questions.map((_, index) => index % 4);
  const submitted = await post(
    "/api/quiz",
    { action: "submit", sessionId: started.data.sessionId, answers },
    cookie,
  );
  if (!submitted.response.ok || !submitted.data.ok) {
    throw new Error(`交卷失败（${scope}）：${submitted.data.message}`);
  }
  return submitted.data;
}

async function board(cookie, scope) {
  const { response, data } = await get(
    `/api/leaderboard?scope=${encodeURIComponent(scope)}`,
    cookie,
  );
  if (!response.ok || !data.ok) {
    throw new Error(`读取 ${scope} 榜失败：${data.message || response.status}`);
  }
  return data;
}

async function main() {
  console.log(`端到端校验目标：${base}`);

  const health = await get("/api/auth");
  check(
    "storageReady 为 true（服务器能写 DATA_DIR）",
    health.data?.registration?.storageReady === true,
    JSON.stringify(health.data?.registration || {}),
  );

  const alice = `alice${stamp}`;
  const bob = `bob${stamp}`;
  const cookieA = await register(alice);
  const cookieB = await register(bob);
  check("两个账号都能注册并拿到登录态", Boolean(cookieA && cookieB));

  const first = await play(cookieA, "cet4", 10);
  check(
    "交卷返回服务端判分和错词明细",
    Number.isFinite(first.score) && Array.isArray(first.wrong),
    `cet4 ${first.score}/${first.total}，错 ${first.wrong?.length} 题`,
  );

  const overview = await get("/api/quiz", cookieA);
  check(
    "个人成绩单记录了这一场",
    Number(overview.data?.bests?.cet4?.total) > 0,
  );
  check(
    "考过一个范围后总榜综合分就有值",
    Number.isFinite(overview.data?.totalScore),
    `totalScore=${overview.data?.totalScore}，已考 ${overview.data?.totalCompleted}/${overview.data?.totalRanges}`,
  );

  const totalOne = await board(cookieA, "total");
  const aliceRow = totalOne.top.find((row) => row.username === alice);
  check("只考过一个范围也出现在总榜", Boolean(aliceRow), `上榜 ${totalOne.players} 人`);
  check(
    "总榜标出了完成度，未考范围是 null",
    aliceRow?.completed === 1 && aliceRow?.parts?.kaoyan === null,
    JSON.stringify(aliceRow?.parts || {}),
  );

  await play(cookieB, "cet4", 10);
  await play(cookieB, "kaoyan", 10);
  const totalTwo = await board(cookieA, "total");
  const bobRow = totalTwo.top.find((row) => row.username === bob);
  check("第二个账号的成绩对第一个账号可见", Boolean(bobRow));
  check(
    "考过两个范围时完成度是 2/3",
    bobRow?.completed === 2 && bobRow?.totalRanges === 3,
    `completed=${bobRow?.completed}`,
  );

  const cet4Board = await board(cookieA, "cet4");
  check(
    "四级榜同时收录两个账号，且都排了名次",
    cet4Board.top.filter((row) => [alice, bob].includes(row.username)).length === 2 &&
      cet4Board.top.every((row) => Number.isInteger(row.rank)),
  );

  const kaoyanBoard = await board(cookieA, "kaoyan");
  check(
    "考研榜只收录考过考研范围的账号",
    kaoyanBoard.top.some((row) => row.username === bob) &&
      !kaoyanBoard.top.some((row) => row.username === alice),
  );

  const allBoard = await board(cookieA, "all");
  check("没人考过的范围会返回空榜而不是报错", allBoard.top.length === 0 && allBoard.ok);

  // /api/progress 的 GET 返回整份快照：{ ok, entries, tombstones }。
  const wrong = await get("/api/progress", cookieA);
  const wrongEntry = wrong.data?.entries?.["iball-quiz-wrong-v1"];
  const wrongEntries = Array.isArray(wrongEntry?.v) ? wrongEntry.v : [];
  check(
    "错词写进了账号自己的云端错词表",
    wrongEntries.length > 0,
    `错词 ${wrongEntries.length} 条`,
  );

  const anonymous = await get("/api/leaderboard?scope=total");
  check("未登录访问榜单被拒绝", anonymous.response.status === 401);

  console.log(
    failures === 0
      ? "\n全部通过：榜单链路（注册 → 交卷 → 上榜 → 跨账号可见）是通的。"
      : `\n有 ${failures} 项未通过，先修再部署。`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`校验中断：${error.message}`);
  process.exit(1);
});
