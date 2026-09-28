#!/bin/sh
# Collects everything needed to work out why the pet is not reacting to IBM Bob.
# Run in Terminal, then send the output back. It only reads; it changes nothing.
echo "=== 1. hooks installed in Bob's settings? ==="
grep -o 'BOB_PET_HOOK[^"]*' "$HOME/.bob/settings/settings.json" 2>/dev/null | sort -u || echo "no hooks found in ~/.bob/settings/settings.json"

echo
echo "=== 2. the launcher the hooks run ==="
ls -l "$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh" 2>/dev/null || echo "launcher missing"
echo "--- its contents ---"
cat "$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh" 2>/dev/null

echo
echo "=== 3. is the pet running and published? ==="
pgrep -fl "Bob Pet" | head -3 || echo "pet not running"
cat "$HOME/Library/Application Support/Bob Pet/session.json" 2>/dev/null || echo "no session.json"

echo
echo "=== 4. run the hook by hand, as Bob would ==="
printf '%s' '{"session_id":"t","cwd":"'"$HOME"'","hook_event_name":"PreToolUse","tool_name":"execute_command","tool_input":{"command":"npm test"}}' \
  | "$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh"
echo "hook exit code: $?   (the pet should have reacted just now)"
echo "--- anything the hook complained about ---"
cat "$HOME/Library/Application Support/Bob Pet/hook-last-error.log" 2>/dev/null | head -20

echo
echo "=== 5. what Bob says about hooks ==="
log=$(ls -t "$HOME/Library/Application Support/IBM Bob/logs"/*/window*/exthost/IBM.bob-code/"IBM Bob.log" 2>/dev/null | head -1)
echo "log: $log"
grep -i hook "$log" 2>/dev/null | tail -10 || echo "no hook lines"
