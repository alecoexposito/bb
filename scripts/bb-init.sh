#!/bin/sh
#sshfs -o nonempty,reconnect,ServerAliveInterval=10,ServerAliveCountMax=3 zurikato@187.162.125.161:/var/www/html/cameras/386 /home/zurikato/camera
ffmpeg -rtsp_flags prefer_tcp -i "rtsp://192.168.1.17:554/user=admin&password=&channel=1&stream=1.sdp" -acodec copy -vcodec copy -f hls -hls_time 30 -hls_list_size 1635 -hls_flags append_list+delete_segments -use_localtime 1 -hls_segment_filename "/home/zurikato/video-backup/%Y-%m-%d_%H-%M-%S_hls.ts" /home/zurikato/video-backup/playlist.m3u8
