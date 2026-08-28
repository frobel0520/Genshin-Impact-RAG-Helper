import { describeAnswer, describeError, describeHealth } from "./render.js";

const QUERY_ENDPOINT = "/api/v1/query";
const HEALTH_ENDPOINT = "/health";

const form = document.querySelector("#query-form");
const questionField = document.querySelector("#question");
const versionField = document.querySelector("#game-version");
const spoilerField = document.querySelector("#spoiler-level");
const submitButton = document.querySelector("#submit");
const statusBanner = document.querySelector("#service-status");
const output = document.querySelector("#answer");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionField.value.trim();
  if (question.length === 0) {
    return;
  }

  setBusy(true);
  renderPending();
  try {
    const response = await fetch(QUERY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest(question)),
    });
    const payload = await response.json().catch(() => undefined);
    render(response.ok ? describeAnswer(payload) : describeError(payload));
  } catch {
    render(describeError(undefined));
  } finally {
    setBusy(false);
  }
});

function buildRequest(question) {
  const gameVersion = versionField.value.trim();
  return {
    question,
    spoiler_level: spoilerField.value,
    // An empty field means "no version stated", never a guess at the latest one.
    ...(gameVersion.length === 0 ? {} : { game_version: gameVersion }),
  };
}

function render(view) {
  output.replaceChildren();
  output.dataset.status = view.status;

  output.append(element("p", "status-badge", view.status_label));
  if (view.spoiler_notice !== undefined) {
    output.append(element("p", "spoiler-notice", view.spoiler_notice));
  }
  output.append(element("p", "answer-text", view.text));

  if (view.reason_label !== undefined) {
    output.append(element("p", "reason", `原因：${view.reason_label}`));
  }
  if (view.kind === "answer") {
    output.append(element("p", "version-scope", view.version_label));
    output.append(renderCitations(view.citations));
    if (typeof view.trace_id === "string") {
      output.append(element("p", "trace", `追蹤碼：${view.trace_id}`));
    }
  } else {
    output.append(element("p", "error-code", `錯誤代碼：${view.code}`));
  }
}

function renderCitations(citations) {
  const section = document.createElement("section");
  section.className = "citations";
  section.append(element("h2", "citations-title", `引用來源（${citations.length}）`));

  if (citations.length === 0) {
    section.append(element("p", "citations-empty", "這個回答沒有附上來源。"));
    return section;
  }

  const list = document.createElement("ul");
  for (const citation of citations) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    // textContent, never innerHTML: source titles are data, not markup.
    link.textContent = citation.title;
    link.href = citation.url;
    link.rel = "noreferrer noopener";
    link.target = "_blank";
    item.append(link, element("span", "citation-kind", citation.kind_label));
    if (citation.meta.length > 0) {
      item.append(element("span", "citation-meta", citation.meta.join("・")));
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderPending() {
  output.replaceChildren(element("p", "pending", "查詢中…"));
  output.dataset.status = "pending";
}

function setBusy(busy) {
  submitButton.disabled = busy;
  submitButton.textContent = busy ? "查詢中…" : "查詢";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

async function loadHealth() {
  try {
    const response = await fetch(HEALTH_ENDPOINT);
    const view = describeHealth(await response.json());
    statusBanner.textContent = view.detail.length > 0 ? `${view.label}・${view.detail}` : view.label;
    statusBanner.dataset.ready = String(view.ready);
    // Without a dataset the query route is not even mounted, so say so before
    // the player types a question and gets a bare 404.
    questionField.disabled = !view.ready;
    submitButton.disabled = !view.ready;
  } catch {
    statusBanner.textContent = "無法取得服務狀態";
    statusBanner.dataset.ready = "false";
  }
}

loadHealth();
