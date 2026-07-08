Array.prototype.last = function () {
  return this[this.length - 1];
};

Math.sinus = function (degree) {
  return Math.sin((degree / 180) * Math.PI);
};

// ---------- Game data ----------
let phase = "menu"; // menu, typing, validating, turning, walking, transitioning, falling, paused
let lastTimestamp;
let heroX;
let heroY;
let sceneOffset;

let platforms = [];
let sticks = [];
let trees = [];

let score = 0;
let lives = 3;

let gameStarted = false;
let isGameOver = false;
let previousPhase = "typing";

// Word-typing state
let wordBuffer = [];
let hadBackspace = false;
let wordStartTime = null;
let pendingPerfect = false;
let feedbackText = "";
let feedbackTimeout = null;
let cursorVisible = true;
let cursorInterval = null;

// ---------- Configuration ----------
const canvasWidth = 375;
const canvasHeight = 375;
const platformHeight = 100;
const heroDistanceFromEdge = 10;
const paddingX = 100;
const maxLives = 3;

const lengthPerLetter = 20; // ~"2cm" at game scale
const TIME_LIMIT_MS = 6000; // must submit within this to be eligible for perfect

const backgroundSpeedMultiplier = 0.2;

const hill1BaseHeight = 100;
const hill1Amplitude = 10;
const hill1Stretch = 1;
const hill2BaseHeight = 70;
const hill2Amplitude = 20;
const hill2Stretch = 0.5;

const turningSpeed = 4;
const walkingSpeed = 4;
const transitioningSpeed = 2;
const fallingSpeed = 2;

const heroWidth = 17;
const heroHeight = 30;

const canvas = document.getElementById("game");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const ctx = canvas.getContext("2d");

const perfectElement = document.getElementById("perfect");
const restartButton = document.getElementById("restart");
const scoreElement = document.getElementById("score");
const livesElement = document.getElementById("lives");

const startScreen = document.getElementById("startScreen");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const pauseMenu = document.getElementById("pauseMenu");
const resumeBtn = document.getElementById("resumeBtn");
const menuBtn = document.getElementById("menuBtn");
const soundToggleBtn = document.getElementById("soundToggle");

// ============================================================
// AUDIO (Web Audio API, no external files)
// ============================================================
let audioCtx;
let soundEnabled = true;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, duration, type = "sine", volume = 0.2, startTime = 0) {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime + startTime;
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.stop(now + duration);
}

function playKeySound() {
  playTone(500 + Math.random() * 100, 0.05, "square", 0.06);
}

function playBackspaceSound() {
  playTone(180, 0.08, "square", 0.08);
}

function playErrorSound() {
  playTone(150, 0.2, "sawtooth", 0.12);
}

function playPerfectSound() {
  playTone(880, 0.15, "sine", 0.2);
  playTone(1318.5, 0.2, "sine", 0.2, 0.1);
}

function playLandSound() {
  playTone(300, 0.1, "triangle", 0.15);
}

function playFallSound() {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sawtooth";
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.8);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc.start(now);
  osc.stop(now + 0.8);
}

function playGameOverSound() {
  playTone(300, 0.15, "square", 0.15);
  playTone(220, 0.15, "square", 0.15, 0.15);
  playTone(150, 0.25, "square", 0.15, 0.3);
}

soundToggleBtn.addEventListener("click", function () {
  soundEnabled = !soundEnabled;
  soundToggleBtn.innerText = soundEnabled ? "🔊" : "🔇";
});

// ============================================================
// WORD VALIDATION
// Swap this function's internals if you'd rather use your own
// AI/dictionary API instead of the free dictionaryapi.dev service.
// Note: dictionaryapi.dev doesn't validate 2-word compound phrases,
// so a phrase like "HOT DOG" will fail lookup as a single string.
// If you want compound phrases to validate, consider checking each
// word on either side of the space separately.
// ============================================================
async function validateWord(word) {
  if (!word || word.replace(/\s/g, "").length < 2) return false;
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    );
    return res.ok;
  } catch (err) {
    console.warn("Word validation failed, allowing word by default:", err);
    return true; // don't punish the player for a network hiccup
  }
}

// Counts only letters, ignoring the single allowed space
function countLetters(buffer) {
  return buffer.filter((ch) => ch !== " ").length;
}

