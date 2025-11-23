// ============================================================================
// RENDER.JS - Sistema de movimento da Susie
// Abordagem totalmente local: mínimas requisições IPC, máxima performance
// ============================================================================

const { ipcRenderer } = require("electron");

// ============================================================================
// CONSTANTES E CONFIGURAÇÕES
// ============================================================================

const WINDOW_WIDTH = 80; // Largura da janela (deve coincidir com main.js)
const WINDOW_HEIGHT = 130; // Altura da janela (deve coincidir com main.js)
const WALK_SPEED = 2; // Pixels por frame
const GRAVITY = 0.8; // Aceleração da gravidade
const GROUND_OFFSET = 45; // Distância do chão da tela
const MIN_UPDATE_INTERVAL = 24; // ~41fps (balanceamento entre suavidade e CPU/Memória)
const MIN_WALK_TIME = 5000; // Tempo mínimo andando em uma direção (5s)
const DIRECTION_CHANGE_CHANCE = 0.01; // Chance de mudar de direção por frame (1%)

const FALLING_SPRITE_HEIGHT = 68; // Altura do sprite caindo (40px * scale 2)
const WALKING_SPRITE_HEIGHT = 86; // Altura do sprite andando (43px * scale 2)

// Configuração PARADA (STANDING) - susie_parada.png
const PARADA_SPRITE_HEIGHT = 86; // 43px * 2
const PARADA_MIN_CYCLES = 2;
const PARADA_MAX_CYCLES = 4;
const STANDING_PROBABILITY = 0.2; // 40%

// Configuração DORMINDO (susie_dormindo.png)
const SLEEPING_SPRITE_HEIGHT = 44; // 36px * 2
const SLEEP_MIN_CYCLES = 5;
const SLEEP_MAX_CYCLES = 8;
const SLEEP_PROBABILITY = 0.1; // 20%

// Configuração ESPREGUIÇANDO (STRETCHING) - susie_espreguica.png
const STRETCHING_SPRITE_HEIGHT = 90; // 45px * 2
const STRETCHING_MIN_CYCLES = 2; // 1 ciclo de 1s = 1s total
const STRETCHING_MAX_CYCLES = 4;
const STRETCHING_PROBABILITY = 0.2; // 20%

const IDLE_CHECK_INTERVAL = 10000; // Verifica a cada 10s

// ============================================================================
// ESTADO GLOBAL
// ============================================================================

const character = document.getElementById("character");

// Estados possíveis: "walking", "dragging", "falling", "fallen", "standing", "sleeping", "stretching"
let currentState = "walking";

// Direção do movimento: 1 = direita, -1 = esquerda
let direction = 1;
let lastDirection = 1;
let lastDirectionChangeTime = Date.now(); // Controle de tempo mínimo de caminhada

// Posição da janela (calculada localmente, sem requisições)
let posX = 0;
let posY = 0;

// Velocidade vertical (para física de queda)
let velocityY = 0;

// Informações da tela (obtidas uma única vez no início)
let screenWidth = 0;
let screenHeight = 0;
let groundY = 0; // Posição Y do chão (sempre a mesma)

// Controle de arrasto
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

// Controle de throttling para IPC
let lastUpdateTime = 0;

// Controle de animação de ociosidade (standing, sleeping, stretching)
let lastIdleCheck = 0;
let idleCyclesRemaining = 0;
let isIdle = false; // true se estiver em qualquer estado idle
let lastIdleState = ""; // Último estado idle executado

// ============================================================================
// FUNÇÃO DE ATUALIZAÇÃO COM THROTTLING
// ============================================================================

/**
 * Atualiza a posição da janela com throttling
 * Limita atualizações a ~30fps para evitar sobrecarga do IPC
 */
function updateWindowPosition(force = false) {
  const now = Date.now();
  if (force || now - lastUpdateTime >= MIN_UPDATE_INTERVAL) {
    ipcRenderer.send("set-window-position", Math.round(posX), Math.round(posY));
    lastUpdateTime = now;
  }
}

// ============================================================================
// INICIALIZAÇÃO
// Obtém informações da tela e posição inicial (ÚNICA VEZ)
// ============================================================================

/**
 * Inicializa o sistema obtendo informações da tela e posição inicial
 * Esta é a ÚNICA requisição feita no início
 */
