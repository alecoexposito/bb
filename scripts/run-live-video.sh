#!/usr/bin/env bash

gst-launch-1.0 rtspsrc location="rtsp://192.168.1.5:554/user=admin&password=&channel=1&stream=1.sdp" latency=0 ! decodebin ! videorate ! video/x-raw,framerate=5/1 ! jpegenc ! multifilesink location=/home/zurikato/camera-local/camera.jpg
wait
echo "process is over"
