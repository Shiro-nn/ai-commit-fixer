import OpenAI from "npm:openai@4.97.0";
import core from "npm:@actions/core";
import { exec } from "npm:@actions/exec";
import github from "npm:@actions/github";
import { PushEvent } from "npm:@octokit/webhooks-types";
import process from "node:process";

// Получаем входные переменные
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN")!;
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY")!;
const OPENAI_BASE_URL = core.getInput("OPENAI_API_ENDPOINT")!;
const OPENAI_API_MODEL = core.getInput("OPENAI_API_MODEL")!;

// Инициализация клиентов
const octokit = github.getOctokit(GITHUB_TOKEN);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

const context = github.context;
const owner = context.repo.owner;
const repo = context.repo.repo;

if (github.context.eventName != "push") {
  throw new Error("This action only works with push events");
}

const payload = github.context.payload as PushEvent;
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
  commits.map((cm) => cm.id).map((hash) => getCommitDiff(hash)),
);

for (const { sha, diff } of diffs) {
  try {
    const reply = await getAIResponse(diff);
    if (!reply) continue;
    exec("git", [
      "rebase",
      `${sha}^`,
      "--exec",
      "'git",
      "commit",
      "--amend",
      "-m",
      `"${reply.replace(/"/g, '\\"')}"'`,
    ], {
      env: {
        GIT_SEQUENCE_EDITOR: 'sed -i -e "s/^pick/reword/g"',
        GIT_COMMITTER_NAME: process.env.GITHUB_ACTOR!,
        GIT_COMMITTER_EMAIL:
          `${process.env.GITHUB_ACTOR}@users.noreply.github.com`,
      },
    });
    exec("git", ["rebase", "--continue"]);
    exec("git", ["push", "--force-with-lease"]);
  } catch (err) {
    console.error(err);
  }
}

async function getCommitDiff(
  commitSha: string,
): Promise<{ sha: string; diff: string }> {
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
  return { sha: commitSha, diff: diffResponse.data };
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
    const response = await openai.chat.completions.create({
      model: OPENAI_API_MODEL,
      temperature: 0.2,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content: prompt },
      ],
    });
    return stripThinkBlocks(
      response.choices[0].message?.content?.trim() || "{}",
    );
  } catch (err) {
    console.error(err);
    return null;
  }
}