async function init() {
  try {
    // Obtém informações da tela (tamanho disponível)
    const display = await ipcRenderer.invoke("get-screen-info");
    screenWidth = display.workAreaSize.width;
    screenHeight = display.workAreaSize.height;

    // Calcula a posição Y do chão (sempre a mesma para todos os sprites)
    groundY = screenHeight - WINDOW_HEIGHT + GROUND_OFFSET;

    // Obtém posição inicial da janela
    const [x, y] = await ipcRenderer.invoke("get-window-position");
    posX = x;
    posY = y;

    // Inicia o game loop
    gameLoop();
  } catch (error) {
    console.error("Erro na inicialização:", error);
  }
}

// ============================================================================
// SISTEMA DE ARRASTO (DRAG AND DROP)
// ============================================================================

/**
 * Inicia o arrasto quando o mouse pressiona o personagem
 */
character.addEventListener("mousedown", (e) => {
  // Força o estado de dragging IMEDIATAMENTE, interrompendo qualquer animação
  isDragging = true;
  velocityY = 0;

  // Se estava em algum estado idle, cancela
  if (
    currentState === "standing" ||
    currentState === "sleeping" ||
    currentState === "stretching"
  ) {
    isIdle = false;
    idleCyclesRemaining = 0;
  }

  currentState = "dragging";

  // Remove TODAS as classes de estado anteriores
  character.classList.remove(
    "walking",
    "fallen",
    "falling",
    "standing",
    "sleeping",
    "stretching",
    "right",
    "left"
  );
  character.classList.add("dragging");
  // Adiciona classe de direção: 1=direita, -1=esquerda
  character.classList.add(lastDirection === 1 ? "right" : "left");

  // Calcula offset para arrasto suave
  dragOffsetX = e.screenX - posX;
  dragOffsetY = e.screenY - posY;

  e.stopPropagation();
  e.preventDefault();
});

/**
 * Detecta quando a animação de idle termina
 */
character.addEventListener("animationend", (e) => {
  // Verifica se é uma animação de idle válida
  const isIdleAnimation =
    e.animationName === "idle-standing" ||
    e.animationName === "idle-sleep" ||
    e.animationName === "idle-stretching";

  if (
    isIdleAnimation &&
    (currentState === "standing" ||
      currentState === "sleeping" ||
      currentState === "stretching")
  ) {
    idleCyclesRemaining--;

    if (idleCyclesRemaining <= 0) {
      // Terminou todos os ciclos, volta a andar
      isIdle = false;
      currentState = "walking";
      character.classList.remove(
        "standing",
        "sleeping",
        "stretching",
        "right",
        "left"
      );
      character.classList.add("walking");
      // Adiciona classe de direção
      character.classList.add(lastDirection === 1 ? "right" : "left");
      // Restaura o sprite de andar
      character.style.width = "";
      character.style.height = "";
      // Restaura tamanho da janela
      ipcRenderer.send("set-window-size", 80, 130);

      // Reinicia timer de direção ao voltar a andar
      lastDirectionChangeTime = Date.now();
    } else {
      // Ainda tem ciclos restantes, reinicia a animação
      const currentClass = currentState;
      character.classList.remove(currentClass);
      void character.offsetWidth;

      // Atualiza variável CSS correta
      if (currentClass === "standing") {
        character.style.setProperty("--standing-cycles", idleCyclesRemaining);
      } else if (currentClass === "sleeping") {
        character.style.setProperty("--sleep-cycles", idleCyclesRemaining);
      } else if (currentClass === "stretching") {
        // stretching pode não usar ciclos visíveis no CSS se for 1 frame, mas mantemos a lógica
        // character.style.setProperty("--stretching-cycles", idleCyclesRemaining);
      }

      character.classList.add(currentClass);
    }
  }
});

/**
 * Atualiza posição durante o arrasto
 * Envia IPC durante drag para mover a janela em tempo real
 */
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;

  // Calcula nova posição
  posX = e.screenX - dragOffsetX;
  posY = e.screenY - dragOffsetY;

  // Envia para o processo principal mover a janela
  ipcRenderer.send("set-window-position", Math.round(posX), Math.round(posY));
});

/**
 * Finaliza o arrasto e sincroniza posição
 * ÚNICA requisição de leitura: para garantir sincronia após o drag
 */
window.addEventListener("mouseup", async () => {
  if (!isDragging) return;

  isDragging = false;
  character.classList.remove("dragging");

  // Sincroniza posição real (ÚNICA requisição de leitura necessária)
  const [x, y] = await ipcRenderer.invoke("get-window-position");
  posX = x;
  posY = y;

  // Inicia animação de queda com direção correta
  currentState = "falling";
  velocityY = 0;
  character.classList.add("falling");
  // Adiciona classe de direção: 1=direita, -1=esquerda
  character.classList.add(lastDirection === 1 ? "right" : "left");
});

