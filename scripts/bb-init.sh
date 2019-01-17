#!/bin/sh
sshfs -p 33 zurikato@187.162.125.161:/var/www/html/cameras/386 /home/zurikato/camera
gst-launch-1.0 -v -e rtspsrc protocols=tcp location="rtsp://192.168.1.16:554/user=admin&password=&channel=1&stream=1.sdp" ! queue ! rtph264depay ! h264parse config-interval=-1 ! mpegtsmux ! hlssink location="/home/zurikato/camera/hls%05d.ts" target-duration=1