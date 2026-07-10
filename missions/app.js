const HOST_KEY = "fatboys-missions-host-v1";
const CURRENT_PLAYER_KEY = "fatboys-missions-current-v1";
const PLAYER_KEY_PREFIX = "fatboys-missions-player-v1:";

const STATUS = {
  full: { label: "Ganzes Wochenende", className: "status-full" },
  early: { label: "Fährt früher", className: "status-early" },
  late: { label: "Kommt Samstag", className: "status-late" },
  absent: { label: "Diesmal nicht dabei", className: "status-absent" }
};

const DIFFICULTY = {
  easy: { label: "Leicht", points: 1 },
  medium: { label: "Knifflig", points: 2 },
  legendary: { label: "Legendär", points: 3 }
};

const views = Array.from(document.querySelectorAll(".view"));
const joinView = document.getElementById("join-view");
const landingView = document.getElementById("landing-view");
const setupView = document.getElementById("setup-view");
const hostView = document.getElementById("host-view");
const playerView = document.getElementById("player-view");
const revealView = document.getElementById("reveal-view");
const errorView = document.getElementById("error-view");
const participantList = document.getElementById("participant-list");
const participantTemplate = document.getElementById("participant-row-template");
const setupForm = document.getElementById("setup-form");
const hostPlayerList = document.getElementById("host-player-list");
const missionList = document.getElementById("mission-list");
const qrDialog = document.getElementById("qr-dialog");
const qrCode = document.getElementById("qr-code");
const toast = document.getElementById("toast");
const joinCodeForm = document.getElementById("join-code-form");
const joinPlayerPanel = document.getElementById("join-player-panel");
const joinPlayerList = document.getElementById("join-player-list");

let missionCatalog = [];
let missionById = new Map();
let hostGame = null;
let playerState = null;
let currentInviteUrl = "";
let joinCandidateGame = null;
let toastTimer;

function showView(view) {
  views.forEach(item => { item.hidden = item !== view; });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

function shuffle(items, random = secureRandom) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function readStorage(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn("Local state could not be read", error);
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    showToast("Lokaler Speicher ist nicht verfügbar.");
    console.warn("Local state could not be saved", error);
    return false;
  }
}