// ============================================================
// GAME SETUP
// ============================================================
function updateLivesUI() {
  const safeLives = Math.max(0, Math.min(lives, maxLives));
  livesElement.innerHTML = "❤️".repeat(safeLives) + "🤍".repeat(maxLives - safeLives);
  livesElement.setAttribute("aria-label", `${safeLives} ${safeLives === 1 ? "life" : "lives"} left`);
}

function resetGame() {
  phase = "typing";
  lastTimestamp = undefined;
  sceneOffset = 0;
  score = 0;
  lives = maxLives;
  isGameOver = false;

  wordBuffer = [];
  hadBackspace = false;
  wordStartTime = null;
  pendingPerfect = false;
  feedbackText = "";
  clearTimeout(feedbackTimeout);

  perfectElement.style.opacity = 0;
  restartButton.style.display = "none";
  scoreElement.innerText = score;
  updateLivesUI();

  platforms = [{ x: 50, w: 50 }];
  generatePlatform();
  generatePlatform();
  generatePlatform();
  generatePlatform();

  sticks = [{ x: platforms[0].x + platforms[0].w, length: 0, rotation: 0 }];

  trees = [];
  for (let i = 0; i < 10; i++) generateTree();

  heroX = platforms[0].x + platforms[0].w - heroDistanceFromEdge;
  heroY = 0;

  startCursorBlink();
  draw();
}

function generateTree() {
  const minimumGap = 30;
  const maximumGap = 150;
  const lastTree = trees[trees.length - 1];
  let furthestX = lastTree ? lastTree.x : 0;
  const x = furthestX + minimumGap + Math.floor(Math.random() * (maximumGap - minimumGap));
  const treeColors = ["#6D8821", "#8FAC34", "#98B333"];
  const color = treeColors[Math.floor(Math.random() * 3)];
  trees.push({ x, color });
}

function generatePlatform() {
  const minimumGap = 40;
  const maximumGap = 200;
  const minimumWidth = 20;
  const maximumWidth = 100;
  const lastPlatform = platforms[platforms.length - 1];
  let furthestX = lastPlatform.x + lastPlatform.w;
  const x = furthestX + minimumGap + Math.floor(Math.random() * (maximumGap - minimumGap));
  const w = minimumWidth + Math.floor(Math.random() * (maximumWidth - minimumWidth));
  platforms.push({ x, w });
}

// Idle scene behind the start screen
platforms = [{ x: 50, w: 50 }];
generatePlatform();
generatePlatform();
generatePlatform();
generatePlatform();
sticks = [{ x: platforms[0].x + platforms[0].w, length: 0, rotation: 0 }];
trees = [];
for (let i = 0; i < 10; i++) generateTree();
heroX = platforms[0].x + platforms[0].w - heroDistanceFromEdge;
heroY = 0;
draw();

// ============================================================
// START / PAUSE / MENU
// ============================================================
startBtn.addEventListener("click", function () {
  startScreen.style.display = "none";
  pauseBtn.style.display = "flex";
  gameStarted = true;
  initAudio();
  resetGame();
});

pauseBtn.addEventListener("click", function () {
  if (!gameStarted || isGameOver || phase === "paused" || phase === "menu") return;
  previousPhase = phase;
  phase = "paused";
  stopCursorBlink();
  pauseMenu.style.display = "flex";
  pauseBtn.style.display = "none";
});

resumeBtn.addEventListener("click", function () {
  phase = previousPhase;
  pauseMenu.style.display = "none";
  pauseBtn.style.display = "flex";
  if (phase === "typing") startCursorBlink();
  lastTimestamp = undefined;
  if (["turning", "walking", "transitioning", "falling"].includes(phase)) {
    window.requestAnimationFrame(animate);
  }
  draw();
});

menuBtn.addEventListener("click", function () {
  gameStarted = false;
  phase = "menu";
  stopCursorBlink();
  pauseMenu.style.display = "none";
  pauseBtn.style.display = "none";
  restartButton.style.display = "none";
  startScreen.style.display = "flex";
});

restartButton.addEventListener("click", function (event) {
  event.preventDefault();
  resetGame();
  restartButton.style.display = "none";
  pauseBtn.style.display = "flex";
});

