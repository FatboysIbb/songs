const NAMES = ["Chef", "Hagen", "Nauber", "Mops", "Teeken", "Lage", "Pico", "Turtle", "Seppel"];
const drawButton = document.getElementById("draw-button");
const result = document.getElementById("result");
const history = document.getElementById("history");
const historyList = document.getElementById("history-list");

let previousName = "";
let recentNames = [];
let drawing = false;

function randomIndex(length) {
  const maximum = Math.floor(0x100000000 / length) * length;
  let value;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= maximum);
  return value % length;
}

function randomName(excludedName = "") {
  const choices = NAMES.filter(name => name !== excludedName);
  return choices[randomIndex(choices.length)];
}

function renderHistory() {
  historyList.replaceChildren();
  recentNames.slice(1, 4).forEach(name => {
    const item = document.createElement("li");
    item.textContent = name;
    historyList.appendChild(item);
  });
  history.hidden = recentNames.length < 2;
}

function draw() {
  if (drawing) return;
  drawing = true;
  drawButton.classList.remove("has-result");
  drawButton.classList.add("is-drawing");
  document.getElementById("draw-hint").textContent = "Die Trommel dreht sich …";

  let ticks = 0;
  const spinner = window.setInterval(() => {
    result.textContent = randomName();
    ticks += 1;
    if (ticks < 11) return;

    window.clearInterval(spinner);
    const selectedName = randomName(previousName);
    previousName = selectedName;
    recentNames = [selectedName, ...recentNames].slice(0, 4);
    result.textContent = selectedName;
    drawButton.classList.remove("is-drawing");
    void drawButton.offsetWidth;
    drawButton.classList.add("has-result");
    document.getElementById("draw-hint").textContent = "Nochmal tippen";
    renderHistory();
    navigator.vibrate?.(45);
    drawing = false;
  }, 68);
}

drawButton.addEventListener("click", draw);
