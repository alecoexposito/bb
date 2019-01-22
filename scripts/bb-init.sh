#!/bin/sh
sshfs -p 33 zurikato@187.162.125.161:/var/www/html/cameras/386 /home/zurikato/camera
ffmpeg -rtsp_flags prefer_tcp -i "rtsp://192.168.1.16:554/user=admin&password=&channel=1&stream=1.sdp" -acodec copy -vcodec copy -f segment -segment_list /home/zurikato/video-backup/playlist.m3u8 -segment_time 30 -strftime 1 "/home/zurikato/video-backup/%Y-%m-%d_%H-%M-%S_hls.ts"