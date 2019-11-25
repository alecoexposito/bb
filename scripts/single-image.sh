#!/usr/bin/env bash

ffmpeg -i "$1" -q:v 2 -y -vframes 1 /home/zurikato/camera-local/single-camera.jpg
