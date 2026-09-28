#!/bin/sh
# Works out why IBM Bob will not launch the pet's hook on macOS.
#
# Bob reports "hook failed" for every event, yet the same hook runs in 0.16s from a
# terminal and the pet reacts. That message means the command never completed, so this
# plants six variants beside the pet's own hook, each recording exactly what happened,
# and then puts your settings back. It changes nothing permanently.
#
# Run it, send ONE prompt in Bob, come back and press Enter.
set -e

settings="$HOME/.bob/settings/settings.json"
backup="$HOME/bobpet-settings-backup.json"
probe="$HOME/bobpet-probe.log"
kit="$HOME/.bobpet-probe"
spacey="$HOME/Library/Application Support/Bob Pet/probe with spaces.sh"
launcher="$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh"
[ -f "$launcher" ] || launcher="$HOME/.bobpet/BOB_PET_HOOK.sh"

rm -rf "$kit" "$probe"; mkdir -p "$kit"
cp "$settings" "$backup"

# The pet's own executable and hook script, read out of the launcher we already wrote.
pet_exe=$(grep -o '"[^"]*Contents/MacOS/Bob Pet"' "$launcher" | head -1 | tr -d '"')
pet_hook=$(grep -o '"[^"]*hook\.js"' "$launcher" | head -1 | tr -d '"')

# Each probe records that it started, what it inherited, and how it ended.
make_probe() {              # $1 = name, $2 = what it does
  cat > "$2" <<PROBE
#!/bin/sh
{
  echo "[$1] ran at \$(date +%H:%M:%S)"
  echo "[$1]   directory: \$PWD"
  echo "[$1]   shell: \$0   user: \$(id -un)"
  echo "[$1]   ELECTRON_RUN_AS_NODE=\${ELECTRON_RUN_AS_NODE:-unset} NODE_OPTIONS=\${NODE_OPTIONS:-unset}"
} >> "$probe"
$3
echo "[$1]   finished, exit \$?" >> "$probe"
exit 0
PROBE
  chmod +x "$2"
}

make_probe "B-bare-path" "$kit/b.sh" ""
make_probe "C-spaces-quoted" "$spacey" ""
# D launches the pet's own binary, which is the one thing the other probes do not do.
make_probe "D-launches-pet" "$kit/d.sh" "printf '%s' '{\"session_id\":\"probe\",\"cwd\":\"'\"\$HOME\"'\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"execute_command\",\"tool_input\":{\"command\":\"npm test\"}}' | ELECTRON_RUN_AS_NODE=1 \"$pet_exe\" \"$pet_hook\" >/dev/null 2>>\"$probe\""

python3 - "$settings" "$probe" "$kit" "$spacey" "$launcher" <<'PY'
import json, sys
settings, probe, kit, spacey, launcher = sys.argv[1:6]
with open(settings) as f:
    data = json.load(f)
tests = [
    # 1. Can Bob launch anything here at all, and in which directory?
    f"/bin/sh -c 'echo \"[A-anything] ran in \\\"$PWD\\\"\" >> {probe!s}'",
    # 2. A plain path, no spaces, no quotes - the shape the fix uses.
    f"{kit}/b.sh",
    # 3. A quoted path containing spaces - the shape that is failing now.
    f'"{spacey}"',
    # 4. A plain path that launches the pet's own application, as the real hook does.
    f"{kit}/d.sh",
    # 5. The pet's actual hook, unchanged, as the control.
    f'"{launcher}"' if ' ' in launcher else launcher,
    # 6. Proof that Bob worked through the whole list.
    f"/bin/sh -c 'echo \"[F-reached-end]\" >> {probe!s}'",
]
groups = data.setdefault('hooks', {}).setdefault('UserPromptSubmit', [])
data['hooks']['UserPromptSubmit'] = [{'hooks': [{'type': 'command', 'command': c, 'timeout': 20}]} for c in tests]
with open(settings, 'w') as f:
    json.dump(data, f, indent=2)
print('planted 6 test commands on UserPromptSubmit')
PY

echo
echo "Is IBM Bob itself sandboxed? (a sandboxed app cannot launch other programs)"
bob=$(ls -d /Applications/IBM*Bob*.app 2>/dev/null | head -1)
[ -n "$bob" ] || bob=$(mdfind "kMDItemFSName == 'IBM Bob.app'" 2>/dev/null | head -1)
echo "  Bob: ${bob:-not found}"
[ -n "$bob" ] && codesign -d --entitlements - "$bob" 2>/dev/null | grep -i -A1 "sandbox\|inherit" | head -6

echo
echo "-------------------------------------------------------------"
echo "NOW: switch to IBM Bob and send one prompt, e.g. 'say hello'."
echo "Wait for the answer, then come back here."
printf "Press Enter when done... "
read -r _

echo
echo "=== which commands Bob managed to run ==="
cat "$probe" 2>/dev/null || echo "(nothing ran at all - Bob could not launch any hook)"

echo
echo "=== what the pet's own hook reported ==="
cat "$HOME/Library/Application Support/Bob Pet/hook-last-error.log" 2>/dev/null | head -10
cat "$HOME/.bobpet/hook-last-error.log" 2>/dev/null | head -10

echo
echo "=== what Bob logged while you did that ==="
log=$(ls -t "$HOME/Library/Application Support/IBM Bob/logs"/*/window*/exthost/IBM.bob-code/"IBM Bob.log" 2>/dev/null | head -1)
grep -i hook "$log" 2>/dev/null | tail -12

echo
echo "=== the exact commands Bob was given ==="
python3 -c "import json;print('\n'.join(g['hooks'][0]['command'] for g in json.load(open('$settings'))['hooks']['UserPromptSubmit']))" 2>/dev/null

cp "$backup" "$settings"
rm -rf "$kit" "$spacey"
echo
echo "Settings restored. Nothing else was changed."
