#!/usr/bin/env bash
# Install or uninstall orchestrator launchd services.
#
# Usage:
#   ./scripts/install-services.sh              # Install all services
#   ./scripts/install-services.sh scheduler     # Install only scheduler
#   ./scripts/install-services.sh dashboard     # Install only dashboard
#   ./scripts/install-services.sh --remove      # Remove all services
#   ./scripts/install-services.sh --remove scheduler  # Remove only scheduler

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

SERVICES=(scheduler dashboard)

# Auto-detect version manager shim/bin paths for the launchd environment.
# launchd services don't inherit shell profiles, so we need to explicitly
# include paths for mise, rvm, nvm, rbenv, nodenv, chruby, etc.
detect_shim_paths() {
    local paths=()

    # mise (Rust-based polyglot version manager)
    [[ -d "$HOME/.local/share/mise/shims" ]] && paths+=("$HOME/.local/share/mise/shims")

    # rbenv
    [[ -d "$HOME/.rbenv/shims" ]] && paths+=("$HOME/.rbenv/shims")

    # rvm
    [[ -d "$HOME/.rvm/bin" ]] && paths+=("$HOME/.rvm/bin")
    [[ -d "$HOME/.rvm/rubies/default/bin" ]] && paths+=("$HOME/.rvm/rubies/default/bin")

    # nodenv
    [[ -d "$HOME/.nodenv/shims" ]] && paths+=("$HOME/.nodenv/shims")

    # nvm — shims don't exist, but the current default version's bin does
    if [[ -d "$HOME/.nvm" ]]; then
        local nvm_default="$HOME/.nvm/alias/default"
        if [[ -f "$nvm_default" ]]; then
            local ver
            ver=$(cat "$nvm_default")
            [[ -d "$HOME/.nvm/versions/node/$ver/bin" ]] && paths+=("$HOME/.nvm/versions/node/$ver/bin")
        fi
    fi

    # chruby — no shims, but check for default ruby
    if [[ -d "$HOME/.rubies" ]]; then
        local default_ruby
        default_ruby=$(ls -1d "$HOME/.rubies"/ruby-* 2>/dev/null | sort -V | tail -1)
        [[ -n "$default_ruby" && -d "$default_ruby/bin" ]] && paths+=("$default_ruby/bin")
    fi

    # pyenv
    [[ -d "$HOME/.pyenv/shims" ]] && paths+=("$HOME/.pyenv/shims")

    # Homebrew (macOS ARM vs Intel)
    [[ -d "/opt/homebrew/bin" ]] && paths+=("/opt/homebrew/bin")
    [[ -d "/usr/local/bin" ]] && paths+=("/usr/local/bin")

    # Always include standard system paths and user local bin
    paths+=("$HOME/.local/bin" "/usr/bin" "/bin" "/usr/sbin" "/sbin")

    # Deduplicate while preserving order
    local seen=()
    local result=()
    for p in "${paths[@]}"; do
        local found=0
        for s in "${seen[@]:-}"; do
            [[ "$s" == "$p" ]] && found=1 && break
        done
        if [[ $found -eq 0 ]]; then
            seen+=("$p")
            result+=("$p")
        fi
    done

    # Join with colons
    local IFS=":"
    echo "${result[*]}"
}

install_service() {
    local name="$1"
    local plist_name="com.orchestrator.${name}"
    local plist_src="$PROJECT_ROOT/config/${plist_name}.plist"
    local plist_dst="$HOME/Library/LaunchAgents/${plist_name}.plist"

    if [[ ! -f "$plist_src" ]]; then
        echo "  ✗ No plist template for '$name' at $plist_src"
        return 1
    fi

    mkdir -p "$HOME/Library/LaunchAgents"

    local detected_path
    detected_path=$(detect_shim_paths)

    # Substitute placeholders:
    #   $HOME/orchestrator → actual project root
    #   $DETECTED_PATH → auto-detected shim paths
    #   $HOME → actual home directory
    sed -e "s|\$HOME/orchestrator|$PROJECT_ROOT|g" \
        -e "s|\\\$DETECTED_PATH|$detected_path|g" \
        -e "s|\\\$HOME|$HOME|g" \
        "$plist_src" > "$plist_dst"

    launchctl unload "$plist_dst" 2>/dev/null || true
    launchctl load "$plist_dst"
    echo "  ✓ ${name} installed and started"
    echo "    PATH: $detected_path"
}

remove_service() {
    local name="$1"
    local plist_dst="$HOME/Library/LaunchAgents/com.orchestrator.${name}.plist"

    launchctl unload "$plist_dst" 2>/dev/null || true
    rm -f "$plist_dst"
    echo "  ✓ ${name} removed"
}

# Determine which services to act on
resolve_targets() {
    local targets=()
    for arg in "$@"; do
        [[ "$arg" == "--remove" ]] && continue
        targets+=("$arg")
    done
    if [[ ${#targets[@]} -eq 0 ]]; then
        echo "${SERVICES[@]}"
    else
        echo "${targets[@]}"
    fi
}

if [[ "${1:-}" == "--remove" ]]; then
    echo "Removing orchestrator services..."
    for svc in $(resolve_targets "${@:2}"); do
        remove_service "$svc"
    done
    exit 0
fi

echo "Installing orchestrator services..."
mkdir -p "$HOME/.claude/orchestrator/logs"

for svc in $(resolve_targets "$@"); do
    install_service "$svc"
done

echo ""
echo "Logs: $HOME/.claude/orchestrator/logs/"
echo "Status: launchctl list | grep orchestrator"
