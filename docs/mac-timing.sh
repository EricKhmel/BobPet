#!/bin/sh
# How long does the pet's hook take, and how long does IBM Bob allow it?
# Bob kills a hook that outruns its timeout and logs "hook failed", which looks
# identical to a hook that could not start at all.
launcher="$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh"
payload='{"session_id":"t","cwd":"'"$HOME"'","hook_event_name":"PreToolUse","tool_name":"execute_command","tool_input":{"command":"npm test"}}'

echo "=== the timeout Bob is told to allow (seconds) ==="
grep -o '"timeout"[^,}]*' "$HOME/.bob/settings/settings.json" | sort -u

echo
echo "=== how long the hook really takes, three runs ==="
for i in 1 2 3; do
  start=$(python3 -c 'import time; print(time.time())')
  printf '%s' "$payload" | "$launcher"
  code=$?
  end=$(python3 -c 'import time; print(time.time())')
  python3 -c "print(f'run $i: {($end - $start):.2f} seconds, exit $code')"
done

echo
echo "=== and the pet itself, for comparison ==="
pet=$(pgrep -fl "Bob Pet.app/Contents/MacOS/Bob Pet" | head -1 | cut -d' ' -f1)
echo "pet pid: ${pet:-not running}"
