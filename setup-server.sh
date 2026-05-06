#!/bin/bash
# ============================================================
# Установка рабочего окружения для AI-агента на VPS
# Курс «Архитектор нейросотрудников» — Урок 7
#
# Запуск: curl -sL https://raw.githubusercontent.com/Ntmib/jarvis-architect/main/setup-server.sh | bash
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

# =====================
# 1. Проверка
# =====================
step "1/6. Проверка системы"
[[ $EUID -eq 0 ]] || err "Запустите от root (вы уже root в консоли Beget)"
[[ -f /etc/os-release ]] && source /etc/os-release
MEM_MB=$(free -m | awk '/Mem:/ {print $2}')
DISK_GB=$(df -BG / | awk 'NR==2 {print $4}' | tr -d G)
log "Система: ${PRETTY_NAME:-Linux}, RAM: ${MEM_MB} MB, Диск: ${DISK_GB} GB"
[[ $MEM_MB -lt 2000 ]] && warn "Рекомендуется минимум 4 GB RAM"
[[ $DISK_GB -lt 5 ]] && err "Мало места на диске (нужно минимум 5 GB свободных)"

# IPv6 fix — Node.js иногда зависает на IPv6
sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || true
sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true

# =====================
# 2. Системные пакеты + Node.js
# =====================
step "2/6. Установка пакетов"

# Убираем битые репозитории NodeSource если есть
rm -f /etc/apt/sources.list.d/nodesource*.list 2>/dev/null || true
rm -f /etc/apt/keyrings/nodesource.gpg 2>/dev/null || true

apt-get update -qq 2>&1 | grep -v "^W:" || true
apt-get install -y -qq curl git jq unzip >/dev/null 2>&1
log "Базовые пакеты установлены"

if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
fi
log "Node.js $(node -v)"

# =====================
# 3. Claude Code CLI
# =====================
step "3/6. Claude Code"
if ! command -v claude &>/dev/null; then
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
fi
if command -v claude &>/dev/null; then
  log "Claude Code CLI установлен"
else
  err "Не удалось установить Claude Code CLI"
fi

# Права на чтение для всех пользователей
CLAUDE_BIN=$(which claude 2>/dev/null)
if [ -n "$CLAUDE_BIN" ]; then
  CLAUDE_REAL=$(readlink -f "$CLAUDE_BIN")
  CLAUDE_PKG_DIR=$(dirname "$CLAUDE_REAL")
  chmod -R a+rX "$CLAUDE_PKG_DIR" 2>/dev/null || true
  chmod a+rX "$(dirname "$CLAUDE_PKG_DIR")" 2>/dev/null || true
  chmod a+rX "$(dirname "$(dirname "$CLAUDE_PKG_DIR")")" 2>/dev/null || true
fi

# =====================
# 4. Пользователь + структура папок
# =====================
step "4/6. Рабочее окружение"

USERNAME="agent"
HOME_DIR="/home/$USERNAME"

if ! id "$USERNAME" &>/dev/null; then
  useradd -m -s /bin/bash "$USERNAME"
  log "Пользователь $USERNAME создан"
else
  log "Пользователь $USERNAME уже существует"
fi

# Структура папок
mkdir -p "$HOME_DIR/workspace"
mkdir -p "$HOME_DIR/projects"

# Права
chown -R "$USERNAME:$USERNAME" "$HOME_DIR"
log "Папки готовы: workspace/ (файлы агента), projects/ (проекты)"

# =====================
# 5. VS Code Tunnel
# =====================
step "5/6. VS Code Tunnel"
if ! command -v code &>/dev/null; then
  curl -Lk "https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64" -o /tmp/vscode.tar.gz 2>/dev/null
  tar -xzf /tmp/vscode.tar.gz -C /usr/local/bin/
  rm -f /tmp/vscode.tar.gz
fi

if command -v code &>/dev/null; then
  log "VS Code CLI установлен"
  echo ""
  echo -e "${CYAN}Сейчас нужно привязать сервер к вашему GitHub.${NC}"
  echo -e "${CYAN}Появится ссылка и код — откройте ссылку в браузере и введите код.${NC}"
  echo ""

  # Запускаем tunnel — он покажет код авторизации
  code tunnel --accept-server-license-terms &
  TUNNEL_PID=$!

  # Ждём пока появится код авторизации
  sleep 8

  echo ""
  echo -e "${YELLOW}Введите код на сайте GitHub и нажмите Authorize.${NC}"
  echo -e "${YELLOW}После этого подождите 10 секунд и нажмите Ctrl+C здесь.${NC}"
  echo ""

  # Ждём пока пользователь авторизуется
  wait $TUNNEL_PID 2>/dev/null || true

  # Устанавливаем как постоянный сервис
  code tunnel service install --accept-server-license-terms 2>/dev/null || true
  log "VS Code Tunnel установлен как постоянный сервис"
else
  warn "Не удалось установить VS Code CLI"
fi

# =====================
# 6. Готово
# =====================
step "6/6. Готово!"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Сервер готов для вашего AI-агента!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "Что дальше:"
echo ""
echo "1. Откройте VS Code на своём компьютере"
echo "2. Слева найдите раздел «Удалённый обозреватель» (Remote Explorer)"
echo "3. В разделе Tunnels появится ваш сервер — нажмите на него"
echo "4. Перетащите мышкой ваши DNA-файлы (SOUL.md, CLAUDE.md и т.д.)"
echo "   в папку /home/agent/workspace/"
echo ""
echo "Ваш агент будет жить в: /home/agent/workspace/"
echo "Проекты агента будут в: /home/agent/projects/"
echo ""
