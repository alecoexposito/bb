var SCWorker = require('socketcluster/scworker');
var SerialPort = require("serialport");
const nmea = require('node-nmea');
const net = require('net');
const Readline = SerialPort.parsers.Readline;
var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');
require("dotenv").config();
const del = require('del');
var ps = require('ps-node');
var lr = require('readline');
var moment = require('moment');

var socketClient = require('socketcluster-client');

class Worker extends SCWorker {

    run() {
        var _this = this;
        console.log('   >> Worker PID:', process.pid);
        var scServer = this.scServer;
        var bb = require(__dirname + '/BBCtrl')(SerialPort, nmea, net, fs, Readline, scServer);
        var client = new net.Socket();
        client.on('error', function (err) {
            console.log('OCURRIO EL ERROR');
            // console.log(err);
        });
        client.connect(options.port, options.ipAddress, function () {
            console.log('----------------------------- CLIENT CONNECTED ------------------------------')
        });

        bb.run({'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': '192.168.1.100'}, client);
        scServer.on('connection', function (socket) {
            console.log("on connection: ", socket);
        });


        var options = {
            secure: false,
            hostname: '192.168.1.100',
            port: 3001
        };
        var socket = socketClient.connect(options);
        socket.on('connect', function () {
            console.log("conectado al server websocket del tracker");
        });
        socket.on('error', function(err) {
            console.log("error ocurred");
        });
        var cameraChannel = socket.subscribe('camera_channel');
        var vcommand = null;
        cameraChannel.watch(function (data) {
            if(data.id == process.env.DEVICE_ID) {
                if (data.type == "start-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    if(_this.isProcessOpenned('gst-launch-1.0')) {
                        console.log("gst-launch-1.0 already openned");
                    } else {
                        vcommand = _this.runCommand('gst-launch-1.0', [
                            'rtspsrc',
                            'location=' + process.env.CAMERA_LOCATION + ' latency=0',
                            '!',
                            'decodebin',
                            '!',
                            'jpegenc',
                            '!',
                            'multifilesink',
                            'location=/home/zurikato/camera/camera.jpg'
                        ]);
                    }
                    // setTimeout(function() {
                    //     vcommand.kill("SIGKILL");
                    // }, 120000)
                } else if(data.type == "stop-streaming") {
                    console.log("AAAAAAAAAAAAAAAAAAAAAA--------------received from web:------------AAAAAAAAAAAAAAA ", data);
                    vcommand.kill("SIGKILL");
                } else if(data.type == "start-video-backup") {
                    var location = process.env.VIDEO_BACKUP_LOCATION;
                    console.log("Stream from backup: ", data);
                    var initialDate = data.initialDate;
                    var endDate = data.endDate;
                    console.log(initialDate);

                    var videoBackupChannel = socket.subscribe(data.playlistName + '_channel');

                    var playlistFolder = "/home/zurikato/camera/video/" + data.playlistName;
                    var playlistFile = "/home/zurikato/camera/video/" + data.playlistName + "/playlist.m3u8";
                    _this.initPlayList(playlistFile, playlistFolder);

                    var count = 1;
                    var lineReader = lr.createInterface({
                        input: fs.createReadStream(location + '/playlist.m3u8')
                    });

                    var lastUtilityLine = "";
                    var noFileFound = true;
                    lineReader.on('line', function (line) {
                        if(line.startsWith("#")) {
                            lastUtilityLine = line;
                        } else {
                            if(line >= initialDate && line <= endDate) {
                                console.log("line added: ", line);
                                noFileFound = false;
                                _this.runCommand("cp", [
                                    location + '/' + line,
                                    playlistFolder + "/" + line
                                ]);
                                _this.addTsToPlaylist(line, playlistFile, lastUtilityLine);
                            } else if(line > endDate) {
                                console.log("ultima linea leida");
                                lineReader.close();
                            }
                        }
                    });

                    lineReader.on('close', function() {
                        console.log("process finished");
                        if(noFileFound == true) {
                            videoBackupChannel.publish({ type: "no-video-available" });
                        }else {
                            _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                            videoBackupChannel.publish({ type: "play-recorded-video" });
                        }
                    });



                    // fs.readdir(location, (err, files) => {
                    //     var noFileFound = true;
                    //     files.forEach(file => {
                    //         if(file != 'playlist.m3u8' && file >= initialDate && file <= endDate) {
                    //             noFileFound = false;
                    //             _this.runCommand("cp", [
                    //                 location + '/' + file,
                    //                 playlistFolder + "/" + file
                    //             ]);
                    //             _this.addTsToPlaylist(file, playlistFile);
                    //         }
                    //     });
                    //     if(noFileFound == true) {
                    //         videoBackupChannel.publish({ type: "no-video-available" });
                    //     }else {
                    //         _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                    //         videoBackupChannel.publish({ type: "play-recorded-video" });
                    //     }
                    // });

                } else if(data.type == "stop-video-backup") {
                    var folderPath = "/home/zurikato/camera/video/" + data.playlistName;
                    del([folderPath], {force: true}).then(paths => {
                        console.log('Deleted files and folders:\n', paths.join('\n'));
                    });
                    // _this.deleteFolderFiles(folderPath);
                    // fs.rmdirSync(folderPath);
                } else if(data.type == "begin-download") {
                    console.log("entrando en el begin download")
                    var totalTime = data.endTime - data.initialTime;

                    _this.downloadVideoByTime(data.initialTime, totalTime, data.playlistName, socket);
                }
            }
        });
    }

    downloadVideoByTime(initialTime, totalTime, playlistName, socket) {
        console.log("entered in download video by time");
        console.log("initial time: ", initialTime);
        console.log("total time: ", totalTime);
        var location = "/home/zurikato/camera/video/" + playlistName;
        if(fs.existsSync(location + "/videos.txt")) {
            fs.truncateSync(location + "/videos.txt", 0);
        }

        fs.readdir(location, (err, files) => {
                var noFileFound = true;
                var firstPass = true;
                var initialDate = null;
                var endDate = null;
                var noFileFound = true;
                var _this = this;
                var scriptsLocation = "/home/zurikato/scripts";
                files.forEach(file => {
                    noFileFound = false;
                    if(file != 'playlist.m3u8') {
                        if(firstPass) {
                            var dateStr = file.replace("_hls.ts", "");
                            var fileDate = moment(dateStr, 'YYYY-MM-DD_HH-mm-ss');
                            var initialDateTmp = fileDate.add(Math.floor(initialTime), 'seconds');
                            initialDate = initialDateTmp.format('YYYY-MM-DD_HH-mm-ss') + "_hls.ts";
                            endDate = initialDateTmp.add(Math.ceil(totalTime), 'seconds').format('YYYY-MM-DD_HH-mm-ss') + "_hls.ts";
                            console.log("initial date: ", initialDate);
                            console.log("end date: ", endDate);
                            firstPass = false;
                        }
                        var filename = location + "/videos.txt";
                        if(file >= initialDate && file <= endDate) {
                            console.log("included file: ", file);
                            fs.appendFileSync(filename, "file " + file + "\n", function(err) {
                                if(err) {
                                    return console.log("error: ", err);
                                }
                            });
                        }
                    }
                });
                var videoBackupChannel = socket.subscribe(playlistName + '_channel');
                _this.runCommand("sh", [
                    scriptsLocation + '/join-cut-segments.sh',
                    initialTime,
                    totalTime,
                    playlistName
                ], function() {
                    videoBackupChannel.publish({ type: "download-ready" });
                });

                if(noFileFound == true) {
                    videoBackupChannel.publish({ type: "no-video-available" });
                }
            });

    }

    runCommand(command, params, closeCallback) {
        const
            {spawn} = require('child_process'),
            vcommand = spawn(command, params);

        vcommand.stdout.on('data', data => {
            console.log(`stdout: ${data}`);
        });

        vcommand.stderr.on('data', data => {
            console.log(`stderr: ${data}`);
        });

        vcommand.on('close', code => {
            if(closeCallback !== undefined) {
                console.log("executing callback function");
                closeCallback();
            }
            console.log('------------------child process exited with code ${code} ----------------');
        });
        return vcommand;
    }

    writeToPlayList(filename, data) {
        fs.appendFileSync(filename, data, function(err) {
            if(err) {
                return console.log("error: ", err);
            }
        });
    }

    initPlayList(filename, playlistFolder) {
        fs.mkdirSync(playlistFolder);
        this.writeToPlayList(filename, "#EXTM3U\n");
        this.writeToPlayList(filename, "#EXT-X-VERSION:3\n");
        this.writeToPlayList(filename, "#EXT-X-MEDIA-SEQUENCE:0\n");
        this.writeToPlayList(filename, "#EXT-X-ALLOW-CACHE:YES\n");
        this.writeToPlayList(filename, "#EXT-X-TARGETDURATION:32\n");
    }

    addTsToPlaylist(tsFilename, playlistFilename, infoLine) {
        var infoLineData = "#EXTINF:30.000000,\n";
        if(infoLine !== undefined)
            infoLineData = infoLine + "\n";
        this.writeToPlayList(playlistFilename, infoLineData);
        this.writeToPlayList(playlistFilename, tsFilename + "\n");
        // this.writeToPlayList("#EXT-X-ENDLIST\n");
    }

    deleteFolderFiles(location) {
        fs.readdir(location, (err, files) => {
            if (err) throw err;

            for (const file of files) {
                fs.unlink(path.join(location, file), err => {
                    if (err) throw err;
                });
            }
        });
    }

    isProcessOpenned(name) {
        ps.lookup({
            command: name,
        }, function(err, resultList ) {
            if (err) {
                throw new Error( err );
            }

            resultList.forEach(function( process ){
                if( process ){
                    console.log( 'PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments );
                    return true;
                }
            });

            return false;
        });
    }

}

new Worker();