// ============================================================
// CURSOR BLINK (for the typing bubble)
// ============================================================
function startCursorBlink() {
  stopCursorBlink();
  cursorInterval = setInterval(() => {
    cursorVisible = !cursorVisible;
    if (phase === "typing") draw();
  }, 500);
}

function stopCursorBlink() {
  if (cursorInterval) clearInterval(cursorInterval);
  cursorInterval = null;
}

// ============================================================
// KEYBOARD INPUT
// ============================================================
window.addEventListener("keydown", function (event) {
  if (!gameStarted || isGameOver) return;
  if (phase !== "typing") return;

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    initAudio();
    if (wordBuffer.length === 0) wordStartTime = Date.now();
    wordBuffer.push(event.key.toUpperCase());
    sticks.last().length = countLetters(wordBuffer) * lengthPerLetter;
    playKeySound();
    feedbackText = "";
    draw();
  } else if (event.key === " ") {
    event.preventDefault();
    if (wordBuffer.length === 0) return; // can't start with a space
    if (wordBuffer.includes(" ")) return; // only 1 space allowed
    if (wordBuffer.last() === " ") return; // no double spaces
    initAudio();
    wordBuffer.push(" ");
    // space doesn't add to stick length
    playKeySound();
    feedbackText = "";
    draw();
  } else if (event.key === "Backspace") {
    event.preventDefault();
    if (wordBuffer.length > 0) {
      wordBuffer.pop();
      hadBackspace = true;
      sticks.last().length = countLetters(wordBuffer) * lengthPerLetter;
      playBackspaceSound();
      feedbackText = "";
      draw();
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    submitWord();
  }
});

async function submitWord() {
  if (wordBuffer.length === 0 || phase !== "typing") return;
  if (wordBuffer.last() === " ") return; // don't allow submitting right after a trailing space

  const word = wordBuffer.join("").toLowerCase();
  phase = "validating";
  feedbackText = "Checking...";
  stopCursorBlink();
  draw();

  const valid = await validateWord(word);

  if (phase !== "validating") return; // player paused/left mid-check

  if (valid) {
    const elapsed = Date.now() - wordStartTime;
    pendingPerfect = !hadBackspace && elapsed <= TIME_LIMIT_MS;
    feedbackText = "";
    phase = "turning";
    lastTimestamp = undefined;
    window.requestAnimationFrame(animate);
  } else {
    phase = "typing";
    feedbackText = "Not a real word — try again";
    playErrorSound();
    startCursorBlink();
    draw();
  }
}

window.addEventListener("resize", function () {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
});

