#!/bin/sh
# Works out why IBM Bob will not launch the pet's hook on macOS.
#
# It temporarily adds four harmless test commands next to the pet's own hook, waits for
# you to send one prompt in Bob, then reports which of them Bob managed to run and puts
# your settings back exactly as they were.
set -e
settings="$HOME/.bob/settings/settings.json"
backup="$HOME/bobpet-settings-backup.json"
probe="$HOME/bobpet-probe.log"
launcher="$HOME/Library/Application Support/Bob Pet/BOB_PET_HOOK.sh"

cp "$settings" "$backup"
rm -f "$probe"

python3 - "$settings" "$probe" "$launcher" <<'PY'
import json, sys
settings, probe, launcher = sys.argv[1], sys.argv[2], sys.argv[3]
with open(settings) as f:
    data = json.load(f)
tests = [
    # 1. can Bob run anything at all here, and what directory does it run it in?
    f'/bin/sh -c \'echo "1-anything pwd=$PWD" >> "{probe}"\'',
    # 2. a path with spaces, quoted, writing a marker - the shape of the pet's own command
    f'"{launcher}.probe"',
    # 3. the pet's launcher, run explicitly through sh rather than by its shebang
    f'/bin/sh "{launcher}"',
    # 4. proof Bob worked through the whole list
    f'/bin/sh -c \'echo 4-reached-end >> "{probe}"\'',
]
groups = data.setdefault('hooks', {}).setdefault('UserPromptSubmit', [])
kept = [g for g in groups if 'BOB_PET_HOOK' in g['hooks'][0]['command']]
data['hooks']['UserPromptSubmit'] = kept + [{'hooks': [{'type': 'command', 'command': c, 'timeout': 15}]} for c in tests]
with open(settings, 'w') as f:
    json.dump(data, f, indent=2)
print(f'planted {len(tests)} test commands')
PY

# Test 2 needs something to run: a copy of the launcher that only leaves a marker.
printf '#!/bin/sh\necho "2-quoted-path-with-spaces" >> "%s"\nexit 0\n' "$probe" > "$launcher.probe"
chmod +x "$launcher.probe"

echo
echo "Now switch to IBM Bob and send any prompt (for example: say hello)."
printf "When the answer comes back, return here and press Enter... "
read -r _

echo
echo "=== which test commands Bob managed to run ==="
cat "$probe" 2>/dev/null || echo "(none of them ran - Bob could not launch any hook)"

echo
echo "=== what Bob logged ==="
log=$(ls -t "$HOME/Library/Application Support/IBM Bob/logs"/*/window*/exthost/IBM.bob-code/"IBM Bob.log" 2>/dev/null | head -1)
grep -i hook "$log" 2>/dev/null | tail -8

cp "$backup" "$settings"
rm -f "$launcher.probe"
echo
echo "Your Bob settings have been put back."