function playerStorageKey(gameId, playerId, gameVersion = 1) {
  return `${PLAYER_KEY_PREFIX}${gameId}:${playerId}:v${gameVersion}`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2500);
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodePayload(encoded) {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function gameBaseUrl() {
  const url = new URL("./", window.location.href);
  url.hash = "";
  url.search = "";
  return url.href;
}

function makeInvitePayload(game, player) {
  if (game.version >= 3 && !player.qrOnly) {
    return {
      version: 2,
      game: { id: game.id, name: game.name, createdAt: game.createdAt, version: game.version },
      player: { id: player.id, name: player.name, status: player.status }
    };
  }

  return {
    version: 1,
    game: { id: game.id, name: game.name, createdAt: game.createdAt, version: game.version },
    player: { id: player.id, name: player.name, status: player.status },
    missions: player.missions
  };
}

function inviteUrlFor(game, player) {
  return `${gameBaseUrl()}#join=${encodePayload(makeInvitePayload(game, player))}`;
}

function missionAllowedForPlayer(mission, player) {
  if (player.status === "early" && mission.availability === "saturday") return false;
  if (player.status === "late" && mission.availability === "friday") return false;
  return true;
}

function playersOverlap(first, second) {
  return !((first.status === "early" && second.status === "late") || (first.status === "late" && second.status === "early"));
}

function targetCandidates(mission, player, activePlayers, excludedTargets = new Set()) {
  if (!mission.target) return [null];

  return activePlayers.filter(candidate => {
    if (candidate.id === player.id || excludedTargets.has(candidate.id)) return false;
    if (!playersOverlap(player, candidate)) return false;
    if (mission.availability === "friday" && candidate.status === "late") return false;
    if (mission.availability === "saturday" && candidate.status === "early") return false;
    if (mission.targetStatus && candidate.status !== mission.targetStatus) return false;
    return true;
  });
}

function pickMissionOption(player, difficulty, activePlayers, usedMissionIds, excludedTargets, random = secureRandom) {
  const candidates = shuffle(missionCatalog.filter(mission => {
    if (mission.difficulty !== difficulty || usedMissionIds.has(mission.id)) return false;
    if (!missionAllowedForPlayer(mission, player)) return false;
    return targetCandidates(mission, player, activePlayers, excludedTargets).length > 0;
  }), random);

  for (const mission of candidates) {
    const possibleTargets = shuffle(targetCandidates(mission, player, activePlayers, excludedTargets), random);
    if (possibleTargets.length) return { mission, target: possibleTargets[0] };
  }

  throw new Error(`Keine passende ${difficulty}-Mission für ${player.name} gefunden.`);
}

function generateMissionQueue(player, activePlayers, random = secureRandom, limit = 18) {
  const usedMissionIds = new Set();
  const queue = [];
  let usedTargets = new Set();
  const difficulties = ["easy", "medium", "legendary"];

  for (let index = 0; index < limit; index += 1) {
    const difficulty = difficulties[index % difficulties.length];
    if (index % difficulties.length === 0) usedTargets = new Set();

    let option;
    try {
      option = pickMissionOption(player, difficulty, activePlayers, usedMissionIds, usedTargets, random);
    } catch {
      try {
        option = pickMissionOption(player, difficulty, activePlayers, usedMissionIds, new Set(), random);
      } catch {
        break;
      }
    }

    usedMissionIds.add(option.mission.id);
    if (option.target) usedTargets.add(option.target.id);
    queue.push({
      id: option.mission.id,
      targetId: option.target?.id || null,
      targetName: option.target?.name || null
    });
  }

  return queue;
}

function createHostGame(name, roster, identity = null) {
  const resolvedIdentity = identity || window.GameCodes.create(roster);
  const random = window.GameCodes.seededRandom(resolvedIdentity.packed);
  const players = roster.map((person, index) => ({ ...person, id: `agent-${index + 1}`, missions: [] }));
  const activePlayers = players.filter(player => player.status !== "absent");

  activePlayers.forEach(player => {
    player.missions = generateMissionQueue(player, activePlayers, random);
  });

  return {
    version: 3,
    id: resolvedIdentity.code,
    code: resolvedIdentity.code,
    packed: resolvedIdentity.packed,
    name,
    createdAt: new Date().toISOString(),
    players
  };
}

function gameFromCode(code) {
  const identity = window.GameCodes.decode(code);
  return createHostGame("Operation Wochenende", identity.roster, identity);
}

function addParticipantRow(name, index) {
  const row = participantTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector(".participant-number").textContent = String(index + 1).padStart(2, "0");
  row.querySelector(".participant-name").value = name;
  row.querySelector(".participant-status").value = "";
  participantList.appendChild(row);
}

function prepareRosterForm(existingRoster = []) {
  participantList.replaceChildren();
  ["Chef", "Hagen", "Nauber", "Mops", "Teeken", "Lage", "Pico", "Turtle", "Seppel"].forEach(addParticipantRow);
  const rows = Array.from(participantList.querySelectorAll(".participant-row"));
  rows.forEach(row => {
    const name = row.querySelector(".participant-name").value;
    const existing = existingRoster.find(person => person.name === name);
    if (existing) row.querySelector(".participant-status").value = existing.status;
  });
}

function collectRoster() {
  return Array.from(participantList.querySelectorAll(".participant-row"))
    .map(row => ({
      name: row.querySelector(".participant-name").value.trim(),
      status: row.querySelector(".participant-status").value
    }))
    .filter(person => person.name);
}

function statusPill(status) {
  const definition = STATUS[status];
  const pill = document.createElement("span");
  pill.className = `status-pill ${definition.className}`;
  pill.textContent = definition.label;
  return pill;
}

function renderHost() {
  if (!hostGame) return;
  document.getElementById("host-game-name").textContent = hostGame.name;
  const activeCount = hostGame.players.filter(player => player.status !== "absent").length;
  const lateCount = hostGame.players.filter(player => player.status === "late").length;
  document.getElementById("host-game-meta").textContent = `${activeCount} aktive Agenten · ${lateCount} davon ab Samstag`;
  const codeCard = document.getElementById("game-code-card");
  codeCard.hidden = !hostGame.code;
  document.getElementById("host-game-code").textContent = hostGame.code?.replaceAll("-", " ") || "";
  hostPlayerList.replaceChildren();

  hostGame.players.forEach((player, index) => {
    const card = document.createElement("article");
    card.className = `host-player-card${player.status === "absent" ? " is-absent" : ""}`;

    const number = document.createElement("span");
    number.className = "agent-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = player.name;
    const detail = document.createElement("p");
    detail.textContent = player.status === "late" ? "QR erst bei der Ankunft zeigen" : player.status === "early" ? "Beendet den Einsatz vor der Abfahrt" : player.status === "absent" ? "Kein QR und keine Missionen" : "Privater QR-Code bereit";
    info.append(title, detail, statusPill(player.status));

    card.append(number, info);

    if (player.status !== "absent") {
      const button = document.createElement("button");
      button.className = "qr-button";
      button.type = "button";
      button.dataset.playerId = player.id;
      button.textContent = "QR zeigen";
      card.appendChild(button);
    }

    hostPlayerList.appendChild(card);
  });

  showView(hostView);
}

function showQrForPlayer(playerId) {
  const player = hostGame?.players.find(item => item.id === playerId);
  if (!player || player.status === "absent") return;

  currentInviteUrl = inviteUrlFor(hostGame, player);
  document.getElementById("qr-player-name").textContent = player.name;
  document.getElementById("qr-player-hint").textContent = player.status === "late" ? "Diesen QR-Code bis Samstag geheim halten." : player.status === "early" ? "Missionen gelten bis zur vorzeitigen Abreise." : "Drei Missionen starten, Nachschub wartet.";
  qrCode.replaceChildren();

  if (typeof window.qrcode === "function") {
    const code = window.qrcode(0, "M");
    code.addData(currentInviteUrl);
    code.make();
    qrCode.innerHTML = code.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  } else {
    const fallback = document.createElement("p");
    fallback.textContent = "QR-Bibliothek nicht geladen. Bitte den Link kopieren.";
    fallback.style.color = "#271610";
    qrCode.appendChild(fallback);
  }

  qrDialog.showModal();
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    window.prompt("Link kopieren:", value);
  }
}

