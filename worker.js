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

var socketClient = require('socketcluster-client');

class Worker extends SCWorker {

    run() {
        var _this = this;
        console.log('   >> Worker PID:', process.pid);
        var scServer = this.scServer;
        var bb = require(__dirname + '/BBCtrl')(SerialPort, nmea, net, fs, Readline, scServer);
        bb.run({'serialPort': '/dev/ttyS1', 'baudRate': 9600, 'port': 3002, 'ipAddress': '192.168.1.100'});
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
                    videoBackupChannel.publish({ message: "testing" });
                    // _this.runCommand("cp", [
                    //     location + '/playlist.m3u8',
                    //     '/home/zurikato/camera/video/playlist.m3u8'
                    // ]);
                    var playlistFolder = "/home/zurikato/camera/video/" + data.playlistName;
                    var playlistFile = "/home/zurikato/camera/video/" + data.playlistName + "/playlist.m3u8";
                    _this.initPlayList(playlistFile, playlistFolder);
                    fs.readdir(location, (err, files) => {
                        files.forEach(file => {
                            if(file != 'playlist.m3u8' && file >= initialDate && file <= endDate) {
                                _this.runCommand("cp", [
                                    location + '/' + file,
                                    playlistFolder + "/" + file
                                ]);
                                _this.addTsToPlaylist(file, playlistFile);
                            }
                        });
                        _this.writeToPlayList(playlistFile, "#EXT-X-ENDLIST");
                    });

                } else if(data.type == "stop-video-backup") {
                    // _this.runCommand("rm /home/zurikato/camera/video/*", []);
                    // _this.deleteFolderFiles("/home/zurikato/camera/video");
                    var folderPath = "/home/zurikato/camera/video/" + data.playlistName;
                    del([folderPath], {force: true}).then(paths => {
                        console.log('Deleted files and folders:\n', paths.join('\n'));
                    });
                    // _this.deleteFolderFiles(folderPath);
                    // fs.rmdirSync(folderPath);
                }
            }
        });
    }

    runCommand(command, params) {
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
            console.log('------------------child process exited with code ${code} ----------------');
        });
        return vcommand;
    }

    writeToPlayList(filename, data) {
        fs.appendFileSync(filename, data, function(err) {
            if(err) {
                return console.log("error: ", err);
            }

            console.log("playlist file written: ", data);
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

    addTsToPlaylist(tsFilename, playlistFilename) {
        this.writeToPlayList(playlistFilename, "#EXTINF:30.000000,\n");
        this.writeToPlayList(playlistFilename, tsFilename + "\n");
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

