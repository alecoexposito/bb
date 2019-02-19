#!/usr/bin/env bash

getscript() {
  pgrep -lf ".[ /]$1( |\$)"
}

script1=record-video.sh

# test if script 1 is running
if getscript "$script1" >/dev/null; then
  echo "$script1" is RUNNING
  else
    echo "$script1" is NOT running
fi