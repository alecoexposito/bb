#!/usr/bin/env bash

/usr/bin/ffmpeg -rtsp_flags prefer_tcp -i "rtsp://$2:554/user=admin&password=&channel=1&stream=1.sdp" -acodec copy -vcodec copy -f hls -hls_time 30 -hls_list_size 3200 -hls_flags append_list+delete_segments -use_localtime 1 -hls_segment_filename "/home/zurikato/video-backup/$1/%Y-%m-%d_%H-%M-%S_hls.ts" /home/zurikato/video-backup/$1/playlist.m3u8
