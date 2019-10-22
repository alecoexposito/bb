#!/usr/bin/env bash

while [ $SECONDS -le 3 ]
do
    SECONDS=0
#    gst-launch-1.0 rtspsrc location="rtsp://192.168.1.5:554/user=admin&password=&channel=1&stream=1.sdp" latency=0 ! decodebin ! videorate ! video/x-raw,framerate=5/1 ! jpegenc ! multifilesink location=/home/zurikato/camera-local/camera.jpg
    gst-launch-1.0 rtspsrc location="$1" latency=0 ! decodebin ! videorate ! video/x-raw,framerate=5/1 ! jpegenc quality=35 ! multifilesink block-size=30000 location=/home/zurikato/camera-local/$2
    wait
    echo "seconds passed: $SECONDS"
done

echo "salio del ciclo, seconds passed: $SECONDS"