function importInvite(payload, encodedPayload) {
  if (![1, 2].includes(payload.version) || !payload.game?.id || !payload.player?.id) {
    throw new Error("Dieser Missionscode ist ungültig.");
  }

  if (payload.version === 2) {
    const reconstructedGame = gameFromCode(payload.game.id);
    const reconstructedPlayer = reconstructedGame.players.find(player => player.id === payload.player.id && player.status !== "absent");
    if (!reconstructedPlayer) throw new Error("Diese Person ist in der Game ID nicht aktiv.");
    payload = {
      ...payload,
      game: { ...payload.game },
      player: { ...reconstructedPlayer, missions: undefined },
      missions: reconstructedPlayer.missions
    };
  }

  if (!Array.isArray(payload.missions) || payload.missions.length < 3) {
    throw new Error("Für diese Person wurden nicht genug Missionen gefunden.");
  }

  payload.missions.forEach(assignment => {
    if (!missionById.has(assignment.id) || (assignment.alternateId && !missionById.has(assignment.alternateId))) {
      throw new Error("Mindestens eine Mission ist in dieser Version nicht verfügbar.");
    }
  });

  const storageKey = playerStorageKey(payload.game.id, payload.player.id, payload.game.version);
  const existing = readStorage(storageKey);

  const missionQueue = payload.missions.map(assignment => ({ ...assignment }));
  playerState = existing || {
    version: 1,
    game: payload.game,
    player: payload.player,
    encodedPayload,
    missions: missionQueue.splice(0, 3).map(assignment => ({
      ...assignment,
      completed: false,
      accepted: false,
      stealth: false
    })),
    queuedMissions: missionQueue,
    swapCount: 0,
    swapPenalty: 0,
    finished: false,
    leftEarly: false,
    startedAt: new Date().toISOString()
  };

  playerState.queuedMissions ||= [];
  playerState.swapCount ??= playerState.rerollUsed ? 1 : 0;
  playerState.swapPenalty ??= 0;
  playerState.impossibleSwaps ||= [];

  writeStorage(storageKey, playerState);
  writeStorage(CURRENT_PLAYER_KEY, { storageKey });
  history.replaceState(null, "", gameBaseUrl());
  renderPlayer();
}

function openPlayerFromGame(game, player) {
  const payload = makeInvitePayload(game, player);
  importInvite(payload, encodePayload(payload));
}

function availabilityLabel(status) {
  return STATUS[status]?.label || "Teilnehmer";
}

function renderJoinPlayers(game) {
  joinCandidateGame = game;
  joinPlayerList.replaceChildren();

  game.players.filter(player => player.status !== "absent").forEach(player => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "join-player-button";
    button.dataset.playerId = player.id;

    const name = document.createElement("strong");
    name.textContent = player.name;
    const detail = document.createElement("span");
    detail.textContent = availabilityLabel(player.status);
    button.append(name, detail);
    joinPlayerList.appendChild(button);
  });

  joinPlayerPanel.hidden = false;
  joinPlayerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function loadCurrentPlayer() {
  const pointer = readStorage(CURRENT_PLAYER_KEY);
  if (!pointer?.storageKey) return null;
  return readStorage(pointer.storageKey);
}

