#!/usr/bin/env bash
# What upstream changed since the commit this port is synced to.
#
# Reads repo, branch, synced-to and paths from UPSTREAM.md, keeps a
# blobless clone of upstream in .upstream/ (gitignored), and reports the
# commits after synced-to that touch the tracked paths, each marked by
# whether the ledger in UPSTREAM.md already names it.
#
#   scripts/upstream.sh                 commits since synced-to, then a diffstat
#   scripts/upstream.sh diff [path...]  the full diff since synced-to
#   scripts/upstream.sh show <commit>   one commit, limited to the tracked paths
#   scripts/upstream.sh base <path>     a file as it was at synced-to
#
# -n (first argument) skips the fetch.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
manifest="$root/UPSTREAM.md"
cache="$root/.upstream"

field() { sed -n "s/^$1: *//p" "$manifest" | head -1; }
repo=$(field repo)
branch=$(field branch)
synced=$(field synced-to)
read -r -a paths <<<"$(field paths)"
if [[ -z $repo || -z $branch || -z $synced || ${#paths[@]} -eq 0 ]]; then
  echo "UPSTREAM.md lacks one of repo, branch, synced-to, paths" >&2
  exit 1
fi

fetch=1
if [[ ${1:-} == -n ]]; then fetch=0; shift; fi

if [[ ! -d $cache/.git ]]; then
  git clone --quiet --filter=blob:none --no-checkout "$repo" "$cache"
elif ((fetch)); then
  git -C "$cache" fetch --quiet origin
fi
up() { git -C "$cache" "$@"; }
head=origin/$branch

case ${1:-} in
  "")
    echo "synced-to ${synced:0:7}, upstream $branch at $(up rev-parse --short "$head") ($(up log -1 --format=%cs "$head"))"
    echo
    count=0 new=0
    while read -r sha date subject; do
      count=$((count + 1))
      if grep -q "${sha:0:7}" "$manifest"; then mark="       "; else mark="NEW    " new=$((new + 1)); fi
      echo "$mark${sha:0:7} $date $subject"
    done < <(up log --reverse --format='%H %as %s' "$synced..$head" -- "${paths[@]}")
    if ((count == 0)); then
      echo "Nothing new on the tracked paths."
      exit 0
    fi
    echo
    up diff --stat=100 "$synced" "$head" -- "${paths[@]}" | tail -1
    if ((new > 0)); then
      echo "$new NEW (not in the ledger yet). Read one with: scripts/upstream.sh show <commit>"
    else
      echo "All $count are in the ledger."
    fi
    ;;
  diff)
    shift
    if (($# == 0)); then set -- "${paths[@]}"; fi
    up diff "$synced" "$head" -- "$@"
    ;;
  show)
    up show "${2:?which commit?}" -- "${paths[@]}"
    ;;
  base)
    up show "$synced:${2:?which path?}"
    ;;
  *)
    sed -n '2,/^set -e/p' "$0" | sed '$d; s/^# \{0,1\}//'
    exit 1
    ;;
esac