// ============================================================
// MAIN LOOP (drives turning -> walking -> transitioning -> falling)
// ============================================================
function animate(timestamp) {
  if (!lastTimestamp) {
    lastTimestamp = timestamp;
    window.requestAnimationFrame(animate);
    return;
  }

  switch (phase) {
    case "typing":
    case "validating":
    case "paused":
    case "menu":
      return; // no continuous animation needed; driven by events

    case "turning": {
      sticks.last().rotation += (timestamp - lastTimestamp) / turningSpeed;

      if (sticks.last().rotation > 90) {
        sticks.last().rotation = 90;

        const nextPlatform = thePlatformTheStickHits();
        if (nextPlatform) {
          score += pendingPerfect ? 2 : 1;
          scoreElement.innerText = score;

          if (pendingPerfect) {
            perfectElement.style.opacity = 1;
            setTimeout(() => (perfectElement.style.opacity = 0), 1000);
            playPerfectSound();
          } else {
            playLandSound();
          }

          generatePlatform();
          generateTree();
          generateTree();
        }

        phase = "walking";
      }
      break;
    }
    case "walking": {
      heroX += (timestamp - lastTimestamp) / walkingSpeed;

      const nextPlatform = thePlatformTheStickHits();
      if (nextPlatform) {
        const maxHeroX = nextPlatform.x + nextPlatform.w - heroDistanceFromEdge;
        if (heroX > maxHeroX) {
          heroX = maxHeroX;
          phase = "transitioning";
        }
      } else {
        const maxHeroX = sticks.last().x + sticks.last().length + heroWidth;
        if (heroX > maxHeroX) {
          heroX = maxHeroX;
          phase = "falling";
          playFallSound();
        }
      }
      break;
    }
    case "transitioning": {
      sceneOffset += (timestamp - lastTimestamp) / transitioningSpeed;

      const nextPlatform = thePlatformTheStickHits();
      if (sceneOffset > nextPlatform.x + nextPlatform.w - paddingX) {
        sticks.push({
          x: nextPlatform.x + nextPlatform.w,
          length: 0,
          rotation: 0
        });
        wordBuffer = [];
        hadBackspace = false;
        wordStartTime = null;
        pendingPerfect = false;
        feedbackText = "";
        phase = "typing";
        startCursorBlink();
      }
      break;
    }
    case "falling": {
      if (sticks.last().rotation < 180)
        sticks.last().rotation += (timestamp - lastTimestamp) / turningSpeed;

      heroY += (timestamp - lastTimestamp) / fallingSpeed;
      const maxHeroY = platformHeight + 100 + (window.innerHeight - canvasHeight) / 2;
      if (heroY > maxHeroY) {
        lives -= 1;
        updateLivesUI();

        if (lives <= 0) {
          restartButton.style.display = "block";
          pauseBtn.style.display = "none";
          isGameOver = true;
          stopCursorBlink();
          playGameOverSound();
          return;
        }

        const currentPlatform = platforms[platforms.length - 2] || platforms[platforms.length - 1] || platforms[0];
        heroX = currentPlatform.x + currentPlatform.w - heroDistanceFromEdge;
        heroY = 0;
        sceneOffset = 0;
        phase = "typing";
        lastTimestamp = undefined;
        wordBuffer = [];
        hadBackspace = false;
        wordStartTime = null;
        pendingPerfect = false;
        feedbackText = "";
        sticks = [{ x: currentPlatform.x + currentPlatform.w, length: 0, rotation: 0 }];
        stopCursorBlink();
        startCursorBlink();
        draw();
        return;
      }
      break;
    }
    default:
      throw Error("Wrong phase");
  }

  draw();
  window.requestAnimationFrame(animate);

  lastTimestamp = timestamp;
}

function thePlatformTheStickHits() {
  if (sticks.last().rotation != 90)
    throw Error(`Stick is ${sticks.last().rotation}°`);
  const stickFarX = sticks.last().x + sticks.last().length;

  return platforms.find(
    (platform) => platform.x < stickFarX && stickFarX < platform.x + platform.w
  );
}

// ============================================================
// DRAWING
// ============================================================
function draw() {
  ctx.save();
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  drawBackground();

  ctx.translate(
    (window.innerWidth - canvasWidth) / 2 - sceneOffset,
    (window.innerHeight - canvasHeight) / 2
  );

  drawPlatforms();
  drawHero();
  drawSticks();
  drawWordBubble();

  ctx.restore();
}

function drawPlatforms() {
  platforms.forEach(({ x, w }) => {
    ctx.fillStyle = "black";
    ctx.fillRect(
      x,
      canvasHeight - platformHeight,
      w,
      platformHeight + (window.innerHeight - canvasHeight) / 2
    );
  });
}

function drawHero() {
  ctx.save();
  ctx.fillStyle = "black";
  ctx.translate(
    heroX - heroWidth / 2,
    heroY + canvasHeight - platformHeight - heroHeight / 2
  );

  drawRoundedRect(-heroWidth / 2, -heroHeight / 2, heroWidth, heroHeight - 4, 5);

  const legDistance = 5;
  ctx.beginPath();
  ctx.arc(legDistance, 11.5, 3, 0, Math.PI * 2, false);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-legDistance, 11.5, 3, 0, Math.PI * 2, false);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "white";
  ctx.arc(5, -7, 3, 0, Math.PI * 2, false);
  ctx.fill();

  ctx.fillStyle = "red";
  ctx.fillRect(-heroWidth / 2 - 1, -12, heroWidth + 2, 4.5);
  ctx.beginPath();
  ctx.moveTo(-9, -14.5);
  ctx.lineTo(-17, -18.5);
  ctx.lineTo(-14, -8.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-10, -10.5);
  ctx.lineTo(-15, -3.5);
  ctx.lineTo(-5, -7);
  ctx.fill();

  ctx.restore();
}