function savePlayerState() {
  if (!playerState) return;
  const storageKey = playerStorageKey(playerState.game.id, playerState.player.id, playerState.game.version);
  writeStorage(storageKey, playerState);
  writeStorage(CURRENT_PLAYER_KEY, { storageKey });
}

function formattedMission(assignment) {
  const mission = missionById.get(assignment.id);
  return mission.text.replaceAll("{target}", assignment.targetName || "deine Zielperson");
}

function formatPoints(value) {
  return Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function nextSwapCost() {
  return (playerState?.swapCount || 0) * 0.5;
}

function unlockNextMission() {
  const next = playerState.queuedMissions?.shift();
  if (!next) return false;
  playerState.missions.push({
    ...next,
    completed: false,
    accepted: false,
    stealth: false
  });
  return true;
}

function queuedReplacementIndex(assignment) {
  const difficulty = missionById.get(assignment.id)?.difficulty;
  if (!difficulty) return -1;
  return (playerState.queuedMissions || []).findIndex(candidate => missionById.get(candidate.id)?.difficulty === difficulty);
}

function canSwapMission(assignment) {
  return queuedReplacementIndex(assignment) >= 0 || Boolean(assignment.alternateId);
}

function renderPlayer() {
  if (!playerState) return;
  if (playerState.finished) {
    renderReveal();
    return;
  }

  document.getElementById("player-name").textContent = playerState.player.name;
  const displayCode = playerState.game.id.includes("-") ? playerState.game.id.replaceAll("-", " ") : playerState.game.id.toUpperCase();
  document.getElementById("player-schedule").textContent = `${playerState.game.name} · ${displayCode}`;
  const completed = playerState.missions.filter(mission => mission.completed).length;
  document.getElementById("completed-count").textContent = completed;
  const queueCount = playerState.queuedMissions?.length || 0;
  const swapCost = nextSwapCost();
  const impossibleCount = playerState.impossibleSwaps?.length || 0;
  const impossibleText = impossibleCount ? ` · ${impossibleCount} kostenlos als unmöglich gemeldet` : "";
  document.getElementById("mission-flow-note").textContent = queueCount
    ? `${queueCount} weitere Missionen warten · Nächster Tausch: ${swapCost ? `${formatPoints(swapCost)} Punkte` : "gratis"}${impossibleText}`
    : `Keine weiteren Missionen in der Warteschlange · Nächster Tausch: ${swapCost ? `${formatPoints(swapCost)} Punkte` : "gratis"}${impossibleText}`;
  missionList.replaceChildren();

  const banner = document.getElementById("schedule-banner");
  const leaveButton = document.getElementById("leave-early-button");
  banner.hidden = false;
  leaveButton.hidden = true;

  if (playerState.player.status === "early") {
    banner.innerHTML = "<strong>Kurzeinsatz:</strong> Deine Missionen sind nur für Freitag und die gemeinsame Zeit gültig. Schließe das Spiel vor deiner Abreise ab.";
    leaveButton.hidden = false;
  } else if (playerState.player.status === "late") {
    banner.innerHTML = "<strong>Samstagsverstärkung:</strong> Willkommen im laufenden Einsatz. Deine Missionen beziehen sich nur auf Personen, die noch da sind.";
  } else {
    banner.innerHTML = "<strong>Volleinsatz:</strong> Du hast das ganze Wochenende Zeit. Auffälliges Dauergrinsen kann deine Tarnung gefährden.";
  }

  const missionEntries = playerState.missions
    .map((assignment, index) => ({ assignment, index }))
    .sort((first, second) => Number(first.assignment.completed) - Number(second.assignment.completed));

  missionEntries.forEach(({ assignment, index }) => {
    const mission = missionById.get(assignment.id);
    const difficulty = DIFFICULTY[mission.difficulty];
    const card = document.createElement("details");
    card.className = `mission-card${assignment.completed ? " is-completed" : ""}`;

    const summary = document.createElement("summary");
    summary.className = "mission-summary";
    const number = document.createElement("span");
    number.className = "mission-index";
    number.textContent = index + 1;
    const info = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${difficulty.label} · ${difficulty.points} ${difficulty.points === 1 ? "Punkt" : "Punkte"}`;
    const hint = document.createElement("p");
    hint.textContent = "Tippen, wenn niemand mitliest";
    info.append(heading, hint);
    const state = document.createElement("span");
    state.className = "mission-state";
    state.textContent = assignment.completed ? "Erledigt ✓" : "Geheim";
    summary.append(number, info, state);

    const body = document.createElement("div");
    body.className = "mission-body";
    const text = document.createElement("p");
    text.className = "mission-text";
    text.textContent = formattedMission(assignment);
    const actions = document.createElement("div");
    actions.className = "mission-actions";

    const completeButton = document.createElement("button");
    completeButton.className = "complete-button";
    completeButton.type = "button";
    completeButton.dataset.action = "toggle-complete";
    completeButton.dataset.index = index;
    completeButton.textContent = assignment.completed ? "Doch nicht erledigt" : "Mission erledigt";
    actions.appendChild(completeButton);

    if (!assignment.completed && canSwapMission(assignment)) {
      const swapButton = document.createElement("button");
      swapButton.className = "swap-button";
      swapButton.type = "button";
      swapButton.dataset.action = "swap-mission";
      swapButton.dataset.index = index;
      const cost = nextSwapCost();
      swapButton.textContent = cost ? `Tauschen · ${formatPoints(cost)} Punkte` : "Tauschen · gratis";
      actions.appendChild(swapButton);

      const impossibleButton = document.createElement("button");
      impossibleButton.className = "impossible-swap-button";
      impossibleButton.type = "button";
      impossibleButton.dataset.action = "swap-impossible";
      impossibleButton.dataset.index = index;
      impossibleButton.textContent = "Unmöglich · kostenlos";
      actions.appendChild(impossibleButton);
    }

    body.append(text, actions);
    card.append(summary, body);
    missionList.appendChild(card);
  });

  showView(playerView);
}

function swapMission(index) {
  const assignment = playerState.missions[index];
  if (!assignment || assignment.completed) return;
  const queueIndex = queuedReplacementIndex(assignment);
  const replacement = queueIndex >= 0 ? playerState.queuedMissions.splice(queueIndex, 1)[0] : (assignment.alternateId ? {
    id: assignment.alternateId,
    targetId: assignment.alternateTargetId,
    targetName: assignment.alternateTargetName
  } : null);
  if (!replacement) return;

  const cost = nextSwapCost();
  const difficulty = DIFFICULTY[missionById.get(assignment.id)?.difficulty]?.label || "Gleiche Schwierigkeit";
  const costText = cost ? ` Dieser Tausch kostet ${formatPoints(cost)} Punkte.` : " Dieser Tausch ist gratis.";
  if (!window.confirm(`${difficulty}-Mission gegen eine neue Mission derselben Stufe tauschen?${costText}`)) {
    if (queueIndex >= 0) playerState.queuedMissions.splice(queueIndex, 0, replacement);
    return;
  }

  playerState.missions[index] = {
    ...replacement,
    completed: false,
    accepted: false,
    stealth: false
  };
  playerState.swapCount = (playerState.swapCount || 0) + 1;
  playerState.swapPenalty = (playerState.swapPenalty || 0) + cost;
  savePlayerState();
  renderPlayer();
  showToast(cost ? `Neue Mission, ${formatPoints(cost)} Punkte Abzug.` : "Neue Mission, erster Tausch gratis.");
}

function swapImpossibleMission(index) {
  const assignment = playerState.missions[index];
  if (!assignment || assignment.completed) return;
  const queueIndex = queuedReplacementIndex(assignment);
  if (queueIndex < 0 && !assignment.alternateId) return;

  const reason = window.prompt("Warum ist diese Mission wirklich unmöglich? Die Begründung wird bei der Auswertung gezeigt.", "")?.trim();
  if (!reason) {
    showToast("Bitte eine kurze Begründung angeben.");
    return;
  }

  const replacement = queueIndex >= 0 ? playerState.queuedMissions.splice(queueIndex, 1)[0] : {
    id: assignment.alternateId,
    targetId: assignment.alternateTargetId,
    targetName: assignment.alternateTargetName
  };

  playerState.impossibleSwaps ||= [];
  playerState.impossibleSwaps.push({
    id: assignment.id,
    targetId: assignment.targetId || null,
    targetName: assignment.targetName || null,
    reason,
    avoidedCost: nextSwapCost(),
    accepted: true,
    replacedAt: new Date().toISOString()
  });
  playerState.missions[index] = {
    ...replacement,
    completed: false,
    accepted: false,
    stealth: false
  };
  savePlayerState();
  renderPlayer();
  showToast("Kostenlos ersetzt und für die Auswertung notiert.");
}

function finishPlayer(leftEarly = false) {
  const message = leftEarly ? "Einsatz jetzt beenden und zur Auswertung wechseln?" : "Missionen jetzt für die gemeinsame Auswertung freigeben?";
  if (!window.confirm(message)) return;
  playerState.finished = true;
  playerState.leftEarly = leftEarly;
  playerState.finishedAt = new Date().toISOString();
  playerState.missions.forEach(mission => {
    mission.accepted = mission.completed;
    mission.stealth = false;
  });
  savePlayerState();
  renderReveal();
}

function calculateScore() {
  const earned = playerState.missions.reduce((total, assignment) => {
    if (!assignment.completed || !assignment.accepted) return total;
    const points = missionById.get(assignment.id)?.points || 0;
    return total + points + (assignment.stealth ? 1 : 0);
  }, 0);
  const rejectedImpossiblePenalty = (playerState.impossibleSwaps || []).reduce((total, report) => {
    return total + (report.accepted ? 0 : report.avoidedCost || 0);
  }, 0);
  return earned - (playerState.swapPenalty || 0) - rejectedImpossiblePenalty;
}

function renderImpossibleReview() {
  const reports = playerState.impossibleSwaps || [];
  const section = document.getElementById("impossible-review");
  const list = document.getElementById("impossible-review-list");
  section.hidden = reports.length === 0;
  list.replaceChildren();

  reports.forEach((report, index) => {
    const mission = missionById.get(report.id);
    const card = document.createElement("article");
    card.className = "impossible-review-card";
    const info = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = `${DIFFICULTY[mission.difficulty].label}-Mission`;
    const text = document.createElement("p");
    text.textContent = formattedMission(report);
    const reason = document.createElement("blockquote");
    reason.textContent = `Begründung: ${report.reason}`;
    info.append(title, text, reason);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = "toggle-impossible-accepted";
    button.dataset.index = index;
    button.className = report.accepted ? "is-on" : "";
    button.textContent = report.accepted
      ? "Als unmöglich akzeptiert ✓"
      : `Nicht anerkannt · −${formatPoints(report.avoidedCost || 0)} Punkte`;
    card.append(info, button);
    list.appendChild(card);
  });
}

function renderReveal() {
  document.getElementById("reveal-player-name").textContent = playerState.player.name;
  const list = document.getElementById("reveal-list");
  list.replaceChildren();

  playerState.missions.forEach((assignment, index) => {
    const mission = missionById.get(assignment.id);
    const card = document.createElement("article");
    card.className = `reveal-card${assignment.completed ? "" : " is-missed"}`;
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = `${DIFFICULTY[mission.difficulty].label} · ${mission.points} ${mission.points === 1 ? "Punkt" : "Punkte"}`;
    const text = document.createElement("p");
    text.textContent = formattedMission(assignment);
    info.append(title, text);
    card.appendChild(info);

    const controls = document.createElement("div");
    controls.className = "adjudication";
    if (assignment.completed) {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.dataset.action = "toggle-accepted";
      accept.dataset.index = index;
      accept.className = assignment.accepted ? "is-on" : "";
      accept.textContent = assignment.accepted ? "Zählt ✓" : "Abgelehnt";
      const stealth = document.createElement("button");
      stealth.type = "button";
      stealth.dataset.action = "toggle-stealth";
      stealth.dataset.index = index;
      stealth.className = assignment.stealth ? "is-on" : "";
      stealth.textContent = assignment.stealth ? "Tarnbonus +1" : "Unbemerkt?";
      controls.append(accept, stealth);
    } else {
      const missed = document.createElement("span");
      missed.className = "mission-state";
      missed.textContent = "Nicht geschafft";
      controls.appendChild(missed);
    }
    card.appendChild(controls);
    list.appendChild(card);
  });

  renderImpossibleReview();

  const rejectedImpossiblePenalty = (playerState.impossibleSwaps || []).reduce((total, report) => total + (report.accepted ? 0 : report.avoidedCost || 0), 0);
  const reportedCount = playerState.impossibleSwaps?.length || 0;
  const paidSwapText = playerState.swapPenalty ? `−${formatPoints(playerState.swapPenalty)} Punkte` : "0 Punkte";
  document.getElementById("swap-penalty-summary").textContent = `Tauschkosten: ${paidSwapText} · Unmöglich gemeldet: ${reportedCount}${rejectedImpossiblePenalty ? ` · Nachträglich abgezogen: −${formatPoints(rejectedImpossiblePenalty)} Punkte` : ""}`;
  document.getElementById("final-score").textContent = formatPoints(calculateScore());
  showView(revealView);
}

function updateLandingActions() {
  hostGame = readStorage(HOST_KEY);
  const savedPlayer = loadCurrentPlayer();
  document.getElementById("resume-host-button").hidden = !hostGame;
  document.getElementById("resume-player-button").hidden = !savedPlayer;
}

function updateJoinActions() {
  const savedPlayer = loadCurrentPlayer();
  document.getElementById("resume-joined-player-button").hidden = !savedPlayer;
}

function isHostMode() {
  return new URLSearchParams(window.location.search).has("host");
}

function goHome() {
  if (isHostMode()) {
    updateLandingActions();
    showView(landingView);
  } else {
    updateJoinActions();
    showView(joinView);
  }
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showView(errorView);
}

function addLatePlayer(name) {
  const normalized = name.trim();
  if (!normalized) return;
  if (hostGame.players.some(player => player.name.toLowerCase() === normalized.toLowerCase() && player.status !== "absent")) {
    showToast("Dieser Name ist bereits aktiv.");
    return;
  }

  const absentMatch = hostGame.players.find(player => player.name.toLowerCase() === normalized.toLowerCase() && player.status === "absent");
  const player = absentMatch || { id: randomId(), name: normalized, missions: [] };
  player.status = "late";
  player.name = normalized;
  player.qrOnly = true;

  if (!absentMatch) hostGame.players.push(player);
  const activePlayers = hostGame.players.filter(item => item.status !== "absent");
  player.missions = generateMissionQueue(player, activePlayers, secureRandom, 6);
  writeStorage(HOST_KEY, hostGame);
  renderHost();
  showQrForPlayer(player.id);
}

function processJoinHash() {
  const joinMatch = window.location.hash.match(/^#join=(.+)$/);
  if (!joinMatch) return false;

  try {
    const payload = decodePayload(joinMatch[1]);
    importInvite(payload, joinMatch[1]);
  } catch (error) {
    history.replaceState(null, "", gameBaseUrl());
    showError(error.message || "Dieser QR-Code konnte nicht gelesen werden.");
  }
  return true;
}

async function initialize() {
  try {
    const response = await fetch("missions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Missionen konnten nicht geladen werden (${response.status}).`);
    missionCatalog = await response.json();
    missionById = new Map(missionCatalog.map(mission => [mission.id, mission]));
  } catch (error) {
    showError(error.message || "Missionen konnten nicht geladen werden.");
    return;
  }

  if (processJoinHash()) return;

  goHome();
}

document.getElementById("new-game-button").addEventListener("click", () => {
  prepareRosterForm();
  showView(setupView);
});

document.getElementById("resume-host-button").addEventListener("click", () => {
  hostGame = readStorage(HOST_KEY);
  if (!hostGame) return;
  if ((hostGame.version || 1) < 3) {
    if (!window.confirm("Dieses Spiel verwendet noch die alten Missionsregeln. Für Nachschub und die neuen Tauschkosten muss es einmal neu erstellt werden. Verfügbarkeit übernehmen und neu erstellen?")) return;
    const oldGame = hostGame;
    localStorage.removeItem(HOST_KEY);
    hostGame = null;
    prepareRosterForm(oldGame.players);
    document.getElementById("game-name").value = oldGame.name || "Operation Grillzange";
    showView(setupView);
    return;
  }
  renderHost();
});

document.getElementById("resume-player-button").addEventListener("click", () => {
  playerState = loadCurrentPlayer();
  if (playerState) renderPlayer();
});

document.getElementById("home-button").addEventListener("click", goHome);
document.querySelectorAll('[data-action="go-home"], [data-action="cancel-setup"]').forEach(button => button.addEventListener("click", goHome));

setupForm.addEventListener("submit", event => {
  event.preventDefault();
  const roster = collectRoster();
  const missingAttendance = roster.some(person => !person.status);
  const activePlayers = roster.filter(person => person.status !== "absent");
  const normalizedNames = roster.map(person => person.name.toLowerCase());

  if (missingAttendance) {
    showToast("Bitte für jede Person die Verfügbarkeit auswählen.");
    return;
  }
  if (activePlayers.length < 3) {
    showToast("Mindestens drei aktive Personen eintragen.");
    return;
  }
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    showToast("Jeder Name darf nur einmal vorkommen.");
    return;
  }

  try {
    const gameName = document.getElementById("game-name").value.trim() || "Operation Wochenende";
    const identity = window.GameCodes.create(roster);
    hostGame = createHostGame(gameName, roster, identity);
    writeStorage(HOST_KEY, hostGame);
    renderHost();
  } catch (error) {
    showError(error.message);
  }
});