// ============================================================================
// GAME LOOP - Atualização de física e movimento
// ============================================================================

/**
 * Loop principal do jogo
 * Calcula física, movimento e atualiza posição da janela
 * Roda a ~60fps via requestAnimationFrame
 */
function gameLoop() {
  // Verifica se deve entrar em estado idle
  const now = Date.now();
  if (
    currentState === "walking" &&
    !isIdle &&
    now - lastIdleCheck >= IDLE_CHECK_INTERVAL
  ) {
    lastIdleCheck = now;

    // Decide qual estado idle usar
    let nextState = "";
    const rand = Math.random(); // 0.0 a 1.0

    // Distribuição de probabilidade inicial
    if (rand < STANDING_PROBABILITY) {
      nextState = "standing";
    } else if (rand < STANDING_PROBABILITY + SLEEP_PROBABILITY) {
      nextState = "sleeping";
    } else if (
      rand <
      STANDING_PROBABILITY + SLEEP_PROBABILITY + STRETCHING_PROBABILITY
    ) {
      nextState = "stretching";
    }

    // Se escolheu um estado
    if (nextState) {
      // Evita repetição do mesmo estado idle
      if (nextState === lastIdleState) {
        // Escolhe outro estado aleatoriamente entre os disponíveis
        const availableStates = ["standing", "sleeping", "stretching"].filter(
          (s) => s !== lastIdleState
        );
        nextState =
          availableStates[Math.floor(Math.random() * availableStates.length)];
      }

      // Aplica o estado escolhido
      lastIdleState = nextState;
      isIdle = true;
      currentState = nextState;
      character.classList.remove("walking", "right", "left");

      if (nextState === "standing") {
        idleCyclesRemaining =
          Math.floor(
            Math.random() * (PARADA_MAX_CYCLES - PARADA_MIN_CYCLES + 1)
          ) + PARADA_MIN_CYCLES;
        character.style.setProperty("--standing-cycles", idleCyclesRemaining);
        character.classList.add("standing");
        ipcRenderer.send("set-window-size", 80, 130);
      } else if (nextState === "sleeping") {
        idleCyclesRemaining =
          Math.floor(
            Math.random() * (SLEEP_MAX_CYCLES - SLEEP_MIN_CYCLES + 1)
          ) + SLEEP_MIN_CYCLES;
        character.style.setProperty("--sleep-cycles", idleCyclesRemaining);
        character.classList.add("sleeping");
        character.classList.add(lastDirection === 1 ? "right" : "left");
        ipcRenderer.send("set-window-size", 108, 72);

        // Força atualização de posição imediata para ajustar altura
        const heightDifference = WALKING_SPRITE_HEIGHT - SLEEPING_SPRITE_HEIGHT;
        posY = groundY + heightDifference;
        updateWindowPosition(true);
      } else if (nextState === "stretching") {
        idleCyclesRemaining =
          Math.floor(
            Math.random() * (STRETCHING_MAX_CYCLES - STRETCHING_MIN_CYCLES + 1)
          ) + STRETCHING_MIN_CYCLES;
        character.classList.add("stretching");
        character.classList.add(lastDirection === 1 ? "right" : "left");
        ipcRenderer.send("set-window-size", 80, 130);

        // Força atualização de posição imediata para ajustar altura
        const heightDifference =
          WALKING_SPRITE_HEIGHT - STRETCHING_SPRITE_HEIGHT;
        posY = groundY + heightDifference;
        updateWindowPosition(true);
      }
    }
  }

  // ============================================================
  // ESTADO: STANDING
  // ============================================================
  if (currentState === "standing") {
    // Em estado standing, não precisa atualizar posição constantemente se já estiver no chão
    if (posY !== groundY) {
      posY = groundY;
      updateWindowPosition();
    }
    // Skip updateWindowPosition if already correct to save IPC calls
  }

  // ============================================================
  // ESTADO: SLEEPING
  // ============================================================
  else if (currentState === "sleeping") {
    const heightDifference = WALKING_SPRITE_HEIGHT - SLEEPING_SPRITE_HEIGHT;
    const targetY = groundY + heightDifference;

    if (posY !== targetY) {
      posY = targetY;
      updateWindowPosition();
    }
  }

  // ============================================================
  // ESTADO: STRETCHING
  // ============================================================
  else if (currentState === "stretching") {
    // Altura 90px vs 86px (walking)
    const heightDifference = WALKING_SPRITE_HEIGHT - STRETCHING_SPRITE_HEIGHT;
    const targetY = groundY + heightDifference;

    if (posY !== targetY) {
      posY = targetY;
      updateWindowPosition();
    }
  }

  // ============================================================
  // ESTADO: FALLING (Caindo)
  // ============================================================
  else if (currentState === "falling") {
    // Aplica gravidade
    velocityY += GRAVITY;
    posY += velocityY;

    // Verifica colisão com o chão
    const heightDifference = WALKING_SPRITE_HEIGHT - FALLING_SPRITE_HEIGHT;
    const groundYFalling = groundY + heightDifference;

    if (posY >= groundYFalling) {
      posY = groundYFalling;
      velocityY = 0;
      currentState = "fallen";

      // Atualiza animação CSS - remove falling, adiciona fallen
      character.classList.remove("falling");
      character.classList.add("fallen");
      // Mantém a mesma classe de direção (right ou left)

      // Força atualização ao aterrissar
      updateWindowPosition(true);

      // Após 2 segundos, volta a andar
      setTimeout(() => {
        // Só executa se ainda estiver no estado fallen (não foi arrastada)
        if (currentState === "fallen") {
          character.classList.remove("fallen", "right", "left");
          currentState = "walking";
          // Ajusta posY de volta para o sprite de andar (que é maior)
          posY = groundY;
          // Reinicia timer de direção ao voltar a andar
          lastDirectionChangeTime = Date.now();
        }
      }, 2000);
    }

    // Envia nova posição com throttling
    updateWindowPosition();
  }

  // ============================================================
  // ESTADO: WALKING (Andando)
  // ============================================================
  else if (currentState === "walking") {
    // Garante que classe CSS está ativa
    if (!character.classList.contains("walking")) {
      // Remove qualquer classe residual de outros estados
      character.classList.remove(
        "falling",
        "fallen",
        "dragging",
        "sleeping",
        "standing",
        "stretching",
        "right",
        "left"
      );
      character.classList.add("walking");
      // Adiciona classe de direção
      character.classList.add(direction === 1 ? "right" : "left");
      // Remove qualquer transform inline que possa ter sobrado
      character.style.transform = "";
      // Restaura tamanho original ao voltar a andar
      character.style.width = "";
      character.style.height = "";

      // Reinicia timer de direção ao voltar a andar
      lastDirectionChangeTime = Date.now();
    }

    // Mantém no chão
    posY = groundY;

    // Movimento horizontal
    posX += WALK_SPEED * direction;

    // Colisão com bordas da tela
    if (posX + WINDOW_WIDTH >= screenWidth) {
      // Bateu na direita
      direction = -1;
      posX = screenWidth - WINDOW_WIDTH;
      lastDirectionChangeTime = Date.now(); // Reset timer
    } else if (posX <= 0) {
      // Bateu na esquerda
      direction = 1;
      posX = 0;
      lastDirectionChangeTime = Date.now(); // Reset timer
    }

    // Mudança aleatória de direção
    const now = Date.now();
    if (now - lastDirectionChangeTime > MIN_WALK_TIME) {
      if (Math.random() < DIRECTION_CHANGE_CHANCE) {
        direction *= -1; // Inverte direção
        lastDirectionChangeTime = now;
      }
    }

    // Atualiza classe de direção quando muda
    if (direction !== lastDirection) {
      character.classList.remove("right", "left");
      character.classList.add(direction === 1 ? "right" : "left");
      lastDirection = direction;
    }

    // Envia nova posição com throttling
    updateWindowPosition();
  }

  // ============================================================
  // ESTADO: FALLEN (sem movimento automático)
  // ============================================================
  else if (currentState === "fallen") {
    // Ajusta Y para compensar diferença de altura do sprite (mantém pés no chão)
    const heightDifference = WALKING_SPRITE_HEIGHT - FALLING_SPRITE_HEIGHT;
    posY = groundY + heightDifference;
    updateWindowPosition();
  }

  // ============================================================
  // ESTADO: DRAGGING (sem movimento automático)
  // ============================================================
  // Não faz nada no game loop, a posição é controlada pelo mousemove

  // Continua o loop
  requestAnimationFrame(gameLoop);
}

// ============================================================================
// INICIA A APLICAÇÃO
// ============================================================================

init();