// The floating word bubble above the hero
function drawWordBubble() {
  if (phase !== "typing" && phase !== "validating") return;

  const text = wordBuffer.join("") + (phase === "typing" && cursorVisible ? "|" : "");
  const displayText = text.length > 0 ? text : (phase === "typing" ? "type a word…" : "");

  const bubbleY = heroY + canvasHeight - platformHeight - heroHeight - 20;
  const bubbleX = heroX;

  ctx.save();
  ctx.font = "bold 16px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(displayText || "type a word…");
  const paddingX = 14;
  const bubbleW = Math.max(metrics.width + paddingX * 2, 60);
  const bubbleH = 30;

  // Bubble background
  ctx.fillStyle = phase === "validating" ? "#ddd" : "white";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1.5;
  drawRoundedRectPath(bubbleX - bubbleW / 2, bubbleY - bubbleH / 2, bubbleW, bubbleH, 8);
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.fillStyle = wordBuffer.length === 0 && phase === "typing" ? "#999" : "#222";
  ctx.fillText(displayText || "type a word…", bubbleX, bubbleY);

  // Feedback text below bubble
  if (feedbackText) {
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillStyle = feedbackText.includes("Checking") ? "#666" : "#D32F2F";
    ctx.fillText(feedbackText, bubbleX, bubbleY + bubbleH / 2 + 14);
  }

  ctx.restore();
}

function drawRoundedRectPath(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x, y + radius);
  ctx.lineTo(x, y + height - radius);
  ctx.arcTo(x, y + height, x + radius, y + height, radius);
  ctx.lineTo(x + width - radius, y + height);
  ctx.arcTo(x + width, y + height, x + width, y + height - radius, radius);
  ctx.lineTo(x + width, y + radius);
  ctx.arcTo(x + width, y, x + width - radius, y, radius);
  ctx.lineTo(x + radius, y);
  ctx.arcTo(x, y, x, y + radius, radius);
}

function drawRoundedRect(x, y, width, height, radius) {
  drawRoundedRectPath(x, y, width, height, radius);
  ctx.fill();
}

function drawSticks() {
  sticks.forEach((stick) => {
    ctx.save();
    ctx.translate(stick.x, canvasHeight - platformHeight);
    ctx.rotate((Math.PI / 180) * stick.rotation);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -stick.length);
    ctx.stroke();
    ctx.restore();
  });
}

function drawBackground() {
  var gradient = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
  gradient.addColorStop(0, "#BBD691");
  gradient.addColorStop(1, "#FEF1E1");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  drawHill(hill1BaseHeight, hill1Amplitude, hill1Stretch, "#95C629");
  drawHill(hill2BaseHeight, hill2Amplitude, hill2Stretch, "#659F1C");

  trees.forEach((tree) => drawTree(tree.x, tree.color));
}

function drawHill(baseHeight, amplitude, stretch, color) {
  ctx.beginPath();
  ctx.moveTo(0, window.innerHeight);
  ctx.lineTo(0, getHillY(0, baseHeight, amplitude, stretch));
  for (let i = 0; i < window.innerWidth; i++) {
    ctx.lineTo(i, getHillY(i, baseHeight, amplitude, stretch));
  }
  ctx.lineTo(window.innerWidth, window.innerHeight);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawTree(x, color) {
  ctx.save();
  ctx.translate(
    (-sceneOffset * backgroundSpeedMultiplier + x) * hill1Stretch,
    getTreeY(x, hill1BaseHeight, hill1Amplitude)
  );

  const treeTrunkHeight = 5;
  const treeTrunkWidth = 2;
  const treeCrownHeight = 25;
  const treeCrownWidth = 10;

  ctx.fillStyle = "#7D833C";
  ctx.fillRect(-treeTrunkWidth / 2, -treeTrunkHeight, treeTrunkWidth, treeTrunkHeight);

  ctx.beginPath();
  ctx.moveTo(-treeCrownWidth / 2, -treeTrunkHeight);
  ctx.lineTo(0, -(treeTrunkHeight + treeCrownHeight));
  ctx.lineTo(treeCrownWidth / 2, -treeTrunkHeight);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

function getHillY(windowX, baseHeight, amplitude, stretch) {
  const sineBaseY = window.innerHeight - baseHeight;
  return (
    Math.sinus((sceneOffset * backgroundSpeedMultiplier + windowX) * stretch) * amplitude + sineBaseY
  );
}

function getTreeY(x, baseHeight, amplitude) {
  const sineBaseY = window.innerHeight - baseHeight;
  return Math.sinus(x) * amplitude + sineBaseY;
}