joinCodeForm.addEventListener("submit", event => {
  event.preventDefault();
  const input = document.getElementById("join-code");
  try {
    const game = gameFromCode(input.value);
    input.value = game.code.replaceAll("-", " ");
    renderJoinPlayers(game);
  } catch (error) {
    joinCandidateGame = null;
    joinPlayerPanel.hidden = true;
    showToast(error.message || "Diese Game ID ist ungültig.");
  }
});

joinPlayerList.addEventListener("click", event => {
  const button = event.target.closest("[data-player-id]");
  const player = joinCandidateGame?.players.find(item => item.id === button?.dataset.playerId);
  if (player) openPlayerFromGame(joinCandidateGame, player);
});

document.getElementById("resume-joined-player-button").addEventListener("click", () => {
  playerState = loadCurrentPlayer();
  if (playerState) renderPlayer();
});

hostPlayerList.addEventListener("click", event => {
  const button = event.target.closest("[data-player-id]");
  if (button) showQrForPlayer(button.dataset.playerId);
});

document.getElementById("late-join-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.getElementById("late-join-name");
  addLatePlayer(input.value);
  input.value = "";
});

document.getElementById("reset-game-button").addEventListener("click", () => {
  if (!window.confirm("Host-Spiel und alle QR-Zuordnungen löschen? Bereits gescannte Missionen bleiben bestehen.")) return;
  localStorage.removeItem(HOST_KEY);
  hostGame = null;
  goHome();
});

