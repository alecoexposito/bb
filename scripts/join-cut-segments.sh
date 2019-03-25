#!/usr/bin/env bash
startTime=$1
totalSeconds=$2
folderPath=/home/zurikato/camera/video/$3
cd $folderPath
#printf 'file %s\n' *.ts > videos.txt
ffmpeg -safe 0 -f concat -y -i videos.txt -c copy download.mp4
#ffmpeg -ss $startTime -t $totalSeconds -y -i videos.mp4 download.mp4
