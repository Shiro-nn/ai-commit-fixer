import { getInput } from "npm:@actions/core";
import { exec } from "npm:@actions/exec";
import { context, getOctokit } from "npm:@actions/github";
import { PushEvent } from "npm:@octokit/webhooks-types";

// Получаем входные переменные
const GITHUB_TOKEN = getInput("GITHUB_TOKEN")!;
const OPENAI_API_KEY = getInput("OPENAI_API_KEY")!;
const OPENAI_BASE_URL = getInput("OPENAI_API_ENDPOINT")!;
const OPENAI_API_MODEL = getInput("OPENAI_API_MODEL")!;

// Инициализация клиентов
const octokit = getOctokit(GITHUB_TOKEN);

const owner = context.repo.owner;
const repo = context.repo.repo;

if (context.eventName != "push") {
  throw new Error("This action only works with push events");
}

const payload = context.payload as PushEvent;
const commits = payload.commits;

if (!commits.length) {
  throw new Error("No commits found");
}

if (payload.pusher.email) {
  await exec("git", ["config", "user.email", payload.pusher.email]);
}
await exec("git", ["config", "user.name", payload.pusher.name]);

await exec("git", ["status"]);
await exec("git", ["log", "--oneline"]);

const diffs = await Promise.all(
    commits.filter((cm) => !/^\w+(\(\w+\))?:\s+.+$/.test(cm.message)).map(({id, author}) => getCommitDiff(id, author)),
);

for (const { sha, diff, author } of diffs) {
  try {
    const env = {
      GIT_EDITOR: ':',
      GIT_SEQUENCE_EDITOR: ':',
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email ?? '',
    };
    const reply = await getAIResponse(diff);
    if (!reply) continue;
    await exec("git", ["checkout", sha], {env});
    await exec("git", ["commit", "--amend", "-m", reply], {env});
    await exec("git", ["rebase", "--onto", "HEAD", `${sha}^`, "main"], {env});
    await exec("git", ["push", "--force-with-lease"], {env});
  } catch (err) {
    console.error(err);
  }
}

async function getCommitDiff(
    commitSha: string,
    author: { name: string; email: string | null },
): Promise<{ sha: string; diff: string, author: { name: string; email: string | null } }> {
  const diffResponse = await octokit.request<string>(
      "GET /repos/{owner}/{repo}/commits/{ref}",
      {
        owner,
        repo,
        ref: commitSha,
        headers: {
          Accept: "application/vnd.github.v3.diff",
        },
      },
  );
  return { sha: commitSha, diff: diffResponse.data, author };
}

function stripThinkBlocks(input: string): string {
  // Для удаления <think>…</think>, если понадобится
  return input.replace(/<think>[\s\S]*?<\/think>/gs, "").trim();
}

function getSystemPrompt(): string {
  return `
Используй формат Conventional Commits для заголовка: type(scope): короткое описание.
Примеры: fix(api): исправлена опечатка, feat(auth): добавлена 2FA.

После заголовка ОБЯЗАТЕЛЬНО добавь ПУСТУЮ СТРОКУ.

Затем напиши подробное описание изменений в виде списка с МАРКЕРАМИ (дефис и пробел '- ').
Пример описания:
- Изменен алгоритм расчета X.
- Добавлены модульные тесты для Y.
- Обновлена документация по Z.

`;
}

async function getAIResponse(prompt: string) {
  try {
    const url = new URL(OPENAI_BASE_URL);
    url.pathname = "/v1/chat/completions";
    const resp = await fetch(url.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        stream: false,
        model: OPENAI_API_MODEL,
        temperature: 0.2,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        messages: [
          { role: "system", content: getSystemPrompt() },
          { role: "user", content: prompt },
        ],
      }),
    });
    const response = await resp.json();
    return stripThinkBlocks(
        response.choices[0].message?.content?.trim() || "",
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}
