#!/usr/bin/env bash
filename="$1"
name=""
folderPath=/home/zurikato/video-backup
cd $folderPath
while read -r line; do
    if [[ $line == *.ts ]]
    then
	    name=$line
	    echo "hasta aqui las clases: $name"
	    break
    fi
    echo "ignored: $line"
done < "$filename"

for f in *.ts; do
    if [[ "$f" < "$name" ]]
    then
    	rm $f
    	echo deleted: $f
    else
    	break
    fi
done