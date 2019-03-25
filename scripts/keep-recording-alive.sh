#!/usr/bin/env bash

getscript() {
  pgrep -lf ".[ /]$1( |\$)"
}

script1=record-video.sh

# test if script 1 is running
if !getscript "$script1" >/dev/null; then
    nohup sh /home/zurikato/scripts/record-video.sh &>/dev/null &
    echo "$script1" is NOT running -; date
fi