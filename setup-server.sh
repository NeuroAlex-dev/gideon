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
mkdir -p "$HOME_DIR/workspace/memory"
mkdir -p "$HOME_DIR/workspace/knowledge"
mkdir -p "$HOME_DIR/workspace/.claude/skills"
mkdir -p "$HOME_DIR/projects"
mkdir -p "$HOME_DIR/.agent/bot"
mkdir -p "$HOME_DIR/.claude"

# Дефолтные настройки Claude Code (светофор разрешений)
if [ ! -f "$HOME_DIR/.claude/settings.json" ]; then
  curl -fsSL https://raw.githubusercontent.com/Ntmib/jarvis-architect/main/.claude/settings.json \
    -o "$HOME_DIR/.claude/settings.json" 2>/dev/null \
    && log "Настройки Claude Code установлены" \
    || warn "Не удалось скачать settings.json — можно добавить позже"
fi

# Скиллы (навыки агента) — живут в workspace, чтобы Claude Code находил их
# через project-level lookup (cwd=workspace), а не через ~/.claude/skills
SKILLS_BASE="https://raw.githubusercontent.com/Ntmib/jarvis-architect/main/workspace/.claude/skills"
for SKILL in discovery-interview content-creator fullstack-developer frontend-design; do
  if [ ! -f "$HOME_DIR/workspace/.claude/skills/$SKILL/SKILL.md" ]; then
    mkdir -p "$HOME_DIR/workspace/.claude/skills/$SKILL"
    curl -fsSL "$SKILLS_BASE/$SKILL/SKILL.md" \
      -o "$HOME_DIR/workspace/.claude/skills/$SKILL/SKILL.md" 2>/dev/null || true
  fi
done
log "Скиллы установлены (4 навыка) в workspace/.claude/skills/"

# Симлинк для единой памяти (бот и VS Code читают один CLAUDE.md)
ln -sf "$HOME_DIR/workspace/CLAUDE.md" "$HOME_DIR/CLAUDE.md"

# Права
chown -R "$USERNAME:$USERNAME" "$HOME_DIR"
chown -h "$USERNAME:$USERNAME" "$HOME_DIR/CLAUDE.md"
log "Папки готовы: workspace/ (файлы агента), projects/ (проекты)"

# =====================
# 5. VS Code Tunnel
# =====================
step "5/6. VS Code Tunnel"
if ! command -v code &>/dev/null; then
  log "Скачиваю VS Code CLI..."
  # Сначала пробуем GitHub (работает на Beget), потом официальный сайт
  GH_URL="https://github.com/Ntmib/jarvis-architect/releases/download/v1.0.0/vscode-cli.tar.gz"
  VS_URL="https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64"
  curl -fL "$GH_URL" -o /tmp/vscode.tar.gz 2>&1 || curl -fL "$VS_URL" -o /tmp/vscode.tar.gz 2>&1 || warn "Ошибка скачивания VS Code CLI"
  if [ -f /tmp/vscode.tar.gz ] && [ "$(wc -c < /tmp/vscode.tar.gz)" -gt 1000 ]; then
    tar -xzf /tmp/vscode.tar.gz -C /usr/local/bin/ 2>&1
    rm -f /tmp/vscode.tar.gz
  else
    warn "Файл VS Code CLI не скачался. Проверьте интернет."
    rm -f /tmp/vscode.tar.gz
  fi
fi

if command -v code &>/dev/null; then
  log "VS Code CLI установлен"
  echo ""
  echo -e "${CYAN}Сейчас нужно привязать сервер к вашему GitHub.${NC}"
  echo -e "${CYAN}Появится ссылка и код — откройте ссылку в браузере и введите код.${NC}"
  echo -e "${CYAN}После авторизации нажмите Ctrl+C чтобы продолжить.${NC}"
  echo ""
  code tunnel --accept-server-license-terms || true
  # Устанавливаем как постоянный сервис
  code tunnel service install --accept-server-license-terms 2>/dev/null || true
  log "VS Code Tunnel установлен как постоянный сервис"
else
  warn "Не удалось установить VS Code CLI. Установите вручную:"
  warn "curl -fL 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64' -o /tmp/c.tar.gz && tar -xzf /tmp/c.tar.gz -C /usr/local/bin/"
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