qrDialog.querySelector(".dialog-close").addEventListener("click", () => qrDialog.close());
qrDialog.addEventListener("click", event => {
  if (event.target === qrDialog) qrDialog.close();
});
document.getElementById("copy-invite-button").addEventListener("click", () => copyText(currentInviteUrl, "Einladungslink kopiert."));
document.getElementById("copy-game-code-button").addEventListener("click", () => {
  if (hostGame?.code) copyText(hostGame.code.replaceAll("-", " "), "Game ID kopiert.");
});

missionList.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "toggle-complete") {
    const assignment = playerState.missions[index];
    const wasCompleted = assignment.completed;
    assignment.completed = !assignment.completed;
    const unlocked = !wasCompleted && assignment.completed && unlockNextMission();
    savePlayerState();
    renderPlayer();
    if (unlocked) showToast("Mission erledigt, neue Mission freigeschaltet.");
  } else if (button.dataset.action === "swap-mission") {
    swapMission(index);
  } else if (button.dataset.action === "swap-impossible") {
    swapImpossibleMission(index);
  }
});

document.getElementById("copy-backup-button").addEventListener("click", () => {
  if (!playerState?.encodedPayload) return;
  copyText(`${gameBaseUrl()}#join=${playerState.encodedPayload}`, "Backup-Link kopiert.");
});

document.getElementById("finish-button").addEventListener("click", () => finishPlayer(false));
document.getElementById("leave-early-button").addEventListener("click", () => finishPlayer(true));

document.getElementById("reveal-list").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const assignment = playerState.missions[Number(button.dataset.index)];
  if (button.dataset.action === "toggle-accepted") {
    assignment.accepted = !assignment.accepted;
    if (!assignment.accepted) assignment.stealth = false;
  } else if (button.dataset.action === "toggle-stealth" && assignment.accepted) {
    assignment.stealth = !assignment.stealth;
  }
  savePlayerState();
  renderReveal();
});

document.getElementById("impossible-review-list").addEventListener("click", event => {
  const button = event.target.closest('button[data-action="toggle-impossible-accepted"]');
  if (!button) return;
  const report = playerState.impossibleSwaps[Number(button.dataset.index)];
  report.accepted = !report.accepted;
  savePlayerState();
  renderReveal();
});

document.getElementById("reopen-missions-button").addEventListener("click", () => {
  playerState.finished = false;
  playerState.leftEarly = false;
  savePlayerState();
  renderPlayer();
});

window.addEventListener("hashchange", processJoinHash);

initialize();
